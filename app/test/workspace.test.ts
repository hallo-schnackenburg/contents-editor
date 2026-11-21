import { describe, expect, it } from 'vitest'
import { ApiError, SignedOut, type Api, type EntriesResult } from '../src/api.js'
import { FakeApi } from '../src/fake.js'
import { Workspace } from '../src/workspace.svelte.js'
import { titleOf } from '../src/logic.js'

async function started(api: Api = new FakeApi()) {
  const ws = new Workspace(api)
  await ws.start()
  return ws
}

describe('starting', () => {
  it('loads the entries once somebody is signed in', async () => {
    const ws = await started()
    expect(ws.user?.login).toBe('anna')
    expect(ws.entries).toHaveLength(7)
    expect(ws.branch).toBe('edit/anna')
  })

  it('stays at the sign-in when nobody is', async () => {
    const ws = await started({ ...new FakeApi(), me: async () => null } as unknown as Api)
    expect(ws.user).toBeNull()
    expect(ws.entries).toEqual([])
  })
})

describe('editing and saving', () => {
  it('marks an entry as changed, saves it and has it saved', async () => {
    const ws = await started()
    ws.select('entities/people/erika-mustermann.yaml')
    ws.edit(ws.selected!.text.replace('Erika Mustermann', 'Erika M.'))
    expect(ws.dirty).toHaveLength(1)
    expect(await ws.save()).toBe(true)
    expect(ws.dirty).toHaveLength(0)
    expect(titleOf(ws.selected!)).toBe('Erika M.')
  })

  it('says what is wrong while it is wrong', async () => {
    const ws = await started()
    ws.select('entities/people/erika-mustermann.yaml')
    ws.edit('id: erika-mustermann\ntype: person\n')
    expect(ws.issues.map((i) => i.message)).toEqual(['missing field "name"'])
  })

  it('shows what the server refused with, and does not count it as saved', async () => {
    const api = new FakeApi()
    api.save = async () => {
      throw new ApiError('Der Eintrag ist nicht gültig.', 422, [{ path: '/name', message: 'zu kurz' }])
    }
    const ws = await started(api)
    ws.select('entities/people/erika-mustermann.yaml')
    ws.edit(ws.selected!.text + '# x\n')
    expect(await ws.save()).toBe(false)
    expect(ws.refused).toEqual([{ path: '/name', message: 'zu kurz' }])
    expect(ws.dirty).toHaveLength(1)
  })

  it('keeps a typed change that came while the save was on its way', async () => {
    const api = new FakeApi()
    const ws = await started(api)
    ws.select('entities/people/erika-mustermann.yaml')
    const sent = ws.selected!.text + '# sent\n'
    ws.edit(sent)
    const original = api.save.bind(api)
    api.save = async (path, text, sha) => {
      ws.edit(text + '# typed meanwhile\n')
      return original(path, text, sha)
    }
    await ws.save()
    expect(ws.dirty).toHaveLength(1)
    expect(ws.selected!.saved).toBe(sent)
  })

  it('tells a clash in words and keeps the change', async () => {
    const api = new FakeApi()
    const ws = await started(api)
    ws.select('entities/people/erika-mustermann.yaml')
    ws.edit(ws.selected!.text + '# mine\n')
    await api.save('entities/people/erika-mustermann.yaml', ws.selected!.saved + '# theirs\n', ws.selected!.sha)
    expect(await ws.save()).toBe(false)
    expect(ws.error).toMatch(/inzwischen anderswo geändert/)
    expect(ws.dirty).toHaveLength(1)
    await ws.load()
    expect(ws.selected!.text.endsWith('# mine\n')).toBe(true)
    expect(await ws.save()).toBe(true)
  })

  it('ends at the sign-in when the session is over', async () => {
    const api = new FakeApi()
    const ws = await started(api)
    api.entries = async () => {
      throw new SignedOut()
    }
    await ws.load()
    expect(ws.user).toBeNull()
  })
})

describe('new entries', () => {
  it('are made, saved and then are ordinary entries', async () => {
    const ws = await started()
    ws.create('place', 'Alte Fähre')
    expect(ws.selected?.path).toBe('entities/places/alte-faehre.yaml')
    expect(ws.dirty).toHaveLength(1)
    expect(await ws.save()).toBe(true)
    expect(ws.selected!.sha).toBeDefined()
    expect((await new FakeApi().entries()).entries).toHaveLength(7) // each FakeApi has its own memory
  })

  it('cannot take an id that is in use, and disappear when discarded', async () => {
    const ws = await started()
    expect(() => ws.create('person', 'Erika Mustermann')).toThrow(/schon einen Eintrag/)
    ws.create('person', 'Neu')
    ws.revert()
    expect(ws.selected).toBeUndefined()
    expect(ws.entries).toHaveLength(7)
  })
})

describe('removing', () => {
  it('removes at the server what was saved there', async () => {
    const api = new FakeApi()
    const ws = await started(api)
    ws.select('entities/events/osterfeuer.yaml')
    expect(await ws.remove()).toBe(true)
    expect(ws.entries.some((e) => e.path === 'entities/events/osterfeuer.yaml')).toBe(false)
    expect((await api.entries()).entries).toHaveLength(6)
  })
})

describe('loading again', () => {
  it('keeps what has been changed and not saved', async () => {
    const ws = await started()
    ws.select('entities/people/erika-mustermann.yaml')
    ws.edit(ws.selected!.text + '# open\n')
    ws.create('place', 'Neuer Ort')
    await ws.load()
    expect(ws.dirty.map((e) => e.path).sort()).toEqual(['entities/people/erika-mustermann.yaml', 'entities/places/neuer-ort.yaml'])
  })
})

describe('listing', () => {
  it('has a result type the server gives', async () => {
    const result: EntriesResult = await new FakeApi().entries()
    expect(result.entries[0]).toHaveProperty('sha')
  })
})
