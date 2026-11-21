// The review: the changes of everybody as GitHub has them (a pull request each), and what is done with them: look at what
// a change does, talk about it, submit it, accept it (merge) or close it. Everybody in the team may; there are no roles.
// The state is GitHub's; this only reads it and asks for the actions.

import { validateEntryYaml, type Issue } from '@contents-editor/core'
import { ApiError, SignedOut, type Api, type Change, type ChangeDetail, type Comment, type News } from './api.js'

export type Filter = 'waiting' | 'drafts' | 'done'
export type Action = 'submit' | 'merge' | 'close'

export const isWaiting = (c: Change): boolean => c.state === 'submitted'
export const isDraft = (c: Change): boolean => c.state === 'draft'
export const isDone = (c: Change): boolean => c.state === 'merged' || c.state === 'closed'

/** What the review needs of the workspace: the list of changes it keeps, and what to do when the open change is accepted. */
export interface Host {
  changes: Change[]
  loadChanges(): Promise<void>
  accepted(change: Change): Promise<void>
  signedOut(): void
}

export class Review {
  filter = $state<Filter>('waiting')
  selected = $state<number>()
  detail = $state.raw<ChangeDetail>()
  detailState = $state<'idle' | 'loading' | 'ready' | 'failed'>('idle')
  comments = $state.raw<Comment[]>([])
  /** The action that is being done right now. */
  acting = $state<Action>()
  error = $state('')

  readonly #api: Api
  readonly #host: Host
  /** Only the newest request counts (the person may click on while one is on its way). */
  #loading = 0

  constructor(api: Api, host: Host) {
    this.#api = api
    this.#host = host
  }

  // Getters, not $derived: they read the host's list, which is only there once the constructor has run.
  get shown(): Change[] {
    const keep = this.filter === 'waiting' ? isWaiting : this.filter === 'drafts' ? isDraft : isDone
    return this.#host.changes.filter(keep).sort((a, b) => b.updated.localeCompare(a.updated))
  }

  get count(): Record<Filter, number> {
    const list = this.#host.changes
    return { waiting: list.filter(isWaiting).length, drafts: list.filter(isDraft).length, done: list.filter(isDone).length }
  }

  get change(): Change | undefined {
    return this.#host.changes.find((c) => c.number === this.selected)
  }

  /** What is wrong with the entries of the open change, by path (the automatic check says more, with the references). */
  problems = $derived.by(() => {
    const found = new Map<string, Issue[]>()
    for (const item of this.detail?.items ?? []) {
      const issues = item.after === undefined ? [] : validateEntryYaml(item.after)
      if (issues.length > 0) found.set(item.path, issues)
    }
    return found
  })

  /** Why the open change cannot be accepted, if it cannot. */
  blocked = $derived.by((): string | undefined => {
    if (this.detail?.checks === 'failure') return 'Die automatische Prüfung ist fehlgeschlagen.'
    if (this.problems.size > 0) return 'Einträge der Änderung sind nicht gültig.'
    return undefined
  })

  async select(number: number | undefined): Promise<void> {
    this.selected = number
    this.error = ''
    if (number === undefined) {
      this.detail = undefined
      this.comments = []
      this.detailState = 'idle'
      return
    }
    await this.#reload(number)
  }

  /** News: the list was refreshed by the workspace; the open change and its comments are asked for again if they are the ones that changed. */
  async news(news?: News): Promise<void> {
    if (this.selected === undefined) return
    if (news?.type === 'push' || news?.number === undefined || news.number === this.selected) await this.#reload(this.selected, { quiet: true })
  }

  async #reload(number: number, { quiet = false } = {}): Promise<void> {
    const mine = ++this.#loading
    if (!quiet) this.detailState = 'loading'
    try {
      const [detail, comments] = await Promise.all([this.#api.change(number), this.#api.comments(number)])
      if (mine !== this.#loading) return
      this.detail = detail
      this.comments = comments
      this.detailState = 'ready'
    } catch (error) {
      if (mine !== this.#loading) return
      if (error instanceof SignedOut) return this.#host.signedOut()
      this.detailState = 'failed'
      this.error = (error as Error).message
    }
  }

  async act(action: Action): Promise<boolean> {
    const change = this.change
    if (!change || this.acting) return false
    this.acting = action
    this.error = ''
    try {
      await this.#api[action](change.number)
      await this.#host.loadChanges()
      await this.#reload(change.number, { quiet: true })
      // The change moved to another list: follow it, so that it does not vanish from under the person's eyes.
      this.filter = action === 'submit' ? 'waiting' : 'done'
      if (action === 'merge') await this.#host.accepted(change)
      return true
    } catch (error) {
      if (error instanceof SignedOut) this.#host.signedOut()
      else {
        this.error = error instanceof ApiError ? error.message : (error as Error).message
        // The server may know better than we did (accepted elsewhere meanwhile): look again.
        await this.#host.loadChanges().catch(() => undefined)
      }
      return false
    } finally {
      this.acting = undefined
    }
  }

  async comment(body: string): Promise<boolean> {
    const number = this.selected
    if (number === undefined || !body.trim()) return false
    try {
      const comment = await this.#api.comment(number, body)
      if (this.selected === number && !this.comments.some((c) => c.id === comment.id)) this.comments = [...this.comments, comment]
      return true
    } catch (error) {
      if (error instanceof SignedOut) this.#host.signedOut()
      else this.error = (error as Error).message
      return false
    }
  }
}
