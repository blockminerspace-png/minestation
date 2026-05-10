#!/usr/bin/env node
/**
 * Diagnóstico read-only de baterias / racks / stock (Postgres).
 * Execução: `node scripts/diagnose-battery-state.mjs` na raiz do repositório.
 * Reutiliza a mesma lógica que `backend/scripts/battery_diagnostic_readonly.mjs`.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(__dirname, '../backend/scripts/battery_diagnostic_readonly.mjs');
const child = spawn(process.execPath, [target], { stdio: 'inherit', cwd: path.join(__dirname, '..') });
child.on('exit', (code) => process.exit(code ?? 1));
