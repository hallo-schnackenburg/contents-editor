// A stand-in for the server: the example entries of core's tests, kept in memory (gone on reload). With `npm run dev:fake`
// the editor can be tried without GitHub, the Worker and a sign-in. It checks what it saves as the Worker does.

import { checkPath, readObject, validateEntryYaml } from '@contents-editor/core'
import { ApiError, type Api, type EntriesResult, type User } from './api.js'

const SEED = import.meta.glob('../../core/test/fixtures/examples/**/*.yaml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

const sha = (text: string) => `fake-${text.length}-${[...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)}`

export class FakeApi implements Api {
  private files = new Map<string, string>(Object.entries(SEED).map(([path, text]) => [path.replace(/^.*\/examples\//, ''), text]))

  async me(): Promise<User> {
    return { login: 'anna', name: 'Anna Beispiel', avatar: '', role: 'write' }
  }

  async entries(): Promise<EntriesResult> {
    return { base: 'main', branch: 'edit/anna', own: false, entries: [...this.files].sort(([a], [b]) => a.localeCompare(b)).map(([path, text]) => ({ path, text, sha: sha(text) })) }
  }

  async save(path: string, text: string, based?: string): Promise<{ sha: string }> {
    const issues = [...validateEntryYaml(text), ...checkPath(path, readObject(text) ?? {})]
    if (issues.length > 0) throw new ApiError('Der Eintrag ist nicht gültig.', 422, issues)
    const before = this.files.get(path)
    if (before !== undefined && based !== sha(before)) throw new ApiError('Der Eintrag wurde inzwischen geändert.', 409)
    this.files.set(path, text)
    return { sha: sha(text) }
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path)
  }

  async logout(): Promise<void> {}
}
