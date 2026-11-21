// The Worker. Routes (an optional /api in front is ignored, so the app can reach it under /api):
//   /auth/*       sign in with GitHub, who am I, sign out (auth.ts). Open to everyone.
// and only for a signed-in person who may write to the data repository:
//   /repo/*       read the entries, save and remove one (repo.ts).
//
// NOT YET THERE: pull requests (the person's branch is not merged anywhere), media upload (S3), a limit per person.

import { handleAuth, readSession, type AuthEnv } from './auth.js'
import { handleRepo } from './repo.js'
import type { Auth } from './session.js'

export interface Env extends AuthEnv {
  ALLOWED_ORIGIN?: string
}

function json(body: unknown, status: number, env: Env): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': env.ALLOWED_ORIGIN ?? '', vary: 'origin' },
  })
}

/** `fetchFn` is the network; tests pass a fake. */
export async function handle(request: Request, env: Env, fetchFn: typeof fetch = fetch): Promise<Response> {
  const route = new URL(request.url).pathname.replace(/^\/api(?=\/)/, '')

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': env.ALLOWED_ORIGIN ?? '',
        'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '600',
      },
    })
  }

  const auth = await handleAuth(request, route, env, fetchFn)
  if (auth) return auth

  // Everything else is for a signed-in person only. A renewed token goes back to the browser as a new cookie.
  const signed = await readSession(request, env, fetchFn)
  if (!signed) return json({ error: 'Nicht angemeldet.' }, 401, env)
  // A request that changes something must come from our own app: a page of another origin (also another subdomain) is refused.
  // Without an Origin header it is not a browser page (the cookie is needed anyway).
  const origin = request.headers.get('origin')
  if (!['GET', 'HEAD'].includes(request.method) && origin && origin !== env.ALLOWED_ORIGIN && origin !== new URL(request.url).origin) {
    return json({ error: 'Wrong origin.' }, 403, env)
  }
  const response = await signedRoute(request, route, signed.session, env, fetchFn)
  if (signed.cookie) response.headers.append('set-cookie', signed.cookie)
  return response
}

async function signedRoute(request: Request, route: string, session: Auth, env: Env, fetchFn: typeof fetch): Promise<Response> {
  const repo = await handleRepo(request, route, session, env, fetchFn)
  return repo ?? json({ error: 'Not found.' }, 404, env)
}

export default {
  fetch: (request: Request, env: Env) => handle(request, env),
}
