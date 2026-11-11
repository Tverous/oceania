import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { devNull, tmpdir } from 'node:os'
import { join } from 'node:path'
import { filePatch, gitInfo, normalizeRepo } from '../src/git.ts'

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

function tempDir(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'tower-git-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function commit(cwd: string, file: string, text: string): void {
  writeFileSync(join(cwd, file), text)
  git(cwd, 'add', file)
  git(cwd, 'commit', '-m', file)
}

test('normalizeRepo matches https and ssh origins', () => {
  for (const url of [
    'https://github.com/Tverous/acme-pricing.git',
    'git@github.com:Tverous/acme-pricing.git',
    'ssh://git@github.com/Tverous/acme-pricing',
  ]) {
    assert.equal(normalizeRepo(url), 'github.com/tverous/acme-pricing')
  }
})

test('gitInfo returns undefined without HEAD or origin', (t) => {
  const dir = tempDir(t)
  git(dir, 'init')
  assert.equal(gitInfo(dir, true), undefined)

  commit(dir, 'a.ts', 'a\n')
  assert.equal(gitInfo(dir, true), undefined)
})

test('gitInfo diffs against the merge base with origin', (t) => {
  const dir = tempDir(t)
  const seed = join(dir, 'seed')
  const work = join(dir, 'work')
  mkdirSync(seed)
  git(seed, 'init')
  commit(seed, 'plans.ts', 'export const plans = []\n')
  git(dir, 'clone', '--bare', seed, join(dir, 'origin.git'))
  git(dir, 'clone', join(dir, 'origin.git'), work)

  commit(work, 'committed.ts', 'export const a = 1\n')
  appendFileSync(join(work, 'plans.ts'), 'export const pro = {}\n')
  writeFileSync(join(work, 'untracked.ts'), 'export const b = 2\n')
  const status = git(work, 'status', '--porcelain')

  const info = gitInfo(work, true)
  assert.ok(info)
  assert.deepEqual([...info.files].sort(), ['committed.ts', 'plans.ts', 'untracked.ts'])
  assert.equal(info.main, git(work, 'rev-parse', 'refs/remotes/origin/HEAD'))
  assert.equal(info.base, info.main)
  assert.match(info.patch, /^\+export const pro = \{\}$/m)
  assert.equal(git(work, 'status', '--porcelain'), status)

  const plain = gitInfo(work, false)
  assert.ok(plain)
  assert.deepEqual(plain.files, [])
  assert.equal(plain.patch, '')
})

test('filePatch returns one file section', () => {
  const plans = [
    'diff --git a/src/plans.ts b/src/plans.ts',
    'index 1111111..2222222 100644',
    '--- a/src/plans.ts',
    '+++ b/src/plans.ts',
    '@@ -1 +1,2 @@',
    ' export const plans = []',
    '+export const pro = {}',
    '',
  ].join('\n')
  const pricing = [
    'diff --git a/src/pricing.ts b/src/pricing.ts',
    'index 3333333..4444444 100644',
    '--- a/src/pricing.ts',
    '+++ b/src/pricing.ts',
    '@@ -1 +1 @@',
    '-export const page = 1',
    '+export const page = 2',
    '',
  ].join('\n')

  assert.equal(filePatch(plans + pricing, 'src/plans.ts'), plans)
  assert.equal(filePatch(plans + pricing, 'src/pricing.ts'), pricing)
})
