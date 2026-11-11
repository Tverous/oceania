import { App, webApi } from '@slack/bolt'
import type { BlockAction, ButtonAction, types } from '@slack/bolt'
import { homeView } from './board.ts'
import { decide } from './master.ts'
import type { Chat, Specs } from './master.ts'
import type { Memory } from './memory.ts'
import { mrkdwn, who } from './text.ts'
import { STAGE_LABELS } from './types.ts'
import type { Member } from './types.ts'

/** Wait after a change in Memory before Tower updates the boards. */
const BOARD_DEBOUNCE_MS = 1_000
/** The shared channel (spec §7.1). Slack does not let a channel use the name of a user, and the bot user is `tower`. */
const SHARED = 'tower-activity'
/**
 * Most characters for one text from Memory. A section has at most two such texts and short labels,
 * so it stays within the Slack limit of 3,000 characters for one text.
 */
const FIELD = 1_000

/**
 * Connects Tower to Slack in Socket Mode: the shared channel, the conflict channels, the decision buttons,
 * and the board in App Home (spec §7.6, §7.10).
 */
export async function startSlack(memory: Memory, specs: Specs, tokens: { bot: string; app: string }): Promise<Chat> {
  const app = new App({ token: tokens.bot, appToken: tokens.app, socketMode: true })
  const { client } = app

  /** Invites each member that has a Slack user. A member who is in the channel already is not an error. */
  async function invite(channel: string, members: Member[]): Promise<void> {
    for (const { slackId } of members) {
      if (slackId) await except('already_in_channel', client.conversations.invite({ channel, users: slackId }))
    }
  }

  /** Creates the shared channel, or joins it when it exists. Gives the channel id. */
  async function joinShared(): Promise<string> {
    const created = await except('name_taken', client.conversations.create({ name: SHARED }))
    if (created) return idOf(created.channel)
    let cursor: string | undefined
    do {
      const page = await client.conversations.list({ exclude_archived: true, limit: 1000, cursor })
      const found = page.channels?.find((c) => c.name === SHARED)
      if (found) {
        await client.conversations.join({ channel: idOf(found) })
        return idOf(found)
      }
      cursor = page.response_metadata?.next_cursor
    } while (cursor)
    throw new Error(
      `Tower cannot find the public channel #${SHARED}. A private channel, an archived channel, a user, or a user group uses this name.`,
    )
  }

  app.event('app_home_opened', async ({ event }) => {
    await client.views.publish({ user_id: event.user, view: homeView(memory.snapshot()) })
  })

  app.action<BlockAction<ButtonAction>>(/^decide-\d+$/, async ({ ack, action, body }) => {
    await ack()
    // Tower puts the buttons only in conflict channel messages, with the channel name as the value.
    const { channel, message, user } = body
    if (!channel || !message || action.value === undefined) return
    const result = await decide(memory, specs, action.value, Number(action.action_id.slice('decide-'.length)), user.id)
    if (!result.ok) {
      await client.chat.postEphemeral({ channel: channel.id, user: user.id, text: mrkdwn(result.reason) })
      return
    }
    // Keep the question. Replace the buttons with the decision.
    const blocks: types.KnownBlock[] = message.blocks.filter((b: types.KnownBlock) => b.type !== 'actions')
    blocks.push(section(`*Decision:* ${fit(result.option)}\n<@${user.id}> decided this.`))
    await client.chat.update({ channel: channel.id, ts: message.ts, text: `Decision: ${fit(result.option)}`, blocks })
  })

  // The first change starts the timer, so a stream of changes cannot delay the board.
  let board: NodeJS.Timeout | undefined
  memory.onChange(() => {
    board ??= setTimeout(() => {
      board = undefined
      const view = homeView(memory.snapshot())
      for (const { slackId } of memory.members()) {
        if (!slackId) continue
        client.views.publish({ user_id: slackId, view }).catch((error) => {
          console.error('Tower: the board update failed.', error)
        })
      }
    }, BOARD_DEBOUNCE_MS)
  })

  await app.start()
  for (const m of memory.members()) {
    const found = await except('users_not_found', client.users.lookupByEmail({ email: m.email }))
    memory.upsertMember({ ...m, slackId: found?.user?.id })
  }
  const shared = await joinShared()
  await invite(shared, memory.members())

  return {
    async post(text) {
      await client.chat.postMessage({ channel: shared, text: mrkdwn(text) })
    },
    async openConflict(c) {
      const { channel, author, question, options } = c
      if (!channel || !author || !question || !options) throw new Error(`Conflict #${c.id} has no open question.`)
      const s = memory.snapshot()
      const sessions = s.sessions.filter((v) => c.sessions.includes(v.id))
      const spec = memory.memberByGithub(author)
      const channelId = idOf((await client.conversations.create({ name: channel })).channel)
      await invite(
        channelId,
        s.members.filter((m) => m.email === spec?.email || sessions.some((v) => v.member === m.email)),
      )
      await client.chat.postMessage({
        channel: channelId,
        text: `Conflict #${c.id}. Open question: ${fit(question)}`,
        blocks: [
          section(`*Conflict #${c.id}*: ${fit(c.summary)}\n${STAGE_LABELS[c.stage]} · ${c.impact} impact`),
          ...sessions.map((v) => section(`*${fit(who(v.name, v.agent))}*\nTask: ${fit(v.task?.summary ?? 'none')}`)),
          section(`*Open question:* ${fit(question)}\n${fit(spec?.name ?? author)} decides. Select one option.`),
          {
            type: 'actions',
            elements: options.map((text, i) => ({
              type: 'button',
              action_id: `decide-${i}`,
              value: channel,
              text: { type: 'plain_text', text },
            })),
          },
        ],
      })
    },
  }
}

/** Waits for a Slack call. Gives undefined when Slack answers with the expected error `code`. */
async function except<T>(code: string, call: Promise<T>): Promise<T | undefined> {
  try {
    return await call
  } catch (error) {
    if (!(error instanceof webApi.WebAPIPlatformError && error.data.error === code)) throw error
  }
}

/** Slack types make each response field optional. A successful call always gives the id. */
function idOf(o: { id?: string } | undefined): string {
  if (!o?.id) throw new Error('Slack did not give an id.')
  return o.id
}

function section(text: string): types.SectionBlock {
  return { type: 'section', text: { type: 'mrkdwn', text } }
}

function fit(raw: string): string {
  return mrkdwn(raw, FIELD)
}
