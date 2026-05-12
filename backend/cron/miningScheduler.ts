/**
 * Ponto único de entrada: mineração (yield global + progresso por jogador).
 */

export { startMiningYieldCron, updateMiningYields } from './miningYieldCron.js';
export {
  computeProgressForUser,
  calculateIntegratedYield,
  getActiveMiningProgressCalculations
} from './miningProgressComputer.js';
export { miningRuntimeStats } from './miningRuntimeStats.js';
export { sanitizeForLog, sanitizeApiMessage } from '../lib/safeText.js';
