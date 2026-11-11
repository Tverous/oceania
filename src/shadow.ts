import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { MAX_TEXT } from './text.ts'
import type { GitInfo } from './types.ts'

/** Longest run of one git command, so that a stuck fetch does not stop the queue. */
const GIT_TIMEOUT_MS = 60_000
/** Longest run of `npm test` in a merged worktree. */
export const TEST_TIMEOUT_MS = 120_000
/** The secrets in the .env of Tower. The tests run code from the agents, so they do not get these values. */
const SECRETS = ['ANTHROPIC_API_KEY', 'SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN']

/** The author and committer of shadow commits. Tower does not use the git config of the user for them. */
const IDENTITY = {
  GIT_AUTHOR_NAME: 'Tower',
  GIT_AUTHOR_EMAIL: 'tower@localhost',
  GIT_COMMITTER_NAME: 'Tower',
  GIT_COMMITTER_EMAIL: 'tower@localhost',
}

/** The HTTPS clone URL of a normalized repo: `github.com/o/r` becomes `https://github.com/o/r.git`. */
export function cloneUrl(repo: string): string {
  return `https://${repo}.git`
}

export type MergeResult =
  | { status: 'missing'; session: string }
  | { status: 'clean'; tree: string }
  | { status: 'conflict'; tree: string; files: string[] }

export type TestResult =
  | Exclude<MergeResult, { status: 'clean' }>
  | { status: 'untested' }
  | { status: 'passed' }
  | { status: 'failed'; output: string }
  | { status: 'timeout'; output: string }

type ShadowInput = Pick<GitInfo, 'repo' | 'base' | 'patch'>

interface Run {
  code: number
  stdout: string
}

/** Runs git. Rejects when the exit code is not 0 and not in `ok`. */
function git(
  cwd: string,
  args: string[],
  o: { env?: NodeJS.ProcessEnv; input?: string; ok?: number[] } = {},
): Promise<Run> {
  return new Promise((done, fail) => {
    const env = { ...process.env, ...IDENTITY, GIT_TERMINAL_PROMPT: '0', ...o.env }
    const child = execFile('git', args, { cwd, env, timeout: GIT_TIMEOUT_MS }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : -1) : 0
      if (code === 0 || o.ok?.includes(code)) done({ code, stdout })
      else fail(new Error(`git ${args.join(' ')} failed: ${stderr.trim() || error?.message}`))
    })
    // git can exit before it reads stdin. The exit code reports that failure, so ignore the EPIPE.
    child.stdin?.on('error', () => {})
    child.stdin?.end(o.input)
  })
}

/**
 * Runs `npm test` in `cwd`, in a process group of its own. On a timeout, Tower kills the group,
 * so that no test process stays. `output` is stdout and stderr, at most about MAX_TEXT bytes.
 */
function npmTest(cwd: string): Promise<{ code: number | null; output: string; timedOut: boolean }> {
  // The tests are in a different package, so they do not get the npm values of the Tower process.
  const env: NodeJS.ProcessEnv = { npm_config_update_notifier: 'false' }
  for (const [name, value] of Object.entries(process.env)) {
    if (!/^npm_/i.test(name) && !SECRETS.includes(name)) env[name] = value
  }
  return new Promise((done, fail) => {
    const child = spawn('npm', ['test'], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []
    let size = 0
    const collect = (chunk: Buffer) => {
      if (size < MAX_TEXT) chunks.push(chunk)
      size += chunk.length
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    const kill = () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL')
      } catch {
        // The group has no processes.
      }
    }
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      kill()
    }, TEST_TIMEOUT_MS)
    child.on('error', (error) => {
      clearTimeout(timer)
      fail(error)
    })
    // A test can start a process that does not stop, for example a server. When npm stops, Tower kills it,
    // so that its open stdout does not keep `close` from coming.
    child.on('exit', kill)
    child.on('close', (code) => {
      clearTimeout(timer)
      done({ code, output: Buffer.concat(chunks).toString(), timedOut })
    })
  })
}

/**
 * Shadow refs (spec §10, P1): Tower keeps a bare clone of the repo, and `refs/tower/<session>` in it
 * is the base commit of the session with the session diff on top. With these refs, `git merge-tree`
 * merges the work of two sessions before they push. All git work runs in one queue, in the background.
 */
export class Shadow {
  readonly dir: string
  #url: (repo: string) => string
  /** The origin URL of the clone, after the first use. */
  #origin: string | undefined
  #queue: Promise<unknown> = Promise.resolve()
  /** The latest git data of each session that waits in the queue. */
  #next = new Map<string, ShadowInput>()
  /** The base and patch of each ref that this process wrote. */
  #written = new Map<string, string>()

  /** `url` gives the clone URL of a normalized repo. Tests give a local bare repo. */
  constructor(dir: string, url: (repo: string) => string = cloneUrl) {
    this.dir = resolve(dir)
    this.#url = url
  }

  /**
   * Points `refs/tower/<session>` at `base` with `patch` on top. An empty patch points the ref at `base`.
   * The result never rejects: Tower logs the errors, because this runs after a hook.
   */
  update(session: string, git: ShadowInput): Promise<void> {
    this.#next.set(session, git)
    return this.#serial(async () => {
      // A later update of the same session replaces the data before this job runs.
      const next = this.#next.get(session)
      this.#next.delete(session)
      if (!next) return
      try {
        await this.#write(session, next)
      } catch (error) {
        // An old ref gives a wrong merge result, so remove it. For example, git apply cannot apply a binary diff.
        this.#written.delete(session)
        await this.#git(['update-ref', '-d', `refs/tower/${session}`]).catch(() => {})
        throw error
      }
    }).catch((error) => console.error(`Tower: the shadow ref of session ${session} failed.`, error))
  }

  /** Merges the shadow refs of sessions `a` and `b` with `git merge-tree`. No work tree changes. */
  merge(a: string, b: string): Promise<MergeResult> {
    return this.#serial(() => this.#merge(a, b))
  }

  /**
   * Merges the shadow refs of sessions `a` and `b`. If the merge has no conflicts, checks out the merged tree
   * in a temporary worktree and runs `npm test` there. Tower always removes the worktree.
   */
  async test(a: string, b: string): Promise<TestResult> {
    const tmp = await mkdtemp(join(tmpdir(), 'tower-worktree-'))
    const work = join(tmp, 'work')
    try {
      const merged = await this.#serial(async () => {
        const result = await this.#merge(a, b)
        if (result.status !== 'clean') return result
        const parents = ['-p', `refs/tower/${a}`, '-p', `refs/tower/${b}`]
        const message = `Tower merge of sessions ${a} and ${b}`
        const commit = await this.#git(['commit-tree', '--no-gpg-sign', ...parents, '-m', message, result.tree])
        await this.#git(['worktree', 'add', '--detach', '--quiet', work, commit.stdout.trim()])
        return result
      })
      if (merged.status !== 'clean') return merged
      const pkg = join(work, 'package.json')
      if (!existsSync(pkg) || typeof JSON.parse(await readFile(pkg, 'utf8')).scripts?.test !== 'string') {
        return { status: 'untested' }
      }
      // The tests run outside the queue, so the shadow refs stay up to date while they run.
      const { code, output, timedOut } = await npmTest(work)
      if (timedOut) return { status: 'timeout', output }
      return code === 0 ? { status: 'passed' } : { status: 'failed', output }
    } finally {
      await rm(tmp, { recursive: true, force: true })
      // `git worktree prune` removes the data of the deleted worktree from the clone.
      if (existsSync(this.dir)) {
        await this.#serial(() => this.#git(['worktree', 'prune'])).catch((error) => {
          console.error('Tower: git worktree prune failed.', error)
        })
      }
    }
  }

  /** Runs `fn` after all earlier jobs. A failed job does not stop the next job. */
  #serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(fn)
    this.#queue = run.catch(() => {})
    return run
  }

  async #merge(a: string, b: string): Promise<MergeResult> {
    for (const session of [a, b]) {
      if (!existsSync(this.dir) || !(await this.#has(`refs/tower/${session}`))) return { status: 'missing', session }
    }
    const args = ['-c', 'core.quotePath=false', 'merge-tree', '--write-tree', '--name-only']
    const { code, stdout } = await this.#git([...args, `refs/tower/${a}`, `refs/tower/${b}`], { ok: [1] })
    // The output is the tree, then on a conflict one line for each file, then an empty line and messages.
    const [tree, ...lines] = stdout.split('\n')
    if (code === 0) return { status: 'clean', tree }
    const end = lines.indexOf('')
    return { status: 'conflict', tree, files: end === -1 ? lines : lines.slice(0, end) }
  }

  async #write(session: string, { repo, base, patch }: ShadowInput): Promise<void> {
    // The clone has one repo. Sessions in other repos get no shadow ref.
    if (!(await this.#ready(repo))) return
    const key = `${base}\n${patch}`
    if (this.#written.get(session) === key) return
    // Fetch only for a base that the clone does not have, so most tool calls do not use the network.
    if (!(await this.#has(`${base}^{commit}`))) await this.#git(['fetch', '--quiet', 'origin'])
    let commit = base
    if (patch) {
      const tmp = await mkdtemp(join(tmpdir(), 'tower-shadow-'))
      try {
        const env = { GIT_INDEX_FILE: join(tmp, 'index') }
        await this.#git(['read-tree', base], { env })
        await this.#git(['apply', '--cached', '--whitespace=nowarn'], { env, input: patch })
        const tree = (await this.#git(['write-tree'], { env })).stdout.trim()
        const message = `Tower shadow of session ${session}`
        commit = (await this.#git(['commit-tree', '--no-gpg-sign', '-p', base, '-m', message, tree])).stdout.trim()
      } finally {
        await rm(tmp, { recursive: true, force: true })
      }
    }
    await this.#git(['update-ref', `refs/tower/${session}`, commit])
    this.#written.set(session, key)
  }

  /** Clones the repo on first use. False when the clone is of a different repo. */
  async #ready(repo: string): Promise<boolean> {
    if (this.#origin === undefined) {
      if (!existsSync(this.dir)) {
        await mkdir(dirname(this.dir), { recursive: true })
        await git(dirname(this.dir), ['clone', '--bare', '--quiet', this.#url(repo), this.dir])
      }
      this.#origin = (await this.#git(['config', '--get', 'remote.origin.url'])).stdout.trim()
    }
    return this.#origin === this.#url(repo)
  }

  async #has(rev: string): Promise<boolean> {
    return (await this.#git(['rev-parse', '--verify', '--quiet', rev], { ok: [1] })).code === 0
  }

  #git(args: string[], o?: { env?: NodeJS.ProcessEnv; input?: string; ok?: number[] }): Promise<Run> {
    return git(this.dir, args, o)
  }
}
