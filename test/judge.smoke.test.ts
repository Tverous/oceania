import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Memory } from '../src/memory.ts'
import { claudeJudge } from '../src/judge.ts'
import { createTools, roundPrompt } from '../src/master.ts'
import type { Chat, Specs } from '../src/master.ts'
import { Shadow } from '../src/shadow.ts'
import { decisionComment, resume } from '../src/text.ts'
import type { Conflict } from '../src/types.ts'

const ALICE_TASK = 'Add the Pro plan from #1 to src/plans.ts: 14-day trial, card required.'
const BOB_TASK = 'Show the Pro plan from #1 on the pricing page. Use a 30-day free trial with no card.'

const ALICE_PATCH = `diff --git a/src/plans.ts b/src/plans.ts
index 3b18e51..9c2d4f0 100644
--- a/src/plans.ts
+++ b/src/plans.ts
@@ -8,4 +8,5 @@ export interface Plan {
 export const plans: Plan[] = [
   { id: 'free', name: 'Free', price: 0 },
   { id: 'team', name: 'Team', price: 12 },
+  { id: 'pro', name: 'Pro', price: 29, trialDays: 14, cardRequired: true },
 ]
`

const BOB_PATCH = `diff --git a/src/pricing.ts b/src/pricing.ts
index 5d1a2b7..e8f03c4 100644
--- a/src/pricing.ts
+++ b/src/pricing.ts
@@ -3,5 +3,8 @@ import { plans } from './plans.ts'
 export function pricingPage(): string {
   const rows = plans.map((p) => {
-    return \`<li>\${p.name}: $\${p.price}/month</li>\`
+    const trial = p.trialDays ? \` \${p.trialDays}-day free trial\` : ''
+    const card = p.trialDays && !p.cardRequired ? ', no card required' : ''
+    return \`<li>\${p.name}: $\${p.price}/month\${trial}\${card}</li>\`
   })
`

test('real judge handles the demo sequence', { skip: !process.env.ANTHROPIC_API_KEY, timeout: 300_000 }, async () => {
  const memory = new Memory(':memory:')
  memory.upsertMember({ email: 'alice@example.com', name: 'Alice', github: 'alice-acme', slackId: 'U_ALICE' })
  memory.upsertMember({ email: 'bob@example.com', name: 'Bob', github: 'bob-acme', slackId: 'U_BOB' })
  memory.upsertMember({ email: 'tverous@example.com', name: 'Tverous', github: 'Tverous', slackId: 'U_TVEROUS' })

  const opened: Conflict[] = []
  const chat: Chat = {
    async post(text) {
      console.log(`[post_activity] ${text}`)
    },
    async openConflict(c) {
      console.log(`[openConflict] ${JSON.stringify(c)}`)
      opened.push(c)
    },
  }
  const specs: Specs = {
    async get(issue) {
      if (issue !== 1) throw new Error(`Issue #${issue} does not exist.`)
      return {
        issue,
        title: 'Launch a Pro plan with a free trial',
        body: 'Launch a Pro plan with a free trial. Add the plan and show it on the pricing page.',
        author: 'Tverous',
        decisions: memory.decisions(issue).map((d) => decisionComment(d.option, d.author)),
      }
    },
    async comment() {},
  }
  // The sessions report no git data, so check_merge finds no shadow refs.
  const tools = createTools(memory, chat, specs, new Shadow(join(tmpdir(), 'tower-unused-shadow')))

  let cursor = memory.lastEventId()
  async function round(step: number): Promise<void> {
    const prompt = roundPrompt(memory.eventsAfter(cursor))
    const start = performance.now()
    await claudeJudge(prompt, tools)
    console.log(`[step ${step}] round took ${Math.round(performance.now() - start)} ms`)
    cursor = memory.lastEventId()
  }
  const bobNotes = () => memory.notes().filter((n) => n.session === 'b' && n.text.startsWith('Tower note:'))

  // 1. Alice adds the Pro plan with a 14-day trial that requires a card.
  memory.register({ id: 'a', agent: 'Copilot CLI', member: 'alice@example.com', main: 'm1' })
  memory.setStatus('a', 'working')
  memory.addTask({ session: 'a', summary: ALICE_TASK, issue: 1 })
  memory.observe('a', { files: ['src/plans.ts'], patch: ALICE_PATCH, main: 'm1' })
  await round(1)
  assert.equal(opened.length, 0)
  assert.deepEqual(memory.notes(), [])

  // 2. Bob shows the Pro plan with a 30-day trial and no card.
  memory.register({ id: 'b', agent: 'Claude Code', member: 'bob@example.com', main: 'm1' })
  memory.setStatus('b', 'working')
  memory.addTask({ session: 'b', summary: BOB_TASK, issue: 1 })
  await round(2)
  assert.equal(opened.length, 1)
  const channel = opened[0].channel ?? ''
  assert.ok(opened[0].options && opened[0].options.length >= 2 && opened[0].options.length <= 3)
  assert.equal(memory.conflictByChannel(channel)?.impact, 'high')
  // Conflict B: Bob's page needs the Pro plan that Alice adds (spec §8 step 5, the before stage).
  const duplicate = memory.conflicts().some((c) => c.impact === 'low' && c.sessions.includes('b'))
  assert.ok(bobNotes().length > 0 || duplicate, 'Bob has a Tower note or a low impact conflict for the Pro plan')

  // 3. Tverous decides. As the Stop hook does, each session takes the decision and works again.
  // Then Bob changes the pricing page, and Alice pushes.
  memory.decide(channel, '30 days, no card', resume(1, 'Tverous', '30 days, no card'))
  for (const id of ['a', 'b']) {
    memory.takeNotes(id, true)
    memory.setStatus(id, 'working')
  }
  const before = bobNotes().length
  memory.observe('b', { files: ['src/pricing.ts'], patch: BOB_PATCH, main: 'm1' })
  memory.observe('a', { files: [], patch: '', main: 'm2' })
  await round(3)
  assert.ok(bobNotes().length > before, 'Bob has a new Tower note')
  assert.equal(opened.length, 1)
  console.log(`[conflicts] ${JSON.stringify(memory.conflicts())}`)
  console.log(`[notes] ${JSON.stringify(memory.notes())}`)
  console.log(`[posts] ${JSON.stringify(memory.posts())}`)
})
