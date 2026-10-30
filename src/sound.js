/* Sound: Web Audio, no network.
   Keys are real recordings (keysamples.js: one MP3 sprite, decoded once and sliced per class); without them the
   keys stay silent. Events (disk seek, terminal bell, error buzz) are synthesised sample-by-sample into
   AudioBuffers on first use. Playback is a BufferSource -> lowpass -> Gain -> Panner per hit.
   Mix: keys/events -> (dry + short generated room reverb) -> glue compressor -> limiter -> mute -> out.
   No music: the landing intro is silent. */
(() => {
'use strict';
const M = window.MAC = window.MAC || {};

const TAU = Math.PI * 2;
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const LS_KEY = 'kaiav.sound.muted', OLD_KEY = 'mac.sound.muted';   // renamed to the site's prefix; moved over once

/* ---------------- tiny DSP toolkit (pure JS, runs on Float32Arrays) ---------------- */
function rng(seed){
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hash(str){ let h = 2166136261; for (let i = 0; i < str.length; i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/* RBJ biquad, direct form I. type: 'lp' | 'hp' | 'bp' (constant 0 dB peak). */
function biquad(type, f, Q, sr){
  let b0, b1, b2, a1, a2, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  function set(fr, q){
    const w = TAU * clamp(fr, 10, sr * 0.45) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al;
    if (type === 'lp'){ b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; }
    else if (type === 'hp'){ b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; }
    else { b0 = al; b1 = 0; b2 = -al; }
    b0 /= a0; b1 /= a0; b2 /= a0; a1 = -2 * c / a0; a2 = (1 - al) / a0;
  }
  set(f, Q);
  const p = x => { const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
  p.set = set;
  return p;
}
/* Filtered, exponentially decaying noise burst added into out at time t0 (s). */
function burst(out, sr, r, t0, tau, type, f, Q, amp, len){
  const flt = biquad(type, f, Q, sr), i0 = Math.round(t0 * sr), n = Math.min(out.length - i0, Math.round((len || tau * 8) * sr));
  const att = Math.max(2, Math.round(0.00012 * sr));
  for (let i = 0; i < n; i++){
    const t = i / sr, env = Math.exp(-t / tau) * (i < att ? i / att : 1);
    out[i0 + i] += amp * flt((r() * 2 - 1) * env);
  }
  /* let the filter ring out */
  for (let i = n; i < n + Math.round(0.004 * sr) && i0 + i < out.length; i++) out[i0 + i] += amp * flt(0);
}
/* Damped sine (starts at phase 0 with a tiny attack so it never clicks). */
function ring(out, sr, t0, f, tau, amp){
  const i0 = Math.round(t0 * sr), n = Math.min(out.length - i0, Math.round(tau * 9 * sr)), att = Math.round(0.0006 * sr);
  let ph = 0;
  for (let i = 0; i < n; i++){
    const t = i / sr;
    ph += TAU * f / sr;
    out[i0 + i] += amp * Math.sin(ph) * Math.exp(-t / tau) * (i < att ? i / att : 1);
  }
}
/* Fade the tail, kill DC, normalise to `peak`. */
function finish(out, sr, peak, fadeMs){
  let m = 0; for (let i = 0; i < out.length; i++) m += out[i]; m /= out.length;
  const fn = Math.round((fadeMs || 6) * 0.001 * sr);
  let pk = 0;
  for (let i = 0; i < out.length; i++){
    let v = out[i] - m;
    const k = out.length - 1 - i; if (k < fn) v *= k / fn;
    if (i < 8) v *= i / 8;
    if (!isFinite(v)) v = 0;
    out[i] = v; const a = v < 0 ? -v : v; if (a > pk) pk = a;
  }
  if (peak && pk > 0){ const g = peak / pk; for (let i = 0; i < out.length; i++) out[i] *= g; }
  return out;
}
function onePoleLP(out, sr, f){ const a = Math.exp(-TAU * f / sr); let y = 0; for (let i = 0; i < out.length; i++){ y = out[i] + a * (y - out[i]); out[i] = y; } return out; }

/* ---------------- event synthesis ---------------- */
/* Additive band-limited buzz: harmonics of f0 up to fmax, amp ~ 1/n^tilt. */
function harmonicBuzz(out, sr, t0, f0, fmax, tilt, envFn, amp, oddOnly){
  /* one band-limited cycle in a wavetable, then read it with linear interpolation (cheap for long sounds) */
  const N = 4096, tab = new Float32Array(N + 1), H = Math.floor(Math.min(fmax, sr * 0.45) / f0), r = rng(Math.round(f0 * 131));
  let norm = 0;
  for (let h = 1; h <= H; h++){
    if (oddOnly && h % 2 === 0) continue;
    const a = 1 / Math.pow(h, tilt), p = r() * TAU; norm += a;
    for (let i = 0; i < N; i++) tab[i] += a * Math.sin(TAU * h * i / N + p);
  }
  tab[N] = tab[0];
  const i0 = Math.round(t0 * sr), n = out.length - i0, inc = f0 * N / sr, k = amp * 2.2 / norm;
  let ph = 0;
  for (let i = 0; i < n; i++){
    const e = envFn(i / sr);
    if (e !== 0){ const j = ph | 0, f = ph - j; out[i0 + i] += k * e * (tab[j] + (tab[j + 1] - tab[j]) * f); }
    ph += inc; if (ph >= N) ph -= N;
  }
}
function adsr(a, d, tot){ return t => t < a ? t / a : t < tot - d ? 1 : t < tot ? (tot - t) / d : 0; }

/* Floppy drive motor whir at speed, length `dur`. */
function addMotor(out, sr, r, t0, dur, amp){
  const i0 = Math.round(t0 * sr), n = Math.min(out.length - i0, Math.round(dur * sr));
  const bp = biquad('bp', 400, 3, sr), bp2 = biquad('bp', 1300, 6, sr);
  let ph = 0, ph2 = 0;
  for (let i = 0; i < n; i++){
    const t = i / sr;
    ph += TAU * 50 / sr; ph2 += TAU * 5 / sr;
    const flutter = 1 + 0.18 * Math.sin(ph2);
    const env = Math.min(1, t / 0.08) * Math.min(1, (dur - t) / 0.25);
    const nz = r() * 2 - 1;
    out[i0 + i] += amp * env * flutter * (bp(nz) * 0.9 + bp2(nz) * 0.25 + Math.sin(ph) * 0.12);
  }
}
function synthDisk(sr, seed){
  const r = rng(seed), dur = 0.75 + r() * 0.25, out = new Float32Array(Math.round(dur * sr));
  addMotor(out, sr, r, 0, dur, 0.12);
  /* head-load solenoid clunk */
  burst(out, sr, r, 0.01, 0.002, 'bp', 700, 1.6, 0.55);
  ring(out, sr, 0.01, 150, 0.012, 0.3);
  /* stepper chatter: one or two seek bursts of rapid steps, then the settle tick */
  let t = 0.07 + r() * 0.04;
  const groups = 1 + (r() < 0.6 ? 1 : 0);
  for (let g = 0; g < groups; g++){
    const steps = 6 + Math.floor(r() * 16), rate = 0.0045 + r() * 0.0025, f = 1050 + r() * 350;
    for (let s = 0; s < steps; s++){
      ring(out, sr, t, f * (0.97 + r() * 0.06), 0.0022, 0.32);
      ring(out, sr, t, 420 + r() * 60, 0.003, 0.22);
      burst(out, sr, r, t, 0.0003, 'bp', 2600, 1.5, 0.18);
      t += rate * (0.92 + r() * 0.16);
    }
    ring(out, sr, t + 0.002, 330, 0.008, 0.25);         // head settles
    t += 0.06 + r() * 0.12;
  }
  /* data read: a faint fluttery rasp while the head sits on the track */
  burst(out, sr, r, Math.min(t, dur - 0.2), 0.08, 'bp', 1800, 4, 0.03, 0.15);
  return finish(onePoleLP(out, sr, 8000), sr, 0.8, 30);
}
function synthBeep(sr){
  /* a soft terminal bell: a small speaker squawking a near-square tone, rounded off */
  const dur = 0.16, out = new Float32Array(Math.round((dur + 0.06) * sr));
  harmonicBuzz(out, sr, 0, 784, 5000, 1.15, adsr(0.004, 0.045, dur), 1, true);
  const lp = biquad('lp', 2600, 0.9, sr), res = biquad('bp', 1600, 3, sr);
  for (let i = 0; i < out.length; i++){ const x = out[i]; out[i] = lp(x) + 0.25 * res(x); }
  return finish(out, sr, 0.9, 20);
}
function synthError(sr){
  /* low, short buzz with a little roughness */
  const dur = 0.2, out = new Float32Array(Math.round((dur + 0.05) * sr));
  harmonicBuzz(out, sr, 0, 98, 2400, 1.0, t => adsr(0.006, 0.05, dur)(t) * (0.85 + 0.15 * Math.sin(TAU * 31 * t)), 1);
  const lp = biquad('lp', 1100, 0.8, sr);
  for (let i = 0; i < out.length; i++) out[i] = lp(out[i]);
  return finish(out, sr, 0.9, 20);
}
function reverbIR(ctx){
  const sr = ctx.sampleRate, len = Math.round(0.75 * sr), buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++){
    const r = rng(77 + ch * 13), d = buf.getChannelData(ch);
    const pre = Math.round(0.006 * sr);
    let y;
    /* small room: early reflections, then a damped (darkening) diffuse tail, RT60 ~ 0.55 s */
    const er = [0.007, 0.011, 0.016, 0.023, 0.029, 0.037];
    for (let k = 0; k < er.length; k++){ const i = Math.round((er[k] + ch * 0.0013 * (k % 3)) * sr); d[i] += (r() < 0.5 ? -1 : 1) * 0.55 * Math.pow(0.8, k); }
    y = 0;
    for (let i = pre; i < len; i++){
      const t = (i - pre) / sr;
      const a = Math.exp(-TAU * (2200 + 6000 * Math.exp(-t / 0.12)) / sr);
      y = (r() * 2 - 1) * (1 - a) + a * y;
      const env = Math.exp(-t / 0.08) * Math.min(1, t / 0.004);
      d[i] += y * env * 2.2;
      if (len - i < 400) d[i] *= (len - i) / 400;
    }
  }
  return buf;
}

/* ---------------- recorded keys: one MP3 sprite, decoded once ---------------- */
/* The decoded sprite starts with a short sync blip; finding its leading edge measures the decoder's start padding
   (it differs between browsers), so every clip is cut at the right sample. */
let keyBufs = null, decoding = null;
function sliceKeys(buf, S, ctx){
  const sr = buf.sampleRate, x = buf.getChannelData(0), lim = Math.min(x.length, Math.round(0.25 * sr));
  let i = 0; while (i < lim && Math.abs(x[i]) <= 0.2) i++;
  const shift = i < lim ? i / sr - S.mark : 0;
  const cut = ([t, len]) => {
    const a = clamp(Math.round((t + shift) * sr), 0, x.length - 1), n = Math.max(1, Math.min(Math.round(len * sr), x.length - a));
    const b = ctx.createBuffer(1, n, sr); b.getChannelData(0).set(x.subarray(a, a + n)); return b;
  };
  const set = c => c && { d: c.d.map(cut), u: c.u.map(cut) };
  const C = S.clips, normal = set(C.normal), big = set(C.enter) || normal;
  return { normal, soft: normal, heavy: big, space: set(C.space) || normal, backspace: set(C.backspace) || big };
}
function decodeKeys(ctx){
  const S = M.KEY_SAMPLES;
  if (decoding || !S || !S.mp3 || !S.clips || !S.clips.normal) return;
  const bin = atob(S.mp3), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  decoding = new Promise((ok, no) => { const p = ctx.decodeAudioData(bytes.buffer, ok, no); if (p && p.catch) p.catch(no); })
    .then(buf => { keyBufs = sliceKeys(buf, S, ctx); flushPending(); }, () => {});   // undecodable: keys stay silent
}
/* decode ahead of the first gesture (an offline context needs no permission), so the first keystroke has its buffer */
{ const O = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (O) setTimeout(() => { try { decodeKeys(new O(1, 1, 44100)); } catch (e){} }, 0); }

/* ---------------- key mapping ---------------- */
const ROWS = [
  ['Backquote', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal', 'Backspace'],
  ['Tab', 'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight', 'Backslash'],
  ['CapsLock', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote', 'Enter'],
  ['ShiftLeft', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash', 'ShiftRight'],
];
const KEYX = { Space: 0.5, ArrowLeft: 0.85, ArrowDown: 0.9, ArrowRight: 0.95, ArrowUp: 0.9, ControlLeft: 0.05, AltLeft: 0.15, MetaLeft: 0.1, ControlRight: 0.85, AltRight: 0.75, MetaRight: 0.8, Escape: 0.02 };
ROWS.forEach(row => row.forEach((c, i) => { KEYX[c] = i / (row.length - 1); }));
function keyClass(code){
  if (code === 'Space') return 'space';
  if (code === 'Enter' || code === 'NumpadEnter' || code === 'Backspace') return 'heavy';
  if (/^(Shift|Control|Alt|Meta|CapsLock|Fn|OS)/.test(code)) return 'soft';
  return 'normal';
}
const keyInfo = {};
function infoFor(code){
  let k = keyInfo[code]; if (k) return k;
  const r = rng(hash(code || 'x'));
  const x = KEYX[code] != null ? KEYX[code] : 0.3 + r() * 0.4;
  k = keyInfo[code] = {
    cls: keyClass(code),
    rate: 0.955 + r() * 0.09,                 // per-key pitch
    gain: 0.86 + r() * 0.22,                  // per-key level
    bright: 7000 + r() * 4000,                // per-key cap/filter character
    pan: (x - 0.5) * 0.5,
    pool: Math.floor(r() * 1000),             // which slice of the variant pool this key leans on
    last: -1,
  };
  return k;
}
/* playback levels and pitch per key class */
const SAMPLED = {
  normal: { down: 0.75, up: 0.68, rate: 1.0 },
  soft:   { down: 0.58, up: 0.52, rate: 0.98 },
  heavy:  { down: 0.82, up: 0.75, rate: 1.0 },
  space:  { down: 0.82, up: 0.75, rate: 1.0 },
};

/* ---------------- engine ---------------- */
function Engine(ctx){
  const sr = ctx.sampleRate, E = this;
  const mk = (arr) => { const b = ctx.createBuffer(1, arr.length, sr); b.getChannelData(0).set(arr); return b; };
  E.ctx = ctx;

  /* master bus */
  E.out = ctx.createGain(); E.out.gain.value = 1;              // mute stage
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -20; glue.knee.value = 12; glue.ratio.value = 3; glue.attack.value = 0.004; glue.release.value = 0.18;
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -4; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.08;
  const tone = ctx.createBiquadFilter(); tone.type = 'highshelf'; tone.frequency.value = 7000; tone.gain.value = -3;  // never harsh
  const hpf = ctx.createBiquadFilter(); hpf.type = 'highpass'; hpf.frequency.value = 25; hpf.Q.value = 0.7;
  E.master = ctx.createGain(); E.master.gain.value = 0.8;
  E.master.connect(hpf); hpf.connect(tone); tone.connect(glue); glue.connect(lim); lim.connect(E.out); E.out.connect(ctx.destination);

  /* room reverb send */
  E.verb = ctx.createConvolver(); E.verb.buffer = reverbIR(ctx);
  const verbRet = ctx.createGain(); verbRet.gain.value = 0.32;
  const verbLP = ctx.createBiquadFilter(); verbLP.type = 'lowpass'; verbLP.frequency.value = 5500;
  E.verb.connect(verbLP); verbLP.connect(verbRet); verbRet.connect(E.master);

  E.keyBus = ctx.createGain(); E.keyBus.gain.value = 0.85; E.keyBus.connect(E.master);
  const keySend = ctx.createGain(); keySend.gain.value = 0.5; E.keyBus.connect(keySend); keySend.connect(E.verb);
  E.fxBus = ctx.createGain(); E.fxBus.gain.value = 1; E.fxBus.connect(E.master);
  const fxSend = ctx.createGain(); fxSend.gain.value = 0.35; E.fxBus.connect(fxSend); fxSend.connect(E.verb);

  /* event buffers are built lazily (or by warm()), so unlock stays light */
  const FX = {
    beep: () => [mk(synthBeep(sr))],
    error: () => [mk(synthError(sr))],
    disk: () => [0, 1, 2, 3].map(i => mk(synthDisk(sr, 300 + i * 17))),
  };
  const cache = {};
  E.getFx = name => cache[name] || (FX[name] ? (cache[name] = FX[name]()) : null);
  E.warm = () => { for (const n in FX) E.getFx(n); };
  E.voices = 0;
}
Engine.prototype.play = function (buf, bus, when, gain, rate, pan, lpF){
  const ctx = this.ctx;
  if (this.voices > 40) return;
  const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate || 1;
  const g = ctx.createGain(); g.gain.value = gain;
  let node = src;
  if (lpF){ const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lpF; f.Q.value = 0.5; node.connect(f); node = f; }
  node.connect(g); node = g;
  if (pan && ctx.createStereoPanner){ const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); node.connect(p); node = p; }
  node.connect(bus);
  this.voices++;
  src.onended = () => { this.voices--; try { node.disconnect(); } catch (e){} };
  src.start(when);
  return src;
};
Engine.prototype.key = function (code, down, when){
  const k = infoFor(code), pool = (code === 'Backspace' && keyBufs.backspace) || keyBufs[k.cls], list = down ? pool.d : pool.u;
  /* each key leans on 3 neighbouring variants of its pool, plus an occasional wildcard; never the same twice in a row */
  let idx;
  for (let tries = 0; tries < 4; tries++){
    idx = Math.random() < 0.8 ? (k.pool + Math.floor(Math.random() * 3)) % list.length : Math.floor(Math.random() * list.length);
    if (idx !== (down ? k.last : k.lastU)) break;
  }
  if (down) k.last = idx; else k.lastU = idx;
  const sm = SAMPLED[k.cls];
  const level = (down ? sm.down : sm.up) * k.gain * (0.88 + Math.random() * 0.24);
  const rate = k.rate * sm.rate * (0.985 + Math.random() * 0.03);
  this.play(list[idx], this.keyBus, when, level, rate, k.pan + (Math.random() - 0.5) * 0.04, k.bright * (0.92 + Math.random() * 0.16));
};
Engine.prototype.event = function (name, when){
  const L = this.getFx(name); if (!L) return;
  const buf = L[Math.floor(Math.random() * L.length)];
  const lvl = name === 'beep' ? 0.085 : name === 'error' ? 0.15 : 0.26;
  this.play(buf, this.fxBus, when, lvl, name === 'disk' ? 0.97 + Math.random() * 0.06 : 1, name === 'disk' ? 0.25 : 0);
};

/* ---------------- public API ---------------- */
let eng = null, booted = false, muted = false, hidden = false, unlockedAt = 0;
try {
  const old = localStorage.getItem(OLD_KEY);
  if (old != null){ if (localStorage.getItem(LS_KEY) == null) localStorage.setItem(LS_KEY, old); localStorage.removeItem(OLD_KEY); }
  muted = localStorage.getItem(LS_KEY) === '1';
} catch (e){}

function ready(){
  if (!eng) return false;
  const ctx = eng.ctx;
  /* the first keystroke usually lands while resume() is still in flight: schedule it anyway. A suspended context's
     clock is frozen, so the hit plays the instant the context starts rather than being dropped. */
  if (ctx.state !== 'running'){ if (!muted && !hidden && ctx.state === 'suspended'){ ctx.resume().catch(() => {}); return unlockedAt > 0 && performance.now() - unlockedAt < 1500; } return false; }
  return !muted;
}
/* keys pressed while the sprite is still decoding play the moment it is ready (if that is soon enough to still feel right) */
const pending = [];
function flushPending(){
  const now = performance.now();
  for (const [code, down, t] of pending.splice(0)) if (now - t < 300) sound.key(code, down);
}

const sound = {
  get muted(){ return muted; },
  unlock(){
    try {
      if (!eng){
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
        const ctx = new AC({ latencyHint: 'interactive' });
        eng = new Engine(ctx);
        eng.out.gain.value = muted ? 0 : 1;
        decodeKeys(ctx);                     // only if the early offline decode was not possible
      }
      if (!unlockedAt) unlockedAt = performance.now();
      const ctx = eng.ctx, go = () => {
        if (booted) return; booted = true;
        setTimeout(() => { try { eng.warm(); } catch (e){} }, 2600);   // build the event sounds before they are needed
      };
      if (ctx.state === 'running') go();
      else if (!hidden){ const p = ctx.resume(); if (p && p.then) p.then(go, () => {}); else go(); }
    } catch (e){ /* audio is a nicety; never break the page */ }
  },
  key(code, down){
    if (!ready()) return;
    if (!keyBufs){ if (decoding && pending.length < 6) pending.push([code, down, performance.now()]); return; }
    try { eng.key(String(code || ''), !!down, eng.ctx.currentTime); } catch (e){}
  },
  event(name){
    if (!ready()) return;
    try { eng.event(name, eng.ctx.currentTime + 0.005); } catch (e){}
  },
  setMuted(m){
    muted = !!m;
    try { localStorage.setItem(LS_KEY, muted ? '1' : '0'); } catch (e){}
    if (!eng) return;
    const ctx = eng.ctx, g = eng.out.gain, now = ctx.currentTime;
    g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.setTargetAtTime(muted ? 0 : 1, now, 0.04);
    if (!muted && !hidden && ctx.state === 'suspended') ctx.resume().catch(() => {});
  },
};

document.addEventListener('visibilitychange', () => {
  hidden = document.visibilityState === 'hidden';
  if (!eng) return;
  try { if (hidden) eng.ctx.suspend(); else if (!muted && booted) eng.ctx.resume(); } catch (e){}
});

M.sound = sound;
})();
