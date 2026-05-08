import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const CHUNK_RELOAD_KEY = 'gm_chunk_autoreload_v1';
const BUILD_STAMP_KEY = 'gm_app_build_stamp_v1';

function isChunkLikeLoadError(err: unknown): boolean {
  if (err == null) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return /Failed to fetch dynamically imported module|ChunkLoadError|Loading chunk \d+ failed|Unable to preload CSS|Importing a module script failed/i.test(
    msg
  );
}

/** Em cada build de produção o stamp muda → permite nova auto-recarga após deploy. */
function syncBuildStampWithSession(): void {
  if (typeof window === 'undefined') return;
  try {
    const stamp =
      typeof __APP_BUILD_STAMP__ !== 'undefined' && __APP_BUILD_STAMP__
        ? String(__APP_BUILD_STAMP__)
        : 'dev';
    const prev = sessionStorage.getItem(BUILD_STAMP_KEY);
    if (prev !== stamp) {
      sessionStorage.removeItem(CHUNK_RELOAD_KEY);
      sessionStorage.setItem(BUILD_STAMP_KEY, stamp);
    }
  } catch {
    /* private mode / quota */
  }
}

syncBuildStampWithSession();

/**
 * `React.lazy` com uma auto-recarga se o chunk 404 (HTML antigo após deploy).
 * Evita ecrã preso em "Failed to fetch dynamically imported module".
 */
export function lazyWithReload<T extends ComponentType<unknown>>(
  importer: () => Promise<{ default: T }>
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      return await importer();
    } catch (err) {
      if (typeof window !== 'undefined' && isChunkLikeLoadError(err)) {
        try {
          syncBuildStampWithSession();
          if (!sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
            sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
            window.location.reload();
            return await new Promise<{ default: T }>(() => {});
          }
        } catch {
          /* sessionStorage blocked */
        }
      }
      throw err;
    }
  });
}
