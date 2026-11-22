// The state of the editor: who is signed in, the entries as loaded and as changed, which one is open, saving, and the
// changes (a branch and a pull request each). One change is worked on at a time; without one the database is only read.
// The screens only show it and call these methods.

import { FOLDER_PATH, changeBranch, folderTitle, type EntryType, type Issue } from '@contents-editor/core'
import { ApiError, SignedOut, type Api, type Change, type ChangeRef, type Listener, type News, type User } from './api.js'
import { idOf, isDirty, issuesOf, makeEntry, newEntry, withText, type Entry } from './logic.js'
import { Review, type Host } from './review.svelte.js'

export type View = 'database' | 'changes'

/** How often the server is asked for news while the page is visible and the live connection is not there. */
export const POLL_MS = 60_000

const isOpen = (c: Change): boolean => c.state === 'draft' || c.state === 'submitted'

export class Workspace implements Host {
  /** `undefined` until it is known whether somebody is signed in. */
  user = $state<User | null | undefined>(undefined)
  entries = $state<Entry[]>([])
  /** The names of the topic folders of the contents as their .folder.yaml gives them, by folder (contents/natur). */
  folders = $state<Record<string, string>>({})
  view = $state<View>('database')
  /** In the Datenbank view: the editor (true) or the browser, which only reads (false). */
  editing = $state(false)
  /** The branch of the change that is worked on; none: the database as it is in the base branch, to read. */
  branch = $state<string>()
  /** The changes as the server has them, and those that were started here and have no pull request yet (nothing is saved in them). */
  changes = $state<Change[]>([])
  pending = $state<ChangeRef[]>([])
  selectedPath = $state<string>()
  loading = $state(false)
  saving = $state(false)
  /** Something went wrong that the person should read. */
  error = $state<string>()
  /** The problems the server found when it refused to save (the editor shows its own while typing). */
  refused = $state<Issue[]>([])
  /** The last successful save, for the confirmation next to the tabs. */
  savedAt = $state<{ path: string; at: Date } | undefined>()
  /** Whether the live connection is open (if not, the server is asked now and then). */
  liveOpen = $state(false)

  readonly review: Review
  readonly #api: Api
  #listener: Listener | undefined
  #poll: ReturnType<typeof setInterval> | undefined
  #loading = 0
  #stopWatching: (() => void) | undefined

  constructor(api: Api) {
    this.#api = api
    this.review = new Review(api, this)
  }

  selected = $derived(this.entries.find((e) => e.path === this.selectedPath))
  dirty = $derived(this.entries.filter(isDirty))
  issues = $derived(this.selected ? issuesOf(this.selected, this.entries) : [])

  /** The change that is worked on, as the server has it (the open one if the branch had several pull requests over time). */
  remote = $derived(this.branch === undefined ? undefined : (this.changes.find((c) => c.branch === this.branch && isOpen(c)) ?? this.changes.find((c) => c.branch === this.branch)))
  /** The change that is worked on: its branch and name. */
  current = $derived<ChangeRef | undefined>(this.branch === undefined ? undefined : this.remote ? { branch: this.branch, name: this.remote.name } : this.pending.find((p) => p.branch === this.branch))
  /** Whether it can be edited: there is a change, and it is not accepted or closed. */
  editable = $derived(this.current !== undefined && (this.remote === undefined || isOpen(this.remote)))
  /** Why not, in words. */
  readonlyReason = $derived.by((): string | undefined => {
    if (this.editable) return undefined
    if (this.current === undefined) return 'Zum Bearbeiten links eine Änderung wählen oder eine neue anlegen.'
    return 'Diese Änderung ist abgeschlossen. Wähle eine andere oder lege eine neue an.'
  })

  async start(): Promise<void> {
    try {
      this.user = await this.#api.me()
    } catch (error) {
      this.user = null
      this.error = (error as Error).message
    }
    if (!this.user) return
    await Promise.all([this.loadChanges(), this.load()])
    this.startLive()
  }

  async loadChanges(): Promise<void> {
    try {
      this.changes = await this.#api.changes()
      // A change that has its pull request now is not "new" any more.
      this.pending = this.pending.filter((p) => !this.changes.some((c) => c.branch === p.branch && isOpen(c)))
    } catch (error) {
      this.#fail(error)
    }
  }

  async load({ quiet = false } = {}): Promise<void> {
    const mine = ++this.#loading
    if (!quiet) this.loading = true
    this.error = undefined
    try {
      const result = await this.#api.entries(this.branch)
      if (mine !== this.#loading) return // another change was chosen meanwhile
      // What the person has changed and not saved yet stays (and new entries too); the rest is what the server has.
      const open = new Map(this.entries.filter(isDirty).map((e) => [e.path, e]))
      const names: Record<string, string> = {}
      for (const r of result.entries) {
        const title = FOLDER_PATH.test(r.path) ? folderTitle(r.text) : undefined
        if (title) names[r.path.slice(0, r.path.lastIndexOf('/'))] = title
      }
      this.folders = names
      const loaded = result.entries.filter((r) => !FOLDER_PATH.test(r.path)).map((r) => {
        const kept = open.get(r.path)
        return kept ? { ...kept, sha: r.sha, saved: r.text } : makeEntry(r.path, r.text, r.sha)
      })
      const added = this.entries.filter((e) => e.sha === undefined && isDirty(e) && !loaded.some((l) => l.path === e.path))
      this.entries = [...loaded, ...added]
    } catch (error) {
      if (mine === this.#loading) this.#fail(error)
    } finally {
      if (mine === this.#loading) this.loading = false
    }
  }

  /**
   * Works on another change (or none). What was changed and not saved is dropped: it belongs to the change that is left;
   * whoever calls this asks the person first.
   */
  async switchTo(branch: string | undefined): Promise<void> {
    if (branch !== undefined) this.editing = true
    if (branch === this.branch) return
    this.branch = branch
    this.entries = []
    this.refused = []
    this.savedAt = undefined
    await this.load()
    if (this.selectedPath && !this.selected) this.selectedPath = undefined
  }

  /** Starts a change: it exists here until the first save makes its branch and pull request. */
  async startChange(name: string): Promise<void> {
    const login = this.user?.login
    if (!login) throw new Error('Du bist nicht angemeldet.')
    const branch = changeBranch(login, name)
    if (this.pending.some((p) => p.branch === branch) || this.changes.some((c) => c.branch === branch && c.state !== 'merged')) {
      throw new Error('Du hast schon eine Änderung mit diesem Namen. Wähle einen anderen.')
    }
    this.pending = [...this.pending, { branch, name: name.trim() }]
    await this.switchTo(branch)
  }

  select(path: string | undefined): void {
    this.selectedPath = path
    this.refused = []
  }

  /** Replaces the text of the open entry (typed in the YAML, or made by a field). */
  edit(text: string): void {
    if (!this.editable) return
    this.entries = this.entries.map((e) => (e.path === this.selectedPath ? withText(e, text) : e))
    this.refused = []
  }

  create(type: EntryType, label: string, topic?: string): void {
    if (!this.editable) throw new Error(this.readonlyReason)
    const entry = newEntry(type, label, topic)
    if (this.entries.some((e) => e.path === entry.path || idOf(e) === idOf(entry))) throw new Error(`Es gibt schon einen Eintrag mit der ID „${idOf(entry)}“.`)
    this.entries = [...this.entries, entry]
    this.select(entry.path)
  }

  /** Saves the open entry. Returns whether it worked. */
  async save(): Promise<boolean> {
    const entry = this.selected
    const change = this.current
    if (!entry || !change || !this.editable || this.saving) return false
    this.saving = true
    this.error = undefined
    this.refused = []
    try {
      const { sha, pull } = await this.#api.save(entry.path, entry.text, entry.sha, change)
      // The text may have been changed while the request was on its way: only what was sent counts as saved.
      this.entries = this.entries.map((e) => (e.path === entry.path ? { ...e, sha, saved: entry.text } : e))
      this.savedAt = { path: entry.path, at: new Date() }
      if (pull !== undefined && !this.changes.some((c) => c.number === pull)) await this.loadChanges()
      return true
    } catch (error) {
      if (error instanceof ApiError && error.issues.length > 0) this.refused = error.issues
      this.#fail(error)
      return false
    } finally {
      this.saving = false
    }
  }

  /** Removes the open entry: for good if it was never saved, otherwise at the server. */
  async remove(): Promise<boolean> {
    const entry = this.selected
    const change = this.current
    if (!entry || !this.editable) return false
    try {
      if (entry.sha !== undefined) {
        if (!change) return false
        await this.#api.remove(entry.path, entry.sha, change)
        await this.loadChanges()
      }
      this.entries = this.entries.filter((e) => e.path !== entry.path)
      this.select(undefined)
      return true
    } catch (error) {
      this.#fail(error)
      return false
    }
  }

  /** Throws away the changes to the open entry; a new one that was never saved disappears. */
  revert(): void {
    const entry = this.selected
    if (!entry) return
    if (entry.sha === undefined) {
      this.entries = this.entries.filter((e) => e.path !== entry.path)
      this.select(undefined)
    } else this.edit(entry.saved)
  }

  /** The change that is worked on was accepted (here or elsewhere): what is left is the database as it is now. */
  async accepted(change: Change): Promise<void> {
    if (change.branch === this.branch) await this.switchTo(undefined)
    else if (this.branch === undefined) await this.load({ quiet: true })
  }

  /** Looks at a change in the list of changes. */
  async openChange(number: number): Promise<void> {
    this.view = 'changes'
    await this.review.select(number)
  }

  /** Works on a change that is there (somebody else's too: everybody may change everything for now). */
  async work(change: Change): Promise<void> {
    await this.switchTo(change.branch)
    this.view = 'database'
    this.editing = true
  }

  /** News from the server (or the clock): what changed is asked for again. Without details everything is. */
  async news(news?: News): Promise<void> {
    if (!this.user) return
    await this.loadChanges()
    await this.review.news(news)
    const mine = this.remote?.number
    const entries = !news || (news.type === 'push' && this.branch === undefined) || (news.type === 'pull' && this.branch !== undefined && (news.number === undefined || news.number === mine))
    if (entries) await this.load({ quiet: true })
  }

  /** The person asked for everything again. */
  async reload(): Promise<void> {
    await Promise.all([this.loadChanges(), this.load(), this.review.news()])
  }

  /** Listens to the server, and asks it now and then while the connection is not there. */
  startLive(): void {
    if (this.#listener) return
    this.#listener = this.#api.listen(
      (news) => void this.news(news),
      (open) => (this.liveOpen = open),
    )
    this.#poll = setInterval(() => {
      if (!this.liveOpen && (typeof document === 'undefined' || document.visibilityState === 'visible')) void this.news()
    }, POLL_MS)
    if (typeof document !== 'undefined') {
      const back = () => {
        if (document.visibilityState === 'visible') {
          this.#listener?.nudge()
          void this.news()
        }
      }
      const online = () => this.#listener?.nudge()
      document.addEventListener('visibilitychange', back)
      window.addEventListener('online', online)
      this.#stopWatching = () => {
        document.removeEventListener('visibilitychange', back)
        window.removeEventListener('online', online)
      }
    }
  }

  stopLive(): void {
    this.#listener?.stop()
    this.#listener = undefined
    clearInterval(this.#poll)
    this.#stopWatching?.()
    this.#stopWatching = undefined
    this.liveOpen = false
  }

  async logout(): Promise<void> {
    this.stopLive()
    await this.#api.logout().catch(() => undefined)
    this.signedOut()
  }

  signedOut(): void {
    this.stopLive()
    this.user = null
    this.entries = []
    this.changes = []
    this.pending = []
    this.branch = undefined
    this.select(undefined)
  }

  #fail(error: unknown): void {
    if (error instanceof SignedOut) {
      this.signedOut()
      this.error = error.message
    } else if (error instanceof ApiError && error.conflict) {
      this.error = error.message.includes('abgeschlossen')
        ? error.message
        : 'Der Eintrag wurde inzwischen anderswo geändert. Lade die Einträge neu (deine Änderungen bleiben erhalten) und speichere noch einmal.'
    } else this.error = (error as Error).message
  }
}
