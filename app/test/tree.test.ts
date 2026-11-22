import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import Tree from '../src/Tree.svelte'
import { makeEntry } from '../src/logic.js'

const place = (id: string, name: string, kind: string, parent?: string) => makeEntry(`entities/places/${id}.yaml`, `id: ${id}\ntype: place\nname: ${name}\nkind: ${kind}\n${parent ? `parent: ${parent}\n` : ''}`)
const places = [
  place('schnackenburg', 'Schnackenburg', 'locality'),
  place('schnackenburg/am-markt', 'Am Markt', 'street', 'schnackenburg'),
  place('schnackenburg/am-markt/3', 'Am Markt 3', 'building', 'schnackenburg/am-markt'),
  place('schnackenburg/am-markt/10', 'Am Markt 10', 'building', 'schnackenburg/am-markt'),
  place('schnackenburg/elbstrasse', 'Elbstraße', 'street', 'schnackenburg'),
  place('gummern', 'Gummern', 'locality', 'schnackenburg'),
  place('gummern/5', 'Gummern 5', 'building', 'gummern'),
  place('elberadweg', 'Elberadweg', 'other'),
]

/** What the tree shows as rows: indentation by depth, the text, the class of the row. A search opens all folders. */
function rows(filter: string, entries = places): string[] {
  const { body } = render(Tree, { props: { entries, filter, onselect: () => {} } })
  return [...body.matchAll(/<button class="(\w+)[^"]*"[^>]*style="padding-left: (\d+)px;"[^>]*>(.*?)<\/button>/g)].map((m) => `${' '.repeat((Number(m[2]) - 4) / 14)}${m[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`)
}

describe('the tree of folders', () => {
  it('shows the folders, not the parents: Gummern lies beside Schnackenburg, because it has a folder of its own', () => {
    // "e" is in the id of every place here (and a search opens all folders). Folders and entries are in name order.
    expect(rows('e')).toEqual([
      'Entitäten 8',
      ' Orte 8',
      '  Elberadweg',
      '  Gummern 1',
      '   Nr. 5',
      '  Schnackenburg 4',
      '   Am Markt 2',
      '    Nr. 3',
      '    Nr. 10',
      '   Elbstraße',
    ])
  })

  it('names a folder after the entry beside it, and the houses "Nr." under it', () => {
    const found = rows('Elbstraße')
    expect(found).toEqual(['Entitäten 1', ' Orte 1', '  Schnackenburg 1', '   Elbstraße'])
  })

  it('keeps an entry beside a folder out of the list of its parent', () => {
    // schnackenburg.yaml is not listed in "Orte" as well as being the folder "Schnackenburg".
    expect(rows('e').filter((r) => r.trim().startsWith('Schnackenburg'))).toHaveLength(1)
  })
})
