import { describe, it, expect } from 'vitest';
import { scoreProbePath, scoreForHttpResponse } from '../utils/securityThreatObserver.js';

describe('securityThreatObserver', () => {
  it('scoreProbePath detecta probes comuns', () => {
    expect(scoreProbePath('/x/.env')).toBeGreaterThan(0);
    expect(scoreProbePath('/wp-admin/install.php')).toBeGreaterThan(0);
  });

  it('scoreProbePath ignora ACME legítimo', () => {
    expect(scoreProbePath('/.well-known/acme-challenge/abc')).toBe(0);
    expect(scoreProbePath('/.well-known/pki-validation/file.txt')).toBe(0);
  });

  it('scoreForHttpResponse soma 404 em URL de probe e UA malicioso', () => {
    expect(scoreForHttpResponse(404, '/vendor/phpunit/foo', 'Mozilla/5.0')).toBeGreaterThanOrEqual(24 + 8);
    expect(scoreForHttpResponse(200, '/api/health', 'sqlmap/1.0')).toBeGreaterThanOrEqual(20);
  });
});
