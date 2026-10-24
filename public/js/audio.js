// Synthesized sound for RPS Arena (Web Audio, no audio files).
// Every effect is a small recipe of oscillators + filtered noise, so any of them
// can later be swapped for a recorded file without touching the game code.

const KEY = 'rps-audio';
const DEFAULTS = { muted: false, music: 0.45, sfx: 0.85, ui: 0.5 };

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

const NOTE = (n) => 440 * 2 ** ((n - 69) / 12); // MIDI note -> Hz
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function createAudio() {
  const st = loadSettings();
  let ctx = null;
  let master;
  let duckGain;
  let noiseBuf;
  const bus = {};
  let wantMusic = null;
  let musicMode = null;
  let intensity = 0;
  let sched = null;
  let heartTimer = null;
  let lastHover = 0;

  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(st));
    } catch {}
  };

  // ---------------------------------------------------------------- setup
  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    master = ctx.createGain();
    master.gain.value = st.muted ? 0 : 0.9;
    master.connect(comp).connect(ctx.destination);
    for (const b of ['music', 'sfx', 'ui']) {
      bus[b] = ctx.createGain();
      bus[b].gain.value = st[b];
      bus[b].connect(master);
    }
    duckGain = ctx.createGain();
    duckGain.connect(bus.music);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    if (wantMusic) music(wantMusic);
    return true;
  }

  /** Browsers only allow audio after a user gesture. */
  function unlock() {
    ensure();
  }

  const now = () => ctx.currentTime;

  function envelope(g, t, { attack = 0.004, hold = 0, decay = 0.2, gain = 0.3 }) {
    g.gain.value = 0; // silent until the envelope starts (avoids a click on delayed voices)
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    if (hold) g.gain.setValueAtTime(gain, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + decay);
    return t + attack + hold + decay;
  }

  function out(o) {
    return o.out || (o.bus === 'music' ? duckGain : bus[o.bus || 'sfx']);
  }

  /** Oscillator voice. o: { t | at, type, to, slide, detune, filter, cutoff, cutoffTo, q, attack, hold, decay, gain, bus } */
  function tone(freq, o = {}) {
    if (!ctx) return;
    const t = o.t ?? now() + (o.at || 0);
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + (o.slide ?? (o.decay || 0.2)));
    if (o.detune) osc.detune.value = o.detune;
    let node = osc;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = o.filter;
      f.frequency.value = o.cutoff || 2000;
      f.frequency.setValueAtTime(o.cutoff || 2000, t);
      if (o.cutoffTo) f.frequency.exponentialRampToValueAtTime(o.cutoffTo, t + (o.attack || 0) + (o.hold || 0) + (o.decay || 0.2));
      f.Q.value = o.q ?? 0.7;
      osc.connect(f);
      node = f;
    }
    const g = ctx.createGain();
    node.connect(g).connect(out(o));
    const end = envelope(g, t, o);
    osc.start(t);
    osc.stop(end + 0.05);
  }

  /** Filtered noise voice. o: { t | at, filter, freq, to, slide, q, attack, hold, decay, gain, bus } */
  function noise(o = {}) {
    if (!ctx) return;
    const t = o.t ?? now() + (o.at || 0);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.filter || 'bandpass';
    f.frequency.value = o.freq || 1000;
    f.frequency.setValueAtTime(o.freq || 1000, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + (o.slide ?? (o.attack || 0) + (o.decay || 0.2)));
    f.Q.value = o.q ?? 0.8;
    const g = ctx.createGain();
    src.connect(f).connect(g).connect(out(o));
    const end = envelope(g, t, o);
    src.start(t, Math.random());
    src.stop(end + 0.05);
  }

  const chord = (notes, o) => notes.forEach((f, i) => tone(f, { ...o, detune: (i % 2 ? 4 : -4) + (o.detune || 0) }));

  function duck(depth = 0.3, dur = 1.2) {
    if (!ctx) return;
    const t = now();
    duckGain.gain.cancelScheduledValues(t);
    duckGain.gain.setTargetAtTime(depth, t, 0.03);
    duckGain.gain.setTargetAtTime(1, t + dur, 0.4);
  }

  // ---------------------------------------------------------------- effects
  const SFX = {
    // UI
    hover: () => tone(2400, { decay: 0.03, gain: 0.03, bus: 'ui' }),
    click: () => {
      tone(1300, { type: 'triangle', to: 900, decay: 0.05, gain: 0.1, bus: 'ui' });
      noise({ filter: 'highpass', freq: 4000, decay: 0.02, gain: 0.04, bus: 'ui' });
    },
    confirm: () => {
      tone(660, { type: 'triangle', decay: 0.08, gain: 0.12, bus: 'ui' });
      tone(990, { type: 'triangle', at: 0.06, decay: 0.14, gain: 0.12, bus: 'ui' });
    },
    copy: () => {
      tone(1200, { decay: 0.05, gain: 0.08, bus: 'ui' });
      tone(1600, { at: 0.05, decay: 0.08, gain: 0.08, bus: 'ui' });
    },

    // cards
    draw: () => noise({ filter: 'bandpass', freq: 2600, to: 900, decay: 0.13, gain: 0.14, q: 0.9 }),
    select: ({ type } = {}) => {
      const f = { rock: 196, paper: 330, scissors: 523 }[type] || 330;
      tone(f * 2, { type: 'triangle', decay: 0.06, gain: 0.1, bus: 'ui' });
      tone(f, { decay: 0.09, gain: 0.14, bus: 'ui' });
    },
    lock: () => {
      noise({ filter: 'lowpass', freq: 1400, decay: 0.08, gain: 0.22 });
      tone(120, { to: 70, decay: 0.12, gain: 0.3 });
    },
    oppLock: () => tone(880, { decay: 0.06, gain: 0.09, bus: 'ui' }),
    reveal: () => {
      noise({ filter: 'bandpass', freq: 500, to: 4500, attack: 0.07, decay: 0.22, gain: 0.16, q: 1.2 });
      noise({ filter: 'highpass', freq: 3000, at: 0.08, decay: 0.03, gain: 0.12 });
      noise({ filter: 'highpass', freq: 3500, at: 0.11, decay: 0.03, gain: 0.1 });
    },
    win: () => {
      tone(NOTE(72), { type: 'triangle', decay: 0.14, gain: 0.16 });
      tone(NOTE(76), { type: 'triangle', at: 0.07, decay: 0.14, gain: 0.16 });
      tone(NOTE(79), { type: 'triangle', at: 0.14, decay: 0.32, gain: 0.16 });
    },
    lose: () => {
      tone(NOTE(64), { type: 'triangle', to: NOTE(57), decay: 0.35, gain: 0.15 });
      tone(NOTE(43), { at: 0.08, decay: 0.4, gain: 0.12 });
    },
    tie: () => {
      tone(NOTE(69), { decay: 0.16, gain: 0.1 });
      tone(NOTE(69), { at: 0.12, decay: 0.2, gain: 0.07 });
    },

    // actions
    hit: ({ power = 8, rock = false, mine = false } = {}) => {
      const p = clamp(power / 30, 0.25, 1.3);
      tone(150, { to: 45, decay: 0.16 + 0.2 * p, gain: 0.3 + 0.25 * p });
      noise({ filter: 'lowpass', freq: 2200, to: 220, decay: 0.12 + 0.12 * p, gain: 0.2 + 0.18 * p });
      if (rock) {
        noise({ filter: 'bandpass', freq: 320, q: 2.5, decay: 0.22, gain: 0.3 });
        tone(85, { type: 'square', filter: 'lowpass', cutoff: 320, decay: 0.2, gain: 0.12 });
      }
      if (mine) tone(55, { decay: 0.32, gain: 0.25 });
    },
    quick: (o = {}) => {
      noise({ filter: 'highpass', freq: 1800, to: 7000, attack: 0.01, decay: 0.1, gain: 0.2 });
      SFX.hit({ ...o, power: (o.power || 10) * 0.7 });
    },
    heavyCharge: () => noise({ filter: 'bandpass', freq: 180, to: 1400, attack: 0.35, decay: 0.08, gain: 0.12, q: 1.5 }),
    heavy: (o = {}) => {
      tone(110, { to: 38, decay: 0.55, gain: 0.5 });
      noise({ filter: 'lowpass', freq: 2600, to: 120, decay: 0.45, gain: 0.4 });
      if (o.rock) noise({ filter: 'bandpass', freq: 300, q: 2.5, decay: 0.3, gain: 0.3 });
      if (o.mine) tone(50, { decay: 0.45, gain: 0.25 });
    },
    ultCharge: () => {
      tone(70, { type: 'sawtooth', to: 280, slide: 1.6, filter: 'lowpass', cutoff: 180, cutoffTo: 2600, attack: 1.5, decay: 0.15, gain: 0.12 });
      tone(71, { type: 'sawtooth', to: 283, slide: 1.6, filter: 'lowpass', cutoff: 180, cutoffTo: 2600, attack: 1.5, decay: 0.15, gain: 0.1, detune: 9 });
      noise({ filter: 'bandpass', freq: 300, to: 6000, attack: 1.5, decay: 0.1, gain: 0.1, q: 1.4 });
      duck(0.45, 1.8);
    },
    ultimate: (o = {}) => {
      tone(95, { to: 28, decay: 1.3, gain: 0.6 });
      tone(48, { decay: 1.6, gain: 0.35 });
      noise({ filter: 'lowpass', freq: 4000, to: 90, decay: 1.1, gain: 0.5 });
      noise({ filter: 'highpass', freq: 5000, decay: 0.25, gain: 0.15 });
      if (o.mine) tone(42, { at: 0.05, decay: 0.8, gain: 0.25 });
      duck(0.25, 1.8);
    },
    heal: () => {
      [79, 83, 86, 91].forEach((n, i) => tone(NOTE(n), { at: i * 0.06, decay: 0.45, gain: 0.07 }));
      noise({ filter: 'highpass', freq: 6000, attack: 0.05, decay: 0.5, gain: 0.03 });
    },
    mana: () => {
      tone(440, { to: 880, slide: 0.2, decay: 0.25, gain: 0.08 });
      tone(660, { at: 0.05, to: 1320, slide: 0.2, decay: 0.25, gain: 0.05 });
    },
    sparkle: () => {
      tone(NOTE(96), { decay: 0.14, gain: 0.04 });
      tone(NOTE(100), { at: 0.05, decay: 0.18, gain: 0.035 });
    },
    shuffle: () => [0, 0.06, 0.12].forEach((at) => noise({ filter: 'bandpass', freq: 2200, at, decay: 0.05, gain: 0.09, q: 1.5 })),
    open: ({ n = 3 } = {}) => {
      for (let k = 0; k < n; k++) noise({ filter: 'bandpass', freq: 3200, at: k * 0.08, decay: 0.04, gain: 0.08, q: 2 });
    },

    // combo
    comboStep: ({ n = 1 } = {}) => {
      const f = NOTE(76 + (n - 1) * 3);
      tone(f, { type: 'triangle', decay: 0.13, gain: 0.11 });
      tone(f * 2, { at: 0.03, decay: 0.1, gain: 0.04 });
    },
    combo: () => {
      chord([NOTE(72), NOTE(76), NOTE(79), NOTE(84)], { type: 'triangle', attack: 0.01, decay: 0.9, gain: 0.07 });
      noise({ filter: 'bandpass', freq: 400, to: 7000, attack: 0.25, decay: 0.2, gain: 0.1 });
      duck(0.4, 1.2);
    },

    // defense
    alarm: ({ strong = true } = {}) => {
      const o = { type: 'square', filter: 'lowpass', cutoff: 2200, decay: 0.08, gain: strong ? 0.07 : 0.04 };
      tone(880, o);
      tone(880, { ...o, at: 0.13 });
      if (strong) tone(1175, { ...o, at: 0.26, decay: 0.14 });
    },
    counter: () => {
      noise({ filter: 'bandpass', freq: 3600, q: 9, decay: 0.38, gain: 1.4 });
      noise({ filter: 'highpass', freq: 5000, decay: 0.08, gain: 0.25 });
      tone(1850, { type: 'square', filter: 'bandpass', cutoff: 2600, q: 6, decay: 0.3, gain: 0.14 });
      tone(2470, { type: 'square', filter: 'bandpass', cutoff: 3000, q: 6, decay: 0.25, gain: 0.11 });
      setTimeout(() => SFX.hit({ power: 12 }), 520);
      duck(0.5, 0.9);
    },
    dodge: () => noise({ filter: 'bandpass', freq: 450, to: 3200, attack: 0.05, decay: 0.24, gain: 0.55, q: 1.6 }),

    // own status (never played for the opponent's hidden values)
    angry: () => tone(92, { type: 'sawtooth', to: 70, filter: 'lowpass', cutoff: 420, decay: 0.3, gain: 0.14 }),
    angryTier: ({ tier = 1 } = {}) => {
      const f = [NOTE(64), NOTE(69), NOTE(74)][tier - 1] || NOTE(64);
      tone(f, { type: 'triangle', decay: 0.18, gain: 0.11 });
      tone(f * 1.5, { type: 'triangle', at: 0.08, decay: 0.25, gain: 0.09 });
    },
    cooldownReady: () => tone(NOTE(91), { decay: 0.14, gain: 0.08, bus: 'ui' }),
    discard: () => {
      noise({ filter: 'highpass', freq: 1500, decay: 0.16, gain: 0.025 });
      noise({ filter: 'highpass', freq: 2200, at: 0.07, decay: 0.12, gain: 0.018 });
    },

    // time & system
    tick: ({ urgent = false } = {}) => tone(urgent ? 1250 : 950, { type: 'square', filter: 'lowpass', cutoff: 3000, decay: 0.03, gain: urgent ? 0.14 : 0.1, bus: 'ui' }),
    timeout: () => tone(220, { type: 'sawtooth', filter: 'lowpass', cutoff: 900, decay: 0.35, gain: 0.1 }),
    oppLeft: () => tone(440, { to: 220, decay: 0.4, gain: 0.09 }),
    oppBack: () => tone(220, { to: 440, decay: 0.3, gain: 0.09 }),
    deckLow: () => {
      tone(NOTE(76), { type: 'triangle', decay: 0.14, gain: 0.09 });
      tone(NOTE(76), { type: 'triangle', at: 0.2, decay: 0.2, gain: 0.09 });
    },
    joined: () => [72, 79, 84].forEach((n, i) => tone(NOTE(n), { type: 'triangle', at: i * 0.1, decay: 0.3, gain: 0.13 })),
    start: () => {
      chord([NOTE(48), NOTE(55), NOTE(60), NOTE(64)], { type: 'sawtooth', filter: 'lowpass', cutoff: 600, cutoffTo: 2400, attack: 0.06, decay: 1.3, gain: 0.045 });
      tone(110, { to: 45, decay: 0.5, gain: 0.3 });
    },
    victory: () => {
      [72, 76, 79, 84, 88].forEach((n, i) => tone(NOTE(n), { type: 'triangle', at: i * 0.09, decay: 0.3, gain: 0.12 }));
      chord([NOTE(60), NOTE(64), NOTE(67), NOTE(72)], { type: 'sawtooth', filter: 'lowpass', cutoff: 1800, at: 0.45, attack: 0.05, hold: 0.6, decay: 1.4, gain: 0.04 });
      noise({ filter: 'highpass', freq: 6000, at: 0.45, decay: 1.2, gain: 0.03 });
      duck(0.15, 3);
    },
    defeat: () => {
      [67, 65, 63, 60].forEach((n, i) => tone(NOTE(n), { type: 'triangle', at: i * 0.22, decay: 0.45, gain: 0.11 }));
      chord([NOTE(36), NOTE(43), NOTE(48)], { type: 'sawtooth', filter: 'lowpass', cutoff: 500, at: 0.85, attack: 0.2, decay: 1.8, gain: 0.05 });
      duck(0.15, 3);
    },
    tieEnd: () => {
      chord([NOTE(62), NOTE(67), NOTE(69)], { type: 'triangle', decay: 0.8, gain: 0.07 });
      chord([NOTE(62), NOTE(67), NOTE(69)], { type: 'triangle', at: 0.5, decay: 1, gain: 0.05 });
      duck(0.2, 2.5);
    },
    rematchAsk: () => {
      tone(NOTE(83), { decay: 0.1, gain: 0.08, bus: 'ui' });
      tone(NOTE(88), { at: 0.1, decay: 0.16, gain: 0.08, bus: 'ui' });
    },
  };

  function play(name, opts) {
    if (!ctx || st.muted) return;
    if (name === 'hover') {
      const n = performance.now();
      if (n - lastHover < 60) return;
      lastHover = n;
    }
    try {
      SFX[name]?.(opts);
    } catch (e) {
      console.warn('sound failed', name, e);
    }
  }

  // ---------------------------------------------------------------- music
  // Generative: a slow pad for the lobby, a pulse + pad (+ arpeggio when tense) for battle.
  const LOBBY_CHORDS = [
    [45, 57, 60, 64],
    [41, 53, 57, 60],
    [48, 55, 60, 64],
    [43, 55, 59, 62],
  ];
  const BATTLE_CHORDS = [
    [45, 57, 60, 64],
    [41, 53, 57, 60],
    [43, 55, 59, 62],
    [40, 52, 55, 59],
  ];

  function pad(notes, t, dur, gain = 0.022, cutoff = 900) {
    for (const n of notes.slice(1)) {
      for (const det of [-7, 7]) {
        tone(NOTE(n), { t, type: 'sawtooth', detune: det, filter: 'lowpass', cutoff, q: 0.4, attack: dur * 0.35, hold: dur * 0.3, decay: dur * 0.6, gain, bus: 'music' });
      }
    }
    tone(NOTE(notes[0] - 12), { t, type: 'sine', attack: 0.4, hold: dur * 0.5, decay: dur * 0.5, gain: 0.05, bus: 'music' });
  }

  function music(mode) {
    wantMusic = mode;
    if (!ctx) return;
    if (mode === musicMode) return;
    musicMode = mode;
    clearInterval(sched);
    sched = null;
    if (!mode) return;
    let next = now() + 0.1;
    let step = 0;
    if (mode === 'lobby') {
      const bar = 5;
      sched = setInterval(() => {
        while (next < now() + 0.3) {
          pad(LOBBY_CHORDS[step % 4], next, bar + 1.5, 0.018, 700);
          next += bar;
          step++;
        }
      }, 100);
    } else {
      const spb = 60 / 100; // 100 BPM
      const s16 = spb / 4;
      sched = setInterval(() => {
        while (next < now() + 0.25) {
          const t = next;
          const beat = step % 16;
          const barN = Math.floor(step / 16);
          const ch = BATTLE_CHORDS[Math.floor(barN / 2) % 4];
          if (beat === 0 && barN % 2 === 0) pad(ch, t, spb * 8, 0.014, 800 + intensity * 900);
          if (beat % 4 === 0) tone(110, { t, to: 42, decay: 0.22, gain: 0.16 + intensity * 0.06, bus: 'music' });
          if (beat % 4 === 2) noise({ t, filter: 'highpass', freq: 7000, decay: 0.035, gain: 0.03 + intensity * 0.02, bus: 'music' });
          if (beat === 0 || beat === 10) tone(NOTE(ch[0] - 12), { t, type: 'sawtooth', filter: 'lowpass', cutoff: 380, decay: spb * 1.4, gain: 0.07, bus: 'music' });
          if (intensity && beat % 2 === 0) {
            const arp = [ch[1], ch[2], ch[3], ch[2] + 12];
            tone(NOTE(arp[(beat / 2) % 4] + 12), { t, type: 'triangle', decay: s16 * 1.8, gain: 0.03, bus: 'music' });
          }
          if (intensity && beat === 12) tone(110, { t, to: 42, decay: 0.18, gain: 0.12, bus: 'music' });
          next += s16;
          step++;
        }
      }, 50);
    }
  }

  function setIntensity(v) {
    intensity = v ? 1 : 0;
  }

  function heartbeat(on) {
    if (on && !heartTimer) {
      const beat = () => {
        if (!ctx || st.muted) return;
        tone(62, { decay: 0.12, gain: 0.22 });
        tone(58, { at: 0.2, decay: 0.16, gain: 0.16 });
      };
      beat();
      heartTimer = setInterval(beat, 950);
    } else if (!on && heartTimer) {
      clearInterval(heartTimer);
      heartTimer = null;
    }
  }

  // ---------------------------------------------------------------- settings
  function set(key, value) {
    st[key] = value;
    save();
    if (!ctx) return;
    if (key === 'muted') master.gain.setTargetAtTime(value ? 0 : 0.9, now(), 0.05);
    else if (bus[key]) bus[key].gain.setTargetAtTime(value, now(), 0.05);
  }

  return { unlock, play, music, setIntensity, heartbeat, duck, set, settings: st, get ready() {
    return !!ctx;
  } };
}
