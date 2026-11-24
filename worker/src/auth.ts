// Signing in with GitHub: the core of it is shared (editors-core); this editor names its cookies.
import { createAuth } from 'editors-core/worker/auth'

export type { AuthEnv, Signed } from 'editors-core/worker/auth'
export const { readSession, handleAuth } = createAuth({ cookiePrefix: 'contents_editor' })
