<<<<<<< Updated upstream
import pool from './db.js';

export const initDb = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');


    // Create tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT,
        is_admin INTEGER DEFAULT 0,
        polygon_wallet TEXT,
        is_blocked INTEGER DEFAULT 0,
        access_level_id TEXT,
        referral_code TEXT,
        referred_by TEXT,
        last_active_at BIGINT,
        ranking_excluded INTEGER DEFAULT 0,
        registration_ip TEXT
      );

      CREATE TABLE IF NOT EXISTS user_access_levels (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        access_level_id TEXT NOT NULL,
        granted_at BIGINT NOT NULL,
        PRIMARY KEY (user_id, access_level_id)
      );

      CREATE TABLE IF NOT EXISTS referrals (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        referred_username TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS mining_coins (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        symbol TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        network_hashrate DOUBLE PRECISION DEFAULT 0,
        block_reward DOUBLE PRECISION DEFAULT 0,
        block_time DOUBLE PRECISION DEFAULT 60,
        price_usd DOUBLE PRECISION DEFAULT 0,
        algorithm TEXT DEFAULT '',
        difficulty DOUBLE PRECISION DEFAULT 1,
        multiplier DOUBLE PRECISION DEFAULT 1,
        color TEXT DEFAULT '#ffffff',
        min_proportion DOUBLE PRECISION NOT NULL DEFAULT 0,
        usdc_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        target_daily_usd DOUBLE PRECISION DEFAULT 0,
        show_in_exchange INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS access_levels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        is_default INTEGER NOT NULL,
        is_active INTEGER NOT NULL,
        price_usdc DOUBLE PRECISION,
        contract_address TEXT,
        inactive_message TEXT,
        news_posting_enabled INTEGER DEFAULT 0,
        allowed_pages TEXT
      );

      CREATE TABLE IF NOT EXISTS upgrades (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        type TEXT NOT NULL,
        base_cost DOUBLE PRECISION NOT NULL,
        base_production DOUBLE PRECISION NOT NULL,
        power_consumption DOUBLE PRECISION,
        power_capacity DOUBLE PRECISION,
        multiplier DOUBLE PRECISION,
        slots_capacity INTEGER,
        ai_slots_capacity INTEGER,
        description TEXT NOT NULL,
        icon TEXT NOT NULL,
        status TEXT NOT NULL,
        is_nft INTEGER NOT NULL,
        nft_contract TEXT,
        nft_token_id TEXT,
        max_global_stock INTEGER,
        image TEXT,
        reward_wh DOUBLE PRECISION DEFAULT 0,
        layout TEXT,
        sell_in_hardware_market INTEGER DEFAULT 1,
        sell_in_black_market INTEGER DEFAULT 1,
        is_active INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS upgrade_compat_racks (
        upgrade_id TEXT NOT NULL REFERENCES upgrades(id),
        rack_id TEXT NOT NULL,
        PRIMARY KEY (upgrade_id, rack_id)
      );

      CREATE TABLE IF NOT EXISTS loot_boxes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        price DOUBLE PRECISION NOT NULL,
        trigger TEXT NOT NULL,
        icon TEXT NOT NULL,
        is_active INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS loot_box_items (
        id SERIAL PRIMARY KEY,
        box_id TEXT NOT NULL REFERENCES loot_boxes(id),
        item_type TEXT NOT NULL,
        item_id TEXT NOT NULL,
        min_qty INTEGER NOT NULL,
        max_qty INTEGER NOT NULL,
        probability DOUBLE PRECISION NOT NULL
      );

      CREATE TABLE IF NOT EXISTS system_news (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        link TEXT,
        active INTEGER NOT NULL,
        duration INTEGER,
        author_name TEXT,
        created_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS season_passes (
        id TEXT PRIMARY KEY,
        season_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        price_usdc DOUBLE PRECISION NOT NULL,
        emblem_url TEXT,
        is_active INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS season_purchases (
        user_id INTEGER NOT NULL REFERENCES users(id),
        pass_id TEXT NOT NULL REFERENCES season_passes(id),
        season_id TEXT NOT NULL,
        purchased_at BIGINT NOT NULL,
        PRIMARY KEY (user_id, pass_id)
      );

      CREATE TABLE IF NOT EXISTS game_states (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
        usdc DOUBLE PRECISION DEFAULT 0 NOT NULL,
        start_time BIGINT NOT NULL,
        claimed_referrals INTEGER NOT NULL,
        referral_bonus_claimed INTEGER NOT NULL,
        last_updated_at BIGINT,
        total_usdc_deposited DOUBLE PRECISION,
        total_crypto_withdrawn DOUBLE PRECISION,
        black_market_balance DOUBLE PRECISION DEFAULT 0,
        server_updated_at BIGINT DEFAULT 0,
        usdc_bonus DOUBLE PRECISION DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS stock (
        user_id INTEGER NOT NULL REFERENCES users(id),
        item_id TEXT NOT NULL,
        qty INTEGER NOT NULL,
        PRIMARY KEY (user_id, item_id)
      );

      CREATE TABLE IF NOT EXISTS unopened_boxes (
        user_id INTEGER NOT NULL REFERENCES users(id),
        box_id TEXT NOT NULL,
        qty INTEGER NOT NULL,
        PRIMARY KEY (user_id, box_id)
      );

      CREATE TABLE IF NOT EXISTS stored_batteries (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        item_id TEXT NOT NULL,
        current_charge DOUBLE PRECISION NOT NULL
      );

      CREATE TABLE IF NOT EXISTS placed_racks (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        item_id TEXT NOT NULL,
        wiring_id TEXT,
        battery_id TEXT,
        current_charge DOUBLE PRECISION NOT NULL,
        is_on INTEGER NOT NULL,
        selected_coin_id TEXT,
        room_id TEXT,
        slot_index INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS rack_slots (
        rack_id TEXT NOT NULL REFERENCES placed_racks(id),
        slot_index INTEGER NOT NULL,
        machine_item_id TEXT,
        PRIMARY KEY (rack_id, slot_index)
      );

      CREATE TABLE IF NOT EXISTS rack_multiplier_slots (
        rack_id TEXT NOT NULL REFERENCES placed_racks(id),
        slot_index INTEGER NOT NULL,
        multiplier_item_id TEXT,
        PRIMARY KEY (rack_id, slot_index)
      );

      CREATE TABLE IF NOT EXISTS player_listings (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        item_id TEXT NOT NULL,
        price DOUBLE PRECISION NOT NULL,
        expires_at BIGINT NOT NULL,
        is_player INTEGER,
        reserved_by INTEGER,
        reserved_until BIGINT,
        qty INTEGER DEFAULT 1,
        status TEXT DEFAULT 'active'
      );

      CREATE TABLE IF NOT EXISTS nft_items (
        contract_address TEXT NOT NULL,
        token_id TEXT NOT NULL,
        owner_address TEXT NOT NULL,
        metadata TEXT,
        PRIMARY KEY (contract_address, token_id)
      );

      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL,
        original_user_id INTEGER DEFAULT NULL,
        last_seen_at BIGINT NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS coin_balances (
        user_id INTEGER NOT NULL REFERENCES users(id),
        coin_id TEXT NOT NULL,
        amount DOUBLE PRECISION NOT NULL,
        PRIMARY KEY (user_id, coin_id)
      );

      CREATE TABLE IF NOT EXISTS coin_withdrawals (
        user_id INTEGER NOT NULL REFERENCES users(id),
        coin_id TEXT NOT NULL,
        total_withdrawn DOUBLE PRECISION NOT NULL,
        PRIMARY KEY (user_id, coin_id)
      );

      CREATE TABLE IF NOT EXISTS admin_upgrades (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        price_usdc DOUBLE PRECISION NOT NULL,
        grant_usdc DOUBLE PRECISION DEFAULT 0,
        grant_access_level_id TEXT,
        is_active INTEGER NOT NULL,
        created_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS admin_upgrade_items (
        upgrade_id TEXT NOT NULL REFERENCES admin_upgrades(id),
        item_id TEXT NOT NULL,
        qty INTEGER NOT NULL,
        PRIMARY KEY (upgrade_id, item_id)
      );

      CREATE TABLE IF NOT EXISTS admin_upgrade_boxes (
        upgrade_id TEXT NOT NULL REFERENCES admin_upgrades(id),
        box_id TEXT NOT NULL,
        qty INTEGER NOT NULL,
        PRIMARY KEY (upgrade_id, box_id)
      );

      CREATE TABLE IF NOT EXISTS admin_upgrade_passes (
        upgrade_id TEXT NOT NULL REFERENCES admin_upgrades(id),
        pass_id TEXT NOT NULL,
        PRIMARY KEY (upgrade_id, pass_id)
      );

      CREATE TABLE IF NOT EXISTS admin_upgrade_coins (
        upgrade_id TEXT NOT NULL REFERENCES admin_upgrades(id),
        coin_id TEXT NOT NULL,
        amount DOUBLE PRECISION NOT NULL,
        PRIMARY KEY (upgrade_id, coin_id)
      );

      CREATE TABLE IF NOT EXISTS season_pass_rewards (
        id SERIAL PRIMARY KEY,
        pass_id TEXT NOT NULL REFERENCES season_passes(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        item_id TEXT,
        coin_id TEXT,
        qty DOUBLE PRECISION NOT NULL
      );

      CREATE TABLE IF NOT EXISTS admin_upgrade_purchases (
        user_id INTEGER NOT NULL REFERENCES users(id),
        upgrade_id TEXT NOT NULL REFERENCES admin_upgrades(id),
        purchased_at BIGINT NOT NULL,
        PRIMARY KEY (user_id, upgrade_id)
      );

      CREATE TABLE IF NOT EXISTS admin_upgrade_visibility (
        upgrade_id TEXT NOT NULL REFERENCES admin_upgrades(id) ON DELETE CASCADE,
        access_level_id TEXT NOT NULL,
        PRIMARY KEY (upgrade_id, access_level_id)
      );

      CREATE TABLE IF NOT EXISTS player_news_submissions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        text TEXT NOT NULL,
        link TEXT,
        status TEXT NOT NULL,
        created_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rig_rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        initial_capacity INTEGER NOT NULL,
        max_capacity INTEGER NOT NULL,
        base_slot_price DOUBLE PRECISION NOT NULL,
        slot_price_increase_percent DOUBLE PRECISION NOT NULL,
        allowed_levels TEXT,
        allowed_season_pass_ids TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS user_rig_rooms (
        user_id INTEGER NOT NULL REFERENCES users(id),
        room_id TEXT NOT NULL REFERENCES rig_rooms(id),
        purchased_at BIGINT NOT NULL,
        unlocked_slots INTEGER DEFAULT 0,
        PRIMARY KEY (user_id, room_id)
      );

      CREATE TABLE IF NOT EXISTS workshop_slots (
        user_id INTEGER NOT NULL REFERENCES users(id),
        slot_index INTEGER NOT NULL,
        item_id TEXT,
        internal_state TEXT,
        current_charge DOUBLE PRECISION DEFAULT 0,
        slot_charges TEXT,
        slot_item_ids TEXT,
        PRIMARY KEY (user_id, slot_index)
      );

      CREATE TABLE IF NOT EXISTS player_claimed_boxes (
        user_id INTEGER NOT NULL REFERENCES users(id),
        box_id TEXT NOT NULL,
        claimed_at BIGINT NOT NULL,
        PRIMARY KEY (user_id, box_id)
      );

      CREATE TABLE IF NOT EXISTS daily_actions (
        user_id INTEGER NOT NULL REFERENCES users(id),
        action_key TEXT NOT NULL,
        last_performed_at BIGINT NOT NULL,
        PRIMARY KEY (user_id, action_key)
      );

      CREATE TABLE IF NOT EXISTS promo_codes (
        code TEXT PRIMARY KEY,
        loot_box_id TEXT,
        upgrade_id TEXT,
        admin_upgrade_id TEXT,
        type TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        created_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS promo_code_redemptions (
        code TEXT NOT NULL REFERENCES promo_codes(code),
        user_id INTEGER NOT NULL REFERENCES users(id),
        redeemed_at BIGINT NOT NULL,
        reward_granted INTEGER DEFAULT 1,
        PRIMARY KEY (code, user_id)
      );

      CREATE TABLE IF NOT EXISTS mining_yield_history (
        id SERIAL PRIMARY KEY,
        coin_id TEXT NOT NULL,
        yield_per_hash DOUBLE PRECISION NOT NULL,
        block_reward DOUBLE PRECISION NOT NULL DEFAULT 0,
        network_hashrate DOUBLE PRECISION NOT NULL DEFAULT 0,
        effective_at BIGINT NOT NULL
      );


      CREATE TABLE IF NOT EXISTS economy_settings (
        id INTEGER PRIMARY KEY,
        black_market_enabled INTEGER,
        hardware_market_enabled INTEGER,
        market_tax_percent DOUBLE PRECISION
      );

      CREATE TABLE IF NOT EXISTS withdrawal_requests (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        coin_id TEXT NOT NULL,
        amount_crypto DOUBLE PRECISION NOT NULL,
        amount_usdc DOUBLE PRECISION,
        fee_amount DOUBLE PRECISION DEFAULT 0,
        net_amount DOUBLE PRECISION DEFAULT 0,
        tx_hash TEXT,
        wallet_address TEXT,
        status TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        processed_at BIGINT
      );

      -- Migration for existing tables
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='promo_codes' AND column_name='upgrade_id') THEN
          ALTER TABLE promo_codes ADD COLUMN upgrade_id TEXT;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='promo_codes' AND column_name='admin_upgrade_id') THEN
          ALTER TABLE promo_codes ADD COLUMN admin_upgrade_id TEXT;
        END IF;

        ALTER TABLE promo_codes ALTER COLUMN loot_box_id DROP NOT NULL;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='promo_code_redemptions' AND column_name='reward_granted') THEN
          ALTER TABLE promo_code_redemptions ADD COLUMN reward_granted INTEGER DEFAULT 1;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='promo_code_redemptions' AND column_name='won_item_id') THEN
          ALTER TABLE promo_code_redemptions ADD COLUMN won_item_id TEXT;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='upgrades' AND column_name='is_active') THEN
          ALTER TABLE upgrades ADD COLUMN is_active INTEGER DEFAULT 1;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loot_boxes' AND column_name='is_active') THEN
          ALTER TABLE loot_boxes ADD COLUMN is_active INTEGER DEFAULT 1;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='ranking_excluded') THEN
          ALTER TABLE users ADD COLUMN ranking_excluded INTEGER DEFAULT 0;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='registration_ip') THEN
          ALTER TABLE users ADD COLUMN registration_ip TEXT;
        END IF;

        -- Migration for mining_yield_history
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mining_yield_history' AND column_name='block_reward') THEN
          ALTER TABLE mining_yield_history ADD COLUMN block_reward DOUBLE PRECISION DEFAULT 0;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mining_yield_history' AND column_name='network_hashrate') THEN
          ALTER TABLE mining_yield_history ADD COLUMN network_hashrate DOUBLE PRECISION DEFAULT 0;
        END IF;
        -- Migration for withdrawal_requests (fees)
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='withdrawal_requests' AND column_name='fee_amount') THEN
          ALTER TABLE withdrawal_requests ADD COLUMN fee_amount DOUBLE PRECISION DEFAULT 0;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='withdrawal_requests' AND column_name='net_amount') THEN
          ALTER TABLE withdrawal_requests ADD COLUMN net_amount DOUBLE PRECISION DEFAULT 0;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='withdrawal_requests' AND column_name='tx_hash') THEN
          ALTER TABLE withdrawal_requests ADD COLUMN tx_hash TEXT;
        END IF;

      END $$;


      CREATE TABLE IF NOT EXISTS wheel_prizes (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        weight INTEGER NOT NULL,
        color TEXT NOT NULL,
        item_id TEXT
      );

      CREATE TABLE IF NOT EXISTS wheel_players (
        username TEXT PRIMARY KEY,
        added_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS wallet_labels (
        address TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        updated_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS referral_models (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        sender_reward_usdc DOUBLE PRECISION DEFAULT 0,
        receiver_reward_usdc DOUBLE PRECISION DEFAULT 0,
        sender_loot_box_id TEXT,
        receiver_loot_box_id TEXT,
        deposit_commission_percent DOUBLE PRECISION DEFAULT 0,
        hardware_commission_percent DOUBLE PRECISION DEFAULT 0,
        black_market_commission_percent DOUBLE PRECISION DEFAULT 0,
        is_active INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS access_level_referral_models (
        access_level_id TEXT PRIMARY KEY REFERENCES access_levels(id),
        referral_model_id INTEGER REFERENCES referral_models(id)
      );
    `);

    // Create Indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_game_states_user_id ON game_states(user_id);
      CREATE TABLE IF NOT EXISTS user_history_ips (
        user_id INTEGER NOT NULL REFERENCES users(id),
        ip TEXT NOT NULL,
        last_used_at BIGINT NOT NULL,
        PRIMARY KEY (user_id, ip)
      );
      CREATE INDEX IF NOT EXISTS idx_user_history_ips_user_id ON user_history_ips(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_history_ips_ip ON user_history_ips(ip);
      CREATE INDEX IF NOT EXISTS idx_stock_user_id ON stock(user_id);
      CREATE INDEX IF NOT EXISTS idx_unopened_boxes_user_id ON unopened_boxes(user_id);
      CREATE INDEX IF NOT EXISTS idx_stored_batteries_user_id ON stored_batteries(user_id);
      CREATE INDEX IF NOT EXISTS idx_placed_racks_user_id ON placed_racks(user_id);
      CREATE INDEX IF NOT EXISTS idx_player_listings_user_id ON player_listings(user_id);
      CREATE INDEX IF NOT EXISTS idx_nft_items_owner ON nft_items(owner_address);
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_coin_balances_user_id ON coin_balances(user_id);
      CREATE INDEX IF NOT EXISTS idx_coin_withdrawals_user_id ON coin_withdrawals(user_id);
      CREATE INDEX IF NOT EXISTS idx_admin_upgrade_purchases_user_id ON admin_upgrade_purchases(user_id);
      CREATE INDEX IF NOT EXISTS idx_system_news_created_at ON system_news(created_at);
      CREATE INDEX IF NOT EXISTS idx_referrals_user_id ON referrals(user_id);
      CREATE INDEX IF NOT EXISTS idx_loot_box_items_box_id ON loot_box_items(box_id);
      CREATE INDEX IF NOT EXISTS idx_upgrade_compat_racks_upgrade_id ON upgrade_compat_racks(upgrade_id);
      CREATE INDEX IF NOT EXISTS idx_season_purchases_user_id ON season_purchases(user_id);
      CREATE INDEX IF NOT EXISTS idx_season_purchases_season_id ON season_purchases(season_id);
      CREATE INDEX IF NOT EXISTS idx_season_purchases_season_id ON season_purchases(season_id);
      CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_user ON withdrawal_requests(user_id);
      CREATE INDEX IF NOT EXISTS idx_mining_yield_history_coin_id ON mining_yield_history(coin_id);
      CREATE INDEX IF NOT EXISTS idx_mining_yield_history_effective_at ON mining_yield_history(effective_at);
      CREATE INDEX IF NOT EXISTS idx_rack_slots_rack_id ON rack_slots(rack_id);
      CREATE INDEX IF NOT EXISTS idx_rack_multiplier_slots_rack_id ON rack_multiplier_slots(rack_id);
      CREATE INDEX IF NOT EXISTS idx_workshop_slots_user_id ON workshop_slots(user_id);
      CREATE INDEX IF NOT EXISTS idx_promo_code_redemptions_code_user ON promo_code_redemptions(code, user_id);
    `);

    // Migration for new commission columns
    await client.query(`
      ALTER TABLE referral_models ADD COLUMN IF NOT EXISTS deposit_commission_percent DOUBLE PRECISION DEFAULT 0;
      ALTER TABLE referral_models ADD COLUMN IF NOT EXISTS hardware_commission_percent DOUBLE PRECISION DEFAULT 0;
      ALTER TABLE referral_models ADD COLUMN IF NOT EXISTS black_market_commission_percent DOUBLE PRECISION DEFAULT 0;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ip_blacklist (

        ip TEXT PRIMARY KEY,
        reason TEXT,
        added_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS admin_access_logs (
        id SERIAL PRIMARY KEY,
        ip TEXT NOT NULL,
        attempted_url TEXT NOT NULL,
        user_agent TEXT,
        details TEXT,
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_admin_access_logs_ip ON admin_access_logs(ip);
      CREATE INDEX IF NOT EXISTS idx_admin_access_logs_created_at ON admin_access_logs(created_at);

      CREATE TABLE IF NOT EXISTS game_activity_logs (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        meta JSONB,
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_game_activity_logs_user_created ON game_activity_logs(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS jwt_refresh_tokens (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL,
        family_id TEXT NOT NULL,
        expires_at BIGINT NOT NULL,
        created_at BIGINT NOT NULL,
        revoked_at BIGINT,
        user_agent TEXT,
        ip TEXT,
        UNIQUE(token_hash)
      );
      CREATE INDEX IF NOT EXISTS idx_jwt_refresh_user ON jwt_refresh_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_jwt_refresh_family ON jwt_refresh_tokens(family_id);
    `);

    await client.query(`
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_seen_at BIGINT NOT NULL DEFAULT 0;
      UPDATE sessions SET last_seen_at = created_at WHERE last_seen_at = 0;
      INSERT INTO economy_settings (id, black_market_enabled, hardware_market_enabled, market_tax_percent)
      VALUES (1, 1, 1, 0)
      ON CONFLICT (id) DO NOTHING;
    `);

    await client.query('COMMIT');
    console.log('PostgreSQL schema initialized successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error initializing PostgreSQL schema:', err);
    throw err;
  } finally {
    client.release();
  }
};

export default pool;
=======
import pool from './db.js';

export const initDb = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');


    // Create tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT,
        is_admin INTEGER DEFAULT 0,
        polygon_wallet TEXT,
        is_blocked INTEGER DEFAULT 0,
        access_level_id TEXT,
        referral_code TEXT,
        referred_by TEXT,
        last_active_at BIGINT,
        ranking_excluded INTEGER DEFAULT 0,
        registration_ip TEXT
      );

      CREATE TABLE IF NOT EXISTS user_access_levels (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        access_level_id TEXT NOT NULL,
        granted_at BIGINT NOT NULL,
        PRIMARY KEY (user_id, access_level_id)
      );

      CREATE TABLE IF NOT EXISTS referrals (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        referred_username TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS mining_coins (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        symbol TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        network_hashrate DOUBLE PRECISION DEFAULT 0,
        block_reward DOUBLE PRECISION DEFAULT 0,
        block_time DOUBLE PRECISION DEFAULT 60,
        price_usd DOUBLE PRECISION DEFAULT 0,
        algorithm TEXT DEFAULT '',
        difficulty DOUBLE PRECISION DEFAULT 1,
        multiplier DOUBLE PRECISION DEFAULT 1,
        color TEXT DEFAULT '#ffffff',
        min_proportion DOUBLE PRECISION NOT NULL DEFAULT 0,
        usdc_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        target_daily_usd DOUBLE PRECISION DEFAULT 0,
        show_in_exchange INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS access_levels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        is_default INTEGER NOT NULL,
        is_active INTEGER NOT NULL,
        price_usdc DOUBLE PRECISION,
        contract_address TEXT,
        inactive_message TEXT,
        news_posting_enabled INTEGER DEFAULT 0,
        allowed_pages TEXT
      );

      CREATE TABLE IF NOT EXISTS upgrades (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        type TEXT NOT NULL,
        base_cost DOUBLE PRECISION NOT NULL,
        base_production DOUBLE PRECISION NOT NULL,
        power_consumption DOUBLE PRECISION,
        power_capacity DOUBLE PRECISION,
        multiplier DOUBLE PRECISION,
        slots_capacity INTEGER,
        ai_slots_capacity INTEGER,
        description TEXT NOT NULL,
        icon TEXT NOT NULL,
        status TEXT NOT NULL,
        is_nft INTEGER NOT NULL,
        nft_contract TEXT,
        nft_token_id TEXT,
        max_global_stock INTEGER,
        image TEXT,
        reward_wh DOUBLE PRECISION DEFAULT 0,
        layout TEXT,
        sell_in_hardware_market INTEGER DEFAULT 1,
        sell_in_black_market INTEGER DEFAULT 1,
        is_active INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS upgrade_compat_racks (
        upgrade_id TEXT NOT NULL REFERENCES upgrades(id),
        rack_id TEXT NOT NULL,
        PRIMARY KEY (upgrade_id, rack_id)
      );

      CREATE TABLE IF NOT EXISTS loot_boxes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        price DOUBLE PRECISION NOT NULL,
        trigger TEXT NOT NULL,
        icon TEXT NOT NULL,
        is_active INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS loot_box_items (
        id SERIAL PRIMARY KEY,
        box_id TEXT NOT NULL REFERENCES loot_boxes(id),
        item_type TEXT NOT NULL,
        item_id TEXT NOT NULL,
        min_qty INTEGER NOT NULL,
        max_qty INTEGER NOT NULL,
        probability DOUBLE PRECISION NOT NULL
      );

      CREATE TABLE IF NOT EXISTS system_news (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        link TEXT,
        active INTEGER NOT NULL,
        duration INTEGER,
        author_name TEXT,
        created_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS season_passes (
        id TEXT PRIMARY KEY,
        season_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        price_usdc DOUBLE PRECISION NOT NULL,
        emblem_url TEXT,
        is_active INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS season_purchases (
        user_id INTEGER NOT NULL REFERENCES users(id),
        pass_id TEXT NOT NULL REFERENCES season_passes(id),
        season_id TEXT NOT NULL,
        purchased_at BIGINT NOT NULL,
        PRIMARY KEY (user_id, pass_id)
      );

      CREATE TABLE IF NOT EXISTS game_states (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
        usdc DOUBLE PRECISION DEFAULT 0 NOT NULL,
        start_time BIGINT NOT NULL,
        claimed_referrals INTEGER NOT NULL,
        referral_bonus_claimed INTEGER NOT NULL,
        last_updated_at BIGINT,
        total_usdc_deposited DOUBLE PRECISION,
        total_crypto_withdrawn DOUBLE PRECISION,
        black_market_balance DOUBLE PRECISION DEFAULT 0,
        server_updated_at BIGINT DEFAULT 0,
        usdc_bonus DOUBLE PRECISION DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS stock (
        user_id INTEGER NOT NULL REFERENCES users(id),
        item_id TEXT NOT NULL,
        qty INTEGER NOT NULL,
        PRIMARY KEY (user_id, item_id)
      );

      CREATE TABLE IF NOT EXISTS unopened_boxes (
        user_id INTEGER NOT NULL REFERENCES users(id),
        box_id TEXT NOT NULL,
        qty INTEGER NOT NULL,
        PRIMARY KEY (user_id, box_id)
      );

      CREATE TABLE IF NOT EXISTS stored_batteries (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        item_id TEXT NOT NULL,
        current_charge DOUBLE PRECISION NOT NULL
      );

      CREATE TABLE IF NOT EXISTS placed_racks (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        item_id TEXT NOT NULL,
        wiring_id TEXT,
        battery_id TEXT,
        current_charge DOUBLE PRECISION NOT NULL,
        is_on INTEGER NOT NULL,
        selected_coin_id TEXT,
        room_id TEXT,
        slot_index INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS rack_slots (
        rack_id TEXT NOT NULL REFERENCES placed_racks(id),
        slot_index INTEGER NOT NULL,
        machine_item_id TEXT,
        PRIMARY KEY (rack_id, slot_index)
      );

      CREATE TABLE IF NOT EXISTS rack_multiplier_slots (
        rack_id TEXT NOT NULL REFERENCES placed_racks(id),
        slot_index INTEGER NOT NULL,
        multiplier_item_id TEXT,
        PRIMARY KEY (rack_id, slot_index)
      );

      CREATE TABLE IF NOT EXISTS player_listings (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        item_id TEXT NOT NULL,
        price DOUBLE PRECISION NOT NULL,
        expires_at BIGINT NOT NULL,
        is_player INTEGER,
        reserved_by INTEGER,
        reserved_until BIGINT,
        qty INTEGER DEFAULT 1,
        status TEXT DEFAULT 'active'
      );

      CREATE TABLE IF NOT EXISTS nft_items (
        contract_address TEXT NOT NULL,
        token_id TEXT NOT NULL,
        owner_address TEXT NOT NULL,
        metadata TEXT,
        PRIMARY KEY (contract_address, token_id)
      );

      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL,
        original_user_id INTEGER DEFAULT NULL
      );

      CREATE TABLE IF NOT EXISTS coin_balances (
        user_id INTEGER NOT NULL REFERENCES users(id),
        coin_id TEXT NOT NULL,
        amount DOUBLE PRECISION NOT NULL,
        PRIMARY KEY (user_id, coin_id)
      );

      CREATE TABLE IF NOT EXISTS coin_withdrawals (
        user_id INTEGER NOT NULL REFERENCES users(id),
        coin_id TEXT NOT NULL,
        total_withdrawn DOUBLE PRECISION NOT NULL,
        PRIMARY KEY (user_id, coin_id)
      );

      CREATE TABLE IF NOT EXISTS admin_upgrades (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        price_usdc DOUBLE PRECISION NOT NULL,
        grant_usdc DOUBLE PRECISION DEFAULT 0,
        grant_access_level_id TEXT,
        is_active INTEGER NOT NULL,
        created_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS admin_upgrade_items (
        upgrade_id TEXT NOT NULL REFERENCES admin_upgrades(id),
        item_id TEXT NOT NULL,
        qty INTEGER NOT NULL,
        PRIMARY KEY (upgrade_id, item_id)
      );

      CREATE TABLE IF NOT EXISTS admin_upgrade_boxes (
        upgrade_id TEXT NOT NULL REFERENCES admin_upgrades(id),
        box_id TEXT NOT NULL,
        qty INTEGER NOT NULL,
        PRIMARY KEY (upgrade_id, box_id)
      );

      CREATE TABLE IF NOT EXISTS admin_upgrade_passes (
        upgrade_id TEXT NOT NULL REFERENCES admin_upgrades(id),
        pass_id TEXT NOT NULL,
        PRIMARY KEY (upgrade_id, pass_id)
      );

      CREATE TABLE IF NOT EXISTS admin_upgrade_coins (
        upgrade_id TEXT NOT NULL REFERENCES admin_upgrades(id),
        coin_id TEXT NOT NULL,
        amount DOUBLE PRECISION NOT NULL,
        PRIMARY KEY (upgrade_id, coin_id)
      );

      CREATE TABLE IF NOT EXISTS season_pass_rewards (
        id SERIAL PRIMARY KEY,
        pass_id TEXT NOT NULL REFERENCES season_passes(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        item_id TEXT,
        coin_id TEXT,
        qty DOUBLE PRECISION NOT NULL
      );

      CREATE TABLE IF NOT EXISTS admin_upgrade_purchases (
        user_id INTEGER NOT NULL REFERENCES users(id),
        upgrade_id TEXT NOT NULL REFERENCES admin_upgrades(id),
        purchased_at BIGINT NOT NULL,
        PRIMARY KEY (user_id, upgrade_id)
      );

      CREATE TABLE IF NOT EXISTS admin_upgrade_visibility (
        upgrade_id TEXT NOT NULL REFERENCES admin_upgrades(id) ON DELETE CASCADE,
        access_level_id TEXT NOT NULL,
        PRIMARY KEY (upgrade_id, access_level_id)
      );

      CREATE TABLE IF NOT EXISTS player_news_submissions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        text TEXT NOT NULL,
        link TEXT,
        status TEXT NOT NULL,
        created_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rig_rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        initial_capacity INTEGER NOT NULL,
        max_capacity INTEGER NOT NULL,
        base_slot_price DOUBLE PRECISION NOT NULL,
        slot_price_increase_percent DOUBLE PRECISION NOT NULL,
        allowed_levels TEXT,
        allowed_season_pass_ids TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS user_rig_rooms (
        user_id INTEGER NOT NULL REFERENCES users(id),
        room_id TEXT NOT NULL REFERENCES rig_rooms(id),
        purchased_at BIGINT NOT NULL,
        unlocked_slots INTEGER DEFAULT 0,
        PRIMARY KEY (user_id, room_id)
      );

      CREATE TABLE IF NOT EXISTS workshop_slots (
        user_id INTEGER NOT NULL REFERENCES users(id),
        slot_index INTEGER NOT NULL,
        item_id TEXT,
        internal_state TEXT,
        current_charge DOUBLE PRECISION DEFAULT 0,
        slot_charges TEXT,
        slot_item_ids TEXT,
        PRIMARY KEY (user_id, slot_index)
      );

      CREATE TABLE IF NOT EXISTS player_claimed_boxes (
        user_id INTEGER NOT NULL REFERENCES users(id),
        box_id TEXT NOT NULL,
        claimed_at BIGINT NOT NULL,
        PRIMARY KEY (user_id, box_id)
      );

      CREATE TABLE IF NOT EXISTS daily_actions (
        user_id INTEGER NOT NULL REFERENCES users(id),
        action_key TEXT NOT NULL,
        last_performed_at BIGINT NOT NULL,
        PRIMARY KEY (user_id, action_key)
      );

      CREATE TABLE IF NOT EXISTS promo_codes (
        code TEXT PRIMARY KEY,
        loot_box_id TEXT,
        upgrade_id TEXT,
        admin_upgrade_id TEXT,
        type TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        created_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS promo_code_redemptions (
        code TEXT NOT NULL REFERENCES promo_codes(code),
        user_id INTEGER NOT NULL REFERENCES users(id),
        redeemed_at BIGINT NOT NULL,
        reward_granted INTEGER DEFAULT 1,
        PRIMARY KEY (code, user_id)
      );

      CREATE TABLE IF NOT EXISTS mining_yield_history (
        id SERIAL PRIMARY KEY,
        coin_id TEXT NOT NULL,
        yield_per_hash DOUBLE PRECISION NOT NULL,
        block_reward DOUBLE PRECISION NOT NULL DEFAULT 0,
        network_hashrate DOUBLE PRECISION NOT NULL DEFAULT 0,
        effective_at BIGINT NOT NULL
      );


      CREATE TABLE IF NOT EXISTS economy_settings (
        id INTEGER PRIMARY KEY,
        black_market_enabled INTEGER,
        hardware_market_enabled INTEGER,
        market_tax_percent DOUBLE PRECISION,
        black_market_price_band_percent DOUBLE PRECISION DEFAULT 20
      );

      CREATE TABLE IF NOT EXISTS withdrawal_requests (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        coin_id TEXT NOT NULL,
        amount_crypto DOUBLE PRECISION NOT NULL,
        amount_usdc DOUBLE PRECISION,
        fee_amount DOUBLE PRECISION DEFAULT 0,
        net_amount DOUBLE PRECISION DEFAULT 0,
        tx_hash TEXT,
        wallet_address TEXT,
        status TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        processed_at BIGINT
      );

      -- Migration for existing tables
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='promo_codes' AND column_name='upgrade_id') THEN
          ALTER TABLE promo_codes ADD COLUMN upgrade_id TEXT;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='promo_codes' AND column_name='admin_upgrade_id') THEN
          ALTER TABLE promo_codes ADD COLUMN admin_upgrade_id TEXT;
        END IF;

        ALTER TABLE promo_codes ALTER COLUMN loot_box_id DROP NOT NULL;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='promo_code_redemptions' AND column_name='reward_granted') THEN
          ALTER TABLE promo_code_redemptions ADD COLUMN reward_granted INTEGER DEFAULT 1;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='promo_code_redemptions' AND column_name='won_item_id') THEN
          ALTER TABLE promo_code_redemptions ADD COLUMN won_item_id TEXT;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='upgrades' AND column_name='is_active') THEN
          ALTER TABLE upgrades ADD COLUMN is_active INTEGER DEFAULT 1;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loot_boxes' AND column_name='is_active') THEN
          ALTER TABLE loot_boxes ADD COLUMN is_active INTEGER DEFAULT 1;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='ranking_excluded') THEN
          ALTER TABLE users ADD COLUMN ranking_excluded INTEGER DEFAULT 0;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='registration_ip') THEN
          ALTER TABLE users ADD COLUMN registration_ip TEXT;
        END IF;

        -- Migration for mining_yield_history
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mining_yield_history' AND column_name='block_reward') THEN
          ALTER TABLE mining_yield_history ADD COLUMN block_reward DOUBLE PRECISION DEFAULT 0;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mining_yield_history' AND column_name='network_hashrate') THEN
          ALTER TABLE mining_yield_history ADD COLUMN network_hashrate DOUBLE PRECISION DEFAULT 0;
        END IF;
        -- Migration for withdrawal_requests (fees)
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='withdrawal_requests' AND column_name='fee_amount') THEN
          ALTER TABLE withdrawal_requests ADD COLUMN fee_amount DOUBLE PRECISION DEFAULT 0;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='withdrawal_requests' AND column_name='net_amount') THEN
          ALTER TABLE withdrawal_requests ADD COLUMN net_amount DOUBLE PRECISION DEFAULT 0;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='withdrawal_requests' AND column_name='tx_hash') THEN
          ALTER TABLE withdrawal_requests ADD COLUMN tx_hash TEXT;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='economy_settings' AND column_name='black_market_price_band_percent') THEN
          ALTER TABLE economy_settings ADD COLUMN black_market_price_band_percent DOUBLE PRECISION DEFAULT 20;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'device_fingerprint_logs') THEN
          CREATE TABLE device_fingerprint_logs (
            id BIGSERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            event_type TEXT NOT NULL,
            fingerprint_hash TEXT NOT NULL,
            payload_json TEXT,
            ip TEXT,
            user_agent TEXT,
            created_at BIGINT NOT NULL
          );
          CREATE INDEX idx_device_fingerprint_logs_user_id ON device_fingerprint_logs(user_id);
          CREATE INDEX idx_device_fingerprint_logs_hash ON device_fingerprint_logs(fingerprint_hash);
          CREATE INDEX idx_device_fingerprint_logs_created ON device_fingerprint_logs(created_at);
        END IF;

      END $$;


      CREATE TABLE IF NOT EXISTS wheel_prizes (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        weight INTEGER NOT NULL,
        color TEXT NOT NULL,
        item_id TEXT
      );

      CREATE TABLE IF NOT EXISTS wheel_players (
        username TEXT PRIMARY KEY,
        added_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS wallet_labels (
        address TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        updated_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS referral_models (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        sender_reward_usdc DOUBLE PRECISION DEFAULT 0,
        receiver_reward_usdc DOUBLE PRECISION DEFAULT 0,
        sender_loot_box_id TEXT,
        receiver_loot_box_id TEXT,
        deposit_commission_percent DOUBLE PRECISION DEFAULT 0,
        hardware_commission_percent DOUBLE PRECISION DEFAULT 0,
        black_market_commission_percent DOUBLE PRECISION DEFAULT 0,
        is_active INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS access_level_referral_models (
        access_level_id TEXT PRIMARY KEY REFERENCES access_levels(id),
        referral_model_id INTEGER REFERENCES referral_models(id)
      );
    `);

    // Create Indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_game_states_user_id ON game_states(user_id);
      CREATE TABLE IF NOT EXISTS user_history_ips (
        user_id INTEGER NOT NULL REFERENCES users(id),
        ip TEXT NOT NULL,
        last_used_at BIGINT NOT NULL,
        PRIMARY KEY (user_id, ip)
      );
      CREATE INDEX IF NOT EXISTS idx_user_history_ips_user_id ON user_history_ips(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_history_ips_ip ON user_history_ips(ip);
      CREATE TABLE IF NOT EXISTS device_fingerprint_logs (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        fingerprint_hash TEXT NOT NULL,
        payload_json TEXT,
        ip TEXT,
        user_agent TEXT,
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_device_fingerprint_logs_user_id ON device_fingerprint_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_device_fingerprint_logs_hash ON device_fingerprint_logs(fingerprint_hash);
      CREATE INDEX IF NOT EXISTS idx_device_fingerprint_logs_created ON device_fingerprint_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_stock_user_id ON stock(user_id);
      CREATE INDEX IF NOT EXISTS idx_unopened_boxes_user_id ON unopened_boxes(user_id);
      CREATE INDEX IF NOT EXISTS idx_stored_batteries_user_id ON stored_batteries(user_id);
      CREATE INDEX IF NOT EXISTS idx_placed_racks_user_id ON placed_racks(user_id);
      CREATE INDEX IF NOT EXISTS idx_player_listings_user_id ON player_listings(user_id);
      CREATE INDEX IF NOT EXISTS idx_nft_items_owner ON nft_items(owner_address);
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_coin_balances_user_id ON coin_balances(user_id);
      CREATE INDEX IF NOT EXISTS idx_coin_withdrawals_user_id ON coin_withdrawals(user_id);
      CREATE INDEX IF NOT EXISTS idx_admin_upgrade_purchases_user_id ON admin_upgrade_purchases(user_id);
      CREATE INDEX IF NOT EXISTS idx_system_news_created_at ON system_news(created_at);
      CREATE INDEX IF NOT EXISTS idx_referrals_user_id ON referrals(user_id);
      CREATE INDEX IF NOT EXISTS idx_loot_box_items_box_id ON loot_box_items(box_id);
      CREATE INDEX IF NOT EXISTS idx_upgrade_compat_racks_upgrade_id ON upgrade_compat_racks(upgrade_id);
      CREATE INDEX IF NOT EXISTS idx_season_purchases_user_id ON season_purchases(user_id);
      CREATE INDEX IF NOT EXISTS idx_season_purchases_season_id ON season_purchases(season_id);
      CREATE INDEX IF NOT EXISTS idx_season_purchases_season_id ON season_purchases(season_id);
      CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_user ON withdrawal_requests(user_id);
      CREATE INDEX IF NOT EXISTS idx_mining_yield_history_coin_id ON mining_yield_history(coin_id);
      CREATE INDEX IF NOT EXISTS idx_mining_yield_history_effective_at ON mining_yield_history(effective_at);
      CREATE INDEX IF NOT EXISTS idx_rack_slots_rack_id ON rack_slots(rack_id);
      CREATE INDEX IF NOT EXISTS idx_rack_multiplier_slots_rack_id ON rack_multiplier_slots(rack_id);
      CREATE INDEX IF NOT EXISTS idx_workshop_slots_user_id ON workshop_slots(user_id);
      CREATE INDEX IF NOT EXISTS idx_promo_code_redemptions_code_user ON promo_code_redemptions(code, user_id);
    `);

    // Migration for new commission columns
    await client.query(`
      ALTER TABLE referral_models ADD COLUMN IF NOT EXISTS deposit_commission_percent DOUBLE PRECISION DEFAULT 0;
      ALTER TABLE referral_models ADD COLUMN IF NOT EXISTS hardware_commission_percent DOUBLE PRECISION DEFAULT 0;
      ALTER TABLE referral_models ADD COLUMN IF NOT EXISTS black_market_commission_percent DOUBLE PRECISION DEFAULT 0;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ip_blacklist (

        ip TEXT PRIMARY KEY,
        reason TEXT,
        added_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS admin_access_logs (
        id SERIAL PRIMARY KEY,
        ip TEXT NOT NULL,
        attempted_url TEXT NOT NULL,
        user_agent TEXT,
        details TEXT,
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_admin_access_logs_ip ON admin_access_logs(ip);
      CREATE INDEX IF NOT EXISTS idx_admin_access_logs_created_at ON admin_access_logs(created_at);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS transparency_entries (
        id SERIAL PRIMARY KEY,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        amount_usdc DOUBLE PRECISION,
        link_url TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_transparency_entries_sort ON transparency_entries(sort_order, id);
    `);

    // Garantir permissão "transparency" em todas as contas admin que já têm admin_permissions em JSON
    const adminsPerm = await client.query(
      `SELECT id, admin_permissions FROM users WHERE is_admin = 1 AND admin_permissions IS NOT NULL AND btrim(admin_permissions) <> ''`
    );
    for (const row of adminsPerm.rows) {
      try {
        const p = JSON.parse(row.admin_permissions);
        if (Array.isArray(p)) {
          if (!p.includes('transparency')) {
            await client.query('UPDATE users SET admin_permissions = $1 WHERE id = $2', [
              JSON.stringify([...p, 'transparency']),
              row.id
            ]);
          }
        } else if (p && typeof p === 'object') {
          if (p.transparency !== true) {
            p.transparency = true;
            await client.query('UPDATE users SET admin_permissions = $1 WHERE id = $2', [JSON.stringify(p), row.id]);
          }
        }
      } catch (_) {
        /* JSON inválido — não alterar */
      }
    }

    await client.query('COMMIT');
    console.log('PostgreSQL schema initialized successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error initializing PostgreSQL schema:', err);
    throw err;
  } finally {
    client.release();
  }
};

export default pool;
>>>>>>> Stashed changes
