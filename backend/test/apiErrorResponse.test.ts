import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Response } from 'express';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

function mockResponse(): Response {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  return {
    headersSent: false,
    status,
    json,
  } as unknown as Response;
}

describe('apiErrorResponse (NODE_ENV≠production)', () => {
  const prev = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env.NODE_ENV = prev;
  });

  it('sendInternalError devolve mensagem técnica em JSON', async () => {
    const { sendInternalError } = await import('../utils/apiErrorResponse.js');
    const res = mockResponse();
    sendInternalError(res, '/api/x', new Error('boom'));
    expect(res.status).toHaveBeenCalledWith(500);
    const chain = (res.status as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    expect(chain.json).toHaveBeenCalledWith({ error: 'boom' });
  });

  it('sendInternalErrorSafeMessage prefere mensagem técnica em dev', async () => {
    const { sendInternalErrorSafeMessage } = await import('../utils/apiErrorResponse.js');
    const res = mockResponse();
    sendInternalErrorSafeMessage(res, '/api/y', new Error('hidden'), 'Visível');
    const chain = (res.status as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    expect(chain.json).toHaveBeenCalledWith({ error: 'hidden' });
  });

  it('sendInternalErrorShape junta campos extra', async () => {
    const { sendInternalErrorShape } = await import('../utils/apiErrorResponse.js');
    const res = mockResponse();
    sendInternalErrorShape(res, '/api/z', new Error('e'), { ok: false, step: 1 }, 'Falhou');
    const chain = (res.status as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    expect(chain.json).toHaveBeenCalledWith({ ok: false, step: 1, error: 'e' });
  });

  it('sendInternalErrorSafeMessage e sendInternalErrorShape não escrevem se headersSent', async () => {
    const { sendInternalErrorSafeMessage, sendInternalErrorShape } = await import('../utils/apiErrorResponse.js');
    const status = vi.fn();
    const res = { headersSent: true, status, json: vi.fn() } as unknown as Response;
    sendInternalErrorSafeMessage(res, '/a', new Error('x'), 'pub');
    sendInternalErrorShape(res, '/b', new Error('y'), { ok: false }, 'pub2');
    expect(status).not.toHaveBeenCalled();
  });

  it('respondIfHttpControlledError envia status e corpo do HttpControlledError', async () => {
    const { HttpControlledError, respondIfHttpControlledError } = await import('../utils/apiErrorResponse.js');
    const res = mockResponse();
    const handled = respondIfHttpControlledError(res, new HttpControlledError(400, { ok: false, error: 'x' }));
    expect(handled).toBe(true);
    expect(res.status).toHaveBeenCalledWith(400);
    const chain = (res.status as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    expect(chain.json).toHaveBeenCalledWith({ ok: false, error: 'x' });
  });

  it('respondIfHttpControlledError devolve false para erro normal', async () => {
    const { respondIfHttpControlledError } = await import('../utils/apiErrorResponse.js');
    const res = mockResponse();
    expect(respondIfHttpControlledError(res, new Error('plain'))).toBe(false);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('apiErrorResponse (production)', () => {
  const prev = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
    process.env.NODE_ENV = 'production';
  });

  afterEach(() => {
    process.env.NODE_ENV = prev;
  });

  it('sendInternalError mascara erro', async () => {
    const { sendInternalError, INTERNAL_ERROR_PUBLIC } = await import('../utils/apiErrorResponse.js');
    const res = mockResponse();
    sendInternalError(res, '/api/x', new Error('secret'));
    const chain = (res.status as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    expect(chain.json).toHaveBeenCalledWith({ error: INTERNAL_ERROR_PUBLIC });
  });

  it('sendInternalErrorSafeMessage usa publicMessage em produção', async () => {
    const { sendInternalErrorSafeMessage } = await import('../utils/apiErrorResponse.js');
    const res = mockResponse();
    sendInternalErrorSafeMessage(res, '/api/y', new Error('secret'), 'Mensagem segura');
    const chain = (res.status as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    expect(chain.json).toHaveBeenCalledWith({ error: 'Mensagem segura' });
  });

  it('sendInternalError não escreve se headersSent', async () => {
    const { sendInternalError } = await import('../utils/apiErrorResponse.js');
    const status = vi.fn();
    const res = { headersSent: true, status, json: vi.fn() } as unknown as Response;
    sendInternalError(res, '/api/z', new Error('late'));
    expect(status).not.toHaveBeenCalled();
  });

  it('sendInternalErrorShape em produção não escreve se headersSent', async () => {
    const { sendInternalErrorShape, INTERNAL_ERROR_PUBLIC } = await import('../utils/apiErrorResponse.js');
    const status = vi.fn();
    const res = { headersSent: true, status, json: vi.fn() } as unknown as Response;
    sendInternalErrorShape(res, '/api/w', new Error('late'), { ok: false }, INTERNAL_ERROR_PUBLIC);
    expect(status).not.toHaveBeenCalled();
  });
});
