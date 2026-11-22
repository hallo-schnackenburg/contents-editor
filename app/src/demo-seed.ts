// The demo database (`npm run generate-demo` in core makes it): 500 entries for trying the browsing UI with `npm run dev:fake`.
// Kept apart from fake.ts and loaded only in fake mode, so that a real build does not carry it.

import seed from 'virtual:demo-seed'

export const DEMO: Record<string, string> = seed
