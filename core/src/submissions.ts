// A submission is a branch and a pull request on it. The name a person gives it is the title of the pull request; the branch
// is made from the person's login and the name, so that everybody can have several, and see whose a submission is.

import { slugify } from './paths.js'

/** `submission/<login>/<slug>`: the login as GitHub writes it, a slug of the name. */
export const SUBMISSION_BRANCH = /^submission\/[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_SLUG = 60

/** The branch of a submission a person starts. Throws if the name has no letter or digit to make a slug of. */
export function submissionBranch(login: string, name: string): string {
  const slug = slugify(name).slice(0, MAX_SLUG).replace(/-+$/, '')
  const who = login.replace(/[^A-Za-z0-9-]/g, '-').replace(/^-+|-+$/g, '')
  if (!slug) throw new Error(`"${name}" ergibt keinen gültigen Namen für eine Einreichung.`)
  if (!who) throw new Error('Ohne Login lässt sich keine Einreichung anlegen.')
  return `submission/${who}/${slug}`
}

export const isSubmissionBranch = (branch: unknown): branch is string => typeof branch === 'string' && SUBMISSION_BRANCH.test(branch)

/** Who started the submission: the login in its branch name. */
export const authorOf = (branch: string): string => branch.split('/')[1] ?? ''
