/**
 * Garante que o ficheiro principal do jogo ainda declara o pipeline de autosave legado
 * (para a auditoria TODO5 / migração por domínio não regredir silenciosamente).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('Auditoria requestSave (frontend/App.tsx)', () => {
  it('contém requestSave, saveTrigger e runPlayerSaveWithRetries', () => {
    const appTsx = path.join(__dirname, '../../frontend/App.tsx');
    const src = readFileSync(appTsx, 'utf8');
    expect(src).toContain('requestSave(');
    expect(src).toContain('saveTrigger');
    expect(src).toContain('runPlayerSaveWithRetries');
    expect(src).toContain('apiSaveGameState');
  });
});
