// What the editor does with entries, without any screen: reading one, finding its problems, changing a field,
// making a new one. The texts stay YAML texts all along, so that comments and the author's formatting survive.

import { MODEL, checkParent, checkPath, checkRefs, entryPath, mediaId, readObject, setField, setText, slugify, validateEntryYaml, type EntryType, type Issue, type Lookup } from '@contents-editor/core'

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

/** A new entry of this type with the name (or title) given. A content needs the topic: the one folder it is filed in. */
export function newEntry(type: EntryType, label: string, topic = '', random?: (bytes: Uint8Array) => Uint8Array): Entry {
  const t = MODEL.types[type]
  const id = t.class === 'media' ? mediaId(label, random) : slugify(label)
  if (!id) throw new Error('Der Name ergibt keine gültige ID: mindestens ein Buchstabe oder eine Ziffer.')
  const field = 'name' in t.fields ? 'name' : 'title'
  const quoted = JSON.stringify(label.trim())
  const folder = slugify(topic)
  if (t.class === 'content' && !folder) throw new Error('Ein Inhalt gehört in ein Thema (Ordner): bitte eines angeben.')
  const path = entryPath(type, id, t.class === 'content' ? folder : undefined)
  return makeEntry(path, `id: ${id}\ntype: ${type}\n${field}: ${quoted}\n`, undefined, '')
}

/** The name of an entry under the entry its folder is named after: "Am Markt 3" under "Am Markt" is "Nr. 3". */
export function shortName(name: string, parentName?: string): string {
  if (parentName && name.length > parentName.length + 1 && name.startsWith(`${parentName} `)) {
    const rest = name.slice(parentName.length + 1)
    return /^\d/.test(rest) ? `Nr. ${rest}` : rest
  }
  return name
}
