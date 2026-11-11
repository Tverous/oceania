import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LogLevel } from '@slack/bolt'
import type { App } from '@slack/bolt'
import { feedLine } from '../src/feed.ts'
import type { Delivered, FeedItem } from '../src/feed.ts'
import { feed, log, logTo, onFeed } from '../src/log.ts'
import { createTools, decide, startMaster } from '../src/master.ts'
import type { Chat, Specs, Tool, Tools } from '../src/master.ts'
import { Memory } from '../src/memory.ts'
import { Shadow } from '../src/shadow.ts'
import type { ConflictStep, Impact, Stage } from '../src/types.ts'
import { slackLogger, startSlack } from '../src/slack.ts'

/** 21:03:02 local time, so that the lines do not depend on the time zone. */
const AT = new Date(2026, 10, 11, 21, 3, 2).getTime()
const PLAIN = { width: 100, color: false }
const COLOR = { width: 100, color: true }

function line(item: FeedItem, o = PLAIN): string {
  return feedLine(item, o)
}

function delivery(to: string, d: Delivered & { text: string }): FeedItem {
  return { type: 'delivery', at: AT, session: 's', to, ...d }
}

/** Collects the feed items of one test. */
function collect(t: { after(fn: () => void): void }, type?: FeedItem['type']): FeedItem[] {
  const items: FeedItem[] = []
  t.after(onFeed((item) => void (type === undefined || item.type === type ? items.push(item) : 0)))
  return items
}

/** Sends the log to a new file in a temporary folder. The result reads the file. */
function logFile(t: { after(fn: () => void): void }): () => string {
  const dir = mkdtempSync(join(tmpdir(), 'oceania-log-'))
  const file = join(dir, 'oceania.log')
  logTo(file)
  t.after(() => {
    logTo(undefined)
    rmSync(dir, { recursive: true, force: true })
  })
  return () => readFileSync(file, 'utf8')
}

test('agent events: join, task, diff, push, stall', () => {
  assert.equal(
    line({ type: 'join', at: AT, name: 'Alice', agent: 'Copilot CLI' }),
    "21:03:02  Alice's agent    ● joined (Copilot CLI)",
  )
  assert.equal(
    line({ type: 'task', at: AT, name: 'Alice', summary: '  Add a yearly price to each plan.\nIt is 10 times the monthly price.' }),
    "21:03:02  Alice's agent    ▶ task: Add a yearly price to each plan.",
  )
  assert.equal(
    line({ type: 'diff', at: AT, name: 'Alice', files: ['src/plans.ts', 'src/pricing.ts'] }),
    "21:03:02  Alice's agent    ✎ changed src/plans.ts, src/pricing.ts",
  )
  assert.equal(line({ type: 'diff', at: AT, name: 'Bob', files: [] }), "21:03:02  Bob's agent      ✎ has no local changes")
  assert.equal(
    line({ type: 'push', at: AT, name: 'Alice', files: ['src/plans.ts'] }),
    "21:03:02  Alice's agent    ⬆ pushed to main: src/plans.ts",
  )
  assert.equal(line({ type: 'stall', at: AT, name: 'Bob' }), "21:03:02  Bob's agent      ! may be stalled")
})

test('a line is cut to the width with an ellipsis', () => {
  const summary = 'Show the Pro plan from #1 on the pricing page. Use a 30-day free trial with no card.'
  const cut = line({ type: 'task', at: AT, name: 'Bob', summary })
  assert.equal(cut, "21:03:02  Bob's agent      ▶ task: Show the Pro plan from #1 on the pricing page. Use a 30-day free…")
  assert.equal(cut.length, 100)
  assert.equal(
    line({ type: 'task', at: AT, name: 'Bob', summary }, { width: 60, color: false }),
    "21:03:02  Bob's agent      ▶ task: Show the Pro plan from #…",
  )
  // A wide character uses two columns.
  assert.equal(
    line({ type: 'task', at: AT, name: 'Bob', summary: '中'.repeat(40) }),
    `21:03:02  Bob's agent      ▶ task: ${'中'.repeat(32)}…`,
  )
  // A long actor is cut to the actor column.
  assert.equal(
    line({ type: 'join', at: AT, name: 'Christopher', agent: 'Claude Code' }),
    "21:03:02  Christopher's…   ● joined (Claude Code)",
  )
  // Control characters do not go to the terminal.
  assert.equal(
    line({ type: 'task', at: AT, name: 'Bob', summary: 'Fix\tthe \u001b[31mred\u001b[0m text' }),
    "21:03:02  Bob's agent      ▶ task: Fix the red text",
  )
})

type ConflictLine = Extract<FeedItem, { type: 'conflict' }>['conflict']

/** One step of a conflict lifecycle at AT. */
function step(stage: Stage, impact: Impact = 'low', status: 'open' | 'resolved' = 'open'): ConflictStep {
  return { stage, impact, status, at: AT }
}

test('a conflict shows the first sentence of its summary, then each change of its lifecycle', () => {
  const conflict: ConflictLine = {
    id: 1,
    stage: 'before',
    impact: 'high',
    status: 'open',
    summary: 'Trial terms differ. Alice uses 14 days and Bob uses 30 days.',
    history: [step('before', 'high')],
  }
  assert.equal(
    line({ type: 'conflict', at: AT, conflict }),
    '21:03:02  Oceania          ⚠ Conflict #1 · Before · HIGH impact · Trial terms differ.',
  )
  // A change of the impact only is not a new step.
  assert.equal(
    line({ type: 'conflict', at: AT, conflict: { ...conflict, history: [step('before'), step('before', 'high')] } }),
    '21:03:02  Oceania          ⚠ Conflict #1 · Before · HIGH impact · Trial terms differ.',
  )
  assert.equal(
    line({
      type: 'conflict',
      at: AT,
      conflict: {
        ...conflict,
        id: 3,
        stage: 'during',
        impact: 'low',
        summary: "Bob's agent (Claude Code) and Alice's agent (Copilot CLI) change src/pricing.ts.\nMore text.",
        history: [step('before'), step('during')],
      },
    }),
    '21:03:02  Oceania          ⚠ Conflict #3 · Before → During · low impact',
  )
  assert.equal(
    line({
      type: 'conflict',
      at: AT,
      conflict: { ...conflict, stage: 'after', status: 'resolved', history: [step('before'), step('during'), step('after'), step('after', 'low', 'resolved')] },
    }),
    '21:03:02  Oceania          ✓ Conflict #1 · Before → During → After → Resolved',
  )
  // Without a history, the line shows the current stage.
  assert.equal(
    line({ type: 'conflict', at: AT, conflict: { ...conflict, stage: 'after', history: [] } }),
    '21:03:02  Oceania          ⚠ Conflict #1 · After · HIGH impact · Trial terms differ.',
  )
  assert.equal(
    line({ type: 'conflict', at: AT, conflict: { ...conflict, status: 'resolved', history: [] } }),
    '21:03:02  Oceania          ✓ Conflict #1 · Resolved',
  )
})

test('Slack, the decision, and the GitHub comment', () => {
  assert.equal(
    line({ type: 'ask', at: AT, author: 'Tverous', channel: 'oceania-1-mwc365v2', paused: ['Alice', 'Bob'] }),
    "21:03:02  Oceania → Slack  ? asked Tverous in #oceania-1-mwc365v2 · paused Alice's and Bob's agents",
  )
  assert.equal(
    line({ type: 'ask', at: AT, author: 'Tverous', channel: 'oceania-1-x', paused: ['Bob'] }),
    "21:03:02  Oceania → Slack  ? asked Tverous in #oceania-1-x · paused Bob's agent",
  )
  assert.equal(
    line({ type: 'decision', at: AT, author: 'Tverous', issue: 1, option: '30 days, no card' }),
    '21:03:02  Tverous          ✓ decided #1: 30 days, no card',
  )
  assert.equal(line({ type: 'comment', at: AT, issue: 1 }), '21:03:02  Oceania          ✎ added the decision to issue #1')
  assert.equal(
    line({ type: 'post', at: AT, channel: 'oceania-activity' }),
    '21:03:02  Oceania → Slack  # posted in #oceania-activity',
  )
})

test('deliveries: team status, overlap, pause, note, resume', () => {
  assert.equal(
    line(delivery('Bob', { kind: 'status', text: 'Oceania: team status.', agents: [], conflicts: 0 })),
    '21:03:02  Oceania → Bob    ⇢ team status: no other agents',
  )
  assert.equal(
    line(
      delivery('Bob', {
        kind: 'status',
        text: 'Oceania: team status.',
        agents: [
          { name: 'Alice', status: 'working', task: 'Add the Pro plan.\nMore.' },
          { name: 'Carol', status: 'idle' },
        ],
        conflicts: 1,
      }),
    ),
    "21:03:02  Oceania → Bob    ⇢ team status: Alice's agent, working: Add the Pro plan.; Carol's agent,…",
  )
  assert.equal(
    line(delivery('Bob', { kind: 'status', text: '', agents: [{ name: 'Alice', status: 'paused' }], conflicts: 2 })),
    "21:03:02  Oceania → Bob    ⇢ team status: Alice's agent, paused · 2 open conflicts",
  )
  assert.equal(
    line(delivery('Bob', { kind: 'overlap', text: 'diff', owner: 'Alice', files: ['src/pricing.ts'] })),
    "21:03:02  Oceania → Bob    ⊘ blocked a write to src/pricing.ts · sent Alice's diff",
  )
  assert.equal(
    line(delivery('Bob', { kind: 'paused', text: 'Oceania paused this session.', author: 'Tverous' })),
    '21:03:02  Oceania → Bob    ‖ paused until Tverous decides',
  )
  assert.equal(
    line(
      delivery('Bob', {
        kind: 'note',
        text: "Oceania note: Alice's agent (Copilot CLI) already adds the Pro plan.\nDo this: Use her plan data.",
      }),
    ),
    "21:03:02  Oceania → Bob    ✉ note: Alice's agent already adds the Pro plan. Use her plan data.",
  )
  assert.equal(
    line(delivery('Bob', { kind: 'note', text: 'Decision on #1 by Tverous: 30 days, no card\nApply this decision.' })),
    '21:03:02  Oceania → Bob    ✉ note: Decision on #1 by Tverous: 30 days, no card',
  )
  assert.equal(
    line(
      delivery('Alice', {
        kind: 'resume',
        text: 'Decision on #1 by Tverous: 30 days, no card\nApply this decision. Then continue your task.',
      }),
    ),
    '21:03:02  Oceania → Alice  ▶ resumed: Decision on #1 by Tverous: 30 days, no card',
  )
  assert.equal(
    line(
      delivery('Bob', {
        kind: 'update',
        text: 'Oceania updates:\n- …',
        events: ["Alice's agent (Copilot CLI) task: Add a yearly price to each plan.\nMore."],
      }),
    ),
    "21:03:02  Oceania → Bob    ⇢ update: Alice's agent task: Add a yearly price to each plan.",
  )
  assert.equal(
    line(
      delivery('Alice', {
        kind: 'update',
        text: 'Oceania updates:\n- …',
        events: ["Bob's agent (Claude Code) pushed to main: src/pricing.ts", "Bob's agent (Claude Code) task: Mark Pro."],
      }),
      { width: 120, color: false },
    ),
    "21:03:02  Oceania → Alice  ⇢ update: Bob's agent pushed to main: src/pricing.ts · Bob's agent task: Mark Pro.",
  )
})

test('judge rounds', () => {
  const round = { type: 'round', at: AT, round: 3, ms: 19_600, actions: 2, failed: false } as const
  assert.equal(line(round), '21:03:02  master agent     ◆ round 3 · 20 s · 2 actions')
  assert.equal(line({ ...round, actions: 1 }), '21:03:02  master agent     ◆ round 3 · 20 s · 1 action')
  assert.equal(line({ ...round, ms: 120_000, failed: true }), '21:03:02  master agent     ◆ round 3 · 120 s · failed')
})

test('colors: stages, high impact, deliveries, diffs, and rounds', () => {
  const conflict: ConflictLine = {
    id: 1,
    stage: 'before',
    impact: 'high',
    status: 'open',
    summary: 'Trial terms differ.',
    history: [step('before', 'high')],
  }
  const head = '21:03:02  Oceania          '
  const [before, during, after] = ['\u001b[36mBefore\u001b[0m', '\u001b[33mDuring\u001b[0m', '\u001b[35mAfter\u001b[0m']
  assert.equal(
    line({ type: 'conflict', at: AT, conflict }, COLOR),
    `${head}⚠ Conflict #1 · ${before} · \u001b[1;31mHIGH impact\u001b[0m · Trial terms differ.`,
  )
  assert.equal(
    line({ type: 'conflict', at: AT, conflict: { ...conflict, stage: 'during', impact: 'low', history: [step('during')] } }, COLOR),
    `${head}⚠ Conflict #1 · ${during} · low impact · Trial terms differ.`,
  )
  assert.equal(
    line(
      {
        type: 'conflict',
        at: AT,
        conflict: { ...conflict, stage: 'after', impact: 'low', history: [step('before'), step('during'), step('after')] },
      },
      COLOR,
    ),
    `${head}⚠ Conflict #1 · ${before} → ${during} → ${after} · low impact`,
  )
  assert.equal(
    line(
      {
        type: 'conflict',
        at: AT,
        conflict: { ...conflict, status: 'resolved', history: [step('before', 'high'), step('before', 'high', 'resolved')] },
      },
      COLOR,
    ),
    `${head}\u001b[32m✓ Conflict #1 · \u001b[0m${before} → \u001b[32mResolved\u001b[0m`,
  )
  assert.equal(
    line(delivery('Bob', { kind: 'paused', text: '', author: 'Tverous' }), COLOR),
    '\u001b[1m21:03:02  Oceania → Bob    ‖ paused until Tverous decides\u001b[0m',
  )
  assert.equal(
    line({ type: 'diff', at: AT, name: 'Bob', files: ['src/pricing.ts'] }, COLOR),
    "\u001b[2m21:03:02  Bob's agent      ✎ changed src/pricing.ts\u001b[0m",
  )
  assert.equal(
    line({ type: 'round', at: AT, round: 1, ms: 2_000, actions: 0, failed: false }, COLOR),
    '\u001b[2m21:03:02  master agent     ◆ round 1 · 2 s · 0 actions\u001b[0m',
  )
  // A cut keeps the colors of the parts that stay.
  assert.equal(
    line({ type: 'conflict', at: AT, conflict }, { width: 47, color: true }),
    `${head}⚠ Conflict #1 · \u001b[36mBef…\u001b[0m`,
  )
})

test('log writes to stderr by default, and to the log file after logTo', (t) => {
  const error = t.mock.method(console, 'error', () => {})
  log('Oceania: no log file.', 1)
  assert.deepEqual(error.mock.calls[0].arguments, ['Oceania: no log file.', 1])
  const read = logFile(t)
  log('Oceania: the judge round failed.', new Error('The model is down.'))
  log('Slack [WARN]', 'already_in_channel')
  const text = read()
  assert.match(text, /^\d{4}-\d\d-\d\dT[\d:.]+Z Oceania: the judge round failed\. Error: The model is down\.\n {4}at /)
  assert.match(text, /Z Slack \[WARN\] already_in_channel\n$/)
  assert.equal(error.mock.callCount(), 1)
})

test('feed gives each item to each subscriber, and a failed subscriber does not stop it', (t) => {
  const error = t.mock.method(console, 'error', () => {})
  const item: FeedItem = { type: 'stall', at: AT, name: 'Bob' }
  const got: FeedItem[] = []
  const offBad = onFeed(() => {
    throw new Error('The terminal is closed.')
  })
  const off = onFeed((i) => void got.push(i))
  assert.doesNotThrow(() => feed(item))
  assert.deepEqual(got, [item])
  assert.equal(error.mock.callCount(), 1)
  off()
  offBad()
  feed(item)
  assert.deepEqual(got, [item])
})

test('the Slack logger writes Bolt logs to the log, from INFO by default', (t) => {
  const read = logFile(t)
  const logger = slackLogger()
  logger.warn('already_in_channel')
  logger.debug('ping')
  assert.equal(logger.getLevel(), LogLevel.INFO)
  logger.setLevel(LogLevel.DEBUG)
  logger.debug('pong')
  const text = read()
  assert.match(text, /Slack \[WARN\] already_in_channel\n/)
  assert.match(text, /Slack \[DEBUG\] pong\n/)
  assert.doesNotMatch(text, /ping/)
})

function setup(): Memory {
  const m = new Memory(':memory:')
  m.upsertMember({ email: 'alice@example.com', name: 'Alice', slackId: 'U_ALICE' })
  m.upsertMember({ email: 'bob@example.com', name: 'Bob', slackId: 'U_BOB' })
  m.upsertMember({ email: 'tverous@example.com', name: 'Tverous', github: 'Tverous', slackId: 'U_TVEROUS' })
  m.register({ id: 'a', agent: 'Copilot CLI', member: 'alice@example.com' })
  m.register({ id: 'b', agent: 'Claude Code', member: 'bob@example.com' })
  return m
}

function fakeSpecs(fail = false): Specs {
  return {
    async get(issue) {
      return { issue, title: 'Pro plan', body: 'Launch a Pro plan with a free trial.', author: 'Tverous', decisions: [] }
    },
    async comment() {
      if (fail) throw new Error('GitHub is down.')
    },
  }
}

test('startMaster feeds one line for each judge round, with the count of actions', async (t) => {
  t.mock.method(console, 'error', () => {})
  const rounds = collect(t, 'round')
  const m = setup()
  const ok: Tool = { description: '', schema: {}, run: async () => 'ok' }
  const failing: Tool = {
    ...ok,
    run: async () => {
      throw new Error('Slack is down.')
    },
  }
  // Only the tools that change Memory or tell people count. The merge and test checks only examine.
  const tools: Tools = {
    read_memory: ok,
    get_spec: ok,
    check_merge: ok,
    run_in_worktree: ok,
    track_conflict: ok,
    notify: ok,
    escalate: failing,
  }
  let calls = 0
  const master = startMaster(
    m,
    tools,
    async (_prompt, given) => {
      calls++
      if (calls === 2) throw new Error('The model is down.')
      for (const name of ['read_memory', 'get_spec', 'check_merge', 'run_in_worktree', 'track_conflict', 'notify', 'notify']) {
        await given[name].run({})
      }
      await given.escalate.run({}).catch(() => {})
    },
    10,
  )
  t.after(() => master.stop())
  m.addTask({ session: 'a', summary: 'Add the Pro plan', issue: 1 })
  await master.settled()
  m.addTask({ session: 'b', summary: 'Show the Pro plan', issue: 1 })
  await master.settled()
  assert.deepEqual(
    rounds.map((r) => r.type === 'round' && [r.round, r.actions, r.failed, typeof r.ms]),
    [
      [1, 3, false, 'number'],
      [2, 0, true, 'number'],
    ],
  )
})

test('escalate feeds the Slack question, and decide feeds the GitHub comment', async (t) => {
  t.mock.method(console, 'error', () => {})
  const items = collect(t)
  const m = setup()
  const chat: Chat = { async post() {}, async openConflict() {} }
  const tools = createTools(m, chat, fakeSpecs(), new Shadow(join(tmpdir(), 'oceania-unused-shadow')))
  const id = m.trackConflict({
    sessions: ['a', 'b'],
    summary: 'Trial terms differ.',
    stage: 'before',
    impact: 'high',
    status: 'open',
    issue: 1,
  })
  await tools.escalate.run({ conflict: id, question: 'Which trial?', options: ['14 days, card required', '30 days, no card'] })
  const channel = m.conflict(id)?.channel as string
  assert.deepEqual(items, [{ type: 'ask', at: items[0]?.at, author: 'Tverous', channel, paused: ['Alice', 'Bob'] }])

  await decide(m, fakeSpecs(), channel, 1, 'U_TVEROUS')
  assert.deepEqual(items.slice(1), [{ type: 'comment', at: items[1]?.at, issue: 1 }])

  // A failed comment feeds nothing.
  const other = m.trackConflict({ sessions: ['a'], summary: 'S', stage: 'before', impact: 'high', status: 'open', issue: 2 })
  m.escalate(other, { channel: 'oceania-2-x', author: 'Tverous', question: 'Q', options: ['x', 'y'] })
  await decide(m, fakeSpecs(true), 'oceania-2-x', 0, 'U_TVEROUS')
  assert.equal(items.length, 2)
})

test('the Slack post feeds a line', async (t) => {
  const posts = collect(t, 'post')
  const ok = async () => ({ ok: true })
  const app = {
    client: {
      conversations: { create: async () => ({ ok: true, channel: { id: 'C1' } }), list: ok, join: ok, invite: ok },
      users: { lookupByEmail: ok },
      chat: { postMessage: ok },
      views: { publish: ok },
    },
    event: () => {},
    action: () => {},
    start: async () => {},
  } as unknown as App
  const chat = await startSlack(new Memory(':memory:'), fakeSpecs(), { bot: 'x', app: 'y' }, app)
  await chat.post('Conflict #2: Bob uses the plan data of Alice.')
  assert.deepEqual(
    posts.map((p) => p.type === 'post' && p.channel),
    ['oceania-activity'],
  )
})
