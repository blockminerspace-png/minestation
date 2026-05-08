import { Prisma } from '@prisma/client';
import type { Response } from 'express';

const IS_PROD = process.env.NODE_ENV === 'production';

/**
 * Mapeia erros do cliente Prisma para status/corpo HTTP seguros.
 * Devolve `null` se `err` não for um erro Prisma tratado aqui.
 */
export function mapPrismaClientError(
  err: unknown
): { status: number; body: Record<string, unknown> } | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002':
        return {
          status: 409,
          body: {
            error: 'Este e-mail ou nome de utilizador já está em uso.',
            code: 'DUPLICATE'
          }
        };
      case 'P2025':
        return {
          status: 404,
          body: { error: 'Registo não encontrado.', code: 'NOT_FOUND' }
        };
      case 'P2003':
        return {
          status: 400,
          body: { error: 'Referência inválida.', code: 'FK_VIOLATION' }
        };
      case 'P2024':
        return {
          status: 503,
          body: {
            error: 'Operação excedeu o tempo limite. Tenta novamente.',
            code: 'TIMEOUT'
          }
        };
      case 'P2034':
        return {
          status: 409,
          body: {
            error: 'Conflito ao gravar. Tenta novamente.',
            code: 'TRANSACTION_CONFLICT'
          }
        };
      default:
        if (err.code.startsWith('P1')) {
          return {
            status: 503,
            body: {
              error: 'Base de dados indisponível. Tenta novamente.',
              code: IS_PROD ? 'DB_UNAVAILABLE' : err.code
            }
          };
        }
        return {
          status: 500,
          body: {
            error: 'Erro ao processar o pedido.',
            ...(IS_PROD ? {} : { code: err.code })
          }
        };
    }
  }
  if (err instanceof Prisma.PrismaClientValidationError) {
    return {
      status: 400,
      body: {
        error: 'Dados inválidos.',
        ...(IS_PROD ? {} : { code: 'PRISMA_VALIDATION' })
      }
    };
  }
  if (err instanceof Prisma.PrismaClientInitializationError) {
    return {
      status: 503,
      body: {
        error: 'Serviço temporariamente indisponível.',
        code: IS_PROD ? 'DB_INIT' : err.errorCode
      }
    };
  }
  if (err instanceof Prisma.PrismaClientRustPanicError) {
    return {
      status: 503,
      body: { error: 'Serviço temporariamente indisponível.', code: 'DB_PANIC' }
    };
  }
  if (err instanceof Prisma.PrismaClientUnknownRequestError) {
    return {
      status: 503,
      body: {
        error: 'Erro ao comunicar com a base de dados.',
        code: IS_PROD ? 'UNKNOWN_DB' : 'PRISMA_UNKNOWN'
      }
    };
  }
  return null;
}

/** Envia resposta JSON se `err` for Prisma mapeável; devolve se enviou. */
export function sendIfPrismaHttpError(res: Response, err: unknown, logTag: string): boolean {
  const mapped = mapPrismaClientError(err);
  if (!mapped || res.headersSent) return false;
  const details =
    err instanceof Error ? { msg: err.message, stack: err.stack } : { msg: String(err), stack: undefined };
  console.error(`[Prisma ${mapped.status}] ${logTag}`, details.msg, details.stack || '');
  res.status(mapped.status).json(mapped.body);
  return true;
}
