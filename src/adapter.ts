// `oceania hook` runs on every agent hook, also on computers without `npm install`.
// This module loads only Node built-in modules at run time.
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { json } from 'node:stream/consumers'
import { gitInfo } from './git.ts'
import type { HookPayload } from './server.ts'
import type { AgentKind, HookDecision } from './types.ts'

const DEFAULT_URL = 'http://127.0.0.1:4100'
/** Stop can wait for the master agent (90 s) and then for a decision (480 s). */
const STOP_TIMEOUT_MS = 595_000
const TIMEOUT_MS = 10_000

/** POSTs JSON to Oceania at `OCEANIA_URL` and returns the JSON response. Rejects on a status that is not 200. */
export function post(path: string, body: unknown, timeoutMs: number): Promise<unknown> {
  const url = new URL(path, process.env.OCEANIA_URL ?? DEFAULT_URL)
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise((done, fail) => {
    const options = { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(timeoutMs) }
    const req = request(url, options, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        fail(new Error(`Oceania returned HTTP ${res.statusCode}.`))
        return
      }
      json(res).then(done, fail)
    })
    req.on('error', fail)
    req.end(JSON.stringify(body))
  })
}

/** Writes an Oceania decision in the hook output format of `agent` (spec §7.2). Undefined when there is nothing to send. */
export function hookOutput(agent: AgentKind, event: string, d: HookDecision): object | undefined {
  if (d.deny !== undefined) {
    const deny = { permissionDecision: 'deny', permissionDecisionReason: d.deny }
    return agent === 'copilot' ? deny : { hookSpecificOutput: { hookEventName: 'PreToolUse', ...deny } }
  }
  if (d.block !== undefined) return { decision: 'block', reason: d.block }
  if (d.context !== undefined) {
    const context = { additionalContext: d.context }
    return agent === 'copilot' ? context : { hookSpecificOutput: { hookEventName: event, ...context } }
  }
  return undefined
}

/** Sends one hook payload from stdin to Oceania and prints the answer. On any error, prints nothing (spec §7.2). */
export async function runHook(agent: AgentKind): Promise<void> {
  try {
    const payload = (await json(process.stdin)) as HookPayload
    const member = process.env.OCEANIA_MEMBER
    if (!member) return
    const event = payload.hook_event_name
    // Git facts go with every event, so Oceania can register a session after a restart.
    const git = gitInfo(payload.cwd, event === 'PostToolUse')
    const timeout = event === 'Stop' ? STOP_TIMEOUT_MS : TIMEOUT_MS
    const decision = (await post('/hook', { agent, member, payload, git }, timeout)) as HookDecision
    const output = hookOutput(agent, event, decision)
    if (output) process.stdout.write(JSON.stringify(output))
  } catch {
    // Exit 0 with no output, so the agent continues without Oceania.
  }
}
