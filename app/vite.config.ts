import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

/**
 * The demo database (../demo, made by `npm run generate-demo` in core) as one module for `dev:fake`: path to text.
 * import.meta.glob would skip the .folder.yaml files, because they start with a dot.
 */
function demoSeed(): Plugin {
  const id = 'virtual:demo-seed'
  const dir = fileURLToPath(new URL('../demo', import.meta.url))
  const walk = (d: string): string[] => readdirSync(d).flatMap((name) => (statSync(join(d, name)).isDirectory() ? walk(join(d, name)) : [join(d, name)]))
  let fake = false
  return {
    name: 'demo-seed',
    configResolved: (config) => void (fake = config.mode === 'fake'),
    resolveId: (source) => (source === id ? `\0${id}` : undefined),
    load(loaded) {
      if (loaded !== `\0${id}`) return undefined
      // Only the fake mode carries it: a deployed build must not ship the demo entries.
      const files = fake && existsSync(dir) ? walk(dir) : []
      for (const file of files) this.addWatchFile(file)
      return `export default ${JSON.stringify(Object.fromEntries(files.map((f) => [relative(dir, f).split('\\').join('/'), readFileSync(f, 'utf8')])))}`
    },
  }
}

export default defineConfig({
  plugins: [svelte(), demoSeed()],
  // The Worker only accepts this address (ALLOWED_ORIGIN in worker/wrangler.toml).
  // If the port is taken, stop with an error instead of quietly using another one.
  server: {
    port: 5174,
    strictPort: true,
    // The Worker is reached below /api on the same address, so that the session cookie is an ordinary
    // same-origin cookie. Deployed, the same mapping is a Pages Function in front of the Worker.
    // `ws` lets the live connection (/api/live) through too.
    proxy: { '/api': { target: 'http://localhost:8788', ws: true } },
    // `npm run dev:fake` shows the example entries of core's tests.
    fs: { allow: ['..'] },
  },
})
