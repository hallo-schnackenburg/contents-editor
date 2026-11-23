import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, SignedOut, type Api } from '../src/api.js'
import { FakeApi } from '../src/fake.js'
import { titleOf } from '../src/logic.js'
import { POLL_MS, Workspace, defaultName } from '../src/workspace.svelte.js'

const ERIKA = 'entities/people/erika-mustermann.yaml'
const FEST = 'submission/anna/fest'

async function started(api: Api = new FakeApi()) {
  const ws = new Workspace(api)
  await ws.start()
  ws.stopLive() // no timers left behind
  return ws
}
/** Makes a change to Erika and a new place, so that there is something to make a submission of. */
function someChanges(ws: Workspace) {
  ws.select(ERIKA)
  ws.edit(ws.selected!.text.replace('Erika Mustermann', 'Erika M.'))
  ws.create('place', 'Alte Fähre')
}

describe('starting', () => {
  it('loads the database and the submissions once somebody is signed in; changes can be made at once', async () => {
    const ws = await started()
    expect(ws.user?.login).toBe('anna')
    expect(ws.entries).toHaveLength(7)
    expect(ws.submissions.map((c) => [c.name, c.author, c.state])).toEqual([['Feuerwehr Texte', 'bernd', 'submitted']])
    expect(ws.branch).toBeUndefined()
    expect(ws.editable).toBe(true)
    expect(ws.changes).toEqual([])
  })

  it('stays at the sign-in when nobody is', async () => {
    const api = new FakeApi()
    api.me = async () => null
    const ws = await started(api)
    expect(ws.user).toBeNull()
    expect(ws.entries).toEqual([])
    expect(ws.editable).toBe(false)
  })
})

describe('the changes', () => {
  it('are the difference to the base: what was made, changed and deleted; the server gets to know when the entry is finished', async () => {
    const api = new FakeApi()
    const ws = await started(api)
    someChanges(ws)
    expect(ws.changes).toEqual([]) // typed, not finished: no change, nothing at the server
    expect((await api.submissions()).length).toBe(1)
    ws.select('entities/events/osterfeuer.yaml')
    expect(await ws.remove()).toBe(true) // deleting saves, with everything that is waiting
    expect(ws.changes.map((e) => [e.kind, e.entry.path])).toEqual([
      ['new', 'entities/places/alte-faehre.yaml'],
      ['changed', ERIKA],
      ['removed', 'entities/events/osterfeuer.yaml'],
    ])
    expect(ws.entries.some((e) => e.path === 'entities/events/osterfeuer.yaml')).toBe(false)
    expect(ws.selected).toBeUndefined()
    expect(ws.dirty).toEqual([])
    expect(ws.draft).toMatchObject({ author: 'anna', state: 'draft' })
  })

  it('can be taken back one by one (each is saved): a new entry disappears, a changed one is as the base has it, a deleted one is back', async () => {
    const ws = await started()
    someChanges(ws)
    ws.select('entities/events/osterfeuer.yaml')
    await ws.remove()
    await ws.discard('entities/places/alte-faehre.yaml')
    await ws.discard(ERIKA)
    expect(ws.draft).toBeDefined()
    await ws.discard('entities/events/osterfeuer.yaml')
    expect(ws.changes).toEqual([])
    expect(ws.entries).toHaveLength(7)
    expect(titleOf(ws.entries.find((e) => e.path === ERIKA)!)).toBe('Erika Mustermann')
    expect(ws.draft).toBeUndefined() // nothing left to propose: the draft is closed
  })

  it('are made for the open entry again and again: revert takes back what was typed and not saved', async () => {
    const ws = await started()
    ws.select(ERIKA)
    ws.edit(ws.selected!.text + '# x\n')
    expect(ws.dirty).toHaveLength(1)
    ws.revert()
    expect(ws.dirty).toHaveLength(0)
    ws.create('person', 'Neu')
    ws.revert()
    expect(ws.selected).toBeUndefined()
    expect(ws.entries).toHaveLength(7)
  })

  it('say what is wrong while it is wrong', async () => {
    const ws = await started()
    ws.select(ERIKA)
    ws.edit('id: erika-mustermann\ntype: person\n')
    expect(ws.issues.map((i) => i.message)).toEqual(['missing field "name"'])
    expect([...ws.problems.keys()]).toEqual([ERIKA])
  })

  it('make entries in a folder with a parent, numbered when the id is in use', async () => {
    const ws = await started()
    ws.create('place', 'Haus', 'gummern', { parent: 'gummern', kind: 'building', numbered: true })
    expect(ws.selected?.path).toBe('entities/places/gummern/haus.yaml')
    ws.create('place', 'Haus', 'gummern', { parent: 'gummern', kind: 'building', numbered: true })
    expect(ws.selected?.path).toBe('entities/places/gummern/haus-2.yaml')
    expect(ws.selected?.text).toContain('parent: gummern')
  })

  it('cannot make an entry with an id that is in use', async () => {
    const ws = await started()
    expect(() => ws.create('person', 'Erika Mustermann')).toThrow(/schon einen Eintrag/)
  })

  it('stay when the entries are loaded again (what is typed is not lost to news)', async () => {
    const ws = await started()
    someChanges(ws)
    await ws.load()
    expect(ws.dirty.map((e) => e.path).sort()).toEqual([ERIKA, 'entities/places/alte-faehre.yaml'])
    expect(ws.changes).toEqual([])
  })
})

describe('the draft', () => {
  it('is made with the first thing that is finished, named after the day, and every finish is a commit on it', async () => {
    const api = new FakeApi()
    const ws = await started(api)
    expect(ws.draft).toBeUndefined()
    ws.create('place', 'Alte Fähre')
    expect(await ws.finish()).toBe(true)
    expect(ws.draft).toMatchObject({ name: defaultName(), author: 'anna', state: 'draft' })
    const branch = ws.draft!.branch
    expect((await api.entries(branch)).entries.map((e) => e.path)).toContain('entities/places/alte-faehre.yaml')
    // the base has nothing of it
    expect((await api.entries()).entries.map((e) => e.path)).not.toContain('entities/places/alte-faehre.yaml')
    ws.select(ERIKA)
    ws.edit(ws.selected!.text + '# x\n')
    expect(ws.changes.map((c) => c.kind)).toEqual(['new'])
    expect(await ws.finish()).toBe(true)
    expect(ws.submissions.filter((c) => c.author === 'anna')).toHaveLength(1)
    expect((await api.entries(branch)).entries.find((e) => e.path === ERIKA)!.text).toContain('# x')
    expect(ws.changes.map((c) => c.kind)).toEqual(['new', 'changed'])
  })

  it('has the name the person gave it before it was made, and can be renamed afterwards', async () => {
    const ws = await started()
    await ws.rename('  Fest   am Elbufer ')
    expect(ws.draft).toBeUndefined() // nothing to name yet
    ws.create('place', 'Alte Fähre')
    await ws.finish()
    expect(ws.draft?.name).toBe('Fest am Elbufer')
    await ws.rename('Elbfest')
    expect(ws.draft?.name).toBe('Elbfest')
    expect(ws.submissions.find((c) => c.author === 'anna')?.name).toBe('Elbfest')
  })

  it('is not written while there are problems, and the entry is opened', async () => {
    const ws = await started()
    ws.select(ERIKA)
    ws.edit('id: erika-mustermann\ntype: person\n')
    ws.select(undefined)
    expect(await ws.finish()).toBe(false)
    expect(ws.error).toMatch(/Probleme/)
    expect(ws.selectedPath).toBe(ERIKA)
    expect(ws.draft).toBeUndefined()
  })

  it('shows what the server refused with, and keeps what was typed', async () => {
    const api = new FakeApi()
    api.commit = async () => {
      throw new ApiError('Der Eintrag ist nicht gültig.', 422, [{ path: '/name', message: 'zu kurz' }])
    }
    const ws = await started(api)
    someChanges(ws)
    expect(await ws.finish()).toBe(false)
    expect(ws.refused).toEqual([{ path: '/name', message: 'zu kurz' }])
    expect(ws.dirty.length).toBe(2)
  })

  it('is handed in: it is ready for review, and the person starts the next draft from the base', async () => {
    const ws = await started()
    someChanges(ws)
    expect(await ws.submit()).toBe(true)
    const submitted = ws.submissions.find((c) => c.author === 'anna')!
    expect(submitted.state).toBe('submitted')
    expect(ws.draft).toBeUndefined()
    expect(ws.dirty).toEqual([])
    // the base does not have it before it is accepted
    expect(ws.changes).toEqual([])
    expect(titleOf(ws.entries.find((e) => e.path === ERIKA)!)).toBe('Erika Mustermann')
  })

  it('sees what was done to it elsewhere', async () => {
    const api = new FakeApi()
    const ws = await started(api)
    someChanges(ws)
    await ws.finish()
    const own = ws.draft!
    await api.commit([{ path: 'entities/places/zweite-faehre.yaml', text: 'id: zweite-faehre\ntype: place\nname: Zweite Fähre\n' }], [], { branch: own.branch, name: own.name })
    await ws.news({ type: 'pull', number: own.number })
    expect(ws.entries.map((e) => e.path)).toContain('entities/places/zweite-faehre.yaml')
    await api.submit(own.number)
    await ws.news({ type: 'pull', number: own.number })
    expect(ws.draft).toBeUndefined()
    expect(ws.entries.map((e) => e.path)).not.toContain('entities/places/alte-faehre.yaml')
  })

  it('ends at the sign-in when the session is over', async () => {
    const api = new FakeApi()
    const ws = await started(api)
    api.entries = async () => {
      throw new SignedOut()
    }
    await ws.load()
    expect(ws.user).toBeNull()
    expect(ws.branch).toBeUndefined()
  })
})

describe('looking at a submission', () => {
  it('shows its entries to read, and what was typed waits until the own work is shown again', async () => {
    const ws = await started()
    ws.select(ERIKA)
    ws.edit(ws.selected!.text + '# open\n')
    await ws.switchTo('submission/bernd/feuerwehr-texte')
    expect(ws.editable).toBe(false)
    expect(ws.readonlyReason).toMatch(/nur zum Lesen/)
    expect(ws.entries.find((e) => e.path === 'entities/organizations/feuerwehr-schnackenburg.yaml')!.text).toContain('e. V.')
    ws.select(ERIKA)
    ws.edit(ws.selected!.text + '# more\n')
    expect(ws.dirty).toHaveLength(0)
    await ws.switchTo(undefined)
    expect(ws.entries.find((e) => e.path === 'entities/organizations/feuerwehr-schnackenburg.yaml')!.text).not.toContain('e. V.')
    expect(ws.entries.find((e) => e.path === ERIKA)!.text).not.toContain('# more')
  })
})

describe('a submission that is accepted', () => {
  it('is in the database after that', async () => {
    const ws = await started()
    ws.select(ERIKA)
    ws.edit(ws.selected!.text.replace('Erika Mustermann', 'Erika M.'))
    await ws.submit()
    const mine = ws.submissions.find((c) => c.author === 'anna')!
    await ws.review.select(mine.number)
    expect(await ws.review.act('merge')).toBe(true)
    expect(ws.branch).toBeUndefined()
    expect(titleOf(ws.entries.find((e) => e.path === ERIKA)!)).toBe('Erika M.')
    expect(ws.submissions.find((c) => c.number === mine.number)?.state).toBe('merged')
  })

  it('is noticed when it was accepted elsewhere', async () => {
    const api = new FakeApi()
    const ws = await started(api)
    await api.merge(1)
    await ws.news({ type: 'push' })
    expect(ws.submissions[0].state).toBe('merged')
    expect(ws.entries.find((e) => e.path === 'entities/organizations/feuerwehr-schnackenburg.yaml')!.text).toContain('e. V.')
  })
})

describe('news', () => {
  it('are listened to: what changed is asked for again', async () => {
    const api = new FakeApi()
    const ws = new Workspace(api)
    await ws.start()
    expect(ws.liveOpen).toBe(true)
    await api.close(1)
    await vi.waitFor(() => expect(ws.submissions[0].state).toBe('closed'))
    ws.stopLive()
    expect(ws.liveOpen).toBe(false)
  })

  it('are asked for now and then while the live connection is not there', async () => {
    vi.useFakeTimers()
    try {
      const api = new FakeApi()
      api.listen = () => ({ stop: () => undefined, nudge: () => undefined })
      const ws = new Workspace(api)
      await ws.start()
      const submissions = vi.spyOn(api, 'submissions')
      await vi.advanceTimersByTimeAsync(POLL_MS)
      expect(submissions).toHaveBeenCalledTimes(1)
      ws.stopLive()
      await vi.advanceTimersByTimeAsync(POLL_MS * 2)
      expect(submissions).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
