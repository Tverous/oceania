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
  const at = s.sessions[0].updated
  assert.ok(json.includes(`<!date^${Math.floor(at / 1000)}^{date_short_pretty} {time}|${new Date(at).toISOString()}>`))
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
    channel: 'tower-1-x',
    author: 'Tverous',
    question: 'Which trial terms?',
    options: ['14 days, card required', '30 days, no card'],
  })
  assert.ok(JSON.stringify(homeView(m.snapshot())).includes('Open question: Which trial terms?'))
  m.decide('tower-1-x', '30 days, no card', 'Apply the decision.')
  const json = JSON.stringify(homeView(m.snapshot()))
  assert.ok(json.includes('Decision: 30 days, no card'))
  assert.ok(!json.includes('Open question'))
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
    m.escalate(id, { channel: `tower-1-c${id}`, author: 'Tverous', question: 'q'.repeat(5000), options: ['A', 'B'] })
  }
  const view = homeView(m.snapshot())
  assert.ok(view.blocks.length <= 100, `${view.blocks.length} blocks`)
  for (const text of texts(view.blocks)) assert.ok(text.length <= 3000, `${text.length} characters`)
  const json = JSON.stringify(view)
  assert.ok(json.includes('Step 59.'))
  assert.ok(!json.includes('Step 0.'))
})
