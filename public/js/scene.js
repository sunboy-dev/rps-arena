// Three.js background: a dark arena with two glowing "cores" (you and the opponent)
// and short effects for combat events. Purely decorative; the game UI is 2D on top.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const COLORS = {
  me: new THREE.Color('#7b5cff'),
  opp: new THREE.Color('#ff7a1a'),
  heal: new THREE.Color('#2fd06e'),
  mana: new THREE.Color('#9b7bff'),
  combo: new THREE.Color('#ff3d9a'),
  counter: new THREE.Color('#ffb15c'),
  white: new THREE.Color('#ffffff'),
  hit: new THREE.Color('#ff4d6d'),
};

export function createScene(canvas) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setClearColor('#0a0a0a');
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2('#0a0a0a', 0.045);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 10);

  scene.add(new THREE.AmbientLight('#ffffff', 0.25));

  // --- arena ring and floor grid
  const arena = new THREE.Group();
  scene.add(arena);
  const ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.08 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.012, 8, 160), ringMat);
  arena.add(ring);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(4.4, 0.006, 8, 200), ringMat.clone());
  ring2.material.opacity = 0.05;
  arena.add(ring2);
  const grid = new THREE.GridHelper(40, 40, '#262626', '#161616');
  grid.position.y = -4;
  grid.material.transparent = true;
  grid.material.opacity = 0.55;
  scene.add(grid);

  // --- dust particles
  const DUST = reduced ? 300 : 900;
  const dustGeo = new THREE.BufferGeometry();
  const dp = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST; i++) {
    dp[i * 3] = (Math.random() - 0.5) * 30;
    dp[i * 3 + 1] = (Math.random() - 0.5) * 18;
    dp[i * 3 + 2] = (Math.random() - 0.5) * 16 - 3;
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: '#ffffff', size: 0.025, transparent: true, opacity: 0.5, depthWrite: false }));
  scene.add(dust);

  // --- player cores
  function makeCore(color) {
    const g = new THREE.Group();
    const inner = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.55, 3),
      new THREE.MeshStandardMaterial({ color: '#111111', emissive: color, emissiveIntensity: 1.6, roughness: 0.4, metalness: 0.1 }),
    );
    const shell = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.95, 1),
      new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.35 }),
    );
    const halo = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.01, 6, 90), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4 }));
    halo.rotation.x = Math.PI / 2.4;
    const light = new THREE.PointLight(color, 6, 7, 2);
    g.add(inner, shell, halo, light);
    g.userData = { inner, shell, halo, light, base: new THREE.Vector3(), hp: 1, shake: 0, flash: 0, dash: 0, dead: false, color: color.clone() };
    scene.add(g);
    return g;
  }
  const cores = { me: makeCore(COLORS.me), opp: makeCore(COLORS.opp) };

  // --- post processing
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.6, 0.12);
  composer.addPass(bloom);

  // Optional screen anchors (px): during a battle the cores sit behind the card slots.
  let anchors = null;
  function layout() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const halfH = Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;
    const halfW = halfH * camera.aspect;
    if (anchors) {
      const upp = (2 * halfH) / h; // world units per CSS pixel at z = 0
      for (const k of ['me', 'opp']) {
        const a = anchors[k];
        cores[k].userData.base.set(((a.x / w) * 2 - 1) * halfW, (-(a.y / h) * 2 + 1) * halfH, 0);
        cores[k].scale.setScalar(Math.max(0.35, (1.25 * a.size * upp) / 1.9));
      }
      return;
    }
    // default: cores in the left/right margins, opponent high, you low
    const narrow = camera.aspect < 0.9;
    const x = narrow ? halfW * 0.62 : Math.min(halfW * 0.78, 7);
    cores.opp.userData.base.set(x, narrow ? halfH * 0.55 : halfH * 0.45, 0);
    cores.me.userData.base.set(-x, narrow ? -halfH * 0.55 : -halfH * 0.42, 0);
    const s = narrow ? 0.7 : 1;
    cores.opp.scale.setScalar(s);
    cores.me.scale.setScalar(s);
  }
  window.addEventListener('resize', layout);
  layout();

  // --- transient effects
  const effects = [];

  function burst(pos, color, count = 60, speed = 3, life = 0.9, size = 0.06) {
    const geo = new THREE.BufferGeometry();
    const p = new Float32Array(count * 3);
    const v = [];
    for (let i = 0; i < count; i++) {
      p.set([pos.x, pos.y, pos.z], i * 3);
      const dir = new THREE.Vector3().randomDirection().multiplyScalar(speed * (0.4 + Math.random()));
      v.push(dir);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const mat = new THREE.PointsMaterial({ color, size, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(geo, mat);
    scene.add(pts);
    let t = 0;
    effects.push((dt) => {
      t += dt;
      const arr = geo.attributes.position.array;
      for (let i = 0; i < count; i++) {
        arr[i * 3] += v[i].x * dt;
        arr[i * 3 + 1] += v[i].y * dt;
        arr[i * 3 + 2] += v[i].z * dt;
        v[i].multiplyScalar(0.94);
      }
      geo.attributes.position.needsUpdate = true;
      mat.opacity = Math.max(0, 1 - t / life);
      if (t >= life) {
        scene.remove(pts);
        geo.dispose();
        mat.dispose();
        return false;
      }
      return true;
    });
  }

  function rise(core, color, count = 40, life = 1.2) {
    const pos = core.position;
    const geo = new THREE.BufferGeometry();
    const p = new Float32Array(count * 3);
    const off = [];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.6 + Math.random() * 0.7;
      off.push({ a, r, y: -0.8 + Math.random() * 0.4, s: 0.8 + Math.random() * 1.2 });
      p.set([pos.x, pos.y, pos.z], i * 3);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const mat = new THREE.PointsMaterial({ color, size: 0.07, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(geo, mat);
    scene.add(pts);
    let t = 0;
    effects.push((dt) => {
      t += dt;
      const arr = geo.attributes.position.array;
      for (let i = 0; i < count; i++) {
        const o = off[i];
        const ang = o.a + t * 2.2;
        arr[i * 3] = core.position.x + Math.cos(ang) * o.r * core.scale.x;
        arr[i * 3 + 1] = core.position.y + (o.y + t * o.s) * core.scale.x;
        arr[i * 3 + 2] = core.position.z + Math.sin(ang) * o.r * core.scale.x;
      }
      geo.attributes.position.needsUpdate = true;
      mat.opacity = Math.max(0, 1 - t / life);
      if (t >= life) {
        scene.remove(pts);
        geo.dispose();
        mat.dispose();
        return false;
      }
      return true;
    });
  }

  function shockRing(pos, color, maxR = 2.2, life = 0.7, scale = 1) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64), mat);
    mesh.position.copy(pos);
    scene.add(mesh);
    let t = 0;
    effects.push((dt) => {
      t += dt;
      const k = t / life;
      mesh.scale.setScalar((0.4 + k * maxR) * scale);
      mat.opacity = Math.max(0, 0.9 * (1 - k));
      if (t >= life) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        mat.dispose();
        return false;
      }
      return true;
    });
  }

  function projectile(from, to, color, power = 10, onHit) {
    const size = 0.12 + Math.min(power, 46) / 120;
    const mat = new THREE.MeshBasicMaterial({ color });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(size, 16, 16), mat);
    const light = new THREE.PointLight(color, 8, 5, 2);
    ball.add(light);
    scene.add(ball);
    const a = from.position.clone();
    const b = to.position.clone();
    const mid = a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, 0, 2.5));
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const trail = [];
    let t = 0;
    const dur = 0.42;
    effects.push((dt) => {
      t += dt;
      const k = Math.min(1, t / dur);
      const e = k * k * (3 - 2 * k);
      ball.position.copy(curve.getPoint(e));
      if (Math.random() < 0.9) {
        const tm = new THREE.Mesh(new THREE.SphereGeometry(size * 0.6, 8, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
        tm.position.copy(ball.position);
        scene.add(tm);
        trail.push({ m: tm, life: 0.25 });
      }
      for (const tr of trail) {
        tr.life -= dt;
        tr.m.material.opacity = Math.max(0, tr.life * 2.4);
        tr.m.scale.multiplyScalar(0.92);
      }
      while (trail.length && trail[0].life <= 0) {
        const tr = trail.shift();
        scene.remove(tr.m);
        tr.m.geometry.dispose();
        tr.m.material.dispose();
      }
      if (k >= 1) {
        scene.remove(ball);
        ball.geometry.dispose();
        mat.dispose();
        for (const tr of trail) {
          scene.remove(tr.m);
          tr.m.geometry.dispose();
          tr.m.material.dispose();
        }
        onHit?.();
        return false;
      }
      return true;
    });
  }

  // --- public effect API
  function fx(type, o = {}) {
    const self = cores[o.who] || cores.me;
    switch (type) {
      case 'attack': {
        const from = cores[o.from];
        const to = cores[o.to];
        const color = o.from === 'me' ? COLORS.me : COLORS.opp;
        projectile(from, to, color, o.power, () => {
          to.userData.shake = Math.min(1, 0.35 + o.power / 40);
          to.userData.flash = 1;
          burst(to.position, COLORS.hit, 40 + o.power * 3, 3 + o.power / 8);
          if (o.big) shockRing(to.position, COLORS.white, 3, 0.8, to.scale.x);
          o.onHit?.();
        });
        break;
      }
      case 'counter': {
        const def = cores[o.who];
        const att = cores[o.who === 'me' ? 'opp' : 'me'];
        shockRing(def.position, COLORS.counter, 1.8, 0.5, def.scale.x);
        setTimeout(() => {
          projectile(def, att, COLORS.counter, 12, () => {
            att.userData.shake = 0.7;
            att.userData.flash = 1;
            burst(att.position, COLORS.counter, 70, 4);
          });
        }, 160);
        break;
      }
      case 'dodge':
        self.userData.dash = 1;
        shockRing(self.position, COLORS.white, 1.4, 0.45, self.scale.x);
        break;
      case 'heal':
        rise(self, COLORS.heal, 50);
        break;
      case 'mana':
        rise(self, COLORS.mana, 26, 0.9);
        break;
      case 'combo':
        shockRing(self.position, COLORS.combo, 2.6, 0.8, self.scale.x);
        setTimeout(() => shockRing(self.position, COLORS.combo, 3.4, 0.9, self.scale.x), 140);
        burst(self.position, COLORS.combo, 80, 3);
        break;
      case 'reveal': {
        ringMat.opacity = 0.35;
        const c = o.winner === 'me' ? COLORS.me : o.winner === 'opp' ? COLORS.opp : COLORS.white;
        shockRing(new THREE.Vector3(0, 0, 0), c, 3.2, 0.8);
        break;
      }
      case 'ko': {
        const c = cores[o.who];
        c.userData.dead = true;
        burst(c.position, c.userData.color, 260, 6, 1.6, 0.08);
        shockRing(c.position, COLORS.white, 4, 1.2, c.scale.x);
        break;
      }
      case 'reset':
        for (const c of Object.values(cores)) {
          c.userData.dead = false;
          c.visible = true;
          c.userData.hp = 1;
        }
        break;
      default:
        break;
    }
  }

  function setAnchors(a) {
    anchors = a;
    layout();
  }

  function setHp(me, opp) {
    cores.me.userData.hp = me;
    cores.opp.userData.hp = opp;
  }

  function setActive(who) {
    for (const [k, c] of Object.entries(cores)) c.userData.active = k === who;
  }

  // --- loop
  const clock = new THREE.Clock();
  let running = true;
  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running) {
      clock.getDelta();
      requestAnimationFrame(loop);
    }
  });

  function updateCore(c, t, dt) {
    const u = c.userData;
    const targetScale = u.dead ? 0.001 : 1;
    const hpScale = 0.75 + 0.25 * u.hp;
    u.inner.scale.lerp(new THREE.Vector3(1, 1, 1).multiplyScalar(targetScale * hpScale), Math.min(1, dt * 6));
    u.shell.scale.lerp(new THREE.Vector3(1, 1, 1).multiplyScalar(u.dead ? 0.001 : 1), Math.min(1, dt * 6));
    u.shell.rotation.x += dt * 0.35;
    u.shell.rotation.y += dt * 0.5;
    u.halo.rotation.z += dt * (u.active ? 1.6 : 0.4);
    u.halo.material.opacity = u.dead ? 0 : u.active ? 0.85 : 0.3;
    const pulse = 1 + Math.sin(t * 2.2) * 0.06;
    u.inner.material.emissiveIntensity = (1.1 + 0.9 * u.hp) * pulse + u.flash * 3;
    u.inner.material.emissive.copy(u.color).lerp(COLORS.white, u.flash * 0.7);
    u.light.intensity = u.dead ? 0 : 4 + 4 * u.hp + u.flash * 10;
    u.flash = Math.max(0, u.flash - dt * 3);
    const sh = u.shake;
    u.shake = Math.max(0, u.shake - dt * 2.2);
    const dash = u.dash;
    u.dash = Math.max(0, u.dash - dt * 2.5);
    const dashOff = Math.sin((1 - dash) * Math.PI) * (dash > 0 ? 1.1 : 0) * (c === cores.me ? 1 : -1);
    c.position.set(
      u.base.x + (Math.random() - 0.5) * sh * 0.5 + dashOff,
      u.base.y + Math.sin(t * 1.3 + (c === cores.me ? 0 : 2)) * 0.12 + (Math.random() - 0.5) * sh * 0.5,
      u.base.z,
    );
  }

  function loop() {
    if (!running) return;
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.elapsedTime;
    arena.rotation.z += dt * 0.05;
    arena.rotation.x = Math.sin(t * 0.2) * 0.15;
    ringMat.opacity += (0.08 - ringMat.opacity) * Math.min(1, dt * 2);
    dust.rotation.y += dt * 0.01;
    grid.position.z = (t * 0.4) % 1;
    camera.position.x = Math.sin(t * 0.15) * 0.35;
    camera.position.y = Math.cos(t * 0.11) * 0.2;
    camera.lookAt(0, 0, 0);
    updateCore(cores.me, t, dt);
    updateCore(cores.opp, t, dt);
    for (let i = effects.length - 1; i >= 0; i--) if (!effects[i](dt)) effects.splice(i, 1);
    composer.render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  return { fx, setHp, setActive, setAnchors };
}
