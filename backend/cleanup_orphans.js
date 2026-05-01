
import pool from './db.js';

async function cleanupOrphans() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('--- Iniciando limpeza de máquinas e itens órfãos ---');

    // 1. Racks órfãos: Racks que referenciam uma sala que o usuário não possui mais
    // Ou racks de usuários que não existem
    const orphanRacksResult = await client.query(`
      SELECT pr.id, pr.user_id, pr.item_id, pr.room_id
      FROM placed_racks pr
      LEFT JOIN user_rig_rooms urr ON pr.user_id = urr.user_id AND pr.room_id = urr.room_id
      LEFT JOIN users u ON pr.user_id = u.id
      WHERE urr.user_id IS NULL OR u.id IS NULL
    `);

    console.log(`Encontrados ${orphanRacksResult.rows.length} racks órfãos.`);

    for (const rack of orphanRacksResult.rows) {
      console.log(`Processando rack órfão ${rack.id} do usuário ${rack.user_id}...`);

      // Se o usuário ainda existe, devolvemos os itens para o stock
      const userExistsResult = await client.query('SELECT id FROM users WHERE id = $1', [rack.user_id]);
      const userExists = userExistsResult.rows.length > 0;

      if (userExists) {
        // Devolve o rack para o stock
        await client.query(`
          INSERT INTO stock (user_id, item_id, qty)
          VALUES ($1, $2, 1)
          ON CONFLICT (user_id, item_id)
          DO UPDATE SET qty = stock.qty + 1
        `, [rack.user_id, rack.item_id]);
        console.log(`  Rack ${rack.item_id} devolvido ao stock do usuário ${rack.user_id}.`);

        // Busca máquinas e multiplicadores no rack para devolver
        const slotsResult = await client.query('SELECT machine_item_id FROM rack_slots WHERE rack_id = $1 AND machine_item_id IS NOT NULL', [rack.id]);
        for (const slot of slotsResult.rows) {
          await client.query(`
            INSERT INTO stock (user_id, item_id, qty)
            VALUES ($1, $2, 1)
            ON CONFLICT (user_id, item_id)
            DO UPDATE SET qty = stock.qty + 1
          `, [rack.user_id, slot.machine_item_id]);
          console.log(`  Máquina ${slot.machine_item_id} devolvida ao stock.`);
        }

        const multsResult = await client.query('SELECT multiplier_item_id FROM rack_multiplier_slots WHERE rack_id = $1 AND multiplier_item_id IS NOT NULL', [rack.id]);
        for (const mult of multsResult.rows) {
          await client.query(`
            INSERT INTO stock (user_id, item_id, qty)
            VALUES ($1, $2, 1)
            ON CONFLICT (user_id, item_id)
            DO UPDATE SET qty = stock.qty + 1
          `, [rack.user_id, mult.multiplier_item_id]);
          console.log(`  Multiplicador ${mult.multiplier_item_id} devolvido ao stock.`);
        }
      } else {
        console.log(`  Usuário ${rack.user_id} não existe. Itens serão apenas deletados.`);
      }

      // Deleta slots e o rack
      await client.query('DELETE FROM rack_slots WHERE rack_id = $1', [rack.id]);
      await client.query('DELETE FROM rack_multiplier_slots WHERE rack_id = $1', [rack.id]);
      await client.query('DELETE FROM placed_racks WHERE id = $1', [rack.id]);
    }

    // 2. Baterias órfãs: Baterias de usuários que não existem
    const orphanBatteriesResult = await client.query(`
      SELECT sb.id, sb.user_id, sb.item_id
      FROM stored_batteries sb
      LEFT JOIN users u ON sb.user_id = u.id
      WHERE u.id IS NULL
    `);
    console.log(`Encontradas ${orphanBatteriesResult.rows.length} baterias de usuários inexistentes. Deletando...`);
    await client.query(`
      DELETE FROM stored_batteries
      WHERE user_id NOT IN (SELECT id FROM users)
    `);

    // 3. Salas órfãs: Salas de usuários que não existem
    await client.query(`
      DELETE FROM user_rig_rooms
      WHERE user_id NOT IN (SELECT id FROM users)
    `);

    // 4. Workshop slots órfãos
    await client.query(`
      DELETE FROM workshop_slots
      WHERE user_id NOT IN (SELECT id FROM users)
    `);

    await client.query('COMMIT');
    console.log('--- Limpeza concluída com sucesso ---');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Erro durante a limpeza:', e);
  } finally {
    client.release();
    pool.end();
  }
}

cleanupOrphans();
