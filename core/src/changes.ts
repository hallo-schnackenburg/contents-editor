// A change is a branch and a pull request on it. The name a person gives it is the title of the pull request; the branch
// is made from the person's login and the name, so that everybody can have several, and see whose a change is.

import { slugify } from './paths.js'

/** `change/<login>/<slug>`: the login as GitHub writes it, a slug of the name. */
export const CHANGE_BRANCH = /^change\/[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_SLUG = 60

/** The branch of a change a person starts. Throws if the name has no letter or digit to make a slug of. */
export function changeBranch(login: string, name: string): string {
  const slug = slugify(name).slice(0, MAX_SLUG).replace(/-+$/, '')
  const who = login.replace(/[^A-Za-z0-9-]/g, '-').replace(/^-+|-+$/g, '')
  if (!slug) throw new Error(`"${name}" ergibt keinen gültigen Namen für eine Änderung.`)
  if (!who) throw new Error('Ohne Login lässt sich keine Änderung anlegen.')
  return `change/${who}/${slug}`
}

export const isChangeBranch = (branch: unknown): branch is string => typeof branch === 'string' && CHANGE_BRANCH.test(branch)

/** Who started the change: the login in its branch name. */
export const authorOf = (branch: string): string => branch.split('/')[1] ?? ''
