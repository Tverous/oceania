export type AgentKind = 'copilot' | 'claude'
export type Status = 'working' | 'idle' | 'paused'
export type Stage = 'before' | 'during' | 'after'
export type Impact = 'low' | 'high'

export const STAGE_LABELS: Record<Stage, string> = {
  before: 'Before: tasks conflict',
  during: 'During: changes not on main',
  after: 'After: changes on main',
}

export type EventKind = 'join' | 'task' | 'diff' | 'push' | 'conflict' | 'decision' | 'stall'

export interface Member {
  email: string
  name: string
  github?: string
  slackId?: string
}

export interface Session {
  id: string
  /** Display name, for example `Copilot CLI` or `Claude Code`. */
  agent: string
  /** Member email. */
  member: string
  /** Normalized repo, for example `github.com/tverous/acme-pricing`. */
  repo?: string
  /** Local repo root. */
  root?: string
  /** Merge base of `HEAD` and `origin/HEAD`. */
  base?: string
  /** Last reported `refs/remotes/origin/HEAD`. */
  main?: string
  status: Status
  issue?: number
  /** Last event id that this session has read. */
  cursor: number
  /** Epoch ms of the last write to this session. */
  updated: number
}

export interface Task {
  id: number
  session: string
  summary: string
  issue?: number
  at: number
}

export interface Diff {
  session: string
  version: number
  files: string[]
  patch: string
}

export interface Note {
  id: number
  session: string
  text: string
  blocking: boolean
  delivered: boolean
}

export interface Conflict {
  id: number
  sessions: string[]
  files: string[]
  summary: string
  stage: Stage
  impact: Impact
  status: 'open' | 'resolved'
  issue?: number
  /** Slack channel. Set only after `escalate`. */
  channel?: string
  /** GitHub login of the spec author. */
  author?: string
  question?: string
  options?: string[]
  decision?: string
  updated: number
}

export interface Decision {
  issue: number
  option: string
  /** GitHub login of the spec author. */
  author: string
  at: number
}

/** What one push sent to main (spec §7.4): the files and the hunks of the session's last diff for them. */
export interface Push {
  session: string
  files: string[]
  patch: string
  /** The main commit after the push. */
  main: string
  at: number
}

/** A summary that the master agent posted to the shared channel. */
export interface Post {
  text: string
  at: number
}

export interface TowerEvent {
  id: number
  kind: EventKind
  session?: string
  text: string
  /** Epoch ms when Tower added the event. */
  at: number
}

export type SessionView = Session & { name: string; task?: Task; files: string[] }

export interface Snapshot {
  members: Member[]
  sessions: SessionView[]
  conflicts: Conflict[]
  decisions: Decision[]
  main?: string
}

export interface GitInfo {
  root: string
  repo: string
  base: string
  main: string
  files: string[]
  patch: string
}

export interface HookDecision {
  context?: string
  deny?: string
  block?: string
}

export interface Spec {
  issue: number
  title: string
  body: string
  /** GitHub login of the issue author. */
  author: string
  decisions: string[]
}
