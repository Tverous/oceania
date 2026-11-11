import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSpec } from '../src/github.ts'

const decision = 'Decision: 30 days, no card\n@Tverous decided this in Slack. Tower recorded this decision.'

/** Output of `gh issue view 1 --json title,body,author,comments`. */
const raw = JSON.stringify({
  author: { id: 'MDQ6VXNlcjEyMzQ1Njc4', is_bot: false, login: 'Tverous', name: '' },
  body: 'Launch a Pro plan with a free trial. Add the plan and show it on the pricing page.',
  comments: [
    {
      id: 'IC_kwDOQaBcDs6xYz01',
      author: { login: 'alice-acme' },
      authorAssociation: 'COLLABORATOR',
      body: 'We need a Decision: on the trial length.',
      createdAt: '2026-11-11T19:40:12Z',
      includesCreatedEdit: false,
      isMinimized: false,
      minimizedReason: '',
      reactionGroups: [],
      url: 'https://github.com/Tverous/acme-pricing/issues/1#issuecomment-3512345601',
      viewerDidAuthor: false,
    },
    {
      id: 'IC_kwDOQaBcDs6xYz02',
      author: { login: 'Tverous' },
      authorAssociation: 'OWNER',
      body: decision,
      createdAt: '2026-11-11T19:42:30Z',
      includesCreatedEdit: false,
      isMinimized: false,
      minimizedReason: '',
      reactionGroups: [],
      url: 'https://github.com/Tverous/acme-pricing/issues/1#issuecomment-3512345602',
      viewerDidAuthor: true,
    },
  ],
  title: 'Launch a Pro plan with a free trial',
})

test('parseSpec keeps only decision comments', () => {
  assert.deepEqual(parseSpec(raw, 1), {
    issue: 1,
    title: 'Launch a Pro plan with a free trial',
    body: 'Launch a Pro plan with a free trial. Add the plan and show it on the pricing page.',
    author: 'Tverous',
    decisions: [decision],
  })
})
