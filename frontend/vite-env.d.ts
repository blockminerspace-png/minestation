/// <reference types="vite/client" />

/** Injeto em `vite.config.ts` (build) para invalidar flags de auto-recarga após deploy. */
declare const __APP_BUILD_STAMP__: string;

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
