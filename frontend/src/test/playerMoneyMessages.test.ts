import { describe, it, expect } from 'vitest';
import {
  appendUsdcShortfallLine,
  looksLikeInsufficientUsdcMessage,
} from '../utils/playerMoneyMessages';

describe('playerMoneyMessages', () => {
  describe('appendUsdcShortfallLine', () => {
    it('devolve só a mensagem base quando missing é inválido', () => {
      expect(appendUsdcShortfallLine('Erro.', undefined)).toBe('Erro.');
      expect(appendUsdcShortfallLine('Erro.', null)).toBe('Erro.');
      expect(appendUsdcShortfallLine('Erro.', 0)).toBe('Erro.');
      expect(appendUsdcShortfallLine('Erro.', -1)).toBe('Erro.');
      expect(appendUsdcShortfallLine('Erro.', 'x')).toBe('Erro.');
    });

    it('acrescenta linha com missing positivo', () => {
      expect(appendUsdcShortfallLine('Saldo USDC insuficiente.', 12.345)).toBe(
        'Saldo USDC insuficiente.\n\nFaltam ~USDC 12.35.'
      );
    });

    it('devolve só a linha de falta quando a base está vazia', () => {
      expect(appendUsdcShortfallLine('', 5)).toBe('Faltam ~USDC 5.00.');
      expect(appendUsdcShortfallLine('   ', 5)).toBe('Faltam ~USDC 5.00.');
    });

    it('não duplica se o texto já fala em faltam USDC', () => {
      expect(appendUsdcShortfallLine('Faltam USDC 1.00 na conta.', 2)).toBe('Faltam USDC 1.00 na conta.');
    });
  });

  describe('looksLikeInsufficientUsdcMessage', () => {
    it('identifica mensagens típicas', () => {
      expect(looksLikeInsufficientUsdcMessage('Saldo USDC insuficiente.')).toBe(true);
      expect(looksLikeInsufficientUsdcMessage('saldo insuficiente para usdc')).toBe(true);
    });

    it('rejeita texto irrelevante', () => {
      expect(looksLikeInsufficientUsdcMessage('Caixa inválida.')).toBe(false);
      expect(looksLikeInsufficientUsdcMessage('insuficiente')).toBe(false);
    });
  });
});
