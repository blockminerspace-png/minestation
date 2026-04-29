
export enum HashUnit {
    H_S = 'H/s',
    KH_S = 'kH/s',
    MH_S = 'MH/s',
    GH_S = 'GH/s',
    TH_S = 'TH/s',
    PH_S = 'PH/s',
}

export interface CoinData {
    id: string;
    name: string;
    symbol: string;
    networkHashrate: number; // H/s
    blockReward: number;
    blockTime: number; // seconds
    priceUSD: number;
    algorithm: string;
    difficulty: number;
    multiplier?: number; // Para impulsionar hashrate individualmente
    color: string;
    description?: string;
    minProportion?: number;
    isActive?: number | boolean;
    usdcRate?: number;
    targetDailyUSD?: number; // Valor alvo de distribuição diária em USD
    realNetworkHashrate?: number;
    showInExchange?: boolean;
}

export interface CalculationResult {
    dailyCrypto: number;
    dailyUSD: number;
    weeklyUSD: number;
    monthlyUSD: number;
    yearlyUSD: number;
    breakdown: {
        hour: number;
        day: number;
        week: number;
        month: number;
    };
}
