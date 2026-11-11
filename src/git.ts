import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { GitInfo } from './types.ts'

/** Largest git output that gitInfo reads. Node's default is 1 MiB. */
const MAX_OUTPUT = 64 * 1024 * 1024

/** Return `host/owner/name` in lower case, so HTTPS, SSH, and scp-style origins of one repo match. */
export function normalizeRepo(url: string): string {
  let repo = url
  if (url.includes('://')) {
    const { hostname, pathname } = new URL(url)
    repo = hostname + pathname
  } else {
    const scp = /^(?:[^@/]+@)?([^/:]+):\/*(.*)$/.exec(url)
    if (scp) repo = `${scp[1]}/${scp[2]}`
  }
  return repo.replace(/(\.git)?\/*$/, '').toLowerCase()
}

/**
 * Collect the repo facts for one clone. Return undefined when a git command fails.
 * With `withDiff`, the diff is the working tree, untracked files included, against the merge base with origin.
 */
export function gitInfo(cwd: string, withDiff: boolean): GitInfo | undefined {
  const git = (args: string[], env = process.env) =>
    execFileSync('git', args, { cwd, env, encoding: 'utf8', maxBuffer: MAX_OUTPUT, stdio: ['ignore', 'pipe', 'ignore'] })
  try {
    const root = git(['rev-parse', '--show-toplevel']).trim()
    const repo = normalizeRepo(git(['remote', 'get-url', 'origin']).trim())
    const main = git(['rev-parse', '--verify', 'refs/remotes/origin/HEAD']).trim()
    const base = git(['merge-base', 'HEAD', 'refs/remotes/origin/HEAD']).trim()
    if (!withDiff) return { root, repo, base, main, files: [], patch: '' }

    // A copy of the index keeps the agent's own index unchanged.
    const dir = mkdtempSync(join(tmpdir(), 'oceania-index-'))
    try {
      const env = { ...process.env, GIT_INDEX_FILE: join(dir, 'index') }
      copyFileSync(resolve(cwd, git(['rev-parse', '--git-path', 'index']).trim()), env.GIT_INDEX_FILE)
      git(['add', '-A'], env)
      // diff-index is plumbing, so user settings such as color, renames, and prefixes do not change its output.
      const names = git(['diff-index', '--cached', '--name-only', '-z', base], env)
      const patch = git(['-c', 'core.quotePath=false', 'diff-index', '--cached', '-p', base], env)
      return { root, repo, base, main, files: names.split('\0').filter(Boolean), patch }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  } catch {
    return undefined
  }
}

/** Return the section of `patch` for one repo-relative path, or an empty string. */
export function filePatch(patch: string, path: string): string {
  const header = `diff --git a/${path} b/${path}\n`
  return patch.split(/^(?=diff --git )/m).find((section) => section.startsWith(header)) ?? ''
}
