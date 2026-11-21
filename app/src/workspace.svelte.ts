// The state of the editor: who is signed in, the entries as loaded and as changed, which one is open, and saving.
// The screens only show it and call these methods.

import { SignedOut, type Api, type User } from './api.js'
import { ApiError } from './api.js'
import { idOf, isDirty, issuesOf, makeEntry, newEntry, withText, type Entry } from './logic.js'
import type { EntryType, Issue } from '@contents-editor/core'

export class Workspace {
  /** `undefined` until it is known whether somebody is signed in. */
  user = $state<User | null | undefined>(undefined)
  entries = $state<Entry[]>([])
  branch = $state<string>()
  own = $state(false)
  selectedPath = $state<string>()
  loading = $state(false)
  saving = $state(false)
  /** Something went wrong that the person should read. */
  error = $state<string>()
  /** The problems the server found when it refused to save (the editor shows its own while typing). */
  refused = $state<Issue[]>([])

  readonly #api: Api

  constructor(api: Api) {
    this.#api = api
  }

  selected = $derived(this.entries.find((e) => e.path === this.selectedPath))
  dirty = $derived(this.entries.filter(isDirty))
  issues = $derived(this.selected ? issuesOf(this.selected, this.entries) : [])

  async start(): Promise<void> {
    try {
      this.user = await this.#api.me()
    } catch (error) {
      this.user = null
      this.error = (error as Error).message
    }
    if (this.user) await this.load()
  }

  async load(): Promise<void> {
    this.loading = true
    this.error = undefined
    try {
      const result = await this.#api.entries()
      this.branch = result.branch
      this.own = result.own
      // What the person has changed and not saved yet stays (and new entries too); the rest is what the server has.
      const open = new Map(this.entries.filter(isDirty).map((e) => [e.path, e]))
      const loaded = result.entries.map((r) => {
        const mine = open.get(r.path)
        return mine ? { ...mine, sha: r.sha, saved: r.text } : makeEntry(r.path, r.text, r.sha)
      })
      const added = this.entries.filter((e) => e.sha === undefined && isDirty(e) && !loaded.some((l) => l.path === e.path))
      this.entries = [...loaded, ...added]
    } catch (error) {
      this.#fail(error)
    } finally {
      this.loading = false
    }
  }

  select(path: string | undefined): void {
    this.selectedPath = path
    this.refused = []
  }

  /** Replaces the text of the open entry (typed in the YAML, or made by a field). */
  edit(text: string): void {
    this.entries = this.entries.map((e) => (e.path === this.selectedPath ? withText(e, text) : e))
    this.refused = []
  }

  create(type: EntryType, label: string, topic?: string): void {
    const entry = newEntry(type, label, topic)
    if (this.entries.some((e) => e.path === entry.path || idOf(e) === idOf(entry))) throw new Error(`Es gibt schon einen Eintrag mit der ID „${idOf(entry)}“.`)
    this.entries = [...this.entries, entry]
    this.select(entry.path)
  }

  /** Saves the open entry. Returns whether it worked. */
  async save(): Promise<boolean> {
    const entry = this.selected
    if (!entry || this.saving) return false
    this.saving = true
    this.error = undefined
    this.refused = []
    try {
      const { sha } = await this.#api.save(entry.path, entry.text, entry.sha)
      // The text may have been changed while the request was on its way: only what was sent counts as saved.
      this.entries = this.entries.map((e) => (e.path === entry.path ? { ...e, sha, saved: entry.text } : e))
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
    if (!entry) return false
    try {
      if (entry.sha !== undefined) await this.#api.remove(entry.path, entry.sha)
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

  async logout(): Promise<void> {
    await this.#api.logout().catch(() => undefined)
    this.user = null
    this.entries = []
    this.select(undefined)
  }

  #fail(error: unknown): void {
    if (error instanceof SignedOut) {
      this.user = null
      this.error = error.message
    } else if (error instanceof ApiError && error.conflict) {
      this.error = 'Der Eintrag wurde inzwischen anderswo geändert. Lade die Einträge neu (deine Änderungen bleiben erhalten) und speichere noch einmal.'
    } else this.error = (error as Error).message
  }
}
