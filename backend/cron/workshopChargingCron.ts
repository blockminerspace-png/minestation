import type { Pool } from 'pg';
import { sanitizeForLog } from '../lib/safeText.js';

const LOG_PREFIX = '[WorkshopCharging]';
const DEFAULT_INTERVAL_MS = 30_000;

/**
 * Sistema de carregamento de baterias foi descontinuado: todas as baterias são
 * agora infinitas. O cron foi mantido como API estável (chamado em vários sítios),
 * mas não faz qualquer mutação na BD.
 */

export async function tickWorkshopCharging(_pool: Pool, _nowMs = Date.now()): Promise<void> {
  // Sistema de carregamento descontinuado: baterias são infinitas, nada para
  // transferir. Mantém a assinatura para compatibilidade com chamadores existentes.
  return;
}

export type StartWorkshopChargingCronOptions = {
  intervalMs?: number;
  startupDelayMs?: number;
  workerRole?: string;
};

export function startWorkshopChargingCron(_pool: Pool, opts: StartWorkshopChargingCronOptions = {}): void {
  const role = opts.workerRole ?? process.env.WORKER_ROLE ?? 'ALL';
  if (role !== 'BACKGROUND' && role !== 'ALL') return;
  console.log(
    `${LOG_PREFIX} desactivado: sistema de baterias infinitas (intervalMs=%s ignorado)`,
    sanitizeForLog(String(opts.intervalMs ?? DEFAULT_INTERVAL_MS), 16)
  );
}
