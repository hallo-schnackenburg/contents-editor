// The places form a tree: a locality (Ort: a town, village or quarter) may lie in another locality and contains streets and squares,
// those contain buildings; a building may also lie directly in a locality (villages without street names). Other places (a bathing
// spot, a lookout) lie in a locality or have no parent. `parent` is one id; it is a relation, not the folder the file lies in.
// Only places that have a `kind` are checked, so that places made before the kinds existed stay valid.

import type { Issue } from './types.js'

/** Which kinds a place of a kind may lie in. An empty list: it has no parent. */
const PARENT_KINDS: Record<string, readonly string[]> = {
  locality: ['locality'],
  street: ['locality'],
  square: ['locality'],
  building: ['street', 'square', 'locality'],
  other: ['locality'],
}
/** Kinds that must have a parent (others may have none). */
const NEEDS_PARENT = new Set(['street', 'square', 'building'])
const WORDS: Record<string, string> = { locality: 'a locality', street: 'a street', square: 'a square', building: 'a building', other: 'another place' }

/** `a street, a square or a locality` */
const list = (kinds: readonly string[]): string => kinds.map((k) => WORDS[k]).reduce((all, w, i) => (i === 0 ? w : i === kinds.length - 1 ? `${all} or ${w}` : `${all}, ${w}`), '')

export type PlaceLookup = (id: string) => { type: string; data?: Record<string, unknown> } | undefined

/** The id a place lies in (`parent`), if it has one. */
export const parentOf = (entry: { parent?: unknown }): string | undefined => (typeof entry.parent === 'string' ? entry.parent : undefined)

/** Checks the kind of a place against the kind of its parent. References that lead nowhere are the business of checkRefs. */
export function checkParent(entry: unknown, find: PlaceLookup): Issue[] {
  if (typeof entry !== 'object' || entry === null) return []
  const place = entry as { type?: unknown; kind?: unknown; parent?: unknown }
  if (place.type !== 'place' || typeof place.kind !== 'string' || !(place.kind in PARENT_KINDS)) return []
  const allowed = PARENT_KINDS[place.kind]
  const parentId = parentOf(place)
  if (parentId === undefined) {
    return NEEDS_PARENT.has(place.kind) ? [{ path: '/parent', message: `${WORDS[place.kind]} lies in ${list(allowed)}: parent is missing` }] : []
  }
  const parent = find(parentId)
  const parentKind = parent?.type === 'place' ? parent.data?.kind : undefined
  if (typeof parentKind !== 'string' || !(parentKind in PARENT_KINDS) || allowed.includes(parentKind)) return []
  return [{ path: '/parent', message: `${WORDS[place.kind]} lies in ${list(allowed)}, not in ${WORDS[parentKind]}` }]
}
