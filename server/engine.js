// Authoritative match engine for Combat Rules v1.2.
// The match runs as an async turn loop. Whenever a player must decide something,
// the loop awaits a "prompt" that resolves from the player's answer or a timeout.

import { BALANCE as DEFAULT_BALANCE, activeSkills } from './config.js';

export const TYPES = ['rock', 'paper', 'scissors'];
const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

/** 1 = a wins, -1 = b wins, 0 = draw */
export function rps(a, b) {
  if (a === b) return 0;
  return BEATS[a] === b ? 1 : -1;
}

/** base * (100 + pct)% rounded half up, integer math */
export const applyPct = (base, pct) => Math.floor((base * (100 + pct) + 50) / 100);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const PROMPT_KINDS = ['pick', 'action', 'defense', 'keep', 'discard'];

export class Match {
  /**
   * @param {object} o
   * @param {string[]} o.names
   * @param {(i:number, msg:object)=>void} o.send  transport to player i
   * @param {(i:number, prompt:object)=>void} [o.onPrompt] hook (bots / tests)
   * @param {(result:object)=>void} [o.onEnd]
   */
  constructor({
    names = ['Player 1', 'Player 2'],
    balance = DEFAULT_BALANCE,
    skills = activeSkills(),
    rng = Math.random,
    timeScale = 1,
    send = () => {},
    onPrompt = () => {},
    onEnd = () => {},
  } = {}) {
    this.B = balance;
    this.skills = skills;
    this.skillById = Object.fromEntries(skills.map((s) => [s.id, s]));
    this.rng = rng;
    this.timeScale = timeScale;
    this.sendRaw = send;
    this.onPrompt = onPrompt;
    this.onEnd = onEnd;

    this.turn = 0;
    this.over = false;
    this.result = null;
    this.events = [];
    this.eventSeq = 0;
    this.promptSeq = 0;
    this.pending = [null, null];
    this.cardSeq = 0;
    this.lastReveal = null;
    this.history = []; // public log of revealed cards

    this.players = names.map((name, idx) => ({
      idx,
      name,
      hp: balance.maxHp,
      mana: balance.manaStart,
      angry: 0,
      angryAtStart: 0,
      combo: 0,
      deck: [],
      hand: [],
      discard: [],
      cooldowns: Object.fromEntries(skills.map((s) => [s.id, 0])),
      usedSkill: null,
      buffs: [],
      connected: true,
      stats: { wins: 0, losses: 0, draws: 0, damageDealt: 0, counters: 0, dodges: 0, combos: 0 },
      played: { rock: 0, paper: 0, scissors: 0 }, // public: every RPS card is revealed
    }));
  }

  // ------------------------------------------------------------ utilities
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  newCard(t) {
    return { id: `c${++this.cardSeq}`, t };
  }

  pause(ms) {
    const d = ms * this.timeScale;
    return d > 0 ? new Promise((r) => setTimeout(r, d)) : Promise.resolve();
  }

  other(p) {
    return this.players[1 - p.idx];
  }

  send(i, msg) {
    try {
      this.sendRaw(i, msg);
    } catch {
      /* transport errors must never break the match */
    }
  }

  // ------------------------------------------------------------ events
  /** @param {number[]|null} visibleTo  null = both players */
  emit(ev, visibleTo = null) {
    const e = { seq: ++this.eventSeq, turn: this.turn, ...ev, vis: visibleTo };
    this.events.push(e);
    if (this.events.length > 200) this.events.shift();
    for (const i of [0, 1]) {
      if (!visibleTo || visibleTo.includes(i)) this.send(i, { t: 'event', ev: this.publicEvent(e) });
    }
  }

  publicEvent(e) {
    const { vis, ...rest } = e;
    return rest;
  }

  // ------------------------------------------------------------ prompts
  /**
   * Ask player i to decide. Resolves with a validated answer or the default on timeout.
   * @param {object} prompt  { kind, ... } sent to the client
   * @param {(ans:any)=>any} validate  returns normalized answer or undefined if invalid
   * @param {()=>any} fallback  default answer on timeout
   * @param {number} [autoMs]  resolve with fallback after autoMs (no real choice)
   */
  ask(i, prompt, validate, fallback, autoMs = null) {
    if (this.over) return Promise.resolve(fallback());
    return new Promise((resolve) => {
      const timeoutMs = this.B.turnSeconds * 1000 * (this.timeScale || 0.0001);
      const id = ++this.promptSeq;
      const entry = {
        id,
        prompt: { ...prompt, id },
        deadline: Date.now() + (autoMs != null ? autoMs * this.timeScale : timeoutMs),
        displayDeadline: Date.now() + timeoutMs,
        validate,
        fallback,
        resolve,
        timer: null,
      };
      const wait = autoMs != null ? autoMs * this.timeScale : timeoutMs;
      entry.timer = setTimeout(() => this.finishPrompt(i, entry, fallback(), true), Math.max(0, wait));
      this.pending[i] = entry;
      this.sync();
      this.onPrompt(i, entry.prompt);
    });
  }

  finishPrompt(i, entry, answer, timedOut = false) {
    if (this.pending[i] !== entry) return;
    clearTimeout(entry.timer);
    this.pending[i] = null;
    if (timedOut && entry.prompt.kind !== 'defense') this.emit({ k: 'timeout', p: i, kind: entry.prompt.kind }, [i]);
    entry.resolve(answer);
    if (!this.over) this.sync(); // let both sides see that this decision is locked in
  }

  /** Called by the transport when player i answers prompt promptId. */
  respond(i, promptId, answer) {
    const entry = this.pending[i];
    if (!entry || entry.id !== promptId) return false;
    let v;
    try {
      v = entry.validate(answer);
    } catch {
      v = undefined;
    }
    if (v === undefined) return false;
    this.finishPrompt(i, entry, v);
    return true;
  }

  // ------------------------------------------------------------ views
  viewFor(i) {
    const me = this.players[i];
    const op = this.other(me);
    const now = Date.now();
    const mine = this.pending[i];
    const theirs = this.pending[1 - i];
    return {
      turn: this.turn,
      over: this.over,
      result: this.result,
      me: {
        idx: i,
        name: me.name,
        hp: me.hp,
        mana: me.mana,
        angry: me.angry,
        angryAtStart: me.angryAtStart,
        combo: me.combo,
        hand: me.hand,
        deckCount: me.deck.length,
        deckByType: TYPES.reduce((o, t) => ((o[t] = me.deck.filter((c) => c.t === t).length), o), {}),
        played: me.played,
        discardCount: me.discard.length,
        cooldowns: me.cooldowns,
        buffs: me.buffs,
        stats: me.stats,
      },
      opp: {
        idx: op.idx,
        name: op.name,
        hp: op.hp,
        mana: op.mana,
        combo: op.combo,
        handCount: op.hand.length,
        deckCount: op.deck.length,
        played: op.played,
        cooldowns: op.cooldowns,
        buffs: op.buffs,
        connected: op.connected,
        stats: this.over ? op.stats : undefined,
      },
      prompt: mine ? { ...mine.prompt, remainingMs: Math.max(0, mine.displayDeadline - now) } : null,
      oppPrompt: theirs ? { kind: theirs.prompt.kind, remainingMs: Math.max(0, theirs.displayDeadline - now) } : null,
      lastReveal: this.lastReveal,
      history: this.history.slice(-10),
      log: this.events.filter((e) => !e.vis || e.vis.includes(i)).slice(-40).map((e) => this.publicEvent(e)),
    };
  }

  sync() {
    for (const i of [0, 1]) this.send(i, { t: 'state', view: this.viewFor(i) });
  }

  // ------------------------------------------------------------ card helpers
  drawTo(p, n) {
    let drawn = 0;
    for (let k = 0; k < n && p.deck.length; k++) {
      p.hand.push(p.deck.pop());
      drawn++;
    }
    return drawn;
  }

  async enforceHandLimit(p) {
    const over = p.hand.length - this.B.handLimit;
    if (over <= 0 || this.over) return;
    const ids = await this.ask(
      p.idx,
      { kind: 'discard', count: over },
      (a) => {
        const list = a?.cardIds;
        if (!Array.isArray(list) || list.length !== over || new Set(list).size !== over) return undefined;
        return list.every((id) => p.hand.some((c) => c.id === id)) ? list : undefined;
      },
      () => p.hand.slice(0, over).map((c) => c.id),
    );
    for (const id of ids) {
      const k = p.hand.findIndex((c) => c.id === id);
      if (k >= 0) p.discard.push(...p.hand.splice(k, 1));
    }
    this.emit({ k: 'discard', p: p.idx, count: ids.length });
  }

  /** Open n from the top of the deck, keep k, shuffle the rest back. */
  async openAndKeep(p, n, k, source) {
    const opened = [];
    for (let x = 0; x < n && p.deck.length; x++) opened.push(p.deck.pop());
    if (!opened.length) return 0;
    const keepN = Math.min(k, opened.length);
    const ids = await this.ask(
      p.idx,
      { kind: 'keep', source, cards: opened, keep: keepN },
      (a) => {
        const list = a?.cardIds;
        if (!Array.isArray(list) || list.length !== keepN || new Set(list).size !== keepN) return undefined;
        return list.every((id) => opened.some((c) => c.id === id)) ? list : undefined;
      },
      () => opened.slice(0, keepN).map((c) => c.id),
    );
    for (const c of opened) (ids.includes(c.id) ? p.hand : p.deck).push(c);
    this.shuffle(p.deck);
    this.emit({ k: 'keep', p: p.idx, source, kept: keepN, opened: opened.length });
    await this.enforceHandLimit(p);
    return keepN;
  }

  // ------------------------------------------------------------ rules helpers
  addMana(p, n) {
    const before = p.mana;
    p.mana = clamp(p.mana + n, 0, this.B.manaMax);
    return p.mana - before;
  }

  heal(p, n) {
    const before = p.hp;
    p.hp = clamp(p.hp + n, 0, this.B.maxHp);
    return p.hp - before;
  }

  buffTotal(p, stat) {
    return p.buffs.filter((b) => b.stat === stat).reduce((s, b) => s + b.value, 0);
  }

  damageFor(p, base, { card, combo, isNormal }) {
    let pct = 0;
    if (card === 'rock') pct += this.B.rockDamagePct;
    if (combo) pct += this.B.comboDamagePct;
    pct += this.buffTotal(p, 'damagePct');
    if (isNormal) pct += this.buffTotal(p, 'normalDamagePct');
    return { damage: applyPct(base, pct), pct };
  }

  skillReady(p, s) {
    return p.cooldowns[s.id] === 0 && p.mana >= s.cost;
  }

  /** All options shown to the winner, with enabled flags and previews. */
  actionOptions(p, card, combo) {
    const B = this.B;
    const opts = [];
    const n = this.damageFor(p, B.normalDamage, { card, combo, isNormal: true });
    opts.push({ id: 'normal', label: 'Normal Attack', enabled: true, damage: n.damage, pct: n.pct, defend: 'counter+dodge' });
    opts.push({ id: 'charge', label: 'Charge Mana', enabled: true, mana: B.chargeMana + (combo ? B.comboChargeMana : 0) });
    const da = combo ? B.drawActionCombo : B.drawAction;
    opts.push({
      id: 'draw', label: 'Draw Action', enabled: p.deck.length > 0,
      open: da.open, keep: da.keep, mana: B.drawAction.mana, reason: p.deck.length ? null : 'สำรับหมด',
    });
    for (const s of this.skills) {
      const o = { id: `skill:${s.id}`, skill: s.id, label: s.name, tier: s.tier, cost: s.cost, cooldown: p.cooldowns[s.id], enabled: this.skillReady(p, s) };
      if (!o.enabled) o.reason = p.cooldowns[s.id] > 0 ? `Cooldown ${p.cooldowns[s.id]}` : `Mana ไม่พอ`;
      const dmg = s.effects.find((e) => e.type === 'damage');
      if (dmg) Object.assign(o, this.damageFor(p, dmg.base, { card, combo, isNormal: false }));
      const h = s.effects.find((e) => e.type === 'heal');
      if (h) o.heal = h.amount * (combo ? B.comboHealMult : 1);
      opts.push(o);
    }
    return opts;
  }

  /** Defense options for the defender against an attack descriptor. */
  defenseOptions(def, attack) {
    const B = this.B;
    const a = def.angryAtStart;
    const opts = [{ id: 'none', label: 'รับดาเมจ' }];
    const tierKey = attack.kind === 'normal' ? 'normal' : attack.tier;
    if (attack.kind === 'normal' && a >= B.counterCost) opts.push({ id: 'counter', label: 'Counter Attack', cost: B.counterCost, damage: B.counterDamage });
    const dc = B.dodgeCost[tierKey];
    if (dc != null && a >= dc) opts.push({ id: 'dodge', label: 'Dodge', cost: dc });
    return opts;
  }

  // ------------------------------------------------------------ effects
  // Handlers for non-damage skill effects. Add new effect types here.
  get EFFECTS() {
    return {
      heal: (m, caster, _target, eff, ctx) => {
        const amt = m.heal(caster, eff.amount * (ctx.combo ? m.B.comboHealMult : 1));
        m.emit({ k: 'heal', p: caster.idx, amount: amt, source: ctx.skill.id });
      },
      mana: (m, caster, _t, eff) => {
        const g = m.addMana(caster, eff.amount);
        m.emit({ k: 'mana', p: caster.idx, amount: g, source: 'skill' });
      },
      buff: (m, caster, _t, eff, ctx) => {
        caster.buffs.push({ stat: eff.stat, value: eff.value, turnsLeft: eff.turns, from: ctx.skill.id, createdTurn: m.turn });
        m.emit({ k: 'buff', p: caster.idx, stat: eff.stat, value: eff.value, turns: eff.turns, source: ctx.skill.id });
      },
    };
  }

  // ------------------------------------------------------------ main loop
  async run() {
    const B = this.B;
    for (const p of this.players) {
      for (const t of TYPES) for (let k = 0; k < B.deck[t]; k++) p.deck.push(this.newCard(t));
      this.shuffle(p.deck);
      this.drawTo(p, B.startHand);
    }
    this.emit({ k: 'start', names: this.players.map((p) => p.name) });

    while (!this.over) {
      await this.playTurn();
    }
  }

  async playTurn() {
    const B = this.B;
    this.turn += 1;
    const [A, Bp] = this.players;
    for (const p of this.players) {
      p.usedSkill = null;
      this.drawTo(p, B.drawPerTurn);
    }
    this.emit({ k: 'turn', n: this.turn });
    await Promise.all(this.players.map((p) => this.enforceHandLimit(p)));
    if (this.over) return;
    for (const p of this.players) p.angryAtStart = p.angry;
    this.lastReveal = null;

    // 1) both pick a card simultaneously
    const picks = await Promise.all(
      this.players.map((p) =>
        this.ask(
          p.idx,
          { kind: 'pick' },
          (a) => (p.hand.some((c) => c.id === a?.cardId) ? a.cardId : undefined),
          () => p.hand[Math.floor(this.rng() * p.hand.length)]?.id,
        ),
      ),
    );
    if (this.over) return;
    const played = this.players.map((p, i) => {
      const k = p.hand.findIndex((c) => c.id === picks[i]);
      const [card] = p.hand.splice(k, 1);
      p.discard.push(card);
      return card.t;
    });
    const playedLast = this.players.map((p) => p.hand.length === 0);
    const res = rps(played[0], played[1]);
    const winnerIdx = res === 1 ? 0 : res === -1 ? 1 : -1;
    this.lastReveal = { turn: this.turn, cards: played, winner: winnerIdx };
    this.history.push(this.lastReveal);
    this.players.forEach((p, i) => p.played[played[i]]++);
    this.emit({ k: 'reveal', cards: played, winner: winnerIdx });
    this.sync();
    await this.pause(B.revealPauseMs);

    if (winnerIdx === -1) {
      for (const p of this.players) {
        p.stats.draws++;
        const g = this.addMana(p, B.rpsDrawMana);
        this.emit({ k: 'mana', p: p.idx, amount: g, source: 'draw' });
      }
    } else {
      const w = this.players[winnerIdx];
      const l = this.other(w);
      w.stats.wins++;
      l.stats.losses++;
      l.angry = clamp(l.angry + B.angryPerLoss, 0, B.angryMax);
      this.emit({ k: 'angry', p: l.idx, value: l.angry }, [l.idx]);
      l.combo = 0;
      w.combo += 1;
      let combo = false;
      if (w.combo >= B.comboThreshold) {
        combo = true;
        w.combo = 0;
        w.stats.combos++;
        this.emit({ k: 'combo', p: w.idx });
      }
      const card = played[winnerIdx];
      await this.winnerTurn(w, l, card, combo);
    }
    if (this.over) return;

    // end of turn
    for (const p of this.players) {
      for (const s of this.skills) {
        if (p.cooldowns[s.id] > 0 && p.usedSkill !== s.id) p.cooldowns[s.id] -= 1;
      }
      for (const b of p.buffs) if (b.createdTurn !== this.turn) b.turnsLeft -= 1;
      p.buffs = p.buffs.filter((b) => b.turnsLeft > 0);
    }

    const ko = A.hp <= 0 || Bp.hp <= 0;
    if (ko || playedLast[0] || playedLast[1]) {
      this.endGame(ko ? 'ko' : 'cards');
    } else {
      this.sync();
    }
  }

  async winnerTurn(w, l, card, combo) {
    const B = this.B;
    const options = this.actionOptions(w, card, combo);
    const action = await this.ask(
      w.idx,
      { kind: 'action', options, card, combo },
      (a) => {
        const o = options.find((x) => x.id === a?.action);
        return o && o.enabled ? o.id : undefined;
      },
      () => 'normal',
    );
    if (this.over) return;

    let attack = null; // { kind:'normal'|'skill', tier, damage, label }
    if (action === 'normal') {
      const { damage } = this.damageFor(w, B.normalDamage, { card, combo, isNormal: true });
      attack = { kind: 'normal', tier: null, damage, label: 'Normal Attack' };
      this.emit({ k: 'action', p: w.idx, action: 'normal', combo, card });
    } else if (action === 'charge') {
      const g = this.addMana(w, B.chargeMana + (combo ? B.comboChargeMana : 0));
      this.emit({ k: 'action', p: w.idx, action: 'charge', combo, card });
      this.emit({ k: 'mana', p: w.idx, amount: g, source: 'charge' });
    } else if (action === 'draw') {
      this.emit({ k: 'action', p: w.idx, action: 'draw', combo, card });
      const da = combo ? B.drawActionCombo : B.drawAction;
      await this.openAndKeep(w, da.open, da.keep, 'draw');
      const g = this.addMana(w, B.drawAction.mana);
      this.emit({ k: 'mana', p: w.idx, amount: g, source: 'draw-action' });
    } else if (action.startsWith('skill:')) {
      const s = this.skillById[action.slice(6)];
      w.mana -= s.cost;
      w.cooldowns[s.id] = s.cooldown;
      w.usedSkill = s.id;
      this.emit({ k: 'action', p: w.idx, action: 'skill', skill: s.id, name: s.name, tier: s.tier, combo, card });
      const ctx = { skill: s, combo, card };
      for (const eff of s.effects) {
        if (eff.type === 'damage') {
          const { damage } = this.damageFor(w, eff.base, { card, combo, isNormal: false });
          attack = { kind: 'skill', tier: s.tier, damage: (attack?.damage || 0) + damage, label: s.name, skill: s.id };
        } else {
          this.EFFECTS[eff.type]?.(this, w, l, eff, ctx);
        }
      }
    }
    if (this.over) return;
    if (attack) await this.resolveAttack(w, l, attack);
    if (this.over) return;

    // Hand bonus (non-damage parts)
    if (card === 'scissors') {
      const g = this.addMana(w, B.scissorsMana);
      let h = 0;
      if (w.hp > 0) {
        const raw = Math.floor((w.hp * B.scissorsHealPct + 50) / 100);
        const cap = Math.floor((B.maxHp * B.scissorsHealCapPct + 50) / 100);
        h = this.heal(w, Math.min(raw, cap));
      }
      this.emit({ k: 'bonus', p: w.idx, card, mana: g, heal: h });
    } else if (card === 'paper' && w.deck.length && w.hp > 0 && l.hp > 0) {
      this.emit({ k: 'bonus', p: w.idx, card });
      await this.openAndKeep(w, B.paperBonus.open, B.paperBonus.keep, 'paper');
    } else if (card === 'rock' && attack) {
      // Rock bonus already applied to damage; just note it
    }
  }

  async resolveAttack(w, l, attack) {
    const B = this.B;
    const options = this.defenseOptions(l, attack);
    const hasChoice = options.length > 1;
    const [lo, hi] = B.defenseAutoDelayMs;
    const autoMs = hasChoice ? null : lo + this.rng() * (hi - lo);
    const choice = await this.ask(
      l.idx,
      { kind: 'defense', incoming: { kind: attack.kind, tier: attack.tier, label: attack.label, damage: attack.damage, skill: attack.skill }, options, hasChoice },
      (a) => (options.some((o) => o.id === a?.defense) ? a.defense : undefined),
      () => 'none',
      autoMs,
    );
    if (choice === 'counter') {
      l.angry = clamp(l.angry - B.counterCost, 0, B.angryMax);
      l.stats.counters++;
      w.hp = clamp(w.hp - B.counterDamage, 0, B.maxHp);
      l.stats.damageDealt += B.counterDamage;
      this.emit({ k: 'counter', p: l.idx, damage: B.counterDamage, blocked: attack.damage, label: attack.label });
      this.emit({ k: 'angry', p: l.idx, value: l.angry }, [l.idx]);
    } else if (choice === 'dodge') {
      const tierKey = attack.kind === 'normal' ? 'normal' : attack.tier;
      l.angry = clamp(l.angry - B.dodgeCost[tierKey], 0, B.angryMax);
      l.stats.dodges++;
      this.emit({ k: 'dodge', p: l.idx, blocked: attack.damage, label: attack.label });
      this.emit({ k: 'angry', p: l.idx, value: l.angry }, [l.idx]);
    } else {
      const before = l.hp;
      l.hp = clamp(l.hp - attack.damage, 0, B.maxHp);
      w.stats.damageDealt += before - l.hp;
      this.emit({ k: 'damage', p: l.idx, from: w.idx, amount: attack.damage, label: attack.label, tier: attack.tier, kind: attack.kind });
    }
    this.sync();
    await this.pause(B.resolvePauseMs);
  }

  // ------------------------------------------------------------ end
  endGame(reason, forfeitIdx = null) {
    if (this.over) return;
    this.over = true;
    const [a, b] = this.players;
    let winner;
    if (forfeitIdx != null) winner = 1 - forfeitIdx;
    else if (a.hp > b.hp) winner = 0;
    else if (b.hp > a.hp) winner = 1;
    else winner = -1;
    this.result = { winner, reason, turns: this.turn, hp: [a.hp, b.hp] };
    for (const i of [0, 1]) {
      const e = this.pending[i];
      if (e) this.finishPrompt(i, e, e.fallback());
    }
    this.emit({ k: 'end', ...this.result });
    this.sync();
    this.onEnd(this.result);
  }

  forfeit(i) {
    this.endGame('forfeit', i);
  }

  setConnected(i, v) {
    this.players[i].connected = v;
    this.sync();
  }
}

export { PROMPT_KINDS };
