
import cluster from 'node:cluster';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Obter número de núcleos do processador
const totalCores = os.cpus().length;
// Respeitar solicitação do admin ou usar todos por padrão
const requestedCores = parseInt(process.env.MAX_CORES) || totalCores;
const numCPUs = Math.min(requestedCores, totalCores);

// Configuração de Afinidade (Windows)
const applyAffinity = async (pid) => {
    if (process.platform !== 'win32') return;
    if (numCPUs >= totalCores) return; // Não precisa restringir se for usar tudo

    try {
        // Calcular máscara para usar os ÚLTIMOS 'numCPUs' núcleos
        const mask = ((1n << BigInt(numCPUs)) - 1n) << BigInt(totalCores - numCPUs);
        const psCommand = `PowerShell -Command "$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if($p) { $p.ProcessorAffinity = ${mask.toString()} }"`;
        await execAsync(psCommand);
        
        const firstCore = totalCores - numCPUs;
        const lastCore = totalCores - 1;
        console.log(`[Affinity] PID ${pid} vinculado aos núcleos ${firstCore}-${lastCore} (Mask: ${mask.toString()})`);
    } catch (e) {
        // Ignora erros de afinidade silenciosamente ou loga para debug
    }
};

if (cluster.isPrimary) {
  console.log(`\n=== GENESIS MINER MULTI-CORE LAUNCHER ===`);
  console.log(`Master process ${process.pid} is running`);
  console.log(`Sistema: ${totalCores} núcleos | Solicitado: ${numCPUs} núcleos.`);
  
  if (numCPUs < totalCores) {
    console.log(`Atenção: Priorizando os últimos ${numCPUs} núcleos para o jogo.`);
  }

  const spawnWorker = (index, roleOverride = null) => {
    const env = { ...process.env };
    // Com 1 worker só, precisa de API + tarefas agendadas (ex.: sweep de depósitos USDC).
    // Com 2+ workers, o worker 0 fica só em BACKGROUND e os restantes servem HTTP.
    const role = roleOverride || (numCPUs === 1 ? 'ALL' : (index === 0 ? 'BACKGROUND' : 'API'));
    env.WORKER_ROLE = role;

    const worker = cluster.fork(env);
    console.log(`[Master] Forked Worker (PID ${worker.process.pid}) - Role: ${role}`);
    
    // Aplicar afinidade após um pequeno delay para garantir que o processo Windows exista
    setTimeout(() => applyAffinity(worker.process.pid), 1000);
    
    return { worker, role };
  };

  // Fork workers iniciais
  for (let i = 0; i < numCPUs; i++) {
    spawnWorker(i);
  }

  // Monitorar workers com proteção contra Fork Bomb
  const RESTART_DELAY = 3000; // 3 segundos
  cluster.on('exit', (worker, code, signal) => {
    const role = worker.process.env.WORKER_ROLE || 'API';
    console.warn(`[Master] Worker ${worker.process.pid} (${role}) morreu (Code: ${code}, Signal: ${signal}).`);
    console.log(`[Master] Reiniciando em ${RESTART_DELAY/1000}s para manter estabilidade...`);
    
    setTimeout(() => {
        spawnWorker(-1, role); // -1 indica que é um re-spawn
    }, RESTART_DELAY);
  });

  // Log de status
  console.log(`\nTodos os ${numCPUs} workers configurados.`);
  console.log(`O Backend está pronto para receber conexões.\n`);

  // --- MONITORAMENTO DE RECURSOS ---
  const workerStats = {};
  const fs = await import('fs/promises');
  
  const statsFilePath = join(__dirname, '../admin/public/cluster_stats.json');

  cluster.on('message', (worker, msg) => {
    if (msg && msg.type === 'market_ws_broadcast') {
      for (const id in cluster.workers) {
        const w = cluster.workers[id];
        if (w && w.id !== worker.id) {
          try { w.send(msg); } catch (_) { /* ignore */ }
        }
      }
      return;
    }
    if (msg.type === 'stats') {
      const pid = worker.process.pid;
      const now = Date.now();
      
      if (!workerStats[pid]) {
        workerStats[pid] = { lastCpu: msg.cpu, lastTime: now, role: msg.role };
        return;
      }

      const last = workerStats[pid];
      const timeDelta = (now - last.lastTime) * 1000; 
      const cpuDelta = (msg.cpu.user + msg.cpu.system) - (last.lastCpu.user + last.lastCpu.system);
      const usagePercent = timeDelta > 0 ? (cpuDelta / timeDelta) * 100 : 0;
      
      workerStats[pid] = { 
        lastCpu: msg.cpu, 
        lastTime: now, 
        role: msg.role,
        usage: usagePercent, 
        mem: msg.mem,
        pid: pid
      };
    }
  });

  // Salvar estatísticas em arquivo JSON
  setInterval(async () => {
    try {
        const statsArray = Object.values(workerStats)
            .filter(s => (Date.now() - s.lastTime) < 10000) // Apenas workers ativos nos últimos 10s
            .map(s => ({
                pid: s.pid,
                role: s.role,
                cpu: parseFloat(Math.min(s.usage, 100).toFixed(1)),
                mem: s.mem.rss,
                heap: s.mem.heapUsed
            }));

        await fs.writeFile(statsFilePath, JSON.stringify({
            updatedAt: Date.now(),
            totalCores: totalCores,
            requestedCores: numCPUs,
            workers: statsArray
        }, null, 2));
    } catch (e) { /* ignore */ }
  }, 2000);

} else {
  // Workers
  const role = process.env.WORKER_ROLE || 'UNKNOWN';
  
  // Reportar estatísticas para o Master
  setInterval(() => {
    if (process.connected) {
      process.send({ 
        type: 'stats', 
        cpu: process.cpuUsage(), 
        mem: process.memoryUsage(),
        role: role
      });
    }
  }, 2000);
  
  // Import dinâmico do server.js original
  import('./server.js').catch(err => {
    console.error(`Falha ao iniciar worker ${process.pid} (${role}):`, err);
    process.exit(1); // Força saída para o master reiniciar
  });
}
