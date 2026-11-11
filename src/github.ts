import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Specs } from './master.ts'
import type { Spec } from './types.ts'

const run = promisify(execFile)

/**
 * Most time for one gh call. On a stalled network, gh can wait for minutes. The timeout makes this an error,
 * so the judge round ends and the decision goes on to Slack.
 */
const GH_TIMEOUT_MS = 30_000

/** The fields of `gh issue view --json title,body,author,comments` that Oceania reads. */
interface Issue {
  title: string
  body: string
  author: { login: string }
  comments: { body: string }[]
}

export function parseSpec(raw: string, issue: number): Spec {
  const { title, body, author, comments } = JSON.parse(raw) as Issue
  return {
    issue,
    title,
    body,
    author: author.login,
    decisions: comments.map((c) => c.body).filter((b) => b.startsWith('Decision:')),
  }
}

export function ghSpecs(repo: string, timeoutMs = GH_TIMEOUT_MS): Specs {
  /** Runs gh. SIGKILL makes sure that gh stops at the timeout. */
  async function gh(args: string[]): Promise<string> {
    try {
      return (await run('gh', args, { timeout: timeoutMs, killSignal: 'SIGKILL' })).stdout
    } catch (error) {
      // At the timeout, Node gives only "Command failed". Say the cause to the model and in the log.
      const { killed, code } = error as { killed?: boolean; code?: unknown }
      if (killed && code === null) {
        throw new Error(`Oceania stopped "gh ${args.slice(0, 3).join(' ')}" after ${timeoutMs / 1000} seconds.`, { cause: error })
      }
      throw error
    }
  }
  return {
    async get(issue) {
      return parseSpec(await gh(['issue', 'view', String(issue), '--repo', repo, '--json', 'title,body,author,comments']), issue)
    },
    async comment(issue, body) {
      await gh(['issue', 'comment', String(issue), '--repo', repo, '--body', body])
    },
  }
}
