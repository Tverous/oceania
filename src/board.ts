import type { types } from '@slack/bolt'
import { mrkdwn, who } from './text.ts'
import { STAGE_LABELS } from './types.ts'
import type { Conflict, SessionView, Snapshot } from './types.ts'

/** Slack allows 100 blocks in a view. */
const MAX_BLOCKS = 100
/** The title, the two list titles, the divider, and one note or empty state for each list. */
const FIXED_BLOCKS = 6
/**
 * Most characters for one text from Memory. A section has three such texts and short labels,
 * so it stays within the Slack limit of 3,000 characters for one text.
 */
const FIELD = 900

/** The App Home view of the team status (spec §7.10). Open conflicts come first. Each list shows the newest items first. */
export function homeView(s: Snapshot): types.HomeView {
  const sessions = s.sessions.toReversed().toSorted(newest)
  const conflicts = s.conflicts
    .toReversed()
    .toSorted((x, y) => Number(x.status === 'resolved') - Number(y.status === 'resolved') || newest(x, y))
  const room = MAX_BLOCKS - FIXED_BLOCKS
  const conflictRoom = Math.min(conflicts.length, Math.max(room / 2, room - sessions.length))
  return {
    type: 'home',
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'Oceania: team status' } },
      section('*Agents*'),
      ...list(sessions, room - conflictRoom, 'agents', 'No agents are active.', sessionText),
      { type: 'divider' },
      section('*Conflicts*'),
      ...list(conflicts, conflictRoom, 'conflicts', 'No conflicts.', (c) => conflictText(c, s)),
    ],
  }
}

/**
 * Sorts by the minute that the board shows. Many hooks in one minute then do not change the order,
 * and Slack does not get a new board for each hook.
 */
function newest(x: { updated: number }, y: { updated: number }): number {
  return minute(y.updated) - minute(x.updated)
}

/** The start of the minute of `ms`, in epoch milliseconds. */
function minute(ms: number): number {
  return ms - (ms % 60_000)
}

/** One section for each item that fits in `room`, then a note when some items do not fit. */
function list<T>(items: T[], room: number, noun: string, empty: string, text: (item: T) => string): types.KnownBlock[] {
  if (!items.length) return [section(empty)]
  const shown: types.KnownBlock[] = items.slice(0, room).map((item) => section(text(item)))
  if (shown.length === items.length) return shown
  return [...shown, { type: 'context', elements: [{ type: 'mrkdwn', text: `Oceania shows ${shown.length} of ${items.length} ${noun}.` }] }]
}

function section(text: string): types.SectionBlock {
  return { type: 'section', text: { type: 'mrkdwn', text } }
}

function sessionText(v: SessionView): string {
  const files = v.files.map((f) => `\`${f}\``).join(', ') || 'none'
  return [
    `*${fit(who(v.name, v.agent))}*`,
    `Status: ${v.status}`,
    fit(`Task: ${v.task?.summary ?? 'none'}`),
    fit(`Files: ${files}`),
    `Updated: ${date(v.updated)}`,
  ].join('\n')
}

function conflictText(c: Conflict, s: Snapshot): string {
  const agents = c.sessions.map((id) => {
    const v = s.sessions.find((v) => v.id === id)
    return v ? who(v.name, v.agent) : id
  })
  const lines = [
    `*Conflict #${c.id}*: ${fit(c.summary)}`,
    `${STAGE_LABELS[c.stage]} · ${c.impact} impact · ${c.status}`,
    fit(`Agents: ${agents.join(', ')}`),
  ]
  if (c.decision !== undefined) lines.push(fit(`Decision: ${c.decision}`))
  else if (c.question !== undefined) lines.push(fit(`Open question: ${c.question}`))
  return lines.join('\n')
}

/**
 * Slack date: the local time of the viewer, with the ISO time as the fallback text.
 * The board shows minutes, so the time starts at the minute. The view then changes only once each minute.
 */
function date(ms: number): string {
  const start = minute(ms)
  return `<!date^${start / 1000}^{date_short_pretty} {time}|${new Date(start).toISOString()}>`
}

function fit(raw: string): string {
  return mrkdwn(raw, FIELD)
}
