import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const PORT = 3917;

function startServer() {
  const proc = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(PORT), RPS_TIMESCALE: '0.05' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => String(d).includes('running') && resolve(proc));
    proc.stderr.on('data', (d) => process.stderr.write(d));
    proc.on('exit', (c) => reject(new Error('server exited ' + c)));
  });
}

function client(name) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const c = { ws, name, msgs: [], view: null, prompts: 0, end: null, events: [] };
  ws.on('message', (d) => {
    const m = JSON.parse(String(d));
    c.msgs.push(m);
    if (m.t === 'state') {
      c.view = m.view;
      const p = m.view.prompt;
      if (p && p.id !== c.lastAnswered) {
        c.lastAnswered = p.id;
        c.prompts++;
        const pick = (a) => a[Math.floor(Math.random() * a.length)];
        let ans;
        if (p.kind === 'pick') ans = { cardId: pick(m.view.me.hand).id };
        else if (p.kind === 'action') ans = { action: pick(p.options.filter((o) => o.enabled)).id };
        else if (p.kind === 'defense') ans = { defense: pick(p.options).id };
        else if (p.kind === 'keep') ans = { cardIds: p.cards.slice(0, p.keep).map((x) => x.id) };
        else if (p.kind === 'discard') ans = { cardIds: m.view.me.hand.slice(0, p.count).map((x) => x.id) };
        ws.send(JSON.stringify({ t: 'answer', promptId: p.id, answer: ans }));
      }
      if (m.view.over) c.end = m.view.result;
    }
    if (m.t === 'event') c.events.push(m.ev);
  });
  return new Promise((r) => ws.on('open', () => r(c)));
}

const waitFor = (fn, ms = 60000) =>
  new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const v = fn();
      if (v) {
        clearInterval(iv);
        resolve(v);
      } else if (Date.now() - t0 > ms) {
        clearInterval(iv);
        reject(new Error('timeout'));
      }
    }, 20);
  });

test('two clients play a full online match, hidden info stays hidden, rematch works', async () => {
  const srv = await startServer();
  try {
    const a = await client('Alice');
    a.ws.send(JSON.stringify({ t: 'create', name: 'Alice' }));
    const joined = await waitFor(() => a.msgs.find((m) => m.t === 'joined'));
    assert.match(joined.code, /^[A-Z2-9]{4}$/);
    assert.ok(joined.config.skills.length >= 4);

    const b = await client('Bob');
    b.ws.send(JSON.stringify({ t: 'join', code: joined.code.toLowerCase(), name: 'Bob<script>' }));
    await waitFor(() => a.end && b.end, 120000);
    assert.deepEqual(a.end, b.end);
    assert.ok(a.prompts > 10 && b.prompts > 10);
    assert.equal(b.view.me.name, 'Bobscript');

    // Hidden information never reaches the opponent
    for (const c of [a, b]) {
      const other = c === a ? 1 : 0;
      for (const m of c.msgs.filter((x) => x.t === 'state')) {
        assert.equal(m.view.opp.angry, undefined);
        assert.equal(m.view.opp.hand, undefined);
      }
      assert.ok(!c.events.some((e) => e.k === 'angry' && e.p === other), 'no opponent angry events');
    }

    // wrong room / full room
    const c3 = await client('Eve');
    c3.ws.send(JSON.stringify({ t: 'join', code: joined.code, name: 'Eve' }));
    const err = await waitFor(() => c3.msgs.find((m) => m.t === 'error'));
    assert.equal(err.code, 'full');

    // rematch
    a.end = b.end = null;
    a.ws.send(JSON.stringify({ t: 'rematch' }));
    b.ws.send(JSON.stringify({ t: 'rematch' }));
    await waitFor(() => a.msgs.filter((m) => m.t === 'start').length === 2);
    await waitFor(() => a.view && a.view.turn >= 2 && !a.view.over);

    // reconnect with token keeps the seat
    const tok = joined.token;
    a.ws.close();
    const a2 = await client('Alice2');
    a2.ws.send(JSON.stringify({ t: 'rejoin', code: joined.code, token: tok }));
    await waitFor(() => a2.msgs.find((m) => m.t === 'start' && m.resumed));
    await waitFor(() => a2.view && a2.view.me.name === 'Alice');
    for (const c of [a2, b, c3]) c.ws.close();
  } finally {
    srv.kill();
  }
});
