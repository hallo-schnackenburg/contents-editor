// The description of a topic folder of the contents: contents/<topic>/.folder.yaml. For now only the name shown on screen;
// without the file the folder's own name is shown. The file also makes the folder exist while nothing is filed in it.

import { parse } from 'yaml'
import type { Issue } from './types.js'

/** The problems of the text of a .folder.yaml; none if all is well. */
export function validateFolderYaml(text: string): Issue[] {
  let data: unknown
  try {
    data = parse(text)
  } catch (error) {
    return [{ path: '/', message: `YAML syntax error: ${(error as Error).message}` }]
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return [{ path: '/', message: 'must be a mapping with a title' }]
  const issues: Issue[] = []
  const { title, ...rest } = data as Record<string, unknown>
  if (typeof title !== 'string' || title.trim() === '') issues.push({ path: '/title', message: typeof title === 'string' ? 'must not be empty' : 'missing field "title"' })
  for (const key of Object.keys(rest)) issues.push({ path: `/${key}`, message: `unknown field "${key}"` })
  return issues
}

/** The name of a folder as its .folder.yaml gives it (none if the text has no usable title). */
export function folderTitle(text: string): string | undefined {
  try {
    const title = (parse(text) as { title?: unknown } | null)?.title
    return typeof title === 'string' && title.trim() ? title.trim() : undefined
  } catch {
    return undefined
  }
}
