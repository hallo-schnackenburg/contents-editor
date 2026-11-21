// The data repository: reading all entries and saving one, always as the signed-in person.
//
//   GET    /repo/entries   every entry of the person's branch (or of the base branch, if they have none yet)
//   PUT    /repo/entry     saves one entry as a commit on the person's branch; the branch is made on the first save
//   DELETE /repo/entry     removes one entry the same way
//
// The person's branch is edit/<login>. It is not merged anywhere yet (that is the pull requests, later).
// Nothing invalid is written: an entry has to pass the checks of core (schema, path, files, text) first.

import { checkPath, readObject, validateEntryYaml, type Issue } from '@contents-editor/core'
import { GitHubError, call } from './github.js'
import type { Auth } from './session.js'
import type { GithubEnv } from './github.js'

type Env = GithubEnv

/** An entry file: below entities/, contents/ or media/, lower-case segments, ending in .yaml. */
const ENTRY_PATH = /^(?:entities|contents|media)(?:\/[a-z0-9][a-z0-9-]*)+\.yaml$/
const MAX_ENTRIES = 3000
const CHUNK = 100
const MAX_BODY = 400_000

export const branchOf = (login: string) => `edit/${login.replace(/[^A-Za-z0-9-]/g, '-')}`

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

interface Entry {
  path: string
  sha: string
  text: string
}

class Refused extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly issues?: Issue[],
  ) {
    super(message)
  }
}

/** The head commit of a branch, or undefined if there is no such branch. */
async function headOf(token: string, repo: string, branch: string, fetchFn: typeof fetch): Promise<string | undefined> {
  try {
    const ref = await call<{ object: { sha: string } }>(fetchFn, token, 'GET', `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch).replace(/%2F/g, '/')}`)
    return ref.object.sha
  } catch (error) {
    if (error instanceof GitHubError && (error.status === 404 || error.status === 409)) return undefined
    throw error
  }
}

/** Makes the person's branch from the base branch if it is not there yet. */
async function ensureBranch(token: string, repo: string, base: string, branch: string, fetchFn: typeof fetch): Promise<void> {
  if (await headOf(token, repo, branch, fetchFn)) return
  const from = await headOf(token, repo, base, fetchFn)
  if (!from) throw new Refused(`The base branch "${base}" does not exist (is the repository empty?).`, 409)
  await call(fetchFn, token, 'POST', `/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: from })
}

/** All entries of a branch: the file list, then the texts in as few requests as possible (GraphQL, 100 files each). */
async function readEntries(token: string, repo: string, ref: string, fetchFn: typeof fetch): Promise<Entry[]> {
  const tree = await call<{ tree: { path: string; type: string; sha: string }[]; truncated: boolean }>(fetchFn, token, 'GET', `/repos/${repo}/git/trees/${encodeURIComponent(ref).replace(/%2F/g, '/')}?recursive=1`)
  const files = tree.tree.filter((n) => n.type === 'blob' && ENTRY_PATH.test(n.path))
  if (tree.truncated || files.length > MAX_ENTRIES) throw new Refused('The repository has too many entries for this version of the editor.', 413)
  const [owner, name] = repo.split('/')
  const entries: Entry[] = []
  for (let i = 0; i < files.length; i += CHUNK) {
    const part = files.slice(i, i + CHUNK)
    const variables: Record<string, string> = { owner, name }
    part.forEach((f, j) => (variables[`e${j}`] = `${ref}:${f.path}`))
    const query = `query($owner:String!,$name:String!${part.map((_, j) => `,$e${j}:String!`).join('')}){repository(owner:$owner,name:$name){${part
      .map((_, j) => `f${j}:object(expression:$e${j}){...on Blob{oid text}}`)
      .join(' ')}}}`
    const data = await call<{ data?: { repository?: Record<string, { oid: string; text: string | null } | null> }; errors?: { message: string }[] }>(fetchFn, token, 'POST', '/graphql', { query, variables })
    if (data.errors?.length || !data.data?.repository) throw new GitHubError(data.errors?.[0]?.message ?? 'GitHub could not read the entries.', 502)
    part.forEach((f, j) => {
      const blob = data.data!.repository![`f${j}`]
      if (blob && typeof blob.text === 'string') entries.push({ path: f.path, sha: blob.oid, text: blob.text })
    })
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path))
}

async function body(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text()
  if (raw.length > MAX_BODY) throw new Refused('Request too large.', 413)
  try {
    const data = JSON.parse(raw)
    if (typeof data === 'object' && data !== null && !Array.isArray(data)) return data
  } catch {
    // fall through
  }
  throw new Refused('Body must be a JSON object.')
}

const message = (given: unknown, fallback: string) => (typeof given === 'string' && given.trim() ? given.trim().slice(0, 200) : fallback)

function entryPath(value: unknown): string {
  if (typeof value !== 'string' || !ENTRY_PATH.test(value)) throw new Refused('Not the path of an entry (entities/…, contents/… or media/…, ending in .yaml).')
  return value
}

/** Checks what would be written: shape, text lengths, file paths, and that the file is where its id and type say. */
export function checkBeforeSaving(path: string, text: string): Issue[] {
  const issues = validateEntryYaml(text)
  if (issues.length > 0) return issues
  return checkPath(path, readObject(text) ?? {})
}

const contentsUrl = (repo: string, path: string) => `/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`

export async function handleRepo(request: Request, route: string, session: Auth, env: Env, fetchFn: typeof fetch): Promise<Response | null> {
  if (route !== '/repo/entries' && route !== '/repo/entry') return null
  const repo = env.DATA_REPO
  const base = env.BASE_BRANCH ?? 'main'
  if (!repo) return json({ error: 'The server has no DATA_REPO.' }, 500)
  const branch = branchOf(session.login)

  try {
    if (route === '/repo/entries' && request.method === 'GET') {
      const own = !!(await headOf(session.access, repo, branch, fetchFn))
      const from = own ? branch : base
      return json({ base, branch, own, entries: await readEntries(session.access, repo, from, fetchFn) })
    }

    if (route === '/repo/entry' && request.method === 'PUT') {
      const data = await body(request)
      const path = entryPath(data.path)
      if (typeof data.text !== 'string') throw new Refused('The text of the entry is missing.')
      const issues = checkBeforeSaving(path, data.text)
      if (issues.length > 0) throw new Refused('The entry is not valid.', 422, issues)
      await ensureBranch(session.access, repo, base, branch, fetchFn)
      const saved = await call<{ content: { sha: string }; commit: { sha: string } }>(fetchFn, session.access, 'PUT', contentsUrl(repo, path), {
        message: message(data.message, `${typeof data.sha === 'string' ? 'Update' : 'Add'} ${path}`),
        content: btoa(String.fromCharCode(...new TextEncoder().encode(data.text))),
        branch,
        ...(typeof data.sha === 'string' ? { sha: data.sha } : {}),
      })
      return json({ path, sha: saved.content.sha, commit: saved.commit.sha, branch })
    }

    if (route === '/repo/entry' && request.method === 'DELETE') {
      const data = await body(request)
      const path = entryPath(data.path)
      if (typeof data.sha !== 'string') throw new Refused('The sha of the entry to remove is missing.')
      await ensureBranch(session.access, repo, base, branch, fetchFn)
      const removed = await call<{ commit: { sha: string } }>(fetchFn, session.access, 'DELETE', contentsUrl(repo, path), { message: message(data.message, `Remove ${path}`), sha: data.sha, branch })
      return json({ path, commit: removed.commit.sha, branch })
    }
  } catch (error) {
    if (error instanceof Refused) return json({ error: error.message, ...(error.issues ? { issues: error.issues } : {}) }, error.status)
    if (error instanceof GitHubError) {
      // 409/422 from the contents API: somebody else changed the file (sha does not match); the editor reloads and merges.
      const status = error.status === 401 ? 401 : error.status === 404 ? 404 : error.status === 403 ? 403 : error.status === 409 || error.status === 422 ? 409 : 502
      return json({ error: error.message }, status)
    }
    console.error('Repository error', (error as Error).message)
    return json({ error: 'The repository could not be reached.' }, 502)
  }
  return json({ error: 'Method not allowed.' }, 405)
}
