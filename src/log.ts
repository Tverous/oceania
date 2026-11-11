// The one module that decides where Oceania output goes. It loads only Node built-in modules.
// - log(): verbose output (judge texts, Slack logs, errors, stack traces). `oceania serve` sends it to oceania.log.
// - feed(): one item for each message that moves through Oceania. `oceania serve` prints each item as a feed line.
import { appendFileSync } from 'node:fs'
import { inspect } from 'node:util'
import type { FeedItem } from './feed.ts'

/** The log file. When it is not set, log() writes to stderr. */
let file: string | undefined
const subscribers = new Set<(item: FeedItem) => void>()

/** From now on, log() appends to the file at `path`. `undefined` sets stderr again. */
export function logTo(path: string | undefined): void {
  file = path
}

/** Writes verbose output, one entry with a timestamp. It never throws. */
export function log(...args: unknown[]): void {
  if (file !== undefined) {
    try {
      const text = args.map((a) => (typeof a === 'string' ? a : inspect(a))).join(' ')
      appendFileSync(file, `${new Date().toISOString()} ${text}\n`)
      return
    } catch {
      // Oceania cannot write the file. Then stderr gets the output.
    }
  }
  console.error(...args)
}

/** Calls `fn` with each feed item. The result removes `fn`. */
export function onFeed(fn: (item: FeedItem) => void): () => void {
  subscribers.add(fn)
  return () => {
    subscribers.delete(fn)
  }
}

/** Gives `item` to each subscriber. It never throws: the error of a subscriber goes to the log. */
export function feed(item: FeedItem): void {
  for (const fn of [...subscribers]) {
    try {
      fn(item)
    } catch (error) {
      log('Oceania: a feed subscriber failed.', error)
    }
  }
}
