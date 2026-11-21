// A stand-in for the server: the example entries of core's tests, kept in memory (gone on reload). With `npm run dev:fake`
// the editor can be tried without GitHub, the Worker and a sign-in. It works as the Worker does: a change is a branch and
// a pull request, saving checks what it saves, a draft is submitted, accepted (squashed into main) or closed.
// Somebody else (bernd) has a change waiting, so there is something to look at in the list of changes.

import { authorOf, checkPath, isChangeBranch, readObject, validateEntryYaml } from '@contents-editor/core'
import { ApiError, type Api, type Change, type ChangeDetail, type ChangeItem, type ChangeRef, type Comment, type EntriesResult, type Listener, type News, type User } from './api.js'

const SEED = import.meta.glob('../../core/test/fixtures/examples/**/*.yaml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

const sha = (text: string) => `fake-${text.length}-${[...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)}`

type Files = Map<string, string>

interface Pull {
  change: Change
  /** What main was when the change was started: what "before" means. */
  start: Files
  comments: Comment[]
}

export class FakeApi implements Api {
  private main: Files = new Map(Object.entries(SEED).map(([path, text]) => [path.replace(/^.*\/examples\//, ''), text]))
  private branches = new Map<string, Files>()
  private pulls: Pull[] = []
  private listeners = new Set<(news?: News) => void>()
  /** What accepted changes looked like at the end (their branch is gone). */
  private merged = new Map<number, Files>()

  constructor() {
    const branch = 'change/bernd/feuerwehr-texte'
    const files = new Map(this.main)
    const path = 'entities/organizations/feuerwehr-schnackenburg.yaml'
    files.set(path, files.get(path)!.replace('name: Freiwillige Feuerwehr Schnackenburg', 'name: Freiwillige Feuerwehr Schnackenburg e. V.'))
    this.branches.set(branch, files)
    this.pulls.push({ change: { number: 1, name: 'Feuerwehr Texte', branch, author: 'bernd', state: 'submitted', url: 'https://github.com/example/contents/pull/1', updated: new Date().toISOString() }, start: new Map(this.main), comments: [] })
  }

  private tell(news?: News): void {
    for (const listener of this.listeners) listener(news)
  }

  private pull(number: number): Pull {
    const found = this.pulls.find((p) => p.change.number === number)
    if (!found) throw new ApiError('Diese Änderung gibt es nicht.', 404)
    return found
  }

  async me(): Promise<User> {
    return { login: 'anna', name: 'Anna Beispiel', avatar: '', role: 'write' }
  }

  async entries(branch?: string): Promise<EntriesResult> {
    const own = branch ? this.branches.get(branch) : undefined
    const files = own ?? this.main
    return { base: 'main', branch: branch ?? null, exists: !!own, entries: [...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, text]) => ({ path, text, sha: sha(text) })) }
  }

  /** The branch to commit to, made from main if there is none; refuses a change that is finished. */
  private target(change: ChangeRef): { files: Files; pull?: Pull } {
    if (!isChangeBranch(change.branch)) throw new ApiError('Keine Änderung.', 400)
    let files = this.branches.get(change.branch)
    const pull = files ? this.pulls.filter((p) => p.change.branch === change.branch).at(-1) : undefined
    if (pull && ['merged', 'closed'].includes(pull.change.state)) throw new ApiError('Diese Änderung ist schon abgeschlossen. Lege eine neue an.', 409)
    if (!files) this.branches.set(change.branch, (files = new Map(this.main)))
    return { files, pull }
  }

  private afterCommit(change: ChangeRef, files: Files, pull?: Pull): number | undefined {
    if (pull) return pull.change.number
    const differs = files.size !== this.main.size || [...files].some(([p, t]) => this.main.get(p) !== t)
    if (!differs) return undefined
    const number = Math.max(0, ...this.pulls.map((p) => p.change.number)) + 1
    this.pulls.push({ change: { number, name: change.name, branch: change.branch, author: authorOf(change.branch), state: 'draft', url: `https://github.com/example/contents/pull/${number}`, updated: new Date().toISOString() }, start: new Map(this.main), comments: [] })
    return number
  }

  async save(path: string, text: string, based: string | undefined, change: ChangeRef): Promise<{ sha: string; pull?: number }> {
    const issues = [...validateEntryYaml(text), ...checkPath(path, readObject(text) ?? {})]
    if (issues.length > 0) throw new ApiError('Der Eintrag ist nicht gültig.', 422, issues)
    const { files, pull } = this.target(change)
    const before = files.get(path)
    if (before !== undefined && based !== sha(before)) throw new ApiError('Der Eintrag wurde inzwischen geändert.', 409)
    files.set(path, text)
    const number = this.afterCommit(change, files, pull)
    this.tell({ type: 'pull', number })
    return { sha: sha(text), pull: number }
  }

  async remove(path: string, _sha: string, change: ChangeRef): Promise<void> {
    const { files, pull } = this.target(change)
    files.delete(path)
    this.tell({ type: 'pull', number: this.afterCommit(change, files, pull) })
  }

  async changes(): Promise<Change[]> {
    return this.pulls.map((p) => ({ ...p.change })).sort((a, b) => b.updated.localeCompare(a.updated))
  }

  async change(number: number): Promise<ChangeDetail> {
    const p = this.pull(number)
    const after = this.branches.get(p.change.branch) ?? this.merged.get(number) ?? new Map<string, string>()
    const items: ChangeItem[] = []
    for (const path of [...new Set([...p.start.keys(), ...after.keys()])].sort()) {
      const was = p.start.get(path)
      const is = after.get(path)
      if (was === is) continue
      items.push({ path, change: was === undefined ? 'added' : is === undefined ? 'removed' : 'modified', ...(was !== undefined ? { before: was } : {}), ...(is !== undefined ? { after: is } : {}) })
    }
    return { change: { ...p.change }, items, truncated: false, checks: items.every((i) => !i.after || validateEntryYaml(i.after).length === 0) ? 'success' : 'failure' }
  }

  private touch(p: Pull, state: Change['state']): void {
    p.change = { ...p.change, state, updated: new Date().toISOString() }
    this.tell({ type: state === 'merged' ? 'push' : 'pull', number: p.change.number })
    if (state === 'merged') this.tell({ type: 'pull', number: p.change.number })
  }

  async submit(number: number): Promise<void> {
    const p = this.pull(number)
    if (p.change.state !== 'draft') throw new ApiError('Die Änderung ist kein Entwurf.', 409)
    this.touch(p, 'submitted')
  }

  async merge(number: number): Promise<void> {
    const p = this.pull(number)
    if (p.change.state === 'draft') throw new ApiError('Die Änderung ist noch ein Entwurf: erst einreichen.', 409)
    if (p.change.state !== 'submitted') throw new ApiError('Diese Änderung ist schon abgeschlossen.', 409)
    this.main = new Map(this.branches.get(p.change.branch))
    // The branch is gone, but what the change did stays to be looked at.
    this.merged.set(number, this.branches.get(p.change.branch)!)
    this.branches.delete(p.change.branch)
    this.touch(p, 'merged')
  }

  async close(number: number): Promise<void> {
    const p = this.pull(number)
    if (['merged', 'closed'].includes(p.change.state)) throw new ApiError('Diese Änderung ist schon abgeschlossen.', 409)
    this.touch(p, 'closed')
  }

  async comments(number: number): Promise<Comment[]> {
    return [...this.pull(number).comments]
  }

  async comment(number: number, body: string): Promise<Comment> {
    const p = this.pull(number)
    const comment = { id: p.comments.length + 1, author: 'anna', avatar: '', body: body.trim(), created: new Date().toISOString() }
    p.comments = [...p.comments, comment]
    this.tell({ type: 'comment', number })
    return comment
  }

  listen(onNews: (news?: News) => void, onOpen: (open: boolean) => void): Listener {
    this.listeners.add(onNews)
    onOpen(true)
    return { stop: () => this.listeners.delete(onNews), nudge: () => undefined }
  }

  async logout(): Promise<void> {}
}
