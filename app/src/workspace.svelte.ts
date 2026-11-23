// The state of the editor: who is signed in, the entries as loaded and as changed, which one is open, and the submissions (a branch
// and a pull request each). The work is done on the active submission, which anybody may change: with none (a new draft), the first
// thing that is saved makes its branch and its draft pull request (named by the day until it is named), and everything finished
// ("Fertig") is one more commit on the active branch. What is being typed is only in the editor until then. The changes shown are
// what the active branch differs from the base branch in. Another submission is chosen with `switchTo`, which asks about what is not
// saved. The screens only show all this and call these methods.

import { FOLDER_PATH, MODEL, readValue, setField, slugify, submissionBranch, folderTitle, type EntryType, type Issue } from '@contents-editor/core'
import type { Agent, AppState, IndexEntry, TrailStep } from './agent.js'

/** How many times the assistant may look things up for one message. */
const MAX_STEPS = 8
import { carryOut, type ChatMessage } from './chat.js'
import { ApiError, SignedOut, type Api, type Submission, type SubmissionRef, type Listener, type News, type User } from './api.js'
import { folderOf, foldersOf, idOf, describeIssue, issuesOf, makeEntry, nameFieldOf, newEntry, planRemoval, planRename, shownTitle, titleOf, typeOf, withText, type Entry, type RenamePlan } from './logic.js'
import { Review, type Host } from './review.svelte.js'

/** One thing the person did: made an entry, changed one, deleted one, or renamed one (with what goes with it). */
export interface Change {
  kind: 'new' | 'changed' | 'removed' | 'renamed'
  /** The entry as it is now (for a renamed one: under its new name; for a deleted one: as it was). */
  entry: Entry
  /** Renamed: where the entry was, how many entries below it moved with it, and how many others got new references. */
  from?: string
  moved?: number
  /** A topic of the contents (its .folder.yaml), not an entry. */
  topic?: boolean
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

/** A submission that can still be changed: a draft, or one that is handed in and waits. */
const isOpen = (c: Submission): boolean => c.state === 'draft' || c.state === 'submitted'

const texts = (entries: { path: string; text: string }[]): Map<string, string> => new Map(entries.map((e) => [e.path, e.text]))

export class Workspace implements Host {
  /** `undefined` until it is known whether somebody is signed in. */
  user = $state<User | null | undefined>(undefined)
  /** The entries as the person sees them: the ones of their draft (or of the base), with what they are typing laid over them. */
  entries = $state<Entry[]>([])
  /** The names of the topic folders of the contents as their .folder.yaml gives them, by folder (contents/natur). */
  folders = $state<Record<string, string>>({})
  /** The branch that is worked on; none: a new draft (it shows the base branch, and the first save makes the branch). */
  branch = $state<string>()
  /** A switch to another branch (or to a new draft) that waits for the answer about what is not saved. */
  switching = $state<{ branch: string | undefined }>()
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
  /** The name of the new draft whose branch is made, until the pull request exists. */
  #named = ''
  /** The person chose a branch (or a new draft) themselves: the draft they worked on last is not chosen again for them. */
  #picked = false
  /** The conversation with the assistant; it lasts as long as the page. */
  chat = $state<ChatMessage[]>([])
  /** The assistant is working on a message. */
  thinking = $state(false)
  /** An entry the assistant changed or made: its form is to be opened, so that the person sees the changes and finishes them. */
  openForm = $state<string>()
  /** A form for making or editing an entry is open (set by the screen): handing in waits until it is closed. */
  formOpen = $state(false)

  /** The names of the topics the base branch has (the draft's are in `folders`). */
  #baseFolders = $state.raw<Record<string, string>>({})

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

  /** The person's newest draft: the one they come back to. */
  ownDraft = $derived(this.user ? this.submissions.find((c) => c.state === 'draft' && c.author === this.user!.login) : undefined)
  /** The submission of the branch that is worked on, as the server has it (the open one if the branch had several pull requests over time). */
  active = $derived(this.branch === undefined ? undefined : (this.submissions.find((c) => c.branch === this.branch && isOpen(c)) ?? this.submissions.find((c) => c.branch === this.branch)))
  /** The active submission while it is a draft (one that is handed in is not handed in again). */
  draft = $derived(this.active?.state === 'draft' ? this.active : undefined)
  /** Whether changes can be made: somebody is signed in, and the submission is not finished (anybody may change an open one). */
  editable = $derived(this.user != null && (this.active === undefined || isOpen(this.active)))
  /** Why not, in words. */
  readonlyReason = $derived(this.editable ? undefined : this.user ? 'Diese Einreichung ist abgeschlossen, sie lässt sich nicht mehr ändern.' : 'Du bist nicht angemeldet.')
  /** What is typed and not saved, without the new entries that still have their placeholder: switching away asks about it. */
  unsavedWork = $derived(this.dirty.filter((e) => !this.isUntouched(e.path)))

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
      // The topics that are not in the base yet.
      ...Object.entries(this.folders).filter(([folder]) => this.#baseFolders[folder] === undefined).map(([folder, title]): Change => ({ kind: 'new', topic: true, entry: makeEntry(`${folder}/.folder.yaml`, `title: ${JSON.stringify(title)}\n`, 'saved') })),
    ]
  })
  /** The entries of the draft that are not finished (a required field is missing, a reference leads nowhere), with what is missing in words. */
  unfinished = $derived.by(() =>
    this.changes.flatMap((c) => {
      const entry = c.topic || c.kind === 'removed' ? undefined : this.entries.find((e) => e.path === c.entry.path)
      const issues = entry ? issuesOf(entry, this.entries) : []
      return entry && issues.length > 0 ? [{ entry, missing: issues.map((i) => describeIssue(entry, i)) }] : []
    }),
  )
  problems = $derived(new Map(this.unfinished.map((u) => [u.entry.path, u.missing] as const)))

  async start(): Promise<void> {
    try {
      this.user = await this.#api.me()
    } catch (error) {
      this.user = null
      this.error = (error as Error).message
    }
    if (!this.user) return
    await this.loadSubmissions()
    // The person comes back to the draft they worked on.
    if (!this.#picked && this.branch === undefined && this.ownDraft) this.branch = this.ownDraft.branch
    await this.load()
    this.startLive()
  }

  async loadSubmissions(): Promise<void> {
    try {
      this.submissions = await this.#api.submissions()
    } catch (error) {
      this.#fail(error)
      return
    }
    // The submission that is worked on was accepted or closed (here or elsewhere): what is left is the base branch.
    const active = this.active
    if (active && !isOpen(active)) await this.#backToBase()
  }

  /** The entries of the branch that is shown, and (for the own work) the base for the changes. What is typed and not saved stays. */
  async load({ quiet = false } = {}): Promise<void> {
    const mine = ++this.#loading
    if (!quiet) this.loading = true
    this.error = undefined
    try {
      const from = this.branch
      const [result, base] = await Promise.all([this.#api.entries(from), from === undefined ? undefined : this.#api.entries(undefined)]).then(([r, b]) => [r, b ?? r] as const)
      if (mine !== this.#loading) return // another branch was chosen meanwhile
      const before = this.#saved
      const names: Record<string, string> = {}
      for (const r of result.entries) {
        const title = FOLDER_PATH.test(r.path) ? folderTitle(r.text) : undefined
        if (title) names[r.path.slice(0, r.path.lastIndexOf('/'))] = title
      }
      this.folders = names
      const baseNames: Record<string, string> = {}
      for (const r of base.entries) {
        const title = FOLDER_PATH.test(r.path) ? folderTitle(r.text) : undefined
        if (title) baseNames[r.path.slice(0, r.path.lastIndexOf('/'))] = title
      }
      this.#baseFolders = baseNames
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

  /**
   * Works on another submission (none: on a new draft). What is typed and not saved is asked about first (the screen shows the question
   * while `switching` is set, and answers it with `answerSwitch`); returns whether the switch was made.
   */
  async switchTo(branch: string | undefined, { force = false } = {}): Promise<boolean> {
    this.#picked = true
    if (branch === this.branch) return true
    if (!force && this.unsavedWork.length > 0) {
      this.switching = { branch }
      return false
    }
    this.switching = undefined
    this.branch = branch
    this.entries = []
    this.renames = []
    this.#saved = new Map()
    this.refused = []
    this.moveTo = {}
    this.#wanted = ''
    this.#pristine.clear()
    await this.load()
    if (this.selectedPath && !this.selected) this.selectedPath = undefined
    // The details of the submission are loaded and shown (the main branch has none).
    await this.review.select(this.active?.number)
    this.review.detailOpen = branch !== undefined
    return true
  }

  /** The answer to the question about what is not saved: save it (and switch if that worked), throw it away (and switch), or stay. */
  async answerSwitch(answer: 'save' | 'discard' | 'stay'): Promise<void> {
    const target = this.switching
    if (!target) return
    if (answer === 'stay') {
      this.switching = undefined
      return
    }
    if (answer === 'save' && !(await this.finish())) {
      this.switching = undefined // what is wrong is in `error`
      return
    }
    await this.switchTo(target.branch, { force: true })
  }

  /** The branch that was worked on is finished (accepted, closed): the base branch is shown, with what was typed still there. */
  async #backToBase(): Promise<void> {
    this.branch = undefined
    this.renames = []
    this.review.detailOpen = false
    await this.review.select(undefined)
    await this.load({ quiet: true })
  }

  select(path: string | undefined): void {
    this.selectedPath = path
    this.#dropPristine(path)
    this.refused = []
  }

  /** New entries with a placeholder for a name, as long as nothing was changed: texts as they were made, by path. */
  #pristine = new Map<string, string>()

  /** A new entry that was left again without a change is not wanted: it goes (the one that is chosen now stays). */
  #dropPristine(keep: string | undefined): void {
    const gone = this.entries.filter((e) => e.path !== keep && this.#pristine.get(e.path) === e.text && !this.#saved.has(e.path))
    if (gone.length === 0) return
    this.entries = this.entries.filter((e) => !gone.includes(e))
    for (const e of gone) this.#pristine.delete(e.path)
  }

  /** Replaces the text of the open entry (typed in the YAML, or made by a field). */
  edit(text: string): void {
    if (!this.editable) return
    this.entries = this.entries.map((e) => (e.path === this.selectedPath ? withText(e, text) : e))
    this.refused = []
  }

  /** Whether a new entry still has the placeholder name and nothing else was changed. */
  isUntouched(path: string): boolean {
    return this.#pristine.get(path) === this.entries.find((e) => e.path === path)?.text
  }

  /** Whether the entry was never saved (made here, not in the draft or the database yet). */
  isNew(path: string): boolean {
    return !this.#saved.has(path)
  }

  /** Makes a new entry and opens it. With `numbered`, an id that is in use gets a number; otherwise that is an error. */
  create(type: EntryType, label: string, folder?: string, options: { parent?: string; kind?: string; numbered?: boolean; placeholder?: boolean } = {}): void {
    if (!this.editable) throw new Error(this.readonlyReason)
    const used = (id: string) => this.entries.some((e) => idOf(e) === id)
    let entry = newEntry(type, label, folder, undefined, { parent: options.parent, kind: options.kind, taken: options.numbered ? used : undefined })
    if (used(idOf(entry)) || this.entries.some((e) => e.path === entry.path)) throw new Error(`Es gibt schon einen Eintrag mit der ID „${idOf(entry)}“.`)
    // With a placeholder, the label only gives the file a name for now; the name field starts empty and the file follows what is typed.
    if (options.placeholder) {
      const blanked = setField(entry.text, nameFieldOf(type), '', entry.data?.[nameFieldOf(type)])
      if (blanked.ok) entry = withText(entry, blanked.text)
    }
    this.entries = [...this.entries, entry]
    if (options.placeholder) this.#pristine.set(entry.path, entry.text)
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

  /** The submission a save goes to: the active one, or the one that is made with the save (which then is the active one). */
  #submissionRef(): SubmissionRef {
    if (this.active) return { branch: this.active.branch, name: this.active.name }
    // The branch was made by an earlier save, but GitHub has no pull request for it yet (it did not differ from the base).
    if (this.branch !== undefined) return { branch: this.branch, name: this.#named || this.#wanted.trim() || defaultName() }
    const name = this.#nameForNew(this.user!.login)
    this.#named = name
    return { branch: submissionBranch(this.user!.login, name), name }
  }

  /**
   * Makes a topic of the contents: its .folder.yaml (with the name shown on screen) is written to the draft at once, which also lets the
   * topic exist while nothing is filed in it. Returns the folder of the topic (`contents/<slug>`); throws what is wrong in words.
   */
  createTopic(title: string): Promise<string> {
    const run = this.#queue.then(async () => {
      if (!this.editable) throw new Error(this.readonlyReason)
      const name = title.replace(/\s+/g, ' ').trim()
      const slug = slugify(name)
      if (!slug) throw new Error('Der Name ergibt keinen gültigen Ordnernamen: mindestens ein Buchstabe oder eine Ziffer.')
      const folder = `contents/${slug}`
      if (this.folders[folder] !== undefined || this.entries.some((e) => e.path.startsWith(`${folder}/`)) || Object.values(this.folders).some((t) => t.toLowerCase() === name.toLowerCase())) throw new Error(`Ein Thema „${name}“ gibt es schon.`)
      this.saving = true
      const ref = this.#submissionRef()
      try {
        await this.#api.commit([{ path: `${folder}/.folder.yaml`, text: `title: ${JSON.stringify(name)}\n` }], [], ref, `Add topic ${name}`)
      } catch (error) {
        this.#fail(error)
        throw error
      } finally {
        this.saving = false
      }
      this.branch = ref.branch
      this.folders = { ...this.folders, [folder]: name }
      await this.loadSubmissions()
      return folder
    })
    this.#queue = run.catch(() => undefined)
    return run
  }

  /** Takes a topic back: its .folder.yaml is removed from the draft (only while nothing is filed in it). */
  #discardTopic(path: string): Promise<void> {
    const run = this.#queue.then(async () => {
      const folder = path.slice(0, path.lastIndexOf('/'))
      if (this.entries.some((e) => e.path.startsWith(`${folder}/`))) {
        this.error = 'In dem Thema liegen noch Einträge.'
        return
      }
      try {
        await this.#api.commit([], [path], this.#submissionRef(), `Remove topic ${folder}`)
      } catch (error) {
        this.#fail(error)
        return
      }
      const { [folder]: _gone, ...rest } = this.folders
      this.folders = rest
      await this.loadSubmissions()
      await this.#closeIfEmpty()
    })
    this.#queue = run.catch(() => undefined)
    return run
  }

  async #sync(): Promise<boolean> {
    if (!this.editable) return false
    const login = this.user!.login
    const writes = this.entries.filter((e) => this.#saved.get(e.path) !== e.text)
    const removals = [...this.#saved.keys()].filter((p) => !this.entries.some((e) => e.path === p))
    if (writes.length === 0 && removals.length === 0) return true
    const bad = writes.find((e) => !e.data)
    if (bad) {
      this.select(bad.path)
      this.error = `Das YAML von „${shownTitle(bad)}“ ist kaputt, so lässt es sich nicht speichern.`
      return false
    }
    const ref = this.#submissionRef()
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
    const made = this.branch === undefined
    this.branch = ref.branch
    this.#saved = texts(this.entries)
    this.entries = this.entries.map((e) => ({ ...e, saved: e.text, sha: 'saved' }))
    this.#wanted = ''
    await this.loadSubmissions()
    // The submission that the first save made is the one worked on: its details are the ones kept up to date.
    if (made && this.active) await this.review.select(this.active.number)
    await this.#closeIfEmpty()
    return true
  }

  /** A draft that does not differ from the base any more (everything was taken back) has no use: it is closed. */
  async #closeIfEmpty(): Promise<void> {
    const draft = this.draft
    if (!draft || this.changes.length > 0) return
    try {
      await this.#api.close(draft.number)
      this.#saved = new Map(this.#base)
      this.branch = undefined
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

  /**
   * What the entry's name makes of its id and file. An entry that was saved keeps its id unless its name was changed (or a folder was
   * chosen): an id that never came from the name is not touched by a change of something else.
   */
  #planFor(entry: Entry): RenamePlan | undefined {
    const type = typeOf(entry)
    const saved = this.#saved.get(entry.path)
    if (type && saved !== undefined && !(entry.path in this.moveTo) && readValue(saved, nameFieldOf(type)) === entry.data?.[nameFieldOf(type)]) return undefined
    return planRename(entry, this.entries, (path) => this.entries.some((e) => e.path === path), this.moveTo[entry.path])
  }

  /** Where the open entry would go with its name as it is typed now (nothing is changed), or what is wrong with it. */
  previewRename(): { path?: string; error?: string } {
    const entry = this.selected
    if (!entry || !this.editable) return {}
    try {
      return { path: this.#planFor(entry)?.moves[0].after.path }
    } catch (error) {
      return { error: (error as Error).message }
    }
  }

  /** Deletes the open entry (saved at once, unless it was never saved). */
  async remove(): Promise<boolean> {
    const entry = this.selected
    if (!entry || !this.editable) return false
    this.renames = this.renames.filter((g) => !g.moves.some((m) => m.to === entry.path))
    // The references to it go with it (they are changes of their own, which show in the list).
    const cleaned = new Map(planRemoval(entry, this.entries).map((c) => [c.before.path, c.after]))
    this.entries = this.entries.filter((e) => e.path !== entry.path).map((e) => cleaned.get(e.path) ?? e)
    this.select(undefined)
    return this.sync()
  }

  /** How many other entries refer to an entry (deleting it takes the references out of them). */
  referencesTo(path: string): number {
    const entry = this.entries.find((e) => e.path === path)
    return entry ? planRemoval(entry, this.entries).length : 0
  }

  /** Takes a change back (and saves that): a new entry disappears, a changed one is as the base has it, a deleted one is there again. */
  async discard(path: string): Promise<void> {
    if (!this.editable) return
    if (FOLDER_PATH.test(path)) return this.#discardTopic(path)
    const group = this.renames.find((g) => g.moves.some((m) => m.to === path) || g.moves.some((m) => m.before.path === path))
    if (group) this.#undoRename(group, this.#base)
    else if (!this.entries.some((e) => e.path === path)) {
      const text = this.#base.get(path)
      if (text !== undefined) {
        const restored = makeEntry(path, text, 'base')
        // The references that were taken out with it come back too (where nothing else was changed in them since).
        const back = new Map(planRemoval(restored, [...this.#base].map(([p, t]) => makeEntry(p, t, 'base'))).map((c) => [c.before.path, c]))
        this.entries = [...this.entries, restored].map((e) => {
          const c = back.get(e.path)
          return c && c.after.text === e.text ? withText(e, c.before.text) : e
        })
      }
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
      plan = this.#planFor(entry)
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
    const active = this.active
    if (!active || !isOpen(active)) {
      this.#wanted = named
      return
    }
    if (named === active.name) return
    try {
      await this.#api.rename(active.number, named)
      await this.loadSubmissions()
    } catch (error) {
      this.#fail(error)
    }
  }

  /** The submission is proposed: it is not a draft any more, and the team may accept it (what is typed is saved first). Returns whether it worked. */
  async submit(): Promise<boolean> {
    if (!(await this.sync())) return false
    const draft = this.draft
    if (!draft) return false
    try {
      await this.#api.submit(draft.number)
      await this.loadSubmissions()
      // It stays the one that is worked on (it is not a draft any more); its details are shown, so that it is clear what became of it.
      await this.review.select(draft.number)
      this.review.detailOpen = true
      return true
    } catch (error) {
      this.#fail(error)
      return false
    }
  }

  /** A submission was accepted (here or elsewhere): the base branch changed, and the changes shown are the difference to it. */
  async accepted(submission: Submission): Promise<void> {
    if (submission.branch === this.branch) await this.#backToBase()
    else await this.load({ quiet: true })
  }

  /** Works on a submission that is not finished (somebody else's too). Returns whether the switch was made (see `switchTo`). */
  work(submission: Submission): Promise<boolean> {
    return this.switchTo(submission.branch)
  }

  /** News from the server (or the clock): what changed is asked for again. Without details everything is. */
  async news(news?: News): Promise<void> {
    if (!this.user) return
    await this.loadSubmissions()
    await this.review.news(news)
    const watched = this.active?.number
    const entries = !news || news.type === 'push' || (news.type === 'pull' && (news.number === undefined || news.number === watched))
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
    this.switching = undefined
    this.#picked = false
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
    const own = this.active?.number
    return {
      viewing: this.active && this.active.author !== this.user?.login ? this.active.name : null,
      draft: this.active ? { name: this.active.name, state: this.active.state } : null,
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
