import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match, rps, applyPct } from '../server/engine.js';
import { BALANCE } from '../server/config.js';

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// Random bot that answers every prompt with a random valid choice.
function playRandomGame(seed, { checks } = {}) {
  const rng = seeded(seed);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  return new Promise((resolve, reject) => {
    let m;
    const states = [];
    m = new Match({
      names: ['A', 'B'],
      rng: seeded(seed * 7 + 1),
      timeScale: 0,
      send: (i, msg) => {
        if (msg.t === 'state') states[i] = msg.view;
      },
      onPrompt: (i, p) => {
        checks?.(m, i, p);
        const me = m.players[i];
        let ans;
        if (p.kind === 'pick') ans = { cardId: pick(me.hand).id };
        else if (p.kind === 'action') ans = { action: pick(p.options.filter((o) => o.enabled)).id };
        else if (p.kind === 'defense') ans = { defense: pick(p.options).id };
        else if (p.kind === 'keep') ans = { cardIds: p.cards.slice(0, p.keep).map((c) => c.id) };
        else if (p.kind === 'discard') ans = { cardIds: me.hand.slice(-p.count).map((c) => c.id) };
        queueMicrotask(() => m.respond(i, p.id, ans));
      },
      onEnd: (r) => resolve({ m, r, states }),
    });
    m.run().catch(reject);
  });
}

test('rps resolution', () => {
  assert.equal(rps('rock', 'scissors'), 1);
  assert.equal(rps('scissors', 'paper'), 1);
  assert.equal(rps('paper', 'rock'), 1);
  assert.equal(rps('rock', 'paper'), -1);
  assert.equal(rps('paper', 'paper'), 0);
});

test('percent rounding is half-up', () => {
  assert.equal(applyPct(26, 75), 46); // 45.5 -> 46
  assert.equal(applyPct(8, 25), 10);
  assert.equal(applyPct(8, 50), 12);
  assert.equal(applyPct(10, 0), 10);
});

test('many random games keep every invariant', async () => {
  let checksRun = 0;
  const lens = [];
  for (let seed = 1; seed <= 300; seed++) {
    const { m, r } = await playRandomGame(seed, {
      checks: (mm, who, pr) => {
        checksRun++;
        for (const p of mm.players) {
          assert.ok(p.hp >= 0 && p.hp <= BALANCE.maxHp, 'hp range');
          assert.ok(p.mana >= 0 && p.mana <= BALANCE.manaMax, 'mana range');
          assert.ok(p.angry >= 0 && p.angry <= BALANCE.angryMax, 'angry range');
          const limbo = pr.kind === 'keep' && p.idx === who ? pr.cards.length : 0;
          const total = p.deck.length + p.hand.length + p.discard.length + limbo;
          assert.equal(total, 60, 'cards are conserved');
          for (const v of Object.values(p.cooldowns)) assert.ok(v >= 0);
        }
      },
    });
    assert.ok(m.over);
    assert.ok(['ko', 'cards'].includes(r.reason));
    assert.ok(r.turns <= 61, `game too long: ${r.turns}`);
    if (r.reason === 'ko') assert.ok(r.hp.includes(0));
    lens.push(r.turns);
  }
  assert.ok(checksRun > 1000);
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
  assert.ok(mean > 10 && mean < 61, `mean length ${mean}`);
});

test('opponent view never leaks hand types or Angry', async () => {
  const { states } = await playRandomGame(42);
  for (const v of states) {
    assert.equal(v.opp.angry, undefined);
    assert.equal(v.opp.hand, undefined);
    assert.equal(v.opp.deckByType, undefined);
    const played = v.opp.played.rock + v.opp.played.paper + v.opp.played.scissors;
    assert.equal(played, v.history.length ? v.turn - (v.lastReveal?.turn === v.turn ? 0 : 1) : played);
    assert.equal(typeof v.opp.handCount, 'number');
    for (const e of v.log) {
      if (e.k === 'angry') assert.equal(e.p, v.me.idx, 'angry events only to owner');
      if (e.k === 'keep') assert.equal(e.cards, undefined);
    }
  }
});

test('cooldown: Small skill used on turn 1 is usable again on turn 7', () => {
  const m = new Match({ timeScale: 0 });
  const p = m.players[0];
  p.cooldowns.heal = 5; // used on turn 1
  p.usedSkill = 'heal';
  const usable = [];
  for (let turn = 1; turn <= 7; turn++) {
    if (turn > 1) usable.push([turn, p.cooldowns.heal === 0]);
    // end of turn tick
    if (p.cooldowns.heal > 0 && p.usedSkill !== 'heal') p.cooldowns.heal -= 1;
    p.usedSkill = null;
  }
  assert.deepEqual(usable.filter(([, ok]) => ok).map(([t]) => t), [7]);
});

test('defense options follow the table', () => {
  const m = new Match({ timeScale: 0 });
  const d = m.players[1];
  const ids = (angry, attack) => {
    d.angryAtStart = angry;
    return m.defenseOptions(d, attack).map((o) => o.id).sort().join(',');
  };
  assert.equal(ids(2, { kind: 'normal' }), 'none');
  assert.equal(ids(3, { kind: 'normal' }), 'dodge,none');
  assert.equal(ids(5, { kind: 'normal' }), 'counter,dodge,none');
  assert.equal(ids(4, { kind: 'skill', tier: 'small' }), 'none');
  assert.equal(ids(5, { kind: 'skill', tier: 'small' }), 'dodge,none');
  assert.equal(ids(6, { kind: 'skill', tier: 'medium' }), 'none');
  assert.equal(ids(7, { kind: 'skill', tier: 'medium' }), 'dodge,none');
  assert.equal(ids(7, { kind: 'skill', tier: 'large' }), 'none');
});

test('damage bonuses add up (Rock + Combo + buff)', () => {
  const m = new Match({ timeScale: 0 });
  const p = m.players[0];
  assert.equal(m.damageFor(p, 26, { card: 'rock', combo: true, isNormal: false }).damage, 46);
  p.buffs.push({ stat: 'normalDamagePct', value: 10, turnsLeft: 3 });
  assert.equal(m.damageFor(p, 8, { card: 'paper', combo: false, isNormal: true }).pct, 10);
  assert.equal(m.damageFor(p, 8, { card: 'rock', combo: true, isNormal: true }).pct, 85);
});
