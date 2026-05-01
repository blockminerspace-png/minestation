import { COOKIE_ACCESS, COOKIE_REFRESH } from './config.js';

function isSecureEnv() {
  return String(process.env.NODE_ENV || '').toLowerCase() === 'production';
}

/**
 * Cookies HttpOnly + SameSite=Strict (mitigação a XSS e CSRF entre sites).
 */
export function buildSetCookieHeader(name, value, { maxAgeSec, path = '/' }) {
  const parts = [`${name}=${value}`, 'HttpOnly', 'SameSite=Strict', `Path=${path}`];
  if (isSecureEnv()) parts.push('Secure');
  if (maxAgeSec != null && Number.isFinite(maxAgeSec)) parts.push(`Max-Age=${Math.floor(maxAgeSec)}`);
  return parts.join('; ');
}

export function buildClearCookieHeader(name, path = '/') {
  const parts = [`${name}=`, 'HttpOnly', 'SameSite=Strict', `Path=${path}`, 'Max-Age=0'];
  if (isSecureEnv()) parts.push('Secure');
  return parts.join('; ');
}

export function appendAccessCookie(res, accessToken, maxAgeSec) {
  res.append('Set-Cookie', buildSetCookieHeader(COOKIE_ACCESS, accessToken, { maxAgeSec, path: '/' }));
}

export function appendRefreshCookie(res, refreshToken, maxAgeSec) {
  res.append('Set-Cookie', buildSetCookieHeader(COOKIE_REFRESH, refreshToken, { maxAgeSec, path: '/' }));
}

export function clearAuthCookies(res) {
  res.append('Set-Cookie', buildClearCookieHeader(COOKIE_ACCESS, '/'));
  res.append('Set-Cookie', buildClearCookieHeader(COOKIE_REFRESH, '/'));
}
