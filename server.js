/**
 * SICREDI FATURAS — server.js
 *
 * Servidor local simples. Salva todos os dados em dados/dados.json.
 *
 * Como usar:
 *   1. Instale o Node.js (https://nodejs.org) — versão 18+ recomendada
 *   2. Abra o terminal nesta pasta e rode:  node server.js
 *   3. No PC: acesse  http://localhost:3000
 *   4. No celular (mesmo Wi-Fi): descubra o IP do PC (ipconfig / ip addr)
 *      e acesse  http://192.168.X.X:3000
 *
 * Não precisa instalar nada além do Node.js — sem npm install.
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const PORT = 3000;

// ---------- paths ----------
const ROOT      = __dirname;
const DATA_DIR  = path.join(ROOT, 'dados');
const DATA_FILE = path.join(DATA_DIR, 'dados.json');

// garante que a pasta dados/ existe
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// estrutura inicial vazia
const EMPTY_DATA = { allTx: [], faturas: [], statusOverride: {}, entradas: [], entradasFuturas: [], saidas: [], theme: 'light' };

function readData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return { ...EMPTY_DATA };
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (_) {
    return { ...EMPTY_DATA };
  }
}

function writeData(obj) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2), 'utf8');
}

// ---------- mime types ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico':  'image/x-icon',
};

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!fs.existsSync(filePath)) {
    res.writeHead(404); res.end('Not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(fs.readFileSync(filePath));
}

// ---------- server ----------
const server = http.createServer((req, res) => {
  // CORS para desenvolvimento
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = req.url.split('?')[0];

  // ── GET /api/dados ── retorna todos os dados
  if (req.method === 'GET' && url === '/api/dados') {
    const data = readData();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
    return;
  }

  // ── POST /api/dados ── salva todos os dados (body = JSON completo)
  if (req.method === 'POST' && url === '/api/dados') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const incoming = JSON.parse(body);
        // merge com estrutura existente para não perder campos novos no futuro
        const current = readData();
        const merged  = { ...current, ...incoming };
        writeData(merged);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── arquivos estáticos ──
  let filePath = path.join(ROOT, url === '/' ? 'index.html' : url);
  // segurança: impede path traversal
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  serveFile(res, filePath);
});

server.listen(PORT, '0.0.0.0', () => {
  // tenta mostrar o IP local automaticamente
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  let localIP = 'SEU_IP';
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) { localIP = net.address; break; }
    }
  }
  console.log('');
  console.log('✅  Servidor rodando!');
  console.log(`   PC:      http://localhost:${PORT}`);
  console.log(`   Celular: http://${localIP}:${PORT}  (mesmo Wi-Fi)`);
  console.log('');
  console.log('   Dados salvos em: dados/dados.json');
  console.log('   Para parar: Ctrl+C');
  console.log('');
});
