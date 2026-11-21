import { describe, expect, it } from 'vitest'
import { fieldChanges, lineDiff } from '../src/diff.js'

const content = (text: string, extra = '') => `id: osterfeuer\ntype: content\ntitle: Osterfeuer\n${extra}text:\n  body: |\n    ${text}\n`

describe('fieldChanges', () => {
  it('names the fields that differ, with the words of the model, and what was and is', () => {
    const changes = fieldChanges(content('Alt.'), content('Neu.', 'authors:\n  - erika-mustermann\n'))
    expect(changes).toEqual([
      { field: 'authors', label: 'Autoren', after: 'erika-mustermann' },
      { field: 'text.body', label: 'Text: Text', before: 'Alt.', after: 'Neu.' },
    ])
  })

  it('shows the roles of a text one by one', () => {
    const before = 'id: a\ntype: content\ntitle: A\ntext:\n  body: |\n    x\n'
    const after = 'id: a\ntype: content\ntitle: A\ntext:\n  body: |\n    x\n  teaser: |\n    Kurz.\n'
    expect(fieldChanges(before, after)).toEqual([{ field: 'text.teaser', label: 'Text: Teaser', after: 'Kurz.' }])
  })

  it('has everything on one side for an entry that is added or removed', () => {
    const entry = 'id: erika\ntype: person\nname: Erika\nlinks:\n  - label: Home\n    url: https://a.example\n'
    expect(fieldChanges(undefined, entry).map((c) => [c.field, c.before, c.after])).toEqual([
      ['id', undefined, 'erika'],
      ['type', undefined, 'person'],
      ['name', undefined, 'Erika'],
      ['links', undefined, 'Home · https://a.example'],
    ])
    expect(fieldChanges(entry, undefined).every((c) => c.after === undefined && c.before !== undefined)).toBe(true)
  })

  it('has nothing for two versions that read the same', () => {
    expect(fieldChanges(content('Gleich.'), content('Gleich.'))).toEqual([])
    expect(fieldChanges('id: a\ntype: person\nname: A\n', 'name: A\ntype: person\nid: a\n# comment\n')).toEqual([])
  })
})

describe('lineDiff', () => {
  it('has what stays, what is taken out and what is put in', () => {
    expect(lineDiff('a\nb\nc\n', 'a\nx\nc\nd\n')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'del', text: 'b' },
      { kind: 'add', text: 'x' },
      { kind: 'same', text: 'c' },
      { kind: 'add', text: 'd' },
    ])
  })

  it('is all added or all removed when there is only one side', () => {
    expect(lineDiff(undefined, 'a\nb\n').map((l) => l.kind)).toEqual(['add', 'add'])
    expect(lineDiff('a\n', undefined).map((l) => l.kind)).toEqual(['del'])
    expect(lineDiff('a\n', 'a\n')).toEqual([{ kind: 'same', text: 'a' }])
  })
})
