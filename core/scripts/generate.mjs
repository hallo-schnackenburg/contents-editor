// Turns contents.yaml (in the repository root) into the files the rest of the code reads:
//   schema/entry.schema.json    the JSON Schema of an entry (checked with Ajv in src/schema.ts)
//   src/model.generated.ts      the types, their folders, id rules, fields and the text roles, with the German names
// so that the app, the worker, the checks and the tests all share one model. Run it with `npm run generate`
// after changing contents.yaml.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const SOURCE = new URL('../../contents.yaml', import.meta.url)
const MODEL = new URL('../src/model.generated.ts', import.meta.url)
const SCHEMA = new URL('../schema/entry.schema.json', import.meta.url)

const NAME = /^[a-z][a-z0-9_]*$/
const isRecord = (x) => typeof x === 'object' && x !== null && !Array.isArray(x)
const fail = (message) => {
  throw new Error(`contents.yaml: ${message}`)
}

/** The checked content of contents.yaml. */
export function read(yamlText) {
  const data = parse(yamlText)
  if (!isRecord(data)) fail('the file must be a mapping.')
  for (const key of ['schema', 'classes', 'ids', 'types', 'text_roles', 'defs']) if (!isRecord(data[key])) fail(`${key} is missing.`)
  if (!isRecord(data.ids.path)) fail('ids.path is missing (the pattern references are checked with).')
  for (const [name, c] of Object.entries(data.classes)) if (!NAME.test(name) || typeof c.label !== 'string' || typeof c.dir !== 'string') fail(`classes.${name} needs a label and a dir.`)
  for (const [name, rule] of Object.entries(data.ids)) {
    try {
      new RegExp(rule.pattern)
    } catch {
      fail(`ids.${name} needs a pattern that is a regular expression.`)
    }
  }
  for (const [type, t] of Object.entries(data.types)) {
    if (!NAME.test(type) || typeof t.label !== 'string') fail(`types.${type} needs a lower-case name and a label.`)
    if (!(t.class in data.classes)) fail(`types.${type}.class must be one of: ${Object.keys(data.classes).join(', ')}.`)
    if (!(t.id in data.ids)) fail(`types.${type}.id must be one of: ${Object.keys(data.ids).join(', ')}.`)
    if (typeof t.dir !== 'string') fail(`types.${type} needs a dir.`)
    for (const [field, spec] of Object.entries(t.fields ?? {})) {
      if (!NAME.test(field) || ['id', 'type', 'subtype'].includes(field)) fail(`types.${type}.fields.${field}: not a usable field name.`)
      if (spec?.options !== undefined && !(isRecord(spec.options) && Array.isArray(spec.schema?.enum) && spec.schema.enum.every((v) => typeof spec.options[v] === 'string'))) fail(`types.${type}.fields.${field}.options must name every value of the enum.`)
      if (!isRecord(spec) || typeof spec.label !== 'string' || !(isRecord(spec.schema) !== Array.isArray(spec.ref))) fail(`types.${type}.fields.${field} needs a label and either a schema or a ref (a list of types).`)
      if (spec.single !== undefined && !(spec.ref && spec.single === true && spec.max === undefined)) fail(`types.${type}.fields.${field}: single (true) belongs to a ref and excludes max.`)
      for (const target of spec.ref ?? []) if (!(target in data.types)) fail(`types.${type}.fields.${field}.ref: "${target}" is not a type.`)
    }
  }
  for (const [role, r] of Object.entries(data.text_roles)) {
    if (!NAME.test(role) || typeof r.label !== 'string') fail(`text_roles.${role} needs a label.`)
    for (const fb of r.fallback ?? []) if (!(fb in data.text_roles) || fb === role) fail(`text_roles.${role}.fallback: "${fb}" is not another role.`)
  }
  for (const [type, t] of Object.entries(data.types)) {
    for (const [field, spec] of Object.entries(t.fields ?? {})) {
      const ref = spec.schema?.$ref
      if (ref && !(ref.replace('#/$defs/', '') in data.defs)) fail(`types.${type}.fields.${field}: ${ref} is not in defs.`)
    }
  }
  return data
}

const toSchema = (spec) =>
  spec.ref
    ? spec.single
      ? { description: `Id of: ${spec.ref.join(', ')}.`, type: 'string', pattern: '__SLUG__' }
      : { description: `Ids of: ${spec.ref.join(', ')}.`, type: 'array', minItems: 1, ...(spec.max ? { maxItems: spec.max } : {}), uniqueItems: true, items: { type: 'string', pattern: '__SLUG__' } }
    : spec.schema

/** The JSON Schema of an entry. */
export function schemaOf(model) {
  const { types, text_roles: roles } = model
  // A reference leads to an entry of any kind: the pattern allows the ids of all (a slug is a path of one segment).
  const slug = model.ids.path.pattern
  const patch = (node) => {
    if (Array.isArray(node)) return node.map(patch)
    if (!isRecord(node)) return node === '__SLUG__' ? slug : node
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, patch(v)]))
  }
  const $defs = {}
  for (const [name, def] of Object.entries(model.defs)) $defs[name] = patch(def)
  $defs.text = { ...$defs.text, propertyNames: { enum: Object.keys(roles) } }
  for (const [type, t] of Object.entries(types)) {
    const fields = t.fields ?? {}
    const subtypes = Object.keys(t.subtypes ?? {})
    $defs[`entry_${type}`] = {
      required: ['id', 'type', ...Object.entries(fields).filter(([, f]) => f.required).map(([name]) => name)],
      properties: {
        id: { type: 'string', pattern: model.ids[t.id].pattern },
        subtype: subtypes.length ? { enum: subtypes } : false,
        ...Object.fromEntries(Object.entries(fields).map(([name, spec]) => [name, patch(toSchema(spec))])),
      },
    }
  }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: model.schema.id,
    $comment: 'Generated from contents.yaml by `npm run generate` in core. Do not edit.',
    title: model.schema.title,
    description: model.schema.description,
    type: 'object',
    required: ['id', 'type'],
    properties: { id: { type: 'string' }, type: { enum: Object.keys(types) } },
    allOf: Object.keys(types).map((type) => ({ if: { properties: { type: { const: type } }, required: ['type'] }, then: { $ref: `#/$defs/entry_${type}` } })),
    unevaluatedProperties: false,
    $defs,
  }
}

/** How a field is shown in the editor: from its schema. `other` can only be changed in the YAML. */
export function kindOf(spec) {
  if (spec.ref) return 'ref'
  const s = spec.schema
  if (Array.isArray(s.enum)) return 'choice'
  if (s.$ref === '#/$defs/links') return 'links'
  if (s.$ref === '#/$defs/text') return 'text'
  if (s.type === 'array' && s.items?.$ref === '#/$defs/file') return 'files'
  if (s.type === 'boolean') return 'boolean'
  if (s.type === 'object' && s.properties?.lat && s.properties?.lon) return 'location'
  if (s.type === 'string' && s.format === 'date') return 'date'
  if (s.type === 'string') return 'string'
  return 'other'
}

/** The text of the generated TypeScript file. */
export function modelOf(model) {
  const types = Object.fromEntries(
    Object.entries(model.types).map(([type, t]) => [
      type,
      {
        class: t.class,
        label: t.label,
        dir: t.dir,
        id: t.id,
        subtypes: t.subtypes ?? {},
        fields: Object.fromEntries(Object.entries(t.fields ?? {}).map(([name, f]) => [name, { label: f.label, kind: kindOf(f), required: Boolean(f.required), ...(f.ref ? { ref: f.ref } : {}), ...(f.max ? { max: f.max } : {}), ...(f.single ? { single: true } : {}), ...(f.options ? { options: f.options } : {}), ...(f.description ? { description: f.description } : {}), ...(f.multiline ? { multiline: true } : {}) }])),
      },
    ]),
  )
  const roles = Object.fromEntries(
    Object.entries(model.text_roles).map(([role, r]) => [role, { label: r.label, ...(r.max ? { max: r.max } : {}), fallback: r.fallback ?? [], ...(r.description ? { description: r.description } : {}) }]),
  )
  const body = {
    classes: Object.fromEntries(Object.entries(model.classes).map(([name, c]) => [name, { label: c.label, dir: c.dir }])),
    ids: Object.fromEntries(Object.entries(model.ids).map(([name, r]) => [name, { pattern: r.pattern }])),
    types,
    textRoles: roles,
  }
  return `// Generated from contents.yaml by \`npm run generate\` in core. Do not edit.

export const MODEL = ${JSON.stringify(body, null, 2)} as const

export type EntryType = keyof typeof MODEL.types
export type EntryClass = keyof typeof MODEL.classes
export type TextRole = keyof typeof MODEL.textRoles

export const ENTRY_TYPES = Object.keys(MODEL.types) as EntryType[]
export const TEXT_ROLES = Object.keys(MODEL.textRoles) as TextRole[]
`
}

/** Both generated files, as text, for the text of contents.yaml. */
export function render(yamlText) {
  const model = read(yamlText)
  return { model: modelOf(model), schema: `${JSON.stringify(schemaOf(model), null, 2)}\n` }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { model, schema } = render(readFileSync(SOURCE, 'utf8'))
  writeFileSync(MODEL, model)
  writeFileSync(SCHEMA, schema)
  console.log('Wrote core/src/model.generated.ts and core/schema/entry.schema.json')
}
