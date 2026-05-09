import { describe, it, expect } from 'vitest';
import {
  encodePartnerYoutubeVideoCursor,
  parsePartnerYoutubeVideoCursor,
  partnerYoutubeUtcDayKeyYYYYMMDD
} from '../utils/partnerYoutubeHelpers.js';
import { validateAndCanonicalYoutubeUrl, youtubeThumbnailUrl } from '../modules/partners/partners.youtubeUrl.js';

describe('partnerYoutubeUtcDayKeyYYYYMMDD', () => {
  it('produz YYYYMMDD em UTC', () => {
    const d = Date.UTC(2026, 4, 9, 23, 0, 0);
    expect(partnerYoutubeUtcDayKeyYYYYMMDD(d)).toBe(20260509);
  });
});

describe('parsePartnerYoutubeVideoCursor', () => {
  it('faz round-trip com encode', () => {
    const c = parsePartnerYoutubeVideoCursor(encodePartnerYoutubeVideoCursor(12345, 'abc-def-uuid'));
    expect(c?.sortTs).toBe(12345n);
    expect(c?.id).toBe('abc-def-uuid');
  });

  it('rejeita cursor inválido', () => {
    expect(parsePartnerYoutubeVideoCursor('')).toBeNull();
    expect(parsePartnerYoutubeVideoCursor('x_y')).toBeNull();
  });
});

describe('validateAndCanonicalYoutubeUrl', () => {
  it('aceita watch e youtu.be', () => {
    expect(
      validateAndCanonicalYoutubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.videoId
    ).toBe('dQw4w9WgXcQ');
    expect(validateAndCanonicalYoutubeUrl('https://youtu.be/dQw4w9WgXcQ')?.canonicalUrl).toContain('watch?v=');
  });

  it('rejeita domínio externo', () => {
    expect(validateAndCanonicalYoutubeUrl('https://evil.com/watch?v=dQw4w9WgXcQ')).toBeNull();
  });

  it('rejeita javascript:', () => {
    expect(validateAndCanonicalYoutubeUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('youtubeThumbnailUrl', () => {
  it('só aceita id de 11 caracteres', () => {
    expect(youtubeThumbnailUrl('dQw4w9WgXcQ')).toContain('dQw4w9WgXcQ');
    expect(youtubeThumbnailUrl('short')).toBe('');
  });
});
