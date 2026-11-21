// Changes to the YAML text that keep everything else as it is (comments, order, the author's own formatting). The editor
// changes the text through functions like this one instead of rewriting it.

import { Scalar, isMap, parseDocument } from 'yaml'

export type SetFieldResult =
  | { ok: true; text: string }
  /** Not changed, because the field no longer has the value the caller expected. */
  | { ok: false; current: unknown }

/** The id and type are fixed when an entry is created: the id is the file name, the type decides the folder. */
const LOCKED = new Set(['id', 'type'])

const isEmpty = (value: unknown): boolean => value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)

/**
 * Sets one top-level field, but only if it still has the value the caller saw (`old`); that is how a change from
 * somewhere else does not overwrite what has been typed in the meantime. A field that is empty now is always filled.
 * An empty value removes the field. Text (a role under `text`) is written as a block scalar so that it stays readable.
 */
export function setField(text: string, field: string, value: unknown, old: unknown): SetFieldResult {
  if (LOCKED.has(field)) throw new Error(`The field "${field}" cannot be changed this way.`)
  const doc = parseDocument(text)
  if (doc.errors.length > 0 || !isMap(doc.contents)) throw new Error('The YAML has a syntax error; fix it first.')

  const current = (doc.toJS() as Record<string, unknown>)[field]
  if (!(isEmpty(current) || JSON.stringify(current) === JSON.stringify(old))) return { ok: false, current }

  if (isEmpty(value)) {
    doc.delete(field)
    return { ok: true, text: doc.toString() }
  }
  doc.set(field, doc.createNode(value))
  return { ok: true, text: doc.toString() }
}

/** Sets one text role below `text`, as a Markdown block. An empty text removes the role (and `text` if nothing is left). */
export function setText(text: string, role: string, value: string): string {
  const doc = parseDocument(text)
  if (doc.errors.length > 0 || !isMap(doc.contents)) throw new Error('The YAML has a syntax error; fix it first.')
  if (value.trim() === '') {
    doc.deleteIn(['text', role])
    const left = doc.getIn(['text'])
    if (isMap(left) && left.items.length === 0) doc.delete('text')
    return doc.toString()
  }
  const block = new Scalar(value.endsWith('\n') ? value : `${value}\n`)
  block.type = 'BLOCK_LITERAL'
  doc.setIn(['text', role], block)
  return doc.toString()
}
