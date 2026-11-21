/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `fake`: the examples in memory; otherwise the address of the Worker (default /api). */
  readonly VITE_API?: string
}
