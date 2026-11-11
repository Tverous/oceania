import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hookOutput } from '../src/adapter.ts'
import { Memory } from '../src/memory.ts'
import { createServer } from '../src/server.ts'

const CLI = join(import.meta.dirname, '..', 'src', 'cli.ts')
const ALICE = 'alice@example.com'

/** Runs `oceania hook` with `payload` on stdin. `env` replaces the Oceania variables of this process. */
function runHook(
  agent: string,
  payload: object,
  env: { OCEANIA_URL?: string; OCEANIA_MEMBER?: string },
): Promise<{ code: number | null; stdout: string }> {
  const { OCEANIA_URL, OCEANIA_MEMBER, ...rest } = process.env
  const child = spawn(process.execPath, [CLI, 'hook', '--agent', agent], { env: { ...rest, ...env } })
  let stdout = ''
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
  child.stdin.end(JSON.stringify(payload))
  return new Promise((done, fail) => {
    child.on('error', fail)
    child.on('close', (code) => done({ code, stdout }))
  })
}

function payload(event: string, session = 's1'): object {
  return {
    hook_event_name: event,
    session_id: session,
    cwd: tmpdir(),
    tool_name: 'Edit',
    tool_input: { file_path: 'src/plans.ts' },
  }
}

test('hookOutput maps decisions for copilot', () => {
  assert.deepEqual(hookOutput('copilot', 'SessionStart', { context: 'C' }), { additionalContext: 'C' })
  assert.deepEqual(hookOutput('copilot', 'PreToolUse', { deny: 'D' }), {
    permissionDecision: 'deny',
    permissionDecisionReason: 'D',
  })
  assert.deepEqual(hookOutput('copilot', 'Stop', { block: 'B' }), { decision: 'block', reason: 'B' })
})

test('hookOutput maps decisions for claude', () => {
  assert.deepEqual(hookOutput('claude', 'PostToolUse', { context: 'C' }), {
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'C' },
  })
  assert.deepEqual(hookOutput('claude', 'PreToolUse', { deny: 'D' }), {
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'D' },
  })
  assert.deepEqual(hookOutput('claude', 'Stop', { block: 'B' }), { decision: 'block', reason: 'B' })
})

test('hookOutput returns undefined for an empty decision', () => {
  assert.equal(hookOutput('copilot', 'PostToolUse', {}), undefined)
  assert.equal(hookOutput('claude', 'PostToolUse', {}), undefined)
})

test('runHook stays silent when Oceania is down', async (t) => {
  const down = await runHook('copilot', payload('PreToolUse'), { OCEANIA_URL: 'http://127.0.0.1:9', OCEANIA_MEMBER: ALICE })
  assert.deepEqual(down, { code: 0, stdout: '' })

  // Without OCEANIA_MEMBER, the adapter sends nothing, also to an Oceania that runs.
  const m = new Memory(':memory:')
  const server = createServer(m, { settled: async () => {}, holdMs: 0 }).listen(0, '127.0.0.1')
  t.after(() => server.close())
  await new Promise((done) => server.once('listening', done))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  assert.deepEqual(await runHook('copilot', payload('PreToolUse'), { OCEANIA_URL: url }), { code: 0, stdout: '' })
  assert.equal(m.session('s1'), undefined)
})

test('runHook prints the Oceania decision in the agent format', async (t) => {
  const m = new Memory(':memory:')
  m.upsertMember({ email: ALICE, name: 'Alice' })
  const server = createServer(m, { settled: async () => {}, holdMs: 0 }).listen(0, '127.0.0.1')
  t.after(() => server.close())
  await new Promise((done) => server.once('listening', done))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  const { code, stdout } = await runHook('claude', payload('SessionStart'), { OCEANIA_URL: url, OCEANIA_MEMBER: ALICE })
  assert.equal(code, 0)
  const out = JSON.parse(stdout)
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart')
  assert.match(out.hookSpecificOutput.additionalContext, /^Oceania:/)
  assert.equal(m.session('s1')?.agent, 'Claude Code')
})
