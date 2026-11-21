import { describe, expect, it } from 'vitest'
import { checkFiles, checkRefs } from '../src/consistency.js'
import { examples, example } from './fixtures.js'

const all = new Map(examples().map((e) => [e.data.id as string, e.data as { type: string }]))
const lookup = (id: string) => all.get(id)

describe('the files of a media entry', () => {
  it('are in order for the example', () => expect(checkFiles(example('osterfeuer-am-deich-p3q8d'))).toEqual([]))

  it('must have a path that belongs to the hash, and the same for variants', () => {
    const media = structuredClone(example('osterfeuer-am-deich-p3q8d'))
    media.files[0].path = `files/00/00/${'0'.repeat(64)}/original.jpg`
    media.files[0].variants[0].path = media.files[0].variants[0].path.replace(/\.[0-9a-f]{12}\./, '.000000000000.')
    expect(checkFiles(media).map((i) => i.path)).toEqual(['/files/0/path', '/files/0/variants/0/path'])
  })

  it('must have unique numbers', () => {
    const media = structuredClone(example('osterfeuer-am-deich-p3q8d'))
    media.files = [{ ...media.files[0], num: 1 }, { ...media.files[0], num: 1 }]
    expect(checkFiles(media)[0].message).toMatch(/unique/)
  })
})

describe('references', () => {
  it('lead to entries that exist', () => {
    for (const e of examples()) expect(checkRefs(e.data, lookup), e.path).toEqual([])
    const content = { ...example('osterfeuer-tradition'), about: ['osterfeuer', 'gibts-nicht'] }
    expect(checkRefs(content, lookup)).toEqual([{ path: '/about/1', message: '"gibts-nicht" does not exist' }])
  })

  it('lead to entries of an allowed type', () => {
    const content = { ...example('osterfeuer-tradition'), authors: ['elbdeich-festplatz'], about: ['osterfeuer-am-deich-p3q8d'] }
    const messages = checkRefs(content, lookup).map((i) => `${i.path}: ${i.message}`)
    expect(messages).toEqual([
      '/authors/0: "elbdeich-festplatz" is a place; allowed here: person, organization',
      '/about/0: "osterfeuer-am-deich-p3q8d" is a media; allowed here: person, organization, place, event',
    ])
  })
})
