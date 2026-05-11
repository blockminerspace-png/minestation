/**
 * Helper para logs `[GPU_DUP_DEBUG]` no front. Activado via `localStorage.GPU_DUP_DEBUG = '1'`
 * ou variável `VITE_GPU_DUP_DEBUG=1` no build. Mantém payload compacto e seguro para console.
 */
export function isGpuDupDebugEnabled(): boolean {
  try {
    if (typeof import.meta !== 'undefined') {
      const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
      const v = env?.VITE_GPU_DUP_DEBUG;
      if (typeof v === 'string' && v.trim() === '1') return true;
      if (v === true || v === 1) return true;
    }
  } catch {
    /* ignore */
  }
  try {
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem('GPU_DUP_DEBUG');
      if (typeof v === 'string' && v.trim() === '1') return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function gpuDupLog(event: string, payload: Record<string, unknown>): void {
  if (!isGpuDupDebugEnabled()) return;
  try {
    console.log(`[GPU_DUP_DEBUG][${event}]`, payload);
  } catch {
    /* ignore */
  }
}
