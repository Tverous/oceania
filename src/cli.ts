import { parseArgs } from 'node:util'

// Each subcommand loads its own modules, so `oceania hook` loads only Node built-in modules.
const { positionals, values } = parseArgs({ allowPositionals: true, options: { agent: { type: 'string' } } })
const [command] = positionals

if (command === 'hook' && (values.agent === 'copilot' || values.agent === 'claude')) {
  const { runHook } = await import('./adapter.ts')
  await runHook(values.agent)
} else if (command === 'serve') {
  const { readFileSync } = await import('node:fs')
  const { resolve } = await import('node:path')
  const { feedLine } = await import('./feed.ts')
  const { log, logTo, onFeed } = await import('./log.ts')
  const { Memory } = await import('./memory.ts')
  const { createServer, HOLD_MS, reportEvents } = await import('./server.ts')
  const { ghSpecs } = await import('./github.ts')
  const { startSlack } = await import('./slack.ts')
  const { createTools, startMaster } = await import('./master.ts')
  const { claudeJudge } = await import('./judge.ts')
  const { Shadow } = await import('./shadow.ts')
  const env = (name: string): string => {
    const value = process.env[name]
    if (!value) throw new Error(`Set ${name} in .env.`)
    return value
  }

  // stdout is the Oceania feed: one short line for each message. The full texts go to oceania.log.
  logTo(resolve('oceania.log'))
  log('Oceania started.')
  console.log('Oceania feed · http://127.0.0.1:4100 · details in oceania.log')
  const color = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR
  onFeed((item) => {
    console.log(feedLine(item, { width: process.stdout.columns || 100, color }))
    const line = feedLine(item, { width: Infinity, color: false })
    log(item.type === 'delivery' ? `${line}\n${item.text}` : line)
  })

  const memory = new Memory('oceania.db')
  for (const member of JSON.parse(readFileSync('members.json', 'utf8'))) memory.upsertMember(member)
  reportEvents(memory)

  const specs = ghSpecs(env('OCEANIA_REPO'))
  const chat = await startSlack(memory, specs, { bot: env('SLACK_BOT_TOKEN'), app: env('SLACK_APP_TOKEN') })
  // The clone for check_merge. Oceania clones the repo of the first session that reports git data.
  const shadow = new Shadow('.oceania/repo')
  const master = startMaster(memory, createTools(memory, chat, specs, shadow), claudeJudge)
  const server = createServer(memory, {
    settled: master.settled,
    holdMs: HOLD_MS,
    observed: (id, git) => void shadow.update(id, git),
  })
  server.listen(4100, '127.0.0.1', () => {
    console.log('Oceania is ready.')
  })
} else {
  console.error('Usage: oceania serve | oceania hook --agent <copilot|claude>')
  process.exitCode = 1
}
