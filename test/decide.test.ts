import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Memory } from '../src/memory.ts'
import { decide } from '../src/master.ts'
import type { Specs } from '../src/master.ts'

const CHANNEL = 'oceania-1-x'

/** Two sessions, paused by a high impact conflict on #1 that Tverous decides. */
function setup(): Memory {
  const m = new Memory(':memory:')
  m.upsertMember({ email: 'alice@example.com', name: 'Alice', slackId: 'U_ALICE' })
  m.upsertMember({ email: 'bob@example.com', name: 'Bob', slackId: 'U_BOB' })
  m.upsertMember({ email: 'tverous@example.com', name: 'Tverous', github: 'Tverous', slackId: 'U_TVEROUS' })
  m.register({ id: 'a', agent: 'Copilot CLI', member: 'alice@example.com' })
  m.register({ id: 'b', agent: 'Claude Code', member: 'bob@example.com' })
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
  return m
}

function fakeSpecs(fail = false) {
  const comments: { issue: number; body: string }[] = []
  const specs: Specs = {
    async get() {
      throw new Error('decide does not read the spec.')
    },
    async comment(issue, body) {
      if (fail) throw new Error('gh failed.')
      comments.push({ issue, body })
    },
  }
  return { specs, comments }
}

test('decide rejects a member who is not the spec author', async () => {
  const m = setup()
  const result = await decide(m, fakeSpecs().specs, CHANNEL, 1, 'U_ALICE')
  assert.deepEqual(result, { ok: false, reason: 'Only Tverous can decide this question.' })
  assert.equal(m.session('a')?.status, 'paused')
})

test('decide records the decision, comments, and resumes sessions', async () => {
  const m = setup()
  const { specs, comments } = fakeSpecs()
  const result = await decide(m, specs, CHANNEL, 1, 'U_TVEROUS')
  assert.deepEqual(result, { ok: true, option: '30 days, no card' })
  assert.equal(m.session('a')?.status, 'idle')
  assert.equal(m.session('b')?.status, 'idle')
  assert.equal(
    m.takeNotes('b', true)[0].text,
    'Decision on #1 by Tverous: 30 days, no card\nApply this decision. Then continue your task.',
  )
  assert.deepEqual(comments, [
    { issue: 1, body: 'Decision: 30 days, no card\n@Tverous decided this in Slack. Oceania recorded this decision.' },
  ])
})

test('decide rejects a second decision', async () => {
  const m = setup()
  const { specs } = fakeSpecs()
  await decide(m, specs, CHANNEL, 1, 'U_TVEROUS')
  const result = await decide(m, specs, CHANNEL, 0, 'U_TVEROUS')
  assert.deepEqual(result, { ok: false, reason: 'This question already has a decision.' })
  assert.equal(m.decisions(1).length, 1)
})

test('decide keeps the decision when the GitHub comment fails', async (t) => {
  const error = t.mock.method(console, 'error', () => {})
  const m = setup()
  const result = await decide(m, fakeSpecs(true).specs, CHANNEL, 1, 'U_TVEROUS')
  assert.deepEqual(result, { ok: true, option: '30 days, no card' })
  assert.equal(m.decisions(1)[0].option, '30 days, no card')
  assert.equal(error.mock.callCount(), 1)
})
