import { describe, expect, it } from 'vitest';
import {
  gamePathFromView,
  gameViewFromEnglishPathname,
  isEnglishGameSpaPath,
  englishSlugFromPathname,
  isSpaIndexHtmlPath,
  PUBLIC_MAINTENANCE_SPA_PATH
} from '../lib/gamePathRoutes';

describe('gamePathRoutes', () => {
  it('maps English paths to internal views', () => {
    expect(gameViewFromEnglishPathname('/servers')).toBe('servers');
    expect(gameViewFromEnglishPathname('/inventory')).toBe('inventory');
    expect(gameViewFromEnglishPathname('/miner-shop')).toBe('hardware_store');
    expect(gameViewFromEnglishPathname('/black-market')).toBe('black_market');
    expect(gameViewFromEnglishPathname('/lucky-boxes')).toBe('lucky_store');
    expect(gameViewFromEnglishPathname('/wheel')).toBe('roleta');
    expect(gameViewFromEnglishPathname('/upgrades')).toBe('upgrade');
  });

  it('legacy /workshop URL is treated as unknown (workshop foi descontinuado)', () => {
    expect(gameViewFromEnglishPathname('/workshop')).toBeNull();
  });

  it('returns null for unknown or root', () => {
    expect(gameViewFromEnglishPathname('/')).toBeNull();
    expect(gameViewFromEnglishPathname('/nope')).toBeNull();
    expect(gameViewFromEnglishPathname('/api/foo')).toBeNull();
  });

  it('gamePathFromView is stable', () => {
    expect(gamePathFromView('servers')).toBe('/servers');
    expect(gamePathFromView('inventory')).toBe('/inventory');
    expect(gamePathFromView('wallet')).toBe('/wallet');
    expect(gamePathFromView('profile')).toBe('/profile');
  });

  it('isEnglishGameSpaPath', () => {
    expect(isEnglishGameSpaPath('/servers')).toBe(true);
    expect(isEnglishGameSpaPath('/')).toBe(false);
  });

  it('englishSlugFromPathname strips query', () => {
    expect(englishSlugFromPathname('/wallet?ref=1')).toBe('wallet');
  });

  it('PUBLIC_MAINTENANCE_SPA_PATH e isSpaIndexHtmlPath', () => {
    expect(PUBLIC_MAINTENANCE_SPA_PATH).toBe('/manutencao');
    expect(isSpaIndexHtmlPath('/manutencao')).toBe(true);
    expect(isSpaIndexHtmlPath('/MANUTENCAO')).toBe(true);
    expect(isSpaIndexHtmlPath('/servers')).toBe(true);
    expect(isSpaIndexHtmlPath('/nope')).toBe(false);
  });
});
