import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { z } from 'zod'
import { Memory } from '../src/memory.ts'
import { createTools, startMaster } from '../src/master.ts'
import type { Chat, Specs, Tools } from '../src/master.ts'
import type { Conflict, Status } from '../src/types.ts'

const SPEC = {
  issue: 1,
  title: 'Launch a Pro plan with a free trial',
  body: 'Launch a Pro plan with a free trial. Add the plan and show it on the pricing page.',
  author: 'Tverous',
  decisions: [],
}

function setup(): Memory {
  const m = new Memory(':memory:')
  m.upsertMember({ email: 'alice@example.com', name: 'Alice', slackId: 'U_ALICE' })
  m.upsertMember({ email: 'bob@example.com', name: 'Bob', slackId: 'U_BOB' })
  m.upsertMember({ email: 'tverous@example.com', name: 'Tverous', github: 'Tverous', slackId: 'U_TVEROUS' })
  m.register({ id: 'a', agent: 'Copilot CLI', member: 'alice@example.com' })
  m.register({ id: 'b', agent: 'Claude Code', member: 'bob@example.com' })
  return m
}

/** A fake chat. `fail` makes `openConflict` throw. `seen` keeps the session status at each call. */
function fakeChat(m: Memory, fail = false) {
  const opened: Conflict[] = []
  const seen: (Status | undefined)[][] = []
  const chat: Chat = {
    async post() {},
    async openConflict(c) {
      seen.push(c.sessions.map((s) => m.session(s)?.status))
      if (fail) throw new Error('Slack is down.')
      opened.push(c)
    },
  }
  return { chat, opened, seen }
}

const specs: Specs = {
  async get() {
    return SPEC
  },
  async comment() {},
}

function highConflict(m: Memory, issue?: number): number {
  return m.trackConflict({
    sessions: ['a', 'b'],
    summary: 'The tasks use different trial terms.',
    stage: 'before',
    impact: 'high',
    status: 'open',
    issue,
  })
}

const QUESTION = { question: 'Which trial terms?', options: ['14 days, card required', '30 days, no card'] }

test('notify writes a Tower note', async () => {
  const m = setup()
  const tools = createTools(m, fakeChat(m).chat, specs)
  await tools.notify.run({ session: 'b', summary: 'S', instruction: 'I', blocking: true })
  assert.equal(m.takeNotes('b', true)[0].text, 'Tower note: S\nDo this: I')
})

test('track_conflict creates and resolves a conflict', async () => {
  const m = setup()
  const tools = createTools(m, fakeChat(m).chat, specs)
  const args = { sessions: ['a', 'b'], summary: 'Both add the Pro plan.', stage: 'before', impact: 'low' }
  assert.equal(await tools.track_conflict.run({ ...args, status: 'open' }), 'Conflict #1')
  await tools.track_conflict.run({ ...args, id: 1, status: 'resolved' })
  assert.equal(m.conflict(1)?.status, 'resolved')
})

test('escalate opens the Slack channel before it pauses sessions', async () => {
  const m = setup()
  const { chat, opened, seen } = fakeChat(m)
  const tools = createTools(m, chat, specs)
  const id = highConflict(m, 1)
  const result = await tools.escalate.run({ conflict: id, ...QUESTION })
  assert.equal(opened[0].author, 'Tverous')
  assert.match(opened[0].channel ?? '', /^tower-1-[0-9a-z]+$/)
  assert.equal(result, `Opened #${opened[0].channel}`)
  assert.deepEqual(seen[0], ['idle', 'idle'])
  assert.equal(m.session('a')?.status, 'paused')
  assert.equal(m.session('b')?.status, 'paused')
})

test('escalate pauses nothing when Slack fails', async () => {
  const m = setup()
  const tools = createTools(m, fakeChat(m, true).chat, specs)
  const id = highConflict(m, 1)
  await assert.rejects(tools.escalate.run({ conflict: id, ...QUESTION }), /Slack is down/)
  assert.equal(m.session('a')?.status, 'idle')
  assert.equal(m.session('b')?.status, 'idle')
  assert.equal(m.conflict(id)?.channel, undefined)
})

test('escalate rejects a long option', () => {
  const m = setup()
  const tools = createTools(m, fakeChat(m).chat, specs)
  const schema = z.object(tools.escalate.schema)
  const args = (option: string) => ({ conflict: 1, question: 'Which trial terms?', options: [option, '30 days, no card'] })
  assert.equal(schema.safeParse(args('x'.repeat(76))).success, false)
  assert.equal(schema.safeParse(args('x'.repeat(75))).success, true)
})

test('escalate rejects a conflict without an issue, a second escalate, and an author without Slack', async () => {
  const m = setup()
  const { chat, opened } = fakeChat(m)
  const tools = createTools(m, chat, specs)
  await assert.rejects(tools.escalate.run({ conflict: highConflict(m), ...QUESTION }), /has no issue/)
  const id = highConflict(m, 1)
  await tools.escalate.run({ conflict: id, ...QUESTION })
  await assert.rejects(tools.escalate.run({ conflict: id, ...QUESTION }), /already/)
  m.upsertMember({ email: 'tverous@example.com', name: 'Tverous', github: 'Tverous' })
  await assert.rejects(tools.escalate.run({ conflict: highConflict(m, 1), ...QUESTION }), /Slack/)
  assert.equal(opened.length, 1)
})

test('startMaster runs one round per batch of agent events', async () => {
  const m = setup()
  const prompts: string[] = []
  const master = startMaster(m, {} as Tools, async (prompt) => void prompts.push(prompt), 10)
  m.addTask({ session: 'a', summary: 'Add the Pro plan', issue: 1 })
  m.addTask({ session: 'b', summary: 'Show the Pro plan', issue: 1 })
  await master.settled()
  assert.equal(prompts.length, 1)
  assert.match(prompts[0], /Add the Pro plan/)
  assert.match(prompts[0], /Show the Pro plan/)
  highConflict(m, 1)
  await sleep(30)
  await master.settled()
  assert.equal(prompts.length, 1)
  master.stop()
})

test('startMaster runs a round for a push', async () => {
  const m = setup()
  m.observe('a', { files: ['src/plans.ts'], patch: 'P1', main: 'm1' })
  const prompts: string[] = []
  const master = startMaster(m, {} as Tools, async (prompt) => void prompts.push(prompt), 10)
  m.observe('a', { files: [], patch: '', main: 'm2' })
  await master.settled()
  assert.equal(prompts.length, 1)
  assert.match(prompts[0], /pushed to main: src\/plans\.ts/)
  master.stop()
})

test('settled waits for the running round', async () => {
  const m = setup()
  let done = false
  const master = startMaster(
    m,
    {} as Tools,
    async () => {
      await sleep(50)
      done = true
    },
    10,
  )
  m.addTask({ session: 'a', summary: 'Add the Pro plan', issue: 1 })
  await master.settled()
  assert.equal(done, true)
  master.stop()
})

test('startMaster runs the next batch after a failed round', async (t) => {
  const error = t.mock.method(console, 'error', () => {})
  const m = setup()
  const prompts: string[] = []
  const master = startMaster(
    m,
    {} as Tools,
    async (prompt) => {
      prompts.push(prompt)
      if (prompts.length === 1) throw new Error('The model is down.')
    },
    10,
  )
  m.addTask({ session: 'a', summary: 'Add the Pro plan', issue: 1 })
  await master.settled()
  assert.equal(error.mock.callCount(), 1)
  m.addTask({ session: 'b', summary: 'Show the Pro plan', issue: 1 })
  await master.settled()
  assert.equal(prompts.length, 2)
  assert.doesNotMatch(prompts[1], /Add the Pro plan/)
  master.stop()
})
