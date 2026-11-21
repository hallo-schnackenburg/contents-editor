import { describe, expect, it } from 'vitest'
import { checkPath, entryPath, fileDir, mediaId, slugify, variantPath } from '../src/paths.js'
import { examples } from './fixtures.js'

describe('slugify', () => {
  it('writes umlauts out and makes hyphens of the rest', () => {
    expect(slugify('Müller & Söhne: Große Brücke!')).toBe('mueller-soehne-grosse-bruecke')
    expect(slugify('  Café  Zur Fähre ')).toBe('cafe-zur-faehre')
    expect(slugify('---')).toBe('')
  })
})

describe('mediaId', () => {
  it('is the slug and five random characters', () => {
    expect(mediaId('Kirchturm im Nebel', (b) => b.fill(7))).toBe('kirchturm-im-nebel-hhhhh')
    expect(mediaId('???', (b) => b.fill(0))).toBe('medium-aaaaa')
  })
})

describe('entryPath', () => {
  it('follows the type', () => {
    expect(entryPath('person', 'erika-mustermann')).toBe('entities/people/erika-mustermann.yaml')
    expect(entryPath('media', 'kirchturm-k7x2m')).toBe('media/k/kirchturm-k7x2m.yaml')
    expect(entryPath('content', 'osterfeuer', 'traditionen/')).toBe('contents/traditionen/osterfeuer.yaml')
    expect(entryPath('content', 'osterfeuer')).toBe('contents/osterfeuer.yaml')
  })
})

describe('checkPath', () => {
  it('accepts every example where it lies', () => {
    for (const e of examples()) expect(checkPath(e.path, e.data), e.path).toEqual([])
  })
  it('says when the id is not the file name, or the folder is wrong', () => {
    const entry = { id: 'erika-mustermann', type: 'person' }
    expect(checkPath('entities/people/erika.yaml', entry)[0].message).toMatch(/id must be the file name/)
    expect(checkPath('entities/places/erika-mustermann.yaml', entry)[0].message).toMatch(/belongs in entities\/people/)
    expect(checkPath('media/x/abc-12345.yaml', { id: 'abc-12345', type: 'media' })[0].message).toMatch(/media\/a\/abc-12345/)
    expect(checkPath('entities/events/x.yml', { id: 'x', type: 'event' })[0].message).toMatch(/\.yaml/)
    expect(checkPath('somewhere/x.yaml', { id: 'x', type: 'content' })[0].message).toMatch(/contents\//)
  })
})

describe('the object store', () => {
  const sha = 'ab'.repeat(32)
  it('lays files out as the archive does', () => {
    expect(fileDir(sha)).toBe(`files/ab/ab/${sha}`)
    expect(variantPath(sha, 'preview-400', 'cd'.repeat(32), 'jpg')).toBe(`files/ab/ab/${sha}/preview-400.cdcdcdcdcdcd.jpg`)
    expect(() => fileDir('xyz')).toThrow(/sha256/)
  })
})
