import { describe, expect, it } from 'vitest';
import {
  gamePathFromView,
  gameViewFromEnglishPathname,
  isEnglishGameSpaPath,
  englishSlugFromPathname
} from '../lib/gamePathRoutes';

describe('gamePathRoutes', () => {
  it('maps English paths to internal views', () => {
    expect(gameViewFromEnglishPathname('/servers')).toBe('servers');
    expect(gameViewFromEnglishPathname('/workshop')).toBe('oficina');
    expect(gameViewFromEnglishPathname('/miner-shop')).toBe('hardware_store');
    expect(gameViewFromEnglishPathname('/black-market')).toBe('black_market');
    expect(gameViewFromEnglishPathname('/lucky-boxes')).toBe('lucky_store');
    expect(gameViewFromEnglishPathname('/wheel')).toBe('roleta');
    expect(gameViewFromEnglishPathname('/upgrades')).toBe('upgrade');
  });

  it('returns null for unknown or root', () => {
    expect(gameViewFromEnglishPathname('/')).toBeNull();
    expect(gameViewFromEnglishPathname('/nope')).toBeNull();
    expect(gameViewFromEnglishPathname('/api/foo')).toBeNull();
  });

  it('gamePathFromView is stable', () => {
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
});
