const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, 'public');
const players = new Map();
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  if (pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, service: 'little-chapel-realtime' })); return; }
  const requested = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(ROOT, requested));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    const ext = path.extname(file);
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});
const wss = new WebSocket.Server({ server });
function broadcast(payload, except) {
  const message = JSON.stringify(payload);
  for (const client of wss.clients) if (client !== except && client.readyState === WebSocket.OPEN) client.send(message);
}
function cleanText(value, max) { return String(value ?? '').replace(/[<>]/g, '').trim().slice(0, max); }

wss.on('connection', ws => {
  const id = randomUUID();
  let player = null;
  ws.on('message', raw => {
    let data;
    try { data = JSON.parse(raw.toString()); } catch { return; }
    if (!data || typeof data.type !== 'string') return;

    if (data.type === 'join' && !player) {
      player = {
        id,
        name: cleanText(data.name, 24) || '방문자',
        color: /^#[0-9a-fA-F]{6}$/.test(data.color) ? data.color : '#7c9a83',
        x: Number.isFinite(data.x) ? Math.max(105, Math.min(795, data.x)) : 450,
        y: Number.isFinite(data.y) ? Math.max(150, Math.min(475, data.y)) : 390
      };
      players.set(id, player);
      ws.send(JSON.stringify({ type: 'init', you: player, players: [...players.values()].filter(p => p.id !== id) }));
      broadcast({ type: 'player-joined', player }, ws);
      return;
    }
    if (!player) return;

    if (data.type === 'move') {
      const x = Number(data.x), y = Number(data.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      player.x = Math.max(105, Math.min(795, x));
      player.y = Math.max(150, Math.min(475, y));
      broadcast({ type: 'move', player }, ws);
    } else if (data.type === 'chat') {
      const text = cleanText(data.text, 120);
      if (!text) return;
      broadcast({ type: 'chat', name: player.name, text });
      ws.send(JSON.stringify({ type: 'chat', name: player.name, text }));
    }
  });
  ws.on('close', () => {
    if (player) {
      players.delete(id);
      broadcast({ type: 'player-left', id });
    }
  });
});
server.listen(PORT, () => console.log(`작은 예배당 서버 실행 중: http://localhost:${PORT}`));
