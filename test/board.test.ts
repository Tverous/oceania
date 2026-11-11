import { test } from 'node:test'
import assert from 'node:assert/strict'
import { homeView } from '../src/board.ts'
import { Memory } from '../src/memory.ts'

const ALICE = 'alice@example.com'
const BOB = 'bob@example.com'
const a = { id: 'a', agent: 'Copilot CLI', member: ALICE }
const b = { id: 'b', agent: 'Claude Code', member: BOB }

function setup(): Memory {
  const m = new Memory(':memory:')
  m.upsertMember({ email: ALICE, name: 'Alice' })
  m.upsertMember({ email: BOB, name: 'Bob' })
  m.upsertMember({ email: 'tverous@example.com', name: 'Tverous', github: 'Tverous' })
  return m
}

/** Every `text` string in a Block Kit value. */
function texts(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(texts)
  if (typeof value !== 'object' || value === null) return []
  return Object.entries(value).flatMap(([k, v]) => (k === 'text' && typeof v === 'string' ? [v] : texts(v)))
}

test('homeView shows owner, agent, status, task, files, and time', () => {
  const m = setup()
  m.register(a)
  m.setStatus('a', 'working')
  m.addTask({ session: 'a', summary: 'Add the Pro plan', issue: 1 })
  m.observe('a', { files: ['src/plans.ts'], patch: 'P1', main: 'm1' })
  const s = m.snapshot()
  const view = homeView(s)
  assert.equal(view.type, 'home')
  const json = JSON.stringify(view)
  for (const text of ['Alice', 'Copilot CLI', 'working', 'Add the Pro plan', 'src/plans.ts', '<!date^']) {
    assert.ok(json.includes(text), text)
  }
  const minute = Math.floor(s.sessions[0].updated / 60_000) * 60_000
  assert.ok(json.includes(`<!date^${minute / 1000}^{date_short_pretty} {time}|${new Date(minute).toISOString()}>`))
})

test('homeView shows times to the minute, so updates in the same minute give the same view', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-11T19:40:12.345Z') })
  const m = setup()
  m.register(a)
  m.register(b)
  const first = JSON.stringify(homeView(m.snapshot()))
  const minute = Date.parse('2026-11-11T19:40:00.000Z')
  assert.ok(first.includes(`<!date^${minute / 1000}^{date_short_pretty} {time}|2026-11-11T19:40:00.000Z>`))
  // Session a is now the newest, but in the same minute. The board does not change.
  t.mock.timers.tick(30_000)
  m.register(a)
  assert.equal(JSON.stringify(homeView(m.snapshot())), first)
  t.mock.timers.tick(30_000)
  m.register(a)
  const next = JSON.stringify(homeView(m.snapshot()))
  assert.ok(next.includes('|2026-11-11T19:41:00.000Z>'))
  assert.ok(next.indexOf('Alice') < next.indexOf('Bob'), 'the newest session comes first')
})

test('homeView shows conflicts with stage and impact, open first', () => {
  const m = setup()
  m.register(a)
  m.register(b)
  m.trackConflict({
    sessions: ['a', 'b'],
    summary: 'Both agents add the Pro plan.',
    stage: 'after',
    impact: 'low',
    status: 'resolved',
  })
  m.trackConflict({
    sessions: ['a', 'b'],
    summary: 'The tasks use different trial terms.',
    stage: 'during',
    impact: 'high',
    status: 'open',
    issue: 1,
  })
  const json = JSON.stringify(homeView(m.snapshot()))
  const open = json.indexOf('The tasks use different trial terms.')
  const resolved = json.indexOf('Both agents add the Pro plan.')
  assert.ok(open >= 0 && resolved > open)
  assert.ok(json.includes('During: changes not on main'))
  assert.ok(json.includes('high impact'))
})

test('homeView shows the open question, then the decision', () => {
  const m = setup()
  m.register(a)
  m.register(b)
  const id = m.trackConflict({
    sessions: ['a', 'b'],
    summary: 'The tasks use different trial terms.',
    stage: 'before',
    impact: 'high',
    status: 'open',
    issue: 1,
  })
  m.escalate(id, {
    channel: 'oceania-1-x',
    author: 'Tverous',
    question: 'Which trial terms?',
    options: ['14 days, card required', '30 days, no card'],
  })
  assert.ok(JSON.stringify(homeView(m.snapshot())).includes('Open question: Which trial terms?'))
  m.decide('oceania-1-x', '30 days, no card', 'Apply the decision.')
  const json = JSON.stringify(homeView(m.snapshot()))
  assert.ok(json.includes('Decision: 30 days, no card'))
  assert.ok(!json.includes('Open question'))
})

test('homeView shows the lifecycle of each conflict, and steps with the same stage and status collapse', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-11T21:03:20.000Z') })
  const time = (minute: number) => {
    const iso = `2026-11-11T21:0${minute}:00.000Z`
    return `<!date^${Date.parse(iso) / 1000}^{time}|${iso}>`
  }
  const m = setup()
  m.register({ ...a, main: 'm1' })
  m.register({ ...b, main: 'm1' })
  const terms = {
    sessions: ['a', 'b'],
    files: ['src/plans.ts'],
    summary: 'The tasks use different trial terms.',
    stage: 'before' as const,
    impact: 'low' as const,
    status: 'open' as const,
    issue: 1,
  }
  const high = m.trackConflict(terms)
  const page = {
    sessions: ['a', 'b'],
    files: ['src/pricing.ts'],
    summary: 'Both tasks change the pricing page.',
    stage: 'before' as const,
    impact: 'low' as const,
    status: 'open' as const,
  }
  const low = m.trackConflict(page)
  t.mock.timers.tick(60_000)
  m.trackConflict({ ...terms, id: high, impact: 'high' })
  m.observe('a', { files: ['src/plans.ts', 'src/pricing.ts'], patch: 'P1', main: 'm1' })
  m.trackOverlap('b', 'a', 'src/pricing.ts')
  t.mock.timers.tick(60_000)
  m.observe('a', { files: [], patch: '', main: 'm2' })
  t.mock.timers.tick(60_000)
  m.trackConflict({ ...page, id: low, stage: 'after', status: 'resolved' })
  m.trackConflict({ ...terms, id: high, stage: 'after', impact: 'high', status: 'resolved' })
  const sections = texts(homeView(m.snapshot()).blocks)
  const trail = (summary: string) => sections.find((s) => s.includes(summary))?.split('\n')[2]
  assert.equal(
    trail('Both tasks change the pricing page.'),
    `Before ${time(3)} → During ${time(4)} → After ${time(5)} → Resolved ${time(6)}`,
  )
  // The impact changed in the before stage. The board shows the first time of each stage.
  assert.equal(trail('The tasks use different trial terms.'), `Before ${time(3)} → After ${time(5)} → Resolved ${time(6)}`)
})

test('homeView shows the newest steps of a long lifecycle', () => {
  const m = setup()
  m.register(a)
  m.register(b)
  const c = {
    sessions: ['a', 'b'],
    summary: 'Both tasks change the pricing page.',
    impact: 'low' as const,
    status: 'open' as const,
  }
  const id = m.trackConflict({ ...c, stage: 'before' })
  for (let i = 0; i < 10; i++) m.trackConflict({ ...c, id, stage: i % 2 ? 'before' : 'during' })
  m.trackConflict({ ...c, id, stage: 'after', status: 'resolved' })
  const lines = texts(homeView(m.snapshot()).blocks)
    .find((s) => s.includes('Both tasks change the pricing page.'))
    ?.split('\n')
  const steps = lines?.[2].split(' → ') ?? []
  assert.equal(steps[0], '…')
  assert.ok(steps.length < 12, `${steps.length} steps`)
  assert.ok(steps.at(-1)?.startsWith('Resolved <!date^'))
  assert.ok(steps.at(-2)?.startsWith('Before <!date^'))
})

test('homeView shows the empty state', () => {
  const json = JSON.stringify(homeView(new Memory(':memory:').snapshot()))
  assert.ok(json.includes('No agents are active.'))
  assert.ok(json.includes('No conflicts.'))
})

test('homeView escapes Slack control characters', () => {
  const m = setup()
  m.register(a)
  m.addTask({ session: 'a', summary: 'Use <Plan> & <!channel>' })
  const json = JSON.stringify(homeView(m.snapshot()))
  assert.ok(json.includes('Use &lt;Plan&gt; &amp; &lt;!channel&gt;'))
})

test('homeView stays within Slack limits', () => {
  const m = setup()
  for (let i = 0; i < 60; i++) {
    m.register({ id: `s${i}`, agent: 'Claude Code', member: BOB })
    m.addTask({ session: `s${i}`, summary: `Step ${i}. ${'x'.repeat(5000)}` })
  }
  for (let i = 0; i < 60; i++) {
    const id = m.trackConflict({
      sessions: ['s58', 's59'],
      summary: '&'.repeat(5000),
      stage: 'during',
      impact: 'high',
      status: 'open',
      issue: 1,
    })
    m.escalate(id, { channel: `oceania-1-c${id}`, author: 'Tverous', question: 'q'.repeat(5000), options: ['A', 'B'] })
    // A long lifecycle: the stage changes many times.
    for (let j = 0; j < 20; j++) {
      m.trackConflict({
        id,
        sessions: ['s58', 's59'],
        summary: '&'.repeat(5000),
        stage: j % 2 ? 'during' : 'after',
        impact: 'high',
        status: j % 3 ? 'open' : 'resolved',
      })
    }
  }
  const view = homeView(m.snapshot())
  assert.ok(view.blocks.length <= 100, `${view.blocks.length} blocks`)
  for (const text of texts(view.blocks)) assert.ok(text.length <= 3000, `${text.length} characters`)
  const json = JSON.stringify(view)
  assert.ok(json.includes('Step 59.'))
  assert.ok(!json.includes('Step 0.'))
})
