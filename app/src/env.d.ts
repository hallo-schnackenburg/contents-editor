/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `fake`: the examples in memory; otherwise the address of the Worker (default /api). */
  readonly VITE_API?: string
}

declare module 'virtual:demo-seed' {
  /** Path (below the repository root) to text of every file of ../demo; empty if there is no demo database. */
  const seed: Record<string, string>
  export default seed
}
