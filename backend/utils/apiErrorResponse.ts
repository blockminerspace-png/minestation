import type { Response } from 'express';

const IS_PROD = process.env.NODE_ENV === 'production';

/** Resposta genérica em produção (sem detalhes de BD / stack). */
export const INTERNAL_ERROR_PUBLIC = 'Erro interno. Tenta mais tarde.';

function errorDetails(err: unknown): { msg: string; stack?: string } {
  if (err instanceof Error) return { msg: err.message, stack: err.stack };
  return { msg: String(err) };
}

/**
 * Loga o erro no servidor; em produção o cliente recebe mensagem fixa.
 * Em desenvolvimento devolve `err.message` para depuração rápida.
 */
export function sendInternalError(res: Response, logTag: string, err: unknown): void {
  if (res.headersSent) return;
  const { msg, stack } = errorDetails(err);
  if (IS_PROD) {
    console.error(`[500] ${logTag}`, msg, stack || '');
    res.status(500).json({ error: INTERNAL_ERROR_PUBLIC });
  } else {
    console.error(`[500] ${logTag}`, err);
    res.status(500).json({ error: msg || INTERNAL_ERROR_PUBLIC });
  }
}

/**
 * Igual a `sendInternalError`, mas em produção o corpo usa `publicMessage` (texto curto e seguro já definido pela rota).
 * Em desenvolvimento prefere a mensagem técnica quando existir.
 */
export function sendInternalErrorSafeMessage(
  res: Response,
  logTag: string,
  err: unknown,
  publicMessage: string
): void {
  if (res.headersSent) return;
  const { msg, stack } = errorDetails(err);
  if (IS_PROD) {
    console.error(`[500] ${logTag}`, msg, stack || '');
    res.status(500).json({ error: publicMessage });
  } else {
    console.error(`[500] ${logTag}`, err);
    res.status(500).json({ error: msg || publicMessage });
  }
}

/**
 * Resposta 500 com campos extra (ex.: `{ ok: false }`, `{ report }`).
 * Em produção `error` é sempre `publicErrorMessage` (sem concatenar mensagem da exceção).
 */
export function sendInternalErrorShape(
  res: Response,
  logTag: string,
  err: unknown,
  extra: Record<string, unknown>,
  publicErrorMessage: string = INTERNAL_ERROR_PUBLIC
): void {
  if (res.headersSent) return;
  const { msg, stack } = errorDetails(err);
  if (IS_PROD) {
    console.error(`[500] ${logTag}`, msg, stack || '');
    res.status(500).json({ ...extra, error: publicErrorMessage });
  } else {
    console.error(`[500] ${logTag}`, err);
    res.status(500).json({ ...extra, error: msg || publicErrorMessage });
  }
}
