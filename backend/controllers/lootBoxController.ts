import type { Express, Request, RequestHandler, Response } from 'express';
import type { Pool, PoolClient } from 'pg';
import {
  rollLootBoxOnce,
  rollLootBoxGrantAll,
  parseLootBoxId,
  deleteLootBoxCascade,
  isLootBoxBrokenForSafeDelete
} from '../models/lootBoxModel.js';
import {
  assertEmailMatchesSession,
  bodyLootBoxId,
  bodyOptionalDiscardQty
} from '../validation/lootBoxValidation.js';

export type LootBoxAdminDeps = {
  pool: Pool;
  isAdmin: RequestHandler;
};

export type LootBoxPlayerDeps = {
  pool: Pool;
  grantAdminUpgradeRewards: (
    userId: number,
    upgradeId: string,
    client: PoolClient
  ) => Promise<unknown>;
  appendGameActivityLog: (
    q: Pool | PoolClient,
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
  const { pool, grantAdminUpgradeRewards, appendGameActivityLog } = deps;

  app.get('/api/loot-boxes', async (_req: Request, res: Response) => {
    try {
      const boxesRes = await pool.query(
        'SELECT * FROM loot_boxes ORDER BY COALESCE(is_active, 1) DESC, trigger ASC, name ASC, id ASC'
      );
      const boxIds = boxesRes.rows.map((r: { id: string }) => r.id);
      const itemsRes = boxIds.length
        ? await pool.query('SELECT * FROM loot_box_items WHERE box_id = ANY($1::text[])', [boxIds])
        : { rows: [] as Record<string, unknown>[] };
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
      for (const it of itemsRes.rows as Array<{
        box_id: string;
        item_id: string;
        item_type: string;
        min_qty: number;
        max_qty: number;
        probability: number;
      }>) {
        itemMap[it.box_id] = itemMap[it.box_id] || [];
        itemMap[it.box_id].push({
          id: it.item_id,
          type: it.item_type,
          minQty: it.min_qty,
          maxQty: it.max_qty,
          probability: it.probability
        });
      }
      const resp = boxesRes.rows.map(
        (b: {
          id: string;
          name: string;
          description: string;
          price: number;
          trigger: string;
          icon: string;
          is_active?: number;
        }) => ({
          id: b.id,
          name: b.name,
          description: b.description,
          price: b.price,
          trigger: b.trigger,
          icon: b.icon,
          isActive: b.is_active === undefined ? true : !!b.is_active,
          items: itemMap[b.id] || []
        })
      );
      res.json(resp);
    } catch (e: unknown) {
      res.status(500).json({ error: e instanceof Error ? e.message : 'Erro ao listar caixas.' });
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

    const client = await pool.connect();
    try {
      const emailGate = await assertEmailMatchesSession(
        client,
        userId,
        (req.body as { email?: unknown } | undefined)?.email
      );
      if (!emailGate.ok) {
        res.status(emailGate.status).json({ error: emailGate.error });
        return;
      }

      await client.query('BEGIN');

      const boxCountRes = await client.query(
        'SELECT qty FROM unopened_boxes WHERE user_id = $1 AND box_id = $2 FOR UPDATE',
        [userId, boxId]
      );
      const boxCount = boxCountRes.rows[0] as { qty: number } | undefined;
      if (!boxCount || boxCount.qty < 1) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'No boxes available' });
        return;
      }

      const boxDefRes = await client.query('SELECT * FROM loot_boxes WHERE id = $1', [boxId]);
      const boxDef = boxDefRes.rows[0] as { name: string; trigger?: string } | undefined;
      if (!boxDef) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Box definition not found' });
        return;
      }

      const itemsRes = await client.query('SELECT * FROM loot_box_items WHERE box_id = $1', [
        boxId
      ]);
      const items = itemsRes.rows;
      if (items.length === 0) {
        await client.query('ROLLBACK');
        console.error(
          `[LootBox] Critical Error: Box ${boxId} ("${boxDef.name}") has no items configured.`
        );
        res.status(500).json({ error: 'Configuração da caixa inválida (sem itens).' });
        return;
      }

      const isRegistrationBox = String(boxDef.trigger || '') === 'registration';
      const { rewards, gainedUsdc, gainedItems, gainedCoins, gainedBundles } = isRegistrationBox
        ? rollLootBoxGrantAll(items)
        : rollLootBoxOnce(items);

      if (boxCount.qty <= 1) {
        await client.query('DELETE FROM unopened_boxes WHERE user_id = $1 AND box_id = $2', [
          userId,
          boxId
        ]);
      } else {
        await client.query(
          'UPDATE unopened_boxes SET qty = qty - 1 WHERE user_id = $1 AND box_id = $2',
          [userId, boxId]
        );
      }

      if (gainedUsdc > 0) {
        await client.query(
          `UPDATE game_states
           SET usdc = COALESCE(usdc, 0) + $1,
               usdc_bonus = COALESCE(usdc_bonus, 0) + $1
           WHERE user_id = $2`,
          [gainedUsdc, userId]
        );
      }

      for (const [id, qty] of Object.entries(gainedItems)) {
        await client.query(
          'INSERT INTO stock (user_id, item_id, qty) VALUES ($1,$2,$3) ON CONFLICT(user_id, item_id) DO UPDATE SET qty = stock.qty + EXCLUDED.qty',
          [userId, id, qty]
        );
      }

      for (const [id, qty] of Object.entries(gainedCoins)) {
        await client.query(
          'INSERT INTO coin_balances (user_id, coin_id, amount) VALUES ($1,$2,$3) ON CONFLICT(user_id, coin_id) DO UPDATE SET amount = coin_balances.amount + EXCLUDED.amount',
          [userId, id, qty]
        );
      }

      for (const b of gainedBundles) {
        for (let i = 0; i < b.qty; i++) {
          await grantAdminUpgradeRewards(userId, b.id, client);
        }
      }

      await client.query('COMMIT');

      const unameRes = await pool.query('SELECT username FROM users WHERE id = $1', [userId]);
      const username = unameRes.rows[0]?.username || '';
      console.log(
        '[LootBoxOpen] ts=%s userId=%s username=%s boxId=%s boxName=%s rewards=%s gainedUsdc=%s',
        new Date().toISOString(),
        userId,
        username,
        boxId,
        boxDef.name,
        JSON.stringify(rewards),
        gainedUsdc
      );
      await appendGameActivityLog(pool, userId, 'loot_box_open', {
        boxId,
        boxName: boxDef.name,
        rewardCount: rewards.length,
        gainedUsdc,
        rewardsPreview: rewards.slice(0, 12)
      });

      res.json({ ok: true, rewards });
    } catch (err: unknown) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      console.error('[BoxOpen] Error:', err);
      res.status(500).json({ error: 'Erro ao abrir caixa.' });
    } finally {
      client.release();
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

    const client = await pool.connect();
    try {
      const emailGate = await assertEmailMatchesSession(
        client,
        userId,
        (req.body as { email?: unknown } | undefined)?.email
      );
      if (!emailGate.ok) {
        res.status(emailGate.status).json({ error: emailGate.error });
        return;
      }

      const boxRes = await client.query(
        'SELECT * FROM loot_boxes WHERE id = $1 AND COALESCE(is_active, 1) = 1',
        [boxId]
      );
      const box = boxRes.rows[0] as
        | { trigger: string; price: number | string; name: string }
        | undefined;
      if (!box) {
        res.status(404).json({ error: 'Box not found' });
        return;
      }
      if (box.trigger !== 'shop' && box.trigger !== 'shop_once' && box.trigger !== 'special') {
        res.status(400).json({ error: 'Box not for sale' });
        return;
      }

      const price = Number(box.price);
      if (!Number.isFinite(price) || price <= 0 || price > 1e12) {
        res.status(400).json({ error: 'Preço da caixa inválido ou não configurado para venda.' });
        return;
      }

      await client.query('BEGIN');

      if (box.trigger === 'shop_once') {
        try {
          await client.query(
            'INSERT INTO player_claimed_boxes (user_id, box_id, claimed_at) VALUES ($1, $2, $3)',
            [userId, boxId, Date.now()]
          );
        } catch (insErr: unknown) {
          const code = insErr && typeof insErr === 'object' && 'code' in insErr ? (insErr as { code?: string }).code : '';
          if (code === '23505') {
            await client.query('ROLLBACK');
            res.status(400).json({ error: 'Already purchased' });
            return;
          }
          throw insErr;
        }
      }

      const gsRes = await client.query(
        'SELECT usdc FROM game_states WHERE user_id = $1 FOR UPDATE',
        [userId]
      );
      const gs = gsRes.rows[0] as { usdc?: number } | undefined;
      const bal = Number(gs?.usdc) || 0;
      if (bal < price) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'Insufficient funds' });
        return;
      }

      const payRes = await client.query(
        'UPDATE game_states SET usdc = usdc - $1, last_updated_at = $2, server_updated_at = $2 WHERE user_id = $3 AND usdc >= $1 RETURNING usdc',
        [price, Date.now(), userId]
      );
      if (payRes.rowCount === 0) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'Insufficient funds' });
        return;
      }

      await client.query(
        `INSERT INTO unopened_boxes (user_id, box_id, qty) VALUES ($1, $2, 1)
         ON CONFLICT (user_id, box_id) DO UPDATE SET qty = unopened_boxes.qty + 1`,
        [userId, boxId]
      );

      await client.query('COMMIT');

      const newUsdc = (payRes.rows[0] as { usdc: number }).usdc;
      const unameRes = await pool.query('SELECT username FROM users WHERE id = $1', [userId]);
      const username = unameRes.rows[0]?.username || '';
      console.log(
        '[LootBoxBuy] ts=%s userId=%s username=%s boxId=%s boxName=%s priceUsdc=%s newUsdc=%s trigger=%s',
        new Date().toISOString(),
        userId,
        username,
        boxId,
        box.name,
        price.toFixed(6),
        Number(newUsdc).toFixed(6),
        box.trigger
      );
      await appendGameActivityLog(pool, userId, 'loot_box_buy', {
        boxId,
        boxName: box.name,
        priceUsdc: Number(price.toFixed(6)),
        newUsdc: Number(Number(newUsdc).toFixed(6)),
        trigger: box.trigger
      });

      res.json({ ok: true, newUsdc });
    } catch (err: unknown) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      console.error('[BoxBuy] Error:', err);
      res.status(500).json({ error: 'Erro ao comprar caixa.' });
    } finally {
      client.release();
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

    const client = await pool.connect();
    try {
      const emailGate = await assertEmailMatchesSession(
        client,
        userId,
        (req.body as { email?: unknown } | undefined)?.email
      );
      if (!emailGate.ok) {
        res.status(emailGate.status).json({ error: emailGate.error });
        return;
      }

      await client.query('BEGIN');

      const boxCountRes = await client.query(
        'SELECT qty FROM unopened_boxes WHERE user_id = $1 AND box_id = $2 FOR UPDATE',
        [userId, boxId]
      );
      const boxCount = boxCountRes.rows[0] as { qty: number } | undefined;
      const owned = boxCount?.qty ?? 0;
      if (!boxCount || owned < 1) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'Não tens caixas deste tipo no inventário.' });
        return;
      }

      const toRemove = qtySpec === 'all' ? owned : Math.min(qtySpec, owned);
      if (toRemove < 1) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'Quantidade inválida.' });
        return;
      }

      if (owned <= toRemove) {
        await client.query('DELETE FROM unopened_boxes WHERE user_id = $1 AND box_id = $2', [
          userId,
          boxId
        ]);
      } else {
        await client.query(
          'UPDATE unopened_boxes SET qty = qty - $1 WHERE user_id = $2 AND box_id = $3',
          [toRemove, userId, boxId]
        );
      }

      await client.query('COMMIT');

      const remaining = owned - toRemove;
      const boxNameRes = await pool.query('SELECT name FROM loot_boxes WHERE id = $1', [boxId]);
      const boxName = (boxNameRes.rows[0] as { name?: string } | undefined)?.name || boxId;
      const unameRes = await pool.query('SELECT username FROM users WHERE id = $1', [userId]);
      const username = unameRes.rows[0]?.username || '';
      console.log(
        '[LootBoxDiscard] ts=%s userId=%s username=%s boxId=%s discardedQty=%s remaining=%s',
        new Date().toISOString(),
        userId,
        username,
        boxId,
        toRemove,
        remaining
      );
      await appendGameActivityLog(pool, userId, 'loot_box_discard', {
        boxId,
        boxName,
        discardedQty: toRemove,
        remainingQty: remaining
      });

      res.json({ ok: true, discardedQty: toRemove, remainingQty: remaining });
    } catch (err: unknown) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      console.error('[BoxDiscard] Error:', err);
      res.status(500).json({ error: 'Erro ao descartar caixa(s).' });
    } finally {
      client.release();
    }
  });
}

export function registerLootBoxAdminRoutes(app: Express, deps: LootBoxAdminDeps): void {
  const { pool, isAdmin } = deps;

  app.delete('/api/admin/loot-boxes/:boxId', isAdmin, async (req: Request, res: Response) => {
    const boxId = parseLootBoxId(req.params.boxId);
    if (!boxId) {
      res.status(400).json({ error: 'ID da caixa inválido.' });
      return;
    }

    const q = req.query.brokenOnly;
    const brokenOnly =
      q === '1' || q === 'true' || q === 'yes' || String(q).toLowerCase() === 'on';

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const exists = await client.query('SELECT id, name FROM loot_boxes WHERE id = $1', [boxId]);
      if (exists.rowCount === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Caixa não encontrada.' });
        return;
      }
      const boxName = (exists.rows[0] as { name: string }).name;

      if (brokenOnly) {
        const broken = await isLootBoxBrokenForSafeDelete(client, boxId);
        if (!broken) {
          await client.query('ROLLBACK');
          res.status(409).json({
            error:
              'A caixa ainda tem itens com probabilidade > 0. Remova brokenOnly=1 para apagar à força, ou zere as probabilidades no editor.'
          });
          return;
        }
      }

      const summary = await deleteLootBoxCascade(client, boxId);
      await client.query('COMMIT');

      console.log('[LootBoxAdminDelete]', {
        boxId,
        boxName,
        brokenOnly,
        ...summary
      });

      res.json({ ok: true, summary });
    } catch (e: unknown) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      console.error('[LootBoxAdminDelete] Error:', e);
      res.status(500).json({ error: e instanceof Error ? e.message : 'Falha ao apagar caixa.' });
    } finally {
      client.release();
    }
  });
}
