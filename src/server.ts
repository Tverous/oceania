import { createServer as createHttpServer } from 'node:http'
import type { Server } from 'node:http'
import { relative, resolve, sep } from 'node:path'
import { json } from 'node:stream/consumers'
import { filePatch } from './git.ts'
import type { Memory } from './memory.ts'
import { clip, overlap, paused, pending, teamStatus, updates } from './text.ts'
import type { Delivery } from './text.ts'
import type { AgentKind, GitInfo, HookDecision, Note } from './types.ts'

/** Longest time that `Stop` waits for a paused session to resume. */
export const HOLD_MS = 480_000

export const AGENT_NAMES: Record<AgentKind, string> = { copilot: 'Copilot CLI', claude: 'Claude Code' }

/** Tools that write a file. */
export const WRITE_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']

/** A line of an apply_patch text that names a file that the patch writes. */
const PATCH_PATH = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm

/** For each Memory, the last Stop reason that Tower sent to each session. Copilot sends that reason back as a prompt. */
const lastBlock = new WeakMap<Memory, Map<string, string>>()

/** The hook payload fields that Tower reads. Copilot with PascalCase events sends the same fields as Claude Code. */
export interface HookPayload {
  hook_event_name: string
  session_id: string
  cwd: string
  prompt?: string
  tool_name?: string
  /** An object from Claude Code. An apply_patch text from the Copilot `Edit` tool. */
  tool_input?: Record<string, unknown> | string
}

/** The paths that one tool call writes, as the agent sends them. */
export function writePaths(payload: HookPayload): string[] {
  if (!WRITE_TOOLS.includes(payload.tool_name ?? '')) return []
  const input = payload.tool_input
  if (typeof input === 'string') return [...input.matchAll(PATCH_PATH)].map((m) => m[1].trim())
  const path = input?.file_path ?? input?.path ?? input?.notebook_path
  return typeof path === 'string' ? [path] : []
}

export interface HookRequest {
  agent: AgentKind
  /** Member email from `TOWER_MEMBER`. */
  member: string
  payload: HookPayload
  git?: GitInfo
}

export interface HookOptions {
  /** Completes when the master agent has no round to run. */
  settled: () => Promise<void>
  holdMs: number
  /** Gets the git data of each PostToolUse after `observe`. It must not wait for slow work. */
  observed?: (session: string, git: GitInfo) => void
}

/**
 * Applies one hook event to Memory and returns what the agent gets (spec §7.2 and §7.4).
 * `signal` aborts when the request ends before the response. Then a `Stop` hold ends and takes no notes.
 */
export async function handleHook(
  memory: Memory,
  req: HookRequest,
  opts: HookOptions,
  signal?: AbortSignal,
): Promise<HookDecision> {
  const { payload, git } = req
  const id = payload.session_id
  memory.register({
    id,
    agent: AGENT_NAMES[req.agent],
    member: req.member,
    ...(git && { repo: git.repo, root: git.root, base: git.base, main: git.main }),
  })
  switch (payload.hook_event_name) {
    case 'SessionStart':
      return { context: teamStatus(memory.snapshot(), id) }
    case 'UserPromptSubmit': {
      const prompt = payload.prompt ?? ''
      const sent = lastBlock.get(memory)
      const echo = sent?.get(id)?.trim() === prompt.trim()
      sent?.delete(id)
      // A new prompt does not end a pause. Only a decision ends it.
      if (!memory.pausedBy(id)) memory.setStatus(id, 'working')
      // The Stop reason that Copilot sends back is not a task.
      if (echo) return {}
      const issue = /#(\d+)/.exec(prompt)
      memory.addTask({ session: id, summary: prompt, issue: issue ? Number(issue[1]) : undefined })
      return {}
    }
    case 'PreToolUse':
      return preToolUse(memory, id, payload)
    case 'PostToolUse': {
      if (git) {
        memory.observe(id, git)
        opts.observed?.(id, git)
      }
      const notes = memory.takeNotes(id, false)
      const context = send(memory, notes, updates(memory.readEvents(id), notes))
      return context === undefined ? {} : { context }
    }
    case 'Stop':
      return stop(memory, id, opts, signal)
    default:
      return {}
  }
}

function preToolUse(memory: Memory, id: string, payload: HookPayload): HookDecision {
  const pause = memory.pausedBy(id)
  if (pause) {
    const author = pause.author as string
    const name = memory.memberByGithub(author)?.name ?? author
    return { deny: paused(pause.question as string, name, pause.channel as string) }
  }
  const notes = memory.takeNotes(id, true)
  if (notes.length) return { deny: send(memory, notes, pending(notes)) }

  const self = memory.session(id)
  if (!self?.root || !self.repo) return {}
  const root = self.root
  // Compare repo-relative paths, because agents send absolute or relative paths.
  const paths = writePaths(payload)
    .map((target) => relative(root, resolve(payload.cwd, target)))
    .filter((path) => path !== '..' && !path.startsWith(`..${sep}`))
  if (!paths.length) return {}

  const diffs = memory.diffs()
  // The session that changed a file first has priority (spec §7.4 step 5). A file in its own diff is not a new overlap.
  const own = diffs.find((d) => d.session === id)?.files ?? []
  for (const diff of diffs) {
    const owner = memory.session(diff.session)
    if (!owner || owner.id === id || owner.repo !== self.repo) continue
    // An old session in the same clone is not another person.
    if (owner.member === self.member && owner.root === self.root) continue
    const shared = paths.filter((path) => diff.files.includes(path) && !own.includes(path))
    if (!shared.length || memory.seen(id, owner.id) >= diff.version) continue
    memory.markSeen(id, owner.id, diff.version)
    for (const path of shared) memory.trackOverlap(id, owner.id, path)
    const name = memory.member(owner.member)?.name ?? owner.member
    return { deny: clip(shared.map((path) => overlap(name, owner.agent, path, filePatch(diff.patch, path))).join('\n')) }
  }
  return {}
}

async function stop(memory: Memory, id: string, opts: HookOptions, signal?: AbortSignal): Promise<HookDecision> {
  if (!memory.pausedBy(id)) memory.setStatus(id, 'idle')
  await opts.settled()
  // When the request ended, the notes stay for the next Stop or PreToolUse.
  if (signal?.aborted) return {}
  if (memory.pausedBy(id) && !(await resumed(memory, id, opts.holdMs, signal))) return {}
  if (signal?.aborted) return {}
  const notes = [...memory.takeNotes(id, true), ...memory.takeNotes(id, false)]
  if (!notes.length) return {}
  const block = send(memory, notes, pending(notes))
  memory.setStatus(id, 'working')
  lastBlock.getOrInsertComputed(memory, () => new Map()).set(id, block)
  return { block }
}

/** Waits until no conflict pauses `session`. False when `holdMs` ends first or `signal` aborts. */
function resumed(memory: Memory, session: string, holdMs: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((done) => {
    const finish = (ok: boolean) => {
      clearTimeout(timer)
      unsubscribe()
      signal?.removeEventListener('abort', end)
      done(ok)
    }
    const end = () => finish(false)
    const unsubscribe = memory.onChange(() => {
      if (!memory.pausedBy(session)) finish(true)
    })
    const timer = setTimeout(end, holdMs)
    signal?.addEventListener('abort', end)
  })
}

/** Returns the text of `delivery`. The `taken` notes that are not in the text become pending again. */
function send<T>(memory: Memory, taken: Note[], delivery: Delivery<T>): T {
  memory.undeliver(taken.filter((n) => !delivery.sent.includes(n)).map((n) => n.id))
  return delivery.text
}

/** The hook endpoint: `POST /hook` with a HookRequest. Other requests get 404. */
export function createServer(memory: Memory, opts: HookOptions): Server {
  return createHttpServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/hook') {
      res.writeHead(404).end()
      return
    }
    let body: HookRequest
    try {
      body = (await json(req)) as HookRequest
    } catch {
      res.writeHead(400).end()
      return
    }
    // The agent can end the hook before Tower answers, for example when the user presses Esc.
    const ended = new AbortController()
    res.on('close', () => {
      if (!res.writableFinished) ended.abort()
    })
    try {
      const decision = await handleHook(memory, body, opts, ended.signal)
      if (ended.signal.aborted) return
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(decision))
    } catch (error) {
      console.error(error)
      res.writeHead(500).end()
    }
  })
}
