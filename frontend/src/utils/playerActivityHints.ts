/**
 * Dados não sensíveis para auditoria (dispositivo / navegador), enviados com logs de atividade.
 * O servidor valida e trunca; não substitui fingerprint completo de login.
 */
export type PlayerActivityClientHints = Record<string, string | number | boolean | Record<string, string>>;

export async function collectPlayerActivityClientHintsAsync(): Promise<PlayerActivityClientHints> {
  const hints: PlayerActivityClientHints = {};
  if (typeof navigator === 'undefined') return hints;

  const ua = typeof navigator.userAgent === 'string' ? navigator.userAgent : '';
  hints.userAgent = ua.slice(0, 500);
  hints.mobileHeuristic = /Mobi|Android|iPhone|iPad|iPod|Windows Phone/i.test(ua);
  hints.touchPoints = typeof navigator.maxTouchPoints === 'number' ? navigator.maxTouchPoints : 0;
  hints.language = typeof navigator.language === 'string' ? navigator.language.slice(0, 40) : '';
  hints.platform = typeof navigator.platform === 'string' ? navigator.platform.slice(0, 120) : '';
  hints.vendor = typeof navigator.vendor === 'string' ? navigator.vendor.slice(0, 120) : '';

  if (typeof screen !== 'undefined') {
    hints.screenCss = `${screen.width ?? 0}x${screen.height ?? 0}`;
  }
  if (typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number') {
    hints.devicePixelRatio = window.devicePixelRatio;
  }

  const conn = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
  if (conn && typeof conn.effectiveType === 'string') {
    hints.connectionEffectiveType = conn.effectiveType.slice(0, 20);
  }

  type UAD = {
    brands?: { brand: string; version: string }[];
    mobile?: boolean;
    platform?: string;
    getHighEntropyValues?: (keys: string[]) => Promise<Record<string, unknown>>;
  };
  const ud = (navigator as Navigator & { userAgentData?: UAD }).userAgentData;
  if (ud) {
    if (typeof ud.mobile === 'boolean') hints.uaChMobile = ud.mobile;
    if (typeof ud.platform === 'string') hints.uaChPlatform = ud.platform.slice(0, 80);
    if (Array.isArray(ud.brands)) {
      hints.uaChBrands = ud.brands.map((b) => `${b.brand}/${b.version}`).join(', ').slice(0, 200);
    }
    if (typeof ud.getHighEntropyValues === 'function') {
      try {
        const hi = await ud.getHighEntropyValues([
          'architecture',
          'bitness',
          'model',
          'platformVersion',
          'fullVersionList'
        ]);
        const safe: Record<string, string> = {};
        for (const [k, v] of Object.entries(hi)) {
          if (v == null) continue;
          if (typeof v === 'string') safe[k] = v.slice(0, 200);
          else if (typeof v === 'number' && Number.isFinite(v)) safe[k] = String(v);
          else if (typeof v === 'boolean') safe[k] = v ? 'true' : 'false';
          else safe[k] = JSON.stringify(v).slice(0, 400);
        }
        if (Object.keys(safe).length) hints.highEntropy = safe;
      } catch {
        /* ignore */
      }
    }
  }

  return hints;
}
