import { parseArgs } from 'node:util'

// Each subcommand loads its own modules, so `tower hook` loads only Node built-in modules.
const { positionals, values } = parseArgs({ allowPositionals: true, options: { agent: { type: 'string' } } })
const [command] = positionals

if (command === 'hook' && (values.agent === 'copilot' || values.agent === 'claude')) {
  const { runHook } = await import('./adapter.ts')
  await runHook(values.agent)
} else if (command === 'serve') {
  const { readFileSync } = await import('node:fs')
  const { Memory } = await import('./memory.ts')
  const { createServer, HOLD_MS } = await import('./server.ts')
  const { ghSpecs } = await import('./github.ts')
  const { startSlack } = await import('./slack.ts')
  const { createTools, startMaster } = await import('./master.ts')
  const { claudeJudge } = await import('./judge.ts')
  const env = (name: string): string => {
    const value = process.env[name]
    if (!value) throw new Error(`Set ${name} in .env.`)
    return value
  }

  const memory = new Memory('tower.db')
  for (const member of JSON.parse(readFileSync('members.json', 'utf8'))) memory.upsertMember(member)

  // Print each new event, so the team can see what Tower does.
  let last = memory.lastEventId()
  memory.onChange(() => {
    for (const event of memory.eventsAfter(last)) {
      console.log(event.text)
      last = event.id
    }
  })

  const specs = ghSpecs(env('TOWER_REPO'))
  const chat = await startSlack(memory, specs, { bot: env('SLACK_BOT_TOKEN'), app: env('SLACK_APP_TOKEN') })
  const master = startMaster(memory, createTools(memory, chat, specs), claudeJudge)
  createServer(memory, { settled: master.settled, holdMs: HOLD_MS }).listen(4100, '127.0.0.1', () => {
    console.log('Tower is ready at http://127.0.0.1:4100.')
  })
} else {
  console.error('Usage: tower serve | tower hook --agent <copilot|claude>')
  process.exitCode = 1
}
