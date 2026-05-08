import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;

function qtyFromRow(value) {
  const n = parseInt(String(value ?? 1), 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function buildSummary(rows) {
  const byUser = new Map();
  const byUserItem = new Map();

  for (const row of rows) {
    const userId = Number(row.user_id);
    const itemId = String(row.item_id || '').trim();
    const qty = qtyFromRow(row.qty);

    const currentUser = byUser.get(userId) || { listings: 0, qty: 0 };
    currentUser.listings += 1;
    currentUser.qty += qty;
    byUser.set(userId, currentUser);

    const itemKey = `${userId}::${itemId}`;
    byUserItem.set(itemKey, (byUserItem.get(itemKey) || 0) + qty);
  }

  return { byUser, byUserItem };
}

async function main() {
  const databaseUrl = String(process.env.DATABASE_URL || '').trim();
  if (!databaseUrl) {
    console.error('Defina DATABASE_URL antes de executar o script.');
    process.exit(1);
  }

  const shouldExecute = process.argv.includes('--execute');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const rowsRes = await client.query(
      `SELECT id, user_id, item_id, qty, status, reserved_by, reserved_until, expires_at
         FROM player_listings
        WHERE status = 'active'
        ORDER BY user_id, item_id, id`
    );

    const rows = rowsRes.rows;
    const totalQty = rows.reduce((acc, row) => acc + qtyFromRow(row.qty), 0);
    const { byUser, byUserItem } = buildSummary(rows);

    console.log(
      JSON.stringify(
        {
          mode: shouldExecute ? 'execute' : 'dry-run',
          activeListings: rows.length,
          affectedUsers: byUser.size,
          totalQty
        },
        null,
        2
      )
    );

    if (rows.length > 0) {
      console.log(
        JSON.stringify(
          {
            sample: rows.slice(0, 10).map((row) => ({
              id: row.id,
              userId: Number(row.user_id),
              itemId: String(row.item_id || '').trim(),
              qty: qtyFromRow(row.qty),
              reservedBy: row.reserved_by,
              reservedUntil: row.reserved_until
            }))
          },
          null,
          2
        )
      );
    }

    if (!shouldExecute) {
      console.log('Dry-run concluído. Rode com --execute para cancelar e devolver os itens.');
      return;
    }

    await client.query('BEGIN');
    const lockRes = await client.query(
      `SELECT id, user_id, item_id, qty
         FROM player_listings
        WHERE status = 'active'
        ORDER BY user_id, item_id, id
        FOR UPDATE`
    );
    const lockedRows = lockRes.rows;

    if (lockedRows.length === 0) {
      await client.query('COMMIT');
      console.log('Nenhuma listagem ativa encontrada no momento da execução.');
      return;
    }

    const lockedSummary = buildSummary(lockedRows);
    const userIds = [...lockedSummary.byUser.keys()];
    const listingIds = lockedRows.map((row) => String(row.id));
    const bumpAt = Date.now();

    for (const [itemKey, qty] of lockedSummary.byUserItem.entries()) {
      const sep = itemKey.indexOf('::');
      const userId = Number(itemKey.slice(0, sep));
      const itemId = itemKey.slice(sep + 2);
      await client.query(
        `INSERT INTO stock (user_id, item_id, qty)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, item_id) DO UPDATE
         SET qty = stock.qty + EXCLUDED.qty`,
        [userId, itemId, qty]
      );
    }

    await client.query('DELETE FROM player_listings WHERE id = ANY($1::text[])', [listingIds]);
    await client.query(
      `UPDATE game_states
          SET server_updated_at = $1,
              last_updated_at = $1
        WHERE user_id = ANY($2::int[])`,
      [bumpAt, userIds]
    );
    await client.query('COMMIT');

    console.log(
      JSON.stringify(
        {
          cancelledListings: lockedRows.length,
          affectedUsers: userIds.length,
          returnedQty: lockedRows.reduce((acc, row) => acc + qtyFromRow(row.qty), 0)
        },
        null,
        2
      )
    );
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback failure
    }
    console.error('[cancel_all_p2p_listings] falhou:', error);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

await main();
