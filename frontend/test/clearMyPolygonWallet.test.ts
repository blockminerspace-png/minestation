import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('clearMyPolygonWallet', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true })
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('DELETE /api/me/polygon-wallet com credentials e ok true em 200', async () => {
    const { clearMyPolygonWallet } = await import('../services/api');
    const out = await clearMyPolygonWallet();
    expect(out.ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      '/api/me/polygon-wallet',
      expect.objectContaining({ method: 'DELETE', credentials: 'include' })
    );
  });

  it('ok false e error do JSON quando resposta não ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ error: 'Serviço indisponível' })
      })
    );
    const { clearMyPolygonWallet } = await import('../services/api');
    const out = await clearMyPolygonWallet();
    expect(out.ok).toBe(false);
    expect(out.error).toBe('Serviço indisponível');
  });

  it('ok false em falha de rede', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const { clearMyPolygonWallet } = await import('../services/api');
    const out = await clearMyPolygonWallet();
    expect(out.ok).toBe(false);
    expect(out.error).toBe('Erro de rede.');
  });

  it('ok false usa status quando JSON não tem error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => {
          throw new SyntaxError('not json');
        }
      })
    );
    const { clearMyPolygonWallet } = await import('../services/api');
    const out = await clearMyPolygonWallet();
    expect(out.ok).toBe(false);
    expect(out.error).toBe('Erro 502');
  });
});
