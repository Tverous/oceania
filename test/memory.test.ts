import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Memory } from '../src/memory.ts'

const ALICE = 'alice@example.com'
const BOB = 'bob@example.com'
const a = { id: 'a', agent: 'Copilot CLI', member: ALICE }
const b = { id: 'b', agent: 'Claude Code', member: BOB }
const CHANNEL = 'oceania-1-x'

function setup(): Memory {
  const m = new Memory(':memory:')
  m.upsertMember({ email: ALICE, name: 'Alice' })
  m.upsertMember({ email: BOB, name: 'Bob' })
  m.upsertMember({ email: 'tverous@example.com', name: 'Tverous', github: 'Tverous' })
  return m
}

/** Registers a and b, and escalates a high impact conflict on #1. */
function escalated(m: Memory): number {
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
    channel: CHANNEL,
    author: 'Tverous',
    question: 'Which trial terms?',
    options: ['14 days, card required', '30 days, no card'],
  })
  return id
}

test('register starts the cursor at the latest event', () => {
  const m = setup()
  m.register(a)
  m.addTask({ session: 'a', summary: 'Add the Pro plan' })
  m.addTask({ session: 'a', summary: 'Add tests' })
  m.register(b)
  assert.deepEqual(m.readEvents('b'), [])
})

test('register updates git fields without a second join event', () => {
  const m = setup()
  m.register({ ...a, main: 'm1' })
  const last = m.lastEventId()
  m.register({ ...a, root: '/work/alice', main: 'm2' })
  assert.equal(m.session('a')?.root, '/work/alice')
  assert.equal(m.session('a')?.main, 'm1')
  assert.equal(m.lastEventId(), last)
})

test('readEvents skips own events and reads each event once', () => {
  const m = setup()
  m.register(b)
  m.register(a)
  m.addTask({ session: 'a', summary: 'Add the Pro plan', issue: 1 })
  const texts = m.readEvents('b').map((e) => e.text)
  assert.ok(texts.includes("Alice's agent (Copilot CLI) task: Add the Pro plan (#1)"))
  assert.deepEqual(m.readEvents('b'), [])
  assert.deepEqual(m.readEvents('a'), [])
})

test('observe bumps the diff version only when the patch changes', () => {
  const m = setup()
  m.register(a)
  m.observe('a', { files: ['src/plans.ts'], patch: 'P1', main: 'm1' })
  m.observe('a', { files: ['src/plans.ts'], patch: 'P1', main: 'm1' })
  assert.equal(m.diffs()[0].version, 1)
})

test('observe records a push and moves open conflicts to after', () => {
  const m = setup()
  m.register({ ...a, main: 'm1' })
  m.observe('a', { files: ['src/plans.ts'], patch: 'P1', main: 'm1' })
  m.register(b)
  const id = m.trackOverlap('b', 'a', 'src/plans.ts')
  m.observe('a', { files: [], patch: '', main: 'm2' })
  const texts = m.eventsAfter(0).map((e) => e.text)
  assert.ok(texts.includes("Alice's agent (Copilot CLI) pushed to main: src/plans.ts"))
  assert.equal(m.conflict(id)?.stage, 'after')
  assert.equal(m.snapshot().main, 'm2')
})

test('observe records what reached main with each push', () => {
  const m = setup()
  const plans = 'diff --git a/src/plans.ts b/src/plans.ts\n@@ -1 +1,2 @@\n+  { id: "pro", trialDays: 30 },\n'
  const readme = 'diff --git a/README.md b/README.md\n@@ -1 +1 @@\n+Pro\n'
  m.register({ ...a, main: 'm1' })
  m.observe('a', { files: ['README.md', 'src/plans.ts'], patch: readme + plans, main: 'm1' })
  m.observe('a', { files: ['README.md'], patch: readme, main: 'm2' })
  const pushes = m.pushes()
  assert.equal(pushes.length, 1)
  assert.equal(typeof pushes[0].at, 'number')
  assert.deepEqual({ ...pushes[0], at: 0 }, { session: 'a', files: ['src/plans.ts'], patch: plans, main: 'm2', at: 0 })
})

test('observe writes a clear event when the diff becomes empty', () => {
  const m = setup()
  m.register({ ...a, main: 'm1' })
  m.observe('a', { files: ['src/plans.ts'], patch: 'P1', main: 'm1' })
  m.observe('a', { files: [], patch: '', main: 'm2' })
  assert.equal(m.eventsAfter(0).at(-1)?.text, "Alice's agent (Copilot CLI) has no local changes.")
})

test('observe ignores a pull', () => {
  const m = setup()
  m.register({ ...b, main: 'm1' })
  m.observe('b', { files: ['src/pricing.ts'], patch: 'P', main: 'm1' })
  m.observe('b', { files: ['src/pricing.ts'], patch: 'P', main: 'm2' })
  assert.ok(!m.eventsAfter(0).some((e) => e.kind === 'push'))
})

test('observe does not report a push for the first main', () => {
  const m = setup()
  m.register(a)
  m.observe('a', { files: ['src/plans.ts'], patch: 'P', main: 'm2' })
  assert.ok(!m.eventsAfter(0).some((e) => e.kind === 'push'))
})

test('takeNotes delivers each note once', () => {
  const m = setup()
  m.register(b)
  m.addNote('b', 'Oceania note: X\nDo this: Y', true)
  assert.equal(m.takeNotes('b', true).length, 1)
  assert.equal(m.takeNotes('b', true).length, 0)
})

test('undeliver makes the notes pending again and keeps their order', () => {
  const m = setup()
  m.register(b)
  m.addNote('b', 'N1', true)
  m.addNote('b', 'N2', true)
  const [first, second] = m.takeNotes('b', true)
  m.undeliver([second.id, first.id])
  assert.deepEqual(m.takeNotes('b', true), [first, second])
  assert.equal(m.notes().length, 2)
})

test('trackOverlap creates one during conflict per pair', () => {
  const m = setup()
  m.register(a)
  m.register(b)
  const id = m.trackOverlap('b', 'a', 'src/plans.ts')
  const c = m.conflict(id)
  assert.equal(c?.stage, 'during')
  assert.equal(c?.impact, 'low')
  assert.equal(c?.summary, "Bob's agent (Claude Code) and Alice's agent (Copilot CLI) change src/plans.ts.")
  assert.equal(m.trackOverlap('b', 'a', 'src/pricing.ts'), id)
  assert.deepEqual(m.conflict(id)?.files, ['src/plans.ts', 'src/pricing.ts'])
})

test('trackOverlap keeps a high impact conflict separate', () => {
  const m = setup()
  m.register(a)
  m.register(b)
  const high = m.trackConflict({
    sessions: ['a', 'b'],
    summary: 'The tasks use different trial terms.',
    stage: 'before',
    impact: 'high',
    status: 'open',
    issue: 1,
  })
  const id = m.trackOverlap('b', 'a', 'src/plans.ts')
  assert.notEqual(id, high)
  assert.equal(m.conflict(id)?.impact, 'low')
  assert.deepEqual(m.conflict(high)?.files, [])
  assert.equal(m.conflict(high)?.stage, 'before')
})

test('trackConflict resolves a conflict with a resolved event', () => {
  const m = setup()
  m.register(a)
  m.register(b)
  const c = {
    sessions: ['a', 'b'],
    summary: 'Both tasks add the Pro plan.',
    stage: 'before' as const,
    impact: 'low' as const,
    status: 'open' as const,
  }
  const id = m.trackConflict(c)
  m.trackConflict({ ...c, id, status: 'resolved' })
  assert.equal(m.conflict(id)?.status, 'resolved')
  assert.ok(m.eventsAfter(0).at(-1)?.text.startsWith('Conflict #1 resolved:'))
})

test('escalate pauses every session in the conflict', () => {
  const m = setup()
  escalated(m)
  assert.equal(m.session('a')?.status, 'paused')
  assert.equal(m.session('b')?.status, 'paused')
  assert.equal(m.pausedBy('a')?.channel, CHANNEL)
  assert.equal(
    m.eventsAfter(0).at(-1)?.text,
    "Oceania paused Alice's agent (Copilot CLI) and Bob's agent (Claude Code). Open question on #1: Which trial terms?",
  )
})

test('decide resumes sessions with a note and rejects a second decision', () => {
  const m = setup()
  const id = escalated(m)
  m.decide(CHANNEL, '30 days, no card', 'RESUME')
  for (const s of ['a', 'b']) {
    assert.equal(m.session(s)?.status, 'idle')
    assert.ok(m.takeNotes(s, true).some((n) => n.text === 'RESUME'))
  }
  assert.equal(m.conflict(id)?.status, 'open')
  assert.equal(m.decisions(1)[0].option, '30 days, no card')
  assert.throws(() => m.decide(CHANNEL, '14 days, card required', 'RESUME'))
})

test('decide resumes a session only when no other question pauses it', () => {
  const m = setup()
  escalated(m)
  const second = m.trackConflict({
    sessions: ['a', 'b'],
    summary: 'The tasks use different card rules.',
    stage: 'before',
    impact: 'high',
    status: 'open',
    issue: 1,
  })
  m.escalate(second, { channel: 'oceania-1-y', author: 'Tverous', question: 'Card required?', options: ['Yes', 'No'] })
  m.decide(CHANNEL, '30 days', 'RESUME 1')
  for (const s of ['a', 'b']) {
    assert.equal(m.session(s)?.status, 'paused')
    assert.equal(m.pausedBy(s)?.id, second)
  }
  m.decide('oceania-1-y', 'No', 'RESUME 2')
  for (const s of ['a', 'b']) {
    assert.equal(m.session(s)?.status, 'idle')
    assert.deepEqual(
      m.takeNotes(s, true).map((n) => n.text),
      ['RESUME 1', 'RESUME 2'],
    )
  }
})

test('addTask sends existing decisions when a session links to an issue', () => {
  const m = setup()
  escalated(m)
  m.decide(CHANNEL, '30 days, no card', 'RESUME')
  m.register({ id: 'c', agent: 'Claude Code', member: BOB })
  m.addTask({ session: 'c', summary: 'Show the Pro plan', issue: 1 })
  assert.equal(m.takeNotes('c', false)[0].text, 'Decision on #1 by Tverous: 30 days, no card')
  m.addTask({ session: 'c', summary: 'Fix the price', issue: 1 })
  assert.equal(m.takeNotes('c', false).length, 0)
})

test('setStatus adds no event', () => {
  const m = setup()
  m.register(a)
  const last = m.lastEventId()
  m.setStatus('a', 'working')
  assert.equal(m.session('a')?.status, 'working')
  assert.equal(m.lastEventId(), last)
})

test('onChange fires once per write and stops after unsubscribe', () => {
  const m = setup()
  escalated(m)
  let calls = 0
  const off = m.onChange(() => calls++)
  m.decide(CHANNEL, '30 days, no card', 'RESUME')
  assert.equal(calls, 1)
  off()
  m.setStatus('a', 'working')
  assert.equal(calls, 1)
})

test('Memory persists in a file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oceania-'))
  try {
    const path = join(dir, 'oceania.db')
    const first = new Memory(path)
    first.upsertMember({ email: ALICE, name: 'Alice' })
    first.register(a)
    const id = first.trackConflict({
      sessions: ['a'],
      summary: 'The task differs from the spec.',
      stage: 'before',
      impact: 'low',
      status: 'open',
    })
    const second = new Memory(path)
    assert.deepEqual(second.member(ALICE), { email: ALICE, name: 'Alice' })
    assert.deepEqual(second.session('a'), first.session('a'))
    assert.deepEqual(second.conflict(id), first.conflict(id))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
