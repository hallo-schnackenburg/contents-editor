import { describe, expect, it } from 'vitest'
import { checkConsistency, checkPath, checkRefs, validateEntryYaml } from '../src/index.js'
import { examples } from './fixtures.js'

// What the CI of a contents repository does with every entry: shape, paths, references.
describe('the example repository', () => {
  const all = examples()
  const ids = new Map(all.map((e) => [e.data.id as string, e.data as { type: string }]))

  it('has unique ids', () => expect(ids.size).toBe(all.length))

  for (const e of all) {
    it(`${e.path} is in order`, () => {
      expect(validateEntryYaml(e.text)).toEqual([])
      expect(checkConsistency(e.data)).toEqual([])
      expect(checkPath(e.path, e.data)).toEqual([])
      expect(checkRefs(e.data, (id) => ids.get(id))).toEqual([])
    })
  }
})
