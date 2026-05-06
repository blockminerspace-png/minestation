/** Estado partilhado entre `miningYieldCron` e `server.js` (ranking / admin) sem dependência circular. */

export type GlobalNetworkStatsState = {
  hashrates: Record<string, number>;
  activeMiners: number;
  activeMinersByCoin: Record<string, number>;
  ranking: Array<{
    user_id: number;
    username: unknown;
    coins: Record<string, number>;
    totalPower: number;
  }>;
};

let globalNetworkStats: GlobalNetworkStatsState = {
  hashrates: {},
  activeMiners: 0,
  activeMinersByCoin: {},
  ranking: [],
};

export function getGlobalNetworkStats(): GlobalNetworkStatsState {
  return globalNetworkStats;
}

export function setGlobalNetworkStats(next: GlobalNetworkStatsState): void {
  globalNetworkStats = next;
}
