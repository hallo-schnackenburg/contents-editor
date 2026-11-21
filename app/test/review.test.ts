import { describe, expect, it, vi } from 'vitest'
import { FakeApi } from '../src/fake.js'
import { Workspace } from '../src/workspace.svelte.js'

const ERIKA = 'entities/people/erika-mustermann.yaml'

async function started(api = new FakeApi()) {
  const ws = new Workspace(api)
  await ws.start()
  ws.stopLive()
  return { api, ws, review: ws.review }
}

/** Anna has a draft called "Fest" that changes Erika. */
async function withDraft() {
  const s = await started()
  await s.ws.startChange('Fest')
  s.ws.select(ERIKA)
  s.ws.edit(s.ws.selected!.text.replace('Erika Mustermann', 'Erika M.'))
  await s.ws.save()
  return { ...s, number: s.ws.remote!.number }
}

describe('the list', () => {
  it('has three lists with their numbers, the waiting ones first', async () => {
    const { review } = await started()
    expect(review.filter).toBe('waiting')
    expect(review.count).toEqual({ waiting: 1, drafts: 0, done: 0 })
    expect(review.shown.map((c) => c.name)).toEqual(['Feuerwehr Texte'])
    review.filter = 'drafts'
    expect(review.shown).toEqual([])
  })

  it('follows the changes that are started and accepted', async () => {
    const { review, number } = await withDraft()
    expect(review.count).toEqual({ waiting: 1, drafts: 1, done: 0 })
    await review.select(number)
    await review.act('submit')
    await review.act('merge')
    expect(review.count).toEqual({ waiting: 1, drafts: 0, done: 1 })
  })
})

describe('looking at a change', () => {
  it('loads what it does and its comments', async () => {
    const { review } = await started()
    await review.select(1)
    expect(review.detailState).toBe('ready')
    expect(review.detail?.items.map((i) => [i.path, i.change])).toEqual([['entities/organizations/feuerwehr-schnackenburg.yaml', 'modified']])
    expect(review.detail?.checks).toBe('success')
    expect(review.blocked).toBeUndefined()
  })

  it('takes only the newest of several requests', async () => {
    const { api, review } = await started()
    const slow = api.change.bind(api)
    api.change = async (n) => {
      if (n === 1) await new Promise((r) => setTimeout(r, 20))
      return slow(n)
    }
    const first = review.select(1)
    await review.select(2).catch(() => undefined)
    await first
    expect(review.selected).toBe(2)
    expect(review.detail?.change.number).not.toBe(1)
  })

  it('cannot be accepted while the check fails or an entry is not valid', async () => {
    const { api, review } = await started()
    const detail = await api.change(1)
    api.change = async () => ({ ...detail, checks: 'failure' })
    await review.select(1)
    expect(review.blocked).toMatch(/Prüfung ist fehlgeschlagen/)
    api.change = async () => ({ ...detail, items: [{ path: 'entities/people/x.yaml', change: 'added', after: 'id: x\ntype: person\n' }] })
    await review.select(1)
    expect(review.blocked).toMatch(/nicht gültig/)
    expect([...review.problems.keys()]).toEqual(['entities/people/x.yaml'])
  })
})

describe('doing something with a change', () => {
  it('submits a draft, accepts it, and the database has it', async () => {
    const { ws, review, number } = await withDraft()
    await review.select(number)
    review.filter = 'drafts'
    expect(await review.act('merge')).toBe(false) // still a draft
    expect(review.error).toMatch(/erst einreichen/)
    expect(await review.act('submit')).toBe(true)
    expect(review.change?.state).toBe('submitted')
    expect(review.filter).toBe('waiting')
    expect(await review.act('merge')).toBe(true)
    expect(review.change?.state).toBe('merged')
    expect(review.filter).toBe('done')
    expect(review.acting).toBeUndefined()
    expect(ws.entries.find((e) => e.path === ERIKA)!.text).toContain('Erika M.')
  })

  it('still shows what an accepted change did', async () => {
    const { review, number } = await withDraft()
    await review.select(number)
    await review.act('submit')
    await review.act('merge')
    expect(review.detail?.items.map((i) => i.path)).toEqual([ERIKA])
  })

  it('closes a change without taking it over', async () => {
    const { ws, review } = await started()
    await review.select(1)
    expect(await review.act('close')).toBe(true)
    expect(review.change?.state).toBe('closed')
    expect(ws.entries.find((e) => e.path === 'entities/organizations/feuerwehr-schnackenburg.yaml')!.text).not.toContain('e. V.')
  })

  it('says what the server refused and looks at the list again', async () => {
    const { api, review } = await started()
    await review.select(1)
    await api.close(1) // somebody else was faster
    expect(await review.act('merge')).toBe(false)
    expect(review.error).toMatch(/abgeschlossen/)
    expect(review.change?.state).toBe('closed')
  })
})

describe('comments', () => {
  it('are written and shown, and an empty one is not sent', async () => {
    const { api, review } = await started()
    await review.select(1)
    const send = vi.spyOn(api, 'comment')
    expect(await review.comment('   ')).toBe(false)
    expect(send).not.toHaveBeenCalled()
    expect(await review.comment('Bitte prüfen.')).toBe(true)
    expect(review.comments.map((c) => c.body)).toEqual(['Bitte prüfen.'])
  })

  it('come with the news of a comment, for the change that is open only', async () => {
    const { api, review } = await started()
    await review.select(1)
    const comments = vi.spyOn(api, 'comments')
    await review.news({ type: 'comment', number: 2 })
    expect(comments).not.toHaveBeenCalled()
    await api.comment(1, 'von bernd')
    await review.news({ type: 'comment', number: 1 })
    expect(review.comments.map((c) => c.body)).toEqual(['von bernd'])
  })
})
