// What the editor does with entries, without any screen: reading one, finding its problems, changing a field,
// making a new one. The texts stay YAML texts all along, so that comments and the author's formatting survive.

import { MODEL, checkParent, checkPath, checkRefs, entryPath, mediaId, readObject, replaceIds, setField, setId, setText, slugify, validateEntryYaml, type EntryType, type Issue, type Lookup } from '@contents-editor/core'

export type Data = Record<string, unknown>

/** An entry in the editor: where it lies, the version the server has (none for a new one), and the text now and as saved. */
export interface Entry {
  path: string
  sha?: string
  saved: string
  text: string
  /** The text, parsed (undefined while it is not valid YAML). */
  data?: Data
}

export const makeEntry = (path: string, text: string, sha?: string, saved = text): Entry => ({ path, sha, saved, text, data: readObject(text) })

export const withText = (entry: Entry, text: string): Entry => ({ ...entry, text, data: readObject(text) })

export const isDirty = (entry: Entry) => entry.text !== entry.saved

/** The id: as the entry says, else from where it lies (an entity: the path below the folder of its type; others: the file name). */
export const idOf = (entry: Entry): string => {
  if (typeof entry.data?.id === 'string') return entry.data.id
  const path = entry.path.replace(/\.yaml$/, '')
  return path.startsWith('entities/') ? path.split('/').slice(2).join('/') : (path.split('/').pop() ?? '')
}
export const typeOf = (entry: Entry): EntryType | undefined => (typeof entry.data?.type === 'string' && entry.data.type in MODEL.types ? (entry.data.type as EntryType) : undefined)

/** What a person calls it: the name, the title, or at last the id. */
export function titleOf(entry: Entry): string {
  const d = entry.data
  for (const key of ['name', 'title']) if (typeof d?.[key] === 'string' && d[key]) return d[key] as string
  return idOf(entry)
}

/** Every problem of an entry: the shape, where it lies, and where its references lead. */
export function issuesOf(entry: Entry, all: Entry[]): Issue[] {
  const own = validateEntryYaml(entry.text)
  if (own.length > 0 || !entry.data) return own
  const index = new Map<string, { type: string; data?: Data }>()
  for (const e of all) {
    const type = typeOf(e)
    if (type) index.set(idOf(e), { type, data: e.data })
  }
  const lookup: Lookup = (id) => index.get(id)
  return [...checkPath(entry.path, entry.data), ...checkRefs(entry.data, lookup), ...checkParent(entry.data, (id) => index.get(id))]
}

/** The field an issue belongs to: "/about/1" is about, "/text/teaser" is text. "/" belongs to none. */
export const fieldOfIssue = (issue: Issue): string | undefined => issue.path.split('/')[1] || undefined

/** The entries by type, in the order of the model, each group sorted by what people call the entries. */
export function groups(entries: Entry[], filter = ''): { type: EntryType; label: string; entries: Entry[] }[] {
  const needle = filter.trim().toLowerCase()
  const match = (e: Entry) => !needle || titleOf(e).toLowerCase().includes(needle) || idOf(e).includes(needle)
  return (Object.keys(MODEL.types) as EntryType[])
    .map((type) => ({ type, label: MODEL.types[type].label, entries: entries.filter((e) => typeOf(e) === type && match(e)).sort((a, b) => titleOf(a).localeCompare(titleOf(b), 'de')) }))
    .filter((g) => g.entries.length > 0)
}

export type FieldKind = 'string' | 'choice' | 'boolean' | 'date' | 'ref' | 'links' | 'location' | 'text' | 'files' | 'other'

/** Sets one field. An empty value takes the field out of the entry. The text is the one thing it is based on, so nothing can clash. */
export function setValue(entry: Entry, field: string, kind: FieldKind, value: unknown): string {
  let v: unknown = value
  if (kind === 'links') v = (value as { label: string; url: string }[]).filter((l) => l.label.trim() && l.url.trim())
  if (kind === 'location') {
    const { lat, lon } = value as { lat: number | null; lon: number | null }
    v = typeof lat === 'number' && typeof lon === 'number' && !Number.isNaN(lat) && !Number.isNaN(lon) ? { lat, lon } : undefined
  }
  if (kind === 'boolean' && value === false) v = undefined
  const result = setField(entry.text, field, v, entry.data?.[field])
  if (!result.ok) throw new Error(`The field "${field}" has changed in the meantime.`)
  return result.text
}

export const setRole = (entry: Entry, role: string, value: string): string => setText(entry.text, role, value)

/** Where a new entry is to be made, as a place in the tree suggests it: the type (if the place decides it), the folder, the parent and the kind of a place. */
export interface NewContext {
  type?: EntryType
  /** Entities: the folder below the folder of the type ("gummern", "schnackenburg/elbstrasse"). Contents: the topic. */
  folder: string
  parent?: string
  kind?: string
}

export interface NewOptions {
  /** The place a new place lies in. */
  parent?: string
  kind?: string
  /** Whether an id is in use: if so, a number is put at the end of the name part (erika-mueller-2). */
  taken?: (id: string) => boolean
}

/** The folders of a path typed by a person: slugs between slashes, empty parts dropped. */
export const folderSegments = (folder: string): string[] => folder.split('/').map(slugify).filter(Boolean)

/**
 * A new entry of this type with the name (or title) given. An entity lies in a folder of its type, free below that, and its
 * id is the path ("gummern/3"). A content needs the topic: the one folder it is filed in. Media have no folder to choose.
 */
export function newEntry(type: EntryType, label: string, folder = '', random?: (bytes: Uint8Array) => Uint8Array, options: NewOptions = {}): Entry {
  const t = MODEL.types[type]
  const slug = t.class === 'media' ? mediaId(label, random) : slugify(label)
  if (!slug) throw new Error('Der Name ergibt keine gültige ID: mindestens ein Buchstabe oder eine Ziffer.')
  const field = 'name' in t.fields ? 'name' : 'title'
  const quoted = JSON.stringify(label.trim())
  const topic = slugify(folder)
  if (t.class === 'content' && !topic) throw new Error('Ein Inhalt gehört in ein Thema (Ordner): bitte eines angeben.')
  const folders = t.class === 'entity' ? folderSegments(folder) : []
  const idFor = (name: string) => [...folders, name].join('/')
  let id = idFor(slug)
  for (let n = 2; options.taken?.(id); n++) id = idFor(`${slug}-${n}`)
  const path = entryPath(type, id, t.class === 'content' ? topic : undefined)
  const extra = `${options.kind && 'kind' in t.fields ? `kind: ${options.kind}\n` : ''}${options.parent && 'parent' in t.fields ? `parent: ${options.parent}\n` : ''}`
  return makeEntry(path, `id: ${id}\ntype: ${type}\n${field}: ${quoted}\n${extra}`, undefined, '')
}

const typeAt = (dir: string): EntryType | undefined => (Object.keys(MODEL.types) as EntryType[]).find((t) => MODEL.types[t].class === 'entity' && MODEL.types[t].dir === dir)

/** A place that other places lie in: a locality, a street or a square. */
export const holds = (e?: Entry): e is Entry => !!e && typeOf(e) === 'place' && ['locality', 'street', 'square'].includes(String(e.data?.kind))

/** What a new place in a street or on a square is: a building; in a folder "sonstige": another place. */
const kindIn = (parent: Entry | undefined, folder: string) => (['street', 'square'].includes(String(parent?.data?.kind)) ? 'building' : folder.split('/').pop() === 'sonstige' ? 'other' : undefined)

/**
 * What a new entry in the folder at `path` is like. `own`: the entry beside the folder (gummern.yaml beside gummern/), `holder`: the
 * nearest place above that others lie in. A new place gets as its parent the folder's own place, else the holder.
 */
export function newContextFor(path: string, own?: Entry, holder?: Entry): NewContext | undefined {
  const [top, second, ...rest] = path.split('/')
  if (top === 'entities' && second === undefined) return undefined // the types below it have a plus each
  if (top === 'contents') return { type: 'content', folder: second ?? '' }
  if (top === 'media') return second === undefined ? { type: 'media', folder: '' } : undefined // the letters below are made by the app
  const type = typeAt(`${top}/${second}`)
  if (!type) return undefined
  const folder = rest.join('/')
  if (type === 'place' && folder === '') return undefined // places go into a folder, not directly under "Orte"
  const parent = type === 'place' ? (holds(own) ? own : holder) : undefined
  return { type, folder, ...(parent ? { parent: idOf(parent), kind: kindIn(parent, folder) } : {}) }
}

/** A place that has no folder yet but could hold others (a street without houses): a new place goes into the folder of its name. */
export function newContextBelow(e: Entry): NewContext | undefined {
  return holds(e) ? { type: 'place', folder: idOf(e), parent: idOf(e), kind: kindIn(e, idOf(e)) } : undefined
}

/** The name of an entry under the entry its folder is named after: "Am Markt 3" under "Am Markt" is "Nr. 3". */
export function shortName(name: string, parentName?: string): string {
  if (parentName && name.length > parentName.length + 1 && name.startsWith(`${parentName} `)) {
    const rest = name.slice(parentName.length + 1)
    return /^\d/.test(rest) ? `Nr. ${rest}` : rest
  }
  return name
}

/** What renaming an entry does: the entries that move (with a new id and path), and the ones that stay and only get new references. */
export interface RenamePlan {
  /** The entry that is renamed first, then the ones below it (their folder is named after it). */
  moves: { before: Entry; after: Entry }[]
  rewrites: { before: Entry; after: Entry }[]
}

/** The field that names an entry: `name`, else `title`. */
export const nameFieldOf = (type: EntryType): 'name' | 'title' => ('name' in MODEL.types[type].fields ? 'name' : 'title')

/**
 * The id and the file follow the name (and, if a `folder` is given, the folder): an entity keeps its folders and takes the slug of the name as the last part, a content keeps its
 * topic and takes the slug as its id. What lies below the entity (its folder, `gummern/3` below `gummern`) moves with it, and every
 * reference to anything that moved is rewritten. Media are not renamed (their ids are made once, with a random part).
 * Returns nothing if there is nothing to do; throws (with words for the person) if the new id is not possible or in use
 * (`taken` tells whether a path is in use), so that nothing is changed.
 */
export function planRename(entry: Entry, all: Entry[], taken: (path: string) => boolean, folder?: string): RenamePlan | undefined {
  const type = typeOf(entry)
  if (!type || !entry.data) return undefined
  const t = MODEL.types[type]
  if (t.class === 'media') return undefined
  const name = entry.data[nameFieldOf(type)]
  if (typeof name !== 'string' || !name.trim()) return undefined
  const slug = slugify(name)
  if (!slug) throw new Error('Der Name ergibt keine gültige ID: mindestens ein Buchstabe oder eine Ziffer.')

  const oldId = idOf(entry)
  // An entity can also be moved: with a `folder` (the part of the id before the last one) it goes there, otherwise it keeps its own.
  const target = t.class === 'entity' && folder !== undefined ? folderSegments(folder).join('/') : oldId.split('/').slice(0, -1).join('/')
  if (t.class === 'entity' && (target === oldId || target.startsWith(`${oldId}/`))) throw new Error('Ein Eintrag kann nicht in sich selbst oder in etwas darunter verschoben werden.')
  const newId = t.class === 'entity' ? [target, slug].filter(Boolean).join('/') : slug
  if (newId === oldId) return undefined

  const topic = t.class === 'content' ? entry.path.split('/')[1] : undefined
  const pathFor = (id: string) => entryPath(type, id, topic)
  const below = t.class === 'entity' ? all.filter((e) => e.path.startsWith(`${t.dir}/${oldId}/`)) : []

  const moving = [entry, ...below]
  const ids = new Map<string, string>()
  const moves = moving.map((before) => {
    const id = before === entry ? newId : `${newId}${idOf(before).slice(oldId.length)}`
    ids.set(idOf(before), id)
    return { before, id, path: pathFor(id) }
  })
  for (const m of moves) {
    if (taken(m.path) && !moving.some((e) => e.path === m.path)) throw new Error(`Es gibt schon einen Eintrag mit der ID „${m.id}“.`)
  }

  // References to anything that moved, in every entry (the ones that move get theirs in the text they take along).
  const rewrite = (text: string, data: Data | undefined, own: EntryType | undefined): string => {
    if (!own || !data) return text
    let result = text
    for (const [field, spec] of Object.entries(MODEL.types[own].fields) as [string, { ref?: readonly string[] }][]) {
      if (!spec.ref?.includes(type)) continue
      result = replaceIds(result, field, ids)
    }
    return result
  }

  const plan: RenamePlan = { moves: [], rewrites: [] }
  for (const m of moves) {
    const text = rewrite(setId(m.before.text, m.id), m.before.data, typeOf(m.before))
    plan.moves.push({ before: m.before, after: makeEntry(m.path, text, undefined, '') })
  }
  for (const e of all) {
    if (moving.includes(e)) continue
    const text = rewrite(e.text, e.data, typeOf(e))
    if (text !== e.text) plan.rewrites.push({ before: e, after: withText(e, text) })
  }
  return plan
}

/** The folders an entity type has (the part of the ids before the last one, and every part of it above), for choosing where to move to. */
export function foldersOf(type: EntryType, entries: Entry[]): string[] {
  const found = new Set<string>()
  for (const e of entries) {
    if (typeOf(e) !== type) continue
    const parts = idOf(e).split('/').slice(0, -1)
    for (let i = 1; i <= parts.length; i++) found.add(parts.slice(0, i).join('/'))
  }
  return [...found].sort()
}

/** The folder of an entity (its id without the last part), or none. */
export const folderOf = (entry: Entry): string => idOf(entry).split('/').slice(0, -1).join('/')
