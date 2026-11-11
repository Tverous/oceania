import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { Memory } from '../src/memory.ts'
import { createServer, handleHook } from '../src/server.ts'
import type { HookPayload } from '../src/server.ts'
import { MAX_TEXT, resume } from '../src/text.ts'
import type { GitInfo, HookDecision } from '../src/types.ts'

const ALICE = 'alice@example.com'
const BOB = 'bob@example.com'
const REPO = 'github.com/tverous/acme-pricing'
const ROOTS: Record<string, string> = { a: '/work/alice', b: '/work/bob', c: '/work/carol' }
const CHANNEL = 'tower-1-x'
const OPTS = { settled: async () => {}, holdMs: 500 }

function patch(path: string, line: string): string {
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1,2 @@\n+${line}\n export const plans = []\n`
}

function git(session: string, files: string[] = [], diff = '', main = 'm1', repo = REPO): GitInfo {
  return { root: ROOTS[session], repo, base: 'b0', main, files, patch: diff }
}

/** Sends one hook request. Session a is Alice's Copilot CLI. Other sessions are Bob's Claude Code. */
function hook(
  m: Memory,
  session: string,
  payload: Partial<HookPayload> & Pick<HookPayload, 'hook_event_name'>,
  info?: GitInfo,
  opts = OPTS,
): Promise<HookDecision> {
  return handleHook(
    m,
    {
      agent: session === 'a' ? 'copilot' : 'claude',
      member: session === 'a' ? ALICE : BOB,
      payload: { session_id: session, cwd: ROOTS[session], ...payload },
      git: info,
    },
    opts,
  )
}

function edit(path: string, cwd?: string): Partial<HookPayload> & Pick<HookPayload, 'hook_event_name'> {
  return { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path }, ...(cwd && { cwd }) }
}

function setup(): Memory {
  const m = new Memory(':memory:')
  m.upsertMember({ email: ALICE, name: 'Alice' })
  m.upsertMember({ email: BOB, name: 'Bob' })
  m.upsertMember({ email: 'tverous@example.com', name: 'Tverous', github: 'Tverous' })
  return m
}

/** Registers a and b, and pauses both for an open question on #1. */
async function escalated(m: Memory): Promise<void> {
  await hook(m, 'a', { hook_event_name: 'SessionStart' }, git('a'))
  await hook(m, 'b', { hook_event_name: 'SessionStart' }, git('b'))
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
}

function decide(m: Memory): void {
  m.decide(CHANNEL, '30 days, no card', resume(1, 'Tverous', '30 days, no card'))
}

test('SessionStart registers and returns team status', async () => {
  const m = setup()
  const d = await hook(m, 'a', { hook_event_name: 'SessionStart' }, git('a'))
  assert.match(d.context ?? '', /^Tower:/)
  assert.equal(m.session('a')?.agent, 'Copilot CLI')
  assert.equal(m.session('a')?.repo, REPO)
})

test('UserPromptSubmit records a task linked to #1', async () => {
  const m = setup()
  const prompt = 'Add the Pro plan from #1 to src/plans.ts: 14-day trial, card required.'
  assert.deepEqual(await hook(m, 'a', { hook_event_name: 'UserPromptSubmit', prompt }), {})
  const view = m.snapshot().sessions[0]
  assert.equal(view.task?.summary, prompt)
  assert.equal(view.task?.issue, 1)
  assert.equal(view.status, 'working')
})

test('PreToolUse denies a write once per diff version and records a during conflict', async () => {
  const m = setup()
  await hook(m, 'a', { hook_event_name: 'PostToolUse' }, git('a', ['src/plans.ts'], patch('src/plans.ts', '// Pro')))
  await hook(m, 'b', { hook_event_name: 'SessionStart' }, git('b'))
  const first = await hook(m, 'b', edit('/work/bob/src/plans.ts'), git('b'))
  assert.match(first.deny ?? '', /changed src\/plans\.ts in their working copy/)
  assert.match(first.deny ?? '', /\+\/\/ Pro/)
  assert.deepEqual(
    m.conflicts().map((c) => [c.stage, c.files]),
    [['during', ['src/plans.ts']]],
  )

  assert.deepEqual(await hook(m, 'b', edit('/work/bob/src/plans.ts'), git('b')), {})
  await hook(m, 'a', { hook_event_name: 'PostToolUse' }, git('a', ['src/plans.ts'], patch('src/plans.ts', '// Pro 2')))
  assert.match((await hook(m, 'b', edit('/work/bob/src/plans.ts'), git('b'))).deny ?? '', /\+\/\/ Pro 2/)
  assert.equal(m.conflicts().length, 1)
})

test('PreToolUse normalizes paths', async () => {
  const m = setup()
  const changeA = (line: string) =>
    hook(m, 'a', { hook_event_name: 'PostToolUse' }, git('a', ['src/plans.ts'], patch('src/plans.ts', line)))
  await changeA('// 1')
  await hook(m, 'b', { hook_event_name: 'SessionStart' }, git('b'))
  assert.ok((await hook(m, 'b', edit('/work/bob/src/plans.ts'), git('b'))).deny)
  await changeA('// 2')
  assert.ok((await hook(m, 'b', edit('src/plans.ts'), git('b'))).deny)
  await changeA('// 3')
  assert.ok((await hook(m, 'b', edit('plans.ts', '/work/bob/src'), git('b'))).deny)
  await changeA('// 4')
  assert.deepEqual(await hook(m, 'b', edit('/tmp/x.ts'), git('b')), {})
  assert.deepEqual(await hook(m, 'b', edit('src/other.ts'), git('b')), {})

  // A diff in another repo does not overlap, also for the same path.
  const other = 'github.com/tverous/other'
  await hook(m, 'c', { hook_event_name: 'PostToolUse' }, git('c', ['src/pricing.ts'], patch('src/pricing.ts', '// c'), 'm1', other))
  assert.deepEqual(await hook(m, 'b', edit('src/pricing.ts'), git('b')), {})
})

test('PreToolUse reads paths from a Copilot patch', async () => {
  const m = setup()
  await hook(m, 'b', { hook_event_name: 'PostToolUse' }, git('b', ['src/plans.ts'], patch('src/plans.ts', '// Pro')))
  await hook(m, 'a', { hook_event_name: 'SessionStart' }, git('a'))
  const copilotEdit = (body: string) => ({
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: `*** Begin Patch\n${body}\n*** End Patch\n`,
  })
  assert.deepEqual(await hook(m, 'a', copilotEdit('*** Add File: src/new.ts\n+export {}'), git('a')), {})
  const d = await hook(m, 'a', copilotEdit('*** Update File: /work/alice/src/plans.ts\n@@\n-old\n+new'), git('a'))
  assert.match(d.deny ?? '', /^Bob's agent \(Claude Code\) changed src\/plans\.ts in their working copy\./)
})

test('UserPromptSubmit skips the Stop reason', async () => {
  const m = setup()
  await hook(m, 'a', { hook_event_name: 'SessionStart' }, git('a'))
  m.addNote('a', 'Tower note: S\nDo this: I', false)
  const { block } = await hook(m, 'a', { hook_event_name: 'Stop' })
  const last = m.lastEventId()
  await hook(m, 'a', { hook_event_name: 'UserPromptSubmit', prompt: block })
  assert.equal(m.lastEventId(), last)
  await hook(m, 'a', { hook_event_name: 'UserPromptSubmit', prompt: 'Add the Pro plan.' })
  assert.equal(m.snapshot().sessions[0].task?.summary, 'Add the Pro plan.')
})

test('PreToolUse denies every tool while paused', async () => {
  const m = setup()
  await escalated(m)
  const d = await hook(m, 'a', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } })
  assert.match(d.deny ?? '', /^Tower paused this session\.\n/)
  assert.match(d.deny ?? '', /Tverous decides in Slack channel #tower-1-x\./)
})

test('PreToolUse delivers a blocking note once', async () => {
  const m = setup()
  await hook(m, 'b', { hook_event_name: 'SessionStart' }, git('b'))
  m.addNote('b', 'Tower note: S\nDo this: I', true)
  const read = { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'src/plans.ts' } }
  assert.deepEqual(await hook(m, 'b', read), { deny: 'Tower note: S\nDo this: I' })
  assert.deepEqual(await hook(m, 'b', read), {})
})

test('PostToolUse stores the diff and returns updates', async () => {
  const m = setup()
  await hook(m, 'a', { hook_event_name: 'SessionStart' }, git('a'))
  await hook(m, 'b', { hook_event_name: 'UserPromptSubmit', prompt: 'Show the Pro plan.' })
  m.addNote('a', 'Tower note: S\nDo this: I', false)
  const d = await hook(m, 'a', { hook_event_name: 'PostToolUse' }, git('a', ['src/plans.ts'], patch('src/plans.ts', '// Pro')))
  assert.deepEqual(m.diffs().map((x) => [x.session, x.files]), [['a', ['src/plans.ts']]])
  assert.match(d.context ?? '', /^Tower updates:\n/)
  assert.match(d.context ?? '', /Bob's agent \(Claude Code\) task: Show the Pro plan\./)
  assert.match(d.context ?? '', /Tower note: S\nDo this: I/)
  assert.deepEqual(await hook(m, 'a', { hook_event_name: 'PostToolUse' }, git('a', ['src/plans.ts'], patch('src/plans.ts', '// Pro'))), {})
})

test('PostToolUse registers an unknown session', async () => {
  const m = setup()
  await hook(m, 'c', { hook_event_name: 'PostToolUse' }, git('c', [], '', 'm9'))
  assert.equal(m.session('c')?.repo, REPO)
  assert.equal(m.session('c')?.main, 'm9')
  // The first main that a session reports is not a push.
  assert.deepEqual(m.eventsAfter(0).map((e) => e.kind), ['join'])
})

test('PostToolUse reports a push to other sessions', async () => {
  const m = setup()
  await hook(m, 'a', { hook_event_name: 'PostToolUse' }, git('a', ['src/plans.ts'], patch('src/plans.ts', '// Pro')))
  await hook(m, 'b', { hook_event_name: 'SessionStart' }, git('b'))
  await hook(m, 'a', { hook_event_name: 'PostToolUse' }, git('a', [], '', 'm2'))
  const d = await hook(m, 'b', { hook_event_name: 'PostToolUse' }, git('b'))
  assert.match(d.context ?? '', /Alice's agent \(Copilot CLI\) pushed to main: src\/plans\.ts/)
})

test('Stop returns the decision after a hold', async () => {
  const m = setup()
  await escalated(m)
  setTimeout(() => decide(m), 20)
  const d = await hook(m, 'a', { hook_event_name: 'Stop' }, undefined, { ...OPTS, holdMs: 500 })
  assert.match(d.block ?? '', /^Decision on #1 by Tverous: 30 days, no card\n/)
  assert.equal(m.session('a')?.status, 'working')
})

test('Stop returns nothing when the hold times out', async () => {
  const m = setup()
  await escalated(m)
  assert.deepEqual(await hook(m, 'a', { hook_event_name: 'Stop' }, undefined, { ...OPTS, holdMs: 30 }), {})
  assert.equal(m.session('a')?.status, 'paused')
})

test('Stop waits for settled before it checks the pause', async () => {
  const m = setup()
  const settled = () => new Promise<void>((done) => setTimeout(done, 50))
  setTimeout(() => void escalated(m), 10)
  setTimeout(() => decide(m), 100)
  const d = await hook(m, 'a', { hook_event_name: 'Stop' }, git('a'), { settled, holdMs: 500 })
  assert.match(d.block ?? '', /^Decision on #1 by Tverous:/)
})

test('Stop blocks once for pending notes', async () => {
  const m = setup()
  await hook(m, 'a', { hook_event_name: 'SessionStart' }, git('a'))
  m.addNote('a', 'Tower note: S\nDo this: I', false)
  assert.deepEqual(await hook(m, 'a', { hook_event_name: 'Stop' }), { block: 'Tower note: S\nDo this: I' })
  assert.equal(m.session('a')?.status, 'working')
  assert.deepEqual(await hook(m, 'a', { hook_event_name: 'Stop' }), {})
  assert.equal(m.session('a')?.status, 'idle')
})

test('deny text stays within MAX_TEXT', async () => {
  const m = setup()
  await hook(m, 'a', { hook_event_name: 'PostToolUse' }, git('a', ['src/plans.ts'], patch('src/plans.ts', '中'.repeat(20_000))))
  await hook(m, 'b', { hook_event_name: 'SessionStart' }, git('b'))
  const deny = (await hook(m, 'b', edit('src/plans.ts'), git('b'))).deny ?? ''
  assert.ok(Buffer.byteLength(deny) <= MAX_TEXT)
  assert.ok(deny.endsWith('[Tower clipped this text.]'))
})

test('createServer answers POST /hook and rejects other requests', async (t) => {
  const m = setup()
  const server = createServer(m, OPTS).listen(0, '127.0.0.1')
  t.after(() => server.close())
  await new Promise((done) => server.once('listening', done))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const body = { agent: 'copilot', member: ALICE, payload: { hook_event_name: 'SessionStart', session_id: 'a', cwd: '/work/alice' } }

  const ok = await fetch(`${url}/hook`, { method: 'POST', body: JSON.stringify(body) })
  assert.equal(ok.status, 200)
  assert.match(((await ok.json()) as HookDecision).context ?? '', /^Tower:/)
  assert.equal((await fetch(`${url}/hook`, { method: 'POST', body: 'x' })).status, 400)
  assert.equal((await fetch(`${url}/other`, { method: 'POST', body: '{}' })).status, 404)
  assert.equal((await fetch(`${url}/hook`)).status, 404)
})
