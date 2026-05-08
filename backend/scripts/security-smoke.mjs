#!/usr/bin/env node
/**
 * Smoke de segurança contra a API em execução (local ou staging).
 * Uso: API_BASE=http://127.0.0.1:3001 node scripts/security-smoke.mjs
 * Sem cookies — espera 401/403 conforme o endpoint.
 */
const base = (process.env.API_BASE || 'http://127.0.0.1:3001').replace(/\/$/, '');

const cases = [
  { name: 'season-purchases sem sessão', method: 'GET', path: '/api/season-purchases/a@b.co', expect: [401] },
  { name: 'referrals por email sem sessão', method: 'GET', path: '/api/referrals/a@b.co', expect: [401] },
  { name: 'upload-image sem sessão', method: 'POST', path: '/api/upload-image', expect: [401], json: {} },
  {
    name: 'nfts/send sem sessão',
    method: 'POST',
    path: '/api/nfts/send',
    expect: [401],
    json: {
      contract: '0x0000000000000000000000000000000000000001',
      tokenId: '1',
      fromAddress: '0x0000000000000000000000000000000000000002',
      toAddress: '0x0000000000000000000000000000000000000003'
    }
  },
  {
    name: 'applixir callback sem segredo',
    method: 'GET',
    path: '/api/applixir-callback?userId=1&custom=0',
    expect: [403, 503]
  }
];

async function run() {
  let failed = 0;
  for (const c of cases) {
    const url = `${base}${c.path}`;
    const init = {
      method: c.method,
      headers: c.json ? { 'Content-Type': 'application/json' } : {}
    };
    if (c.json) init.body = JSON.stringify(c.json);
    let res;
    try {
      res = await fetch(url, init);
    } catch (e) {
      console.error(`[FALHA] ${c.name}: rede — ${e.message}`);
      console.error('        Confirme que a API está a correr e API_BASE está correcto.');
      process.exitCode = 2;
      return;
    }
    const ok = c.expect.includes(res.status);
    if (!ok) {
      console.error(`[FALHA] ${c.name}: HTTP ${res.status} (esperado um de: ${c.expect.join(', ')})`);
      failed++;
    } else {
      console.log(`[OK]    ${c.name}: HTTP ${res.status}`);
    }
  }
  if (failed) {
    process.exitCode = 1;
  } else {
    console.log(`\nSmoke concluído: ${cases.length} verificações.`);
  }
}

run();
