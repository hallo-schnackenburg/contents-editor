// The review: the submissions of everybody as GitHub has them (a pull request each), and what is done with them: look at what
// a submission does, talk about it, submit it, accept it (merge) or close it. Everybody in the team may; there are no roles.
// The state is GitHub's; this only reads it and asks for the actions.

import { validateEntryYaml, type Issue } from '@contents-editor/core'
import { ApiError, SignedOut, type Api, type Submission, type SubmissionDetail, type Comment, type News } from './api.js'

export type Filter = 'waiting' | 'drafts' | 'done'
export type Action = 'submit' | 'merge' | 'close'

export const isWaiting = (c: Submission): boolean => c.state === 'submitted'
export const isDraft = (c: Submission): boolean => c.state === 'draft'
/** Accepted ones are listed; one that was closed without being accepted is not (it is still on GitHub). */
export const isDone = (c: Submission): boolean => c.state === 'merged'

/** What the review needs of the workspace: the list of submissions it keeps, and what to do when the open submission is accepted. */
export interface Host {
  /** The person's own draft: it is where they work ("Neu"), not one of the drafts in the list. */
  draft?: Submission
  submissions: Submission[]
  loadSubmissions(): Promise<void>
  accepted(submission: Submission): Promise<void>
  signedOut(): void
}

export class Review {
  filter = $state<Filter>('waiting')
  selected = $state<number>()
  detail = $state.raw<SubmissionDetail>()
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

  #own(c: Submission): boolean {
    return this.#host.draft?.number === c.number
  }

  // Getters, not $derived: they read the host's list, which is only there once the constructor has run.
  get shown(): Submission[] {
    const keep = this.filter === 'waiting' ? isWaiting : this.filter === 'drafts' ? isDraft : isDone
    return this.#host.submissions.filter((c) => keep(c) && !this.#own(c)).sort((a, b) => b.updated.localeCompare(a.updated))
  }

  get count(): Record<Filter, number> {
    const list = this.#host.submissions
    const others = list.filter((c) => !this.#own(c))
    return { waiting: others.filter(isWaiting).length, drafts: others.filter(isDraft).length, done: others.filter(isDone).length }
  }

  get submission(): Submission | undefined {
    return this.#host.submissions.find((c) => c.number === this.selected)
  }

  /** What is wrong with the entries of the open submission, by path (the automatic check says more, with the references). */
  problems = $derived.by(() => {
    const found = new Map<string, Issue[]>()
    for (const item of this.detail?.items ?? []) {
      const issues = item.after === undefined ? [] : validateEntryYaml(item.after)
      if (issues.length > 0) found.set(item.path, issues)
    }
    return found
  })

  /** Why the open submission cannot be accepted, if it cannot. */
  blocked = $derived(this.blockReason(this.detail))

  /** Why a submission cannot be accepted, if it cannot (what the screen blocks, the chat is blocked by too). */
  blockReason(detail: SubmissionDetail | undefined): string | undefined {
    if (detail?.checks === 'failure') return 'Die automatische Prüfung ist fehlgeschlagen.'
    if ((detail?.items ?? []).some((item) => item.after !== undefined && validateEntryYaml(item.after).length > 0)) return 'Einträge der Einreichung sind nicht gültig.'
    return undefined
  }

  /** Reads a submission and its comments without looking at it (nothing in the screen changes). */
  async peek(number: number): Promise<{ detail: SubmissionDetail; comments: Comment[] }> {
    const [detail, comments] = await Promise.all([this.#api.submission(number), this.#api.comments(number)])
    return { detail, comments }
  }

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

  /** News: the list was refreshed by the workspace; the open submission and its comments are asked for again if they are the ones that changed. */
  async news(news?: News): Promise<void> {
    if (this.selected === undefined) return
    if (news?.type === 'push' || news?.number === undefined || news.number === this.selected) await this.#reload(this.selected, { quiet: true })
  }

  async #reload(number: number, { quiet = false } = {}): Promise<void> {
    const mine = ++this.#loading
    if (!quiet) this.detailState = 'loading'
    try {
      const [detail, comments] = await Promise.all([this.#api.submission(number), this.#api.comments(number)])
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
    const submission = this.submission
    if (!submission || this.acting) return false
    this.acting = action
    this.error = ''
    try {
      await this.#api[action](submission.number)
      await this.#host.loadSubmissions()
      await this.#reload(submission.number, { quiet: true })
      // The submission moved to another list: follow it, so that it does not vanish from under the person's eyes.
      this.filter = action === 'submit' ? 'waiting' : 'done'
      if (action === 'merge') await this.#host.accepted(submission)
      return true
    } catch (error) {
      if (error instanceof SignedOut) this.#host.signedOut()
      else {
        this.error = error instanceof ApiError ? error.message : (error as Error).message
        // The server may know better than we did (accepted elsewhere meanwhile): look again.
        await this.#host.loadSubmissions().catch(() => undefined)
      }
      return false
    } finally {
      this.acting = undefined
    }
  }

  /** Gives the open submission another name (the title of its pull request). */
  async rename(name: string): Promise<boolean> {
    const submission = this.submission
    if (!submission || this.acting || !name.trim()) return false
    this.error = ''
    try {
      await this.#api.rename(submission.number, name)
      await this.#host.loadSubmissions()
      await this.#reload(submission.number, { quiet: true })
      return true
    } catch (error) {
      if (error instanceof SignedOut) this.#host.signedOut()
      else this.error = (error as Error).message
      return false
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
