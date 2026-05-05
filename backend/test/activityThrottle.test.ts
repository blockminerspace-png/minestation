import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ActivityThrottleMaps,
  parseActivityThrottleMs,
  parseActivityThrottleMapMax,
  resolveActivityThrottleConfig
} from '../lib/activityThrottle.js';

describe('parseActivityThrottleMs', () => {
  it('usa fallback quando raw vazio ou inválido', () => {
    expect(parseActivityThrottleMs(undefined, 99, 10, 200)).toBe(99);
    expect(parseActivityThrottleMs('', 99, 10, 200)).toBe(99);
    expect(parseActivityThrottleMs('nope', 99, 10, 200)).toBe(99);
  });

  it('clampa ao intervalo [min, max]', () => {
    expect(parseActivityThrottleMs('5', 100, 20, 200)).toBe(20);
    expect(parseActivityThrottleMs('9999', 100, 20, 200)).toBe(200);
    expect(parseActivityThrottleMs('77', 100, 20, 200)).toBe(77);
  });
});

describe('parseActivityThrottleMapMax', () => {
  it('default ~100k e clampa', () => {
    expect(parseActivityThrottleMapMax(undefined)).toBe(100_000);
    expect(parseActivityThrottleMapMax('abc')).toBe(100_000);
    expect(parseActivityThrottleMapMax('3')).toBe(5_000);
    expect(parseActivityThrottleMapMax('600000')).toBe(500_000);
  });
});

describe('resolveActivityThrottleConfig', () => {
  let envBackup: NodeJS.ProcessEnv;

  beforeEach(() => {
    envBackup = { ...process.env };
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('lê variáveis de ambiente quando definidas', () => {
    process.env.ACTIVITY_LAST_ACTIVE_MIN_MS = '45000';
    process.env.ACTIVITY_HISTORY_IP_MIN_MS = '90000';
    process.env.ACTIVITY_THROTTLE_MAP_MAX = '20000';
    const c = resolveActivityThrottleConfig(process.env);
    expect(c.lastActiveMinMs).toBe(45_000);
    expect(c.historyIpMinMs).toBe(90_000);
    expect(c.mapMax).toBe(20_000);
  });
});

describe('ActivityThrottleMaps', () => {
  const baseCfg = {
    lastActiveMinMs: 30_000,
    historyIpMinMs: 60_000,
    mapMax: 100_000
  };

  let maps: ActivityThrottleMaps;

  beforeEach(() => {
    maps = new ActivityThrottleMaps(baseCfg);
  });

  it('primeira vez permite last_active e history_ip', () => {
    expect(maps.shouldWriteLastActive(1, 1_000)).toBe(true);
    expect(maps.shouldWriteHistoryIp(1, '1.2.3.4', 1_000)).toBe(true);
  });

  it('bloqueia last_active dentro da janela', () => {
    maps.markLastActiveWritten(1, 1_000);
    expect(maps.shouldWriteLastActive(1, 1_000 + 29_999)).toBe(false);
    expect(maps.shouldWriteLastActive(1, 1_000 + 30_000)).toBe(true);
  });

  it('bloqueia history_ip dentro da janela por (user, ip)', () => {
    maps.markHistoryIpWritten(1, '10.0.0.1', 5_000);
    expect(maps.shouldWriteHistoryIp(1, '10.0.0.1', 5_000 + 59_999)).toBe(false);
    expect(maps.shouldWriteHistoryIp(1, '10.0.0.2', 5_000 + 1)).toBe(true);
    expect(maps.shouldWriteHistoryIp(2, '10.0.0.1', 5_000 + 1)).toBe(true);
  });

  it('prune remove entradas com mais de 10 min quando mapa excede mapMax', () => {
    const small = new ActivityThrottleMaps({ ...baseCfg, mapMax: 3 });
    const now = 10_000_000;
    small.lastActiveWriteAt.set(1, now - 700_000);
    small.lastActiveWriteAt.set(2, now - 1);
    small.lastActiveWriteAt.set(3, now - 2);
    small.lastActiveWriteAt.set(4, now - 3);
    small.prune(now);
    expect(small.lastActiveWriteAt.has(1)).toBe(false);
    expect(small.lastActiveWriteAt.size).toBeLessThan(4);
  });

  it('prune não corre quando abaixo do limite', () => {
    maps.lastActiveWriteAt.set(1, 100);
    maps.prune(200);
    expect(maps.lastActiveWriteAt.get(1)).toBe(100);
  });

  it('prune também limpa historyIpUpsertAt antigo quando excede mapMax', () => {
    const small = new ActivityThrottleMaps({ ...baseCfg, mapMax: 2 });
    const now = 20_000_000;
    small.historyIpUpsertAt.set('1:a', now - 700_000);
    small.historyIpUpsertAt.set('1:b', now - 1);
    small.historyIpUpsertAt.set('1:c', now - 2);
    small.prune(now);
    expect(small.historyIpUpsertAt.has('1:a')).toBe(false);
  });
});
