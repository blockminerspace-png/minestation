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
import { sendInternalErrorSafeMessage } from '../utils/apiErrorResponse.js';

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
      sendInternalErrorSafeMessage(res, req.originalUrl || 'loot-box', e, 'Erro ao listar caixas.');
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

      const { rewards, gainedUsdc, boxName } = await prisma.$transaction(
        (tx) => executeLootBoxOpenInTransaction(tx, { userId, boxId }),
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
      await appendGameActivityLog(null, userId, 'loot_box_open', {
        boxId,
        boxName,
        rewardCount: rewards.length,
        gainedUsdc,
        rewardsPreview: rewards.slice(0, 12)
      });

      res.json({ ok: true, rewards });
    } catch (err: unknown) {
      if (err instanceof LootBoxOpenError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('[BoxOpen] Error:', err);
      res.status(500).json({ error: 'Erro ao abrir caixa.' });
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

      const { newUsdc, boxName, trigger, price } = await prisma.$transaction(
        (tx) => executeLootBoxBuyInTransaction(tx, { userId, boxId }),
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

      res.json({ ok: true, newUsdc });
    } catch (err: unknown) {
      if (err instanceof LootBoxBuyError) {
        const body: { error: string; missing?: number } = { error: err.message };
        if (err.missing != null) body.missing = err.missing;
        res.status(err.statusCode).json(body);
        return;
      }
      console.error('[BoxBuy] Error:', err);
      res.status(500).json({ error: 'Erro ao comprar caixa.' });
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
      res.status(500).json({ error: 'Erro ao descartar caixa(s).' });
    }
  });
}

export function registerLootBoxAdminRoutes(app: Express, deps: LootBoxAdminDeps): void {
  const { isAdmin } = deps;

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
      sendInternalErrorSafeMessage(res, req.originalUrl || 'loot-box', e, 'Falha ao apagar caixa.');
    }
  });
}
