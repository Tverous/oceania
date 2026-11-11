import { DatabaseSync } from 'node:sqlite'
import type { SQLOutputValue, SQLTagStore } from 'node:sqlite'
import { filePatch } from './git.ts'
import { who } from './text.ts'
import { STAGE_LABELS } from './types.ts'
import type {
  Conflict,
  Decision,
  Diff,
  EventKind,
  GitInfo,
  Member,
  Note,
  Post,
  Push,
  Session,
  Snapshot,
  Status,
  Task,
  OceaniaEvent,
} from './types.ts'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS members (
  email TEXT PRIMARY KEY, name TEXT NOT NULL, github TEXT, slackId TEXT);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, agent TEXT NOT NULL, member TEXT NOT NULL,
  repo TEXT, root TEXT, base TEXT, main TEXT, status TEXT NOT NULL, issue INTEGER,
  cursor INTEGER NOT NULL, updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY, session TEXT NOT NULL, summary TEXT NOT NULL, issue INTEGER,
  at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS diffs (
  session TEXT PRIMARY KEY, version INTEGER NOT NULL, files TEXT NOT NULL, patch TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS seen (
  session TEXT NOT NULL, other TEXT NOT NULL, version INTEGER NOT NULL,
  PRIMARY KEY (session, other));
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY, session TEXT NOT NULL, text TEXT NOT NULL,
  blocking INTEGER NOT NULL, delivered INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS conflicts (
  id INTEGER PRIMARY KEY, sessions TEXT NOT NULL, files TEXT NOT NULL, summary TEXT NOT NULL,
  stage TEXT NOT NULL, impact TEXT NOT NULL, status TEXT NOT NULL, issue INTEGER,
  channel TEXT UNIQUE, author TEXT, question TEXT, options TEXT, decision TEXT,
  updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS decisions (
  issue INTEGER NOT NULL, option TEXT NOT NULL, author TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, session TEXT, text TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS meta (name TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pushes (
  id INTEGER PRIMARY KEY, session TEXT NOT NULL, files TEXT NOT NULL, patch TEXT NOT NULL,
  main TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY, text TEXT NOT NULL, at INTEGER NOT NULL);
`

type Row = Record<string, SQLOutputValue>
type ConflictInput = Pick<Conflict, 'sessions' | 'summary' | 'stage' | 'impact' | 'status' | 'issue'> &
  Partial<Pick<Conflict, 'id' | 'files'>>

const names = new Intl.ListFormat('en')

/** Turns a row into a record. NULL columns stay absent. `json` columns become arrays. */
function record<T>(row: Row, json: readonly string[] = []): T {
  const entries = Object.entries(row).filter(([, v]) => v !== null)
  return Object.fromEntries(entries.map(([k, v]) => [k, json.includes(k) ? JSON.parse(v as string) : v])) as T
}

function toNote(row: Row): Note {
  return {
    id: row.id as number,
    session: row.session as string,
    text: row.text as string,
    blocking: row.blocking === 1,
    delivered: row.delivered === 1,
  }
}

function toConflict(row: Row): Conflict {
  return record<Conflict>(row, ['sessions', 'files', 'options'])
}

function conflictText(id: number, c: ConflictInput): string {
  return c.status === 'resolved'
    ? `Conflict #${id} resolved: ${c.summary}`
    : `Conflict #${id} (${STAGE_LABELS[c.stage]}, ${c.impact} impact): ${c.summary}`
}

export class Memory {
  #db: DatabaseSync
  #sql: SQLTagStore
  #listeners = new Set<() => void>()

  constructor(path: string) {
    this.#db = new DatabaseSync(path)
    this.#db.exec(SCHEMA)
    this.#sql = this.#db.createTagStore()
  }

  /** Calls `fn` after each write. The result removes `fn`. */
  onChange(fn: () => void): () => void {
    this.#listeners.add(fn)
    return () => {
      this.#listeners.delete(fn)
    }
  }

  upsertMember(m: Member): void {
    this.#write(() => {
      this.#sql.run`INSERT INTO members (email, name, github, slackId)
        VALUES (${m.email}, ${m.name}, ${m.github ?? null}, ${m.slackId ?? null})
        ON CONFLICT (email) DO UPDATE
        SET name = excluded.name, github = excluded.github, slackId = excluded.slackId`
    })
  }

  member(email: string): Member | undefined {
    const row = this.#sql.get`SELECT * FROM members WHERE email = ${email}`
    return row && record<Member>(row)
  }

  /** GitHub logins are not case sensitive. */
  memberByGithub(login: string): Member | undefined {
    const row = this.#sql.get`SELECT * FROM members WHERE github = ${login} COLLATE NOCASE`
    return row && record<Member>(row)
  }

  members(): Member[] {
    return this.#sql.all`SELECT * FROM members ORDER BY rowid`.map((r) => record<Member>(r))
  }

  register(
    s: Pick<Session, 'id' | 'agent' | 'member'> & Partial<Pick<Session, 'repo' | 'root' | 'base' | 'main'>>,
  ): void {
    this.#write(() => {
      const repo = s.repo ?? null
      const root = s.root ?? null
      const base = s.base ?? null
      const main = s.main ?? null
      const now = Date.now()
      if (this.session(s.id)) {
        this.#sql.run`UPDATE sessions SET repo = coalesce(${repo}, repo), root = coalesce(${root}, root),
          base = coalesce(${base}, base), main = coalesce(main, ${main}), updated = ${now}
          WHERE id = ${s.id}`
        return
      }
      this.#sql.run`INSERT INTO sessions (id, agent, member, repo, root, base, main, status, cursor, updated)
        VALUES (${s.id}, ${s.agent}, ${s.member}, ${repo}, ${root}, ${base}, ${main}, 'idle',
          ${this.lastEventId()}, ${now})`
      this.#event('join', s.id, `${this.#who(s)} joined.`)
    })
  }

  session(id: string): Session | undefined {
    const row = this.#sql.get`SELECT * FROM sessions WHERE id = ${id}`
    return row && record<Session>(row)
  }

  setStatus(id: string, status: Status): void {
    this.#write(() => {
      this.#sql.run`UPDATE sessions SET status = ${status}, updated = ${Date.now()} WHERE id = ${id}`
    })
  }

  addTask(t: Pick<Task, 'session' | 'summary' | 'issue'>): void {
    this.#write(() => {
      const s = this.#need(t.session)
      const issue = t.issue ?? null
      const linked = this.#sql.get`SELECT 1 FROM tasks WHERE session = ${t.session} AND issue = ${issue}`
      const now = Date.now()
      this.#sql.run`INSERT INTO tasks (session, summary, issue, at) VALUES (${t.session}, ${t.summary}, ${issue}, ${now})`
      this.#sql.run`UPDATE sessions SET issue = coalesce(${issue}, issue), updated = ${now} WHERE id = ${t.session}`
      const link = t.issue === undefined ? '' : ` (#${t.issue})`
      this.#event('task', t.session, `${this.#who(s)} task: ${t.summary}${link}`)
      if (t.issue === undefined || linked) return
      for (const d of this.decisions(t.issue)) this.#note(t.session, this.#decisionText(d), false)
    })
  }

  /** Records the diff and main of one `PostToolUse`, and detects a push (spec §7.4). */
  observe(session: string, git: Pick<GitInfo, 'files' | 'patch' | 'main'>): void {
    this.#write(() => {
      const s = this.#need(session)
      const prev = this.#diff(session)
      const moved = s.main !== undefined && git.main !== s.main
      const pushed = moved ? (prev?.files ?? []).filter((f) => !git.files.includes(f)) : []
      const now = Date.now()
      if (pushed.length > 0) {
        this.#event('push', session, `${this.#who(s)} pushed to main: ${pushed.join(', ')}`)
        // The push event has only file names, because agents read events. The master agent reads the hunks here.
        const patch = pushed.map((f) => filePatch(prev?.patch ?? '', f)).join('')
        this.#sql.run`INSERT INTO pushes (session, files, patch, main, at)
          VALUES (${session}, ${JSON.stringify(pushed)}, ${patch}, ${git.main}, ${now})`
        this.#sql.run`INSERT INTO meta (name, value) VALUES ('main', ${git.main})
          ON CONFLICT (name) DO UPDATE SET value = excluded.value`
        for (const c of this.conflicts()) {
          if (c.status === 'open' && c.files.some((f) => pushed.includes(f))) {
            this.#sql.run`UPDATE conflicts SET stage = 'after', updated = ${now} WHERE id = ${c.id}`
          }
        }
      }
      this.#sql.run`UPDATE sessions SET main = ${git.main}, updated = ${now} WHERE id = ${session}`
      if (git.patch === (prev?.patch ?? '')) return
      this.#sql.run`INSERT INTO diffs (session, version, files, patch)
        VALUES (${session}, ${(prev?.version ?? 0) + 1}, ${JSON.stringify(git.files)}, ${git.patch})
        ON CONFLICT (session) DO UPDATE
        SET version = excluded.version, files = excluded.files, patch = excluded.patch`
      const text = git.files.length ? `changed: ${git.files.join(', ')}` : 'has no local changes.'
      this.#event('diff', session, `${this.#who(s)} ${text}`)
    })
  }

  diffs(): Diff[] {
    return this.#sql.all`SELECT * FROM diffs ORDER BY rowid`.map((r) => record<Diff>(r, ['files']))
  }

  /** The pushes that `observe` detected, oldest first. */
  pushes(): Push[] {
    return this.#sql.all`SELECT session, files, patch, main, at FROM pushes ORDER BY id`.map((r) =>
      record<Push>(r, ['files']),
    )
  }

  /** Records a summary that the master agent posted. It is not an event, so it starts no round and agents do not read it. */
  addPost(text: string): void {
    this.#write(() => {
      this.#sql.run`INSERT INTO posts (text, at) VALUES (${text}, ${Date.now()})`
    })
  }

  /** The posted summaries, oldest first. */
  posts(): Post[] {
    return this.#sql.all`SELECT text, at FROM posts ORDER BY id`.map((r) => record<Post>(r))
  }

  /** The version of the diff of `other` that `session` saw last. 0 means none. */
  seen(session: string, other: string): number {
    const row = this.#sql.get`SELECT version FROM seen WHERE session = ${session} AND other = ${other}`
    return (row?.version as number | undefined) ?? 0
  }

  markSeen(session: string, other: string, version: number): void {
    this.#write(() => {
      this.#sql.run`INSERT INTO seen (session, other, version) VALUES (${session}, ${other}, ${version})
        ON CONFLICT (session, other) DO UPDATE SET version = excluded.version`
    })
  }

  addNote(session: string, text: string, blocking: boolean): void {
    this.#write(() => this.#note(session, text, blocking))
  }

  /** Returns the notes that are not delivered, and marks them as delivered. */
  takeNotes(session: string, blocking: boolean): Note[] {
    return this.#write(() =>
      this.#sql.all`UPDATE notes SET delivered = 1
        WHERE session = ${session} AND blocking = ${blocking ? 1 : 0} AND delivered = 0 RETURNING *`
        .map(toNote)
        .sort((x, y) => x.id - y.id),
    )
  }

  /** Makes the notes with these ids pending again. */
  undeliver(ids: number[]): void {
    if (!ids.length) return
    this.#write(() => {
      for (const id of ids) this.#sql.run`UPDATE notes SET delivered = 0 WHERE id = ${id}`
    })
  }

  /** All notes, also the delivered notes. */
  notes(): Note[] {
    return this.#sql.all`SELECT * FROM notes ORDER BY id`.map(toNote)
  }

  /** Returns the events after the cursor of `session`, without its own events. Then moves the cursor. */
  readEvents(session: string): OceaniaEvent[] {
    return this.#write(() => {
      const events = this.#sql.all`SELECT * FROM events
        WHERE id > (SELECT cursor FROM sessions WHERE id = ${session}) AND session IS NOT ${session}
        ORDER BY id`.map((r) => record<OceaniaEvent>(r))
      this.#sql.run`UPDATE sessions SET cursor = ${this.lastEventId()}, updated = ${Date.now()} WHERE id = ${session}`
      return events
    })
  }

  eventsAfter(id: number): OceaniaEvent[] {
    return this.#sql.all`SELECT * FROM events WHERE id > ${id} ORDER BY id`.map((r) => record<OceaniaEvent>(r))
  }

  lastEventId(): number {
    return this.#sql.get`SELECT coalesce(max(id), 0) AS id FROM events`?.id as number
  }

  /**
   * Adds a `stall` event for each working session whose last event is not after `before` (spec §7.4).
   * The stall event stays the last event of the session until the session adds an event.
   * Thus Oceania reports each stall once.
   */
  reportStalls(before: number): void {
    const stalled = this.#sql.all`SELECT s.* FROM sessions s
      JOIN events e ON e.id = (SELECT max(id) FROM events WHERE session = s.id)
      WHERE s.status = 'working' AND e.kind != 'stall' AND e.at <= ${before}
      ORDER BY s.rowid`.map((r) => record<Session>(r))
    if (!stalled.length) return
    this.#write(() => {
      for (const s of stalled) this.#event('stall', s.id, `${this.#who(s)} may be stalled.`)
    })
  }

  /** Creates a conflict without `id`, or updates the conflict with `id`. Returns the `id`. */
  trackConflict(c: ConflictInput): number {
    return this.#write(() => {
      if (c.id === undefined) return this.#putConflict(c)
      const old = this.conflict(c.id)
      if (!old) throw new Error(`Conflict #${c.id} does not exist.`)
      return this.#putConflict({ ...c, files: c.files ?? old.files, issue: c.issue ?? old.issue })
    })
  }

  /**
   * Records the overlap that the live check found (spec §7.4). Returns the conflict `id`.
   * An overlap joins only an open low impact conflict of the pair: a high impact conflict is a
   * product decision with its own lifecycle, and a file overlap does not change that decision.
   */
  trackOverlap(writer: string, owner: string, path: string): number {
    return this.#write(() => {
      const open = this.conflicts().find(
        (c) =>
          c.status === 'open' && c.impact === 'low' && c.sessions.includes(writer) && c.sessions.includes(owner),
      )
      if (!open) {
        const summary = `${this.#who(this.#need(writer))} and ${this.#who(this.#need(owner))} change ${path}.`
        return this.#putConflict({
          sessions: [writer, owner],
          files: [path],
          summary,
          stage: 'during',
          impact: 'low',
          status: 'open',
        })
      }
      const stage = open.stage === 'before' ? 'during' : open.stage
      if (open.files.includes(path) && stage === open.stage) return open.id
      const files = open.files.includes(path) ? open.files : [...open.files, path]
      return this.#putConflict({ ...open, files, stage })
    })
  }

  /** Records the open question, then pauses every session in the conflict (spec §7.6). */
  escalate(id: number, e: Required<Pick<Conflict, 'channel' | 'author' | 'question' | 'options'>>): void {
    this.#write(() => {
      const c = this.conflict(id)
      if (!c) throw new Error(`Conflict #${id} does not exist.`)
      const now = Date.now()
      this.#sql.run`UPDATE conflicts SET channel = ${e.channel}, author = ${e.author}, question = ${e.question},
        options = ${JSON.stringify(e.options)}, updated = ${now} WHERE id = ${id}`
      const sessions = c.sessions.flatMap((s) => this.session(s) ?? [])
      for (const s of sessions) {
        this.#sql.run`UPDATE sessions SET status = 'paused', updated = ${now} WHERE id = ${s.id}`
      }
      const agents = names.format(sessions.map((s) => this.#who(s)))
      this.#event('conflict', undefined, `Oceania paused ${agents}. Open question on #${c.issue}: ${e.question}`)
    })
  }

  conflict(id: number): Conflict | undefined {
    const row = this.#sql.get`SELECT * FROM conflicts WHERE id = ${id}`
    return row && toConflict(row)
  }

  conflictByChannel(channel: string): Conflict | undefined {
    const row = this.#sql.get`SELECT * FROM conflicts WHERE channel = ${channel}`
    return row && toConflict(row)
  }

  conflicts(): Conflict[] {
    return this.#sql.all`SELECT * FROM conflicts ORDER BY id`.map(toConflict)
  }

  /** The conflict that pauses `session`: it has a channel and no decision. */
  pausedBy(session: string): Conflict | undefined {
    return this.conflicts().find(
      (c) => c.channel !== undefined && c.decision === undefined && c.sessions.includes(session),
    )
  }

  /**
   * Records the first decision for the conflict in `channel`. Gives each session in the conflict
   * the blocking note `note`. A paused session becomes idle only when no other open question pauses it.
   * The conflict stays open until main has the decision (spec §7.6).
   */
  decide(channel: string, option: string, note: string): Conflict {
    return this.#write(() => {
      const c = this.conflictByChannel(channel)
      if (!c) throw new Error(`No conflict uses the channel ${channel}.`)
      if (c.decision !== undefined) throw new Error(`Conflict #${c.id} already has a decision.`)
      const now = Date.now()
      this.#sql.run`UPDATE conflicts SET decision = ${option}, updated = ${now} WHERE id = ${c.id}`
      for (const s of c.sessions.flatMap((id) => this.session(id) ?? [])) {
        this.#note(s.id, note, true)
        if (s.status !== 'paused' || this.pausedBy(s.id)) continue
        this.#sql.run`UPDATE sessions SET status = 'idle', updated = ${now} WHERE id = ${s.id}`
      }
      const d: Decision = { issue: c.issue as number, option, author: c.author as string, at: now }
      this.#sql.run`INSERT INTO decisions (issue, option, author, at) VALUES (${d.issue}, ${d.option}, ${d.author}, ${d.at})`
      this.#event('decision', undefined, this.#decisionText(d))
      return { ...c, decision: option, updated: now }
    })
  }

  decisions(issue?: number): Decision[] {
    const only = issue ?? null
    return this.#sql.all`SELECT * FROM decisions WHERE ${only} IS NULL OR issue = ${only} ORDER BY rowid`.map((r) =>
      record<Decision>(r),
    )
  }

  snapshot(): Snapshot {
    const diffs = new Map(this.diffs().map((d) => [d.session, d.files]))
    const sessions = this.#sql.all`SELECT * FROM sessions ORDER BY rowid`.map((r) => {
      const s = record<Session>(r)
      const task = this.#sql.get`SELECT * FROM tasks WHERE session = ${s.id} ORDER BY id DESC LIMIT 1`
      return {
        ...s,
        name: this.member(s.member)?.name ?? s.member,
        task: task && record<Task>(task),
        files: diffs.get(s.id) ?? [],
      }
    })
    const main = this.#sql.get`SELECT value FROM meta WHERE name = 'main'`?.value as string | undefined
    return { members: this.members(), sessions, conflicts: this.conflicts(), decisions: this.decisions(), main }
  }

  /** Runs `fn` in one transaction, then calls the listeners once. */
  #write<T>(fn: () => T): T {
    this.#db.exec('BEGIN')
    let result: T
    try {
      result = fn()
      this.#db.exec('COMMIT')
    } catch (error) {
      this.#db.exec('ROLLBACK')
      throw error
    }
    for (const listener of [...this.#listeners]) listener()
    return result
  }

  #need(id: string): Session {
    const s = this.session(id)
    if (!s) throw new Error(`Session ${id} does not exist.`)
    return s
  }

  /** `<name>'s agent (<agent>)`. The name is the email when the member is not known. */
  #who(s: Pick<Session, 'agent' | 'member'>): string {
    return who(this.member(s.member)?.name ?? s.member, s.agent)
  }

  #decisionText(d: Decision): string {
    return `Decision on #${d.issue} by ${this.memberByGithub(d.author)?.name ?? d.author}: ${d.option}`
  }

  #diff(session: string): Diff | undefined {
    const row = this.#sql.get`SELECT * FROM diffs WHERE session = ${session}`
    return row && record<Diff>(row, ['files'])
  }

  #event(kind: EventKind, session: string | undefined, text: string): void {
    this.#sql.run`INSERT INTO events (kind, session, text, at)
      VALUES (${kind}, ${session ?? null}, ${text}, ${Date.now()})`
  }

  #note(session: string, text: string, blocking: boolean): void {
    this.#sql.run`INSERT INTO notes (session, text, blocking, delivered) VALUES (${session}, ${text}, ${blocking ? 1 : 0}, 0)`
  }

  #putConflict(c: ConflictInput): number {
    const files = JSON.stringify(c.files ?? [])
    const sessions = JSON.stringify(c.sessions)
    const issue = c.issue ?? null
    const now = Date.now()
    let id = c.id
    if (id === undefined) {
      const result = this.#sql.run`INSERT INTO conflicts (sessions, files, summary, stage, impact, status, issue, updated)
        VALUES (${sessions}, ${files}, ${c.summary}, ${c.stage}, ${c.impact}, ${c.status}, ${issue}, ${now})`
      id = Number(result.lastInsertRowid)
    } else {
      this.#sql.run`UPDATE conflicts SET sessions = ${sessions}, files = ${files}, summary = ${c.summary},
        stage = ${c.stage}, impact = ${c.impact}, status = ${c.status}, issue = ${issue}, updated = ${now}
        WHERE id = ${id}`
    }
    this.#event('conflict', undefined, conflictText(id, c))
    return id
  }
}
