import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { App } from '@slack/bolt'
import { Memory } from '../src/memory.ts'
import type { Specs } from '../src/master.ts'
import { startSlack } from '../src/slack.ts'

type Call = (args: Record<string, unknown>) => Promise<unknown>

/** A Bolt app without Slack. `published` has the user of each `views.publish` call. */
function fakeApp() {
  const published: string[] = []
  const events: Record<string, (args: { event: { user: string } }) => Promise<void>> = {}
  const failures = new Set<string>()
  const ok: Call = async () => ({ ok: true })
  const app = {
    client: {
      conversations: { create: async () => ({ ok: true, channel: { id: 'C1' } }), list: ok, join: ok, invite: ok },
      users: { lookupByEmail: async ({ email }: { email: string }) => ({ ok: true, user: { id: `U_${email}` } }) },
      chat: { postMessage: ok, update: ok, postEphemeral: ok },
      views: {
        publish: async ({ user_id }: { user_id: string }) => {
          published.push(user_id)
          if (failures.delete(user_id)) throw new Error('The network failed.')
          return { ok: true }
        },
      },
    },
    event: (name: string, fn: (typeof events)[string]) => {
      events[name] = fn
    },
    action: () => {},
    start: async () => {},
  }
  return { app: app as unknown as App, published, events, failures }
}

const SPECS: Specs = {
  get: async () => {
    throw new Error('No spec.')
  },
  comment: async () => {},
}

test('the board publishes only a changed view, and app_home_opened always publishes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-11-11T19:40:01.000Z') })
  t.mock.method(console, 'error', () => {})
  const slack = fakeApp()
  const m = new Memory(':memory:')
  for (const email of ['t', 'a', 'b']) m.upsertMember({ email, name: email })
  await startSlack(m, SPECS, { bot: 'x', app: 'y' }, slack.app)
  /** Ends the board wait, then lets the publish calls finish. */
  const refresh = async () => {
    t.mock.timers.tick(1_000)
    await new Promise((done) => setImmediate(done))
    return slack.published.splice(0).sort()
  }
  await refresh()

  m.register({ id: 's', agent: 'Claude Code', member: 'a' })
  assert.deepEqual(await refresh(), ['U_a', 'U_b', 'U_t'], 'a new session: every member gets the board')

  t.mock.timers.tick(20_000)
  m.register({ id: 's', agent: 'Claude Code', member: 'a' })
  m.setStatus('s', 'idle')
  assert.deepEqual(await refresh(), [], 'the same view in the same minute: no publish')

  await slack.events.app_home_opened({ event: { user: 'U_t' } })
  await slack.events.app_home_opened({ event: { user: 'U_t' } })
  assert.deepEqual(slack.published.splice(0), ['U_t', 'U_t'], 'app_home_opened always publishes')

  slack.failures.add('U_a')
  m.setStatus('s', 'working')
  assert.deepEqual(await refresh(), ['U_a', 'U_b', 'U_t'], 'a changed view: every member gets the board')
  m.register({ id: 's', agent: 'Claude Code', member: 'a' })
  assert.deepEqual(await refresh(), ['U_a'], 'the same view again: only the member whose publish failed')
})
