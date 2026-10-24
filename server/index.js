// RPS Arena server: static files + WebSocket rooms + authoritative matches.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Match } from './engine.js';
import { publicConfig, BALANCE } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const THREE = path.join(ROOT, 'node_modules', 'three');
const REMIX = path.join(ROOT, 'node_modules', 'remixicon');
const PORT = Number(process.env.PORT) || 3000;
const RECONNECT_GRACE_MS = 45_000;
const TIME_SCALE = Number(process.env.RPS_TIMESCALE) || 1; // tests speed the game up
if (process.env.RPS_MAXHP) BALANCE.maxHp = Number(process.env.RPS_MAXHP); // quick test games

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

function serveFile(res, base, rel) {
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base)) {
    res.writeHead(403).end();
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = decodeURIComponent(url.pathname);
  if (p === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  if (p.startsWith('/vendor/three/')) return serveFile(res, THREE, p.slice('/vendor/three/'.length));
  if (p.startsWith('/vendor/remixicon/')) return serveFile(res, REMIX, p.slice('/vendor/remixicon/'.length));
  if (p === '/' || p.startsWith('/room/')) p = '/index.html';
  serveFile(res, PUBLIC, p);
});

// ------------------------------------------------------------ rooms
/** @type {Map<string, Room>} */
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode() {
  let c;
  do {
    c = Array.from({ length: 4 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
  } while (rooms.has(c));
  return c;
}

function cleanName(n) {
  const s = String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
  return s || 'Player';
}

class Room {
  constructor(code) {
    this.code = code;
    this.seats = []; // { name, token, ws, graceTimer }
    this.match = null;
    this.rematch = new Set();
    this.created = Date.now();
  }

  send(i, msg) {
    const ws = this.seats[i]?.ws;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  broadcastLobby() {
    for (let i = 0; i < this.seats.length; i++) {
      this.send(i, { t: 'lobby', code: this.code, you: i, players: this.seats.map((s) => ({ name: s.name, connected: !!s.ws })) });
    }
  }

  start() {
    this.rematch.clear();
    const room = this;
    this.match = new Match({
      names: this.seats.map((s) => s.name),
      timeScale: TIME_SCALE,
      send: (i, msg) => room.send(i, msg),
      onEnd: () => room.broadcastLobbyLater(),
    });
    for (let i = 0; i < 2; i++) this.send(i, { t: 'start', code: this.code, you: i });
    this.match.run().catch((e) => console.error('match crashed', e));
    for (let i = 0; i < 2; i++) if (!this.seats[i].ws) this.match.setConnected(i, false);
  }

  broadcastLobbyLater() {
    /* lobby info stays; clients show the result screen */
  }

  detach(i) {
    const seat = this.seats[i];
    if (!seat) return;
    seat.ws = null;
    if (this.match && !this.match.over) {
      this.match.setConnected(i, false);
      clearTimeout(seat.graceTimer);
      seat.graceTimer = setTimeout(() => {
        if (!seat.ws && this.match && !this.match.over) this.match.forfeit(i);
      }, RECONNECT_GRACE_MS);
    } else {
      this.broadcastLobby();
    }
    this.maybeDispose();
  }

  maybeDispose() {
    if (this.seats.every((s) => !s.ws)) {
      setTimeout(() => {
        if (this.seats.every((s) => !s.ws)) {
          if (this.match && !this.match.over) this.match.endGame('abandoned');
          rooms.delete(this.code);
        }
      }, RECONNECT_GRACE_MS + 5000);
    }
  }
}

// ------------------------------------------------------------ websocket
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

function bindSeat(ws, room, i) {
  ws.room = room;
  ws.seat = i;
  const seat = room.seats[i];
  if (seat.ws && seat.ws !== ws) {
    try {
      seat.ws.close(4000, 'replaced');
    } catch {}
  }
  seat.ws = ws;
  clearTimeout(seat.graceTimer);
  ws.send(JSON.stringify({ t: 'joined', code: room.code, you: i, token: seat.token, config: publicConfig() }));
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    const reply = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m));

    switch (msg.t) {
      case 'create': {
        if (ws.room) return;
        const room = new Room(newCode());
        rooms.set(room.code, room);
        room.seats.push({ name: cleanName(msg.name), token: crypto.randomUUID(), ws: null });
        bindSeat(ws, room, 0);
        room.broadcastLobby();
        break;
      }
      case 'join': {
        if (ws.room) return;
        const room = rooms.get(String(msg.code || '').toUpperCase().trim());
        if (!room) return reply({ t: 'error', code: 'no-room', msg: 'ไม่พบห้องนี้' });
        if (room.seats.length >= 2) return reply({ t: 'error', code: 'full', msg: 'ห้องเต็มแล้ว' });
        room.seats.push({ name: cleanName(msg.name), token: crypto.randomUUID(), ws: null });
        bindSeat(ws, room, 1);
        room.broadcastLobby();
        room.start();
        break;
      }
      case 'rejoin': {
        const room = rooms.get(String(msg.code || '').toUpperCase());
        const i = room ? room.seats.findIndex((s) => s.token === msg.token) : -1;
        if (i < 0) return reply({ t: 'error', code: 'rejoin-failed', msg: 'กลับเข้าห้องไม่ได้' });
        bindSeat(ws, room, i);
        room.broadcastLobby();
        if (room.match) {
          reply({ t: 'start', code: room.code, you: i, resumed: true });
          room.match.setConnected(i, true);
        }
        break;
      }
      case 'answer': {
        const { room, seat } = ws;
        if (!room?.match) return;
        room.match.respond(seat, msg.promptId, msg.answer);
        break;
      }
      case 'rematch': {
        const { room, seat } = ws;
        if (!room?.match?.over || room.seats.length < 2) return;
        room.rematch.add(seat);
        for (let i = 0; i < 2; i++) room.send(i, { t: 'rematch', votes: [...room.rematch] });
        if (room.rematch.size === 2) room.start();
        break;
      }
      case 'leave': {
        const { room, seat } = ws;
        if (!room) return;
        if (room.match && !room.match.over) room.match.forfeit(seat);
        room.detach(seat);
        ws.room = null;
        break;
      }
      case 'ping':
        reply({ t: 'pong', at: msg.at });
        break;
      default:
        break;
    }
  });

  ws.on('close', () => {
    if (ws.room && ws.room.seats[ws.seat]?.ws === ws) ws.room.detach(ws.seat);
  });
});

// heartbeat: drop dead sockets so reconnect / forfeit kicks in
const hb = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 15_000);
wss.on('close', () => clearInterval(hb));

server.listen(PORT, () => {
  console.log(`RPS Arena running at http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) console.log(`  same Wi-Fi: http://${n.address}:${PORT}`);
    }
  }
});

export { server, rooms };
