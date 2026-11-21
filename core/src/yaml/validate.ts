import { parse } from 'yaml'
import { checkConsistency } from '../consistency.js'
import { checkText } from '../text.js'
import { validateEntry } from '../schema.js'
import type { Issue } from '../types.js'

/**
 * Full check of an entry as it is written in a YAML file: syntax, schema, then consistency. The rest is only checked
 * once the shape is valid, so one mistake does not produce a pile of follow-up messages. References need the other
 * entries and are checked by the caller (checkRefs).
 */
export function validateEntryYaml(text: string): Issue[] {
  let data: unknown
  try {
    data = parse(text)
  } catch (error) {
    return [{ path: '/', message: `YAML syntax error: ${(error as Error).message}` }]
  }
  const shape = validateEntry(data)
  if (shape.length > 0) return shape
  return [...checkConsistency(data), ...checkText((data as Record<string, unknown>).text)]
}
