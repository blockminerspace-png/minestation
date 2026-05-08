/**
 * Contas admin com email nesta lista são tratadas como super administrador
 * (equivalente a is_super_admin = 1). A BD é alinhada em ensureAdminSuperAdminSchema.
 */
export const LEGACY_SUPER_ADMIN_EMAILS: readonly string[] = ['kellyreg@gmail.com'];

const LEGACY_SET = new Set(LEGACY_SUPER_ADMIN_EMAILS.map((e) => e.trim().toLowerCase()).filter(Boolean));

export function normalizeAdminEmailForLegacy(email: unknown): string {
  return String(email ?? '')
    .trim()
    .toLowerCase();
}

export function isLegacySuperAdminEmail(email: unknown): boolean {
  const n = normalizeAdminEmailForLegacy(email);
  if (!n) return false;
  return LEGACY_SET.has(n);
}

function truthyDbInt(v: unknown): boolean {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0;
}

/**
 * Super efetivo: coluna is_super_admin OU legado (apenas se for admin).
 */
export function resolveIsSuperAdminFromUserRow(row: {
  is_super_admin?: unknown;
  is_admin?: unknown;
  email?: unknown;
}): boolean {
  if (truthyDbInt(row.is_super_admin)) return true;
  if (!truthyDbInt(row.is_admin)) return false;
  return isLegacySuperAdminEmail(row.email);
}
