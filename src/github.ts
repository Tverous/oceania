import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Specs } from './master.ts'
import type { Spec } from './types.ts'

const run = promisify(execFile)

/** The fields of `gh issue view --json title,body,author,comments` that Tower reads. */
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

export function ghSpecs(repo: string): Specs {
  return {
    async get(issue) {
      const { stdout } = await run('gh', ['issue', 'view', String(issue), '--repo', repo, '--json', 'title,body,author,comments'])
      return parseSpec(stdout, issue)
    },
    async comment(issue, body) {
      await run('gh', ['issue', 'comment', String(issue), '--repo', repo, '--body', body])
    },
  }
}
