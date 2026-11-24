// The GitHub webhook: the core of it is shared (editors-core); this editor's submissions are the branches that start with `submission/`.
import { createHook } from 'editors-core/worker/webhook'

export { signedBy, type HookEnv } from 'editors-core/worker/webhook'
export const handleHook = createHook({ branchPrefix: 'submission/' })
