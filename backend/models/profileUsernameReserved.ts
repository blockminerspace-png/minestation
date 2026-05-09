/** Nomes reservados / equipa — comparação case-insensitive, após trim do username de perfil. */
const RESERVED = new Set(
  [
    'admin',
    'administrator',
    'support',
    'suporte',
    'root',
    'genesis',
    'genesisminer',
    'genesis-miner',
    'minestation',
    'staff',
    'moderator',
    'mod',
    'official',
    'system',
    'equipe',
    'team',
    'helpdesk'
  ].map((s) => s.toLowerCase())
);

export function isReservedProfileUsername(username: string): boolean {
  const t = String(username || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!t) return true;
  const compact = t.replace(/[\s_-]/g, '');
  if (RESERVED.has(t) || RESERVED.has(compact)) return true;
  for (const r of RESERVED) {
    if (t.startsWith(`${r} `) || t.startsWith(`${r}_`) || t.startsWith(`${r}-`)) return true;
  }
  return false;
}

/** Remove espaços invisíveis comuns (ZWSP, BOM, etc.). */
export function stripInvisibleUsernameChars(raw: string): string {
  return String(raw || '').replace(/[\u200B-\u200D\uFEFF]/g, '');
}
