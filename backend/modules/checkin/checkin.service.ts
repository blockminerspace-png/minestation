/**
 * Check-in diário (substitui carregamento de baterias).
 *
 * Regras (servidor é a fonte de verdade):
 *  - Janela diária = dia local em America/Sao_Paulo (00:00–23:59).
 *  - Check-in idempotente por dia: clicar várias vezes no mesmo dia não
 *    altera streak nem concede recompensa adicional.
 *  - Se o último check-in foi no dia BRT imediatamente anterior, `streak`
 *    incrementa em 1; caso contrário, reinicia em 1.
 *  - Sempre que `streak` atinge um múltiplo de 7 (7, 14, 21, …), o jogador
 *    ganha 1 instância UUID de `battery_estelar` em `stored_batteries`.
 *  - Enquanto `last_checkin_day != hoje BRT`, o cron de mineração não credita
 *    produção (rigs ficam congeladas).
 */

import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import db from '../../config/db.js';

export const CHECKIN_TIMEZONE = 'America/Sao_Paulo';
export const CHECKIN_REWARD_ITEM_ID = 'battery_estelar';
export const CHECKIN_REWARD_EVERY_DAYS = 7;

export type CheckinStatus = {
  today: string;
  timezone: string;
  lastCheckinDay: string | null;
  streak: number;
  todayCheckedIn: boolean;
  frozen: boolean;
  /** Próximo reset (ms, epoch) — meia-noite BRT do dia seguinte ao actual. */
  nextResetMs: number;
  /** Posição relativa dentro do ciclo de 7 dias (0..7). */
  rewardCycleProgress: number;
  rewardCycleSize: number;
};

export type CheckinResult = CheckinStatus & {
  /** True quando este pedido aplicou um novo check-in (não-idempotente). */
  performed: boolean;
  /** Quantas baterias estelar foram concedidas neste pedido (0 ou 1). */
  rewardGranted: number;
  /** True se a sequência reiniciou agora (streak voltou para 1 vinda de >0 ou nula). */
  streakReset: boolean;
};

const DAY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `formatToParts` com `timeZone` é a forma canónica de obter calendário
 * local sem depender de variáveis de ambiente do processo.
 */
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CHECKIN_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

/** Devolve o dia local America/Sao_Paulo no formato `YYYY-MM-DD` para o instante dado. */
export function brtDayFromMs(ms: number): string {
  const safe = Number.isFinite(ms) ? ms : Date.now();
  return dayFormatter.format(new Date(safe));
}

/** `YYYY-MM-DD` que precede o dia recebido (sem atravessar para fuso UTC). */
export function previousBrtDay(day: string): string {
  if (!DAY_REGEX.test(day)) return day;
  const [y, m, d] = day.split('-').map((p) => parseInt(p, 10));
  // Usa UTC só como aritmética calendárica (subtrai 1 dia); não há
  // ambiguidade de fuso porque tratamos sempre como datas civis.
  const base = Date.UTC(y, m - 1, d);
  const prev = new Date(base - 24 * 3600 * 1000);
  const yy = prev.getUTCFullYear();
  const mm = String(prev.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(prev.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Próximo "midnight America/Sao_Paulo" estritamente após `nowMs` (em ms epoch).
 *
 * Estratégia: itera adiante (+5 min) e detecta o instante onde o dia local muda;
 * depois faz busca binária para precisão à milissegundo. Evita depender de
 * cálculos directos de offset (BRT actualmente -3h, mas robustez para qualquer TZ).
 */
export function nextBrtMidnightMs(nowMs: number): number {
  const startDay = brtDayFromMs(nowMs);
  let lo = nowMs;
  let hi = nowMs + 25 * 3600 * 1000; // BRT não tem DST, mas folga garante > 24h
  while (brtDayFromMs(hi) === startDay) hi += 60 * 60 * 1000;
  while (hi - lo > 250) {
    const mid = Math.floor((lo + hi) / 2);
    if (brtDayFromMs(mid) === startDay) lo = mid;
    else hi = mid;
  }
  return hi;
}

type GameStateRow = {
  last_checkin_day: string | null;
  checkin_streak: number | string | null;
};

/**
 * Lê a row de `game_states` (cria se não existir, com defaults).
 * Não usa Prisma directamente para reaproveitar o pool já configurado nas rotas.
 */
async function readGameStateForCheckin(
  client: PoolClient,
  userId: number,
  forUpdate: boolean
): Promise<GameStateRow | null> {
  const sql = `SELECT last_checkin_day, checkin_streak
                 FROM game_states
                WHERE user_id = $1
                ${forUpdate ? 'FOR UPDATE' : ''}`;
  const r = await client.query<GameStateRow>(sql, [userId]);
  if (!r.rowCount) return null;
  return r.rows[0];
}

function streakNumber(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? '0'), 10);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function buildStatus(
  today: string,
  lastCheckinDay: string | null,
  streak: number,
  nowMs: number
): CheckinStatus {
  const todayCheckedIn = lastCheckinDay === today;
  const frozen = !todayCheckedIn;
  const cycleSize = CHECKIN_REWARD_EVERY_DAYS;
  const cycleProgress = streak === 0 ? 0 : streak % cycleSize === 0 ? cycleSize : streak % cycleSize;
  return {
    today,
    timezone: CHECKIN_TIMEZONE,
    lastCheckinDay,
    streak,
    todayCheckedIn,
    frozen,
    nextResetMs: nextBrtMidnightMs(nowMs),
    rewardCycleProgress: cycleProgress,
    rewardCycleSize: cycleSize
  };
}

/** Snapshot do check-in (para `GET /api/checkin/status`). */
export async function getCheckinStatus(userId: number, nowMs: number = Date.now()): Promise<CheckinStatus> {
  const today = brtDayFromMs(nowMs);
  const client = await db.connect();
  try {
    const row = await readGameStateForCheckin(client, userId, false);
    if (!row) {
      return buildStatus(today, null, 0, nowMs);
    }
    return buildStatus(today, row.last_checkin_day, streakNumber(row.checkin_streak), nowMs);
  } finally {
    client.release();
  }
}

/**
 * Aplica um check-in para o utilizador. Idempotente por dia.
 * Devolve o estado pós-aplicação (mesmo quando idempotente).
 */
export async function performCheckin(userId: number, nowMs: number = Date.now()): Promise<CheckinResult> {
  const today = brtDayFromMs(nowMs);
  const yesterday = previousBrtDay(today);

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET statement_timeout = '5s'");

    const row = await readGameStateForCheckin(client, userId, true);
    if (!row) {
      await client.query('ROLLBACK');
      throw new Error('GAME_STATE_NOT_FOUND');
    }

    const prevStreak = streakNumber(row.checkin_streak);
    const prevDay = row.last_checkin_day;

    if (prevDay === today) {
      await client.query('ROLLBACK');
      const status = buildStatus(today, prevDay, prevStreak, nowMs);
      return { ...status, performed: false, rewardGranted: 0, streakReset: false };
    }

    let nextStreak: number;
    let streakReset = false;
    if (prevDay && prevDay === yesterday) {
      nextStreak = prevStreak + 1;
    } else {
      nextStreak = 1;
      streakReset = prevStreak !== 0 || prevDay !== null;
    }

    const grantsReward = nextStreak > 0 && nextStreak % CHECKIN_REWARD_EVERY_DAYS === 0;

    await client.query(
      `UPDATE game_states
          SET last_checkin_day = $2,
              checkin_streak = $3
        WHERE user_id = $1`,
      [userId, today, nextStreak]
    );

    let rewardGranted = 0;
    if (grantsReward) {
      const newId = crypto.randomUUID();
      const ins = await client.query(
        `INSERT INTO stored_batteries (id, user_id, item_id, display_name, image_url)
         SELECT $1, $2, u.id, u.name, NULLIF(BTRIM(COALESCE(u.image::text, '')), '')
           FROM upgrades u
          WHERE u.id = $3
            AND COALESCE(u.is_active, 1) <> 0
            AND (lower(COALESCE(u.type, '')) = 'battery' OR lower(COALESCE(u.category, '')) = 'battery')
          LIMIT 1`,
        [newId, userId, CHECKIN_REWARD_ITEM_ID]
      );
      rewardGranted = ins.rowCount ?? 0;
    }

    await client.query('COMMIT');

    const status = buildStatus(today, today, nextStreak, nowMs);
    return { ...status, performed: true, rewardGranted, streakReset };
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Helper barato (single read) para o cron de mineração descobrir se o
 * utilizador está congelado neste tick. Não usa lock — leitura best-effort.
 */
export async function isUserFrozenForToday(userId: number, nowMs: number = Date.now()): Promise<boolean> {
  const today = brtDayFromMs(nowMs);
  const client = await db.connect();
  try {
    const r = await client.query<{ last_checkin_day: string | null }>(
      'SELECT last_checkin_day FROM game_states WHERE user_id = $1',
      [userId]
    );
    if (!r.rowCount) return true; // sem game_state = trata como frozen (defensivo)
    return r.rows[0].last_checkin_day !== today;
  } finally {
    client.release();
  }
}
