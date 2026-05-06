-- Mine Station — baseline Prisma (= schema.prisma, espelho do initDb legado).
-- Instalação nova (Postgres vazio): `npx prisma migrate deploy` aplica este script; depois `initDb` é no-op (CREATE IF NOT EXISTS).
-- Base de dados já existente (tabelas criadas antes do Migrate): marcar como aplicada sem executar SQL:
--   npx prisma migrate resolve --applied "20260206130000_baseline"
-- Depois disso, `migrate deploy` só aplica migrações futuras.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT,
    "is_admin" INTEGER DEFAULT 0,
    "is_super_admin" INTEGER NOT NULL DEFAULT 0,
    "polygon_wallet" TEXT,
    "is_blocked" INTEGER DEFAULT 0,
    "access_level_id" TEXT,
    "referral_code" TEXT,
    "referred_by" TEXT,
    "last_active_at" BIGINT,
    "ranking_excluded" INTEGER DEFAULT 0,
    "registration_ip" TEXT,
    "admin_permissions" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_access_levels" (
    "user_id" INTEGER NOT NULL,
    "access_level_id" TEXT NOT NULL,
    "granted_at" BIGINT NOT NULL,

    CONSTRAINT "user_access_levels_pkey" PRIMARY KEY ("user_id","access_level_id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "referred_username" TEXT NOT NULL,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mining_coins" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "network_hashrate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "block_reward" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "block_time" DOUBLE PRECISION NOT NULL DEFAULT 60,
    "price_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "algorithm" TEXT NOT NULL DEFAULT '',
    "difficulty" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "color" TEXT NOT NULL DEFAULT '#ffffff',
    "min_proportion" DOUBLE PRECISION NOT NULL,
    "usdc_rate" DOUBLE PRECISION NOT NULL,
    "is_active" INTEGER NOT NULL,
    "target_daily_usd" DOUBLE PRECISION DEFAULT 0,
    "show_in_exchange" INTEGER DEFAULT 1,

    CONSTRAINT "mining_coins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_levels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "is_default" INTEGER NOT NULL,
    "is_active" INTEGER NOT NULL,
    "price_usdc" DOUBLE PRECISION,
    "contract_address" TEXT,
    "inactive_message" TEXT,
    "news_posting_enabled" INTEGER DEFAULT 0,
    "allowed_pages" TEXT,

    CONSTRAINT "access_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upgrades" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "base_cost" DOUBLE PRECISION NOT NULL,
    "base_production" DOUBLE PRECISION NOT NULL,
    "power_consumption" DOUBLE PRECISION,
    "power_capacity" DOUBLE PRECISION,
    "multiplier" DOUBLE PRECISION,
    "slots_capacity" INTEGER,
    "ai_slots_capacity" INTEGER,
    "description" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "is_nft" INTEGER NOT NULL,
    "nft_contract" TEXT,
    "nft_token_id" TEXT,
    "max_global_stock" INTEGER,
    "image" TEXT,
    "reward_wh" DOUBLE PRECISION DEFAULT 0,
    "layout" TEXT,
    "sell_in_hardware_market" INTEGER DEFAULT 1,
    "sell_in_black_market" INTEGER DEFAULT 1,
    "is_active" INTEGER DEFAULT 1,

    CONSTRAINT "upgrades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upgrade_compat_racks" (
    "upgrade_id" TEXT NOT NULL,
    "rack_id" TEXT NOT NULL,

    CONSTRAINT "upgrade_compat_racks_pkey" PRIMARY KEY ("upgrade_id","rack_id")
);

-- CreateTable
CREATE TABLE "loot_boxes" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "trigger" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "is_active" INTEGER DEFAULT 1,

    CONSTRAINT "loot_boxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loot_box_items" (
    "id" SERIAL NOT NULL,
    "box_id" TEXT NOT NULL,
    "item_type" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "min_qty" INTEGER NOT NULL,
    "max_qty" INTEGER NOT NULL,
    "probability" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "loot_box_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_news" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "link" TEXT,
    "active" INTEGER NOT NULL,
    "duration" INTEGER,
    "author_name" TEXT,
    "created_at" BIGINT NOT NULL,

    CONSTRAINT "system_news_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "season_passes" (
    "id" TEXT NOT NULL,
    "season_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price_usdc" DOUBLE PRECISION NOT NULL,
    "emblem_url" TEXT,
    "is_active" INTEGER NOT NULL,

    CONSTRAINT "season_passes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "season_purchases" (
    "user_id" INTEGER NOT NULL,
    "pass_id" TEXT NOT NULL,
    "season_id" TEXT NOT NULL,
    "purchased_at" BIGINT NOT NULL,

    CONSTRAINT "season_purchases_pkey" PRIMARY KEY ("user_id","pass_id")
);

-- CreateTable
CREATE TABLE "game_states" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "usdc" DOUBLE PRECISION NOT NULL,
    "start_time" BIGINT NOT NULL,
    "claimed_referrals" INTEGER NOT NULL,
    "referral_bonus_claimed" INTEGER NOT NULL,
    "last_updated_at" BIGINT,
    "total_usdc_deposited" DOUBLE PRECISION,
    "total_crypto_withdrawn" DOUBLE PRECISION,
    "black_market_balance" DOUBLE PRECISION DEFAULT 0,
    "server_updated_at" BIGINT DEFAULT 0,
    "usdc_bonus" DOUBLE PRECISION DEFAULT 0,

    CONSTRAINT "game_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "stock" (
    "user_id" INTEGER NOT NULL,
    "item_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "stock_pkey" PRIMARY KEY ("user_id","item_id")
);

-- CreateTable
CREATE TABLE "unopened_boxes" (
    "user_id" INTEGER NOT NULL,
    "box_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "unopened_boxes_pkey" PRIMARY KEY ("user_id","box_id")
);

-- CreateTable
CREATE TABLE "stored_batteries" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "item_id" TEXT NOT NULL,
    "current_charge" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "stored_batteries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "placed_racks" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "item_id" TEXT NOT NULL,
    "wiring_id" TEXT,
    "battery_id" TEXT,
    "current_charge" DOUBLE PRECISION NOT NULL,
    "is_on" INTEGER NOT NULL,
    "selected_coin_id" TEXT,
    "room_id" TEXT,
    "slot_index" INTEGER DEFAULT 0,

    CONSTRAINT "placed_racks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rack_slots" (
    "rack_id" TEXT NOT NULL,
    "slot_index" INTEGER NOT NULL,
    "machine_item_id" TEXT,

    CONSTRAINT "rack_slots_pkey" PRIMARY KEY ("rack_id","slot_index")
);

-- CreateTable
CREATE TABLE "rack_multiplier_slots" (
    "rack_id" TEXT NOT NULL,
    "slot_index" INTEGER NOT NULL,
    "multiplier_item_id" TEXT,

    CONSTRAINT "rack_multiplier_slots_pkey" PRIMARY KEY ("rack_id","slot_index")
);

-- CreateTable
CREATE TABLE "player_listings" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "item_id" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "expires_at" BIGINT NOT NULL,
    "is_player" INTEGER,
    "reserved_by" INTEGER,
    "reserved_until" BIGINT,
    "qty" INTEGER DEFAULT 1,
    "status" TEXT DEFAULT 'active',
    "buyer_paid_usdc" DOUBLE PRECISION,

    CONSTRAINT "player_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "p2p_market_trade_history" (
    "id" BIGSERIAL NOT NULL,
    "created_at" BIGINT NOT NULL,
    "buyer_id" INTEGER NOT NULL,
    "seller_id" INTEGER NOT NULL,
    "item_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_price" DOUBLE PRECISION NOT NULL,
    "buyer_paid_usdc" DOUBLE PRECISION NOT NULL,
    "seller_received_usdc" DOUBLE PRECISION NOT NULL,
    "tax_usdc" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "p2p_market_trade_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nft_items" (
    "contract_address" TEXT NOT NULL,
    "token_id" TEXT NOT NULL,
    "owner_address" TEXT NOT NULL,
    "metadata" TEXT,

    CONSTRAINT "nft_items_pkey" PRIMARY KEY ("contract_address","token_id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "session_id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "created_at" BIGINT NOT NULL,
    "expires_at" BIGINT NOT NULL,
    "original_user_id" INTEGER,
    "last_seen_at" BIGINT DEFAULT 0,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("session_id")
);

-- CreateTable
CREATE TABLE "jwt_refresh_tokens" (
    "id" BIGSERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "token_hash" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "expires_at" BIGINT NOT NULL,
    "created_at" BIGINT NOT NULL,
    "user_agent" TEXT,
    "ip" TEXT,
    "revoked_at" BIGINT,

    CONSTRAINT "jwt_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coin_balances" (
    "user_id" INTEGER NOT NULL,
    "coin_id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "coin_balances_pkey" PRIMARY KEY ("user_id","coin_id")
);

-- CreateTable
CREATE TABLE "coin_withdrawals" (
    "user_id" INTEGER NOT NULL,
    "coin_id" TEXT NOT NULL,
    "total_withdrawn" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "coin_withdrawals_pkey" PRIMARY KEY ("user_id","coin_id")
);

-- CreateTable
CREATE TABLE "admin_upgrades" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price_usdc" DOUBLE PRECISION NOT NULL,
    "grant_usdc" DOUBLE PRECISION DEFAULT 0,
    "grant_access_level_id" TEXT,
    "is_active" INTEGER NOT NULL,
    "created_at" BIGINT NOT NULL,

    CONSTRAINT "admin_upgrades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_upgrade_items" (
    "upgrade_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "admin_upgrade_items_pkey" PRIMARY KEY ("upgrade_id","item_id")
);

-- CreateTable
CREATE TABLE "admin_upgrade_boxes" (
    "upgrade_id" TEXT NOT NULL,
    "box_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "admin_upgrade_boxes_pkey" PRIMARY KEY ("upgrade_id","box_id")
);

-- CreateTable
CREATE TABLE "admin_upgrade_passes" (
    "upgrade_id" TEXT NOT NULL,
    "pass_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "admin_upgrade_passes_pkey" PRIMARY KEY ("upgrade_id","pass_id")
);

-- CreateTable
CREATE TABLE "admin_upgrade_coins" (
    "upgrade_id" TEXT NOT NULL,
    "coin_id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "admin_upgrade_coins_pkey" PRIMARY KEY ("upgrade_id","coin_id")
);

-- CreateTable
CREATE TABLE "season_pass_rewards" (
    "id" SERIAL NOT NULL,
    "pass_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "item_id" TEXT,
    "coin_id" TEXT,
    "qty" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "season_pass_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_upgrade_purchases" (
    "user_id" INTEGER NOT NULL,
    "upgrade_id" TEXT NOT NULL,
    "purchased_at" BIGINT NOT NULL,

    CONSTRAINT "admin_upgrade_purchases_pkey" PRIMARY KEY ("user_id","upgrade_id")
);

-- CreateTable
CREATE TABLE "admin_upgrade_visibility" (
    "upgrade_id" TEXT NOT NULL,
    "access_level_id" TEXT NOT NULL,

    CONSTRAINT "admin_upgrade_visibility_pkey" PRIMARY KEY ("upgrade_id","access_level_id")
);

-- CreateTable
CREATE TABLE "player_news_submissions" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "link" TEXT,
    "status" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,

    CONSTRAINT "player_news_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "attachments" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" BIGINT NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_ticket_replies" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "admin_user_id" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "attachments" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "created_at" BIGINT NOT NULL,

    CONSTRAINT "support_ticket_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_ticket_player_replies" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "attachments" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "created_at" BIGINT NOT NULL,

    CONSTRAINT "support_ticket_player_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rig_rooms" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "initial_capacity" INTEGER NOT NULL,
    "max_capacity" INTEGER NOT NULL,
    "base_slot_price" DOUBLE PRECISION NOT NULL,
    "slot_price_increase_percent" DOUBLE PRECISION NOT NULL,
    "allowed_levels" TEXT,
    "allowed_season_pass_ids" TEXT,
    "is_active" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rig_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_rig_rooms" (
    "user_id" INTEGER NOT NULL,
    "room_id" TEXT NOT NULL,
    "purchased_at" BIGINT NOT NULL,
    "unlocked_slots" INTEGER DEFAULT 0,

    CONSTRAINT "user_rig_rooms_pkey" PRIMARY KEY ("user_id","room_id")
);

-- CreateTable
CREATE TABLE "workshop_slots" (
    "user_id" INTEGER NOT NULL,
    "slot_index" INTEGER NOT NULL,
    "item_id" TEXT,
    "internal_state" TEXT,
    "current_charge" DOUBLE PRECISION DEFAULT 0,
    "slot_charges" TEXT,
    "slot_item_ids" TEXT,

    CONSTRAINT "workshop_slots_pkey" PRIMARY KEY ("user_id","slot_index")
);

-- CreateTable
CREATE TABLE "player_claimed_boxes" (
    "user_id" INTEGER NOT NULL,
    "box_id" TEXT NOT NULL,
    "claimed_at" BIGINT NOT NULL,

    CONSTRAINT "player_claimed_boxes_pkey" PRIMARY KEY ("user_id","box_id")
);

-- CreateTable
CREATE TABLE "daily_actions" (
    "user_id" INTEGER NOT NULL,
    "action_key" TEXT NOT NULL,
    "last_performed_at" BIGINT NOT NULL,

    CONSTRAINT "daily_actions_pkey" PRIMARY KEY ("user_id","action_key")
);

-- CreateTable
CREATE TABLE "game_activity_logs" (
    "id" BIGSERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "meta" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" BIGINT NOT NULL,

    CONSTRAINT "game_activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_codes" (
    "code" TEXT NOT NULL,
    "loot_box_id" TEXT,
    "upgrade_id" TEXT,
    "admin_upgrade_id" TEXT,
    "type" TEXT NOT NULL,
    "is_active" INTEGER DEFAULT 1,
    "created_at" BIGINT NOT NULL,
    "expires_at" BIGINT,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "promo_code_redemptions" (
    "code" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "redeemed_at" BIGINT NOT NULL,
    "reward_granted" INTEGER DEFAULT 1,
    "won_item_id" TEXT,
    "roulette_rolled_at" BIGINT,
    "roulette_claimed_at" BIGINT,

    CONSTRAINT "promo_code_redemptions_pkey" PRIMARY KEY ("code","user_id")
);

-- CreateTable
CREATE TABLE "mining_yield_history" (
    "id" SERIAL NOT NULL,
    "coin_id" TEXT NOT NULL,
    "yield_per_hash" DOUBLE PRECISION NOT NULL,
    "block_reward" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "network_hashrate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "effective_at" BIGINT NOT NULL,

    CONSTRAINT "mining_yield_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "economy_settings" (
    "id" INTEGER NOT NULL,
    "black_market_enabled" INTEGER,
    "hardware_market_enabled" INTEGER,
    "market_tax_percent" DOUBLE PRECISION,
    "black_market_price_band_percent" DOUBLE PRECISION DEFAULT 20,

    CONSTRAINT "economy_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawal_requests" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "coin_id" TEXT NOT NULL,
    "amount_crypto" DOUBLE PRECISION NOT NULL,
    "amount_usdc" DOUBLE PRECISION,
    "fee_amount" DOUBLE PRECISION DEFAULT 0,
    "net_amount" DOUBLE PRECISION DEFAULT 0,
    "tx_hash" TEXT,
    "wallet_address" TEXT,
    "status" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    "processed_at" BIGINT,

    CONSTRAINT "withdrawal_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wheel_prizes" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,
    "color" TEXT NOT NULL,
    "item_id" TEXT,

    CONSTRAINT "wheel_prizes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wheel_players" (
    "username" TEXT NOT NULL,
    "added_at" BIGINT NOT NULL,

    CONSTRAINT "wheel_players_pkey" PRIMARY KEY ("username")
);

-- CreateTable
CREATE TABLE "wallet_labels" (
    "address" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "updated_at" BIGINT NOT NULL,

    CONSTRAINT "wallet_labels_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "referral_models" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sender_reward_usdc" DOUBLE PRECISION DEFAULT 0,
    "receiver_reward_usdc" DOUBLE PRECISION DEFAULT 0,
    "sender_loot_box_id" TEXT,
    "receiver_loot_box_id" TEXT,
    "deposit_commission_percent" DOUBLE PRECISION DEFAULT 0,
    "hardware_commission_percent" DOUBLE PRECISION DEFAULT 0,
    "black_market_commission_percent" DOUBLE PRECISION DEFAULT 0,
    "is_active" INTEGER DEFAULT 1,

    CONSTRAINT "referral_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_level_referral_models" (
    "access_level_id" TEXT NOT NULL,
    "referral_model_id" INTEGER,

    CONSTRAINT "access_level_referral_models_pkey" PRIMARY KEY ("access_level_id")
);

-- CreateTable
CREATE TABLE "user_history_ips" (
    "user_id" INTEGER NOT NULL,
    "ip" TEXT NOT NULL,
    "last_used_at" BIGINT NOT NULL,

    CONSTRAINT "user_history_ips_pkey" PRIMARY KEY ("user_id","ip")
);

-- CreateTable
CREATE TABLE "device_fingerprint_logs" (
    "id" BIGSERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "event_type" TEXT NOT NULL,
    "fingerprint_hash" TEXT NOT NULL,
    "payload_json" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" BIGINT NOT NULL,

    CONSTRAINT "device_fingerprint_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ip_blacklist" (
    "ip" TEXT NOT NULL,
    "reason" TEXT,
    "added_at" BIGINT NOT NULL,

    CONSTRAINT "ip_blacklist_pkey" PRIMARY KEY ("ip")
);

-- CreateTable
CREATE TABLE "admin_access_logs" (
    "id" SERIAL NOT NULL,
    "ip" TEXT NOT NULL,
    "attempted_url" TEXT NOT NULL,
    "user_agent" TEXT,
    "details" TEXT,
    "created_at" BIGINT NOT NULL,

    CONSTRAINT "admin_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_threat_scores" (
    "ip" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "window_start" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,

    CONSTRAINT "security_threat_scores_pkey" PRIMARY KEY ("ip")
);

-- CreateTable
CREATE TABLE "transparency_entries" (
    "id" SERIAL NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "amount_usdc" DOUBLE PRECISION,
    "link_url" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,

    CONSTRAINT "transparency_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ui_display_labels" (
    "key" VARCHAR(120) NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" BIGINT NOT NULL,

    CONSTRAINT "ui_display_labels_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "wheel_paid_pending" (
    "user_id" INTEGER NOT NULL,
    "won_item_id" TEXT NOT NULL,
    "charged_usdc" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "rolled_at" BIGINT NOT NULL,

    CONSTRAINT "wheel_paid_pending_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "charging_history" (
    "id" SERIAL NOT NULL,
    "user_email" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "workshop_slot_index" INTEGER,
    "component_slot_id" TEXT,
    "battery_instance_id" TEXT,
    "battery_item_id" TEXT,
    "charge_amount" DOUBLE PRECISION,
    "timestamp" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "stock_confirmed" BOOLEAN DEFAULT false,
    "details" JSONB,

    CONSTRAINT "charging_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_cache" (
    "key" TEXT NOT NULL,
    "value" JSONB,
    "updated_at" TIMESTAMP(6),

    CONSTRAINT "app_cache_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "partner_youtube_submissions" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "youtube_url" TEXT NOT NULL,
    "youtube_video_id" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" BIGINT NOT NULL,
    "reviewed_at" BIGINT,
    "reviewed_by" INTEGER,
    "reject_reason" TEXT,

    CONSTRAINT "partner_youtube_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_youtube_creator_profiles" (
    "user_id" INTEGER NOT NULL,
    "channel_url" TEXT NOT NULL DEFAULT '',
    "avatar_url" TEXT NOT NULL DEFAULT '',
    "updated_at" BIGINT NOT NULL DEFAULT 0,
    "updated_by" INTEGER,

    CONSTRAINT "partner_youtube_creator_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "partner_youtube_manual_allowlist" (
    "user_id" INTEGER NOT NULL,
    "added_at" BIGINT NOT NULL,
    "added_by" INTEGER,

    CONSTRAINT "partner_youtube_manual_allowlist_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "game_states_user_id_key" ON "game_states"("user_id");

