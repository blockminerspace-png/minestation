import type { Express, Request, RequestHandler, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { prismaSqlTx } from '../lib/sqlTransaction.js';
import {
  parseLootBoxId,
  deleteLootBoxCascade,
  isLootBoxBrokenForSafeDelete,
  executeLootBoxOpenInTransaction,
  executeLootBoxBuyInTransaction,
  executeLootBoxDiscardInTransaction,
  LootBoxOpenError,
  LootBoxBuyError,
  LootBoxDiscardError
} from '../models/lootBoxModel.js';
import {
  assertEmailMatchesSession,
  bodyLootBoxId,
  bodyOptionalDiscardQty
} from '../validation/lootBoxValidation.js';
import { sendInternalErrorSafeMessageOrPrisma } from '../utils/apiErrorResponse.js';

export type LootBoxAdminDeps = {
  isAdmin: RequestHandler;
};

class LootBoxAdminUserError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === 'string' ? String(body.error) : 'admin');
    this.name = 'LootBoxAdminUserError';
    this.status = status;
    this.body = body;
  }
}

export type LootBoxPlayerDeps = {
  appendGameActivityLog: (
    q: unknown,
    userId: number,
    action: string,
    meta: unknown
  ) => Promise<void>;
};

function uidNum(req: Request): number | null {
  const v = req.userId;
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function registerLootBoxPlayerRoutes(app: Express, deps: LootBoxPlayerDeps): void {
  const { appendGameActivityLog } = deps;

  app.get('/api/loot-boxes', async (req: Request, res: Response) => {
    try {
      const boxes = await prisma.loot_boxes.findMany({
        orderBy: [
          { is_active: 'desc' },
          { trigger: 'asc' },
          { name: 'asc' },
          { id: 'asc' }
        ]
      });
      const boxIds = boxes.map((b) => b.id);
      const itemRows = boxIds.length
        ? await prisma.loot_box_items.findMany({ where: { box_id: { in: boxIds } } })
        : [];
      const itemMap: Record<
        string,
        Array<{
          id: string;
          type: string;
          minQty: number;
          maxQty: number;
          probability: number;
        }>
      > = {};
      for (const it of itemRows) {
        itemMap[it.box_id] = itemMap[it.box_id] || [];
        itemMap[it.box_id].push({
          id: it.item_id,
          type: it.item_type,
          minQty: it.min_qty,
          maxQty: it.max_qty,
          probability: it.probability
        });
      }
      const resp = boxes.map((b) => ({
        id: b.id,
        name: b.name,
        description: b.description,
        price: b.price,
        trigger: b.trigger,
        icon: b.icon,
        isActive: b.is_active === undefined || b.is_active === null ? true : !!b.is_active,
        items: itemMap[b.id] || []
      }));
      res.json(resp);
    } catch (e: unknown) {
      sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'loot-box', e, 'Erro ao listar caixas.');
    }
  });

  app.post('/api/loot-boxes/open', async (req: Request, res: Response) => {
    const boxId = bodyLootBoxId(req.body);
    const userId = uidNum(req);
    if (!userId) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }
    if (!boxId) {
      res.status(400).json({ error: 'Caixa inválida.' });
      return;
    }

    try {
      const emailGate = await assertEmailMatchesSession(
        prisma,
        userId,
        (req.body as { email?: unknown } | undefined)?.email
      );
      if (!emailGate.ok) {
        res.status(emailGate.status).json({ error: emailGate.error });
        return;
      }

      const idkRaw = (req.body as { idempotencyKey?: unknown })?.idempotencyKey;
      const idempotencyKey =
        typeof idkRaw === 'string' && idkRaw.trim() ? idkRaw.trim().slice(0, 128) : undefined;
      const { rewards, gainedUsdc, boxName, openingId } = await prisma.$transaction(
        (tx) => executeLootBoxOpenInTransaction(tx, { userId, boxId, idempotencyKey: idempotencyKey ?? null }),
        { timeout: 60_000, maxWait: 10_000 }
      );

      const urow = await prisma.users.findUnique({
        where: { id: userId },
        select: { username: true }
      });
      const username = urow?.username || '';
      console.log(
        '[LootBoxOpen] ts=%s userId=%s username=%s boxId=%s boxName=%s rewards=%s gainedUsdc=%s',
        new Date().toISOString(),
        userId,
        username,
        boxId,
        boxName,
        JSON.stringify(rewards),
        gainedUsdc
      );
      void appendGameActivityLog(null, userId, 'loot_box_open', {
        boxId,
        boxName,
        rewardCount: rewards.length,
        gainedUsdc,
        rewardsPreview: rewards.slice(0, 12)
      }).catch(() => {
        /* Mongo não pode bloquear resposta HTTP */
      });

      res.json({ ok: true, rewards, openingId });
    } catch (err: unknown) {
      if (err instanceof LootBoxOpenError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('[BoxOpen] Error:', err);
      sendInternalErrorSafeMessageOrPrisma(res, 'POST /api/loot-boxes/open', err, 'Erro ao abrir caixa.');
    }
  });

  app.post('/api/loot-boxes/buy', async (req: Request, res: Response) => {
    const boxId = bodyLootBoxId(req.body);
    const userId = uidNum(req);
    if (!userId) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }
    if (!boxId) {
      res.status(400).json({ error: 'Caixa inválida.' });
      return;
    }

    try {
      const emailGate = await assertEmailMatchesSession(
        prisma,
        userId,
        (req.body as { email?: unknown } | undefined)?.email
      );
      if (!emailGate.ok) {
        res.status(emailGate.status).json({ error: emailGate.error });
        return;
      }

      const body = req.body as { qty?: unknown; quantity?: unknown };
      const qtyRaw = body.quantity ?? body.qty;
      const qtyParsed =
        typeof qtyRaw === 'number'
          ? qtyRaw
          : typeof qtyRaw === 'string'
            ? parseInt(qtyRaw, 10)
            : NaN;
      const qty = Number.isFinite(qtyParsed) && qtyParsed >= 1 ? Math.floor(qtyParsed) : undefined;
      const { newUsdc, boxName, trigger, price, qtyPurchased } = await prisma.$transaction(
        (tx) => executeLootBoxBuyInTransaction(tx, { userId, boxId, qty }),
        { timeout: 60_000, maxWait: 10_000 }
      );

      const urow = await prisma.users.findUnique({
        where: { id: userId },
        select: { username: true }
      });
      const username = urow?.username || '';
      console.log(
        '[LootBoxBuy] ts=%s userId=%s username=%s boxId=%s boxName=%s priceUsdc=%s newUsdc=%s trigger=%s',
        new Date().toISOString(),
        userId,
        username,
        boxId,
        boxName,
        price.toFixed(6),
        Number(newUsdc).toFixed(6),
        trigger
      );
      await appendGameActivityLog(null, userId, 'loot_box_buy', {
        boxId,
        boxName,
        priceUsdc: Number(price.toFixed(6)),
        newUsdc: Number(Number(newUsdc).toFixed(6)),
        trigger
      });

      res.json({ ok: true, newUsdc, qtyPurchased });
    } catch (err: unknown) {
      if (err instanceof LootBoxBuyError) {
        const body: { error: string; missing?: number } = { error: err.message };
        if (err.missing != null) body.missing = err.missing;
        res.status(err.statusCode).json(body);
        return;
      }
      console.error('[BoxBuy] Error:', err);
      sendInternalErrorSafeMessageOrPrisma(res, 'POST /api/loot-boxes/buy', err, 'Erro ao comprar caixa.');
    }
  });

  app.post('/api/loot-boxes/discard', async (req: Request, res: Response) => {
    const boxId = bodyLootBoxId(req.body);
    const qtySpec = bodyOptionalDiscardQty(req.body);
    const userId = uidNum(req);
    if (!userId) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }
    if (!boxId) {
      res.status(400).json({ error: 'Caixa inválida.' });
      return;
    }
    if (qtySpec === null) {
      res.status(400).json({ error: 'Quantidade inválida.' });
      return;
    }

    try {
      const emailGate = await assertEmailMatchesSession(
        prisma,
        userId,
        (req.body as { email?: unknown } | undefined)?.email
      );
      if (!emailGate.ok) {
        res.status(emailGate.status).json({ error: emailGate.error });
        return;
      }

      const { discardedQty, remainingQty, boxName } = await prisma.$transaction(
        (tx) => executeLootBoxDiscardInTransaction(tx, { userId, boxId, qtySpec }),
        { timeout: 60_000, maxWait: 10_000 }
      );

      const urow = await prisma.users.findUnique({
        where: { id: userId },
        select: { username: true }
      });
      const username = urow?.username || '';
      console.log(
        '[LootBoxDiscard] ts=%s userId=%s username=%s boxId=%s discardedQty=%s remaining=%s',
        new Date().toISOString(),
        userId,
        username,
        boxId,
        discardedQty,
        remainingQty
      );
      await appendGameActivityLog(null, userId, 'loot_box_discard', {
        boxId,
        boxName,
        discardedQty,
        remainingQty
      });

      res.json({ ok: true, discardedQty, remainingQty });
    } catch (err: unknown) {
      if (err instanceof LootBoxDiscardError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('[BoxDiscard] Error:', err);
      sendInternalErrorSafeMessageOrPrisma(res, 'POST /api/loot-boxes/discard', err, 'Erro ao descartar caixa(s).');
    }
  });
}

type IncomingLootBoxItem = {
  id?: string;
  type?: string;
  minQty?: number;
  maxQty?: number;
  probability?: number;
};

type IncomingLootBox = {
  id: string;
  name: string;
  description?: string;
  price?: number;
  trigger?: string;
  icon?: string;
  isActive?: boolean;
  items?: IncomingLootBoxItem[];
};

export function registerLootBoxAdminRoutes(app: Express, deps: LootBoxAdminDeps): void {
  const { isAdmin } = deps;

  /** Upsert do catálogo de caixas (painel admin); antes em `pg` + `BEGIN` no server. */
  app.post('/api/loot-boxes', isAdmin, async (req: Request, res: Response) => {
    let boxes: unknown[];
    let replaceCatalog = false;
    if (Array.isArray(req.body)) {
      boxes = req.body;
      replaceCatalog = false;
    } else if (req.body && typeof req.body === 'object' && Array.isArray((req.body as { boxes?: unknown }).boxes)) {
      boxes = (req.body as { boxes: unknown[] }).boxes;
      replaceCatalog = (req.body as { replaceCatalog?: unknown }).replaceCatalog === true;
    } else {
      res.status(400).json({
        error: 'Body inválido: use { boxes: [], replaceCatalog?: boolean } ou um array (legado).'
      });
      return;
    }

    try {
      const warnings = await prisma.$transaction(
        async (tx) => {
          const validBoxes = (boxes as IncomingLootBox[]).filter(
            (b) => b && b.id && typeof b.name === 'string' && String(b.name).trim()
          );
          const validIncomingIds = validBoxes.map((b) => String(b.id));

          const triggersWithoutItemList = new Set(['roleta_code']);
          const outWarnings: string[] = [];

          /**
           * Snapshot dos `loot_box_items` actuais por caixa (apenas para as caixas
           * neste payload) — usado para decidir se a caixa pode ficar `is_active`
           * mesmo quando o payload tem `items: []` (cache/lazy state). Se já tiver
           * prémios em DB, **não coage** a inactiva.
           */
          const currentItemCountByBoxId = new Map<string, number>();
          if (validIncomingIds.length > 0) {
            const grouped = await tx.loot_box_items.groupBy({
              by: ['box_id'],
              where: { box_id: { in: validIncomingIds } },
              _count: { _all: true }
            });
            for (const row of grouped) {
              currentItemCountByBoxId.set(String(row.box_id), Number(row._count?._all ?? 0));
            }
          }

          type NormalizedBox = { b: IncomingLootBox; effectiveActive: boolean };
          const normalized: NormalizedBox[] = [];

          for (const b of validBoxes) {
            let effectiveActive = b.isActive !== false;
            const trig = String(b.trigger || 'shop');
            const nItemsPayload = Array.isArray(b.items)
              ? b.items.filter((it) => it && String((it as { id?: unknown }).id ?? '').trim()).length
              : 0;
            const nItemsDb = currentItemCountByBoxId.get(String(b.id)) ?? 0;
            const nItemsEffective = nItemsPayload > 0 ? nItemsPayload : nItemsDb;

            /**
             * Antes: 400 se `isActive` sem linhas em `loot_box_items` — com
             * `replaceCatalog: true` o painel envia **todo** o catálogo; uma única
             * caixa inconsistente (cache, payload parcial, rascunho antigo)
             * bloqueava o save de todas.
             *
             * Agora: coerção segura **só se**:
             *   - payload diz activa,
             *   - não é gatilho exempto (`roleta_code`),
             *   - **e** efectivamente não há prémios (nem no payload nem em DB).
             * Combinado com o preserve-on-empty abaixo, isto evita falsos positivos
             * por estado React desactualizado.
             */
            if (effectiveActive && !triggersWithoutItemList.has(trig) && nItemsEffective === 0) {
              effectiveActive = false;
              const msg = `Caixa "${String(b.name).trim()}" (${String(b.id)}): activa mas sem prémios — gravada como inactiva (rascunho). Adicione prémios e reactive.`;
              outWarnings.push(msg);
              console.warn(`[POST /api/loot-boxes] ${msg}`);
            }

            if (effectiveActive && (trig === 'shop' || trig === 'shop_once' || trig === 'special')) {
              const p = Number(b.price);
              if (!Number.isFinite(p) || p <= 0) {
                throw new LootBoxAdminUserError(400, {
                  error: `Caixa "${String(b.name).trim()}" (${b.id}): preço USDC inválido para venda na loja (use número > 0).`
                });
              }
            }
            normalized.push({ b, effectiveActive });
          }

          /**
           * Estratégia post-fix (b3fb57e + restore 20260517100000):
           *   - **NUNCA** apagamos `loot_box_items` "às cegas"; o painel envia o
           *     catálogo todo (`replaceCatalog: true`) e qualquer caixa cujo
           *     estado React tinha `items: []` (cache, lazy-load, edição parcial)
           *     fazia o backend deletar prémios reais.
           *   - `clearItems: true` (opt-in) → wipe explícito, depois insere o que vier.
           *   - Items com >= 1 entrada válida → DELETE + INSERT (substitui).
           *   - Items vazio/missing → preserva o que já está em DB.
           * Para realmente esvaziar uma caixa o admin tem de pedir explicitamente
           * (ver `clearItems`) ou apagar a caixa.
           */
          for (const { b, effectiveActive } of normalized) {
            const id = String(b.id);
            await tx.loot_boxes.upsert({
              where: { id },
              create: {
                id,
                name: b.name.trim(),
                description: String(b.description ?? ''),
                price: Number(b.price) || 0,
                trigger: String(b.trigger || 'shop'),
                icon: String(b.icon || '🎁'),
                is_active: effectiveActive ? 1 : 0
              },
              update: {
                name: b.name.trim(),
                description: String(b.description ?? ''),
                price: Number(b.price) || 0,
                trigger: String(b.trigger || 'shop'),
                icon: String(b.icon || '🎁'),
                is_active: effectiveActive ? 1 : 0
              }
            });

            const incomingRows = Array.isArray(b.items)
              ? b.items
                  .filter((it): it is IncomingLootBoxItem & { id: string } => !!(it && String((it as { id?: unknown }).id ?? '').trim()))
                  .map((it) => ({
                    box_id: id,
                    item_type: String(it.type || 'item'),
                    item_id: String(it.id),
                    min_qty: Math.floor(Number(it.minQty) || 1),
                    max_qty: Math.floor(Number(it.maxQty) || 1),
                    probability: Number(it.probability) || 0
                  }))
              : [];

            const explicitClear = (b as IncomingLootBox & { clearItems?: unknown }).clearItems === true;

            if (incomingRows.length > 0) {
              await tx.loot_box_items.deleteMany({ where: { box_id: id } });
              await tx.loot_box_items.createMany({ data: incomingRows });
            } else if (explicitClear) {
              await tx.loot_box_items.deleteMany({ where: { box_id: id } });
            }
          }

          if (replaceCatalog) {
            if (boxes.length === 0) {
              await tx.loot_boxes.updateMany({ data: { is_active: 0 } });
            } else if (validIncomingIds.length > 0) {
              await tx.loot_boxes.updateMany({
                where: { id: { notIn: validIncomingIds } },
                data: { is_active: 0 }
              });
            }
          }

          return outWarnings;
        },
        { timeout: 60_000, maxWait: 10_000 }
      );

      res.json(warnings.length > 0 ? { ok: true, warnings } : { ok: true });
    } catch (e: unknown) {
      if (e instanceof LootBoxAdminUserError) {
        res.status(e.status).json(e.body);
        return;
      }
      console.error('[POST /api/loot-boxes] Fail:', e);
      sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Falha ao processar o pedido.');
    }
  });

  app.delete('/api/admin/loot-boxes/:boxId', isAdmin, async (req: Request, res: Response) => {
    const boxId = parseLootBoxId(req.params.boxId);
    if (!boxId) {
      res.status(400).json({ error: 'ID da caixa inválido.' });
      return;
    }

    const q = req.query.brokenOnly;
    const brokenOnly =
      q === '1' || q === 'true' || q === 'yes' || String(q).toLowerCase() === 'on';

    try {
      const { boxName, summary } = await prisma.$transaction(
        async (tx) => {
          const sql = prismaSqlTx(tx);
          const exists = await sql.queryRows<{ id: string; name: string }>(
            'SELECT id, name FROM loot_boxes WHERE id = $1',
            [boxId]
          );
          if (exists.length === 0) {
            throw new LootBoxAdminUserError(404, { error: 'Caixa não encontrada.' });
          }
          const name = exists[0]!.name;
          if (brokenOnly) {
            const broken = await isLootBoxBrokenForSafeDelete(sql, boxId);
            if (!broken) {
              throw new LootBoxAdminUserError(409, {
                error:
                  'A caixa ainda tem itens com probabilidade > 0. Remova brokenOnly=1 para apagar à força, ou zere as probabilidades no editor.'
              });
            }
          }
          const summary = await deleteLootBoxCascade(sql, boxId);
          return { boxName: name, summary };
        },
        { timeout: 60_000, maxWait: 10_000 }
      );

      console.log('[LootBoxAdminDelete]', {
        boxId,
        boxName,
        brokenOnly,
        ...summary
      });

      res.json({ ok: true, summary });
    } catch (e: unknown) {
      if (e instanceof LootBoxAdminUserError) {
        res.status(e.status).json(e.body);
        return;
      }
      console.error('[LootBoxAdminDelete] Error:', e);
      sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'loot-box', e, 'Falha ao apagar caixa.');
    }
  });
}
