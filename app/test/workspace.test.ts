import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, SignedOut, type Api } from '../src/api.js'
import { FakeApi } from '../src/fake.js'
import { titleOf } from '../src/logic.js'
import { POLL_MS, Workspace } from '../src/workspace.svelte.js'

const ERIKA = 'entities/people/erika-mustermann.yaml'
const FEST = 'change/anna/fest'

async function started(api: Api = new FakeApi()) {
  const ws = new Workspace(api)
  await ws.start()
  ws.stopLive() // no timers left behind
  return ws
}
/** Anna works on a change called "Fest". */
async function working(api: Api = new FakeApi()) {
  const ws = await started(api)
  await ws.startChange('Fest')
  return ws
}

describe('starting', () => {
  it('loads the database and the changes once somebody is signed in, and reads only', async () => {
    const ws = await started()
    expect(ws.user?.login).toBe('anna')
    expect(ws.entries).toHaveLength(7)
    expect(ws.changes.map((c) => [c.name, c.author, c.state])).toEqual([['Feuerwehr Texte', 'bernd', 'submitted']])
    expect(ws.branch).toBeUndefined()
    expect(ws.editable).toBe(false)
    expect(ws.readonlyReason).toMatch(/Änderung wählen/)
  })

  it('stays at the sign-in when nobody is', async () => {
    const api = new FakeApi()
    api.me = async () => null
    const ws = await started(api)
    expect(ws.user).toBeNull()
    expect(ws.entries).toEqual([])
  })
})

describe('without a change', () => {
  it('does not take an edit or a new entry', async () => {
    const ws = await started()
    ws.select(ERIKA)
    ws.edit(ws.selected!.text + '# x\n')
    expect(ws.dirty).toHaveLength(0)
    expect(() => ws.create('place', 'Fähre')).toThrow(/Änderung wählen/)
    expect(await ws.save()).toBe(false)
  })
})

describe('starting a change', () => {
  it('makes it current, with the branch from the login and the name, and nothing on the server yet', async () => {
    const ws = await working()
    expect(ws.branch).toBe(FEST)
    expect(ws.current).toEqual({ branch: FEST, name: 'Fest' })
    expect(ws.editable).toBe(true)
    expect(ws.pending).toHaveLength(1)
    expect(ws.changes).toHaveLength(1)
  })

  it('does not take a name that is in use, here or at the server', async () => {
    const ws = await working()
    await expect(ws.startChange('Fest')).rejects.toThrow(/schon eine Änderung/)
    await expect(ws.startChange('???')).rejects.toThrow(/keinen gültigen Namen/)
    ws.select(ERIKA)
    ws.edit(ws.selected!.text + '# x\n')
    await ws.save()
    await ws.switchTo(undefined)
    await expect(ws.startChange('Fest')).rejects.toThrow(/schon eine Änderung/) // now it is at the server
  })

  it('has a pull request and is no longer new after the first save', async () => {
    const ws = await working()
    ws.select(ERIKA)
    ws.edit(ws.selected!.text.replace('Erika Mustermann', 'Erika M.'))
    expect(await ws.save()).toBe(true)
    expect(ws.pending).toEqual([])
    expect(ws.remote).toMatchObject({ name: 'Fest', author: 'anna', state: 'draft' })
    expect(ws.dirty).toHaveLength(0)
    expect(titleOf(ws.selected!)).toBe('Erika M.')
  })

  it('has no pull request while it differs in nothing from the base', async () => {
    const ws = await working()
    ws.select(ERIKA)
    ws.edit(ws.selected!.text + '# x\n')
    ws.revert()
    ws.edit(ws.selected!.text)
    expect(ws.dirty).toHaveLength(0)
    expect(await ws.save()).toBe(true) // saved unchanged: the branch exists, nothing to propose
    expect(ws.changes).toHaveLength(1)
    expect(ws.pending).toHaveLength(1)
  })
})

describe('editing and saving', () => {
  it('says what is wrong while it is wrong', async () => {
    const ws = await working()
    ws.select(ERIKA)
    ws.edit('id: erika-mustermann\ntype: person\n')
    expect(ws.issues.map((i) => i.message)).toEqual(['missing field "name"'])
  })

  it('shows what the server refused with, and does not count it as saved', async () => {
    const api = new FakeApi()
    api.save = async () => {
      throw new ApiError('Der Eintrag ist nicht gültig.', 422, [{ path: '/name', message: 'zu kurz' }])
    }
    const ws = await working(api)
    ws.select(ERIKA)
    ws.edit(ws.selected!.text + '# x\n')
    expect(await ws.save()).toBe(false)
    expect(ws.refused).toEqual([{ path: '/name', message: 'zu kurz' }])
    expect(ws.dirty).toHaveLength(1)
  })

  it('keeps a typed change that came while the save was on its way', async () => {
    const api = new FakeApi()
    const ws = await working(api)
    ws.select(ERIKA)
    const sent = ws.selected!.text + '# sent\n'
    ws.edit(sent)
    const original = api.save.bind(api)
    api.save = async (path, text, sha, change) => {
      ws.edit(text + '# typed meanwhile\n')
      return original(path, text, sha, change)
    }
    await ws.save()
    expect(ws.dirty).toHaveLength(1)
    expect(ws.selected!.saved).toBe(sent)
  })

  it('tells a clash in words and keeps the change', async () => {
    const api = new FakeApi()
    const ws = await working(api)
    ws.select(ERIKA)
    ws.edit(ws.selected!.text + '# mine\n')
    await api.save(ERIKA, ws.selected!.saved + '# theirs\n', ws.selected!.sha, { branch: FEST, name: 'Fest' })
    expect(await ws.save()).toBe(false)
    expect(ws.error).toMatch(/inzwischen anderswo geändert/)
    expect(ws.dirty).toHaveLength(1)
    await ws.load()
    expect(ws.selected!.text.endsWith('# mine\n')).toBe(true)
    expect(await ws.save()).toBe(true)
  })

  it('ends at the sign-in when the session is over', async () => {
    const api = new FakeApi()
    const ws = await working(api)
    api.entries = async () => {
      throw new SignedOut()
    }
    await ws.load()
    expect(ws.user).toBeNull()
    expect(ws.branch).toBeUndefined()
  })

  it('is not possible once the change is closed, and says so', async () => {
    const ws = await working()
    ws.select(ERIKA)
    ws.edit(ws.selected!.text + '# x\n')
    await ws.save()
    await ws.review.select(ws.remote!.number)
    await ws.review.act('close')
    expect(ws.editable).toBe(false)
    expect(ws.readonlyReason).toMatch(/abgeschlossen/)
    ws.edit(ws.selected!.text + '# more\n')
    expect(ws.dirty).toHaveLength(0)
  })
})

describe('new entries', () => {
  it('are made, saved and then are ordinary entries', async () => {
    const ws = await working()
    ws.create('place', 'Alte Fähre')
    expect(ws.selected?.path).toBe('entities/places/alte-faehre.yaml')
    expect(ws.dirty).toHaveLength(1)
    expect(await ws.save()).toBe(true)
    expect(ws.selected!.sha).toBeDefined()
    expect(ws.remote?.state).toBe('draft')
  })

  it('cannot take an id that is in use, and disappear when discarded', async () => {
    const ws = await working()
    expect(() => ws.create('person', 'Erika Mustermann')).toThrow(/schon einen Eintrag/)
    ws.create('person', 'Neu')
    ws.revert()
    expect(ws.selected).toBeUndefined()
    expect(ws.entries).toHaveLength(7)
  })
})

describe('removing', () => {
  it('removes in the change what was saved before', async () => {
    const api = new FakeApi()
    const ws = await working(api)
    ws.select('entities/events/osterfeuer.yaml')
    expect(await ws.remove()).toBe(true)
    expect(ws.entries.some((e) => e.path === 'entities/events/osterfeuer.yaml')).toBe(false)
    expect((await api.entries(FEST)).entries).toHaveLength(6)
    expect((await api.entries()).entries).toHaveLength(7) // main is untouched
    expect(ws.remote?.state).toBe('draft')
  })
})

describe('working on another change', () => {
  it('shows the entries of that change, and leaves unsaved edits behind', async () => {
    const ws = await working()
    ws.select(ERIKA)
    ws.edit(ws.selected!.text + '# open\n')
    await ws.switchTo('change/bernd/feuerwehr-texte')
    expect(ws.dirty).toHaveLength(0)
    expect(ws.entries.find((e) => e.path === 'entities/organizations/feuerwehr-schnackenburg.yaml')!.text).toContain('e. V.')
    expect(ws.editable).toBe(true) // everybody may change everything
    await ws.switchTo(undefined)
    expect(ws.entries.find((e) => e.path === 'entities/organizations/feuerwehr-schnackenburg.yaml')!.text).not.toContain('e. V.')
  })

  it('keeps what has been changed and not saved when loading again', async () => {
    const ws = await working()
    ws.select(ERIKA)
    ws.edit(ws.selected!.text + '# open\n')
    ws.create('place', 'Neuer Ort')
    await ws.load()
    expect(ws.dirty.map((e) => e.path).sort()).toEqual([ERIKA, 'entities/places/neuer-ort.yaml'])
  })
})

describe('a change that is accepted', () => {
  it('leaves the database as it is now, and nothing to work on', async () => {
    const ws = await working()
    ws.select(ERIKA)
    ws.edit(ws.selected!.text.replace('Erika Mustermann', 'Erika M.'))
    await ws.save()
    await ws.review.select(ws.remote!.number)
    expect(await ws.review.act('submit')).toBe(true)
    expect(await ws.review.act('merge')).toBe(true)
    expect(ws.branch).toBeUndefined()
    expect(titleOf(ws.entries.find((e) => e.path === ERIKA)!)).toBe('Erika M.')
    expect(ws.changes.find((c) => c.name === 'Fest')?.state).toBe('merged')
  })

  it('is noticed when it was accepted elsewhere', async () => {
    const api = new FakeApi()
    const ws = await started(api)
    await api.merge(1)
    await ws.news({ type: 'push' })
    expect(ws.changes[0].state).toBe('merged')
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
    await vi.waitFor(() => expect(ws.changes[0].state).toBe('closed'))
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
      const changes = vi.spyOn(api, 'changes')
      await vi.advanceTimersByTimeAsync(POLL_MS)
      expect(changes).toHaveBeenCalledTimes(1)
      ws.stopLive()
      await vi.advanceTimersByTimeAsync(POLL_MS * 2)
      expect(changes).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
