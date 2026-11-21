import { handle, type Env } from '../src/index.js'

export const env: Env = {
  GITHUB_CLIENT_ID: 'cid',
  GITHUB_CLIENT_SECRET: 'secret',
  SESSION_SECRET: 'test-secret-test-secret',
  DATA_REPO: 'o/r',
  BASE_BRANCH: 'main',
  APP_URL: 'http://localhost:5174',
  ALLOWED_ORIGIN: 'http://localhost:5174',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** A GitHub that knows one repository: a base branch, the branches made on it, and what is committed. */
export function fakeGitHub(initial: Record<string, string> = {}, permissions = { push: true, admin: false }) {
  const files = new Map(Object.entries(initial))
  const branches = new Map<string, Map<string, string>>([['main', new Map(files)]])
  const calls: { method: string; url: string; body?: any }[] = []
  const blob = (text: string) => `sha-${text.length}-${text.slice(0, 6)}`

  const fn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input))
    const method = init.method ?? 'GET'
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ method, url: `${url.pathname}${url.search}`, body })
    const path = decodeURIComponent(url.pathname)

    if (url.host === 'github.com' && path === '/login/oauth/access_token') {
      return body.code === 'good'
        ? json({ access_token: 'ghu_token', expires_in: 28800, refresh_token: 'ghr_token', refresh_token_expires_in: 15811200 })
        : json({ error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' })
    }
    if (path === '/user') return json({ login: 'anna', name: 'Anna', avatar_url: 'https://avatars.example/anna' })
    if (path === '/repos/o/r') return json({ permissions })
    if (method === 'DELETE' && path.startsWith('/applications/')) return new Response(null, { status: 204 })

    let m = path.match(/^\/repos\/o\/r\/git\/ref\/heads\/(.+)$/)
    if (m) return branches.has(m[1]) ? json({ object: { sha: `head-${m[1]}` } }) : json({ message: 'Not Found' }, 404)
    if (method === 'POST' && path === '/repos/o/r/git/refs') {
      branches.set(body.ref.replace('refs/heads/', ''), new Map(branches.get('main')))
      return json({ ref: body.ref }, 201)
    }
    m = path.match(/^\/repos\/o\/r\/git\/trees\/(.+)$/)
    if (m) {
      const tree = [...(branches.get(m[1]) ?? new Map()).entries()].map(([p, t]) => ({ path: p, type: 'blob', sha: blob(t) }))
      return json({ tree: [{ path: 'entities', type: 'tree', sha: 'x' }, ...tree], truncated: false })
    }
    if (method === 'POST' && path === '/graphql') {
      const repository: Record<string, unknown> = {}
      Object.entries(body.variables as Record<string, string>).forEach(([k, v]) => {
        if (!k.startsWith('e')) return
        const [ref, ...p] = v.split(':')
        const text = branches.get(ref)?.get(p.join(':'))
        repository[`f${k.slice(1)}`] = text === undefined ? null : { oid: blob(text), text }
      })
      return json({ data: { repository } })
    }
    m = path.match(/^\/repos\/o\/r\/contents\/(.+)$/)
    if (m && (method === 'PUT' || method === 'DELETE')) {
      const branch = branches.get(body.branch)
      if (!branch) return json({ message: 'Branch not found' }, 404)
      const before = branch.get(m[1])
      if (before !== undefined && body.sha !== blob(before)) return json({ message: `${m[1]} does not match ${body.sha}` }, 409)
      if (method === 'DELETE') {
        branch.delete(m[1])
        return json({ commit: { sha: 'commit-delete' } })
      }
      const text = new TextDecoder().decode(Uint8Array.from(atob(body.content), (c) => c.charCodeAt(0)))
      branch.set(m[1], text)
      return json({ content: { sha: blob(text) }, commit: { sha: 'commit-put' } })
    }
    return json({ message: `unexpected ${method} ${path}` }, 500)
  }) as typeof fetch

  return { fn, calls, branches, blob }
}

/** Signs Anna in through the whole flow and returns the cookie of her session. */
export async function signIn(gh = fakeGitHub()) {
  const login = await handle(new Request('http://worker/api/auth/login'), env, gh.fn)
  const state = new URL(login.headers.get('location')!).searchParams.get('state')
  const waiting = login.headers.getSetCookie()[0].split(';')[0]
  const back = await handle(new Request(`http://worker/api/auth/callback?code=good&state=${state}`, { headers: { cookie: waiting } }), env, gh.fn)
  return back.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('contents_editor_session='))!
}

export const request = (cookie: string | undefined, path: string, init: RequestInit = {}) =>
  new Request(`http://worker${path}`, { ...init, headers: { ...(cookie ? { cookie } : {}), ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers as Record<string, string>) } })
