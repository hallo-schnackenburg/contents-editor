// The shared part (sign in, tokens, the GitHub call, the repository's pull requests and commits) is in editors-core; below is what only this editor needs.
import { Repo as CoreRepo } from 'editors-core/worker/repo'
import { isStoredPath, isSubmissionBranch } from '@contents-editor/core'

export * from 'editors-core/worker/github'
export type { ChangedFile, Checks, ListedPull, Pull, PullInfo, RawComment, RepoFile } from 'editors-core/worker/repo'

/** One person's work on the data repository: their own branches and pull requests (the submissions). */
export class Repo extends CoreRepo {
  constructor(token: string, repo: string, base: string, fetchFn: typeof fetch) {
    super(token, repo, base, fetchFn, {
      isSubmissionBranch,
      isEntryFile: isStoredPath,
      submission: 'Einreichung',
      entries: 'Einträge',
    })
  }
}
