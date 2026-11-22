import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fieldOfIssue, groups, idOf, isDirty, issuesOf, makeEntry, newEntry, setRole, setValue, titleOf, typeOf, withText, shortName } from '../src/logic.js'

const ROOT = new URL('../../core/test/fixtures/examples/', import.meta.url).pathname
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]))
const examples = () => walk(ROOT).map((f) => makeEntry(f.slice(ROOT.length), readFileSync(f, 'utf8'), 'sha'))
const find = (id: string) => examples().find((e) => idOf(e) === id)!

describe('an entry', () => {
  it('knows its id, type and what people call it', () => {
    const e = find('erika-mustermann')
    expect([idOf(e), typeOf(e), titleOf(e)]).toEqual(['erika-mustermann', 'person', 'Erika Mustermann'])
    expect(titleOf(find('osterfeuer-tradition'))).toBe('Das Osterfeuer am Elbdeich')
    expect(titleOf(makeEntry('entities/people/x.yaml', 'nonsense: ['))).toBe('x')
  })

  it('is dirty once its text differs from the saved one', () => {
    const e = find('erika-mustermann')
    expect(isDirty(e)).toBe(false)
    expect(isDirty(withText(e, e.text + '# note\n'))).toBe(true)
  })
})

describe('issues', () => {
  const all = examples()
  it('are none for the examples', () => {
    for (const e of all) expect(issuesOf(e, all), e.path).toEqual([])
  })

  it('include the shape, the path and the references', () => {
    const content = find('osterfeuer-tradition')
    const broken = withText(content, content.text.replace('about: [osterfeuer, feuerwehr-schnackenburg]', 'about: [osterfeuer, gibts-nicht]'))
    expect(issuesOf(broken, all).map((i) => i.message)).toEqual(['"gibts-nicht" does not exist'])
    expect(issuesOf(withText(content, 'id: ['), all)[0].message).toMatch(/syntax error/)
    expect(issuesOf({ ...content, path: 'contents/anders.yaml' }, all)[0].message).toMatch(/id must be the file name/)
  })

  it('belong to the field of their path', () => {
    expect(fieldOfIssue({ path: '/about/1', message: '' })).toBe('about')
    expect(fieldOfIssue({ path: '/text/teaser', message: '' })).toBe('text')
    expect(fieldOfIssue({ path: '/', message: '' })).toBeUndefined()
  })
})

describe('groups', () => {
  it('sort the entries by type and name, and filter', () => {
    const all = examples()
    expect(groups(all).map((g) => [g.label, g.entries.map(titleOf)])).toEqual([
      ['Person', ['Erika Mustermann']],
      ['Organisation', ['Freiwillige Feuerwehr Schnackenburg']],
      ['Ort', ['Festplatz am Elbdeich', 'Feuerwehrhaus Schnackenburg']],
      ['Ereignis', ['Osterfeuer in Schnackenburg']],
      ['Inhalt', ['Das Osterfeuer am Elbdeich']],
      ['Medium', ['Osterfeuer am Deich']],
    ])
    expect(groups(all, 'feuerwehr').map((g) => g.label)).toEqual(['Organisation', 'Ort'])
  })
})

describe('setValue', () => {
  const person = find('erika-mustermann')

  it('changes a text field and keeps the rest', () => {
    const text = setValue(person, 'name', 'string', 'Erika M.')
    expect(text).toContain('name: Erika M.')
    expect(text).toContain('links:')
  })

  it('takes a field out when it is emptied', () => {
    expect(setValue(person, 'links', 'links', [{ label: '', url: '' }])).not.toContain('links')
    expect(setValue(person, 'links', 'links', [{ label: 'Homepage', url: '' }])).not.toContain('links')
    expect(setValue(find('osterfeuer-tradition'), 'authors', 'ref', [])).not.toContain('authors')
  })

  it('writes references as a list, a location only when both numbers are there, and a flag only when set', () => {
    const place = newEntry('place', 'Fähre')
    expect(setValue(place, 'location', 'location', { lat: 53, lon: null })).not.toContain('location')
    expect(setValue(place, 'location', 'location', { lat: 53.01, lon: 11.5 })).toMatch(/location:\n {2}lat: 53.01\n {2}lon: 11.5/)
    const event = newEntry('event', 'Fest')
    expect(setValue(event, 'recurring', 'boolean', true)).toContain('recurring: true')
    expect(setValue(withText(event, setValue(event, 'recurring', 'boolean', true)), 'recurring', 'boolean', false)).not.toContain('recurring')
    expect(setValue(event, 'organizers', 'ref', ['a', 'b'])).toMatch(/organizers:\n {2}- a\n {2}- b/)
  })

  it('writes a text role as a block', () => {
    const content = newEntry('content', 'Fest', 'veranstaltungen')
    expect(setRole(content, 'teaser', 'Ein Satz.')).toContain('text:\n  teaser: |\n    Ein Satz.\n')
  })
})

describe('newEntry', () => {
  it('makes the id from the name and files it where its type says', () => {
    const e = newEntry('person', 'Erika Müller')
    expect([e.path, e.sha, isDirty(e)]).toEqual(['entities/people/erika-mueller.yaml', undefined, true])
    expect(e.text).toBe('id: erika-mueller\ntype: person\nname: "Erika Müller"\n')
  })

  it('files a content in the topic folder, as a title', () => {
    const e = newEntry('content', 'Das Osterfeuer', ' Kunst & Kultur ')
    expect(e.path).toBe('contents/kunst-kultur/das-osterfeuer.yaml')
    expect(e.text).toContain('title: "Das Osterfeuer"')
    expect(() => newEntry('content', 'Ohne Thema', '')).toThrow(/Thema/)
  })

  it('makes media ids with a random end, and refuses a name that has no letter', () => {
    expect(newEntry('media', 'Kirchturm', '', (b) => b.fill(0)).path).toBe('media/k/kirchturm-aaaaa.yaml')
    expect(() => newEntry('person', '???')).toThrow(/keine gültige ID/)
  })
})

describe('places', () => {
  it('shortens a house under the entry its folder is named after (with Nr.)', () => {
    expect([shortName('Am Markt 3', 'Am Markt'), shortName('Am Markt 3a', 'Am Markt'), shortName('Am Markt Passage', 'Am Markt'), shortName('Kirche Gartow', 'Am Markt'), shortName('Am Markt', 'Am Markt')]).toEqual(['Nr. 3', 'Nr. 3a', 'Passage', 'Kirche Gartow', 'Am Markt'])
  })

  it('takes the path below the folder of the type as the id, when the entry does not say', () => {
    expect(idOf(makeEntry('entities/places/gummern/3.yaml', ''))).toBe('gummern/3')
    expect(idOf(makeEntry('entities/places/schnackenburg/elbstrasse/3.yaml', 'id: x\n'))).toBe('x')
    expect(idOf(makeEntry('contents/geschichte/mühle.yaml', ''))).toBe('mühle')
  })

  it('writes the parent as one id, and takes it out when it is emptied', () => {
    const place = newEntry('place', 'Gummern')
    const set = setValue(place, 'parent', 'string', 'schnackenburg')
    expect(set).toContain('parent: schnackenburg')
    expect(setValue(withText(place, set), 'parent', 'string', '')).not.toContain('parent')
  })

  it('checks the kind of a place against the kind of its parent', () => {
    const town = makeEntry('entities/places/s.yaml', 'id: s\ntype: place\nname: S\nkind: locality\n')
    const house = makeEntry('entities/places/h.yaml', 'id: h\ntype: place\nname: H\nkind: building\nparent: s\n')
    const street = makeEntry('entities/places/st.yaml', 'id: st\ntype: place\nname: St\nkind: street\nparent: h\n')
    expect(issuesOf(house, [town, house, street])).toEqual([])
    expect(issuesOf(street, [town, house, street]).map((i) => i.message)).toEqual(['a street lies in a locality, not in a building'])
  })
})
