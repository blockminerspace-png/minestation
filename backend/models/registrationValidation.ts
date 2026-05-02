import type { Pool } from 'pg';

/** Cadastro público: apenas estes domínios (login continua permitindo qualquer e-mail já registado). */
export const SIGNUP_ALLOWED_DOMAINS = new Set([
  'gmail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'ymail.com'
]);

const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com',
  'guerrillamail.com',
  'guerrillamailblock.com',
  'sharklasers.com',
  'yopmail.com',
  'yopmail.fr',
  'tempmail.com',
  'temp-mail.org',
  'throwaway.email',
  'trashmail.com',
  '10minutemail.com',
  '10minutemail.net',
  'fakeinbox.com',
  'getnada.com',
  'maildrop.cc',
  'dispostable.com',
  'emailondeck.com',
  'burnermail.io',
  'moakt.com',
  'tmpmail.org',
  'mailcatch.com',
  'spam4.me',
  'grr.la',
  'mailnesia.com',
  'trashmail.de',
  'discard.email',
  'discardmail.com',
  'wegwerfmail.de',
  'trashmail.ws',
  'armyspy.com',
  'cuvox.de',
  'dayrep.com',
  'einrot.com',
  'fleckens.hu',
  'gustr.com',
  'jourrapide.com',
  'rhyta.com',
  'superrito.com',
  'teleworm.us'
]);

export type PolicyResult = { ok: true } | { ok: false; error: string };

export function assertPublicSignupEmailAllowed(normalizedEmail: string): PolicyResult {
  const at = normalizedEmail.lastIndexOf('@');
  if (at < 1 || at === normalizedEmail.length - 1) {
    return { ok: false, error: 'E-mail inválido.' };
  }
  const local = normalizedEmail.slice(0, at);
  const domain = normalizedEmail.slice(at + 1).toLowerCase().trim();
  if (!local || local.length > 64 || !domain || domain.includes('..') || domain.startsWith('.') || domain.endsWith('.')) {
    return { ok: false, error: 'E-mail inválido.' };
  }
  if (/[<>'"\\]/.test(local) || /[<>'"\\]/.test(domain)) {
    return { ok: false, error: 'E-mail contém caracteres não permitidos.' };
  }
  if (DISPOSABLE_EMAIL_DOMAINS.has(domain) || domain.endsWith('.yopmail.com')) {
    return {
      ok: false,
      error:
        'E-mails temporários ou descartáveis não são aceites. Use Gmail, Outlook, Hotmail, Live ou Yahoo.'
    };
  }
  if (SIGNUP_ALLOWED_DOMAINS.has(domain)) return { ok: true };
  return {
    ok: false,
    error:
      'Cadastro permitido apenas com Gmail (@gmail.com), Outlook (@outlook.com), Hotmail (@hotmail.com), Live (@live.com) ou Yahoo (@yahoo.com, @ymail.com).'
  };
}

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,24}$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const REFERRAL_CODE_MAX = 64;

export type UsernameValidation = { ok: true; username: string } | { ok: false; error: string };

/** Nome de utilizador: letras, números, _ e - ; sem HTML/ XSS por rejeição de caracteres especiais. */
export function validateSignupUsername(raw: unknown): UsernameValidation {
  if (raw == null || typeof raw !== 'string') {
    return { ok: false, error: 'Nome de utilizador é obrigatório.' };
  }
  const trimmed = raw.trim();
  if (trimmed.length < 3 || trimmed.length > 24) {
    return { ok: false, error: 'O nome de utilizador deve ter entre 3 e 24 caracteres.' };
  }
  if (/[<>'"&`{}\[\]\\/;]/.test(trimmed) || /script/i.test(trimmed)) {
    return { ok: false, error: 'O nome de utilizador contém caracteres não permitidos.' };
  }
  if (!USERNAME_RE.test(trimmed)) {
    return {
      ok: false,
      error: 'Use apenas letras (A–Z), números, underscore (_) e hífen (-), sem espaços.'
    };
  }
  return { ok: true, username: trimmed };
}

export type PasswordValidation = { ok: true } | { ok: false; error: string };

export function validateSignupPassword(raw: unknown, required: boolean): PasswordValidation {
  if (!required) return { ok: true };
  if (raw == null || typeof raw !== 'string') {
    return { ok: false, error: 'Defina uma palavra-passe.' };
  }
  if (raw.length < PASSWORD_MIN) {
    return { ok: false, error: `A palavra-passe deve ter pelo menos ${PASSWORD_MIN} caracteres.` };
  }
  if (raw.length > PASSWORD_MAX) {
    return { ok: false, error: 'Palavra-passe demasiado longa.' };
  }
  return { ok: true };
}

export function sanitizeOptionalReferralCode(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!t || t.length > REFERRAL_CODE_MAX) return null;
  if (/[<>'"&`\\]/.test(t)) return null;
  return t;
}

export function validateOptionalPolygonWallet(raw: unknown): string | null | { error: string } {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string') return { error: 'Carteira inválida.' };
  const t = raw.trim();
  if (!t) return null;
  if (!/^0x[a-fA-F0-9]{40}$/.test(t)) {
    return { error: 'Endereço de carteira Polygon deve ser um endereço Ethereum válido (0x + 40 hex).' };
  }
  return t;
}

export function validateOptionalAccessLevelId(raw: unknown): string | null | { error: string } {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string') return { error: 'Nível de acesso inválido.' };
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(raw)) {
    return { error: 'Identificador de nível de acesso inválido.' };
  }
  return raw;
}

/** Outro utilizador já usa este nome (comparação case-insensitive). */
export async function getConflictingUserIdByUsername(
  pool: Pool,
  username: string,
  excludeUserId?: number | string | null
): Promise<number | null> {
  if (excludeUserId == null || excludeUserId === '') {
    const r = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1', [username]);
    return r.rows[0]?.id ?? null;
  }
  const r = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id <> $2 LIMIT 1', [
    username,
    excludeUserId
  ]);
  return r.rows[0]?.id ?? null;
}

/** E-mail já associado a outra conta. */
export async function getConflictingUserIdByEmail(
  pool: Pool,
  email: string,
  excludeUserId?: number | string | null
): Promise<number | null> {
  if (excludeUserId == null || excludeUserId === '') {
    const r = await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [email]);
    return r.rows[0]?.id ?? null;
  }
  const r = await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id <> $2 LIMIT 1', [
    email,
    excludeUserId
  ]);
  return r.rows[0]?.id ?? null;
}

export function validateAccessLevelIdsArray(raw: unknown): { ok: true; ids: string[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'Lista de níveis de acesso inválida.' };
  const ids: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(item)) {
      return { ok: false, error: 'Cada nível de acesso deve ser um identificador alfanumérico válido.' };
    }
    ids.push(item);
  }
  if (ids.length > 50) return { ok: false, error: 'Demasiados níveis de acesso na lista.' };
  return { ok: true, ids };
}
