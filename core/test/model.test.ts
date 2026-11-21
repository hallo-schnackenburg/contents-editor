import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error: a plain script, no types
import { render, read, schemaOf } from '../scripts/generate.mjs'
import schema from '../schema/entry.schema.json'
import { MODEL, ENTRY_TYPES, TEXT_ROLES } from '../src/model.generated.js'

const source = readFileSync(new URL('../../contents.yaml', import.meta.url), 'utf8')

describe('contents.yaml', () => {
  it('has its generated files up to date (run `npm run generate` in core if this fails)', () => {
    const out = render(source)
    expect(readFileSync(new URL('../src/model.generated.ts', import.meta.url), 'utf8')).toBe(out.model)
    expect(`${JSON.stringify(schema, null, 2)}\n`).toBe(out.schema)
  })

  it('lists the types and the text roles', () => {
    expect(ENTRY_TYPES).toEqual(['person', 'organization', 'place', 'event', 'content', 'media'])
    expect(TEXT_ROLES).toEqual(['body', 'teaser', 'summary', 'meta_description', 'social', 'print'])
    expect(MODEL.types.media.subtypes).toHaveProperty('photo', 'Foto')
  })

  it('only lets the text hold the roles it defines', () => {
    expect(schemaOf(read(source)).$defs.text.propertyNames.enum).toEqual(TEXT_ROLES)
  })

  it('refuses a model that points to a type or role that does not exist', () => {
    expect(() => read(source.replace('ref: [place]', 'ref: [nowhere]'))).toThrow(/not a type/)
    expect(() => read(source.replace('fallback: [summary]', 'fallback: [nothing]'))).toThrow(/not another role/)
  })
})
