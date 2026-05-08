/**
 * Estado em memória partilhado entre o cron de yield e o ranking / endpoints.
 * Mantém-se num único módulo para o worker BACKGROUND e imports do server.
 */

export const miningRuntimeStats = {
  globalNetworkHashrates: new Map<string, number>(),
  globalActiveMiners: 0,
  /** coinId → contagem de jogadores distintos a minerar essa moeda (último tick yield). */
  globalActiveMinersByCoin: new Map<string, number>()
};
