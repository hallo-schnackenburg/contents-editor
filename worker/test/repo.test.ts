import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { handle } from '../src/index.js'
import { branchOf, checkBeforeSaving } from '../src/repo.js'
import { env, fakeGitHub, request, signIn } from './support.js'

const fixture = (path: string) => readFileSync(new URL(`../../core/test/fixtures/examples/${path}`, import.meta.url), 'utf8')
const PERSON = fixture('entities/people/erika-mustermann.yaml')

async function setup(initial: Record<string, string> = { 'entities/people/erika-mustermann.yaml': PERSON, 'README.md': '# not an entry' }) {
  const gh = fakeGitHub(initial)
  return { gh, cookie: await signIn(gh) }
}
const put = (cookie: string, data: unknown, headers: Record<string, string> = {}) => request(cookie, '/api/repo/entry', { method: 'PUT', body: JSON.stringify(data), headers })

describe('reading the entries', () => {
  it('lists the entries of the base branch, and only entries', async () => {
    const { gh, cookie } = await setup()
    const response = await handle(request(cookie, '/api/repo/entries'), env, gh.fn)
    const data = await response.json() as any
    expect(response.status).toBe(200)
    expect(data).toMatchObject({ base: 'main', branch: 'edit/anna', own: false })
    expect(data.entries).toEqual([{ path: 'entities/people/erika-mustermann.yaml', sha: gh.blob(PERSON), text: PERSON }])
  })

  it('asks GitHub for the texts with variables, not by putting paths into the query', async () => {
    const { gh, cookie } = await setup()
    await handle(request(cookie, '/api/repo/entries'), env, gh.fn)
    const query = gh.calls.find((c) => c.url === '/graphql')!.body
    expect(query.query).not.toContain('erika')
    expect(query.variables.e0).toBe('main:entities/people/erika-mustermann.yaml')
  })
})

describe('saving an entry', () => {
  const NEW = 'id: feuerwehrhaus\ntype: place\nname: Feuerwehrhaus\n'

  it('makes the persons branch on the first save and commits there, never on the base branch', async () => {
    const { gh, cookie } = await setup()
    const response = await handle(put(cookie, { path: 'entities/places/feuerwehrhaus.yaml', text: NEW }), env, gh.fn)
    expect(await response.json()).toMatchObject({ path: 'entities/places/feuerwehrhaus.yaml', branch: 'edit/anna', commit: 'commit-put' })
    expect(gh.branches.get('edit/anna')!.get('entities/places/feuerwehrhaus.yaml')).toBe(NEW)
    expect(gh.branches.get('main')!.has('entities/places/feuerwehrhaus.yaml')).toBe(false)
    const created = gh.calls.find((c) => c.method === 'POST' && c.url === '/repos/o/r/git/refs')!.body
    expect(created).toEqual({ ref: 'refs/heads/edit/anna', sha: 'head-main' })
  })

  it('reads from the persons branch once there is one', async () => {
    const { gh, cookie } = await setup()
    await handle(put(cookie, { path: 'entities/places/feuerwehrhaus.yaml', text: NEW }), env, gh.fn)
    const data = await (await handle(request(cookie, '/api/repo/entries'), env, gh.fn)).json() as any
    expect(data.own).toBe(true)
    expect(data.entries.map((e: any) => e.path)).toEqual(['entities/people/erika-mustermann.yaml', 'entities/places/feuerwehrhaus.yaml'])
  })

  it('does not make a second branch, and a change needs the sha it is based on', async () => {
    const { gh, cookie } = await setup()
    await handle(put(cookie, { path: 'entities/places/feuerwehrhaus.yaml', text: NEW }), env, gh.fn)
    const sha = gh.blob(NEW)
    const changed = NEW.replace('Feuerwehrhaus', 'Feuerwehrhaus Schnackenburg')
    const ok = await handle(put(cookie, { path: 'entities/places/feuerwehrhaus.yaml', text: changed, sha }), env, gh.fn)
    expect(ok.status).toBe(200)
    expect(gh.calls.filter((c) => c.url === '/repos/o/r/git/refs')).toHaveLength(1)
    const stale = await handle(put(cookie, { path: 'entities/places/feuerwehrhaus.yaml', text: NEW, sha }), env, gh.fn)
    expect(stale.status).toBe(409) // somebody (here: the first change) has changed it since
  })

  it('refuses an entry that is not valid, with the issues, and writes nothing', async () => {
    const { gh, cookie } = await setup()
    const response = await handle(put(cookie, { path: 'entities/places/feuerwehrhaus.yaml', text: 'id: feuerwehrhaus\ntype: place\n' }), env, gh.fn)
    expect(response.status).toBe(422)
    expect(((await response.json()) as any).issues).toEqual([{ path: '/', message: 'missing field "name"' }])
    expect(gh.calls.some((c) => c.method === 'PUT')).toBe(false)
    expect(gh.branches.has('edit/anna')).toBe(false)
  })

  it('refuses an entry that is not where its id and type say', async () => {
    const { gh, cookie } = await setup()
    const response = await handle(put(cookie, { path: 'entities/people/feuerwehrhaus.yaml', text: NEW }), env, gh.fn)
    expect(response.status).toBe(422)
    expect(((await response.json()) as any).issues[0].message).toMatch(/belongs in entities\/places/)
  })

  it('only takes paths of entries', async () => {
    const { gh, cookie } = await setup()
    for (const path of ['.github/workflows/validate.yml', 'entities/../x.yaml', 'README.md', 'entities/places/Haus.yaml', '/entities/places/a.yaml', 'other/a.yaml']) {
      const response = await handle(put(cookie, { path, text: NEW }), env, gh.fn)
      expect(response.status, path).toBe(400)
    }
    expect(gh.calls.some((c) => c.method === 'PUT')).toBe(false)
  })

  it('does not take a change from another origin', async () => {
    const { gh, cookie } = await setup()
    const response = await handle(put(cookie, { path: 'entities/places/feuerwehrhaus.yaml', text: NEW }, { origin: 'https://evil.example' }), env, gh.fn)
    expect(response.status).toBe(403)
  })
})

describe('removing an entry', () => {
  it('commits the removal on the persons branch and needs the sha', async () => {
    const { gh, cookie } = await setup()
    const path = 'entities/people/erika-mustermann.yaml'
    const without = await handle(request(cookie, '/api/repo/entry', { method: 'DELETE', body: JSON.stringify({ path }) }), env, gh.fn)
    expect(without.status).toBe(400)
    const response = await handle(request(cookie, '/api/repo/entry', { method: 'DELETE', body: JSON.stringify({ path, sha: gh.blob(PERSON) }) }), env, gh.fn)
    expect(response.status).toBe(200)
    expect(gh.branches.get('edit/anna')!.has(path)).toBe(false)
    expect(gh.branches.get('main')!.has(path)).toBe(true)
  })
})

describe('helpers', () => {
  it('names the branch after the person, safely', () => expect(branchOf('anna_b.c')).toBe('edit/anna-b-c'))
  it('checks what core checks', () => {
    expect(checkBeforeSaving('entities/people/erika-mustermann.yaml', PERSON)).toEqual([])
    expect(checkBeforeSaving('entities/people/x.yaml', PERSON)[0].message).toMatch(/id must be the file name/)
  })
})
