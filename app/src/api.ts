// Everything the app asks of the server goes through this interface: the Worker (HttpApi), or, for trying things
// out without GitHub, a copy of the examples in memory (fake.ts).

import type { Issue } from '@contents-editor/core'

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
  branch: string
  /** True once the person has a branch of their own; then the entries are the ones of that branch. */
  own: boolean
  entries: RemoteEntry[]
}

export interface Api {
  /** Null if nobody is signed in. */
  me(): Promise<User | null>
  entries(): Promise<EntriesResult>
  /** `sha` is the version the change is based on; missing for a new entry. Returns the new version. */
  save(path: string, text: string, sha?: string): Promise<{ sha: string }>
  remove(path: string, sha: string): Promise<void>
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

  async me(): Promise<User | null> {
    const response = await this.call('/auth/me')
    return response.status === 401 ? null : this.json<User>(response)
  }

  async entries(): Promise<EntriesResult> {
    return this.json(await this.call('/repo/entries'))
  }

  async save(path: string, text: string, sha?: string): Promise<{ sha: string }> {
    return this.json(await this.call('/repo/entry', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, text, sha }) }))
  }

  async remove(path: string, sha: string): Promise<void> {
    await this.json(await this.call('/repo/entry', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, sha }) }))
  }

  async logout(): Promise<void> {
    await this.call('/auth/logout', { method: 'POST' })
  }
}
