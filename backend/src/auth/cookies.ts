import type { Response } from 'express';
import { COOKIE_ACCESS, COOKIE_REFRESH } from './config.js';

function isSecureEnv(): boolean {
  return String(process.env.NODE_ENV || '').toLowerCase() === 'production';
}

/**
 * Cookies HttpOnly + SameSite=Strict (mitigação a XSS e CSRF entre sites).
 */
export function buildSetCookieHeader(
  name: string,
  value: string,
  { maxAgeSec, path = '/' }: { maxAgeSec?: number; path?: string }
): string {
  const parts = [`${name}=${value}`, 'HttpOnly', 'SameSite=Strict', `Path=${path}`];
  if (isSecureEnv()) parts.push('Secure');
  if (maxAgeSec != null && Number.isFinite(maxAgeSec)) parts.push(`Max-Age=${Math.floor(maxAgeSec)}`);
  return parts.join('; ');
}

export function buildClearCookieHeader(name: string, path = '/'): string {
  const parts = [`${name}=`, 'HttpOnly', 'SameSite=Strict', `Path=${path}`, 'Max-Age=0'];
  if (isSecureEnv()) parts.push('Secure');
  return parts.join('; ');
}

export function appendAccessCookie(res: Response, accessToken: string, maxAgeSec: number): void {
  res.append('Set-Cookie', buildSetCookieHeader(COOKIE_ACCESS, accessToken, { maxAgeSec, path: '/' }));
}

export function appendRefreshCookie(res: Response, refreshToken: string, maxAgeSec: number): void {
  res.append('Set-Cookie', buildSetCookieHeader(COOKIE_REFRESH, refreshToken, { maxAgeSec, path: '/' }));
}

export function clearAuthCookies(res: Response): void {
  res.append('Set-Cookie', buildClearCookieHeader(COOKIE_ACCESS, '/'));
  res.append('Set-Cookie', buildClearCookieHeader(COOKIE_REFRESH, '/'));
}
