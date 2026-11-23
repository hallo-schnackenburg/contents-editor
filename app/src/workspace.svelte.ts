// The state of the editor: who is signed in, the entries as loaded and as changed, which one is open, and the submissions (a branch
// and a pull request each). The work is done on the person's draft: the first thing they save makes its branch and its draft pull
// request (named by the day until they name it), and everything they finish ("Fertig") is one more commit there. What they are typing
// is only in the editor until then. The changes shown are what the draft differs from the base branch in. The screens only show it
// and call these methods.

import { FOLDER_PATH, MODEL, submissionBranch, folderTitle, type EntryType, type Issue } from '@contents-editor/core'
import type { Agent, AppState, IndexEntry, TrailStep } from './agent.js'

/** How many times the assistant may look things up for one message. */
const MAX_STEPS = 8
import { carryOut, type ChatMessage } from './chat.js'
import { ApiError, SignedOut, type Api, type Submission, type SubmissionRef, type Listener, type News, type User } from './api.js'
import { folderOf, foldersOf, idOf, issuesOf, makeEntry, newEntry, planRename, titleOf, typeOf, withText, type Entry, type RenamePlan } from './logic.js'
import { Review, type Host } from './review.svelte.js'

/** One thing the person did: made an entry, changed one, deleted one, or renamed one (with what goes with it). */
export interface Change {
  kind: 'new' | 'changed' | 'removed' | 'renamed'
  /** The entry as it is now (for a renamed one: under its new name; for a deleted one: as it was). */
  entry: Entry
  /** Renamed: where the entry was, how many entries below it moved with it, and how many others got new references. */
  from?: string
  moved?: number
  references?: number
}

/**
 * A renaming as the person did it: what moved (the entry as it was, and the path it has now) and what only got new references (its
 * text before and after). It is what "take back" undoes, and what the list of changes shows as one line (until the page is loaded again).
 */
export interface Rename {
  moves: { before: Entry; to: string }[]
  rewrites: { path: string; before: string; after: string }[]
}

/** More entries than this moving at once are asked about first. */
export const ASK_ABOVE = 5

/** How often the server is asked for news while the page is visible and the live connection is not there. */
export const POLL_MS = 60_000

/** The name of a submission when the person gives none: the day, as the captures of the archive are named. */
export const defaultName = (): string =>
  `Einreichung vom ${new Date().toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' })}`

const texts = (entries: { path: string; text: string }[]): Map<string, string> => new Map(entries.map((e) => [e.path, e.text]))

export class Workspace implements Host {
  /** `undefined` until it is known whether somebody is signed in. */
  user = $state<User | null | undefined>(undefined)
  /** The entries as the person sees them: the ones of their draft (or of the base), with what they are typing laid over them. */
  entries = $state<Entry[]>([])
  /** The names of the topic folders of the contents as their .folder.yaml gives them, by folder (contents/natur). */
  folders = $state<Record<string, string>>({})
  /** The branch of a submission that is looked at (to read); none: the person's own work, where the changes are made. */
  branch = $state<string>()
  /** The submissions as the server has them. */
  submissions = $state<Submission[]>([])
  /** The renamings among the changes (each: the entries that moved, and the ones that got other references). */
  renames = $state<Rename[]>([])
  selectedPath = $state<string>()
  loading = $state(false)
  /** Something is being written to the draft. */
  saving = $state(false)
  /** Something went wrong that the person should read. */
  error = $state<string>()
  /** The problems the server found when it refused an entry (the editor shows its own while typing). */
  refused = $state<Issue[]>([])
  /** Whether the live connection is open (if not, the server is asked now and then). */
  liveOpen = $state(false)
  /** Where the person wants an entry to go (its folder, by path), until they are done with it. */
  moveTo = $state<Record<string, string>>({})
  /** The name the draft is to get when it is made (the person changed it before the first save). */
  #wanted = $state('')
  /** The conversation with the assistant; it lasts as long as the page. */
  chat = $state<ChatMessage[]>([])
  /** The assistant is working on a message. */
  thinking = $state(false)
  /** An entry the assistant changed or made: its form is to be opened, so that the person sees the changes and finishes them. */
  openForm = $state<string>()

  readonly review: Review
  readonly #api: Api
  /** What the draft has (or the base, while there is no draft), by path: what is not in it is not saved yet. */
  #saved = $state.raw(new Map<string, string>())
  /** What the base branch has: the changes are the difference to it. */
  #base = $state.raw(new Map<string, string>())
  #listener: Listener | undefined
  #poll: ReturnType<typeof setInterval> | undefined
  #loading = 0
  #stopWatching: (() => void) | undefined
  /** Writes one after the other. */
  #queue: Promise<unknown> = Promise.resolve()

  readonly #agent: Agent | undefined

  constructor(api: Api, agent?: Agent) {
    this.#api = api
    this.#agent = agent
    this.review = new Review(api, this)
  }

  selected = $derived(this.entries.find((e) => e.path === this.selectedPath))
  /** What is typed and not saved yet. */
  dirty = $derived(this.entries.filter((e) => this.#saved.get(e.path) !== e.text))
  issues = $derived(this.selected ? issuesOf(this.selected, this.entries) : [])

  /** The person's own draft, the one that is worked on: their newest submission that is not submitted yet. */
  draft = $derived(this.user ? this.submissions.find((c) => c.state === 'draft' && c.author === this.user!.login) : undefined)
  /** The submission that is looked at, as the server has it (the open one if the branch had several pull requests over time). */
  remote = $derived(this.branch === undefined ? undefined : (this.submissions.find((c) => c.branch === this.branch && (c.state === 'draft' || c.state === 'submitted')) ?? this.submissions.find((c) => c.branch === this.branch)))
  /** Whether changes can be made: somebody is signed in and not a submission of somebody else is looked at (which is only read). */
  editable = $derived(this.user != null && this.branch === undefined)
  /** Why not, in words. */
  readonlyReason = $derived(this.editable ? undefined : 'Du siehst eine Einreichung, nur zum Lesen. Zur eigenen Arbeit zurück, um etwas zu bearbeiten.')

  /** The renamings that are still to be seen as such: all they made is saved and is not in the base. */
  #activeRenames = $derived(this.renames.filter((g) => g.moves.every((m) => this.#saved.has(m.to) && !this.#base.has(m.to))))
  /**
   * The changes against the base: what was renamed, made new, changed and deleted, in this order. A renaming is one change, with all that
   * goes with it. Only what is saved counts: what is still being typed is not a change yet.
   */
  changes = $derived.by<Change[]>(() => {
    const saved = this.#saved
    const base = this.#base
    const entryOf = (path: string): Entry => {
      const open = this.entries.find((e) => e.path === path)
      return open && open.text === saved.get(path) ? open : makeEntry(path, saved.get(path)!, 'saved')
    }
    const part = new Set<string>()
    const renamed: Change[] = []
    for (const g of this.#activeRenames) {
      for (const m of g.moves) part.add(m.to).add(m.before.path)
      for (const r of g.rewrites) part.add(r.path)
      renamed.push({ kind: 'renamed', entry: entryOf(g.moves[0].to), from: g.moves[0].before.path, moved: g.moves.length - 1, references: g.rewrites.length })
    }
    return [
      ...renamed,
      ...[...saved.keys()].filter((p) => !base.has(p) && !part.has(p)).map((p): Change => ({ kind: 'new', entry: entryOf(p) })),
      ...[...saved.keys()].filter((p) => base.has(p) && base.get(p) !== saved.get(p) && !part.has(p)).map((p): Change => ({ kind: 'changed', entry: entryOf(p) })),
      ...[...base].filter(([p]) => !saved.has(p) && !part.has(p)).map(([p, text]): Change => ({ kind: 'removed', entry: makeEntry(p, text, 'base') })),
    ]
  })
  /** The problems of what is not saved, by path: it is not written while there are any. */
  problems = $derived(new Map(this.dirty.map((e) => [e.path, issuesOf(e, this.entries)] as const).filter(([, issues]) => issues.length > 0)))

  async start(): Promise<void> {
    try {
      this.user = await this.#api.me()
    } catch (error) {
      this.user = null
      this.error = (error as Error).message
    }
    if (!this.user) return
    await this.loadSubmissions()
    await this.load()
    this.startLive()
  }

  async loadSubmissions(): Promise<void> {
    try {
      this.submissions = await this.#api.submissions()
    } catch (error) {
      this.#fail(error)
    }
  }

  /** The entries of the branch that is shown, and (for the own work) the base for the changes. What is typed and not saved stays. */
  async load({ quiet = false } = {}): Promise<void> {
    const mine = ++this.#loading
    if (!quiet) this.loading = true
    this.error = undefined
    try {
      const own = this.branch === undefined
      const from = own ? this.draft?.branch : this.branch
      const result = await this.#api.entries(from)
      const base = own && from !== undefined ? await this.#api.entries(undefined) : result
      if (mine !== this.#loading) return // another submission was chosen meanwhile
      const before = this.#saved
      const names: Record<string, string> = {}
      for (const r of result.entries) {
        const title = FOLDER_PATH.test(r.path) ? folderTitle(r.text) : undefined
        if (title) names[r.path.slice(0, r.path.lastIndexOf('/'))] = title
      }
      this.folders = names
      const loaded = result.entries.filter((r) => !FOLDER_PATH.test(r.path))
      // What the person typed (differs from what the branch had) stays, what they moved away or deleted but did not save stays gone, new entries stay.
      const typed = new Map(this.entries.filter((e) => before.get(e.path) !== e.text).map((e) => [e.path, e]))
      const gone = new Set([...before.keys()].filter((p) => !this.entries.some((e) => e.path === p)))
      const entries = loaded.filter((r) => !gone.has(r.path)).map((r) => typed.get(r.path) ?? makeEntry(r.path, r.text, r.sha))
      for (const e of typed.values()) if (!loaded.some((r) => r.path === e.path)) entries.push(e)
      this.#saved = texts(loaded)
      this.#base = texts(base.entries.filter((r) => !FOLDER_PATH.test(r.path)))
      this.entries = entries.map((e) => (typed.has(e.path) ? e : { ...e, saved: e.text }))
      this.renames = this.renames.filter((g) => g.moves.every((m) => entries.some((e) => e.path === m.to)))
    } catch (error) {
      if (mine === this.#loading) this.#fail(error)
    } finally {
      if (mine === this.#loading) this.loading = false
    }
  }

  /** Looks at another submission (or at the own work). */
  async switchTo(branch: string | undefined): Promise<void> {
    if (branch === this.branch) return
    this.branch = branch
    this.entries = []
    this.renames = []
    this.#saved = new Map()
    this.refused = []
    await this.load()
    if (this.selectedPath && !this.selected) this.selectedPath = undefined
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

  /** Whether the entry was never saved (made here, not in the draft or the database yet). */
  isNew(path: string): boolean {
    return !this.#saved.has(path)
  }

  /** Makes a new entry and opens it. With `numbered`, an id that is in use gets a number; otherwise that is an error. */
  create(type: EntryType, label: string, folder?: string, options: { parent?: string; kind?: string; numbered?: boolean } = {}): void {
    if (!this.editable) throw new Error(this.readonlyReason)
    const used = (id: string) => this.entries.some((e) => idOf(e) === id)
    const entry = newEntry(type, label, folder, undefined, { parent: options.parent, kind: options.kind, taken: options.numbered ? used : undefined })
    if (used(idOf(entry)) || this.entries.some((e) => e.path === entry.path)) throw new Error(`Es gibt schon einen Eintrag mit der ID „${idOf(entry)}“.`)
    this.entries = [...this.entries, entry]
    this.select(entry.path)
  }

  // --- writing ---

  /** The name of the draft: what the person made of it, or the one of the day, numbered if the name is used. */
  #nameForNew(login: string): string {
    const taken = (candidate: string) => this.submissions.some((c) => c.branch === submissionBranch(login, candidate) && c.state !== 'merged' && c.state !== 'closed')
    const wanted = this.#wanted.trim()
    if (wanted) return wanted
    const base = defaultName()
    let name = base
    for (let n = 2; taken(name); n++) name = `${base} (${n})`
    return name
  }

  /**
   * Writes what is not saved to the draft as ONE commit (which makes the draft with its pull request if there is none yet): the
   * entries that are new or changed, and the ones that are gone. Returns whether it worked (and so nothing is left).
   */
  sync(): Promise<boolean> {
    const run = this.#queue.then(() => this.#sync())
    this.#queue = run.catch(() => undefined)
    return run
  }

  async #sync(): Promise<boolean> {
    if (!this.editable) return false
    const login = this.user!.login
    const writes = this.entries.filter((e) => this.#saved.get(e.path) !== e.text)
    const removals = [...this.#saved.keys()].filter((p) => !this.entries.some((e) => e.path === p))
    if (writes.length === 0 && removals.length === 0) return true
    const bad = writes.find((e) => issuesOf(e, this.entries).length > 0)
    if (bad) {
      this.select(bad.path)
      this.error = 'Der Eintrag hat noch Probleme. Behebe sie, dann kann er gespeichert werden.'
      return false
    }
    const ref: SubmissionRef = this.draft ? { branch: this.draft.branch, name: this.draft.name } : (() => {
      const name = this.#nameForNew(login)
      return { branch: submissionBranch(login, name), name }
    })()
    this.saving = true
    this.error = undefined
    this.refused = []
    try {
      await this.#api.commit(writes.map((e) => ({ path: e.path, text: e.text })), removals, ref)
    } catch (error) {
      if (error instanceof ApiError && error.issues.length > 0) this.refused = error.issues
      this.#fail(error)
      return false
    } finally {
      this.saving = false
    }
    this.#saved = texts(this.entries)
    this.entries = this.entries.map((e) => ({ ...e, saved: e.text, sha: 'saved' }))
    this.#wanted = ''
    await this.loadSubmissions()
    await this.#closeIfEmpty()
    return true
  }

  /** A draft that does not differ from the base any more (everything was taken back) has no use: it is closed. */
  async #closeIfEmpty(): Promise<void> {
    const draft = this.draft
    if (!draft || this.branch !== undefined || this.changes.length > 0) return
    try {
      await this.#api.close(draft.number)
      this.#saved = new Map(this.#base)
      await this.loadSubmissions()
    } catch (error) {
      this.#fail(error)
    }
  }

  /**
   * The person is done with the open entry: the id and the file follow its name (see `renameOpen`), and what is typed is saved. Returns
   * whether that worked; if not, `error` says why.
   */
  async finish(confirm?: (moving: number) => boolean): Promise<boolean> {
    if (this.editable && this.selected) {
      const error = this.renameOpen(confirm)
      if (error) {
        this.error = error
        return false
      }
    }
    return this.sync()
  }

  /** Where the open entry would go with its name as it is typed now (nothing is changed), or what is wrong with it. */
  previewRename(): { path?: string; error?: string } {
    const entry = this.selected
    if (!entry || !this.editable) return {}
    try {
      return { path: planRename(entry, this.entries, (path) => this.entries.some((e) => e.path === path), this.moveTo[entry.path])?.moves[0].after.path }
    } catch (error) {
      return { error: (error as Error).message }
    }
  }

  /** Deletes the open entry (saved at once, unless it was never saved). */
  async remove(): Promise<boolean> {
    const entry = this.selected
    if (!entry || !this.editable) return false
    this.renames = this.renames.filter((g) => !g.moves.some((m) => m.to === entry.path))
    this.entries = this.entries.filter((e) => e.path !== entry.path)
    this.select(undefined)
    return this.sync()
  }

  /** Takes a change back (and saves that): a new entry disappears, a changed one is as the base has it, a deleted one is there again. */
  async discard(path: string): Promise<void> {
    if (!this.editable) return
    const group = this.renames.find((g) => g.moves.some((m) => m.to === path) || g.moves.some((m) => m.before.path === path))
    if (group) this.#undoRename(group, this.#base)
    else if (!this.entries.some((e) => e.path === path)) {
      const text = this.#base.get(path)
      if (text !== undefined) this.entries = [...this.entries, makeEntry(path, text, 'base')]
    } else if (!this.#base.has(path)) {
      this.entries = this.entries.filter((e) => e.path !== path)
      if (this.selectedPath === path) this.select(undefined)
    } else this.entries = this.entries.map((e) => (e.path === path ? withText(e, this.#base.get(path)!) : e))
    this.refused = []
    await this.sync()
  }

  /** Takes back what is typed in the open entry and was not saved (a renaming that was not saved is taken back with it). */
  revert(): void {
    const path = this.selectedPath
    if (!path || !this.editable) return
    this.#clearMove(path)
    const group = this.renames.find((g) => g.moves.some((m) => m.to === path))
    if (group) this.#undoRename(group, this.#saved)
    else if (!this.#saved.has(path)) {
      this.entries = this.entries.filter((e) => e.path !== path)
      this.select(undefined)
    } else this.entries = this.entries.map((e) => (e.path === path ? withText(e, this.#saved.get(path)!) : e))
    this.refused = []
  }

  /**
   * The open entry follows its name: its id and file are made new from it, what lies below it moves with it, and the references to all of
   * these are rewritten. Called when the person is done (`finish`), not while typing. Returns what is wrong in words
   * (and then nothing is changed), or nothing. `confirm` is asked how many entries move if that is more than a few; false stops it.
   */
  renameOpen(confirm: (moving: number) => boolean = () => true): string | undefined {
    const entry = this.selected
    if (!entry || !this.editable) return undefined
    let plan: RenamePlan | undefined
    try {
      plan = planRename(entry, this.entries, (path) => this.entries.some((e) => e.path === path), this.moveTo[entry.path])
    } catch (error) {
      return (error as Error).message
    }
    if (!plan) {
      this.#clearMove(entry.path)
      return undefined
    }
    if (plan.moves.length > ASK_ABOVE && !confirm(plan.moves.length)) return 'Nicht umbenannt.'
    this.#applyRename(plan)
    this.#clearMove(entry.path)
    this.selectedPath = plan.moves[0].after.path
    this.refused = []
    return undefined
  }

  #clearMove(path: string): void {
    if (path in this.moveTo) {
      const { [path]: _gone, ...rest } = this.moveTo
      this.moveTo = rest
    }
  }

  /** The folder the open entry is to go to (done with `finish`; shown as the file name meanwhile). */
  setFolder(folder: string): void {
    const entry = this.selected
    if (!entry || !this.editable) return
    if (folder.trim() === folderOf(entry)) this.#clearMove(entry.path)
    else this.moveTo = { ...this.moveTo, [entry.path]: folder }
  }

  /** The folder the open entry is in, or the one it is to go to. */
  folderOpen = $derived(this.selected ? (this.moveTo[this.selected.path] ?? folderOf(this.selected)) : '')

  /** The folders there are for an entity type. */
  folderChoices(type: Parameters<typeof foldersOf>[0]): string[] {
    return foldersOf(type, this.entries)
  }

  /** Moves the entries and rewrites the references, and keeps track of it: one renaming per entry, however often it is renamed. */
  #applyRename(plan: RenamePlan): void {
    let entries = this.entries.filter((e) => !plan.moves.some((m) => m.before.path === e.path))
    for (const m of plan.moves) entries.push(m.after)
    for (const r of plan.rewrites) entries = entries.map((e) => (e.path === r.before.path ? withText(e, r.after.text) : e))
    this.entries = entries

    // The renaming this continues (the entry was renamed before), or a new one.
    const known = this.renames.find((g) => g.moves.some((m) => m.to === plan.moves[0].before.path))
    const group: Rename = known ?? { moves: [], rewrites: [] }
    for (const m of plan.moves) {
      const i = group.moves.findIndex((x) => x.to === m.before.path)
      if (i < 0) group.moves.push({ before: m.before, to: m.after.path })
      else if (group.moves[i].before.path === m.after.path) group.moves.splice(i, 1)
      else group.moves[i] = { before: group.moves[i].before, to: m.after.path }
    }
    for (const r of plan.rewrites) {
      const i = group.rewrites.findIndex((x) => x.path === r.before.path)
      if (i < 0) group.rewrites.push({ path: r.before.path, before: r.before.text, after: r.after.text })
      else if (group.rewrites[i].before === r.after.text) group.rewrites.splice(i, 1)
      else group.rewrites[i] = { ...group.rewrites[i], after: r.after.text }
    }
    // A renaming that is back where it started is none any more.
    this.renames = (known ? this.renames : [...this.renames, group]).filter((g) => g.moves.length > 0)
  }

  /** Takes a renaming back: the entries are where and as `source` (the saved texts, or the base) has them, the references as before. */
  #undoRename(group: Rename, source: ReadonlyMap<string, string>): void {
    const to = new Set(group.moves.map((m) => m.to))
    this.entries = this.entries.filter((e) => !to.has(e.path))
    for (const m of group.moves) {
      const text = source.get(m.before.path)
      if (text !== undefined) this.entries = [...this.entries, makeEntry(m.before.path, text, 'saved')]
      else if (m.before.sha === undefined) this.entries = [...this.entries, m.before]
    }
    for (const r of group.rewrites) this.entries = this.entries.map((e) => (e.path === r.path && e.text === r.after ? withText(e, source.get(r.path) ?? r.before) : e))
    this.renames = this.renames.filter((g) => g !== group)
    if (this.selectedPath && to.has(this.selectedPath)) this.selectedPath = group.moves[0].before.path
  }

  // --- the draft as a submission ---

  /** The name of the draft changed (the person left the field): the pull request gets it, or the draft will when it is made. */
  async rename(name: string): Promise<void> {
    const named = name.replace(/\s+/g, ' ').trim()
    if (!named) return
    if (!this.draft) {
      this.#wanted = named
      return
    }
    if (named === this.draft.name) return
    try {
      await this.#api.rename(this.draft.number, named)
      await this.loadSubmissions()
    } catch (error) {
      this.#fail(error)
    }
  }

  /** The draft is ready for review (what is typed is saved first). Returns whether it worked. */
  async submit(): Promise<boolean> {
    if (!(await this.sync())) return false
    const draft = this.draft
    if (!draft) return false
    try {
      await this.#api.submit(draft.number)
      await this.loadSubmissions()
      await this.load({ quiet: true })
      return true
    } catch (error) {
      this.#fail(error)
      return false
    }
  }

  /** The submission that is worked on was accepted (here or elsewhere): what is left is the database as it is now. */
  async accepted(submission: Submission): Promise<void> {
    if (submission.branch === this.branch) await this.switchTo(undefined)
    else if (this.branch === undefined) await this.load({ quiet: true })
  }

  /** Looks at the entries of a submission that is not finished, to read (somebody else's too). */
  async work(submission: Submission): Promise<void> {
    await this.switchTo(submission.branch)
  }

  /** News from the server (or the clock): what changed is asked for again. Without details everything is. */
  async news(news?: News): Promise<void> {
    if (!this.user) return
    const was = this.draft?.number
    await this.loadSubmissions()
    await this.review.news(news)
    const watched = this.branch === undefined ? was : this.remote?.number
    const entries = !news || (news.type === 'push' && this.branch === undefined) || (news.type === 'pull' && (news.number === undefined || news.number === watched || news.number === this.draft?.number))
    if (entries) await this.load({ quiet: true })
  }

  /** The person asked for everything again. */
  async reload(): Promise<void> {
    await Promise.all([this.loadSubmissions(), this.load(), this.review.news()])
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
    this.renames = []
    this.#saved = new Map()
    this.#base = new Map()
    this.submissions = []
    this.branch = undefined
    this.select(undefined)
  }

  // --- the assistant ---

  /** The entities with their id and name: what the assistant sets references to. */
  #entityIndex(): IndexEntry[] {
    return this.entries.flatMap((e) => {
      const type = typeOf(e)
      return type && MODEL.types[type].class === 'entity' ? [{ id: idOf(e), type, name: titleOf(e) }] : []
    })
  }

  /** What is going on, as the assistant gets to know it. */
  #appState(): AppState {
    const own = this.draft?.number
    return {
      viewing: this.branch === undefined ? null : (this.remote?.name ?? this.branch),
      draft: this.draft ? { name: this.draft.name, state: this.draft.state } : null,
      unsaved: this.dirty.map((e) => e.path),
      changes: this.changes.length,
      submissions: this.submissions
        .filter((c) => c.number !== own && (c.state === 'submitted' || c.state === 'draft'))
        .slice(0, 60)
        .map((c) => ({ number: c.number, name: c.name, author: c.author, state: c.state })),
    }
  }

  /** Replaces the text of an entry (the assistant's changes; like typing it). */
  setTextOf(path: string, text: string): void {
    this.entries = this.entries.map((e) => (e.path === path ? withText(e, text) : e))
    this.refused = []
  }

  /**
   * The person wrote to the assistant. It answers with calls, which are carried out (see chat.ts). If it only looked things up, it is
   * asked again with the answers, up to a few rounds. Changes to entries are unsaved ("Fertig" saves them); what is hard to take back
   * waits for the person's button.
   */
  async send(message: string): Promise<void> {
    const text = message.trim()
    if (!text || this.thinking) return
    const history = this.chat.filter((m): m is ChatMessage & { role: 'user' | 'assistant' } => m.role === 'user' || m.role === 'assistant').slice(-20).map(({ role, text }) => ({ role, text }))
    this.chat.push({ role: 'user', text })
    if (!this.#agent) {
      this.chat.push({ role: 'status', text: 'Der Chat ist hier nicht eingerichtet.' })
      return
    }
    this.thinking = true
    const trail: TrailStep[] = []
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const open = this.selected
        const calls = await this.#agent.respond({
          message: text,
          entry: open ? { path: open.path, id: idOf(open), text: open.text } : null,
          index: this.#entityIndex(),
          app: this.#appState(),
          history,
          trail: [...trail],
        })
        const outcome = await carryOut(calls, open?.path, this)
        this.chat.push(...outcome.messages)
        if (outcome.show) this.openForm = outcome.show
        if (!outcome.more) return
        const ids = calls.map((c, i) => c.id ?? `call_${step}_${i}`)
        trail.push({
          calls: calls.map(({ id: _id, tool, ...input }, i) => ({ id: ids[i], tool, input })),
          results: outcome.results.map((result, i) => ({ id: ids[i], text: result })),
        })
      }
      this.chat.push({ role: 'status', text: 'Das war mir zu viel Hin und Her. Sag mir bitte genauer, was ich tun soll.' })
    } catch (error) {
      if (error instanceof SignedOut) this.#fail(error)
      this.chat.push({ role: 'status', text: `Das hat nicht geklappt: ${(error as Error).message}` })
    } finally {
      this.thinking = false
    }
  }

  /** The person pressed the button of a question in the chat. */
  async confirm(message: ChatMessage): Promise<void> {
    const pending = message.pending
    if (!pending || pending.state !== 'open') return
    pending.state = 'running'
    try {
      this.chat.push({ role: 'status', text: await pending.run() })
    } catch (error) {
      if (error instanceof SignedOut) this.#fail(error)
      this.chat.push({ role: 'status', text: `Das hat nicht geklappt: ${(error as Error).message}` })
    }
    pending.state = 'done'
  }

  /** The person does not want what a question in the chat asks. */
  dismiss(message: ChatMessage): void {
    if (message.pending?.state === 'open') message.pending.state = 'dismissed'
  }

  /** Starts the conversation afresh. */
  clearChat(): void {
    if (!this.thinking) this.chat = []
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
