/**
 * Configuração central JWT (variáveis de ambiente).
 * Em produção exige JWT_SECRET com entropia mínima.
 */
export function getJwtAuthConfig() {
  const secret = String(process.env.JWT_SECRET || '').trim();
  const issuer = String(process.env.JWT_ISSUER || 'genesis-miner').trim();
  const audience = String(process.env.JWT_AUDIENCE || 'genesis-miner-api').trim();
  const accessTtl = Math.min(Math.max(parseInt(String(process.env.JWT_ACCESS_TTL_SEC || '900'), 10) || 900, 60), 3600);
  const refreshTtl = Math.min(
    Math.max(parseInt(String(process.env.JWT_REFRESH_TTL_SEC || String(14 * 24 * 3600)), 10) || 1209600, 3600),
    60 * 24 * 3600
  );
  const prod = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  if (prod && secret.length < 32) {
    throw new Error('[JWT] Em produção defina JWT_SECRET com pelo menos 32 caracteres.');
  }
  const effectiveSecret =
    secret ||
    (prod ? '' : 'dev-only-jwt-secret-do-not-use-in-production-min-32-chars!');
  if (!effectiveSecret) {
    throw new Error('[JWT] JWT_SECRET em falta.');
  }
  if (!prod && !secret) {
    console.warn('[JWT] JWT_SECRET não definido — a usar segredo de desenvolvimento (não usar em produção).');
  }
  return {
    secret: effectiveSecret,
    issuer,
    audience,
    accessTtlSec: accessTtl,
    refreshTtlSec: refreshTtl
  };
}

export const COOKIE_ACCESS = 'gm_access';
export const COOKIE_REFRESH = 'gm_refresh';
