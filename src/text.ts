import { STAGE_LABELS } from './types.ts'
import type { Note, Snapshot, TowerEvent } from './types.ts'

/** Largest text, in UTF-8 bytes, that Tower sends to an agent. */
export const MAX_TEXT = 9000

/** ASCII only, so its length is its size in bytes. */
const CLIPPED = '\n[Tower clipped this text.]'
const encoder = new TextEncoder()
/** Slack reads these characters as control sequences in mrkdwn. */
const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }

/** Keep `text` within MAX_TEXT bytes. Cut at a character boundary and mark the cut. */
export function clip(text: string): string {
  if (encoder.encodeInto(text, new Uint8Array(MAX_TEXT)).read === text.length) return text
  const { read } = encoder.encodeInto(text, new Uint8Array(MAX_TEXT - CLIPPED.length))
  return text.slice(0, read) + CLIPPED
}

/** Escapes `raw` for Slack mrkdwn. When the result has more than `max` characters, Tower cuts it and adds `…`. */
export function mrkdwn(raw: string, max = Infinity): string {
  const escape = (s: string) => s.replace(/[&<>]/g, (c) => ENTITIES[c])
  const text = escape(raw)
  if (text.length <= max) return text
  let cut = ''
  for (const char of raw) {
    const next = cut + escape(char)
    if (next.length >= max) break
    cut = next
  }
  return `${cut}…`
}

/** `<name>'s agent (<agent>)`. `name` is the member name and `agent` is the display name, for example `Copilot CLI`. */
export function who(name: string, agent: string): string {
  return `${name}'s agent (${agent})`
}

/** Deny reason for a write to a file in another session's diff (spec §7.4). `diff` is their patch for `path`. */
export function overlap(owner: string, agent: string, path: string, diff: string): string {
  return clip(`${who(owner, agent)} changed ${path} in their working copy. Their diff is below.
Do not edit the lines in their diff.
Use their change as the base for your change. Their change will merge into main.
Then continue your task.
${diff}`)
}

/** Deny reason while a session is paused (spec §7.6). `author` is the spec author's name. `channel` has no `#`. */
export function paused(question: string, author: string, channel: string): string {
  return clip(`Tower paused this session.
Open question: ${question}
${author} decides in Slack channel #${channel}.
End your turn now. Tower starts your next turn with the decision.`)
}

/** Stop reason after a decision, without pending notes (spec §7.6). `author` is the spec author's name. */
export function resume(issue: number, author: string, option: string): string {
  return clip(`Decision on #${issue} by ${author}: ${option}
Apply this decision. Then continue your task.`)
}

/** GitHub issue comment that records a decision (spec §7.6). `authorGithub` is a login without `@`. */
export function decisionComment(option: string, authorGithub: string): string {
  return clip(`Decision: ${option}
@${authorGithub} decided this in Slack. Tower recorded this decision.`)
}

/** Tower note to one session (spec §7.5). */
export function note(summary: string, instruction: string): string {
  return clip(`Tower note: ${summary}
Do this: ${instruction}`)
}

/** SessionStart context: the other sessions, the open conflicts, and the decisions. `viewer` is the reader's session id. */
export function teamStatus(s: Snapshot, viewer: string): string {
  const sessions = s.sessions.filter((v) => v.id !== viewer)
  const open = s.conflicts.filter((c) => c.status === 'open')
  if (!sessions.length && !open.length) return clip('Tower: no other agents are active.')
  const name = (github: string) => s.members.find((m) => m.github === github)?.name ?? github
  return clip(
    [
      'Tower: team status.',
      ...sessions.map((v) => {
        const task = v.task?.summary.trim().replace(/\.$/, '') ?? 'no task'
        return `- ${who(v.name, v.agent)}, ${v.status}: ${task}. Files: ${v.files.join(', ') || 'none'}.`
      }),
      ...open.map((c) => `- Conflict #${c.id} (${STAGE_LABELS[c.stage]}, ${c.impact} impact): ${c.summary}`),
      ...s.decisions.map((d) => `- Decision on #${d.issue} by ${name(d.author)}: ${d.option}`),
    ].join('\n'),
  )
}

/** A text that Tower sends to an agent, and the notes in that text. Tower sends the other notes later. */
export interface Delivery<T> {
  text: T
  sent: Note[]
}

/** The start of the resume text and of each decision note (spec §7.6). */
const DECISION = /^Decision on #\d+ by /

/**
 * The notes, in order, that fit in one text after the `head` lines. Decisions come first (spec §7.6).
 * The notes leave space for the clip mark, so `clip` cuts only the lines after them.
 * The first note always fits: `clip` cuts it when it is too long.
 */
function fit(notes: Note[], head: string[]): Note[] {
  const decisions = notes.filter((n) => DECISION.test(n.text))
  let size = CLIPPED.length + encoder.encode(head.join('\n')).length
  const sent: Note[] = []
  for (const n of [...decisions, ...notes.filter((n) => !decisions.includes(n))]) {
    size += encoder.encode(n.text).length + (sent.length || head.length ? 1 : 0)
    if (sent.length && size > MAX_TEXT) break
    sent.push(n)
  }
  return sent
}

/** Stop reason or deny reason with pending notes: the decision, then the other notes (spec §7.6). */
export function pending(notes: Note[]): Delivery<string> {
  const sent = fit(notes, [])
  return { text: clip(sent.map((n) => n.text).join('\n')), sent }
}

/** PostToolUse context: the note texts, then one line per event. The text is undefined when both are empty. */
export function updates(events: TowerEvent[], notes: Note[]): Delivery<string | undefined> {
  if (!events.length && !notes.length) return { text: undefined, sent: [] }
  const head = ['Tower updates:']
  const sent = fit(notes, head)
  return { text: clip([...head, ...sent.map((n) => n.text), ...events.map((e) => `- ${e.text}`)].join('\n')), sent }
}
