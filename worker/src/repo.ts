// The entries of the data repository: reading them, saving one, removing one, always as the signed-in person.
//
//   GET    /repo/entries[?branch=change/…]   every entry of that change's branch (or of the base branch, if there is no branch yet)
//   PUT    /repo/entry                       saves one entry as a commit on a change's branch
//   DELETE /repo/entry                       removes one entry the same way
//
// A change is a branch `change/<login>/<slug>` with a pull request (changes.ts). The first save makes the branch from the
// base branch and opens the pull request as a draft, with the name the person gave the change as its title.
// Nothing invalid is written: an entry has to pass the checks of core (schema, path, files, text) first.

import { checkPath, isChangeBranch, readObject, validateEntryYaml, type Issue } from '@contents-editor/core'
import { ENTRY_PATH, Refused, ensureBranch, failure, headOf, json, readBody, readEntries } from './common.js'
import { call } from './github.js'
import type { GithubEnv } from './github.js'
import { createPull, pullFor } from './changes.js'
import type { Auth } from './session.js'

type Env = GithubEnv

const message = (given: unknown, fallback: string) => (typeof given === 'string' && given.trim() ? given.trim().slice(0, 200) : fallback)

function entryPath(value: unknown): string {
  if (typeof value !== 'string' || !ENTRY_PATH.test(value)) throw new Refused('Not the path of an entry (entities/…, contents/… or media/…, ending in .yaml).')
  return value
}

function branchOf(value: unknown): string {
  if (!isChangeBranch(value)) throw new Refused('Not the branch of a change (change/<login>/<name>).')
  return value
}

/** Checks what would be written: shape, text lengths, file paths, and that the file is where its id and type say. */
export function checkBeforeSaving(path: string, text: string): Issue[] {
  const issues = validateEntryYaml(text)
  if (issues.length > 0) return issues
  return checkPath(path, readObject(text) ?? {})
}

const contentsUrl = (repo: string, path: string) => `/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`

/**
 * What a save needs of the change before it commits: that it is not finished, that there is a name if the pull request has to
 * be opened, and the branch. Returns what to do after the commit.
 */
async function prepare(data: Record<string, unknown>, session: Auth, repo: string, base: string, fetchFn: typeof fetch) {
  const branch = branchOf(data.branch)
  const exists = !!(await headOf(session.access, repo, branch, fetchFn))
  const latest = exists ? await pullFor(session.access, repo, branch, fetchFn) : undefined
  if (latest && latest.state !== 'open') throw new Refused('Diese Änderung ist schon abgeschlossen. Lege eine neue an.', 409)
  const name = typeof data.name === 'string' ? data.name.trim().slice(0, 200) : ''
  if (!latest && !name) throw new Refused('The name of the change is missing.')
  if (!exists) await ensureBranch(session.access, repo, base, branch, fetchFn)
  return { branch, name, pull: latest?.number }
}

/** Opens the pull request after the first commit. A change that does not differ from the base (yet) has none: the next save tries again. */
async function afterCommit(prepared: Awaited<ReturnType<typeof prepare>>, session: Auth, repo: string, base: string, fetchFn: typeof fetch): Promise<number | undefined> {
  if (prepared.pull !== undefined) return prepared.pull
  return (await createPull(session.access, repo, base, prepared.branch, prepared.name, fetchFn))?.number
}

export async function handleRepo(request: Request, route: string, session: Auth, env: Env, fetchFn: typeof fetch): Promise<Response | null> {
  if (route !== '/repo/entries' && route !== '/repo/entry') return null
  const repo = env.DATA_REPO
  const base = env.BASE_BRANCH ?? 'main'
  if (!repo) return json({ error: 'The server has no DATA_REPO.' }, 500)

  try {
    if (route === '/repo/entries' && request.method === 'GET') {
      const given = new URL(request.url).searchParams.get('branch')
      const branch = given === null ? undefined : branchOf(given)
      const exists = branch !== undefined && !!(await headOf(session.access, repo, branch, fetchFn))
      return json({ base, branch: branch ?? null, exists, entries: await readEntries(session.access, repo, exists ? branch! : base, fetchFn) })
    }

    if (route === '/repo/entry' && request.method === 'PUT') {
      const data = await readBody(request)
      const path = entryPath(data.path)
      if (typeof data.text !== 'string') throw new Refused('The text of the entry is missing.')
      const issues = checkBeforeSaving(path, data.text)
      if (issues.length > 0) throw new Refused('The entry is not valid.', 422, issues)
      const prepared = await prepare(data, session, repo, base, fetchFn)
      const saved = await call<{ content: { sha: string }; commit: { sha: string } }>(fetchFn, session.access, 'PUT', contentsUrl(repo, path), {
        message: message(data.message, `${typeof data.sha === 'string' ? 'Update' : 'Add'} ${path}`),
        content: btoa(String.fromCharCode(...new TextEncoder().encode(data.text))),
        branch: prepared.branch,
        ...(typeof data.sha === 'string' ? { sha: data.sha } : {}),
      })
      return json({ path, sha: saved.content.sha, commit: saved.commit.sha, branch: prepared.branch, pull: await afterCommit(prepared, session, repo, base, fetchFn) })
    }

    if (route === '/repo/entry' && request.method === 'DELETE') {
      const data = await readBody(request)
      const path = entryPath(data.path)
      if (typeof data.sha !== 'string') throw new Refused('The sha of the entry to remove is missing.')
      const prepared = await prepare(data, session, repo, base, fetchFn)
      const removed = await call<{ commit: { sha: string } }>(fetchFn, session.access, 'DELETE', contentsUrl(repo, path), {
        message: message(data.message, `Remove ${path}`),
        sha: data.sha,
        branch: prepared.branch,
      })
      return json({ path, commit: removed.commit.sha, branch: prepared.branch, pull: await afterCommit(prepared, session, repo, base, fetchFn) })
    }
  } catch (error) {
    return failure(error)
  }
  return json({ error: 'Method not allowed.' }, 405)
}
