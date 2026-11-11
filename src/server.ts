import { createServer as createHttpServer } from 'node:http'
import type { Server } from 'node:http'
import { relative, resolve, sep } from 'node:path'
import { json } from 'node:stream/consumers'
import type { Delivered, FeedItem } from './feed.ts'
import { filePatch } from './git.ts'
import { feed, log } from './log.ts'
import type { Memory } from './memory.ts'
import { clip, overlap, paused, pending, teamStatus, updates } from './text.ts'
import type { Delivery } from './text.ts'
import type { AgentKind, Conflict, EventKind, GitInfo, HookDecision, Note, OceaniaEvent } from './types.ts'

/** Longest time that `Stop` waits for a paused session to resume. */
export const HOLD_MS = 480_000

export const AGENT_NAMES: Record<AgentKind, string> = { copilot: 'Copilot CLI', claude: 'Claude Code' }

/** Tools that write a file. */
export const WRITE_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']

/** A line of an apply_patch text that names a file that the patch writes. */
const PATCH_PATH = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm

/** For each Memory, the last Stop reason that Oceania sent to each session. Copilot sends that reason back as a prompt. */
const lastBlock = new WeakMap<Memory, Map<string, string>>()
/** For each Memory, the conflict of the last pause that the feed showed for each session. */
const shownPause = new WeakMap<Memory, Map<string, number>>()
/** The events of other agents that the feed shows when a PostToolUse context gives them to an agent. */
const NEWS: EventKind[] = ['task', 'push']

/** The hook payload fields that Oceania reads. Copilot with PascalCase events sends the same fields as Claude Code. */
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
  /** Member email from `OCEANIA_MEMBER`. */
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

/** Reports one text that Oceania sends to the agent to the feed. It never throws, and it does not change the response. */
type Tell = (told: Delivered & { text: string }) => void

/**
 * Applies one hook event to Memory and returns what the agent gets (spec §7.2 and §7.4).
 * `signal` aborts when the request ends before the response. Then a `Stop` hold ends and takes no notes.
 * Each text for the agent goes to the feed as a delivery.
 */
export async function handleHook(
  memory: Memory,
  req: HookRequest,
  opts: HookOptions,
  signal?: AbortSignal,
): Promise<HookDecision> {
  const { payload, git } = req
  const id = payload.session_id
  const tell: Tell = (told) => {
    try {
      const to = memory.member(req.member)?.name ?? req.member
      feed({ type: 'delivery', at: Date.now(), session: id, to, ...told })
    } catch (error) {
      log('Oceania: the feed report failed.', error)
    }
  }
  memory.register({
    id,
    agent: AGENT_NAMES[req.agent],
    member: req.member,
    ...(git && { repo: git.repo, root: git.root, base: git.base, main: git.main }),
  })
  switch (payload.hook_event_name) {
    case 'SessionStart': {
      const s = memory.snapshot()
      const context = teamStatus(s, id)
      const agents = s.sessions
        .filter((v) => v.id !== id)
        .map((v) => ({ name: v.name, status: v.status, task: v.task?.summary }))
      tell({ kind: 'status', text: context, agents, conflicts: s.conflicts.filter((c) => c.status === 'open').length })
      return { context }
    }
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
      return preToolUse(memory, id, payload, tell)
    case 'PostToolUse': {
      if (git) {
        memory.observe(id, git)
        opts.observed?.(id, git)
      }
      const events = memory.readEvents(id)
      const notes = memory.takeNotes(id, false)
      const context = send(memory, notes, updates(events, notes), tell)
      const news = events.filter((e) => NEWS.includes(e.kind)).map((e) => e.text)
      if (context !== undefined && news.length) tell({ kind: 'update', text: context, events: news })
      return context === undefined ? {} : { context }
    }
    case 'Stop':
      return stop(memory, id, opts, tell, signal)
    default:
      return {}
  }
}

function preToolUse(memory: Memory, id: string, payload: HookPayload, tell: Tell): HookDecision {
  const pause = memory.pausedBy(id)
  if (pause) {
    const author = pause.author as string
    const name = memory.memberByGithub(author)?.name ?? author
    const deny = paused(pause.question as string, name, pause.channel as string)
    // An agent can try several tool calls while it is paused. The feed shows the pause once.
    const shown = shownPause.getOrInsertComputed(memory, () => new Map())
    if (shown.get(id) !== pause.id) tell({ kind: 'paused', text: deny, author: name })
    shown.set(id, pause.id)
    return { deny }
  }
  const notes = memory.takeNotes(id, true)
  if (notes.length) return { deny: send(memory, notes, pending(notes), tell) }

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
    const name = memory.member(owner.member)?.name ?? owner.member
    const deny = clip(shared.map((path) => overlap(name, owner.agent, path, filePatch(diff.patch, path))).join('\n'))
    // The feed shows the blocked write first, then the conflict that it starts.
    tell({ kind: 'overlap', text: deny, owner: name, files: shared })
    for (const path of shared) memory.trackOverlap(id, owner.id, path)
    return { deny }
  }
  return {}
}

async function stop(memory: Memory, id: string, opts: HookOptions, tell: Tell, signal?: AbortSignal): Promise<HookDecision> {
  if (!memory.pausedBy(id)) memory.setStatus(id, 'idle')
  await opts.settled()
  // When the request ended, the notes stay for the next Stop or PreToolUse.
  if (signal?.aborted) return {}
  if (memory.pausedBy(id) && !(await resumed(memory, id, opts.holdMs, signal))) return {}
  if (signal?.aborted) return {}
  const notes = [...memory.takeNotes(id, true), ...memory.takeNotes(id, false)]
  if (!notes.length) return {}
  const block = send(memory, notes, pending(notes), tell, true)
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

/**
 * Returns the text of `delivery`, and tells the feed about each note in it. The `taken` notes that are not
 * in the text become pending again. A Stop `block` that starts with a decision resumes the agent.
 */
function send<T>(memory: Memory, taken: Note[], delivery: Delivery<T>, tell: Tell, block = false): T {
  memory.undeliver(taken.filter((n) => !delivery.sent.includes(n)).map((n) => n.id))
  delivery.sent.forEach((n, i) => {
    const resume = block && i === 0 && n.text.startsWith('Decision on #')
    tell({ kind: resume ? 'resume' : 'note', text: n.text })
  })
  return delivery.text
}

/**
 * Feeds each new Memory event, from the latest event at the call. Feeds each conflict when its stage, impact,
 * or status changes, also when a push moves it to after without a conflict event. The result stops it.
 * A diff is fed only when its files change. A push empties the files, so the empty diff after a push is not fed.
 */
export function reportEvents(memory: Memory): () => void {
  let last = memory.lastEventId()
  const step = (c: Conflict) => `${c.stage} ${c.impact} ${c.status}`
  const shown = new Map(memory.conflicts().map((c) => [c.id, step(c)]))
  /** The files of the last diff or push line of each session. */
  const files = new Map<string, string>()
  return memory.onChange(() => {
    try {
      for (const event of memory.eventsAfter(last)) {
        last = event.id
        const item = eventItem(memory, event)
        if (item?.type === 'diff' || item?.type === 'push') {
          const now = item.type === 'diff' ? item.files.join('\n') : ''
          const same = item.type === 'diff' && files.get(event.session as string) === now
          files.set(event.session as string, now)
          if (same) continue
        }
        if (item) feed(item)
      }
      for (const c of memory.conflicts()) {
        if (shown.get(c.id) === step(c)) continue
        shown.set(c.id, step(c))
        feed({ type: 'conflict', at: c.updated, conflict: c })
      }
    } catch (error) {
      log('Oceania: the feed report of a Memory change failed.', error)
    }
  })
}

/** The feed item of one Memory event. The conflict changes are not here: reportEvents feeds them. */
function eventItem(memory: Memory, e: OceaniaEvent): FeedItem | undefined {
  const { at } = e
  if (e.kind === 'decision') {
    const issue = /^Decision on #(\d+) /.exec(e.text)?.[1]
    const d = issue === undefined ? undefined : memory.decisions(Number(issue)).at(-1)
    if (!d) return undefined
    const author = memory.memberByGithub(d.author)?.name ?? d.author
    return { type: 'decision', at, author, issue: d.issue, option: d.option }
  }
  // The other events are of one session. The pause event of `escalate` has no session: master.ts feeds the question.
  const s = e.session === undefined ? undefined : memory.session(e.session)
  if (!s) return undefined
  const name = memory.member(s.member)?.name ?? s.member
  switch (e.kind) {
    case 'join':
      return { type: 'join', at, name, agent: s.agent }
    case 'task': {
      const summary = memory.snapshot().sessions.find((v) => v.id === s.id)?.task?.summary ?? ''
      return { type: 'task', at, name, summary }
    }
    case 'diff':
      return { type: 'diff', at, name, files: memory.diffs().find((d) => d.session === s.id)?.files ?? [] }
    case 'push':
      return { type: 'push', at, name, files: memory.pushes().findLast((p) => p.session === s.id)?.files ?? [] }
    case 'stall':
      return { type: 'stall', at, name }
    default:
      return undefined
  }
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
    // The agent can end the hook before Oceania answers, for example when the user presses Esc.
    const ended = new AbortController()
    res.on('close', () => {
      if (!res.writableFinished) ended.abort()
    })
    try {
      const decision = await handleHook(memory, body, opts, ended.signal)
      if (ended.signal.aborted) return
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(decision))
    } catch (error) {
      log('Oceania: the hook request failed.', error)
      res.writeHead(500).end()
    }
  })
}
