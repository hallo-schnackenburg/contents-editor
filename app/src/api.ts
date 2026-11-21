// Everything the app asks of the server goes through this interface: the Worker (HttpApi), or, for trying things
// out without GitHub, a copy of the examples in memory (fake.ts).

import type { Issue } from '@contents-editor/core'
import { Live, liveUrl, type News } from './live.js'

export type { News } from './live.js'

export interface User {
  login: string
  name: string
  avatar: string
  role: string
}

/** An entry as the server has it: where it is, the version it is at (sha), and its text. */
export interface RemoteEntry {
  path: string
  sha: string
  text: string
}

export interface EntriesResult {
  base: string
  /** The branch asked for; null for the base branch. */
  branch: string | null
  /** True once the change has a branch; before that, and for the base branch, the entries are the ones of the base. */
  exists: boolean
  entries: RemoteEntry[]
}

/** A change is a branch with a pull request: draft (being worked on), submitted (waits for somebody to accept it), merged (accepted) or closed. */
export type ChangeState = 'draft' | 'submitted' | 'merged' | 'closed'

export interface Change {
  number: number
  name: string
  branch: string
  /** The login of the person who started it. */
  author: string
  state: ChangeState
  url: string
  updated: string
}

/** What a change does to one entry. `before` is missing for an added entry, `after` for a removed one. */
export interface ChangeItem {
  path: string
  change: 'added' | 'modified' | 'removed'
  before?: string
  after?: string
}

/** How the automatic checks of a change stand. */
export type Checks = 'none' | 'pending' | 'success' | 'failure'

export interface ChangeDetail {
  change: Change
  items: ChangeItem[]
  /** There were more entries than are shown. */
  truncated: boolean
  checks: Checks
}

export interface Comment {
  id: number
  author: string
  avatar: string
  body: string
  created: string
}

/** The change a save belongs to: its branch, and its name (the title of the pull request, made with the first save). */
export interface ChangeRef {
  branch: string
  name: string
}

/** A connection for news; `nudge` tries to open it again at once (the page came to the front, the network is back). */
export interface Listener {
  stop(): void
  nudge(): void
}

export interface Api {
  /** Null if nobody is signed in. */
  me(): Promise<User | null>
  /** The entries of a change's branch (of the base branch without one, or while the change has no branch yet). */
  entries(branch?: string): Promise<EntriesResult>
  /** `sha` is the version the change is based on; missing for a new entry. Returns the new version, and the pull request if there is one now. */
  save(path: string, text: string, sha: string | undefined, change: ChangeRef): Promise<{ sha: string; pull?: number }>
  remove(path: string, sha: string, change: ChangeRef): Promise<void>
  changes(): Promise<Change[]>
  change(number: number): Promise<ChangeDetail>
  /** The draft is ready for review. */
  submit(number: number): Promise<void>
  /** Accept the change: it is squashed into the base branch. */
  merge(number: number): Promise<void>
  close(number: number): Promise<void>
  comments(number: number): Promise<Comment[]>
  comment(number: number, body: string): Promise<Comment>
  /** Tells about news (see live.ts); `onOpen` says whether the connection is there. */
  listen(onNews: (news?: News) => void, onOpen: (open: boolean) => void): Listener
  logout(): Promise<void>
}

export class SignedOut extends Error {
  constructor() {
    super('Du bist nicht mehr angemeldet.')
  }
}

/** The server refused: `issues` are the problems the checks found (a 422), `conflict` that somebody changed the entry. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues: Issue[] = [],
  ) {
    super(message)
  }
  get conflict() {
    return this.status === 409
  }
}

export class HttpApi implements Api {
  constructor(private base = '/api') {}

  private async call(path: string, init?: RequestInit): Promise<Response> {
    try {
      return await fetch(`${this.base}${path}`, init)
    } catch {
      throw new Error('Der Server ist nicht erreichbar. Läuft der Worker (npm run dev:worker)?')
    }
  }

  private async json<T>(response: Response): Promise<T> {
    const data = (await response.json().catch(() => ({}))) as T & { error?: string; issues?: Issue[] }
    if (response.status === 401) throw new SignedOut()
    if (!response.ok) throw new ApiError(data.error ?? `Der Server antwortete mit ${response.status}.`, response.status, data.issues)
    return data
  }

  private send<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.call(path, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) }).then((r) => this.json<T>(r))
  }

  async me(): Promise<User | null> {
    const response = await this.call('/auth/me')
    return response.status === 401 ? null : this.json<User>(response)
  }

  entries(branch?: string): Promise<EntriesResult> {
    return this.call(`/repo/entries${branch ? `?branch=${encodeURIComponent(branch)}` : ''}`).then((r) => this.json<EntriesResult>(r))
  }

  save(path: string, text: string, sha: string | undefined, change: ChangeRef): Promise<{ sha: string; pull?: number }> {
    return this.send('PUT', '/repo/entry', { path, text, sha, branch: change.branch, name: change.name })
  }

  async remove(path: string, sha: string, change: ChangeRef): Promise<void> {
    await this.send('DELETE', '/repo/entry', { path, sha, branch: change.branch, name: change.name })
  }

  async changes(): Promise<Change[]> {
    return (await this.send<{ changes: Change[] }>('GET', '/repo/changes')).changes
  }

  change(number: number): Promise<ChangeDetail> {
    return this.send('GET', `/repo/changes/${number}`)
  }

  async submit(number: number): Promise<void> {
    await this.send('POST', `/repo/changes/${number}/submit`)
  }

  async merge(number: number): Promise<void> {
    await this.send('POST', `/repo/changes/${number}/merge`)
  }

  async close(number: number): Promise<void> {
    await this.send('POST', `/repo/changes/${number}/close`)
  }

  async comments(number: number): Promise<Comment[]> {
    return (await this.send<{ comments: Comment[] }>('GET', `/repo/changes/${number}/comments`)).comments
  }

  comment(number: number, body: string): Promise<Comment> {
    return this.send('POST', `/repo/changes/${number}/comments`, { body })
  }

  listen(onNews: (news?: News) => void, onOpen: (open: boolean) => void): Listener {
    const live = new Live(liveUrl(this.base, window.location.href), onNews, onOpen)
    live.start()
    return { stop: () => live.stop(), nudge: () => live.nudge() }
  }

  async logout(): Promise<void> {
    await this.call('/auth/logout', { method: 'POST' })
  }
}
