import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { devNull, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { gitInfo } from '../src/git.ts'
import { createTools } from '../src/master.ts'
import type { Chat, Specs, Tools } from '../src/master.ts'
import { Memory } from '../src/memory.ts'
import { Shadow } from '../src/shadow.ts'

/** Run git for test setup, without the user's git config. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: devNull,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  }).trim()
}

function write(cwd: string, file: string, text: string): void {
  mkdirSync(dirname(join(cwd, file)), { recursive: true })
  writeFileSync(join(cwd, file), text)
}

const chat: Chat = { async post() {}, async openConflict() {} }
const specs: Specs = {
  async get() {
    throw new Error('The test has no spec.')
  },
  async comment() {},
}

/**
 * A bare origin with the `seed` files, two clones of it (Alice's and Bob's), and a Shadow that clones the origin.
 * Sessions a and b are in Memory.
 */
function setup(
  t: TestContext,
  seed: Record<string, string> = { 'src/plans.ts': 'export const trialDays = 0\n' },
): { alice: string; bob: string; shadow: Shadow; tools: Tools } {
  const dir = mkdtempSync(join(tmpdir(), 'oceania-shadow-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const first = join(dir, 'seed')
  const origin = join(dir, 'origin.git')
  mkdirSync(first)
  git(first, 'init')
  for (const [file, text] of Object.entries(seed)) write(first, file, text)
  git(first, 'add', '-A')
  git(first, 'commit', '-m', 'seed')
  git(dir, 'clone', '--bare', first, origin)
  git(dir, 'clone', origin, 'alice')
  git(dir, 'clone', origin, 'bob')

  const m = new Memory(':memory:')
  m.register({ id: 'a', agent: 'Copilot CLI', member: 'alice@example.com' })
  m.register({ id: 'b', agent: 'Claude Code', member: 'bob@example.com' })
  const shadow = new Shadow(join(dir, 'oceania'), () => origin)
  return { alice: join(dir, 'alice'), bob: join(dir, 'bob'), shadow, tools: createTools(m, chat, specs, shadow) }
}

/** Sends the git data of one clone to the Shadow, as Oceania does after each PostToolUse. */
async function observe(shadow: Shadow, session: string, clone: string): Promise<void> {
  const info = gitInfo(clone, true)
  assert.ok(info)
  await shadow.update(session, info)
}

test('check_merge reports a same-line conflict', async (t) => {
  const { alice, bob, shadow, tools } = setup(t)
  write(alice, 'src/plans.ts', 'export const trialDays = 14\n')
  write(bob, 'src/plans.ts', 'export const trialDays = 30\n')

  assert.equal(await tools.check_merge.run({ a: 'a', b: 'b' }), 'Session a has no shadow ref yet.')
  await observe(shadow, 'a', alice)
  assert.equal(await tools.check_merge.run({ a: 'a', b: 'b' }), 'Session b has no shadow ref yet.')
  await observe(shadow, 'b', bob)
  assert.equal(await tools.check_merge.run({ a: 'a', b: 'b' }), 'The diffs of sessions a and b conflict in: src/plans.ts')
})

test('check_merge passes changes in different files', async (t) => {
  const { alice, bob, shadow, tools } = setup(t)
  write(alice, 'src/plans.ts', 'export const trialDays = 14\n')
  git(alice, 'commit', '-am', 'Add the trial')
  await observe(shadow, 'a', alice)

  // Bob's base is a commit that the Shadow clone does not have yet. A new untracked file is his diff.
  write(bob, 'src/readme.ts', 'export const readme = 1\n')
  git(bob, 'add', '-A')
  git(bob, 'commit', '-m', 'Add the readme')
  git(bob, 'push', 'origin', 'HEAD')
  write(bob, 'src/pricing.ts', 'export const page = 1\n')
  await observe(shadow, 'b', bob)

  assert.equal(await tools.check_merge.run({ a: 'a', b: 'b' }), 'The diffs of sessions a and b merge with no conflicts.')
})

test('run_in_worktree returns test failures', async (t) => {
  const { alice, bob, shadow, tools } = setup(t, {
    'package.json': JSON.stringify({ type: 'module', scripts: { test: 'node test.js' } }),
    'src/plans.js': 'export const trialDays = 0\n',
    'test.js': "console.log('ok')\n",
  })
  // Each diff passes the tests alone. Alice renames an export, and Bob's new page uses the old name.
  write(alice, 'src/plans.js', 'export const trialLength = 14\n')
  write(bob, 'src/pricing.js', "import { trialDays } from './plans.js'\nexport const page = `Trial: ${trialDays} days`\n")
  write(bob, 'test.js', "import './src/pricing.js'\n")
  await observe(shadow, 'a', alice)
  await observe(shadow, 'b', bob)

  const text = await tools.run_in_worktree.run({ a: 'a', b: 'b' })
  assert.match(text, /^npm test failed on the merged diffs of sessions a and b\./)
  assert.match(text, /does not provide an export named 'trialDays'/)
  // Oceania removed the temporary worktree, so only the bare clone stays.
  assert.equal(git(shadow.dir, 'worktree', 'list', '--porcelain').match(/^worktree /gm)?.length, 1)
})
