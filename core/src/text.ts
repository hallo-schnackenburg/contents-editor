// The texts of a content: one Markdown text per role. A client asks for a role; if it is missing, the first fallback
// that exists and is not longer than the role allows is used (a text that is too long is skipped, never cut).

import { MODEL, TEXT_ROLES, type TextRole } from './model.generated.js'
import type { Issue } from './types.js'

export type Texts = Partial<Record<TextRole, string>>

const length = (s: string) => s.trim().length

/** The role whose text serves `role`: the role itself if written, else the first fallback that exists and fits. */
export function servingRole(texts: Texts, role: TextRole): TextRole | undefined {
  if (texts[role] !== undefined) return role
  const max = (MODEL.textRoles[role] as { max?: number }).max ?? Infinity
  return (MODEL.textRoles[role].fallback as readonly TextRole[]).find((fb) => texts[fb] !== undefined && length(texts[fb]!) <= max)
}

/** The text for a role, with the role it came from, or nothing if neither it nor a fallback can serve. */
export function resolveText(texts: Texts, role: TextRole): { role: TextRole; text: string } | undefined {
  const from = servingRole(texts, role)
  return from ? { role: from, text: texts[from]! } : undefined
}

/** Roles written too long for their limit. */
export function checkText(texts: unknown): Issue[] {
  if (typeof texts !== 'object' || texts === null) return []
  const issues: Issue[] = []
  for (const role of TEXT_ROLES) {
    const text = (texts as Record<string, unknown>)[role]
    const max = (MODEL.textRoles[role] as { max?: number }).max
    if (typeof text === 'string' && max !== undefined && length(text) > max) issues.push({ path: `/text/${role}`, message: `${length(text)} characters; at most ${max}` })
  }
  return issues
}

/** The roles that nothing can serve: neither written nor reachable through a fallback. For the editor to point out. */
export function unserved(texts: Texts): TextRole[] {
  return TEXT_ROLES.filter((role) => !servingRole(texts, role))
}
