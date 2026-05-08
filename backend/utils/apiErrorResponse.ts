import type { Response } from 'express';
import { sendIfPrismaHttpError } from './prismaHttpResponse.js';

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

/** Como `sendInternalError`, mas mapeia primeiro erros do cliente Prisma (P2002, timeouts, etc.). */
export function sendInternalErrorOrPrisma(res: Response, logTag: string, err: unknown): void {
  if (sendIfPrismaHttpError(res, err, logTag)) return;
  sendInternalError(res, logTag, err);
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

/** Como `sendInternalErrorSafeMessage`, mas trata erros Prisma antes do 500 genérico. */
export function sendInternalErrorSafeMessageOrPrisma(
  res: Response,
  logTag: string,
  err: unknown,
  publicMessage: string
): void {
  if (sendIfPrismaHttpError(res, err, logTag)) return;
  sendInternalErrorSafeMessage(res, logTag, err, publicMessage);
}

/**
 * Resposta 500 com campos extra (ex.: `{ ok: false }`, `{ report }`).
 * Em produção `error` é sempre `publicErrorMessage` (sem concatenar mensagem da exceção).
 */
/** Erro de negócio com resposta HTTP explícita (corpo JSON já fechado). */
export class HttpControlledError extends Error {
  readonly statusCode: number;
  readonly jsonBody: Record<string, unknown>;
  constructor(statusCode: number, jsonBody: Record<string, unknown>) {
    const msg =
      typeof jsonBody.error === 'string'
        ? jsonBody.error
        : typeof jsonBody.message === 'string'
          ? jsonBody.message
          : 'Request failed';
    super(msg);
    this.name = 'HttpControlledError';
    this.statusCode = statusCode;
    this.jsonBody = jsonBody;
  }
}

/** Se `err` for `HttpControlledError`, envia `res.status(...).json(...)` e devolve `true`. */
export function respondIfHttpControlledError(res: Response, err: unknown): boolean {
  if (!(err instanceof HttpControlledError)) return false;
  if (!res.headersSent) {
    res.status(err.statusCode).json(err.jsonBody);
  }
  return true;
}

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

/** Como `sendInternalErrorShape`, mas trata erros Prisma antes do 500 genérico. */
export function sendInternalErrorShapeOrPrisma(
  res: Response,
  logTag: string,
  err: unknown,
  extra: Record<string, unknown>,
  publicErrorMessage: string = INTERNAL_ERROR_PUBLIC
): void {
  if (sendIfPrismaHttpError(res, err, logTag)) return;
  sendInternalErrorShape(res, logTag, err, extra, publicErrorMessage);
}
