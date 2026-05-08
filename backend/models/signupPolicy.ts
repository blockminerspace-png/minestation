import crypto from 'node:crypto';

/** Código de referral derivado do nome (sem política de domínio — isso está em registrationValidation). */
export function generateReferralCode(username: string): string {
  const base =
    (username || 'user')
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9_-]/g, '-')
      .slice(0, 12) || 'user';
  const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  const num = Math.floor(Math.random() * 100000)
    .toString()
    .padStart(5, '0');
  return `${base}-${rand}_${num}`;
}
