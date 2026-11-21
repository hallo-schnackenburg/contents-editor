import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parse } from 'yaml'

const ROOT = new URL('./fixtures/examples/', import.meta.url).pathname

/** Every example entry: its path as it would be in the repository, its text and the parsed data. */
export function examples(): { path: string; text: string; data: Record<string, any> }[] {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]))
  return walk(ROOT).sort().map((file) => {
    const text = readFileSync(file, 'utf8')
    return { path: relative(ROOT, file), text, data: parse(text) }
  })
}

export const example = (id: string) => examples().find((e) => e.data.id === id)!.data
