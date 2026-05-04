import { describe, it, expect } from 'vitest';
import { sanitizeDeviceFingerprint } from '../models/deviceFingerprintModel.js';

describe('deviceFingerprintModel', () => {
  it('sanitizeDeviceFingerprint null para inválido', () => {
    expect(sanitizeDeviceFingerprint(null)).toBeNull();
    expect(sanitizeDeviceFingerprint([])).toBeNull();
    expect(sanitizeDeviceFingerprint({})).toBeNull();
  });

  it('sanitizeDeviceFingerprint aceita payload mínimo', () => {
    const r = sanitizeDeviceFingerprint({
      visitorId: 'a'.repeat(64),
      components: { userAgent: 'Mozilla', hardwareConcurrency: 8 },
    });
    expect(r).not.toBeNull();
    expect(r!.fingerprintHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
