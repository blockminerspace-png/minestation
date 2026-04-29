const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const pidusage = require('pidusage');
const cookieParser = require('cookie-parser');
const { ethers } = require('ethers');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = 2053;
const AUTH_COOKIE_NAME = 'minestation_admin_auth';
// Secret gerado dinamicamente a cada restart para invalidar sessões anteriores (mais seguro)
// Ou use uma string fixa se quiser persistência entre restarts: 'seu_segredo_super_secreto'
const JWT_SECRET = crypto.randomBytes(64).toString('hex');

// Lista de carteiras permitidas
const ALLOWED_WALLETS = [
    "0xD38024d147Fc40cB18E18f81a36cC55341B0115E",
    "0x8b24Cf37D85ff1991c444d7fF8C53DaE33cc9182"
];

// --- SEGURANÇA ---

// 1. Helmet para headers de segurança
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "cdnjs.cloudflare.com"], // unsafe-eval necessário para algumas libs web3
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "blob:"],
            connectSrc: ["'self'", "ws:", "wss:", "http:", "https:"], // Permitir RPCs externos e WebSockets
            frameSrc: ["'self'"],
        },
    },
}));

// 2. Rate Limiting para evitar brute force / spam
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // limite de 100 requisições por IP
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(limiter);

// Rate limit mais estrito para login
const loginLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hora
    max: 10, // 10 tentativas de login por hora por IP
    message: "Muitas tentativas de login, tente novamente mais tarde."
});

app.use(express.json());
app.use(cookieParser());

// Middleware de Autenticação para Rotas HTTP
const requireAuth = (req, res, next) => {
    // Permitir login e assets estáticos
    if (req.path === '/login.html' || req.path.startsWith('/api/auth') || req.path.includes('.')) {
        return next();
    }

    const token = req.cookies[AUTH_COOKIE_NAME];
    if (!token) {
        return res.redirect('/login.html');
    }

    try {
        // Verificar JWT assinado pelo servidor
        const decoded = jwt.verify(token, JWT_SECRET);

        // Verificação DUPLA: O endereço está na whitelist?
        if (!ALLOWED_WALLETS.includes(decoded.address)) {
            throw new Error("Carteira não autorizada");
        }

        req.user = decoded.address;
        next();
    } catch (e) {
        console.error("Falha na autenticação:", e.message);
        res.clearCookie(AUTH_COOKIE_NAME); // Limpar cookie inválido
        res.redirect('/login.html');
    }
};

// API de Autenticação
app.post('/api/auth/login', loginLimiter, (req, res) => {
    const { address, signature, timestamp } = req.body;

    if (!address || !signature || !timestamp) {
        return res.status(400).json({ error: "Dados incompletos" });
    }

    // Verificar timestamp (evitar replay attacks antigos, margem de 5 min)
    if (Math.abs(Date.now() - timestamp) > 5 * 60 * 1000) {
        return res.status(401).json({ error: "Timestamp inválido ou expirado" });
    }

    try {
        const message = `Login to Mine Station Admin\nTimestamp: ${timestamp}`;
        // Suporte para ethers v5 e v6
        const recoveredAddress = ethers.verifyMessage
            ? ethers.verifyMessage(message, signature)
            : ethers.utils.verifyMessage(message, signature);

        if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
            return res.status(401).json({ error: "Assinatura inválida" });
        }

        // Verificar Whitelist
        if (!ALLOWED_WALLETS.includes(recoveredAddress)) { // Verificação estrita
            return res.status(403).json({ error: "Acesso negado para esta carteira" });
        }

        // Criar JWT Assinado pelo Servidor
        // Isso garante que o conteúdo do cookie não foi alterado pelo cliente
        const token = jwt.sign({
            address: recoveredAddress,
            role: 'admin'
        }, JWT_SECRET, { expiresIn: '24h' });

        // Cookie HttpOnly e Secure (se possível) e SameSite Strict
        res.cookie(AUTH_COOKIE_NAME, token, {
            httpOnly: true,
            secure: false, // Em localhost geralmente é false, em prod deve ser true
            sameSite: 'Strict',
            maxAge: 24 * 60 * 60 * 1000
        });

        res.json({ success: true });

    } catch (e) {
        console.error("Erro na autenticação:", e);
        res.status(500).json({ error: "Erro interno na verificação" });
    }
});

app.post('/api/auth/logout', (req, res) => {
    res.clearCookie(AUTH_COOKIE_NAME);
    res.json({ success: true });
});

// Aplicar middleware de proteção
app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));

// Middleware de Autenticação para Socket.IO
io.use((socket, next) => {
    const cookieString = socket.handshake.headers.cookie;
    if (!cookieString) return next(new Error("Authentication error"));

    // Parser manual simples de cookie para socket.io
    const cookies = {};
    cookieString.split(';').forEach(cookie => {
        const parts = cookie.split('=');
        cookies[parts.shift().trim()] = decodeURI(parts.join('='));
    });

    const token = cookies[AUTH_COOKIE_NAME];
    if (!token) return next(new Error("Authentication error"));

    try {
        // Verificar JWT no Socket também
        const decoded = jwt.verify(token, JWT_SECRET);

        // Verificação DUPLA na conexão Socket
        if (!ALLOWED_WALLETS.includes(decoded.address)) {
            return next(new Error("Unauthorized wallet"));
        }

        socket.user = decoded.address;
        next();
    } catch (e) {
        next(new Error("Authentication error"));
    }
});

// Validação de Permissão para Ações do Socket
const ensureSocketAuth = (socket) => {
    if (!socket.user || !ALLOWED_WALLETS.includes(socket.user)) {
        socket.disconnect(true);
        return false;
    }
    return true;
};

// Caminhos
const BACKEND_PATH = path.join(__dirname, '../backend');
const FRONTEND_PATH = path.join(__dirname, '../frontend');

// Estado dos processos
let backendProcess = null;
let frontendProcess = null;

// Funções Auxiliares
function startProcess(type, command, args, cwd, extraEnv = {}) {
    if (type === 'backend' && backendProcess) return;
    if (type === 'frontend' && frontendProcess) return;

    console.log(`Iniciando ${type}...`);

    const proc = spawn(command, args, {
        cwd: cwd,
        shell: true,
        stdio: 'pipe',
        env: { ...process.env, ...extraEnv }
    });

    if (type === 'backend') backendProcess = proc;
    else frontendProcess = proc;

    // Emitir status inicial
    emitStatus();
    io.emit(`log-${type}`, `--- INICIANDO ${type.toUpperCase()} ---\n`);

    proc.stdout.on('data', (data) => {
        io.emit(`log-${type}`, data.toString());
    });

    proc.stderr.on('data', (data) => {
        io.emit(`log-${type}`, `[ERRO] ${data.toString()}`);
    });

    proc.on('close', (code) => {
        console.log(`${type} encerrou com código ${code}`);
        if (type === 'backend') backendProcess = null;
        else frontendProcess = null;

        emitStatus();
        io.emit(`log-${type}`, `--- ${type.toUpperCase()} PARADO (Código ${code}) ---\n`);
    });
}

function stopProcess(type, callback) {
    const proc = type === 'backend' ? backendProcess : frontendProcess;

    if (proc) {
        console.log(`Parando ${type}...`);
        try {
            // Taskkill para Windows para garantir que mate a árvore de processos
            const killCmd = spawn('taskkill', ['/pid', proc.pid, '/f', '/t']);

            killCmd.on('close', () => {
                if (type === 'backend') backendProcess = null;
                else frontendProcess = null;
                emitStatus();
                if (callback) callback();
            });
        } catch (e) {
            console.error(`Erro ao parar ${type}:`, e);
            if (callback) callback();
        }
    } else {
        if (callback) callback();
    }
}

function emitStatus() {
    io.emit('status', {
        backend: !!backendProcess,
        frontend: !!frontendProcess
    });
}

// Monitoramento de Recursos
function getSystemStats() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const cpus = os.cpus();
    const cpuModel = cpus[0].model;
    const cpuCount = cpus.length;

    // Cálculo de carga de CPU do sistema (simplificado para Windows)
    // No Windows, os.loadavg() nem sempre retorna 100% correto para % de uso instantâneo,
    // mas vamos usar o que temos. Uma alternativa melhor seria usar 'os-utils' ou similar,
    // mas vamos tentar manter simples. Vamos focar nos processos específicos.

    return {
        totalMem,
        freeMem,
        usedMem: totalMem - freeMem,
        cpuModel,
        cpuCount
    };
}

const fs = require('fs');
// ...

const psTree = require('ps-tree');
const util = require('util');
const psTreeAsync = util.promisify(psTree);

// Helper para pegar stats de toda a árvore de processos
async function getTreeStats(pid) {
    try {
        const children = await psTreeAsync(pid);
        const pids = [pid, ...children.map(p => parseInt(p.PID))];

        const stats = await pidusage(pids);

        // Agregar stats
        let totalCpu = 0;
        let totalMem = 0;

        // pidusage retorna um objeto onde a chave é o PID ou apenas um objeto stats se for um único PID
        // mas como passamos um array, deve retornar um objeto com chaves

        Object.values(stats).forEach(s => {
            if (s) {
                totalCpu += s.cpu;
                totalMem += s.memory;
            }
        });

        return { cpu: totalCpu, memory: totalMem };
    } catch (e) {
        // Fallback para apenas o processo pai se falhar a árvore
        return await pidusage(pid);
    }
}

// Loop de monitoramento
setInterval(async () => {
    const stats = {
        system: getSystemStats(),
        backend: null,
        frontend: null,
        cluster: null // Add cluster stats
    };

    try {
        // Read Cluster Stats JSON if available
        try {
            const clusterPath = path.join(__dirname, 'public/cluster_stats.json');
            if (fs.existsSync(clusterPath)) {
                const data = fs.readFileSync(clusterPath, 'utf8');
                stats.cluster = JSON.parse(data);
            }
        } catch (e) { /* ignore */ }

        if (backendProcess && backendProcess.pid) {
            try {
                // Se não tiver cluster stats, tenta pegar via árvore (fallback)
                if (!stats.cluster) {
                    stats.backend = await getTreeStats(backendProcess.pid);
                }
            } catch (err) {
                // Processo pode ter morrido ou não acessível
            }
        }

        if (frontendProcess && frontendProcess.pid) {
            try {
                stats.frontend = await getTreeStats(frontendProcess.pid);
            } catch (err) {
                // Processo pode ter morrido
            }
        }

        io.emit('stats-update', stats);
    } catch (err) {
        console.error('Erro no monitoramento:', err);
    }
}, 2000);

io.on('connection', (socket) => {
    console.log(`Cliente conectado: ${socket.user}`);

    // Enviar estado inicial
    socket.emit('status', {
        backend: !!backendProcess,
        frontend: !!frontendProcess
    });

    // --- BACKEND ---
    socket.on('start-backend', (config) => {
        const cores = (config && config.cores) ? config.cores : null;
        console.log(`Comando recebido: start-backend de ${socket.user}${cores ? ` (Cores: ${cores})` : ''}`);
        if (!ensureSocketAuth(socket)) return;
        
        const extraEnv = {};
        if (cores) extraEnv.MAX_CORES = cores;
        
        startProcess('backend', 'npm', ['run', 'start:cluster'], BACKEND_PATH, extraEnv);
    });

    socket.on('stop-backend', () => {
        console.log(`Comando recebido: stop-backend de ${socket.user}`);
        if (!ensureSocketAuth(socket)) return;
        stopProcess('backend');
    });

    socket.on('restart-backend', (config) => {
        const cores = (config && config.cores) ? config.cores : null;
        console.log(`Comando recebido: restart-backend de ${socket.user}${cores ? ` (Cores: ${cores})` : ''}`);
        if (!ensureSocketAuth(socket)) return;
        
        stopProcess('backend', () => {
            setTimeout(() => {
                const extraEnv = {};
                if (cores) extraEnv.MAX_CORES = cores;
                startProcess('backend', 'npm', ['run', 'start:cluster'], BACKEND_PATH, extraEnv);
            }, 1000);
        });
    });

    // --- FRONTEND ---
    socket.on('start-frontend', () => {
        console.log(`Comando recebido: start-frontend de ${socket.user}`);
        if (!ensureSocketAuth(socket)) return;
        startProcess('frontend', 'npm', ['run', 'dev'], FRONTEND_PATH);
    });

    socket.on('stop-frontend', () => {
        console.log(`Comando recebido: stop-frontend de ${socket.user}`);
        if (!ensureSocketAuth(socket)) return;
        stopProcess('frontend');
    });

    socket.on('restart-frontend', () => {
        console.log(`Comando recebido: restart-frontend de ${socket.user}`);
        if (!ensureSocketAuth(socket)) return;
        stopProcess('frontend', () => {
            setTimeout(() => {
                startProcess('frontend', 'npm', ['run', 'dev'], FRONTEND_PATH);
            }, 1000);
        });
    });

    // --- FILE MANAGER ---
    const PROJECT_ROOT = path.resolve(__dirname, '../');

    socket.on('list-files', (relativePath, callback) => {
        if (!ensureSocketAuth(socket)) return;

        try {
            // Remove leading slash/backslashes to ensure clean join
            const cleanRelPath = (relativePath || '').replace(/^[/\\]+/, '');
            const targetPath = path.join(PROJECT_ROOT, cleanRelPath);

            // Security Check: Prevent directory traversal out of PROJECT_ROOT
            if (!targetPath.startsWith(PROJECT_ROOT)) {
                return callback({ error: "Acesso negado: Caminho fora da raiz do projeto." });
            }

            if (!fs.existsSync(targetPath)) {
                return callback({ error: "Caminho não encontrado." });
            }

            if (!fs.statSync(targetPath).isDirectory()) {
                return callback({ error: "O caminho não é um diretório." });
            }

            const items = fs.readdirSync(targetPath, { withFileTypes: true });
            const result = items.map(item => ({
                name: item.name,
                isDirectory: item.isDirectory(),
                size: item.isDirectory() ? 0 : (fs.statSync(path.join(targetPath, item.name)).size)
            }));

            // Sort: directories first
            result.sort((a, b) => {
                if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name);
                return a.isDirectory ? -1 : 1;
            });

            callback({ data: result, currentPath: cleanRelPath });
        } catch (e) {
            callback({ error: e.message });
        }
    });

    socket.on('read-file', (relativePath, callback) => {
        if (!ensureSocketAuth(socket)) return;

        try {
            const cleanRelPath = (relativePath || '').replace(/^[/\\]+/, '');
            const targetPath = path.join(PROJECT_ROOT, cleanRelPath);

            if (!targetPath.startsWith(PROJECT_ROOT)) {
                return callback({ error: "Acesso negado." });
            }

            if (!fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
                return callback({ error: "Arquivo não encontrado ou é um diretório." });
            }

            // Limit file size to 1MB to prevent crashing the socket
            const stats = fs.statSync(targetPath);
            if (stats.size > 1024 * 1024) {
                return callback({ error: "Arquivo muito grande para visualização (max 1MB)." });
            }

            const content = fs.readFileSync(targetPath, 'utf8');
            callback({ data: content });
        } catch (e) {
            callback({ error: e.message });
        }
    });

    socket.on('save-file', ({ path: relativePath, content }, callback) => {
        if (!ensureSocketAuth(socket)) return;

        try {
            const cleanRelPath = (relativePath || '').replace(/^[/\\]+/, '');
            const targetPath = path.join(PROJECT_ROOT, cleanRelPath);

            if (!targetPath.startsWith(PROJECT_ROOT)) return callback({ error: "Acesso negado." });

            // Validate if it's not a directory
            if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
                return callback({ error: "Não é possível sobrescrever um diretório." });
            }

            fs.writeFileSync(targetPath, content, 'utf8');
            callback({ success: true });
        } catch (e) {
            callback({ error: e.message });
        }
    });

    socket.on('delete-file', (relativePath, callback) => {
        if (!ensureSocketAuth(socket)) return;

        try {
            const cleanRelPath = (relativePath || '').replace(/^[/\\]+/, '');
            const targetPath = path.join(PROJECT_ROOT, cleanRelPath);

            if (!targetPath.startsWith(PROJECT_ROOT)) return callback({ error: "Acesso negado." });

            if (!fs.existsSync(targetPath)) return callback({ error: "Arquivo/Diretório não encontrado." });

            fs.rmSync(targetPath, { recursive: true, force: true });
            callback({ success: true });
        } catch (e) {
            callback({ error: e.message });
        }
    });

    socket.on('upload-file', ({ path: relativePath, name, content }, callback) => {
        if (!ensureSocketAuth(socket)) return;

        try {
            const cleanRelPath = (relativePath || '').replace(/^[/\\]+/, '');
            const targetDir = path.join(PROJECT_ROOT, cleanRelPath);
            const targetPath = path.join(targetDir, name);

            if (!targetPath.startsWith(PROJECT_ROOT)) return callback({ error: "Acesso negado." });

            // Check if directory exists
            if (!fs.existsSync(targetDir)) return callback({ error: "Diretório de destino não existe." });

            // Content comes as base64 string usually if sent from client FileReader
            // Or Buffer if socket.io handles it. Let's assume it might be a buffer or base64.
            // If the client sends ArrayBuffer, socket.io receives it as Buffer.

            fs.writeFileSync(targetPath, content);
            callback({ success: true });
        } catch (e) {
            callback({ error: e.message });
        }
    });

    socket.on('create-folder', ({ path: relativePath, name }, callback) => {
        if (!ensureSocketAuth(socket)) return;

        try {
            const cleanRelPath = (relativePath || '').replace(/^[/\\]+/, '');
            const targetDir = path.join(PROJECT_ROOT, cleanRelPath);
            const newFolderPath = path.join(targetDir, name);

            if (!newFolderPath.startsWith(PROJECT_ROOT)) return callback({ error: "Acesso negado." });

            if (fs.existsSync(newFolderPath)) return callback({ error: "Pasta já existe." });

            fs.mkdirSync(newFolderPath);
            callback({ success: true });
        } catch (e) {
            callback({ error: e.message });
        }
    });
});

server.listen(PORT, () => {
    console.log(`Painel Administrativo rodando em http://localhost:${PORT}`);
});
