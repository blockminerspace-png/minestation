#!/usr/bin/env node
/**
 * Reparo baterias — por defeito dry-run. `--apply` aplica (ver `backend/scripts/battery_repair_dryrun.mjs`).
 * Execução: `node scripts/repair-battery-state.mjs` ou `node scripts/repair-battery-state.mjs --apply`
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(__dirname, '../backend/scripts/battery_repair_dryrun.mjs');
const args = [target, ...process.argv.slice(2)];
const child = spawn(process.execPath, args, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
child.on('exit', (code) => process.exit(code ?? 1));
