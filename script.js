(() => {
'use strict';

/* =====================================================================
   KNIFE THROWER
   - Modo Local: 1 a 4 jogadores na mesma tela
   - Modo Online: salas com código (PeerJS / WebRTC). O anfitrião roda o
     jogo e envia o estado; cada aparelho desenha no seu próprio formato
     de tela (celular em pé, deitado, tablet ou computador).
   ===================================================================== */

// ---------- constantes de jogo ----------
const R = 258;                       // raio do núcleo
const N_CARROTS = 12, STEP = Math.PI * 2 / N_CARROTS;
const FLIGHT = 0.10;                 // tempo da faca no ar (s)
const HIT = 0.14;                    // tolerância angular para cortar (rad)
const STUN = 0.9;                    // tempo sem faca depois de errar (s)
const RESPAWN = 2.6;                 // tempo para a cenoura nascer de novo (s)
const ROUND = 30;                    // duração da partida (s)
const COUNTDOWN = 3;
const LAG_MAX = 0.5;                 // compensação máxima de atraso (rad)
const PREFIX = 'knifethrower-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TAU = Math.PI * 2;

const FONT_H = '"Orbitron", "Segoe UI", system-ui, sans-serif';
const FONT_B = '"Rajdhani", "Segoe UI", system-ui, sans-serif';

const SLOTS = [
  { name: 'Azul',     color: '#3d8bff', rgb: '61,139,255' },
  { name: 'Verde',    color: '#3dff8a', rgb: '61,255,138' },
  { name: 'Amarelo',  color: '#ffc21a', rgb: '255,194,26' },
  { name: 'Vermelho', color: '#ff4d6a', rgb: '255,77,106' },
];
// Controles: cada jogador toca na sua área da tela (zona), usa uma tecla ou um botão do controle (gamepad)
const KEYS = ['a', 'l', 'v', 'arrowup'];
const KEY_LABELS = ['A', 'L', 'V', '↑'];
const PW = 330, PH = 170;            // tamanho do painel de cada jogador (unidades lógicas)
const COARSE = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const rand = (a, b) => a + Math.random() * (b - a);
function angDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

// ---------- simulação (modo local e anfitrião) ----------
class Sim {
  constructor(active, phase) {
    this.active = [false, false, false, false];
    active.forEach(s => { this.active[s] = true; });
    this.phase = phase || 'countdown';   // idle | countdown | playing | over
    this.countdown = COUNTDOWN;
    this.timeLeft = ROUND;
    this.theta = 0; this.omega = 0;
    this.dir = 1; this.dirS = 1; this.dirTimer = rand(4, 7);
    this.clock = 0;
    this.scores = [0, 0, 0, 0];
    this.stun = [0, 0, 0, 0];
    this.alive = Array(N_CARROTS).fill(true);
    this.respawn = Array(N_CARROTS).fill(0);
    this.knives = [];
  }

  step(dt, emit) {
    this.clock += dt;
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) { this.countdown = 0; this.phase = 'playing'; }
    } else if (this.phase === 'playing') {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) { this.timeLeft = 0; this.phase = 'over'; this.knives = []; }
    }

    const prog = this.phase === 'idle' ? 0 : 1 - this.timeLeft / ROUND;
    this.dirTimer -= dt;
    if (this.dirTimer <= 0) { this.dir *= -1; this.dirTimer = rand(4, 8); }
    this.dirS += (this.dir - this.dirS) * Math.min(1, dt * 2.2);
    const base = this.phase === 'idle' ? 0.5 : 0.9 + 0.9 * prog;
    this.omega = this.dirS * base * (1 + 0.4 * Math.sin(this.clock * 0.9));
    this.theta += this.omega * dt;

    for (let i = 0; i < 4; i++) this.stun[i] = Math.max(0, this.stun[i] - dt);
    for (let i = 0; i < N_CARROTS; i++) {
      if (!this.alive[i]) {
        this.respawn[i] -= dt;
        if (this.respawn[i] <= 0) this.alive[i] = true;
      }
    }

    if (this.phase === 'playing') {
      for (let k = this.knives.length - 1; k >= 0; k--) {
        const kn = this.knives[k];
        kn.t += dt;
        if (kn.t >= FLIGHT) {
          this.knives.splice(k, 1);
          this.resolve(kn, emit);
        }
      }
    }
  }

  resolve(kn, emit) {
    // Jogador remoto: usa o ângulo que ele via na tela (compensa a latência)
    const th = kn.land != null ? kn.land : this.theta;
    let best = -1, bd = HIT;
    for (let i = 0; i < N_CARROTS; i++) {
      if (!this.alive[i]) continue;
      const d = Math.abs(angDiff(i * STEP + th, -Math.PI / 2));
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0) {
      this.alive[best] = false;
      this.respawn[best] = RESPAWN;
      this.scores[kn.p]++;
      emit({ e: 'slice', p: kn.p, i: best });
    } else {
      this.stun[kn.p] = STUN;
      emit({ e: 'miss', p: kn.p });
    }
  }

  throwKnife(p, emit, seenTheta) {
    if (this.phase !== 'playing' || !this.active[p] || this.stun[p] > 0) return;
    if (this.knives.some(k => k.p === p)) return;
    const kn = { p, t: 0, land: null };
    if (typeof seenTheta === 'number' && isFinite(seenTheta)) {
      const d = Math.max(-LAG_MAX, Math.min(LAG_MAX, angDiff(seenTheta, this.theta)));
      kn.land = this.theta + d + this.omega * FLIGHT;
    }
    this.knives.push(kn);
    emit({ e: 'throw', p });
  }
}

// ---------- visão remota (jogador convidado) ----------
class RemoteView {
  constructor(active) {
    this.active = [false, false, false, false];
    active.forEach(s => { this.active[s] = true; });
    this.phase = 'countdown';
    this.countdown = COUNTDOWN;
    this.timeLeft = ROUND;
    this.theta = 0; this.omega = 0;
    this.scores = [0, 0, 0, 0];
    this.stun = [0, 0, 0, 0];
    this.alive = Array(N_CARROTS).fill(true);
    this.knives = [];
    this.pred = null;                    // faca prevista localmente
  }
  apply(s) {
    this.theta = s.th; this.omega = s.om; this.phase = s.ph;
    this.countdown = s.cd; this.timeLeft = s.tl;
    this.scores = s.sc; this.stun = s.st;
    for (let i = 0; i < N_CARROTS; i++) this.alive[i] = !!((s.al >> i) & 1);
    this.knives = s.kn.map(([p, t]) => ({ p, t }));
  }
  step(dt) {
    if (this.phase === 'countdown') this.countdown = Math.max(0, this.countdown - dt);
    else if (this.phase === 'playing') this.timeLeft = Math.max(0, this.timeLeft - dt);
    this.theta += this.omega * dt;
    for (let i = 0; i < 4; i++) this.stun[i] = Math.max(0, this.stun[i] - dt);
    this.knives.forEach(k => { k.t += dt; });
    if (this.pred) { this.pred.t += dt; if (this.pred.t > 0.8) this.pred = null; }
  }
}

// ---------- estado do app ----------
const app = {
  mode: 'menu',            // menu | local | host | guest
  view: null,
  sim: null,
  emit: () => {},
  inGame: false,
  overShown: false,
  localCount: 2,
  localActive: [0, 1],
  mySlot: -1,
  names: SLOTS.map(s => s.name),
};
const net = { peer: null, conns: new Map(), hostConn: null, code: '', lobby: [null, null, null, null], leaving: false, rtt: 0, pingTimer: 0 };

app.idle = new Sim([], 'idle');
app.view = app.idle;

// ---------- som ----------
const sfx = (() => {
  let ac = null, muted = false;
  try { muted = localStorage.getItem('kt-muted') === '1'; } catch (e) {}
  function ensure() {
    if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    if (ac && ac.state === 'suspended') ac.resume();
    return ac;
  }
  function tone(f, d, type, vol, slide) {
    if (muted) return;
    const a = ensure(); if (!a) return;
    const o = a.createOscillator(), g = a.createGain(), t = a.currentTime;
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, f + slide), t + d);
    g.gain.setValueAtTime(vol || 0.1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + d);
    o.connect(g); g.connect(a.destination);
    o.start(t); o.stop(t + d + 0.03);
  }
  return {
    unlock: ensure,
    isMuted: () => muted,
    toggle() { muted = !muted; try { localStorage.setItem('kt-muted', muted ? '1' : '0'); } catch (e) {} return muted; },
    throw: () => tone(520, 0.08, 'triangle', 0.07, -320),
    slice() { tone(700, 0.1, 'square', 0.07, 500); setTimeout(() => tone(1050, 0.12, 'square', 0.05), 60); },
    miss: () => tone(160, 0.22, 'sawtooth', 0.08, -90),
    beep: () => tone(660, 0.12, 'square', 0.05),
    go: () => tone(990, 0.3, 'square', 0.07),
    win() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'square', 0.06), i * 120)); },
  };
})();

// ---------- layout responsivo ----------
// O jogo usa um espaço lógico com lado menor = 1080. Em pé: largura 1080.
// Deitado: altura 1080. Tudo é posicionado a partir desse espaço.
const stage = $('#stage');
const cv = $('#cv');
const ctx = cv.getContext('2d');
const bgCv = document.createElement('canvas');
const L = { W: 1080, H: 2340, cx: 540, cy: 1170, s: 1, c: 1, u: 0.4, k: 1, land: false, it: 0, ir: 0, ib: 0, il: 0, kTop: 40, btn: 120 };

const probe = document.createElement('div');
probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
  'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
document.body.appendChild(probe);

const ICON_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="f" d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9c1.5 1.5 1.5 4.5 0 6M18.5 6.5c3 3 3 8 0 11"/></svg>';
const ICON_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="f" d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9.5l4 5M21 9.5l-4 5"/></svg>';
function updateMuteIcon() { $('#btn-mute').innerHTML = sfx.isMuted() ? ICON_OFF : ICON_ON; }

let fx = true; // brilhos (desligados automaticamente em aparelhos lentos)

function layout() {
  const vw = stage.clientWidth || window.innerWidth;
  const vh = stage.clientHeight || window.innerHeight;
  const land = vw >= vh;
  L.land = land;
  if (land) { L.H = 1080; L.W = 1080 * vw / vh; } else { L.W = 1080; L.H = 1080 * vh / vw; }
  L.u = vw / L.W;

  const cs = getComputedStyle(probe);
  L.it = (parseFloat(cs.paddingTop) || 0) / L.u;
  L.ir = (parseFloat(cs.paddingRight) || 0) / L.u;
  L.ib = (parseFloat(cs.paddingBottom) || 0) / L.u;
  L.il = (parseFloat(cs.paddingLeft) || 0) / L.u;

  // escala dos painéis: o texto nunca fica menor que ~12px, em qualquer tela
  const base = land ? 0.8 : 1;
  const c = L.c = Math.min(1.3, Math.max(base, 12 / (38 * L.u)));
  // botões de som e sair (embaixo, no centro): no mínimo 44px para o dedo
  L.btn = Math.max(44, 84 * c * L.u) / L.u;

  // núcleo + faca: o maior tamanho que cabe sem encostar nos painéis
  L.cx = L.W / 2;
  const top = L.it + 30;
  const bot = L.H - L.ib - (L.btn + 26);
  const rects = [0, 1, 2, 3].map(sl => {
    const left = sl % 2 === 0, tp = sl < 2;
    const x0 = left ? L.il : L.W - L.ir - PW * c, y0 = tp ? L.it : L.H - L.ib - PH * c;
    return [x0, y0, x0 + PW * c, y0 + PH * c];
  });
  const place = sc => {
    const slack = Math.max(0, (bot - top) - (1182 * sc + 25));
    const kTop = top + slack / 2;
    return { kTop, cy: kTop + 730 * sc + 25 };
  };
  const clear = (cy, sc) => rects.every(r => {
    const dx = Math.max(r[0] - L.cx, 0, L.cx - r[2]), dy = Math.max(r[1] - cy, 0, cy - r[3]);
    return Math.hypot(dx, dy) >= 452 * sc + 12;
  });
  let sc = Math.max(0.3, Math.min(1, (bot - top - 25) / 1182));
  while (sc > 0.3 && !clear(place(sc).cy, sc)) sc -= 0.02;
  const pl = place(sc);
  L.s = sc; L.kTop = pl.kTop; L.cy = pl.cy;

  // resolução do canvas (limita pixels para não pesar em aparelhos fracos)
  let k = Math.min(window.devicePixelRatio || 1, 2);
  if (vw * vh * k * k > 2.6e6) k = Math.sqrt(2.6e6 / (vw * vh));
  k = Math.max(0.75, k);
  cv.width = Math.round(vw * k);
  cv.height = Math.round(vh * k);
  L.k = cv.width / L.W;

  buildBg();
  positionDom(vw, vh);
}

function positionDom(vw, vh) {
  const u = L.u, c = L.c;
  stage.style.setProperty('--ui', Math.min(vw / 1080, vh / 1400) + 'px');

  // espaço livre das telas (evita os painéis dos cantos)
  const pt = L.land ? L.it * u + 14 : (L.it + PH * c + 12) * u;
  const pb = L.land ? L.ib * u + 14 : (L.ib + PH * c + 12) * u;
  const pl = L.land ? (L.il + PW * c + 14) * u : Math.max(vw * 0.05, L.il * u + 8);
  const pr = L.land ? (L.ir + PW * c + 14) * u : Math.max(vw * 0.05, L.ir * u + 8);
  stage.style.setProperty('--pt', pt + 'px');
  stage.style.setProperty('--pb', pb + 'px');
  stage.style.setProperty('--pl', pl + 'px');
  stage.style.setProperty('--pr', pr + 'px');

  // sair e som: lado a lado, embaixo no centro
  const bs = L.btn * u, by = (L.H - L.ib - 13 - L.btn / 2) * u - bs / 2;
  const ex = $('#btn-exit'), mu = $('#btn-mute');
  [ex, mu].forEach(b => { b.style.width = b.style.height = bs + 'px'; b.style.top = by + 'px'; });
  ex.style.left = (L.cx - L.btn * 0.62) * u - bs / 2 + 'px';
  mu.style.left = (L.cx + L.btn * 0.62) * u - bs / 2 + 'px';
}

function buildBg() {
  bgCv.width = cv.width; bgCv.height = cv.height;
  const b = bgCv.getContext('2d');
  b.setTransform(L.k, 0, 0, L.k, 0, 0);
  const g = b.createRadialGradient(L.cx, L.cy, 40, L.cx, L.cy, Math.max(L.W, L.H) * 0.75);
  g.addColorStop(0, '#112651');
  g.addColorStop(0.45, '#0a1534');
  g.addColorStop(1, '#04070f');
  b.fillStyle = g; b.fillRect(0, 0, L.W, L.H);

  // grade (passa pelo centro do núcleo)
  b.lineWidth = 2;
  const n0x = -Math.ceil(L.cx / 60), n1x = Math.ceil((L.W - L.cx) / 60);
  for (let i = n0x; i <= n1x; i++) {
    const x = L.cx + i * 60;
    b.strokeStyle = i % 5 === 0 ? 'rgba(34,230,255,.11)' : 'rgba(34,230,255,.045)';
    b.beginPath(); b.moveTo(x, 0); b.lineTo(x, L.H); b.stroke();
  }
  const n0y = -Math.ceil(L.cy / 60), n1y = Math.ceil((L.H - L.cy) / 60);
  for (let i = n0y; i <= n1y; i++) {
    const y = L.cy + i * 60;
    b.strokeStyle = i % 5 === 0 ? 'rgba(34,230,255,.11)' : 'rgba(34,230,255,.045)';
    b.beginPath(); b.moveTo(0, y); b.lineTo(L.W, y); b.stroke();
  }

  // brilho de cada canto com a cor do jogador
  SLOTS.forEach((sl, s) => {
    const x = s % 2 === 0 ? 0 : L.W, y = s < 2 ? 0 : L.H;
    const rg = b.createRadialGradient(x, y, 0, x, y, 620 * L.c);
    rg.addColorStop(0, 'rgba(' + sl.rgb + ',.20)');
    rg.addColorStop(1, 'rgba(' + sl.rgb + ',0)');
    b.fillStyle = rg; b.fillRect(0, 0, L.W, L.H);
  });
}

let resizeTimer = 0;
function onResize() {
  layout();
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(layout, 150);   // alguns aparelhos atualizam o tamanho com atraso ao girar
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);
if ('ResizeObserver' in window) new ResizeObserver(() => layout()).observe(stage);
stage.addEventListener('contextmenu', e => e.preventDefault());

// ---------- brilho (glow) ----------
function glow(color, blur) { if (fx) { ctx.shadowColor = color; ctx.shadowBlur = blur * L.k; } }
function noGlow() { ctx.shadowBlur = 0; }
function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------- efeitos visuais ----------
const particles = [];
const floats = [];
const carrotScale = Array(N_CARROTS).fill(1);
const scorePop = [0, 0, 0, 0];
const lastScore = [0, 0, 0, 0];
let shake = 0;
let lastKnifeColor = SLOTS[1].color;
const ripples = [];
const zoneFlash = [0, 0, 0, 0];

function onEvent(ev) {
  const sc = Math.max(0.6, L.s);
  if (app.mode === 'guest' && ev.p === app.mySlot && ev.e !== 'throw' && app.view instanceof RemoteView) app.view.pred = null;

  if (ev.e === 'throw') {
    lastKnifeColor = SLOTS[ev.p].color;
    zoneFlash[ev.p] = 1;
    if (!(app.mode === 'guest' && ev.p === app.mySlot)) sfx.throw();
  } else if (ev.e === 'slice') {
    sfx.slice();
    shake = 12;
    const x = L.cx, y = L.cy - (R + 40) * L.s;
    for (let k = 0; k < 18; k++) {
      const leaf = k % 3 === 0;
      particles.push({
        kind: leaf ? 'leaf' : 'chunk', x: x + rand(-30, 30) * sc, y: y + rand(-20, 20) * sc,
        vx: rand(-420, 420) * sc, vy: rand(-620, -120) * sc, rot: rand(0, TAU), vr: rand(-9, 9),
        life: 1, size: rand(14, 28) * sc, color: leaf ? '#2cf08a' : '#ff8a1f',
      });
    }
    floats.push({ x: L.cx, y: y - 70 * sc, text: '+1', color: SLOTS[ev.p].color, life: 1 });
  } else if (ev.e === 'miss') {
    sfx.miss();
    shake = 6;
    const y = L.cy - R * L.s;
    for (let k = 0; k < 12; k++) {
      particles.push({
        kind: 'spark', x: L.cx + rand(-30, 30) * sc, y: y + rand(-10, 10) * sc,
        vx: rand(-300, 300) * sc, vy: rand(-380, -80) * sc, rot: 0, vr: 0,
        life: 0.8, size: rand(7, 14) * sc, color: '#22e6ff',
      });
    }
    floats.push({ x: L.cx, y: y - 70 * sc, text: 'ERRO', color: '#ff4d6a', life: 1 });
  }
}

// ---------- desenho ----------
function drawBg() {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(bgCv, 0, 0);
  ctx.restore();
}

function drawRings(now) {
  ctx.save();
  ctx.translate(L.cx, L.cy); ctx.scale(L.s, L.s);
  ctx.lineWidth = 3;
  ctx.save(); ctx.rotate(now / 7000); ctx.setLineDash([34, 24]);
  ctx.strokeStyle = 'rgba(34,230,255,.24)';
  ctx.beginPath(); ctx.arc(0, 0, 412, 0, TAU); ctx.stroke(); ctx.restore();
  ctx.save(); ctx.rotate(-now / 4500); ctx.setLineDash([6, 18]);
  ctx.strokeStyle = 'rgba(34,230,255,.16)';
  ctx.beginPath(); ctx.arc(0, 0, 452, 0, TAU); ctx.stroke(); ctx.restore();
  ctx.save(); ctx.rotate(now / 3200); ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(255,138,31,.55)';
  for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(0, 0, 432, k * TAU / 3, k * TAU / 3 + 0.5); ctx.stroke(); }
  ctx.restore();
  ctx.restore();
}

function drawCarrot() {
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  // halo de energia
  ctx.fillStyle = 'rgba(255,138,31,.15)';
  ctx.beginPath(); ctx.arc(0, -30, 78, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#02060f'; ctx.lineWidth = 8;
  const leaf = (ang, len, w, col) => {
    ctx.save();
    ctx.translate(0, -60); ctx.rotate(ang);
    ctx.beginPath(); ctx.ellipse(0, -len / 2, w, len / 2, 0, 0, TAU);
    ctx.fillStyle = col; ctx.fill(); ctx.stroke();
    ctx.restore();
  };
  leaf(-0.85, 58, 16, '#16c46b');
  leaf(0.85, 58, 16, '#16c46b');
  leaf(-0.4, 66, 18, '#25e082');
  leaf(0.4, 66, 18, '#25e082');
  leaf(0, 72, 19, '#5dffa6');
  ctx.beginPath();
  ctx.moveTo(-34, -60);
  ctx.quadraticCurveTo(0, -76, 34, -60);
  ctx.lineTo(24, 40); ctx.lineTo(-24, 40);
  ctx.closePath();
  const g = ctx.createLinearGradient(-34, 0, 34, 0);
  g.addColorStop(0, '#ff7a10'); g.addColorStop(0.5, '#ffa23d'); g.addColorStop(1, '#ff7a10');
  ctx.fillStyle = g; ctx.fill(); ctx.stroke();
  ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(2,6,15,.75)';
  ctx.beginPath(); ctx.moveTo(-22, -24); ctx.lineTo(-4, -24); ctx.moveTo(-17, 4); ctx.lineTo(0, 4);
  ctx.stroke();
}

function drawCarrots(v, dt) {
  for (let i = 0; i < N_CARROTS; i++) {
    if (v.alive[i]) carrotScale[i] += (1 - carrotScale[i]) * Math.min(1, dt * 7);
    else carrotScale[i] = 0;
    const sc = carrotScale[i];
    if (sc < 0.02) continue;
    ctx.save();
    ctx.translate(L.cx, L.cy);
    ctx.scale(L.s, L.s);
    ctx.rotate(i * STEP + v.theta + Math.PI / 2);
    ctx.translate(0, -(R + 10));
    ctx.scale(sc, sc);
    drawCarrot();
    ctx.restore();
  }
}

function arcSeg(r, a0, a1) { ctx.beginPath(); ctx.arc(0, 0, r, a0, a1); ctx.stroke(); }

function drawCore(v, now) {
  ctx.save();
  ctx.translate(L.cx, L.cy); ctx.scale(L.s, L.s); ctx.rotate(v.theta);
  const g = ctx.createRadialGradient(0, 0, 20, 0, 0, R);
  g.addColorStop(0, '#15295c'); g.addColorStop(1, '#07112b');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();

  glow('#22e6ff', 26);
  ctx.strokeStyle = '#22e6ff'; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.arc(0, 0, R - 4, 0, TAU); ctx.stroke();
  noGlow();
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(34,230,255,.35)';
  ctx.beginPath(); ctx.arc(0, 0, R - 26, 0, TAU); ctx.stroke();

  // marcas do aro (mostram o giro)
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(34,230,255,.55)';
  ctx.beginPath();
  for (let k = 0; k < 72; k++) {
    const a = k * TAU / 72, long = k % 6 === 0, r1 = R - 30, r2 = R - (long ? 64 : 46);
    ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
    ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
  }
  ctx.stroke();

  // segmentos de circuito
  ctx.lineCap = 'butt';
  ctx.lineWidth = 16; ctx.strokeStyle = 'rgba(255,138,31,.75)';
  arcSeg(176, 0.3, 1.5); arcSeg(176, 3.4, 4.3);
  ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(34,230,255,.5)';
  arcSeg(134, 2.1, 3.1); arcSeg(134, 5.0, 6.0);
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(34,230,255,.3)';
  arcSeg(205, 0, TAU);
  ctx.fillStyle = 'rgba(34,230,255,.8)';
  [0.9, 2.5, 3.9, 5.4].forEach(a => { ctx.beginPath(); ctx.arc(Math.cos(a) * 205, Math.sin(a) * 205, 8, 0, TAU); ctx.fill(); });

  // marcador que aponta para fora
  ctx.fillStyle = '#ff8a1f';
  ctx.beginPath(); ctx.moveTo(R - 34, 0); ctx.lineTo(R - 74, -15); ctx.lineTo(R - 74, 15); ctx.closePath(); ctx.fill();
  ctx.restore();

  // centro fixo com cronômetro
  ctx.save();
  ctx.translate(L.cx, L.cy); ctx.scale(L.s, L.s);
  ctx.fillStyle = '#050b1d';
  ctx.beginPath(); ctx.arc(0, 0, 98, 0, TAU); ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(34,230,255,.5)';
  ctx.beginPath(); ctx.arc(0, 0, 98, 0, TAU); ctx.stroke();

  if (app.inGame) {
    if (v.phase === 'playing') {
      const frac = v.timeLeft / ROUND;
      const col = frac > 0.33 ? '#22e6ff' : frac > 0.17 ? '#ff8a1f' : '#ff4d6a';
      glow(col, 18);
      ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.strokeStyle = col;
      ctx.beginPath(); ctx.arc(0, 0, 112, -Math.PI / 2, -Math.PI / 2 + TAU * frac); ctx.stroke();
      noGlow();
      const s = Math.ceil(v.timeLeft);
      const pulse = s <= 10 ? 1 + 0.07 * Math.sin(now / 90) : 1;
      txt(String(s), 0, 4, 92, '#eaf6ff', pulse, true);
    } else if (v.phase === 'countdown') {
      const n = Math.ceil(v.countdown);
      const frac = v.countdown - Math.floor(v.countdown);
      txt(String(n), 0, 4, 150, '#ffa23d', 0.8 + 0.4 * (1 - frac), true);
    } else if (v.phase === 'over') {
      txt('FIM', 0, 4, 70, '#ff8a1f', 1, true);
    }
  } else {
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(34,230,255,.3)';
    ctx.beginPath(); ctx.arc(0, 0, 60, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-26, 0); ctx.lineTo(26, 0); ctx.moveTo(0, -26); ctx.lineTo(0, 26); ctx.stroke();
  }
  ctx.restore();
}

function txt(text, x, y, size, fill, scale, glowIt) {
  ctx.save();
  ctx.translate(x, y); ctx.scale(scale, scale);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '900 ' + size + 'px ' + FONT_H;
  ctx.lineJoin = 'round'; ctx.lineWidth = size * 0.1; ctx.strokeStyle = '#02060f';
  ctx.strokeText(text, 0, 0);
  if (glowIt) glow(fill, 22);
  ctx.fillStyle = fill; ctx.fillText(text, 0, 0);
  noGlow();
  ctx.restore();
}

function drawKnife(x, y, color, ks) {
  ctx.save();
  ctx.translate(x, y); ctx.scale(ks, ks);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  // lâmina de energia
  ctx.beginPath();
  ctx.moveTo(-28, 120); ctx.lineTo(28, 120); ctx.lineTo(28, 250);
  ctx.quadraticCurveTo(26, 320, -24, 355);
  ctx.lineTo(-28, 120);
  ctx.closePath();
  const g = ctx.createLinearGradient(-28, 0, 28, 0);
  g.addColorStop(0, '#7fe9ff'); g.addColorStop(0.55, '#f2ffff'); g.addColorStop(1, '#8fd3ff');
  glow('#22e6ff', 24);
  ctx.fillStyle = g; ctx.fill();
  noGlow();
  ctx.lineWidth = 8; ctx.strokeStyle = '#02060f'; ctx.stroke();
  ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(30,140,200,.85)';
  ctx.beginPath(); ctx.moveTo(4, 180); ctx.lineTo(4, 268); ctx.stroke();
  // cabo na cor do jogador
  ctx.lineWidth = 8; ctx.strokeStyle = '#02060f';
  rr(-17, 40, 34, 90, 12);
  ctx.fillStyle = color; ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 30, 30, 0, TAU);
  ctx.fillStyle = color; ctx.fill(); ctx.stroke();
  ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(255,255,255,.55)';
  ctx.beginPath(); ctx.moveTo(-6, 58); ctx.lineTo(-6, 114); ctx.stroke();
  ctx.restore();
}

function hintText(slot) {
  if (app.mode === 'local') {
    if (app.localActive.length === 1) return COARSE ? 'TOQUE' : 'ESPAÇO';
    return COARSE ? 'TOQUE AQUI' : 'TECLA ' + KEY_LABELS[slot];
  }
  return app.mySlot === slot ? (COARSE ? 'TOQUE' : 'ESPAÇO') : '';
}

function drawCorner(slot, v, now) {
  const left = slot % 2 === 0, top = slot < 2;
  const sl = SLOTS[slot], c = L.c;
  const menu = !app.inGame;
  const present = menu || v.active[slot];
  const ox = left ? L.il : L.W - L.ir, oy = top ? L.it : L.H - L.ib;
  const ready = !menu && v.active[slot] && v.phase === 'playing' && v.stun[slot] <= 0 &&
    !v.knives.some(k => k.p === slot) && !(v.pred && slot === app.mySlot);
  const flying = !menu && v.knives.some(k => k.p === slot) || (v.pred && slot === app.mySlot);

  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(left ? c : -c, top ? c : -c);
  ctx.globalAlpha = present ? 1 : 0.3;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';

  // painel (o corte diagonal fica virado para o centro da tela)
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(PW, 0); ctx.lineTo(PW, PH - 52); ctx.lineTo(PW - 52, PH); ctx.lineTo(0, PH);
  ctx.closePath();
  ctx.fillStyle = 'rgba(7,13,32,.93)'; ctx.fill();
  ctx.fillStyle = 'rgba(' + sl.rgb + (ready ? ',.2)' : ',.1)'); ctx.fill();
  glow(sl.color, ready ? 18 : 8);
  ctx.lineWidth = 4; ctx.strokeStyle = ready ? sl.color : 'rgba(' + sl.rgb + ',.55)'; ctx.stroke();
  noGlow();
  ctx.fillStyle = sl.color; ctx.fillRect(0, 0, 12, PH);

  // barra de energia da faca: cheia = pronta; enche de novo depois de um erro
  if (!menu && v.active[slot]) {
    const bx = 150, by = 90, bw = 150, bh = 18;
    let frac = 0;
    if (v.stun[slot] > 0) frac = 1 - v.stun[slot] / STUN;
    else if (v.phase === 'playing') frac = 1;
    rr(bx, by, bw, bh, 9);
    ctx.fillStyle = '#0c1430'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(' + sl.rgb + ',.45)'; ctx.stroke();
    if (frac > 0.02) {
      rr(bx, by, Math.max(bh, bw * frac), bh, 9);
      ctx.globalAlpha = (present ? 1 : 0.3) * (flying ? 0.45 : 1);
      if (ready) glow(sl.color, 14);
      ctx.fillStyle = v.stun[slot] > 0 ? '#ffffff' : sl.color; ctx.fill();
      noGlow();
    }
  }

  // indica qual é o jogador deste aparelho (online)
  if (!menu && app.mode !== 'local' && app.mySlot === slot && v.phase !== 'over') {
    ctx.globalAlpha = 0.5 + 0.35 * Math.sin(now / 200);
    ctx.lineWidth = 4; ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(-2, -2); ctx.lineTo(PW + 2, -2); ctx.lineTo(PW + 2, PH - 50); ctx.lineTo(PW - 50, PH + 2); ctx.lineTo(-2, PH + 2);
    ctx.closePath(); ctx.stroke();
  }
  ctx.restore();

  // textos (fora da área espelhada, para não ficarem invertidos)
  const px = x => (left ? L.il + x * c : L.W - L.ir - x * c);
  const py = y => (top ? L.it + y * c : L.H - L.ib - y * c);

  ctx.save();
  ctx.globalAlpha = present ? 1 : 0.3;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const pop = 1 + 0.35 * scorePop[slot];
  ctx.translate(px(84), py(88)); ctx.scale(pop * c, pop * c);
  ctx.font = '900 100px ' + FONT_H;
  glow(sl.color, 18);
  ctx.fillStyle = sl.color;
  ctx.fillText(String(v.scores[slot]), 0, 4);
  noGlow();
  ctx.restore();

  if (!menu && v.active[slot]) {
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '700 ' + Math.round(38 * c) + 'px ' + FONT_B;
    const label = (app.mode !== 'local' && app.mySlot === slot) ? 'Você' : app.names[slot];
    ctx.lineJoin = 'round'; ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(2,6,15,.8)';
    ctx.strokeText(label, px(225), py(48), 170 * c);
    ctx.fillStyle = '#eaf6ff'; ctx.fillText(label, px(225), py(48), 170 * c);
    const hint = v.phase === 'over' ? '' : hintText(slot);
    if (hint) {
      ctx.font = '700 ' + Math.round(30 * c) + 'px ' + FONT_B;
      ctx.fillStyle = ready ? 'rgba(' + sl.rgb + ',1)' : 'rgba(234,246,255,.55)';
      ctx.fillText(hint, px(215), py(138), 170 * c);
    }
    ctx.restore();
  }
}

// linhas que mostram a área de cada jogador (modo local) e brilho de quem jogou
function drawZones(v, dt) {
  for (let s = 0; s < 4; s++) {
    if (zoneFlash[s] <= 0.01) continue;
    const x = s % 2 === 0 ? 0 : L.W, y = s < 2 ? 0 : L.H;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 850);
    g.addColorStop(0, 'rgba(' + SLOTS[s].rgb + ',' + (0.3 * zoneFlash[s]).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(' + SLOTS[s].rgb + ',0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, L.W, L.H);
    zoneFlash[s] = Math.max(0, zoneFlash[s] - dt * 4);
  }
  const n = app.localActive.length;
  if (!(app.inGame && app.mode === 'local' && n > 1)) return;
  const mx = L.W / 2, my = L.H / 2;
  ctx.save();
  ctx.setLineDash([22, 18]); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(120,200,255,.17)';
  ctx.beginPath();
  if (n === 2) { ctx.moveTo(mx, 0); ctx.lineTo(mx, L.H); }
  else if (n === 4) { ctx.moveTo(mx, 0); ctx.lineTo(mx, L.H); ctx.moveTo(0, my); ctx.lineTo(L.W, my); }
  else { ctx.moveTo(mx, 0); ctx.lineTo(mx, my); ctx.moveTo(0, my); ctx.lineTo(mx, my); ctx.moveTo(mx, my); ctx.lineTo(L.W, L.H); }
  ctx.stroke();
  ctx.restore();
}

function drawRipples(dt) {
  for (let i = ripples.length - 1; i >= 0; i--) {
    const r = ripples[i];
    r.life -= dt * 2.4;
    if (r.life <= 0) { ripples.splice(i, 1); continue; }
    const p = 1 - r.life;
    ctx.save();
    ctx.globalAlpha = r.life * 0.9;
    ctx.lineWidth = 6 * r.life + 2; ctx.strokeStyle = r.color;
    glow(r.color, 14);
    ctx.beginPath(); ctx.arc(r.x, r.y, 24 + p * 150, 0, TAU); ctx.stroke();
    noGlow();
    ctx.globalAlpha = r.life * 0.25; ctx.fillStyle = r.color;
    ctx.beginPath(); ctx.arc(r.x, r.y, 24 + p * 70, 0, TAU); ctx.fill();
    ctx.restore();
  }
}

function drawNetInfo() {
  if (!app.inGame || (app.mode !== 'guest' && app.mode !== 'host')) return;
  const label = app.mode === 'host' ? 'ANFITRIÃO' : (net.rtt ? net.rtt + ' ms' : '… ms');
  const col = app.mode === 'host' ? '#8da2c7' : net.rtt < 80 ? '#3dff8a' : net.rtt < 160 ? '#ffc21a' : '#ff4d6a';
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '700 ' + Math.round(26 * L.c) + 'px ' + FONT_B;
  ctx.fillStyle = col;
  ctx.fillText(label, L.cx, L.H - L.ib - L.btn - 16);
  ctx.restore();
}

function draw(v, dt, now) {
  for (let i = 0; i < 4; i++) {
    if (v.scores[i] > lastScore[i]) scorePop[i] = 1;
    lastScore[i] = v.scores[i];
    scorePop[i] = Math.max(0, scorePop[i] - dt * 3.2);
  }

  ctx.setTransform(L.k, 0, 0, L.k, 0, 0);
  ctx.save();
  if (shake > 0.3) {
    ctx.translate(rand(-shake, shake), rand(-shake, shake));
    shake *= Math.pow(0.001, dt);
  } else shake = 0;

  drawBg();
  drawZones(v, dt);
  drawRings(now);
  drawCarrots(v, dt);
  drawCore(v, now);

  // facas
  const ks = L.s;
  const idleTip = L.kTop + 355 * ks;
  const hitTip = L.cy - 290 * L.s;
  drawKnife(L.cx, L.kTop, lastKnifeColor, ks);
  const flying = v.knives.filter(k => !(v.pred && k.p === app.mySlot));
  if (v.pred && v.pred.t < FLIGHT) flying.push({ p: app.mySlot, t: v.pred.t });
  flying.forEach(k => {
    const p = Math.min(1, k.t / FLIGHT);
    drawKnife(L.cx, L.kTop + Math.pow(p, 1.6) * (hitTip - idleTip), SLOTS[k.p].color, ks);
  });

  // partículas
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt * 1.3;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.vy += 1500 * dt * Math.max(0.6, L.s);
    p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
    ctx.save();
    ctx.globalAlpha = Math.min(1, p.life * 1.6);
    ctx.translate(p.x, p.y); ctx.rotate(p.rot);
    ctx.fillStyle = p.color; ctx.strokeStyle = '#02060f'; ctx.lineWidth = 4;
    if (p.kind === 'leaf') { ctx.beginPath(); ctx.ellipse(0, 0, p.size * 0.5, p.size, 0, 0, TAU); ctx.fill(); ctx.stroke(); }
    else if (p.kind === 'chunk') { rr(-p.size / 2, -p.size / 2, p.size, p.size * 1.3, 4); ctx.fill(); ctx.stroke(); }
    else { ctx.beginPath(); ctx.arc(0, 0, p.size * p.life + 2, 0, TAU); ctx.fill(); }
    ctx.restore();
  }

  // textos flutuantes
  for (let i = floats.length - 1; i >= 0; i--) {
    const f = floats[i];
    f.life -= dt * 1.2;
    if (f.life <= 0) { floats.splice(i, 1); continue; }
    f.y -= 120 * dt * Math.max(0.6, L.s);
    ctx.save();
    ctx.globalAlpha = Math.min(1, f.life * 2);
    txt(f.text, f.x, f.y, 76 * Math.max(0.7, L.s), f.color, 1, true);
    ctx.restore();
  }

  if (app.inGame && v.phase === 'playing' && v.timeLeft > ROUND - 0.8) {
    txt('VAI!', L.cx, L.cy - (R + 120) * L.s, 120 * Math.max(0.7, L.s), '#ffa23d', 1, true);
  }

  drawRipples(dt);
  for (let s = 0; s < 4; s++) drawCorner(s, v, now);
  drawNetInfo();
  ctx.restore();
}

// ---------- telas ----------
const screens = $$('.screen');
function showScreen(id) {
  screens.forEach(s => s.classList.toggle('show', s.id === id));
  updateExit();
}
function updateExit() {
  const overOpen = $('#over').classList.contains('show');
  $('#btn-exit').hidden = !(app.inGame && !overOpen);
}
let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}
function cleanName(s) { return String(s || '').replace(/[<>]/g, '').trim().slice(0, 12); }

updateMuteIcon();
$('#btn-mute').addEventListener('click', () => { sfx.toggle(); updateMuteIcon(); sfx.beep(); });
document.addEventListener('pointerdown', () => sfx.unlock());
$$('[data-go]').forEach(b => b.addEventListener('click', () => showScreen(b.dataset.go)));
$('#btn-howto').addEventListener('click', () => showScreen('howto'));
$('#btn-local').addEventListener('click', () => showScreen('local'));
$('#btn-online').addEventListener('click', () => { $('#online-msg').textContent = ''; showScreen('online'); });

// manter a tela acesa durante o jogo (celular)
let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) {}
}
function releaseAwake() { try { if (wakeLock) wakeLock.release(); } catch (e) {} wakeLock = null; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && app.inGame) keepAwake(); });

// ---------- início e fim da partida ----------
let lastPhase = 'idle';
let lastN = 0;

function resetFx() {
  particles.length = 0; floats.length = 0; ripples.length = 0; zoneFlash.fill(0);
  carrotScale.fill(1);
  lastPhase = 'countdown'; lastN = 0;
}
function beginGame(mode, active) {
  app.mode = mode;
  app.sim = new Sim(active, 'countdown');
  app.view = app.sim;
  app.inGame = true;
  app.overShown = false;
  resetFx();
  keepAwake();
  showScreen(null);
}
function beginGuestGame(active) {
  app.mode = 'guest';
  app.sim = null;
  app.view = new RemoteView(active);
  app.inGame = true;
  app.overShown = false;
  resetFx();
  keepAwake();
  showScreen(null);
}
function backToMenu() {
  app.inGame = false;
  app.overShown = false;
  app.mode = 'menu';
  app.sim = null;
  app.view = app.idle;
  app.emit = () => {};
  releaseAwake();
  showScreen('menu');
}

function showOver() {
  app.overShown = true;
  const v = app.view;
  const act = [0, 1, 2, 3].filter(s => v.active[s]);
  act.sort((a, b) => v.scores[b] - v.scores[a]);
  const top = v.scores[act[0]];
  const winners = act.filter(s => v.scores[s] === top);
  const note = $('#over-note');
  note.hidden = true;

  if (act.length === 1) {
    $('#over-title').textContent = top + (top === 1 ? ' cenoura' : ' cenouras');
    let best = 0;
    try { best = parseInt(localStorage.getItem('kt-best') || '0', 10) || 0; } catch (e) {}
    if (top > best) { try { localStorage.setItem('kt-best', String(top)); } catch (e) {} note.textContent = 'Novo recorde!'; }
    else note.textContent = 'Recorde: ' + best;
    note.hidden = false;
  } else {
    $('#over-title').textContent = winners.length > 1 ? 'Empate!' : app.names[winners[0]] + ' venceu!';
  }
  sfx.win();

  const list = $('#over-list');
  list.textContent = '';
  act.forEach(s => {
    const li = document.createElement('li');
    li.style.setProperty('--pc', SLOTS[s].color);
    const dot = document.createElement('span'); dot.className = 'dot';
    const nm = document.createElement('span'); nm.className = 'nm';
    nm.textContent = (v.scores[s] === top && act.length > 1 ? '★ ' : '') + app.names[s];
    const pts = document.createElement('span'); pts.className = 'pts'; pts.textContent = String(v.scores[s]);
    li.append(dot, nm, pts);
    list.appendChild(li);
  });

  const guest = app.mode === 'guest';
  $('#btn-again').hidden = guest;
  $('#over-wait').hidden = !guest;
  $('#btn-again').textContent = app.mode === 'host' ? 'Voltar à sala' : 'Jogar de novo';
  showScreen('over');
}

$('#btn-again').addEventListener('click', () => {
  if (app.mode === 'local') {
    beginGame('local', app.localActive);
    app.emit = onEvent;
  } else if (app.mode === 'host') {
    app.inGame = false; app.overShown = false; app.sim = null; app.view = app.idle;
    releaseAwake();
    broadcast({ t: 'tolobby' });
    showScreen('lobby');
    renderLobby();
  }
});
$('#btn-over-menu').addEventListener('click', () => {
  if (app.mode === 'host' || app.mode === 'guest') leaveOnline();
  else backToMenu();
});
$('#btn-exit').addEventListener('click', () => {
  if (!confirm('Sair da partida?')) return;
  if (app.mode === 'host' || app.mode === 'guest') leaveOnline();
  else backToMenu();
});

// ---------- modo local ----------
$$('#count-row .chip').forEach(c => c.addEventListener('click', () => {
  app.localCount = parseInt(c.dataset.count, 10);
  $$('#count-row .chip').forEach(x => x.classList.toggle('on', x === c));
}));
$('#btn-local-start').addEventListener('click', () => {
  app.localActive = [0, 1, 2, 3].slice(0, app.localCount);
  app.names = SLOTS.map(s => s.name);
  app.mySlot = -1;
  beginGame('local', app.localActive);
  app.emit = onEvent;
});

// ---------- entrada ----------
// Controles (sem botões na tela):
//  - Toque/clique na SUA ÁREA da tela (cada jogador tem um canto; 1 jogador usa a tela toda)
//  - Teclado: A azul, L verde, V amarelo, ↑ vermelho (Espaço no online e com 1 jogador)
//  - Controle (gamepad): qualquer botão de ação; o 1º controle é o 1º jogador, e assim por diante
function press(slotHint, cx, cy) {
  if (!app.inGame) return;
  let mine = -1;
  if (app.mode === 'local') {
    const s = app.localActive.length === 1 ? app.localActive[0] : slotHint;
    if (s == null || s < 0) return;
    mine = s;
    app.sim.throwKnife(s, app.emit);
  } else if (app.mode === 'host') {
    mine = 0;
    app.sim.throwKnife(0, app.emit);
  } else if (app.mode === 'guest') {
    const v = app.view, me = app.mySlot;
    mine = me;
    if (!(v instanceof RemoteView) || v.phase !== 'playing' || v.pred) return;
    if (me < 0 || !v.active[me] || v.stun[me] > 0) return;
    if (!net.hostConn || !net.hostConn.open) return;
    v.pred = { t: 0 };                       // mostra a faca na hora
    lastKnifeColor = SLOTS[me].color;
    sfx.throw();
    net.hostConn.send({ t: 'throw', th: v.theta });
  }
  if (cx != null && mine >= 0) {
    const r = cv.getBoundingClientRect();
    ripples.push({ x: (cx - r.left) / L.u, y: (cy - r.top) / L.u, color: SLOTS[mine].color, life: 1 });
  }
}

// qual jogador é dono do ponto tocado: o canto ativo mais próximo
function zoneSlot(clientX, clientY) {
  const r = cv.getBoundingClientRect();
  const nx = (clientX - r.left) / r.width, ny = (clientY - r.top) / r.height;
  let best = -1, bd = Infinity;
  app.localActive.forEach(s => {
    const dx = nx - (s % 2 === 0 ? 0 : 1), dy = ny - (s < 2 ? 0 : 1);
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = s; }
  });
  return best;
}

cv.addEventListener('pointerdown', e => {
  e.preventDefault();
  if (!app.inGame) return;
  if (e.pointerType === 'touch' && navigator.vibrate) { try { navigator.vibrate(10); } catch (err) {} }
  if (app.mode === 'local') press(app.localActive.length === 1 ? app.localActive[0] : zoneSlot(e.clientX, e.clientY), e.clientX, e.clientY);
  else press(-1, e.clientX, e.clientY);
});

document.addEventListener('keydown', e => {
  if (e.repeat || !app.inGame) return;
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  const slot = KEYS.indexOf(k);
  const act = k === ' ' || k === 'spacebar' || k === 'enter';
  if (slot >= 0 || k === ' ' || k === 'spacebar') e.preventDefault();
  if (app.mode === 'local') {
    if (slot >= 0) press(slot);
    else if (act && app.localActive.length === 1) press(-1);
  } else if (slot >= 0 || act) {
    press(-1);
  }
});

// controles (gamepad)
const padDown = {};
function pollPads() {
  if (!app.inGame || !navigator.getGamepads) return;
  let order = 0;
  Array.from(navigator.getGamepads()).forEach(gp => {
    if (!gp || !gp.connected) return;
    const down = gp.buttons.slice(0, 8).some(b => b.pressed);
    const was = padDown[gp.index];
    padDown[gp.index] = down;
    const mine = order++;
    if (!down || was) return;
    if (app.mode === 'local') {
      const s = app.localActive.length === 1 ? app.localActive[0] : app.localActive[mine];
      if (s != null) press(s);
    } else press(-1);
  });
}
window.addEventListener('gamepadconnected', () => toast('Controle conectado!'));

// =====================================================================
// ONLINE (funciona entre aparelhos diferentes: celular, tablet, PC)
// =====================================================================
function setMsg(t) { $('#online-msg').textContent = t || ''; }
function makeCode() {
  let c = '';
  for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}
function broadcast(msg) {
  net.conns.forEach(({ conn }) => { if (conn.open) { try { conn.send(msg); } catch (e) {} } });
}
function hostEmit(ev) {
  onEvent(ev);
  broadcast({ t: 'e', ev });
}
function stateMsg(s) {
  let al = 0;
  for (let i = 0; i < N_CARROTS; i++) if (s.alive[i]) al |= (1 << i);
  const r = n => Math.round(n * 1000) / 1000;
  return {
    t: 's', th: r(s.theta), om: r(s.omega), ph: s.phase, cd: r(s.countdown), tl: r(s.timeLeft),
    sc: s.scores.slice(), st: s.stun.map(r), al, kn: s.knives.map(k => [k.p, r(k.t)]),
  };
}
function lobbyNames() { return net.lobby.map(p => (p ? p.name : null)); }

function renderLobby(players, mySlot) {
  const names = players || lobbyNames();
  const me = mySlot != null ? mySlot : app.mySlot;
  $('#lobby-code').textContent = net.code || '----';
  const ul = $('#lobby-list');
  ul.textContent = '';
  names.forEach((n, s) => {
    const li = document.createElement('li');
    li.style.setProperty('--pc', SLOTS[s].color);
    if (!n) li.className = 'empty';
    const dot = document.createElement('span'); dot.className = 'dot';
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = n || 'Aguardando jogador…';
    li.append(dot, nm);
    if (n) {
      const parts = [];
      if (s === 0) parts.push('anfitrião');
      if (s === me) parts.push('você');
      if (parts.length) {
        const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = parts.join(' · ');
        li.appendChild(tag);
      }
    }
    ul.appendChild(li);
  });
  const host = app.mode === 'host';
  $('#btn-start').hidden = !host;
  $('#lobby-wait').hidden = host;
}
function broadcastLobby() {
  const names = lobbyNames();
  broadcast({ t: 'lobby', code: net.code, players: names });
  renderLobby(names, 0);
}

// ----- anfitrião -----
function createRoom(name, tries) {
  if (typeof Peer === 'undefined') { setMsg('Não foi possível carregar a conexão. Verifique a internet.'); return; }
  const code = makeCode();
  let peer;
  try { peer = new Peer(PREFIX + code); } catch (e) { setMsg('Erro ao criar a sala.'); return; }
  net.peer = peer;
  peer.on('open', () => {
    net.code = code;
    net.conns = new Map();
    net.lobby = [{ name, id: 'host' }, null, null, null];
    net.leaving = false;
    app.mode = 'host';
    app.mySlot = 0;
    app.names = SLOTS.map(s => s.name);
    showScreen('lobby');
    broadcastLobby();
  });
  peer.on('connection', onGuestConnect);
  peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) {} });
  peer.on('error', err => {
    if (err.type === 'unavailable-id' && tries < 6) {
      try { peer.destroy(); } catch (e) {}
      createRoom(name, tries + 1);
    } else if (app.mode !== 'host') {
      setMsg('Erro ao criar a sala (' + err.type + ').');
    } else if (err.type !== 'peer-unavailable') {
      toast('Problema de conexão.');
    }
  });
}

function onGuestConnect(conn) {
  conn.on('data', msg => handleHostMsg(conn, msg));
  conn.on('close', () => dropGuest(conn));
  conn.on('error', () => dropGuest(conn));
}
function handleHostMsg(conn, msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'hello') {
    if (app.inGame) { conn.send({ t: 'busy' }); setTimeout(() => conn.close(), 300); return; }
    let slot = -1;
    for (let i = 1; i < 4; i++) if (!net.lobby[i]) { slot = i; break; }
    if (slot < 0) { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 300); return; }
    const name = cleanName(msg.name) || ('Jogador ' + (slot + 1));
    net.lobby[slot] = { name, id: conn.peer };
    net.conns.set(conn.peer, { conn, slot });
    conn.send({ t: 'welcome', slot });
    broadcastLobby();
  } else if (msg.t === 'throw') {
    const g = net.conns.get(conn.peer);
    if (g && app.sim) app.sim.throwKnife(g.slot, app.emit, msg.th);
  } else if (msg.t === 'ping') {
    try { conn.send({ t: 'pong', ts: msg.ts }); } catch (e) {}
  }
}
function dropGuest(conn) {
  const g = net.conns.get(conn.peer);
  if (!g) return;
  net.conns.delete(conn.peer);
  net.lobby[g.slot] = null;
  if (app.sim) app.sim.active[g.slot] = false;
  if (app.mode === 'host') {
    if (!app.inGame) broadcastLobby();
    else toast('Um jogador saiu.');
  }
}

function startOnline() {
  const active = [];
  net.lobby.forEach((p, s) => { if (p) active.push(s); });
  app.names = lobbyNames().map((n, s) => n || SLOTS[s].name);
  broadcast({ t: 'start', active, names: app.names });
  beginGame('host', active);
  app.emit = hostEmit;
}
$('#btn-start').addEventListener('click', startOnline);

// ----- convidado -----
function joinRoom(code, name) {
  if (typeof Peer === 'undefined') { setMsg('Não foi possível carregar a conexão. Verifique a internet.'); return; }
  setMsg('Entrando na sala…');
  net.leaving = false;
  let peer;
  try { peer = new Peer(); } catch (e) { setMsg('Erro de conexão.'); return; }
  net.peer = peer;
  let joined = false;
  const fail = text => {
    clearTimeout(timer);
    try { peer.destroy(); } catch (e) {}
    net.peer = null; net.hostConn = null;
    setMsg(text);
  };
  const timer = setTimeout(() => { if (!joined) fail('Sala não encontrada ou sem resposta.'); }, 12000);

  peer.on('open', () => {
    const conn = peer.connect(PREFIX + code, { reliable: true });
    net.hostConn = conn;
    conn.on('open', () => { conn.send({ t: 'hello', name }); });
    conn.on('data', msg => {
      if (msg && msg.t === 'welcome') { joined = true; clearTimeout(timer); }
      handleGuestMsg(msg, code);
    });
    conn.on('close', () => { if (joined && !net.leaving) leaveOnline('A sala foi encerrada.'); });
    conn.on('error', () => { if (!joined) fail('Não foi possível entrar na sala.'); });
  });
  peer.on('error', err => {
    if (!joined) fail(err.type === 'peer-unavailable' ? 'Sala não encontrada.' : 'Erro de conexão (' + err.type + ').');
  });
}

function handleGuestMsg(msg, code) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.t) {
    case 'welcome':
      app.mode = 'guest';
      app.mySlot = msg.slot;
      net.code = code;
      showScreen('lobby');
      renderLobby([0, 1, 2, 3].map(i => (i === msg.slot ? '…' : null)), msg.slot);
      clearInterval(net.pingTimer);
      net.pingTimer = setInterval(() => {
        if (net.hostConn && net.hostConn.open) net.hostConn.send({ t: 'ping', ts: performance.now() });
      }, 2000);
      break;
    case 'busy': leaveOnline('A partida já começou.'); break;
    case 'full': leaveOnline('A sala está cheia.'); break;
    case 'lobby':
      net.code = msg.code;
      if (app.inGame && !app.overShown) break;
      renderLobby(msg.players, app.mySlot);
      break;
    case 'tolobby':
      app.inGame = false; app.overShown = false; app.view = app.idle;
      releaseAwake();
      showScreen('lobby');
      break;
    case 'start':
      app.names = msg.names;
      beginGuestGame(msg.active);
      break;
    case 's':
      if (app.view instanceof RemoteView) app.view.apply(msg);
      break;
    case 'e':
      onEvent(msg.ev);
      break;
    case 'pong': {
      const r = performance.now() - msg.ts;
      net.rtt = Math.round(net.rtt ? net.rtt * 0.6 + r * 0.4 : r);
      break;
    }
  }
}

function leaveOnline(message) {
  net.leaving = true;
  clearInterval(net.pingTimer);
  try { if (net.hostConn) net.hostConn.close(); } catch (e) {}
  net.conns.forEach(({ conn }) => { try { conn.close(); } catch (e) {} });
  try { if (net.peer) net.peer.destroy(); } catch (e) {}
  net.peer = null; net.hostConn = null; net.conns = new Map();
  net.lobby = [null, null, null, null]; net.code = ''; net.rtt = 0;
  app.mySlot = -1;
  backToMenu();
  if (message) toast(message);
}

$('#btn-create').addEventListener('click', () => {
  const name = cleanName($('#inp-name').value) || 'Jogador';
  try { localStorage.setItem('kt-name', name); } catch (e) {}
  setMsg('Criando sala…');
  createRoom(name, 0);
});
$('#btn-join').addEventListener('click', () => {
  const name = cleanName($('#inp-name').value) || 'Jogador';
  const code = $('#inp-code').value.trim().toUpperCase();
  if (code.length !== 4) { setMsg('Digite o código de 4 letras da sala.'); return; }
  try { localStorage.setItem('kt-name', name); } catch (e) {}
  joinRoom(code, name);
});
$('#inp-code').addEventListener('input', e => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});
$('#btn-leave').addEventListener('click', () => leaveOnline());

function copyText(text, okMsg) {
  const done = () => toast(okMsg);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => toast('Não foi possível copiar.'));
  } else {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('Não foi possível copiar.'); }
    ta.remove();
  }
}
$('#btn-copy-code').addEventListener('click', () => copyText(net.code, 'Código copiado!'));
$('#btn-copy-link').addEventListener('click', () => {
  copyText(location.origin + location.pathname + '?sala=' + net.code, 'Link copiado!');
});

// nome salvo e entrada por link (?sala=CODIGO)
try { const n = localStorage.getItem('kt-name'); if (n) $('#inp-name').value = n; } catch (e) {}
(() => {
  const m = /[?&]sala=([A-Za-z0-9]{4})/.exec(location.search);
  if (m) { $('#inp-code').value = m[1].toUpperCase(); showScreen('online'); }
})();

// ---------- laço principal ----------
let last = performance.now();
let acc = 0;
let slowFrames = 0, frameCount = 0;

function loop(now) {
  const raw = (now - last) / 1000;
  const dt = Math.min(0.05, raw);
  last = now;
  const v = app.view;

  // desliga os brilhos se o aparelho estiver lento
  if (fx) {
    frameCount++;
    if (raw > 0.034) slowFrames++;
    if (frameCount >= 90) { if (slowFrames > 55) fx = false; frameCount = 0; slowFrames = 0; }
  }

  pollPads();
  if (v instanceof Sim) v.step(dt, app.emit);
  else v.step(dt);

  if (app.mode === 'host' && app.sim) {
    acc += dt;
    if (acc >= 0.05) { acc = 0; broadcast(stateMsg(app.sim)); }
  }

  if (app.inGame) {
    if (v.phase === 'countdown') {
      const n = Math.ceil(v.countdown);
      if (n !== lastN && n > 0) { lastN = n; sfx.beep(); }
    }
    if (v.phase !== lastPhase) {
      if (v.phase === 'playing') sfx.go();
      if (v.phase === 'over' && !app.overShown) {
        setTimeout(() => { if (app.inGame && app.view.phase === 'over' && !app.overShown) showOver(); }, 700);
      }
      lastPhase = v.phase;
    }
  }

  draw(v, dt, now);
  requestAnimationFrame(loop);
}

if (document.fonts && document.fonts.load) {
  document.fonts.load('900 40px Orbitron').catch(() => {});
  document.fonts.load('700 30px Rajdhani').catch(() => {});
}
layout();
requestAnimationFrame(loop);

})();
