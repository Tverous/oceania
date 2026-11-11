// The Oceania feed: one short line for each message that moves through Oceania.
// This module only formats. src/log.ts carries the items, and `oceania serve` prints them.
import { stripVTControlCharacters } from 'node:util'
import { lifecycle } from './text.ts'
import type { StepName } from './text.ts'
import type { Conflict, Status } from './types.ts'

/** The kind of text that one hook response sends to an agent, with the data for its feed line. */
export type Delivered =
  | { kind: 'status'; agents: { name: string; status: Status; task?: string }[]; conflicts: number }
  | { kind: 'overlap'; owner: string; files: string[] }
  | { kind: 'paused'; author: string }
  | { kind: 'note' }
  | { kind: 'resume' }
  /** A PostToolUse context. `events` are the texts of the task and push events of other agents in it. */
  | { kind: 'update'; events: string[] }

/** One message that moves through Oceania. `at` is epoch ms. Each name is a member name. */
export type FeedItem = { at: number } & (
  | { type: 'join'; name: string; agent: string }
  | { type: 'task'; name: string; summary: string }
  | { type: 'diff'; name: string; files: string[] }
  | { type: 'push'; name: string; files: string[] }
  | { type: 'stall'; name: string }
  | { type: 'conflict'; conflict: Pick<Conflict, 'id' | 'stage' | 'impact' | 'status' | 'summary' | 'history'> }
  | { type: 'ask'; author: string; channel: string; paused: string[] }
  | { type: 'decision'; author: string; issue: number; option: string }
  | { type: 'comment'; issue: number }
  /** `text` is the complete text that the agent of `session` got. */
  | ({ type: 'delivery'; session: string; to: string; text: string } & Delivered)
  | { type: 'post'; channel: string }
  | { type: 'round'; round: number; ms: number; actions: number; failed: boolean }
)

export interface LineOptions {
  /** Terminal columns. Oceania cuts the line to this width. */
  width: number
  /** ANSI colors. */
  color: boolean
}

type Style = 'bold' | 'dim' | 'cyan' | 'yellow' | 'magenta' | 'green' | 'alert'
type Part = readonly [text: string, style?: Style]

/** The parts of one line. `style` is for the full line, and then the parts have no style. */
interface Shape {
  actor: string
  parts: Part[]
  style?: Style
}

const SGR: Record<Style, string> = {
  bold: '1',
  dim: '2',
  cyan: '36',
  yellow: '33',
  magenta: '35',
  green: '32',
  alert: '1;31',
}
const STEPS: Record<StepName, Style> = { Before: 'cyan', During: 'yellow', After: 'magenta', Resolved: 'green' }
/** Columns of the actor column. `Oceania → Slack` fits. */
const ACTOR = 15
/** Characters that use two terminal columns: East Asian wide characters and emoji. */
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1f300}-\u{1faff}\u{20000}-\u{3fffd}]/u
const names = new Intl.ListFormat('en')

/** The feed line of `item`, cut to `o.width` columns. */
export function feedLine(item: FeedItem, o: LineOptions): string {
  const { actor, parts, style } = shape(item)
  const who = cut([[clean(actor)]], ACTOR)
    .map(([text]) => text)
    .join('')
  const head = `${clock(item.at)}  ${who}${' '.repeat(Math.max(0, ACTOR - width(who)))}  `
  const body = cut(
    parts.map(([text, s]) => [clean(text), s] as const),
    o.width - width(head),
  )
  const line = head + body.map(([text, s]) => (o.color && s ? paint(text, s) : text)).join('')
  return o.color && style ? paint(line, style) : line
}

function shape(item: FeedItem): Shape {
  switch (item.type) {
    case 'join':
      return agent(item.name, `● joined (${item.agent})`)
    case 'task':
      return agent(item.name, `▶ task: ${first(item.summary)}`)
    case 'diff': {
      const text = item.files.length ? `✎ changed ${item.files.join(', ')}` : '✎ has no local changes'
      return { ...agent(item.name, text), style: 'dim' }
    }
    case 'push':
      return agent(item.name, `⬆ pushed to main: ${item.files.join(', ')}`)
    case 'stall':
      return agent(item.name, '! may be stalled')
    case 'conflict': {
      // The lifecycle up to now, for example `Before → During`. Without a history, the current step.
      // Only the first line of a conflict has the summary, so the later lines are not cut.
      const c = item.conflict
      const names = lifecycle(c.history.length ? c.history : [{ ...c, at: 0 }]).map((h) => h.name)
      const steps = names.flatMap((name, i): Part[] => (i ? [[' → '], [name, STEPS[name]]] : [[name, STEPS[name]]]))
      if (c.status === 'resolved') return { actor: 'Oceania', parts: [[`✓ Conflict #${c.id} · `, 'green'], ...steps] }
      const impact: Part = c.impact === 'high' ? ['HIGH impact', 'alert'] : ['low impact']
      const summary: Part[] = names.length === 1 ? [[` · ${short(sentence(first(c.summary)))}`]] : []
      return { actor: 'Oceania', parts: [[`⚠ Conflict #${c.id} · `], ...steps, [' · '], impact, ...summary] }
    }
    case 'ask': {
      const agents = item.paused.length === 1 ? 'agent' : 'agents'
      const paused = item.paused.length ? ` · paused ${names.format(item.paused.map((n) => `${n}'s`))} ${agents}` : ''
      return { actor: 'Oceania → Slack', parts: [[`? asked ${item.author} in #${item.channel}${paused}`]] }
    }
    case 'decision':
      return { actor: item.author, parts: [[`✓ decided #${item.issue}: ${first(item.option)}`]] }
    case 'comment':
      return { actor: 'Oceania', parts: [[`✎ added the decision to issue #${item.issue}`]] }
    case 'delivery':
      return { actor: `Oceania → ${item.to}`, parts: [[delivered(item)]], style: 'bold' }
    case 'post':
      return { actor: 'Oceania → Slack', parts: [[`# posted in #${item.channel}`]] }
    case 'round': {
      const result = item.failed ? 'failed' : count(item.actions, 'action')
      return { actor: 'master agent', parts: [[`◆ round ${item.round} · ${Math.round(item.ms / 1000)} s · ${result}`]], style: 'dim' }
    }
  }
}

function delivered(d: Delivered & { text: string }): string {
  switch (d.kind) {
    case 'status': {
      const agents = d.agents.map((a) => `${a.name}'s agent, ${a.status}${a.task ? `: ${first(a.task)}` : ''}`)
      const open = d.conflicts ? ` · ${count(d.conflicts, 'open conflict')}` : ''
      return `⇢ team status: ${agents.join('; ') || 'no other agents'}${open}`
    }
    case 'overlap':
      return `⊘ blocked a write to ${d.files.join(', ')} · sent ${d.owner}'s diff`
    case 'paused':
      return `‖ paused until ${d.author} decides`
    case 'note': {
      // An Oceania note is `Oceania note: <summary>\nDo this: <instruction>` (src/text.ts).
      const [summary, instruction] = d.text.split('\nDo this: ')
      const text = first(summary.trim().replace(/^Oceania note: /, ''))
      return `✉ note: ${short(instruction === undefined ? text : `${text} ${first(instruction)}`)}`
    }
    case 'resume':
      return `▶ resumed: ${first(d.text)}`
    case 'update':
      return `⇢ update: ${d.events.map((e) => short(first(e))).join(' · ')}`
  }
}

function agent(name: string, text: string): Shape {
  return { actor: `${name}'s agent`, parts: [[text]] }
}

/** The first line of `text`. */
function first(text: string): string {
  return text.trim().split(/\r?\n/)[0].trim()
}

/** The first sentence of `text`. A period in a path, for example `src/plans.ts`, does not end a sentence. */
function sentence(text: string): string {
  return /^.+?[.!?](?=\s|$)/.exec(text)?.[0] ?? text
}

/** Removes the agent name after a member name: `Alice's agent (Copilot CLI)` becomes `Alice's agent`. */
function short(text: string): string {
  return text.replace(/'s agent \([^()\n]*\)/g, "'s agent")
}

/** Removes terminal control sequences. Other control characters, for example a tab, become a space. */
function clean(text: string): string {
  return stripVTControlCharacters(text).replace(/\p{Cc}/gu, ' ')
}

function count(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** Local time, HH:MM:SS. */
function clock(at: number): string {
  const d = new Date(at)
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':')
}

function columns(char: string): number {
  return WIDE.test(char) ? 2 : 1
}

function width(text: string): number {
  let n = 0
  for (const char of text) n += columns(char)
  return n
}

/** The parts that fit in `room` columns. A cut part ends with `…`. */
function cut(parts: readonly Part[], room: number): Part[] {
  if (parts.reduce((n, [text]) => n + width(text), 0) <= room) return [...parts]
  const kept: Part[] = []
  let left = room - 1
  for (const [text, style] of parts) {
    let fit = ''
    for (const char of text) {
      if (columns(char) > left) break
      fit += char
      left -= columns(char)
    }
    if (fit !== text) {
      kept.push([`${fit.trimEnd()}…`, style])
      return kept
    }
    kept.push([text, style])
  }
  return kept
}

function paint(text: string, style: Style): string {
  return `\u001b[${SGR[style]}m${text}\u001b[0m`
}
