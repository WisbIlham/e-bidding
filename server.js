#!/usr/bin/env node
/* eBid Baju — tiny realtime demo server (no dependencies).
 * - Serves the static site.
 * - Keeps ONE shared auction state for every device on the network, so bids appear live
 *   on all phones/laptops (Server-Sent Events push).
 * - Elects one "engine" tab across all devices (runs bot bidders + closes lots).
 *
 *   node server.js            → http://localhost:8080  (phones: http://<Mac LAN IP>:8080)
 *   PORT=9000 node server.js
 *
 * API (JSON):
 *   GET  /api/state            → { version, state }        (state is null until first write)
 *   PUT  /api/state            ← { baseVersion, state }    → 200 { version } | 409 { version, state }
 *   POST /api/reset            → clears the shared state (everyone reloads the seed)
 *   POST /api/lease            ← { tab }                   → { leader: true|false }
 *   GET  /api/events           → text/event-stream: "change" { version } / "reset"
 * Demo only: no auth, last-writer-checked by version. The real build uses Laravel + Reverb.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8080;
const SAVE_FILE = path.join(ROOT, '.demo-state.json');
const LEASE_MS = 5000;

let version = 0;
let state = null;
try { const saved = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8')); version = saved.version || 0; state = saved.state || null; } catch (e) { /* first run */ }

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(SAVE_FILE, JSON.stringify({ version, state }), () => {}), 300);
}

const clients = new Set();
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) { try { res.write(msg); } catch (e) { clients.delete(res); } }
}
setInterval(() => broadcast('ping', { t: Date.now() }), 20000);

let lease = { tab: null, until: 0 };

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8',
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 20 * 1024 * 1024) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  try {
    if (p === '/api/state' && req.method === 'GET') return sendJson(res, 200, { version, state });

    if (p === '/api/state' && req.method === 'PUT') {
      const body = await readBody(req);
      if (Number(body.baseVersion) !== version) return sendJson(res, 409, { version, state });
      state = body.state; version += 1; persist();
      broadcast('change', { version });
      return sendJson(res, 200, { version });
    }

    if (p === '/api/reset' && req.method === 'POST') {
      state = null; version += 1; persist();
      broadcast('reset', { version });
      return sendJson(res, 200, { version });
    }

    if (p === '/api/lease' && req.method === 'POST') {
      const { tab } = await readBody(req);
      const now = Date.now();
      if (!lease.tab || lease.tab === tab || now > lease.until) lease = { tab, until: now + LEASE_MS };
      return sendJson(res, 200, { leader: lease.tab === tab });
    }

    if (p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(`event: hello\ndata: ${JSON.stringify({ version })}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (p.startsWith('/api/')) return sendJson(res, 404, { error: 'not found' });

    // ---- static files ----
    let file = path.normalize(path.join(ROOT, decodeURIComponent(p)));
    if (!file.startsWith(ROOT) || path.basename(file).startsWith('.')) { res.writeHead(403); return res.end('Forbidden'); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    sendJson(res, 400, { error: String(e.message || e) });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log(`eBid Baju realtime demo running:`);
  console.log(`  This computer:  http://localhost:${PORT}/shop.html`);
  ips.forEach(ip => console.log(`  Phones (same Wi-Fi): http://${ip}:${PORT}/shop.html`));
});
