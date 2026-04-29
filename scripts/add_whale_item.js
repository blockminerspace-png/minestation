
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Importing db works if run from scripts folder and dependencies are resolved from root or if we are lucky with resolution.
// Assuming db.js relies on db.pg.js which has hardcoded fallbacks.
import db from '../backend/db.js';

const addWhaleItem = async () => {
    try {
        console.log('Connecting to DB...');
        // Item Definition
        const whaleItem = {
            id: 'lucky_whale_statue',
            name: 'Estátua da Baleia',
            category: 'multiplier',
            type: 'multiplier',
            base_cost: 5000,
            base_production: 0,
            power_consumption: 0,
            power_capacity: 0,
            multiplier: 0.05, // 5% bonus
            slots_capacity: 0,
            ai_slots_capacity: 0,
            description: 'Uma estátua rara de uma baleia sortuda. Aumenta a produção em 5%.',
            icon: '/img/items/whale.png', // URL for the image
            status: 'limited',
            is_nft: 0,
            max_global_stock: 100,
            image: '/img/items/whale.png',
            reward_wh: 0,
            layout: '',
            sell_in_hardware_market: 1,
            sell_in_black_market: 1,
            is_active: 1
        };

        console.log('Inserting Item:', whaleItem.name);
        await db.query(`
      INSERT INTO upgrades (
        id, name, category, type, base_cost, base_production, power_consumption, power_capacity, 
        multiplier, slots_capacity, ai_slots_capacity, description, icon, status, is_nft, 
        max_global_stock, image, reward_wh, layout, sell_in_hardware_market, sell_in_black_market, is_active
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
      ON CONFLICT (id) DO UPDATE SET 
        icon = EXCLUDED.icon,
        image = EXCLUDED.image,
        description = EXCLUDED.description,
        multiplier = EXCLUDED.multiplier
    `, [
            whaleItem.id, whaleItem.name, whaleItem.category, whaleItem.type, whaleItem.base_cost, whaleItem.base_production,
            whaleItem.power_consumption, whaleItem.power_capacity, whaleItem.multiplier, whaleItem.slots_capacity,
            whaleItem.ai_slots_capacity, whaleItem.description, whaleItem.icon, whaleItem.status, whaleItem.is_nft,
            whaleItem.max_global_stock, whaleItem.image, whaleItem.reward_wh, whaleItem.layout,
            whaleItem.sell_in_hardware_market, whaleItem.sell_in_black_market, whaleItem.is_active
        ]);

        // Box Definition
        const whaleBox = {
            id: 'box_whale_special',
            name: 'Caixa da Baleia',
            description: 'Pode conter a lendária Estátua da Baleia.',
            price: 500,
            trigger: 'shop',
            icon: '/img/items/whale.png' // Utilizing the same image for the box icon
        };

        console.log('Inserting Box:', whaleBox.name);
        await db.query(`
      INSERT INTO loot_boxes (id, name, description, price, trigger, icon)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO UPDATE SET
        icon = EXCLUDED.icon,
        name = EXCLUDED.name,
        price = EXCLUDED.price
    `, [whaleBox.id, whaleBox.name, whaleBox.description, whaleBox.price, whaleBox.trigger, whaleBox.icon]);

        // Box Items
        console.log('Inserting Box Items...');
        // Clear existing items for this box to avoid dups on re-run
        await db.query('DELETE FROM loot_box_items WHERE box_id = $1', [whaleBox.id]);

        const items = [
            { type: 'item', item_id: 'lucky_whale_statue', min_qty: 1, max_qty: 1, probability: 10 }, // 10% chance
            { type: 'currency', item_id: 'usdc', min_qty: 100, max_qty: 500, probability: 40 },
            { type: 'item', item_id: 'small_battery', min_qty: 1, max_qty: 5, probability: 50 }
        ];

        for (const item of items) {
            await db.query(`
        INSERT INTO loot_box_items (box_id, item_type, item_id, min_qty, max_qty, probability)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [whaleBox.id, item.type, item.item_id, item.min_qty, item.max_qty, item.probability]);
        }

        console.log('Success! Whale Item and Box added.');
        process.exit(0);

    } catch (e) {
        console.error('Error adding whale item:', e);
        process.exit(1);
    }
};

addWhaleItem();
