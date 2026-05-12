/**
 * Agregador de leitura para a Dashboard (`GET /api/dashboard/state`).
 *
 * Reaproveita funções existentes dos outros módulos sempre que possível:
 *  - `buildWalletStatePayload`         → USDC + saldos de moedas mineradas
 *  - `computePlayerGameHeaderSnapshot` → hash total por moeda (mesma fonte do WS)
 *  - `getPublicMiningRankingPayload`   → ranking público (top 10)
 *
 * O serviço **não** introduz lógica nova de mineração/saque/upgrade; só
 * lê valores já calculados pelos módulos canónicos.
 */

import { prisma } from '../../config/prisma.js';
import { computePlayerGameHeaderSnapshot } from '../../lib/playerGameHeaderSnapshot.js';
import { getPublicMiningRankingPayload } from '../../lib/miningRankingPrisma.js';
import { buildWalletStatePayload } from '../wallet/walletPlayerController.js';
import { isKnownInfiniteBatteryCatalogId } from '../batteries/batteries.catalog.js';
import fs from 'node:fs';
import path from 'node:path';
import type {
  DashboardEcosystemModule,
  DashboardEvent,
  DashboardMinerState,
  DashboardNotification,
  DashboardQuickAccessItem,
  DashboardRanking,
  DashboardRankingEntry,
  DashboardStateDto,
  DashboardTokenBalance,
  DashboardWalletState
} from './dashboard.types.js';

const RANKING_TOP_LIMIT = 10;
const NOTIFICATIONS_LIMIT = 5;

/** Catálogo estático dos parceiros do ecossistema (V1: sem tabela; configurável depois). */
const ECOSYSTEM_MODULES: readonly DashboardEcosystemModule[] = [
  {
    id: 'workerrealm',
    title: 'WorkerRealm',
    subtitle: 'Dungeons',
    imageUrl: null,
    href: 'https://workerrealm.com',
    external: true,
    status: 'coming_soon'
  },
  {
    id: 'blockminer',
    title: 'BlockMiner',
    subtitle: 'Faucets & Tasks',
    imageUrl: '/img/parceiros/blockminer.png',
    href: 'https://blockminer.space',
    external: true,
    status: 'available'
  },
  {
    id: 'minecore',
    title: 'MineCore',
    subtitle: 'Fazendinha & Miner',
    imageUrl: null,
    href: 'https://minecore.app',
    external: true,
    status: 'coming_soon'
  },
  {
    id: 'masterleague',
    title: 'Master League',
    subtitle: 'Futebol Miner',
    imageUrl: null,
    href: 'https://masterleague.app',
    external: true,
    status: 'coming_soon'
  },
  {
    id: 'reworth',
    title: 'Reworth Games',
    subtitle: 'Survivor P2E',
    imageUrl: null,
    href: 'https://reworthgames.com',
    external: true,
    status: 'coming_soon'
  }
];

/**
 * Cache-bust do banner BlockMiner: mesmo path `/img/...` fica preso em browser/CDN.
 * `process.cwd()` = raiz do backend em Docker (`/app/backend`), alinhado com `img/` no repo.
 */
function blockminerDashboardImageUrl(): string {
  const abs = path.join(process.cwd(), 'img', 'parceiros', 'blockminer.png');
  try {
    const v = Math.floor(fs.statSync(abs).mtimeMs);
    return `/img/parceiros/blockminer.png?v=${v}`;
  } catch {
    return '/img/parceiros/blockminer.png';
  }
}

function ecosystemModulesForResponse(): DashboardEcosystemModule[] {
  return ECOSYSTEM_MODULES.map((m) =>
    m.id === 'blockminer' ? { ...m, imageUrl: blockminerDashboardImageUrl() } : m
  );
}

/** Atalhos exibidos no rodapé (mapeiam para views internas do SPA). */
const QUICK_ACCESS: readonly DashboardQuickAccessItem[] = [
  // Atalho `oficina` removido: sistema de baterias é infinito, ecrã foi descontinuado.
  { id: 'miner-shop',      title: 'Lojinha Miner',  viewId: 'hardware_store',  href: '/miner-shop',   icon: 'shop' },
  { id: 'black-market',    title: 'Mercado Negro',  viewId: 'black_market',    href: '/black-market', icon: 'mask' },
  { id: 'lucky-boxes',     title: 'Caixas da Sorte',viewId: 'lucky_store',     href: '/lucky-boxes',  icon: 'gift' },
  { id: 'wheel',           title: 'Roleta',         viewId: 'roleta',          href: '/wheel',        icon: 'compass' },
  { id: 'upgrades',        title: 'Upgrades',       viewId: 'upgrade',         href: '/upgrades',     icon: 'rocket' },
  { id: 'transparency',    title: 'Transparência',  viewId: 'transparency',    href: '/transparency', icon: 'eye' },
  { id: 'wallet',          title: 'Carteira',       viewId: 'wallet',          href: '/wallet',       icon: 'wallet' }
];

function num(v: unknown, def = 0): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : def;
}

/**
 * Resumo da carteira: usa o payload canónico da carteira e fica só com:
 *  - `usdcBalance`
 *  - moedas com saldo > 0, ordenadas por valor em USDC (descendente), top 5.
 */
async function buildWalletSummaryForDashboard(userId: number): Promise<DashboardWalletState> {
  const walletPayload = await buildWalletStatePayload(userId);
  const usdc = num((walletPayload as Record<string, unknown>).usdcBalance);
  const minedRaw = (walletPayload as Record<string, unknown>).minedBalances;
  const tokens: DashboardTokenBalance[] = [];

  if (Array.isArray(minedRaw)) {
    for (const row of minedRaw as Array<Record<string, unknown>>) {
      const amount = num(row.minedBalance);
      if (!(amount > 0)) continue;
      const usdcRate = num(row.usdcRate);
      tokens.push({
        coinId: String(row.coinId || ''),
        symbol: String(row.symbol || row.name || ''),
        name: String(row.name || row.symbol || ''),
        amount,
        usdcRate
      });
    }
    tokens.sort((a, b) => b.amount * b.usdcRate - a.amount * a.usdcRate);
  }

  return {
    usdc,
    tokens: tokens.slice(0, 5)
  };
}

/**
 * Estado do miner: status (online quando hashTotal > 0), nível por `access_level`,
 * energia proxy (carga das baterias / capacidade — ignora baterias infinitas).
 *
 * Não inventamos XP/eficiência/consumo: campos sem fonte real ficam `null`.
 */
async function buildMinerStateForDashboard(
  userId: number,
  hashTotal: number,
  hashByCoinId: Record<string, number>
): Promise<DashboardMinerState> {
  const user = await prisma.users.findUnique({
    where: { id: userId },
    select: {
      access_level_id: true
    }
  });

  let levelLabel: string | null = null;
  let accessLevelId: string | null = null;
  if (user?.access_level_id) {
    accessLevelId = user.access_level_id;
    try {
      const lvl = await prisma.access_levels.findUnique({
        where: { id: user.access_level_id },
        select: { name: true }
      });
      if (lvl?.name && lvl.name.trim()) levelLabel = lvl.name.trim();
    } catch {
      levelLabel = null;
    }
  }

  let totalCapWh = 0;
  let totalChargeWh = 0;
  let rigsOnline = 0;
  let rigsTotal = 0;
  try {
    const racks = await prisma.placed_racks.findMany({
      where: { user_id: userId },
      select: {
        is_on: true,
        battery_id: true,
        battery_catalog_item_id: true,
        battery_power_capacity_wh: true,
        current_charge: true
      }
    });
    rigsTotal = racks.length;
    for (const r of racks) {
      const charge = num(r.current_charge);
      const cap = num(r.battery_power_capacity_wh);
      const catalogId =
        r.battery_catalog_item_id != null && String(r.battery_catalog_item_id).trim() !== ''
          ? String(r.battery_catalog_item_id)
          : r.battery_id != null
            ? String(r.battery_id)
            : '';
      const infinite =
        charge === -1 ||
        cap === -1 ||
        isKnownInfiniteBatteryCatalogId(catalogId);
      if (Number(r.is_on) === 1 && (infinite || charge > 0)) rigsOnline += 1;
      if (!infinite && cap > 0) {
        totalCapWh += cap;
        totalChargeWh += Math.max(0, charge);
      }
    }
  } catch {
    /* fallback: sem dados ainda */
  }

  let energyPercent: number | null = null;
  let energyCharge: number | null = null;
  let energyCap: number | null = null;
  if (totalCapWh > 0) {
    energyCharge = Math.round(totalChargeWh * 100) / 100;
    energyCap = Math.round(totalCapWh * 100) / 100;
    energyPercent = Math.max(0, Math.min(100, (totalChargeWh / totalCapWh) * 100));
    energyPercent = Math.round(energyPercent * 10) / 10;
  }

  const status: DashboardMinerState['status'] =
    hashTotal > 0 ? 'online' : rigsTotal > 0 ? 'idle' : 'offline';

  // hashByCoinId é referenciado externamente; mantém o objeto raso seguro:
  const safeHashByCoinId: Record<string, number> = {};
  for (const [k, v] of Object.entries(hashByCoinId || {})) {
    if (!k) continue;
    const n = num(v);
    if (n > 0) safeHashByCoinId[k] = n;
  }

  return {
    status,
    levelLabel,
    accessLevelId,
    hashTotal,
    hashByCoinId: safeHashByCoinId,
    energyPercent,
    energyChargeWh: energyCharge,
    energyCapacityWh: energyCap,
    rigsOnline,
    rigsTotal
  };
}

/**
 * Notificações V1: usa `system_news` ativas (mais recentes primeiro).
 *
 * Os campos `read` e `link` ficam coerentes mas neutros (não há tabela de
 * leitura por utilizador ainda). Caixas pendentes geram uma notificação local
 * ("X caixas para abrir") quando aplicável.
 */
async function buildNotificationsForDashboard(userId: number): Promise<DashboardNotification[]> {
  const out: DashboardNotification[] = [];

  try {
    const news = await prisma.system_news.findMany({
      where: { active: 1 },
      orderBy: { created_at: 'desc' },
      take: NOTIFICATIONS_LIMIT
    });
    for (const n of news) {
      out.push({
        id: `news_${String(n.id)}`,
        type: 'system',
        title: n.author_name && n.author_name.trim() ? n.author_name.trim() : 'Comunicado',
        message: String(n.text || '').trim().slice(0, 280),
        link: n.link && String(n.link).trim() ? String(n.link).trim() : null,
        createdAt: Number(n.created_at) || Date.now(),
        read: false
      });
    }
  } catch {
    /* sem novidade do sistema */
  }

  try {
    const boxesAgg = await prisma.unopened_boxes.aggregate({
      where: { user_id: userId },
      _sum: { qty: true }
    });
    const totalBoxes = Number(boxesAgg._sum.qty || 0);
    if (totalBoxes > 0) {
      out.unshift({
        id: 'unopened_boxes',
        type: 'reward',
        title: 'Caixas disponíveis',
        message:
          totalBoxes === 1
            ? 'Você tem 1 caixa pronta para abrir em "Caixas da Sorte".'
            : `Você tem ${totalBoxes} caixas prontas para abrir em "Caixas da Sorte".`,
        link: '/lucky-boxes',
        createdAt: Date.now(),
        read: false
      });
    }
  } catch {
    /* ignore */
  }

  return out.slice(0, NOTIFICATIONS_LIMIT);
}

/** Eventos: ainda não há tabela global de torneios. Devolve lista vazia (frontend mostra empty state). */
function buildActiveEvents(): DashboardEvent[] {
  return [];
}

/**
 * Ranking global por hash total (soma das moedas).
 * Reutiliza `getPublicMiningRankingPayload`; agrega o total e devolve top 10
 * + posição do utilizador atual (se aplicável).
 */
async function buildRankingForDashboard(
  userId: number,
  myUsername: string | null
): Promise<DashboardRanking> {
  const payload = await getPublicMiningRankingPayload();
  const all = payload.ranking
    .map((r) => {
      let total = 0;
      for (const v of Object.values(r.coins || {})) total += num(v);
      return { user_id: r.user_id, username: r.username, total };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);

  const top: DashboardRankingEntry[] = all.slice(0, RANKING_TOP_LIMIT).map((r, idx) => ({
    position: idx + 1,
    username: r.username,
    hash: Math.round(r.total * 100) / 100,
    hashUnit: 'H/s',
    isMe: r.user_id === userId
  }));

  let myPosition: number | null = null;
  let myHash = 0;
  const meIdx = all.findIndex((r) => r.user_id === userId);
  if (meIdx >= 0) {
    myPosition = meIdx + 1;
    myHash = Math.round(all[meIdx].total * 100) / 100;
  }

  // Garante que aparece pelo menos a entrada do user no topo se ele tem hash.
  if (myPosition !== null && !top.some((t) => t.isMe) && myUsername) {
    top[top.length - 1] = {
      position: myPosition,
      username: myUsername,
      hash: myHash,
      hashUnit: 'H/s',
      isMe: true
    };
  }

  return { top, myPosition, myHash };
}

export async function buildDashboardStatePayload(userId: number): Promise<DashboardStateDto> {
  const u = await prisma.users.findUnique({
    where: { id: userId },
    select: { username: true }
  });
  const myUsername = u?.username ? String(u.username) : null;

  const header = await computePlayerGameHeaderSnapshot(userId);
  const [wallet, miner, notifications, ranking] = await Promise.all([
    buildWalletSummaryForDashboard(userId),
    buildMinerStateForDashboard(userId, header.totalHash, header.hashByCoinId),
    buildNotificationsForDashboard(userId),
    buildRankingForDashboard(userId, myUsername)
  ]);
  const events = buildActiveEvents();

  return {
    ok: true,
    serverTime: Date.now(),
    miner,
    wallet,
    ecosystemModules: ecosystemModulesForResponse(),
    notifications,
    events,
    ranking,
    quickAccess: [...QUICK_ACCESS]
  };
}
