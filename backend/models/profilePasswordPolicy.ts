import bcrypt from 'bcryptjs';

const COMMON_WEAK = new Set(
  [
    'password',
    '12345678',
    '123456789',
    'qwerty123',
    'genesis',
    'genesisminer',
    'welcome1',
    'senha123',
    'palavrapasse',
    'abc123456'
  ].map((s) => s.toLowerCase())
);

export type ProfilePasswordStrength = { ok: true } | { ok: false; error: string };

/**
 * Regra de perfil: mais forte que o cadastro legado (mínimo + letras e números + não comum + diferente da atual).
 */
export async function validateProfileNewPasswordStrength(
  newPassword: string,
  currentHash: string | null | undefined
): Promise<ProfilePasswordStrength> {
  const p = String(newPassword || '');
  if (p.length < 10) {
    return { ok: false, error: 'A nova palavra-passe deve ter pelo menos 10 caracteres.' };
  }
  if (p.length > 50) {
    return { ok: false, error: 'A nova palavra-passe é demasiado longa.' };
  }
  const hasLetter = /[a-zA-Z]/.test(p);
  const hasDigit = /\d/.test(p);
  if (!hasLetter || !hasDigit) {
    return { ok: false, error: 'Use letras e números na nova palavra-passe.' };
  }
  const lower = p.toLowerCase();
  if (COMMON_WEAK.has(lower)) {
    return { ok: false, error: 'Esta palavra-passe é demasiado comum. Escolha outra.' };
  }
  if (currentHash && (await bcrypt.compare(p, currentHash))) {
    return { ok: false, error: 'A nova palavra-passe não pode ser igual à atual.' };
  }
  return { ok: true };
}
