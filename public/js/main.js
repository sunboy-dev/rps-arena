import { Net, session } from './net.js';
import { createAudio } from './audio.js';

const sound = createAudio();
// browsers only allow sound after a user gesture
for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, () => sound.unlock(), { capture: true });

// ------------------------------------------------------------ helpers
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get(k, d = '') {
    try {
      return localStorage.getItem(k) ?? d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};

const TYPES = {
  rock: { th: 'ค้อน', en: 'Rock', bonus: '+25% Damage', grad: 'g-orange', beats: 'กรรไกร' },
  paper: { th: 'กระดาษ', en: 'Paper', bonus: 'เปิด 2 เก็บ 1', grad: 'g-violet', beats: 'ค้อน' },
  scissors: { th: 'กรรไกร', en: 'Scissors', bonus: '+1 Mana · Heal 5%', grad: 'g-magenta', beats: 'กระดาษ' },
};
const ORDER = { rock: 0, paper: 1, scissors: 2 };
const ICON = {
  rock: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 5 40 14.5v19L24 43 8 33.5v-19Z" fill="currentColor"/><path d="M24 5v38M8 14.5l32 19M40 14.5l-32 19" stroke="#000" stroke-opacity=".18" stroke-width="1.5"/></svg>',
  paper: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="11" y="6" width="26" height="36" rx="4" fill="currentColor"/><path d="M17 16h14M17 22.5h14M17 29h9" stroke="#000" stroke-opacity=".3" stroke-width="2.6" stroke-linecap="round"/></svg>',
  scissors: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" aria-hidden="true"><circle cx="14" cy="35" r="6.5"/><circle cx="34" cy="35" r="6.5"/><path d="M18.5 30 37 7M29.5 30 11 7"/></svg>',
};
const TIER = { small: 'Small', medium: 'Medium', large: 'Large' };

// ------------------------------------------------------------ 3D background (optional)
let scene = { fx() {}, setHp() {}, setActive() {}, setAnchors() {} };
import('./scene.js')
  .then((m) => {
    try {
      scene = m.createScene(document.getElementById('bg'));
      updateAnchors();
    } catch (e) {
      console.warn('3D background disabled:', e);
    }
  })
  .catch((e) => console.warn('3D background failed to load:', e));

// ------------------------------------------------------------ state
const S = {
  screen: 'lobby',
  status: 'connecting',
  name: store.get('rps-name', ''),
  code: null,
  you: null,
  config: null,
  lobby: null,
  view: null,
  selType: null, // pick: chosen card type
  picks: {}, // keep/discard: count per type
  logOpen: innerWidth >= 1500 && store.get('rps-log-open', '0') === '1',
  answeredId: null,
  promptId: null,
  deadline: 0,
  deadlineTotal: 20000,
  myPick: null, // { turn, type }
  rematchVotes: [],
  keys: {},
  pendingJoin: null,
};

const app = $('#app');
const net = new Net(onMessage, (st) => {
  S.status = st;
  const el = $('#net-status');
  if (el) el.textContent = statusText();
  document.body.classList.toggle('offline', st === 'offline');
});

function statusText() {
  return S.status === 'online' ? 'เชื่อมต่อเซิร์ฟเวอร์แล้ว' : S.status === 'offline' ? 'ขาดการเชื่อมต่อ กำลังลองใหม่…' : 'กำลังเชื่อมต่อ…';
}

// ------------------------------------------------------------ toasts & callouts
function toast(text, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  $('#toasts').append(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3100);
}

function callout(text, grad = '') {
  const el = document.createElement('div');
  el.className = `callout ${grad}`;
  el.textContent = text;
  $('#callouts').append(el);
  setTimeout(() => el.remove(), 1300);
}

function floatText(who, text, kind) {
  const panel = $(who === 'me' ? '#me-panel' : '#opp-panel');
  if (!panel) return;
  const el = document.createElement('span');
  el.className = `float ${kind}`;
  el.textContent = text;
  el.style.left = `${30 + Math.random() * 40}%`;
  panel.append(el);
  setTimeout(() => el.remove(), 1500);
  if (kind === 'dmg') {
    panel.classList.remove('hit');
    void panel.offsetWidth;
    panel.classList.add('hit');
  }
}

// ------------------------------------------------------------ UI sounds
const CLICKABLE = '.pill:not(:disabled), .icon-btn, .action-tile:not(:disabled)';
document.addEventListener('click', (e) => {
  if (e.target.closest(CLICKABLE)) sound.play('click');
});
document.addEventListener('pointerover', (e) => {
  const el = e.target.closest(CLICKABLE + ', .stack.clickable');
  if (el && !el.contains(e.relatedTarget)) sound.play('hover');
});

// ------------------------------------------------------------ network messages
function onMessage(m) {
  // after leaving a room, late messages from it are ignored
  if (!S.code && ['start', 'state', 'event', 'rematch', 'lobby'].includes(m.t)) return;
  switch (m.t) {
    case 'joined':
      S.code = m.code;
      S.you = m.you;
      S.config = m.config;
      session.set({ code: m.code, token: m.token });
      history.replaceState(null, '', `/room/${m.code}`);
      if (S.screen !== 'battle') show('waiting');
      break;
    case 'lobby':
      if (S.screen === 'waiting' && (S.lobby?.players.length || 0) < 2 && m.players.length === 2) sound.play('joined');
      S.lobby = m;
      if (S.screen === 'waiting') renderWaiting();
      break;
    case 'start':
      S.lastAngry = 0;
      S.you = m.you;
      S.view = null;
      S.rematchVotes = [];
      S.myPick = null;
      S.keys = {};
      if (!m.resumed) {
        scene.fx('reset');
        sound.play('start');
      }
      S.prevView = null;
      show('battle');
      break;
    case 'state':
      S.view = m.view;
      if (S.screen !== 'battle') show('battle');
      updateBattle();
      break;
    case 'event':
      onEvent(m.ev);
      break;
    case 'rematch':
      if (m.votes.includes(1 - S.you) && !m.votes.includes(S.you)) sound.play('rematchAsk');
      S.rematchVotes = m.votes;
      updateBattle();
      break;
    case 'error':
      if (m.code === 'rejoin-failed') {
        session.clear();
        if (S.screen !== 'lobby') {
          toast('ห้องเดิมหมดอายุแล้ว', 'warn');
          goLobby();
        }
      } else toast(m.msg || 'เกิดข้อผิดพลาด', 'warn');
      break;
    default:
      break;
  }
}

// ------------------------------------------------------------ screens
function show(screen) {
  S.screen = screen;
  document.body.dataset.screen = screen;
  if (screen === 'lobby') renderLobby();
  else if (screen === 'waiting') renderWaiting();
  else if (screen === 'battle') buildBattle();
  updateAnchors();
  sound.music(screen === 'battle' ? 'battle' : 'lobby');
  if (screen !== 'battle') {
    sound.heartbeat(false);
    sound.setIntensity(0);
  }
}

// Keep the 3D cores behind the card slots while in battle.
function updateAnchors() {
  const a = S.screen === 'battle' && $('#slot-me') && $('#slot-opp');
  if (!a) return scene.setAnchors(null);
  const r = (el) => {
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, size: Math.max(60, b.width) };
  };
  const me = r($('#slot-me'));
  const opp = r($('#slot-opp'));
  if (me.y === 0 && opp.y === 0) return;
  scene.setAnchors({ me, opp });
}
window.addEventListener('resize', () => requestAnimationFrame(updateAnchors));

function goLobby() {
  net.send({ t: 'leave' });
  session.clear();
  S.code = null;
  S.view = null;
  history.replaceState(null, '', '/');
  scene.fx('reset');
  show('lobby');
}

function renderLobby() {
  const urlCode = (location.pathname.match(/^\/room\/([A-Za-z0-9]{4})/) || [])[1] || '';
  app.innerHTML = `
  <main class="lobby">
    <section class="hero">
      <p class="eyebrow">Card Battle · Online POC</p>
      <h1 class="display-xxl">RPS<br/>Arena</h1>
      <p class="subhead">เป่ายิงฉุบด้วยการ์ดในมือ ชนะแล้วเลือกได้ว่าจะโจมตี ใช้สกิล หรือสะสม Mana แพ้แล้วสะสม Angry ไว้ Counter และ Dodge</p>
    </section>
    <section class="join-card">
      <label class="field">
        <span class="caption muted">ชื่อผู้เล่น</span>
        <input id="name" maxlength="16" autocomplete="nickname" placeholder="ชื่อของคุณ" value="${esc(S.name)}" />
      </label>
      <button class="pill primary block" id="create">สร้างห้องใหม่</button>
      <div class="divider"><span>หรือเข้าร่วมด้วยรหัสห้อง</span></div>
      <div class="join-row">
        <input id="code" class="code-input" maxlength="4" placeholder="ABCD" autocomplete="off" value="${esc(urlCode.toUpperCase())}" />
        <button class="pill secondary" id="join">เข้าร่วม</button>
      </div>
      <div class="sound-settings">
        <div class="sound-head"><span class="caption muted">เสียง</span>
          <button class="pill secondary sm" id="mute-btn">${sound.settings.muted ? 'เปิดเสียง' : 'ปิดเสียง'}</button></div>
        ${[
          ['music', 'เพลง'],
          ['sfx', 'เอฟเฟกต์'],
          ['ui', 'ปุ่ม'],
        ]
          .map(([k, label]) => `<label class="slider"><span class="caption">${label}</span><input type="range" min="0" max="1" step="0.05" value="${sound.settings[k]}" data-vol="${k}" /></label>`)
          .join('')}
      </div>
      <p class="micro muted" id="net-status">${statusText()}</p>
    </section>
    <section class="type-row" aria-label="การ์ด 3 ชนิด">
      ${Object.entries(TYPES)
        .map(
          ([t, d]) => `
        <article class="type-card ${d.grad}">
          <div class="type-icon">${ICON[t]}</div>
          <div>
            <h3 class="display-md">${d.th}</h3>
            <p class="caption">ชนะ${d.beats} · ${d.en}</p>
          </div>
          <p class="type-bonus">${d.bonus}</p>
        </article>`,
        )
        .join('')}
    </section>
    <section class="rules">
      <div><h4 class="headline">ชนะ RPS</h4><p class="muted">เลือก Action หนึ่งอย่าง: Normal Attack, Charge Mana, Draw Action หรือสกิล และได้โบนัสตามการ์ดที่ใช้ชนะ ชนะติดกัน 3 ครั้งได้ Combo</p></div>
      <div><h4 class="headline">แพ้ RPS</h4><p class="muted">Angry +1 (ซ่อนจากคู่ต่อสู้) ใช้ Dodge (3) หรือ Counter (5) เมื่อถูกโจมตี Ultimate ป้องกันไม่ได้</p></div>
      <div><h4 class="headline">จบเกม</h4><p class="muted">HP หมด หรือมีฝ่ายลงการ์ดใบสุดท้าย ฝ่ายที่ HP มากกว่าชนะ แต่ละ Turn มีเวลา 20 วินาที</p></div>
    </section>
  </main>`;
  const nameEl = $('#name');
  const codeEl = $('#code');
  const saveName = () => {
    S.name = nameEl.value.trim();
    store.set('rps-name', S.name);
  };
  nameEl.addEventListener('input', saveName);
  codeEl.addEventListener('input', () => (codeEl.value = codeEl.value.toUpperCase().replace(/[^A-Z0-9]/g, '')));
  $('#create').onclick = () => {
    sound.play('confirm');
    saveName();
    net.send({ t: 'create', name: S.name || 'Player' });
  };
  const join = () => {
    saveName();
    if (codeEl.value.length !== 4) {
      toast('ใส่รหัสห้อง 4 ตัว', 'warn');
      codeEl.focus();
      return;
    }
    net.send({ t: 'join', code: codeEl.value, name: S.name || 'Player' });
  };
  $('#join').onclick = join;
  $('#mute-btn').onclick = (e) => {
    sound.set('muted', !sound.settings.muted);
    e.currentTarget.textContent = sound.settings.muted ? 'เปิดเสียง' : 'ปิดเสียง';
  };
  $$('[data-vol]').forEach((r) => {
    r.oninput = () => sound.set(r.dataset.vol, Number(r.value));
    r.onchange = () => sound.play(r.dataset.vol === 'music' ? 'mana' : r.dataset.vol === 'ui' ? 'click' : 'hit', { power: 10 });
  });
  codeEl.addEventListener('keydown', (e) => e.key === 'Enter' && join());
  (urlCode ? codeEl : nameEl).focus();
  if (urlCode) $('#join').classList.replace('secondary', 'primary');
}

function renderWaiting() {
  const link = `${location.origin}/room/${S.code}`;
  const players = S.lobby?.players || [];
  app.innerHTML = `
  <main class="waiting">
    <p class="eyebrow">ห้องของคุณ</p>
    <h1 class="display-xxl room-code">${esc(S.code)}</h1>
    <p class="body-lg muted">ส่งรหัสหรือลิงก์ให้เพื่อน เกมเริ่มทันทีเมื่อมีผู้เล่นครบ 2 คน</p>
    <div class="link-box"><span>${esc(link)}</span></div>
    <div class="row">
      <button class="pill primary" id="copy">คัดลอกลิงก์</button>
      <button class="pill secondary" id="leave">ออก</button>
    </div>
    <ul class="seat-list">
      ${[0, 1]
        .map((i) => {
          const p = players[i];
          return `<li class="${p ? 'filled' : ''}"><span class="avatar ${i === S.you ? 'me' : 'opp'}">${p ? esc(p.name[0] || '?') : ''}</span><span>${p ? esc(p.name) + (i === S.you ? ' (คุณ)' : '') : 'รอผู้เล่น…'}</span></li>`;
        })
        .join('')}
    </ul>
  </main>`;
  $('#copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(link);
      sound.play('copy');
      toast('คัดลอกลิงก์แล้ว');
    } catch {
      toast(link);
    }
  };
  $('#leave').onclick = goLobby;
}

// ------------------------------------------------------------ battle
function buildBattle() {
  S.keys = {};
  app.innerHTML = `
  <div class="battle ${S.logOpen ? 'log-open' : ''}">
    <header class="topbar">
      <span class="brand">RPS Arena</span>
      <span class="chip">ห้อง <b>${esc(S.code || '')}</b></span>
      <span class="chip" id="turn-chip">Turn –</span>
      <span class="spacer"></span>
      <button class="pill secondary sm" id="log-toggle" aria-pressed="${S.logOpen}">${S.logOpen ? 'ซ่อน Log' : 'Battle Log'}</button>
      <button class="icon-btn sound-btn" id="sound-toggle" aria-label="เปิด/ปิดเสียง" aria-pressed="${!sound.settings.muted}">${speakerIcon()}</button>
      <button class="pill secondary sm" id="leave">ออกจากเกม</button>
    </header>
    <div class="banner" id="banner" hidden></div>
    <section class="panel opp" id="opp-panel"></section>
    <section class="arena">
      <div class="slot-wrap"><span class="slot-label caption muted">คู่ต่อสู้</span><div class="slot" id="slot-opp"></div></div>
      <div class="center">
        <div class="timer" id="timer">
          <svg viewBox="0 0 64 64"><circle class="t-track" cx="32" cy="32" r="28"/><circle class="t-bar" id="timer-bar" cx="32" cy="32" r="28"/></svg>
          <span id="timer-num">–</span>
        </div>
        <div class="phase">
          <h2 class="phase-title" id="phase-title">กำลังเริ่ม…</h2>
          <p class="phase-sub muted" id="phase-sub"></p>
        </div>
      </div>
      <div class="slot-wrap"><span class="slot-label caption muted">คุณ</span><div class="slot" id="slot-me"></div></div>
    </section>
    <section class="panel me" id="me-panel"></section>
    <section class="stage" id="stage"></section>
    <aside class="log" id="log">
      <div class="log-head"><h3 class="caption muted">Battle Log</h3><button class="icon-btn" id="log-close" aria-label="ปิด Log">×</button></div>
      <ol id="log-list"></ol>
    </aside>
  </div>`;
  let armed = false;
  $('#leave').onclick = (e) => {
    if (S.view?.over || armed) return goLobby();
    armed = true;
    e.currentTarget.textContent = 'กดอีกครั้งเพื่อยอมแพ้';
    e.currentTarget.classList.add('danger');
    setTimeout(() => {
      armed = false;
      const b = $('#leave');
      if (b) {
        b.textContent = 'ออกจากเกม';
        b.classList.remove('danger');
      }
    }, 3000);
  };
  $('#log-toggle').onclick = () => setLog(!S.logOpen);
  $('#sound-toggle').onclick = (ev) => {
    sound.set('muted', !sound.settings.muted);
    ev.currentTarget.innerHTML = speakerIcon();
    ev.currentTarget.setAttribute('aria-pressed', String(!sound.settings.muted));
  };
  $('#log-close').onclick = () => setLog(false);
  if (S.view) updateBattle();
}

function setLog(open) {
  S.logOpen = open;
  if (innerWidth >= 1500) store.set('rps-log-open', open ? '1' : '0');
  $('.battle')?.classList.toggle('log-open', open);
  const b = $('#log-toggle');
  if (b) {
    b.textContent = open ? 'ซ่อน Log' : 'Battle Log';
    b.setAttribute('aria-pressed', String(open));
  }
  if (open) {
    const list = $('#log-list');
    if (list) list.scrollTop = list.scrollHeight;
  }
  requestAnimationFrame(updateAnchors);
}

function speakerIcon() {
  const waves = sound.settings.muted
    ? '<path d="M16 9l5 6M21 9l-5 6" />'
    : '<path d="M16 8.5a5 5 0 0 1 0 7M18.8 6a8.5 8.5 0 0 1 0 12" />';
  return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="none"/>${waves}</svg>`;
}

const rel = (idx) => (idx === S.you ? 'me' : 'opp');

function changed(key, value) {
  if (S.keys[key] === value) return false;
  S.keys[key] = value;
  return true;
}

function updateBattle() {
  const v = S.view;
  if (!v || S.screen !== 'battle' || !$('#stage')) return;
  stateSounds(S.prevView, v);
  S.prevView = v;
  const p = v.prompt;
  if (p?.id !== S.promptId) {
    S.promptId = p?.id ?? null;
    S.selType = null;
    S.picks = {};
  }
  const timerSrc = p || v.oppPrompt;
  if (timerSrc) {
    S.deadline = performance.now() + timerSrc.remainingMs;
    S.deadlineTotal = (S.config?.balance.turnSeconds || 20) * 1000;
  } else S.deadline = 0;

  $('#turn-chip').textContent = `Turn ${v.turn}`;
  const banner = $('#banner');
  banner.hidden = v.opp.connected || v.over;
  banner.textContent = 'คู่ต่อสู้หลุดการเชื่อมต่อ รอให้กลับมา 45 วินาที ไม่งั้นคุณชนะ';

  renderPanel('opp');
  renderPanel('me');
  renderSlots();
  if (changed('anchor-size', `${innerWidth}x${innerHeight}`) || !S.keys.anchored) {
    S.keys.anchored = true;
    requestAnimationFrame(updateAnchors);
  }
  renderPhase();
  renderStage();
  renderLog();

  const max = S.config?.balance.maxHp || 100;
  scene.setHp(v.me.hp / max, v.opp.hp / max);
  scene.setActive(p && p.kind !== 'pick' ? 'me' : v.oppPrompt && v.oppPrompt.kind !== 'pick' ? 'opp' : null);
}

// Sounds that come from comparing two snapshots of the game.
// Only your own hidden values (Angry, hand) ever trigger sounds; nothing reveals the opponent's.
function stateSounds(prev, v) {
  const B = S.config.balance;
  const lowHp = (x) => x.hp > 0 && x.hp / B.maxHp <= 0.3;
  sound.heartbeat(!v.over && lowHp(v.me));
  sound.setIntensity(!v.over && (lowHp(v.me) || lowHp(v.opp) || v.me.deckCount < 10));
  if (!prev || v.over) return;
  const p = v.prompt;
  if (p && p.id !== prev.prompt?.id) {
    if (p.kind === 'defense') sound.play('alarm', { strong: p.hasChoice });
    if (p.kind === 'keep') sound.play('open', { n: p.cards.length });
  }
  const revealed = v.lastReveal && v.lastReveal.turn === v.turn;
  if (prev.oppPrompt?.kind === 'pick' && v.oppPrompt?.kind !== 'pick' && prev.turn === v.turn && !revealed) sound.play('oppLock');
  if (v.me.combo > prev.me.combo) setTimeout(() => sound.play('comboStep', { n: v.me.combo }), 420);
  if (Object.keys(v.me.cooldowns).some((k) => prev.me.cooldowns[k] > 0 && v.me.cooldowns[k] === 0)) setTimeout(() => sound.play('cooldownReady'), 300);
  if (prev.opp.connected !== v.opp.connected) sound.play(v.opp.connected ? 'oppBack' : 'oppLeft');
  if (prev.me.deckCount >= 10 && v.me.deckCount < 10) sound.play('deckLow');
}

function comboPips(n) {
  const max = S.config?.balance.comboThreshold || 3;
  return `<span class="pips combo">${Array.from({ length: max }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
}

function angryMeter(a) {
  const B = S.config.balance;
  const marks = new Set([B.dodgeCost.normal, B.counterCost, B.angryMax]);
  return `<div class="res" title="คู่ต่อสู้มองไม่เห็นค่า Angry ของคุณ">
    <div class="res-row"><span class="caption muted">Angry</span><b class="num">${a}<span class="muted"> / ${B.angryMax}</span></b></div>
    <div class="angry-pips">${Array.from({ length: B.angryMax }, (_, i) => `<i class="${i < a ? 'on' : ''} ${marks.has(i + 1) ? 'mark' : ''}"></i>`).join('')}</div>
    <div class="angry-legend">Dodge ${B.dodgeCost.normal} · Counter ${B.counterCost}</div>
  </div>`;
}

const ACTION_ICON = { normal: 'ri-sword-fill', charge: 'ri-battery-2-charge-fill', draw: 'ri-stack-fill' };
const skillIcon = (s) => s?.icon || 'ri-magic-fill';

// Skills as icons only; cooling-down ones are dimmed (numbers live on the action cards).
function skillList(cds) {
  return `<div class="skill-icons">${S.config.skills
    .map((s) => {
      const cd = cds[s.id] || 0;
      const tip = `${s.name} · ${cd ? `Cooldown ${cd} Turn` : 'พร้อมใช้'} · ${s.desc}`;
      return `<span class="sk ${cd ? 'cd' : 'ready'}" title="${esc(tip)}" aria-label="${esc(tip)}"><i class="${skillIcon(s)}"></i></span>`;
    })
    .join('')}</div>`;
}

function buffChips(buffs) {
  if (!buffs?.length) return '';
  return `<div class="buffs">${buffs.map((b) => `<span class="buff">${b.stat === 'normalDamagePct' ? 'Normal' : 'Damage'} +${b.value}% · ${b.turnsLeft}T</span>`).join('')}</div>`;
}

function renderPanel(who) {
  const v = S.view;
  const B = S.config.balance;
  const d = v[who];
  const isMe = who === 'me';
  const hpPct = Math.max(0, Math.min(100, (d.hp / B.maxHp) * 100));
  const manaPct = Math.max(0, Math.min(100, (d.mana / B.manaMax) * 100));
  const html = `
    <div class="who">
      <span class="avatar ${who}">${esc((d.name || '?')[0])}</span>
      <div class="who-text"><div class="name">${esc(d.name)}${isMe ? '' : ` <span class="dot ${d.connected ? 'on' : 'off'}"></span>`}</div><div class="caption muted">${isMe ? 'คุณ' : 'คู่ต่อสู้'}</div></div>
    </div>
    <div>
      <div class="hp-num"><span class="num">${d.hp}</span><span class="muted">/ ${B.maxHp} HP</span></div>
      <div class="track hp-track ${hpPct <= 30 ? 'low' : ''}"><div class="fill" style="width:${hpPct}%"></div></div>
    </div>
    <div class="res">
      <div class="res-row"><span class="caption muted">Mana</span><b class="num">${d.mana}<span class="muted"> / ${B.manaMax}</span></b></div>
      <div class="track mana-track"><div class="fill" style="width:${manaPct}%"></div></div>
    </div>
    ${isMe ? angryMeter(d.angry) : '<div class="res-row"><span class="caption muted">Angry</span><b class="hidden-val">???</b></div>'}
    <div class="res-row"><span class="caption muted">Combo</span>${comboPips(d.combo)}</div>
    <div class="res-row"><span class="caption muted">${isMe ? 'สำรับ' : 'มือ · สำรับ'}</span><b class="num">${isMe ? d.deckCount : `${d.handCount} · ${d.deckCount}`}</b></div>
    ${skillList(d.cooldowns)}${buffChips(d.buffs)}`;
  const el = $(isMe ? '#me-panel' : '#opp-panel');
  if (changed(`panel-${who}`, html)) {
    const floats = $$('.float', el);
    el.innerHTML = html;
    el.append(...floats);
  }
}

function cardFace(t, extra = '') {
  const d = TYPES[t];
  return `<div class="card ${d.grad} ${extra}"><span class="card-top"><span class="card-name">${d.th}</span><span class="card-en">${d.en}</span></span><span class="card-icon">${ICON[t]}</span><span class="card-bonus">${d.bonus}</span></div>`;
}

function renderSlots() {
  const v = S.view;
  const r = v.lastReveal && v.lastReveal.turn === v.turn ? v.lastReveal : null;
  let me, opp;
  if (r) {
    const mi = S.you;
    const oi = 1 - S.you;
    const res = r.winner === -1 ? 'draw' : r.winner === mi ? 'win' : 'lose';
    me = cardFace(r.cards[mi], `reveal ${res === 'win' ? 'winner' : res === 'lose' ? 'loser' : ''}`);
    opp = cardFace(r.cards[oi], `reveal ${res === 'lose' ? 'winner' : res === 'win' ? 'loser' : ''}`);
  } else {
    const myLocked = S.myPick && S.myPick.turn === v.turn;
    const picking = v.prompt?.kind === 'pick' && S.answeredId !== v.prompt.id;
    me = myLocked
      ? cardFace(S.myPick.type, 'locked')
      : picking && S.selType
        ? cardFace(S.selType, 'preview')
        : `<div class="card empty"><span>เลือกการ์ด</span></div>`;
    const oppPicking = v.oppPrompt?.kind === 'pick';
    const inPick = v.prompt?.kind === 'pick' || myLocked;
    opp = inPick && !oppPicking ? `<div class="card back locked"><span>ล็อกแล้ว</span></div>` : `<div class="card back thinking"><span>?</span></div>`;
  }
  if (changed('slot-me', me)) $('#slot-me').innerHTML = me;
  if (changed('slot-opp', opp)) $('#slot-opp').innerHTML = opp;
}

function phaseText() {
  const v = S.view;
  const p = v.prompt;
  const op = v.oppPrompt;
  const answered = p && S.answeredId === p.id;
  if (v.over) return [v.result.winner === -1 ? 'เสมอ' : v.result.winner === S.you ? 'คุณชนะ' : 'คุณแพ้', 'จบเกม'];
  if (p && !answered) {
    switch (p.kind) {
      case 'pick':
        return ['เลือกการ์ด', 'ชนะได้เลือก Action · แพ้ได้ Angry +1'];
      case 'action':
        return [p.combo ? 'COMBO! เลือก Action' : 'คุณชนะ! เลือก Action', `ชนะด้วย${TYPES[p.card].th} · ${TYPES[p.card].bonus}`];
      case 'defense':
        return ['ถูกโจมตี!', `${p.incoming.label} · ${p.incoming.damage} Damage`];
      case 'keep':
        return ['เลือกการ์ดเก็บ', `เลือก ${p.keep} จาก ${p.cards.length} ใบ`];
      case 'discard':
        return [`การ์ดเกิน ${S.config.balance.handLimit} ใบ`, `เลือกทิ้ง ${p.count} ใบ`];
      default:
        return ['', ''];
    }
  }
  if (answered && p?.kind === 'pick') return ['ลงการ์ดแล้ว', op?.kind === 'pick' ? 'รอคู่ต่อสู้เลือกการ์ด…' : 'กำลังเปิดการ์ด…'];
  if (op) {
    const t = {
      pick: ['รอคู่ต่อสู้', 'คู่ต่อสู้กำลังเลือกการ์ด…'],
      action: ['คุณแพ้รอบนี้', 'คู่ต่อสู้กำลังเลือก Action…'],
      defense: ['โจมตีแล้ว', 'รอคู่ต่อสู้ตอบสนอง…'],
      keep: ['รอคู่ต่อสู้', 'คู่ต่อสู้กำลังเลือกการ์ดเก็บ…'],
      discard: ['รอคู่ต่อสู้', 'คู่ต่อสู้กำลังทิ้งการ์ด…'],
    }[op.kind];
    if (t) return t;
  }
  const r = v.lastReveal && v.lastReveal.turn === v.turn ? v.lastReveal : null;
  if (r) return r.winner === -1 ? ['เสมอ', 'ทั้งสองฝ่าย +1 Mana'] : r.winner === S.you ? ['คุณชนะ', ''] : ['คุณแพ้', ''];
  return ['', ''];
}

function renderPhase() {
  const [t, s] = phaseText();
  if (changed('phase', t + '|' + s)) {
    $('#phase-title').textContent = t;
    $('#phase-sub').textContent = s;
  }
}

function sortedHand() {
  return [...S.view.me.hand].sort((a, b) => ORDER[a.t] - ORDER[b.t] || a.id.localeCompare(b.id, 'en', { numeric: true }));
}

const TYPE_KEYS = ['rock', 'paper', 'scissors'];

function groupByType(cards) {
  const g = { rock: [], paper: [], scissors: [] };
  for (const c of cards) g[c.t].push(c);
  return g;
}

/** Same-type cards drawn as one pile with a count. */
function stackHtml(t, count, { key = null, selected = false, picked = 0, clickable = false } = {}) {
  const d = TYPES[t];
  const layers = Math.min(Math.max(count, 1), 4) - 1;
  const behind = Array.from({ length: layers }, (_, k) => `<span class="layer ${d.grad}" style="--k:${layers - k}"></span>`).join('');
  const can = clickable && count > 0;
  return `<button class="stack ${count ? '' : 'empty'} ${selected ? 'selected' : ''} ${can ? 'clickable' : ''}" data-type="${t}" ${can ? '' : 'disabled'} aria-label="${d.th} ${count} ใบ">
    ${behind}
    <span class="card ${d.grad}">
      <span class="card-top"><span class="card-name">${d.th}</span><span class="card-en">${d.en}</span></span>
      <span class="card-icon">${ICON[t]}</span>
      <span class="card-bonus">${d.bonus}</span>
    </span>
    <span class="stack-count num">×${count}</span>
    ${key ? `<span class="card-key">${key}</span>` : ''}
    ${picked ? `<span class="stack-picked num">${picked}</span>` : ''}
  </button>`;
}

function answer(ans) {
  const p = S.view?.prompt;
  if (!p || S.answeredId === p.id) return;
  S.answeredId = p.id;
  net.send({ t: 'answer', promptId: p.id, answer: ans });
  if (p.kind === 'pick') {
    const c = S.view.me.hand.find((x) => x.id === ans.cardId);
    if (c) S.myPick = { turn: S.view.turn, type: c.t };
    sound.play('lock');
  }
  updateBattle();
}

function playType(t) {
  const c = S.view?.me.hand.find((x) => x.t === t);
  if (c) answer({ cardId: c.id });
}

// The stage under your panel shows exactly one thing at a time:
// your hand, the action choices, the defense choice, a keep/discard pick, or the result.
function renderStage() {
  const v = S.view;
  const p = v.prompt;
  const live = p && S.answeredId !== p.id ? p : null;
  const hand = v.me.hand;
  const key = JSON.stringify([live?.id, live?.kind, hand.map((c) => c.id), S.selType, S.picks, v.over, v.over ? [v.result, S.rematchVotes] : 0, v.history?.length, v.me.deckCount]);
  renderSlots(); // the selected card previews in your slot
  if (!changed('stage', key)) return;
  const el = $('#stage');
  el.className = 'stage';

  if (v.over) {
    el.classList.add('is-result');
    el.innerHTML = resultHtml();
    const rm = $('#rematch', el);
    if (rm) rm.onclick = () => net.send({ t: 'rematch' });
    $('#to-lobby', el).onclick = goLobby;
    return;
  }
  if (live?.kind === 'action') {
    el.classList.add('is-action');
    el.innerHTML = actionGrid(live);
    $$('.action-tile', el).forEach((b) => (b.onclick = () => !b.disabled && answer({ action: b.dataset.action })));
    return;
  }
  if (live?.kind === 'defense') {
    el.classList.add('is-defense');
    el.innerHTML = defenseHtml(live);
    $$('[data-def]', el).forEach((b) => (b.onclick = () => answer({ defense: b.dataset.def })));
    return;
  }
  if (live && (live.kind === 'keep' || live.kind === 'discard')) {
    renderMultiPick(el, live);
    return;
  }

  const picking = live?.kind === 'pick';
  const g = groupByType(hand);
  const limit = S.config.balance.handLimit;
  el.innerHTML = `
    <div class="stage-head">
      <div>
        <p class="eyebrow">การ์ดในมือ <span class="num">${hand.length}</span>/${limit}</p>
        ${picking ? '<h3 class="stage-title">เลือกการ์ดที่จะลง</h3>' : ''}
      </div>
      <span class="spacer"></span>
      ${
        picking
          ? `<span class="caption muted hide-sm">กด 1 · 2 · 3 แล้ว Enter</span>
             <button class="pill primary" id="confirm-pick" ${S.selType ? '' : 'disabled'}>${S.selType ? `ลง${TYPES[S.selType].th}` : 'ลงการ์ด'}</button>`
          : ''
      }
    </div>
    <div class="stage-body">
      <div class="stacks ${picking ? 'picking' : 'idle'}">
        ${TYPE_KEYS.map((t) => stackHtml(t, g[t].length, { selected: picking && S.selType === t, clickable: picking })).join('')}
      </div>
      ${intelHtml(picking ? S.selType : null)}
    </div>`;
  if (picking) {
    $$('.stack', el).forEach((b) => {
      b.onclick = () => {
        const t = b.dataset.type;
        if (S.selType === t) return playType(t);
        S.selType = t;
        sound.play('select', { type: t });
        renderStage();
      };
      b.ondblclick = () => playType(b.dataset.type);
    });
    $('#confirm-pick', el).onclick = () => S.selType && playType(S.selType);
  }
}

// Desktop-only side info next to your hand: public card history and counts.
function intelHtml(sel) {
  const v = S.view;
  const per = S.config.balance.deck;
  const meIdx = S.you;
  const hist = (v.history || []).slice(-7);
  const chip = (t, res) => `<span class="h-chip ${TYPES[t].grad} ${res}" title="${TYPES[t].th}">${ICON[t]}</span>`;
  // one column per turn: opponent on top, you below; the winning card keeps its color
  const historyHtml = hist.length
    ? hist
        .map((h) => {
          const oppRes = h.winner === -1 ? 'tie' : h.winner === meIdx ? 'lost' : 'won';
          const myRes = h.winner === -1 ? 'tie' : h.winner === meIdx ? 'won' : 'lost';
          return `<li>${chip(h.cards[1 - meIdx], oppRes)}${chip(h.cards[meIdx], myRes)}<span class="h-turn num">${h.turn}</span></li>`;
        })
        .join('')
    : '<li class="h-empty muted caption">ยังไม่มีการลงการ์ด</li>';
  const rows = (counts, totals, label) =>
    TYPE_KEYS.map((t) => {
      const n = counts[t];
      const max = totals[t];
      return `<div class="i-row"><span class="i-name">${TYPES[t].th}</span><span class="i-bar"><i class="${TYPES[t].grad}" style="width:${max ? (n / max) * 100 : 0}%"></i></span><b class="num">${n}<span class="muted">${label}</span></b></div>`;
    }).join('');
  const oppLeft = TYPE_KEYS.reduce((o, t) => ((o[t] = per[t] - (v.opp.played?.[t] || 0)), o), {});
  const mine = v.me.deckByType || { rock: 0, paper: 0, scissors: 0 };
  const beats = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
  const loses = { rock: 'paper', paper: 'scissors', scissors: 'rock' };
  const tip = sel
    ? `<p class="i-tip"><b>${TYPES[sel].th}</b> ชนะ${TYPES[beats[sel]].th} · แพ้${TYPES[loses[sel]].th} · ชนะแล้วได้ ${TYPES[sel].bonus} · คู่ต่อสู้ยังเหลือ${TYPES[loses[sel]].th} ${oppLeft[loses[sel]]} ใบ</p>`
    : '';
  return `<div class="intel">
    <section>
      <h4 class="caption muted">การ์ดที่ลงล่าสุด</h4>
      <div class="history-wrap">
        <div class="h-labels caption muted"><span>คู่ต่อสู้</span><span>คุณ</span><span>Turn</span></div>
        <ol class="history">${historyHtml}</ol>
      </div>
    </section>
    <section>
      <h4 class="caption muted">การ์ดคู่ต่อสู้ที่ยังไม่ได้ลง</h4>
      ${rows(oppLeft, per, ` / ${per.rock}`)}
      <p class="i-note micro muted">อยู่ในมือ สำรับ หรือถูกทิ้งไปแล้ว</p>
    </section>
    <section>
      <h4 class="caption muted">ในสำรับของคุณ</h4>
      ${rows(mine, per, ' ใบ')}
      <p class="i-note micro muted">เหลือ ${v.me.deckCount} ใบ</p>
    </section>
    ${tip}
  </div>`;
}

function renderMultiPick(el, p) {
  const isKeep = p.kind === 'keep';
  const need = isKeep ? p.keep : p.count;
  const pool = isKeep ? p.cards : S.view.me.hand;
  const g = groupByType(pool);
  const types = isKeep ? TYPE_KEYS.filter((t) => g[t].length) : TYPE_KEYS;
  const total = Object.values(S.picks).reduce((a, b) => a + b, 0);
  const title = isKeep ? (p.source === 'paper' ? 'โบนัสกระดาษ' : 'Draw Action') : `การ์ดเกิน ${S.config.balance.handLimit} ใบ`;
  const sub = isKeep ? `เปิดได้ ${pool.length} ใบ เลือกเก็บ ${need} ใบ` : `เลือกทิ้ง ${need} ใบ (คู่ต่อสู้มองไม่เห็น)`;
  el.classList.add('is-pick');
  el.innerHTML = `
    <div class="stage-head">
      <div><p class="eyebrow">${title}</p><h3 class="stage-title">${sub}</h3></div>
      <span class="spacer"></span>
      ${total ? '<button class="pill secondary" id="pick-reset">เลือกใหม่</button>' : ''}
      <button class="pill primary" id="pick-confirm" ${total === need ? '' : 'disabled'}>${isKeep ? 'เก็บ' : 'ทิ้ง'} <span class="num">${total}/${need}</span></button>
    </div>
    <div class="stacks picking">
      ${types.map((t) => stackHtml(t, g[t].length, { clickable: true, picked: S.picks[t] || 0, selected: !!S.picks[t] })).join('')}
    </div>`;
  $$('.stack', el).forEach((b) => {
    b.onclick = () => {
      const t = b.dataset.type;
      const have = S.picks[t] || 0;
      if (need === 1) S.picks = { [t]: 1 };
      else if (have < g[t].length && total < need) S.picks = { ...S.picks, [t]: have + 1 };
      else return;
      sound.play('select', { type: t });
      renderStage();
    };
  });
  const reset = $('#pick-reset', el);
  if (reset) reset.onclick = () => ((S.picks = {}), renderStage());
  $('#pick-confirm', el).onclick = () => {
    if (total !== need) return;
    const ids = TYPE_KEYS.flatMap((t) => g[t].slice(0, S.picks[t] || 0).map((c) => c.id));
    answer({ cardIds: ids });
  };
}

function defendText(o) {
  const B = S.config.balance;
  if (o.id === 'normal') return `ป้องกันได้: Counter (${B.counterCost}) · Dodge (${B.dodgeCost.normal})`;
  if (!o.tier) return '';
  const c = B.dodgeCost[o.tier];
  return c == null ? 'ป้องกันไม่ได้' : `ป้องกันได้: Dodge (${c})`;
}

function actionGrid(p) {
  const tiles = p.options
    .map((o) => {
      let main = '';
      let meta = '';
      let cost = '';
      if (o.id === 'normal') {
        main = `${o.damage} <small>DMG</small>`;
        meta = defendText(o);
        cost = 'ฟรี';
      } else if (o.id === 'charge') {
        main = `+${o.mana} <small>Mana</small>`;
        meta = 'สะสม Mana ไว้ใช้สกิล';
        cost = 'ฟรี';
      } else if (o.id === 'draw') {
        main = `${o.open}<small>→</small>${o.keep} <small>ใบ</small>`;
        meta = `เปิด ${o.open} เก็บ ${o.keep} · +${o.mana} Mana`;
        cost = o.reason || 'ฟรี';
      } else {
        const sk = S.config.skills.find((s) => s.id === o.skill);
        main = o.damage != null ? `${o.damage} <small>DMG</small>` : o.heal != null ? `+${o.heal} <small>HP</small>` : esc(sk?.desc || '');
        meta = o.damage != null ? defendText(o) : esc(sk?.desc || '');
        cost = o.enabled ? `Mana ${o.cost}` : o.reason;
      }
      const tier = o.tier ? `<span class="tier ${o.tier}">${TIER[o.tier]}</span>` : '';
      const icon = o.skill ? skillIcon(S.config.skills.find((s) => s.id === o.skill)) : ACTION_ICON[o.id];
      return `<button class="action-tile" data-action="${o.id}" ${o.enabled ? '' : 'disabled'}>
        <span class="at-top"><span class="at-name"><i class="at-icon ${icon}"></i>${esc(o.label)}</span>${tier}</span>
        <span class="at-main">${main}</span>
        <span class="at-meta">${meta}</span>
        <span class="at-cost ${o.enabled ? '' : 'off'}">${esc(cost)}</span>
      </button>`;
    })
    .join('');
  return `<div class="stage-head">
      <div><p class="eyebrow">${p.combo ? 'Combo · ' : ''}คุณชนะรอบนี้</p><h3 class="stage-title">เลือก Action</h3></div>
      <span class="spacer"></span>
      <span class="badge ${TYPES[p.card].grad}">${TYPES[p.card].th} · ${TYPES[p.card].bonus}</span>
      ${p.combo ? '<span class="badge g-magenta">Combo: Damage +50% · Heal ×2 · Charge +3 · Draw เปิด 4</span>' : ''}
    </div>
    <div class="actions">${tiles}</div>`;
}

function defenseHtml(p) {
  const inc = p.incoming;
  const opts = p.options;
  const hasCounter = opts.some((x) => x.id === 'counter');
  const btn = (o) => {
    if (o.id === 'none') return `<button class="pill ${p.hasChoice ? 'translucent' : 'primary'}" data-def="none">รับดาเมจ</button>`;
    if (o.id === 'counter') return `<button class="pill primary" data-def="counter"><i class="ri-shield-flash-fill"></i>Counter <span class="pill-sub">Angry ${o.cost} · สวน ${o.damage}</span></button>`;
    return `<button class="pill ${hasCounter ? 'translucent' : 'primary'}" data-def="dodge"><i class="ri-run-fill"></i>Dodge <span class="pill-sub">Angry ${o.cost}</span></button>`;
  };
  const order = ['counter', 'dodge', 'none'];
  const note = inc.tier === 'large' ? 'Large Skill ป้องกันไม่ได้' : p.hasChoice ? 'Angry ที่เพิ่งได้ Turn นี้ใช้ได้ Turn หน้า' : 'Angry ไม่พอสำหรับป้องกันการโจมตีนี้';
  return `<div class="defense-card g-coral">
      <div>
        <p class="eyebrow">ถูกโจมตี · ใช้ Angry ได้ ${S.view.me.angryAtStart}</p>
        <h3 class="display-md">${esc(inc.label)} · <span class="num">${inc.damage}</span> Damage</h3>
        <p class="caption">${note}</p>
      </div>
      <div class="row">${[...opts].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)).map(btn).join('')}</div>
    </div>`;
}

// ------------------------------------------------------------ log & events
function who(idx, cap = false) {
  if (idx === S.you) return 'คุณ';
  return esc(S.view?.opp.name || (cap ? 'คู่ต่อสู้' : 'คู่ต่อสู้'));
}

function describe(e) {
  const T = (t) => TYPES[t]?.th || t;
  switch (e.k) {
    case 'start':
      return { t: 'เริ่มเกม', c: 'sys' };
    case 'turn':
      return { t: `Turn ${e.n}`, c: 'turn' };
    case 'reveal': {
      const me = e.cards[S.you];
      const op = e.cards[1 - S.you];
      const res = e.winner === -1 ? 'เสมอ' : e.winner === S.you ? 'คุณชนะ' : 'คุณแพ้';
      return { t: `${T(me)} vs ${T(op)} · ${res}`, c: e.winner === -1 ? '' : e.winner === S.you ? 'good' : 'bad' };
    }
    case 'action':
      if (e.action === 'skill') return { t: `${who(e.p)} ใช้ ${esc(e.name)}${e.combo ? ' (Combo)' : ''}` };
      return { t: `${who(e.p)} ใช้ ${{ normal: 'Normal Attack', charge: 'Charge Mana', draw: 'Draw Action' }[e.action]}${e.combo ? ' (Combo)' : ''}` };
    case 'damage':
      return { t: `${who(e.p)} โดน ${e.amount} Damage`, c: e.p === S.you ? 'bad' : 'good' };
    case 'counter':
      return { t: `${who(e.p)} Counter! สวนกลับ ${e.damage}`, c: e.p === S.you ? 'good' : 'bad' };
    case 'dodge':
      return { t: `${who(e.p)} Dodge ${esc(e.label)}`, c: e.p === S.you ? 'good' : 'bad' };
    case 'heal':
      return { t: `${who(e.p)} ฟื้น ${e.amount} HP` };
    case 'mana':
      return { t: `${who(e.p)} +${e.amount} Mana${e.source === 'draw' ? ' (เสมอ)' : ''}`, c: 'dim' };
    case 'combo':
      return { t: `${who(e.p)} COMBO! ชนะติดกัน 3 ครั้ง`, c: 'combo' };
    case 'bonus':
      return e.card === 'scissors' ? { t: `${who(e.p)} โบนัสกรรไกร +${e.mana} Mana +${e.heal} HP`, c: 'dim' } : { t: `${who(e.p)} โบนัสกระดาษ จั่วเพิ่ม`, c: 'dim' };
    case 'keep':
      return { t: `${who(e.p)} เก็บการ์ด ${e.kept} ใบ`, c: 'dim' };
    case 'discard':
      return { t: `${who(e.p)} ทิ้งการ์ด ${e.count} ใบ (เกิน ${S.config.balance.handLimit})`, c: 'dim' };
    case 'angry':
      return { t: `Angry ของคุณ: ${e.value}`, c: 'dim' };
    case 'buff':
      return { t: `${who(e.p)} ได้บัฟ +${e.value}% ${e.turns} Turn` };
    case 'timeout':
      return { t: 'หมดเวลา ระบบเลือกให้อัตโนมัติ', c: 'bad' };
    case 'end':
      return { t: e.winner === -1 ? 'จบเกม · เสมอ' : e.winner === S.you ? 'จบเกม · คุณชนะ' : 'จบเกม · คุณแพ้', c: 'turn' };
    default:
      return null;
  }
}

function renderLog() {
  const log = S.view.log;
  const last = log.length ? log[log.length - 1].seq : 0;
  if (!changed('log', last)) return;
  const items = log
    .map((e) => {
      const d = describe(e);
      return d ? `<li class="${d.c || ''}">${d.t}</li>` : '';
    })
    .join('');
  const list = $('#log-list');
  list.innerHTML = items;
  list.scrollTop = list.scrollHeight;
}

function onEvent(e) {
  if (S.screen !== 'battle') return;
  const r = rel(e.p);
  switch (e.k) {
    case 'turn':
      S.answeredId = null;
      sound.play('draw');
      break;
    case 'reveal': {
      const w = e.winner === -1 ? null : rel(e.winner);
      scene.fx('reveal', { winner: w });
      sound.play('reveal');
      setTimeout(() => sound.play(w === null ? 'tie' : w === 'me' ? 'win' : 'lose'), 260);
      break;
    }
    case 'action':
      S.lastCard = e.card;
      if (e.action === 'skill' && e.tier === 'medium') sound.play('heavyCharge');
      if (e.action === 'skill' && e.tier === 'large') sound.play('ultCharge');
      if (e.action === 'draw') sound.play('shuffle');
      break;
    case 'damage': {
      let played = false;
      const hitSound = () => {
        if (played) return;
        played = true;
        const o = { power: e.amount, rock: S.lastCard === 'rock', mine: e.p === S.you };
        sound.play(e.kind === 'normal' ? 'hit' : { small: 'quick', medium: 'heavy', large: 'ultimate' }[e.tier] || 'hit', o);
      };
      setTimeout(hitSound, 700); // fallback when the 3D scene is not running
      scene.fx('attack', {
        from: rel(e.from),
        to: r,
        power: e.amount,
        big: e.tier === 'large' || e.amount >= 20,
        onHit: () => {
          hitSound();
          floatText(r, `-${e.amount}`, 'dmg');
        },
      });
      break;
    }
    case 'counter':
      sound.play('counter');
      scene.fx('counter', { who: r });
      callout('COUNTER!', 'g-orange');
      setTimeout(() => floatText(r === 'me' ? 'opp' : 'me', `-${e.damage}`, 'dmg'), 600);
      break;
    case 'dodge':
      sound.play('dodge');
      scene.fx('dodge', { who: r });
      callout('DODGE', 'g-violet');
      floatText(r, 'Dodge', 'info');
      break;
    case 'heal':
      if (e.amount > 0) {
        sound.play('heal');
        scene.fx('heal', { who: r });
        floatText(r, `+${e.amount} HP`, 'heal');
      }
      break;
    case 'mana':
      if (e.amount > 0) {
        if (e.source !== 'draw' || e.p === S.you) sound.play('mana');
        scene.fx('mana', { who: r });
        floatText(r, `+${e.amount} Mana`, 'mana');
      }
      break;
    case 'bonus':
      if (e.card === 'scissors') {
        if (e.mana) floatText(r, `+${e.mana} Mana`, 'mana');
        if (e.heal) floatText(r, `+${e.heal} HP`, 'heal');
        scene.fx('mana', { who: r });
        sound.play('sparkle');
      }
      break;
    case 'combo':
      sound.play('combo');
      scene.fx('combo', { who: r });
      callout('COMBO', 'g-magenta');
      break;
    case 'angry': {
      // server sends Angry events only to their owner
      const before = S.lastAngry ?? 0;
      S.lastAngry = e.value;
      if (e.value > before) {
        sound.play('angry');
        const B = S.config.balance;
        const tiers = [B.dodgeCost.normal, B.counterCost, B.angryMax];
        const tier = tiers.findIndex((x) => before < x && e.value >= x);
        if (tier >= 0) setTimeout(() => sound.play('angryTier', { tier: tier + 1 }), 250);
      }
      break;
    }
    case 'discard':
      if (e.p === S.you) sound.play('discard');
      break;
    case 'timeout':
      sound.play('timeout');
      toast('หมดเวลา ระบบเลือกให้อัตโนมัติ', 'warn');
      break;
    case 'end': {
      sound.heartbeat(false);
      if (e.reason === 'ko') {
        const loser = e.hp[0] <= 0 && e.hp[1] <= 0 ? null : e.hp[S.you] <= 0 ? 'me' : 'opp';
        if (loser) setTimeout(() => scene.fx('ko', { who: loser }), 500);
      }
      const res = e.winner === -1 ? 'tieEnd' : e.winner === S.you ? 'victory' : 'defeat';
      setTimeout(() => sound.play(res), e.reason === 'ko' ? 1100 : 300);
      setTimeout(() => S.view?.over && sound.music('lobby'), 4500);
      break;
    }
    default:
      break;
  }
}

// ------------------------------------------------------------ result
function resultHtml() {
  const v = S.view;
  const r = v.result;
  const win = r.winner === S.you;
  const draw = r.winner === -1;
  const grad = draw ? 'g-orange' : win ? 'g-violet' : 'g-coral';
  const reason = {
    ko: 'HP หมด',
    cards: 'มีฝ่ายลงการ์ดใบสุดท้าย ตัดสินด้วย HP',
    forfeit: win ? 'คู่ต่อสู้ออกจากเกม' : 'คุณออกจากเกม',
    abandoned: 'ห้องถูกปิด',
  }[r.reason];
  const me = v.me.stats;
  const op = v.opp.stats || {};
  const row = (label, a, b) => `<tr><td>${label}</td><td class="num">${a ?? '–'}</td><td class="num">${b ?? '–'}</td></tr>`;
  const voted = S.rematchVotes.includes(S.you);
  const oppVoted = S.rematchVotes.includes(1 - S.you);
  const canRematch = r.reason !== 'forfeit' && r.reason !== 'abandoned';
  return `<div class="result-card ${grad}">
    <div class="result-main">
      <p class="eyebrow">${reason} · ${r.turns} Turn</p>
      <h2 class="display-xl">${draw ? 'Draw' : win ? 'Victory' : 'Defeat'}</h2>
      <p class="subhead">${draw ? 'เสมอ' : win ? 'คุณชนะ' : 'คุณแพ้'}</p>
      <div class="row">
        ${canRematch ? `<button class="pill primary" id="rematch" ${voted ? 'disabled' : ''}>${voted ? 'รอคู่ต่อสู้…' : 'เล่นอีกครั้ง'}</button>` : ''}
        <button class="pill translucent" id="to-lobby">กลับหน้าแรก</button>
      </div>
      <p class="caption">${oppVoted && !voted ? 'คู่ต่อสู้อยากเล่นอีกครั้ง' : ''}</p>
    </div>
    <table class="result-stats">
      <thead><tr><th></th><th>คุณ</th><th>${esc(v.opp.name)}</th></tr></thead>
      <tbody>
        ${row('HP ที่เหลือ', v.me.hp, v.opp.hp)}
        ${row('ดาเมจที่ทำ', me.damageDealt, op.damageDealt)}
        ${row('ชนะ RPS', me.wins, op.wins)}
        ${row('Combo', me.combos, op.combos)}
        ${row('Counter', me.counters, op.counters)}
        ${row('Dodge', me.dodges, op.dodges)}
      </tbody>
    </table>
  </div>`;
}

// ------------------------------------------------------------ timer + keyboard
function tick() {
  const el = $('#timer');
  if (el) {
    const rem = S.deadline ? Math.max(0, S.deadline - performance.now()) : 0;
    const frac = S.deadline ? rem / S.deadlineTotal : 0;
    const bar = $('#timer-bar');
    const C = 2 * Math.PI * 28;
    bar.style.strokeDasharray = `${C}`;
    bar.style.strokeDashoffset = `${C * (1 - frac)}`;
    $('#timer-num').textContent = S.deadline ? Math.ceil(rem / 1000) : '–';
    el.classList.toggle('urgent', !!S.deadline && rem < 5000);
    const mine = !!S.view?.prompt && S.answeredId !== S.view.prompt.id;
    el.classList.toggle('mine', mine);
    const sec = Math.ceil(rem / 1000);
    if (mine && S.deadline && rem > 0 && sec <= 5 && sec !== S.lastTickSec) sound.play('tick', { urgent: sec <= 2 });
    S.lastTickSec = sec;
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

document.addEventListener('keydown', (e) => {
  if (S.screen !== 'battle' || !S.view?.prompt || e.target.tagName === 'INPUT') return;
  const p = S.view.prompt;
  if (S.answeredId === p.id || p.kind !== 'pick') return;
  const t = TYPE_KEYS[Number(e.key) - 1];
  if (t && S.view.me.hand.some((c) => c.t === t)) {
    S.selType = t;
    renderStage();
    sound.play('select', { type: t });
  } else if (e.key === 'Enter' && S.selType) playType(S.selType);
});

// ------------------------------------------------------------ boot
document.body.dataset.screen = 'lobby';
const existing = session.get();
const urlCode = (location.pathname.match(/^\/room\/([A-Za-z0-9]{4})/) || [])[1];
if (existing && (!urlCode || urlCode.toUpperCase() === existing.code)) {
  S.code = existing.code;
  app.innerHTML = '<main class="waiting"><p class="eyebrow">กำลังกลับเข้าห้อง…</p></main>';
  setTimeout(() => {
    if (S.screen === 'lobby' && !S.view && S.code === existing.code && !$('.lobby')) show('lobby');
  }, 4000);
} else {
  session.clear();
  show('lobby');
}
