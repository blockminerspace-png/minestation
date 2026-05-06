import { prisma } from '../config/db.js';

export async function getSettingValue(key: string): Promise<string | null> {
  const row = await prisma.settings.findUnique({
    where: { key },
    select: { value: true }
  });
  return row?.value ?? null;
}

/** Valores em falta não aparecem na chave (comportamento semelhante a `SELECT ... WHERE key = ANY`). */
export async function getSettingsRecord(keys: readonly string[]): Promise<Record<string, string>> {
  if (keys.length === 0) return {};
  const uniq = [...new Set(keys.filter((k) => typeof k === 'string' && k.length > 0))];
  if (uniq.length === 0) return {};
  const rows = await prisma.settings.findMany({
    where: { key: { in: uniq } },
    select: { key: true, value: true }
  });
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export async function upsertSettingsEntries(entries: Array<{ key: string; value: string }>): Promise<void> {
  if (entries.length === 0) return;
  await prisma.$transaction(
    entries.map((e) =>
      prisma.settings.upsert({
        where: { key: e.key },
        create: { key: e.key, value: e.value },
        update: { value: e.value }
      })
    )
  );
}
