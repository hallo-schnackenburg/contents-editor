// What the JSON Schema cannot say: that the paths of the files match their hashes, and that references lead to
// entries that exist and are of an allowed type. The shape is checked first (schema.ts); these checks assume it.

import { MODEL, type EntryType } from './model.generated.js'
import { fileDir } from './paths.js'
import type { Issue } from './types.js'

type Obj = Record<string, unknown>
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x)

/** File and variant paths of a media entry must belong to their hashes. */
export function checkFiles(entry: unknown): Issue[] {
  if (!isObj(entry) || !Array.isArray(entry.files)) return []
  const issues: Issue[] = []
  entry.files.forEach((f, i) => {
    if (!isObj(f) || typeof f.sha256 !== 'string' || typeof f.path !== 'string') return
    const dir = fileDir(f.sha256)
    if (!f.path.startsWith(`${dir}/original.`)) issues.push({ path: `/files/${i}/path`, message: `the path must be ${dir}/original.<ext>` })
    const variants = Array.isArray(f.variants) ? f.variants : []
    variants.forEach((v: unknown, j: number) => {
      if (!isObj(v) || typeof v.sha256 !== 'string' || typeof v.path !== 'string') return
      const ok = v.path.startsWith(`${dir}/`) && new RegExp(`\\.${v.sha256.slice(0, 12)}\\.[a-z0-9]+$`).test(v.path)
      if (!ok) issues.push({ path: `/files/${i}/variants/${j}/path`, message: `the path must be in ${dir}/ and end in .${v.sha256.slice(0, 12)}.<ext>` })
    })
  })
  const nums = entry.files.map((f) => (isObj(f) ? f.num : undefined)).filter((n) => n !== undefined)
  if (new Set(nums).size !== nums.length) issues.push({ path: '/files', message: 'the numbers (num) of the files must be unique' })
  return issues
}

/** What a reference field accepts: the entry the id leads to, and its type. */
export type Lookup = (id: string) => { type: string } | undefined

/** Every id in a reference field must exist and be of one of the types the field allows. */
export function checkRefs(entry: unknown, lookup: Lookup): Issue[] {
  if (!isObj(entry) || typeof entry.type !== 'string' || !(entry.type in MODEL.types)) return []
  const fields = MODEL.types[entry.type as EntryType].fields as Record<string, { ref?: readonly string[]; single?: boolean }>
  const issues: Issue[] = []
  for (const [name, spec] of Object.entries(fields)) {
    if (!spec.ref) continue
    // A list of ids, or one id (a single reference).
    const value = entry[name]
    const ids: unknown[] = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
    ids.forEach((id, i) => {
      if (typeof id !== 'string') return
      const at = Array.isArray(value) ? `/${name}/${i}` : `/${name}`
      const target = lookup(id)
      if (!target) issues.push({ path: at, message: `"${id}" does not exist` })
      else if (!spec.ref!.includes(target.type)) issues.push({ path: at, message: `"${id}" is a ${target.type}; allowed here: ${spec.ref!.join(', ')}` })
    })
  }
  return issues
}

/** Everything that is checked without other entries: the schema's job is done before; this is the rest. */
export const checkConsistency = (entry: unknown): Issue[] => checkFiles(entry)
