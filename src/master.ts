import { z } from 'zod'
import type { ZodRawShape } from 'zod'
import type { Memory } from './memory.ts'
import { TEST_TIMEOUT_MS } from './shadow.ts'
import type { Shadow } from './shadow.ts'
import { clip, decisionComment, note, resume } from './text.ts'
import type { Conflict, EventKind, Spec, TowerEvent } from './types.ts'

/** Wait after a change in Memory before a round, so that one round handles a batch of events. */
export const DEBOUNCE_MS = 1_500
/** Longest wait of `settled()`. */
export const SETTLE_MS = 90_000
/** Longest judge round. Then Tower stops the round, so that a stuck tool call does not block the next rounds. */
export const ROUND_MS = 120_000
/** Interval of the deterministic check (spec §7.4). */
export const RESYNC_MS = 60_000
/** A working session without an event for this time may be stalled. */
export const STALL_MS = 600_000
/** How many of the last pushes and posts read_memory returns. */
const LAST_PUSHES = 5
const LAST_POSTS = 20

/** Only events that agents write start a round (spec §7.4). */
const TRIGGERS: EventKind[] = ['task', 'diff', 'push']
/** Longest Slack button text. */
const MAX_OPTION = 75

export interface Chat {
  /** Posts to the shared channel. */
  post(text: string): Promise<void>
  /** Creates `c.channel`, invites the owners and the spec author, and posts the question. */
  openConflict(c: Conflict): Promise<void>
}

export interface Specs {
  get(issue: number): Promise<Spec>
  comment(issue: number, body: string): Promise<void>
}

export interface Tool<S extends ZodRawShape = ZodRawShape> {
  description: string
  schema: S
  run(args: z.infer<z.ZodObject<S>>): Promise<string>
}

export type Tools = Record<string, Tool>

/** Infers the type of `run` arguments from `schema`. */
function define<S extends ZodRawShape>(t: Tool<S>): Tool<S> {
  return t
}

const session = z.string().describe('Session id from read_memory.')

export function createTools(memory: Memory, chat: Chat, specs: Specs, shadow: Shadow): Tools {
  const need = (id: string) => {
    if (!memory.session(id)) throw new Error(`Session ${id} does not exist. Use a session id from read_memory.`)
  }
  return {
    read_memory: define({
      description:
        'Read Tower Memory: members, sessions, tasks, diffs, main, conflicts, notes, decisions, and the last 200 events. ' +
        `pushes: the last ${LAST_PUSHES} pushes, with the changes that reached main. ` +
        `posts: the last ${LAST_POSTS} summaries that you posted with post_activity.`,
      schema: {},
      async run() {
        const diffs = memory.diffs().map((d) => ({ ...d, patch: clip(d.patch) }))
        const pushes = memory
          .pushes()
          .slice(-LAST_PUSHES)
          .map((p) => ({ ...p, patch: clip(p.patch) }))
        const posts = memory.posts().slice(-LAST_POSTS)
        const events = memory.eventsAfter(memory.lastEventId() - 200)
        return JSON.stringify({ ...memory.snapshot(), diffs, pushes, notes: memory.notes(), posts, events })
      },
    }),
    get_spec: define({
      description: 'Read a spec issue from GitHub and the decisions that it records.',
      schema: { issue: z.number().int().describe('Issue number.') },
      async run({ issue }) {
        return JSON.stringify(await specs.get(issue))
      },
    }),
    track_conflict: define({
      description:
        'Create a conflict record, or update the conflict record that has this id. ' +
        'When you update a conflict and do not give files or issue, they stay the same.',
      schema: {
        id: z.number().int().optional().describe('Conflict id. Give it only to update a conflict.'),
        sessions: z.array(session).min(1),
        files: z.array(z.string()).optional().describe('Repo paths of the files in the conflict.'),
        summary: z.string(),
        stage: z.enum(['before', 'during', 'after']),
        impact: z.enum(['low', 'high']),
        status: z.enum(['open', 'resolved']),
        issue: z.number().int().optional().describe('The spec issue of the conflict.'),
      },
      async run(c) {
        c.sessions.forEach(need)
        return `Conflict #${memory.trackConflict(c)}`
      },
    }),
    notify: define({
      description:
        'Write a Tower note to one session. Tower gives the note to the agent at its next tool call. ' +
        'A blocking note stops that tool call and shows the note.',
      schema: {
        session,
        summary: z.string().describe('What the other agent does, or what changed.'),
        instruction: z.string().describe('What this agent must do.'),
        blocking: z.boolean(),
      },
      async run({ session, summary, instruction, blocking }) {
        need(session)
        memory.addNote(session, note(summary, instruction), blocking)
        return `Tower wrote a note to session ${session}.`
      },
    }),
    post_activity: define({
      description: 'Post a summary to the shared Slack channel.',
      schema: { text: z.string() },
      async run({ text }) {
        await chat.post(text)
        memory.addPost(text)
        return 'Tower posted the summary.'
      },
    }),
    escalate: define({
      description:
        'Give a high impact conflict to the spec author. Tower opens a Slack channel with the question ' +
        'and one button for each option. Then Tower pauses the sessions in the conflict.',
      schema: {
        conflict: z.number().int().describe('Conflict id. The conflict must have an issue.'),
        question: z.string(),
        options: z.array(z.string().max(MAX_OPTION)).min(2).max(3),
      },
      async run({ conflict: id, question, options }) {
        const conflict = memory.conflict(id)
        if (!conflict) throw new Error(`Conflict #${id} does not exist.`)
        if (conflict.issue === undefined) {
          throw new Error(`Conflict #${id} has no issue. Use track_conflict to add the issue.`)
        }
        if (conflict.channel) throw new Error(`Conflict #${id} is already in #${conflict.channel}.`)
        const { author } = await specs.get(conflict.issue)
        const member = memory.memberByGithub(author)
        if (!member) throw new Error(`The spec author ${author} is not a Tower member.`)
        if (!member.slackId) throw new Error(`The spec author ${member.name} has no Slack user.`)
        const channel = `tower-${conflict.issue}-${Date.now().toString(36)}`
        await chat.openConflict({ ...conflict, channel, author, question, options })
        memory.escalate(id, { channel, author, question, options })
        return `Opened #${channel}`
      },
    }),
    check_merge: define({
      description:
        'Merge the diffs of two sessions in the same repo with git merge-tree. ' +
        'The result tells if the diffs merge, or which files conflict. No work tree changes.',
      schema: { a: session, b: session },
      async run({ a, b }) {
        need(a)
        need(b)
        const result = await shadow.merge(a, b)
        if (result.status === 'missing') return `Session ${result.session} has no shadow ref yet.`
        if (result.status === 'clean') return `The diffs of sessions ${a} and ${b} merge with no conflicts.`
        return `The diffs of sessions ${a} and ${b} conflict in: ${result.files.join(', ')}`
      },
    }),
    run_in_worktree: define({
      description:
        'Merge the diffs of two sessions in the same repo. Then run npm test on the merged code in a temporary ' +
        'git worktree. Use it to find a change in one diff that breaks the code in the other diff. ' +
        `Tower stops the tests after ${TEST_TIMEOUT_MS / 1000} seconds.`,
      schema: { a: session, b: session },
      async run({ a, b }) {
        need(a)
        need(b)
        const result = await shadow.test(a, b)
        const merged = `the merged diffs of sessions ${a} and ${b}`
        switch (result.status) {
          case 'missing':
            return `Session ${result.session} has no shadow ref yet.`
          case 'conflict':
            return `The diffs of sessions ${a} and ${b} conflict in: ${result.files.join(', ')}. Tower did not run the tests.`
          case 'untested':
            return 'The repo has no test command: package.json has no "test" script. Tower did not run tests.'
          case 'passed':
            return `npm test passed on ${merged}.`
          case 'failed':
            return clip(`npm test failed on ${merged}. The output is below.\n${result.output}`)
          case 'timeout':
            return clip(
              `npm test did not stop in ${TEST_TIMEOUT_MS / 1000} seconds on ${merged}. ` +
                `Tower stopped it. The output is below.\n${result.output}`,
            )
        }
      },
    }),
  }
}

/** The prompt of one round: the events after the last round. */
export function roundPrompt(events: TowerEvent[]): string {
  return [
    'Tower events after the last round:',
    ...events.map((e) => `- [${e.kind}${e.session ? `, session ${e.session}` : ''}] ${e.text}`),
    'Read Memory. Then apply the rules to these events and to each open conflict.',
  ].join('\n')
}

/** One judge round. `signal` aborts when the round takes longer than `roundMs`. */
export type Judge = (prompt: string, tools: Tools, signal: AbortSignal) => Promise<void>

/**
 * Runs one judge round for each batch of agent events (spec §7.4). Starts at the latest event,
 * so old events do not start a round after a restart. At most one round runs at a time.
 * A round that takes longer than `roundMs` is aborted, and the next batch runs.
 * Each `resyncMs`, a deterministic check reports stalled sessions. A stall event does not start a round.
 */
export function startMaster(
  memory: Memory,
  tools: Tools,
  judge: Judge,
  debounceMs = DEBOUNCE_MS,
  roundMs = ROUND_MS,
  resyncMs = RESYNC_MS,
): { stop(): void; settled(): Promise<void> } {
  let cursor = memory.lastEventId()
  let timer: NodeJS.Timeout | undefined
  let running = false
  let stopped = false
  const waiters = new Set<() => void>()
  const pending = () => memory.eventsAfter(cursor).some((e) => TRIGGERS.includes(e.kind))
  const busy = () => running || (!stopped && pending())
  const release = () => {
    for (const done of [...waiters]) done()
  }

  function schedule(): void {
    if (stopped || running || timer || !pending()) return
    timer = setTimeout(round, debounceMs)
  }

  async function round(): Promise<void> {
    timer = undefined
    running = true
    const events = memory.eventsAfter(cursor)
    cursor = events.at(-1)?.id ?? cursor
    const abort = new AbortController()
    const limit = setTimeout(
      () => abort.abort(new Error(`The judge round took more than ${roundMs} ms. Tower stopped it.`)),
      roundMs,
    )
    // Tower does not wait for a judge that does not stop after the abort.
    const aborted = new Promise<never>((_, reject) => {
      abort.signal.addEventListener('abort', () => reject(abort.signal.reason), { once: true })
    })
    try {
      await Promise.race([judge(roundPrompt(events), tools, abort.signal), aborted])
    } catch (error) {
      console.error('Tower: the judge round failed.', error)
    } finally {
      clearTimeout(limit)
    }
    running = false
    schedule()
    if (!busy()) release()
  }

  const off = memory.onChange(schedule)
  const resync = setInterval(() => {
    try {
      memory.reportStalls(Date.now() - STALL_MS)
    } catch (error) {
      console.error('Tower: the resync check failed.', error)
    }
  }, resyncMs).unref()
  return {
    stop() {
      stopped = true
      off()
      clearInterval(resync)
      clearTimeout(timer)
      timer = undefined
      if (!busy()) release()
    },
    settled() {
      if (!busy()) return Promise.resolve()
      return new Promise((resolve) => {
        const done = () => {
          clearTimeout(limit)
          waiters.delete(done)
          resolve()
        }
        const limit = setTimeout(done, SETTLE_MS)
        waiters.add(done)
      })
    },
  }
}

type DecideResult = { ok: true; option: string } | { ok: false; reason: string }

/**
 * Records the click of `slackUser` on option `optionIndex` in `channel` (spec §7.6).
 * Memory first, then the GitHub comment. A failed comment does not change the decision.
 */
export async function decide(
  memory: Memory,
  specs: Specs,
  channel: string,
  optionIndex: number,
  slackUser: string,
): Promise<DecideResult> {
  const c = memory.conflictByChannel(channel)
  if (!c || c.decision !== undefined) return { ok: false, reason: 'This question already has a decision.' }
  // `escalate` sets the issue, the author, and the options together with the channel.
  const issue = c.issue as number
  const github = c.author as string
  const author = memory.memberByGithub(github)
  const name = author?.name ?? github
  if (author?.slackId !== slackUser) return { ok: false, reason: `Only ${name} can decide this question.` }
  const option = c.options?.[optionIndex]
  if (option === undefined) return { ok: false, reason: 'This option does not exist.' }
  memory.decide(channel, option, resume(issue, name, option))
  try {
    await specs.comment(issue, decisionComment(option, github))
  } catch (error) {
    console.error(`Tower: the decision comment on #${issue} failed. The decision stays.`, error)
  }
  return { ok: true, option }
}
