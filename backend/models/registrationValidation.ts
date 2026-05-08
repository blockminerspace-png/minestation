import { prisma } from '../config/prisma.js';
import { HttpControlledError } from '../utils/apiErrorResponse.js';
import { mapPrismaClientError } from '../utils/prismaHttpResponse.js';

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

/**
 * Limite do **formulário de novo cadastro** (UI / política pública).
 * Login, recuperação e APIs de email usam o mesmo teto (`EMAIL_ADDRESS_MAX_LENGTH`).
 */
export const SIGNUP_EMAIL_MAX_TOTAL = 50;

/** Endereço completo: mesmo teto que o cadastro (política do produto). */
export const EMAIL_ADDRESS_MAX_LENGTH = 50;

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 50;
/** Política pública: senha sem mínimo de comprimento; teto 50 (cadastro, login, recuperação, perfil). */
export const PASSWORD_MAX = 50;
/** Código de indicação introduzido no registo (outro utilizador). */
export const REFERRAL_CODE_MAX = 50;

export function assertPublicSignupEmailAllowed(normalizedEmail: string): PolicyResult {
  if (normalizedEmail.length > SIGNUP_EMAIL_MAX_TOTAL) {
    return { ok: false, error: 'E-mail demasiado longo.' };
  }
  const at = normalizedEmail.lastIndexOf('@');
  if (at < 1 || at === normalizedEmail.length - 1) {
    return { ok: false, error: 'E-mail inválido.' };
  }
  const local = normalizedEmail.slice(0, at);
  const domain = normalizedEmail.slice(at + 1).toLowerCase().trim();
  if (
    !local ||
    !domain ||
    local.length + 1 + domain.length > SIGNUP_EMAIL_MAX_TOTAL ||
    domain.includes('..') ||
    domain.startsWith('.') ||
    domain.endsWith('.')
  ) {
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

/** Hífen no fim da classe para não formar intervalo com o espaço. */
const USERNAME_RE = new RegExp(`^[a-zA-Z0-9_ -]{${USERNAME_MIN},${USERNAME_MAX}}$`);

export type UsernameValidation = { ok: true; username: string } | { ok: false; error: string };

/** Nome de utilizador: letras, números, espaço, _ e - ; sem HTML/ XSS por rejeição de caracteres especiais. */
export function validateSignupUsername(raw: unknown): UsernameValidation {
  if (raw == null || typeof raw !== 'string') {
    return { ok: false, error: 'Nome de utilizador é obrigatório.' };
  }
  const trimmed = raw.trim();
  if (trimmed.length < USERNAME_MIN || trimmed.length > USERNAME_MAX) {
    return {
      ok: false,
      error: `O nome de utilizador deve ter entre ${USERNAME_MIN} e ${USERNAME_MAX} caracteres.`
    };
  }
  if (/[<>'"&`{}\[\]\\/;]/.test(trimmed) || /script/i.test(trimmed)) {
    return { ok: false, error: 'O nome de utilizador contém caracteres não permitidos.' };
  }
  if (!USERNAME_RE.test(trimmed)) {
    return {
      ok: false,
      error: 'Use apenas letras (A–Z), números, espaços, underscore (_) e hífen (-).'
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
  if (raw.length === 0) {
    return { ok: false, error: 'Defina uma palavra-passe.' };
  }
  if (raw.length > PASSWORD_MAX) {
    return {
      ok: false,
      error: `Palavra-passe demasiado longa (máximo ${PASSWORD_MAX} caracteres).`
    };
  }
  return { ok: true };
}

/** Login: email e senha preenchidos, com mensagens distintas. */
export function validateLoginFieldsPresent(rawEmail: unknown, rawPassword: unknown): PolicyResult {
  const emailStr = typeof rawEmail === 'string' ? rawEmail : '';
  const passwordStr = typeof rawPassword === 'string' ? rawPassword : '';
  const hasEmail = emailStr.trim().length > 0;
  const hasPassword = passwordStr.length > 0;
  if (!hasEmail && !hasPassword) {
    return { ok: false, error: 'Indique o email e a palavra-passe.' };
  }
  if (!hasEmail) {
    return { ok: false, error: 'Indique o email.' };
  }
  if (!hasPassword) {
    return { ok: false, error: 'Indique a palavra-passe.' };
  }
  return { ok: true };
}

/** Login: apenas limites e forma básica (sem whitelist de domínio do cadastro). */
export function validateLoginEmail(raw: unknown): PolicyResult {
  if (raw == null || typeof raw !== 'string') {
    return { ok: false, error: 'Indique o email.' };
  }
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return { ok: false, error: 'Indique o email.' };
  }
  if (normalized.length > EMAIL_ADDRESS_MAX_LENGTH) {
    return { ok: false, error: `O email pode ter no máximo ${EMAIL_ADDRESS_MAX_LENGTH} caracteres.` };
  }
  const at = normalized.lastIndexOf('@');
  if (at < 1 || at === normalized.length - 1) {
    return { ok: false, error: 'Email inválido.' };
  }
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  if (
    !local ||
    !domain ||
    local.length + 1 + domain.length > EMAIL_ADDRESS_MAX_LENGTH ||
    domain.includes('..') ||
    domain.startsWith('.') ||
    domain.endsWith('.')
  ) {
    return { ok: false, error: 'Email inválido.' };
  }
  if (/[<>'"\\]/.test(local) || /[<>'"\\]/.test(domain)) {
    return { ok: false, error: 'Email contém caracteres não permitidos.' };
  }
  return { ok: true };
}

/** Login: limites de tamanho antes do bcrypt (alinhado com cadastro). */
export function validateLoginPassword(raw: unknown): PolicyResult {
  if (raw == null || typeof raw !== 'string') {
    return { ok: false, error: 'Indique a palavra-passe.' };
  }
  if (raw.length > PASSWORD_MAX) {
    return {
      ok: false,
      error: `Palavra-passe demasiado longa (máximo ${PASSWORD_MAX} caracteres).`
    };
  }
  return { ok: true };
}

export type ReferralCodeValidation = { ok: true; code: string | null } | { ok: false; error: string };

export function validateOptionalReferralCodeInput(raw: unknown): ReferralCodeValidation {
  if (raw == null || raw === '') return { ok: true, code: null };
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Código de indicação inválido.' };
  }
  const t = raw.trim();
  if (!t) return { ok: true, code: null };
  if (t.length > REFERRAL_CODE_MAX) {
    return {
      ok: false,
      error: `O código de indicação pode ter no máximo ${REFERRAL_CODE_MAX} caracteres.`
    };
  }
  if (/[<>'"&`\\]/.test(t)) {
    return { ok: false, error: 'O código de indicação contém caracteres não permitidos.' };
  }
  return { ok: true, code: t };
}

/** Compatível com fluxos que ignoram código inválido em vez de falhar. */
export function sanitizeOptionalReferralCode(raw: unknown): string | null {
  const r = validateOptionalReferralCodeInput(raw);
  if (!r.ok) return null;
  return r.code;
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

function throwHttpFromPrisma(err: unknown, logCtx: string): never {
  console.error(logCtx, err instanceof Error ? err.message : err);
  const mapped = mapPrismaClientError(err);
  if (mapped) {
    throw new HttpControlledError(mapped.status, mapped.body);
  }
  throw new HttpControlledError(503, {
    error: 'Não foi possível validar os dados. Tenta novamente.',
    code: 'DB_READ'
  });
}

/** Outro utilizador já usa este nome (comparação case-insensitive). */
export async function getConflictingUserIdByUsername(
  username: string,
  excludeUserId?: number | string | null
): Promise<number | null> {
  const ex =
    excludeUserId != null && excludeUserId !== ''
      ? { not: Number(excludeUserId) }
      : undefined;
  try {
    const r = await prisma.users.findFirst({
      where: {
        username: { equals: username, mode: 'insensitive' },
        ...(ex != null ? { id: ex } : {})
      },
      select: { id: true }
    });
    return r?.id ?? null;
  } catch (e: unknown) {
    throwHttpFromPrisma(e, '[getConflictingUserIdByUsername]');
  }
}

/** E-mail já associado a outra conta. */
export async function getConflictingUserIdByEmail(
  email: string,
  excludeUserId?: number | string | null
): Promise<number | null> {
  const ex =
    excludeUserId != null && excludeUserId !== ''
      ? { not: Number(excludeUserId) }
      : undefined;
  try {
    const r = await prisma.users.findFirst({
      where: {
        email: { equals: email, mode: 'insensitive' },
        ...(ex != null ? { id: ex } : {})
      },
      select: { id: true }
    });
    return r?.id ?? null;
  } catch (e: unknown) {
    throwHttpFromPrisma(e, '[getConflictingUserIdByEmail]');
  }
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
