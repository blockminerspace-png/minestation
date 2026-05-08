import { Prisma } from '@prisma/client';
import type { Response } from 'express';

export type TransactionalDbConflictOptions = {
  /** Ex.: `{ ok: false }` para alinhar ao contrato JSON da rota. */
  mergeBody?: Record<string, unknown>;
};

function buildConflictBody(
  code: string,
  error: string,
  mergeBody?: Record<string, unknown>
): Record<string, unknown> {
  return { ...(mergeBody ?? {}), error, forceReload: true, code };
}

function isPostgresUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const o = err as Record<string, unknown>;
  if (o.code === '23505') return true;
  const cause = o.cause;
  if (cause && typeof cause === 'object' && (cause as Record<string, unknown>).code === '23505') return true;
  return false;
}

function rawQueryErrorLooksLikeUniqueViolation(err: Prisma.PrismaClientKnownRequestError): boolean {
  if (err.code !== 'P2010') return false;
  const parts: string[] = [err.message];
  const meta = err.meta;
  if (meta && typeof meta === 'object') {
    parts.push(JSON.stringify(meta));
  }
  const blob = parts.join(' ');
  return /\b23505\b/i.test(blob) || /unique constraint/i.test(blob);
}

/**
 * Conflitos de BD em fluxos transaccionais (duplicados, corrida, violação única em SQL raw).
 * Respostas seguras: sem nomes de tabelas/colunas; opcionalmente funde campos extra no JSON.
 */
export function trySendTransactionalDbConflictResponse(
  res: Response,
  err: unknown,
  options?: TransactionalDbConflictOptions
): boolean {
  if (res.headersSent) return false;
  const merge = options?.mergeBody;

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res
        .status(409)
        .json(
          buildConflictBody(
            'DUPLICATE',
            'Conflito de dados únicos no servidor. Recarrega a página (F5) para sincronizar.',
            merge
          )
        );
      return true;
    }
    if (err.code === 'P2034') {
      res
        .status(409)
        .json(
          buildConflictBody(
            'TRANSACTION_CONFLICT',
            'Conflito ao gravar (outra operação em curso). Tenta de novo ou recarrega (F5).',
            merge
          )
        );
      return true;
    }
    if (rawQueryErrorLooksLikeUniqueViolation(err)) {
      res
        .status(409)
        .json(
          buildConflictBody(
            'UNIQUE_VIOLATION',
            'Conflito ao gravar dados. Recarrega a página (F5) para sincronizar.',
            merge
          )
        );
      return true;
    }
  }

  if (isPostgresUniqueViolation(err)) {
    res
      .status(409)
      .json(
        buildConflictBody(
          'UNIQUE_VIOLATION',
          'Conflito ao gravar dados. Recarrega a página (F5) para sincronizar.',
          merge
        )
      );
    return true;
  }

  return false;
}
