/* Sound: Web Audio, no network.
   Keys are real recordings (keysamples.js: one MP3 sprite, decoded once and sliced per class); without them the
   keys stay silent. Events (disk seek, terminal bell, error buzz) are synthesised sample-by-sample into
   AudioBuffers on first use. Playback is a BufferSource -> lowpass -> Gain -> Panner per hit.
   Mix: keys/events -> (dry + short generated room reverb) -> glue compressor -> limiter -> mute -> out.
   The landing intro's sound effects (sfx(name, opts), see SFX) are built live from nodes on their own bus, into the
   same master chain. There is no music. */
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
  E.lim = lim;

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
  const cache = E.fxCache = {};
  E.getFx = name => cache[name] || (FX[name] ? (cache[name] = FX[name]()) : null);
  E.warm = () => { for (const n in FX) E.getFx(n); };
  E.voices = 0;

  /* sfx bus (the intro's effects): a highpass and a gentle glue compressor of its own, then straight into the master's
     limiter and mute stage (not the keys' glue: its low threshold would flatten the effects' dynamics) */
  E.offline = !!(window.OfflineAudioContext && ctx instanceof window.OfflineAudioContext);
  E.sfxBus = ctx.createGain(); E.sfxBus.gain.value = 1;
  const sHp = ctx.createBiquadFilter(); sHp.type = 'highpass'; sHp.frequency.value = 28; sHp.Q.value = 0.7;
  const sGlue = ctx.createDynamicsCompressor();
  sGlue.threshold.value = -12; sGlue.knee.value = 6; sGlue.ratio.value = 2.5; sGlue.attack.value = 0.003; sGlue.release.value = 0.15;
  E.sfxOut = ctx.createGain(); E.sfxOut.gain.value = 0.5;
  E.sfxBus.connect(sHp); sHp.connect(sGlue); sGlue.connect(E.sfxOut); E.sfxOut.connect(lim);
  E.sfxVoices = [];
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

/* ---------------- intro sound effects: sfx(name, opts) ----------------
   Built live from Web Audio nodes (oscillators, one shared stereo noise buffer, filters, a tanh saturator), so every
   call can take its own duration, pan and pitch. Each effect is layered: a transient (a click or crack), a body (a
   saturated sine or filtered noise, so small speakers hear the low end as harmonics), and a tail (sends into two shared
   convolvers: a small "room" that glues them into one space and a long dark "hall" for the big hits). Width comes from
   decorrelated stereo noise, Haas delays and panning; transients and subs stay centred.
   Each call is a voice: its nodes feed one gain into the sfx bus (glue compressor, limiter, then the master, so mute and
   the master limiter apply). At most SFX_MAX voices; a new one fades out the oldest. A voice's nodes are disconnected
   when it ends. The noise buffer, the impulse responses, the reverbs and the saturation curve are made on first use. */
const SFX_MAX = 8;
let SAT = null;
function satCurve(){
  if (SAT) return SAT;
  const n = 2048, k = 2.4, c = new Float32Array(n), tk = Math.tanh(k);
  for (let i = 0; i < n; i++){ const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / tk; }
  return (SAT = c);
}
function noiseBuffer(ctx){   // 2 s, two independent channels (wide when used in stereo, mono when summed)
  const sr = ctx.sampleRate, n = Math.round(2 * sr), b = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++){ const d = b.getChannelData(ch), r = rng(911 + ch * 7); for (let i = 0; i < n; i++) d[i] = r() * 2 - 1; }
  return b;
}
/* stereo decaying noise that darkens as it decays (a one-pole lowpass closing from f0 to f1), with a predelay */
function impulseBuffer(ctx, secs, tau, f0, f1, pre, seed){
  const sr = ctx.sampleRate, len = Math.round(secs * sr), p0 = Math.round(pre * sr), b = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++){
    const r = rng(seed + ch * 101), d = b.getChannelData(ch);
    let y = 0, y2 = 0, e2 = 0;
    for (let i = p0; i < len; i++){
      const t = (i - p0) / sr, a = Math.exp(-TAU * (f1 + (f0 - f1) * Math.exp(-t / (tau * 0.6))) / sr);
      y = (r() * 2 - 1) * (1 - a) + a * y; y2 = y * (1 - a) + a * y2;   // two poles: a smoother darkening
      const v = y2 * Math.exp(-t / tau) * Math.min(1, t / 0.01) * (len - i < 2000 ? (len - i) / 2000 : 1);
      d[i] = v; e2 += v * v;
    }
    const g = 0.6 / Math.sqrt(e2 || 1); for (let i = 0; i < len; i++) d[i] *= g;   // fixed energy: the wet level is the send's
  }
  return b;
}
/* the shared reverbs, made on the first effect: room (1.3 s, bright-ish) and hall (3.6 s, dark), returns into the bus */
function sfxVerbs(E){
  if (E.vb) return E.vb;
  const ctx = E.ctx, mk = (ir, lo, hi, g) => {
    const c = ctx.createConvolver(); c.normalize = false; c.buffer = ir;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = lo;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = hi; lp.Q.value = 0.5;
    const r = ctx.createGain(); r.gain.value = g;
    c.connect(hp); hp.connect(lp); lp.connect(r); r.connect(E.verbOut); return c;
  };
  E.verbOut = ctx.createGain(); E.verbOut.connect(E.sfxBus);
  return (E.vb = {
    room: mk(impulseBuffer(ctx, 1.1, 0.2, 7000, 1800, 0.012, 515), 150, 7000, 0.9),
    hall: mk(impulseBuffer(ctx, 3.6, 0.85, 3200, 380, 0.025, 777), 45, 3500, 1),
  });
}

/* one effect's worth of nodes */
function Voice(E, t){
  const ctx = E.ctx, vb = sfxVerbs(E);
  this.E = E; this.ctx = ctx; this.t = t; this.end = t; this.srcs = []; this.dead = false;
  this.out = ctx.createGain(); this.out.connect(E.sfxBus);
  this.rs = ctx.createGain(); this.rs.connect(vb.room);   // this voice's sends (cut with it)
  this.hs = ctx.createGain(); this.hs.connect(vb.hall);
  this.nodes = [this.out, this.rs, this.hs];
}
Voice.prototype = {
  keep(n){ this.nodes.push(n); return n; },
  gain(v){ const g = this.keep(this.ctx.createGain()); g.gain.value = v == null ? 1 : v; return g; },
  mono(v){ const g = this.gain(v); g.channelCount = 1; g.channelCountMode = 'explicit'; return g; },
  filter(type, f, Q, gdb){ const b = this.keep(this.ctx.createBiquadFilter()); b.type = type; b.frequency.value = f; b.Q.value = Q == null ? 0.707 : Q; if (gdb) b.gain.value = gdb; return b; },
  sat(drive, post){   // drive into the shared tanh curve
    const pre = this.gain(drive || 1), ws = this.keep(this.ctx.createWaveShaper()), o = this.gain(post == null ? 0.7 : post);
    ws.curve = satCurve(); ws.oversample = '4x'; pre.connect(ws); ws.connect(o); return [pre, o];
  },
  pan(p){ if (!this.ctx.createStereoPanner) return this.gain(1); const s = this.keep(this.ctx.createStereoPanner()); s.pan.value = clamp(p || 0, -1, 1); return s; },
  /* Haas: a mono signal to both sides, one side ms later (side -1 delays the left) */
  wide(ms, side){
    const i = this.mono(1), d = this.keep(this.ctx.createDelay(0.05)), m = this.keep(this.ctx.createChannelMerger(2));
    d.delayTime.value = ms / 1000; const late = side < 0 ? 0 : 1;
    i.connect(m, 0, 1 - late); i.connect(d); d.connect(m, 0, late); return [i, m];
  },
  send(n, room, hall){ const o = Array.isArray(n) ? n[1] : n; if (room){ const g = this.gain(room); o.connect(g); g.connect(this.rs); } if (hall){ const g = this.gain(hall); o.connect(g); g.connect(this.hs); } },
  src(node, t0, t1){ node.start(t0); node.stop(t1); this.srcs.push(node); this.keep(node); if (t1 > this.end) this.end = t1; return node; },
  osc(type, f, t0, t1){ const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f; return this.src(o, t0, t1); },
  noise(t0, t1, rate){
    const s = this.ctx.createBufferSource(), b = this.E.noiseBuf || (this.E.noiseBuf = noiseBuffer(this.ctx));
    s.buffer = b; s.loop = true; s.playbackRate.value = rate || 1;
    s.start(t0, Math.random() * (b.duration - 0.1)); s.stop(t1); this.srcs.push(s); this.keep(s); if (t1 > this.end) this.end = t1; return s;
  },
  buf(b, t0, rate){ const s = this.ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate || 1; return this.src(s, t0, t0 + b.duration / (rate || 1) + 0.01); },
  /* a -> b -> c ...; arrays are [in, out] pairs; returns the last node */
  chain(...ns){ for (let i = 0; i < ns.length - 1; i++){ const a = ns[i], b = ns[i + 1]; (Array.isArray(a) ? a[1] : a).connect(Array.isArray(b) ? b[0] : b); } return ns[ns.length - 1]; },
  /* attack/decay on a gain param: exponential both ways (never a click), returns the time it is silent */
  ad(p, t0, att, peak, dec){ p.setValueAtTime(0.0001, t0); p.exponentialRampToValueAtTime(peak, t0 + att); p.exponentialRampToValueAtTime(0.0001, t0 + att + dec); p.setValueAtTime(0, t0 + att + dec + 0.001); return t0 + att + dec + 0.002; },
  /* a gain with an ad envelope */
  env(t0, att, peak, dec){ const g = this.gain(0); this.ad(g.gain, t0, att, peak, dec); return g; },
  /* a smooth swell: rises as x^a to the peak at fraction pk of d, falls as (1-x)^b */
  swell(p, t0, d, pk, peak, a, b){
    const n = 64, c = new Float32Array(n);
    for (let i = 0; i < n; i++){ const x = i / (n - 1); c[i] = peak * (x < pk ? Math.pow(x / pk, a) : Math.pow((1 - x) / (1 - pk), b)); }
    c[n - 1] = 0; p.setValueCurveAtTime(c, t0, d);
  },
  kill(fade, at){
    if (this.dead) return; this.dead = true;
    const now = Math.max(this.ctx.currentTime, at || 0);
    for (const g of [this.out.gain, this.rs.gain, this.hs.gain]) try { g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(0, now + fade); } catch (e){}
    for (const s of this.srcs) try { s.stop(now + fade + 0.005); } catch (e){}
    this.end = Math.min(this.end, now + fade + 0.01);
    clearTimeout(this.timer); this.timer = 0; this.cleanup();
  },
  cleanup(){
    if (this.E.offline || this.timer || !this.nodes.length) return;
    const tick = () => {
      const left = this.end - this.ctx.currentTime;
      if (left > 0){ this.timer = setTimeout(tick, left * 1000 + 80); return; }
      for (const n of this.nodes) try { n.disconnect(); } catch (e){}
      this.nodes.length = this.srcs.length = 0; this.dead = true;
      const V = this.E.sfxVoices, i = V.indexOf(this); if (i >= 0) V.splice(i, 1);
    };
    this.timer = setTimeout(tick, Math.max(0, this.end - this.ctx.currentTime) * 1000 + 80);
  },
  /* a pitch-dropping sine: f0 -> f1 over drop seconds */
  dive(type, f0, f1, drop, t0, t1){ const o = this.osc(type, f0, t0, t1); o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(f1, t0 + drop); return o; },
  /* a filtered noise burst: noise -> filters -> ad envelope; returns the envelope gain (route it on) */
  burst(t0, att, peak, dec, ...flt){ const e = this.env(t0, att, peak, dec), n = this.noise(t0, t0 + att + dec + 0.02); this.chain(n, ...flt, e); return e; },
};
/* zap gate patterns: a fixed few, rotated, so a run of zaps varies without sounding random */
const ZAPS = [
  { dur: 0.15, f: 3200, hum: 120, mod: 240, pew: 0, seed: 11 },
  { dur: 0.19, f: 2400, hum: 120, mod: 360, pew: 0, seed: 23 },
  { dur: 0.13, f: 4200, hum: 180, mod: 240, pew: 1, seed: 37 },
];
for (const z of ZAPS){   // on/off segments of 2-9 ms, sparser toward the end
  const r = rng(z.seed), g = []; let x = 0, on = 1;
  while (x < z.dur){ const len = (on ? 0.002 + r() * 0.006 : 0.002 + r() * 0.009 * (0.5 + x / z.dur)); g.push([x, on ? 0.45 + r() * 0.55 : 0.04]); x += len; on ^= 1; }
  z.gate = g;
}

const SFX = {
  /* CRT power-on: the switch's double click and a saturated thunk; the degauss coil's "bwong" (two detuned 60 Hz saws
     through a resonant lowpass, wobbling, plus the coil's ring); static crackling as the tube charges (sparse clicks
     of high noise) with a fizz swelling under it; the flyback whine rising into place (with a faint 15.7 kHz); the
     drive spinning up if its sound is already built. */
  boot(v, t){
    v.out.gain.value = 0.75;
    for (const [dt, pk] of [[0, 0.6], [0.011, 0.35]]){
      const c = v.burst(t + dt, 0.0003, pk, 0.006, v.mono(), v.filter('bandpass', 2600, 1.2)); v.chain(c, v.wide(0.3, 1), v.out); v.send(c, 0.5);
    }
    const th = v.dive('sine', 110, 46, 0.1, t, t + 0.4), thg = v.env(t, 0.002, 0.85, 0.28), ths = v.sat(2);
    v.chain(th, thg, ths, v.filter('lowpass', 1400, 0.7), v.out); v.send(ths, 0.25);
    /* degauss */
    const dg = t + 0.05, lp = v.filter('lowpass', 680, 4), wob = v.gain(0.7), am = v.osc('sine', 7, dg, dg + 1.3), amd = v.gain(0.3);
    am.connect(amd); amd.connect(wob.gain);
    for (const [f, p] of [[60, -0.35], [60.45, 0.35]]){ const s = v.osc('sawtooth', f, dg, dg + 1.3); v.chain(s, v.pan(p), lp); }
    const de = v.env(dg, 0.02, 0.32, 1.1); v.chain(lp, wob, de, v.out); v.send(de, 0.35);
    const ring = v.dive('sine', 190, 150, 0.6, dg, dg + 0.9), rg = v.env(dg, 0.006, 0.12, 0.7); v.chain(ring, rg, v.out); v.send(rg, 0.4);
    /* static crackle: random clicks of high noise, thinning out */
    const cg = v.gain(0), cn = v.noise(t + 0.12, t + 1.9);
    cg.gain.setValueAtTime(0, t);
    for (let x = t + 0.15; x < t + 1.8; x += 0.008 + Math.random() * 0.05 * (1 + (x - t) * 1.5)){
      const a = (0.25 + Math.random() * 0.75) * (1 - (x - t) / 2.1);
      cg.gain.setValueAtTime(a, x); cg.gain.setValueAtTime(0, x + 0.0008 + Math.random() * 0.002);
    }
    v.chain(cn, v.filter('highpass', 2500, 0.7), v.filter('peaking', 5000, 1, 4), cg, v.gain(0.55), v.out); v.send(cg, 0.3);
    const fz = v.gain(0); fz.gain.setValueAtTime(0.0001, t + 0.1); fz.gain.exponentialRampToValueAtTime(0.06, t + 0.9); fz.gain.exponentialRampToValueAtTime(0.0001, t + 2.1);
    v.chain(v.noise(t + 0.1, t + 2.15), v.filter('bandpass', 7500, 0.9), fz, v.out);
    /* flyback whine */
    const w = v.osc('triangle', 2400, t + 0.1, t + 2.3), vib = v.osc('sine', 5.5, t + 0.1, t + 2.3), vd = v.gain(9);
    w.frequency.setValueAtTime(2400, t + 0.1); w.frequency.exponentialRampToValueAtTime(7867, t + 0.95); vib.connect(vd); vd.connect(w.frequency);
    const wg = v.gain(0); wg.gain.setValueAtTime(0.0001, t + 0.1); wg.gain.exponentialRampToValueAtTime(0.022, t + 0.7); wg.gain.setValueAtTime(0.022, t + 1.1); wg.gain.exponentialRampToValueAtTime(0.0001, t + 2.25);
    v.chain(w, v.filter('lowpass', 9000, 0.7), wg, v.pan(0.15), v.out);
    const h = v.osc('sine', 15734, t + 0.4, t + 2.3), hg = v.gain(0); hg.gain.setValueAtTime(0.0001, t + 0.4); hg.gain.exponentialRampToValueAtTime(0.008, t + 1.1); hg.gain.exponentialRampToValueAtTime(0.0001, t + 2.25); v.chain(h, hg, v.out);
    const d = v.E.cached('disk'); if (d){ v.chain(v.buf(d[Math.floor(Math.random() * d.length)], t + 0.4), v.filter('highpass', 150), v.gain(0.14), v.pan(0.3), v.out); }
  },
  /* one tube switching on: the relay's double tick, a saturated "thup" with a puff of air, a short degauss hum, a spark
     of static, a faint whine; opts.i picks the pitch and the place across the wall (pan) */
  tubeOn(v, t, o){
    const i = o.i | 0, k = [1, 1.12, 0.94, 1.06, 0.89, 1.19, 1.03, 1.09, 0.97][((i % 9) + 9) % 9], p = ((((i * 4) % 9) + 9) % 9) / 8 * 1.1 - 0.55;
    v.out.gain.value = 0.7;
    const bus = v.pan(p);
    v.chain(v.osc('sine', 1650 * k, t, t + 0.08), v.env(t, 0.001, 0.13, 0.05), bus);   // the glass's ping
    bus.connect(v.out); v.send(bus, 0.3);
    for (const [dt, pk] of [[0, 0.8], [0.007, 0.45]]) v.chain(v.burst(t + dt, 0.0003, pk, 0.006, v.mono(), v.filter('bandpass', 3400 * k, 1.4)), bus);
    const s = v.dive('sine', 96 * k, 48 * k, 0.07, t, t + 0.3); v.chain(s, v.env(t, 0.002, 0.75, 0.17), v.sat(1.8), v.filter('lowpass', 1000, 0.7), bus);
    v.chain(v.burst(t, 0.003, 0.35, 0.08, v.mono(), v.filter('lowpass', 700 * k, 0.8)), bus);
    const lp = v.filter('lowpass', 560 * k, 3); v.osc('sawtooth', 60, t + 0.01, t + 0.4).connect(lp); v.osc('sawtooth', 60.6, t + 0.01, t + 0.4).connect(lp);
    v.chain(lp, v.env(t + 0.01, 0.01, 0.14, 0.28), bus);
    const sp = v.burst(t + 0.004, 0.002, 0.25, 0.08, v.filter('highpass', 5200 * k, 0.7)); sp.connect(v.out);
    const w = v.osc('sine', 6900 + 330 * (((i * 5) % 7 + 7) % 7), t + 0.02, t + 0.7), wg = v.gain(0);
    wg.gain.setValueAtTime(0.0001, t + 0.02); wg.gain.exponentialRampToValueAtTime(0.012, t + 0.12); wg.gain.exponentialRampToValueAtTime(0.0001, t + 0.68); v.chain(w, wg, bus);
  },
  /* camera move: stereo noise in three bands (air sweeping up and back, a low body, a little sheen at the peak) under
     one smooth swell, carried across by the pan */
  whoosh(v, t, o){
    const d = clamp(+o.dur || 0.8, 0.15, 4), dir = o.dir < 0 ? -1 : o.dir > 0 ? 1 : 0, pk = t + 0.6 * d, e = t + d;
    v.out.gain.value = 1.1;
    const env = v.gain(0); v.swell(env.gain, t, d, 0.6, 1, 2.2, 1.5);
    const p = v.pan(0); if (dir && p.pan){ const c = new Float32Array(32); for (let j = 0; j < 32; j++) c[j] = 0.8 * dir * Math.tanh(3 * (j / 31 - 0.6)) / Math.tanh(1.8); p.pan.setValueCurveAtTime(c, t, d); }
    const bp = v.filter('bandpass', 300, 1.1); bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(2600, pk); bp.frequency.exponentialRampToValueAtTime(600, e);
    const lp = v.filter('lowpass', 180, 0.8); lp.frequency.setValueAtTime(180, t); lp.frequency.exponentialRampToValueAtTime(900, pk); lp.frequency.exponentialRampToValueAtTime(220, e);
    v.chain(v.noise(t, e + 0.02, 0.9), bp, v.gain(0.9), env); v.chain(v.noise(t, e + 0.02, 0.5), lp, v.gain(0.6), env);
    v.chain(v.noise(t, e + 0.02), v.filter('highpass', 4500, 0.7), v.gain(0.1), env);
    v.chain(env, p, v.out); v.send(env, 0.25);
  },
  /* whip pan: a fast, bright rip across with a snap at its peak */
  whip(v, t, o){
    const d = clamp(+o.dur || 0.22, 0.08, 1), dir = o.dir < 0 ? -1 : 1, pk = t + 0.45 * d, e = t + d;
    v.out.gain.value = 1;
    const env = v.gain(0); v.swell(env.gain, t, d, 0.45, 1, 2.6, 1.3);
    const p = v.pan(-0.85 * dir); if (p.pan){ p.pan.setValueAtTime(-0.85 * dir, t); p.pan.linearRampToValueAtTime(0.85 * dir, e); }
    const bp = v.filter('bandpass', 1500, 1.5); bp.frequency.setValueAtTime(1500, t); bp.frequency.exponentialRampToValueAtTime(7500, pk); bp.frequency.exponentialRampToValueAtTime(2800, e);
    const lp = v.filter('lowpass', 500, 0.7); lp.frequency.setValueAtTime(500, t); lp.frequency.exponentialRampToValueAtTime(1600, pk); lp.frequency.exponentialRampToValueAtTime(400, e);
    v.chain(v.noise(t, e + 0.02), v.filter('highpass', 900), bp, env); v.chain(v.noise(t, e + 0.02, 0.6), lp, v.gain(0.45), env);
    v.chain(env, p, v.out); v.send(env, 0.2);
    const sn = v.burst(pk - 0.004, 0.0005, 0.3, 0.014, v.mono(), v.filter('bandpass', 4200, 1)); v.chain(sn, v.wide(0.5, dir), v.out);
  },
  /* electric glitch on a cut: a high-voltage arc. A sharp transient; band-limited noise crackling through a fast gate;
     a mains buzz (a 120 Hz sine frequency-modulated at 240/360 Hz, saturated) chopped by the same gate; a short low
     snap; on one variant a quick pitch-dive. Three variants rotate (opts.v picks one). */
  zap(v, t, o){
    const z = ZAPS[(o.v != null ? o.v | 0 : (v.E.zapN = ((v.E.zapN | 0) + 1) % ZAPS.length)) % ZAPS.length], e = t + z.dur;
    v.out.gain.value = 1.25;
    const gate = v.gain(0); for (const [x, a] of z.gate) gate.gain.setValueAtTime(a, t + x); gate.gain.setValueAtTime(0, e);
    const env = v.gain(0); env.gain.setValueAtTime(0.0001, t); env.gain.exponentialRampToValueAtTime(1, t + 0.002); env.gain.setValueAtTime(1, t + z.dur * 0.35); env.gain.exponentialRampToValueAtTime(0.0001, e);
    gate.connect(env); env.connect(v.out); v.send(env, 0.3);
    /* the transient */
    const tr = v.burst(t, 0.0002, 0.9, 0.004, v.mono(), v.filter('highpass', 1500, 0.7)); v.chain(tr, v.wide(0.4, 1), v.out);
    /* crackle */
    v.chain(v.noise(t, e + 0.01), v.filter('highpass', 900), v.filter('bandpass', z.f, 0.9), v.gain(0.75), gate);
    v.chain(v.noise(t, e + 0.01, 1.3), v.filter('highpass', 6000), v.gain(0.25), gate);
    /* the buzz: FM around the mains harmonics */
    const c = v.osc('sine', z.hum, t, e + 0.01), m = v.osc('sine', z.mod, t, e + 0.01), mi = v.gain(z.hum * 3.5);
    mi.gain.setValueAtTime(z.hum * 3.5, t); mi.gain.exponentialRampToValueAtTime(z.hum * 1.2, e); m.connect(mi); mi.connect(c.frequency);
    const bz = v.chain(c, v.sat(3, 0.5), v.filter('bandpass', 1100, 0.6)); v.chain(bz, v.gain(0.6), gate); v.chain(bz, v.gain(0.12), env);
    /* weight */
    v.chain(v.dive('sine', 140, 55, 0.04, t, t + 0.12), v.env(t, 0.001, 0.4, 0.06), v.sat(1.5), v.out);
    if (z.pew){ const pw = v.dive('sine', 2200, 380, 0.06, t + 0.01, t + 0.1); v.chain(pw, v.env(t + 0.01, 0.001, 0.12, 0.07), v.out); }
  },
  /* a small hit: a crisp click, a short ping with a slight drop, a low knock; opts.pitch scales it */
  tick(v, t, o){
    const k = clamp(+o.pitch || 1, 0.25, 4);
    v.out.gain.value = 0.9;
    v.chain(v.burst(t, 0.0003, 0.3, 0.006, v.mono(), v.filter('highpass', 3000)), v.wide(0.4, 1), v.out);
    const a = v.dive('sine', 1500 * k, 1150 * k, 0.03, t, t + 0.08), ag = v.env(t, 0.001, 0.32, 0.05); v.chain(a, ag, v.out); v.send(ag, 0.12);
    v.chain(v.osc('sine', 3020 * k, t, t + 0.04), v.env(t, 0.0005, 0.1, 0.025), v.out);
    v.chain(v.dive('sine', 220 * k, 150 * k, 0.03, t, t + 0.06), v.env(t, 0.001, 0.45, 0.04), v.out);
  },
  /* rising tension up to the hit at t + dur: stereo noise through a rising, narrowing bandpass; three detuned saws
     (left, centre, right) gliding up two octaves through an opening resonant lowpass; a saturated sub rising under them;
     a tremolo speeding into a stutter; all swell and cut dead at the hit, leaving only the room's ring */
  riser(v, t, o){
    const d = clamp(+o.dur || 1.5, 0.2, 8), e = t + d;
    v.out.gain.value = 0.95;
    const env = v.gain(0); env.gain.setValueAtTime(0.0001, t); env.gain.exponentialRampToValueAtTime(1, e - 0.005); env.gain.linearRampToValueAtTime(0, e + 0.004);
    env.connect(v.out); v.send(env, 0.35);
    const trem = v.gain(0.55), lfo = v.osc('sine', 4, t, e + 0.01), depth = v.gain(0.2);
    lfo.frequency.setValueAtTime(4, t); lfo.frequency.exponentialRampToValueAtTime(26, e); depth.gain.setValueAtTime(0.15, t); depth.gain.linearRampToValueAtTime(0.45, e);
    lfo.connect(depth); depth.connect(trem.gain); trem.connect(env);
    const bp = v.filter('bandpass', 400, 0.7); bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(7500, e); bp.Q.setValueAtTime(0.7, t); bp.Q.linearRampToValueAtTime(4, e);
    v.chain(v.noise(t, e + 0.01), bp, v.gain(0.5), trem);
    const lp = v.filter('lowpass', 300, 3); lp.frequency.setValueAtTime(300, t); lp.frequency.exponentialRampToValueAtTime(7000, e);
    for (const [dt, p] of [[-14, -0.6], [0, 0], [14, 0.6]]){ const s = v.dive('sawtooth', 110, 440, d, t, e + 0.01); s.detune.value = dt; v.chain(s, v.pan(p), lp); }
    v.chain(lp, v.gain(0.13), trem);
    v.chain(v.dive('sine', 40, 95, d, t, e + 0.01), v.sat(2.2, 0.5), v.filter('lowpass', 500), v.gain(0.5), env);
  },
  /* the impact frame. Transient: a broadband click and a crack (bandpassed stereo noise; big adds a high sizzle of
     debris). Body: a punch of low noise and a pitch-dropping sine, driven into the saturator (its harmonics are what
     small speakers play) under a clean copy for the true sub. Tail: the room (big: a dark rumble and the long hall).
     opts.lead (s): start a reversed swell that far ahead and land the hit after it (default 0: the hit is now). */
  impact(v, t, o){
    const big = !!o.big, lead = clamp(+o.lead || 0, 0, 2), h = t + lead;
    v.out.gain.value = big ? 0.95 : 0.75;
    if (lead > 0.05){
      const sw = v.gain(0); sw.gain.setValueAtTime(0.0001, t); sw.gain.exponentialRampToValueAtTime(0.7, h - 0.004); sw.gain.linearRampToValueAtTime(0, h + 0.002);
      const bp = v.filter('bandpass', 400, 1); bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(3500, h);
      v.chain(v.noise(t, h + 0.01, 0.8), bp, sw, v.out);
    }
    v.chain(v.burst(h, 0.0002, big ? 0.9 : 0.7, 0.005, v.mono(), v.filter('highpass', 1800)), v.wide(0.3, 1), v.out);
    const cr = v.burst(h, 0.0005, big ? 1.4 : 1.2, big ? 0.08 : 0.05, v.filter('highpass', 900), v.filter('bandpass', big ? 2200 : 2800, 0.6));
    cr.connect(v.out); v.send(cr, big ? 0.4 : 0.45, big ? 0.6 : 0);
    { const sm = v.burst(h, 0.001, big ? 1 : 0.6, big ? 0.12 : 0.06, v.mono(), v.filter('bandpass', 1100, 0.9)); sm.connect(v.out); v.send(sm, 0.2, big ? 0.5 : 0); }   // the smack: mids a laptop plays
    if (big){ const db = v.burst(h + 0.005, 0.002, 0.3, 0.25, v.filter('highpass', 6000)); db.connect(v.out); v.send(db, 0.2, 0.4); }
    const pu = v.burst(h, 0.001, big ? 0.85 : 0.8, big ? 0.16 : 0.09, v.mono(), v.filter('lowpass', 750, 0.9)); pu.connect(v.out); v.send(pu, 0.2, big ? 0.5 : 0);
    const f0 = big ? 100 : 160, f1 = big ? 28 : 48, dec = big ? 2.2 : 0.38;
    const s = v.dive('sine', f0, f1, big ? 0.7 : 0.13, h, h + dec + 0.05), sg = v.env(h, 0.002, 1, dec);
    const sat = v.sat(big ? 3.2 : 2.6, big ? 0.7 : 0.8);
    s.connect(sg); v.chain(sg, sat, v.filter('lowpass', big ? 1600 : 2200, 0.7), v.out); v.chain(sg, v.gain(big ? 0.6 : 0.45), v.out);
    v.send(sat, big ? 0.1 : 0.15, big ? 0.35 : 0);
    if (big){ const rb = v.gain(0); v.ad(rb.gain, h + 0.01, 0.05, 0.6, 2.6); v.chain(v.noise(h, h + 2.8, 0.3), v.filter('lowpass', 150, 0.7), rb, v.out); v.send(rb, 0, 0.3); }
  },
  /* hit-stop freeze: a dark drone and its hiss slowing to a halt like stopped tape (every layer's pitch falling at the
     same linear rate, so it reads as one recording decelerating), then the brake's clunk */
  tapeStop(v, t, o){
    const d = clamp(+o.dur || 0.45, 0.1, 3), e = t + d;
    v.out.gain.value = 0.55;
    const env = v.gain(0); env.gain.setValueAtTime(0.0001, t); env.gain.exponentialRampToValueAtTime(1, t + 0.006); env.gain.setValueAtTime(1, t + 0.5 * d); env.gain.exponentialRampToValueAtTime(0.0001, e);
    const lp = v.filter('lowpass', 2600, 0.8);
    for (const [f, p] of [[110, -0.4], [110.5, 0.4], [164.8, -0.2], [220.3, 0.2], [261.6, 0], [329.6, 0.3]]){
      const s = v.osc('sawtooth', f, t, e + 0.01); s.frequency.setValueAtTime(f, t); s.frequency.linearRampToValueAtTime(f * 0.03, e); v.chain(s, v.pan(p), lp);
    }
    v.chain(lp, v.filter('highpass', 50), v.gain(0.13), env);
    const n = v.noise(t, e + 0.01); n.playbackRate.setValueAtTime(1, t); n.playbackRate.linearRampToValueAtTime(0.03, e);
    v.chain(n, v.filter('bandpass', 1800, 0.6), v.gain(0.3), env); env.connect(v.out); v.send(env, 0.2);
    const k = v.dive('sine', 95, 50, 0.04, e - 0.006, e + 0.12); v.chain(k, v.env(e - 0.006, 0.002, 0.45, 0.08), v.sat(1.6), v.out);
    v.chain(v.burst(e - 0.006, 0.0004, 0.25, 0.01, v.mono(), v.filter('bandpass', 1500, 1)), v.out);
  },
  /* a word or letter slamming down: the Enter key's Topre recording pitched down with its thock lifted (a 250 Hz bell),
     a low saturated thump, a mid puff, a click; big (a whole word) goes lower and heavier with a crack and more room */
  type(v, t, o){
    const i = o.i | 0, big = !!o.big, k = (1 + 0.03 * ((((i * 5) % 7) + 7) % 7 - 3)) * (big ? 0.86 : 1);
    v.out.gain.value = big ? 1 : 0.95;
    if (keyBufs && keyBufs.heavy){
      const L = keyBufs.heavy.d, kb = v.chain(v.buf(L[Math.floor(Math.random() * L.length)], t, 0.8 * k), v.filter('highpass', 70), v.filter('peaking', 250 * k, 1.2, 5), v.filter('lowpass', 7000, 0.6), v.gain(1.5));
      kb.connect(v.out); v.send(kb, 0.2);
    }
    const s = v.dive('sine', 150 * k, 52 * k, big ? 0.09 : 0.06, t, t + 0.35);
    v.chain(s, v.env(t, 0.001, big ? 0.9 : 0.7, big ? 0.24 : 0.13), v.sat(big ? 2.2 : 1.6), v.filter('lowpass', 1500, 0.7), v.out);
    v.chain(v.burst(t, 0.001, 0.35, 0.03, v.mono(), v.filter('bandpass', 650 * k, 1)), v.out);
    v.chain(v.burst(t, 0.0003, 0.3, 0.005, v.mono(), v.filter('highpass', 4000)), v.wide(0.35, 1), v.out);
    if (big){ const cr = v.burst(t, 0.0005, 0.45, 0.04, v.filter('bandpass', 2500, 0.8)); cr.connect(v.out); v.send(cr, 0.45); }
  },
};
Engine.prototype.cached = function (name){ return this.fxCache[name] || null; };
Engine.prototype.sfx = function (name, opts, when){
  const V = this.sfxVoices, now = this.ctx.currentTime;
  if (name === 'stopAll'){
    for (const v of V.splice(0)) v.kill(0.012);
    /* the shared reverbs hold the tails: duck their return; it comes back with the next effect (not before 0.4 s) */
    if (this.verbOut){ const g = this.verbOut.gain; g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(0, now + 0.012); this.ducked = now + 0.4; }
    return;
  }
  const fn = SFX[name]; if (!fn) return;
  if (this.ducked){ const g = this.verbOut.gain, at = Math.max(now, this.ducked); g.cancelScheduledValues(now); g.setValueAtTime(0, at); g.linearRampToValueAtTime(1, at + 0.05); this.ducked = 0; }
  const at = Math.max(when, now);
  for (let i = V.length - 1; i >= 0; i--) if (V[i].dead || V[i].end < at) V.splice(i, 1);
  while (V.length >= SFX_MAX) V.shift().kill(0.015, at);   // polyphony: the oldest makes room (as this one starts)
  const v = new Voice(this, at);
  fn(v, v.t, opts || {});
  V.push(v); v.cleanup();
  return v;
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

const ENV0 = Object.freeze({ kick: 0, snare: 0, bar: 0, drop: 0, step: 0, barN: 0, part: -1 });
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
  /* the intro's sound effects (see SFX): a no-op until unlocked by a gesture, while muted, or without Web Audio;
     nothing is queued. sfx('stopAll') (or stopAll()) fades out everything playing within ~20 ms. */
  sfx(name, opts){
    if (name === 'stopAll') return sound.stopAll();
    if (!ready()) return;
    try { eng.sfx(String(name), opts, eng.ctx.currentTime + 0.005); } catch (e){}
  },
  stopAll(){ if (eng) try { eng.sfx('stopAll'); } catch (e){} },
  /* the intro's tune is gone (the intro is scored with sfx()); a silent stand-in so an older caller stays harmless */
  music: { start(){}, stop(){}, ping(){}, alive(){ return false; }, time(){ return -1; }, level(){ return 0; },
    render(){ return Promise.resolve(null); }, env(){ return ENV0; }, playing: false, BPM: 120, BAR: 2, INTRO: 7 },
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

/* test hooks (?debug only): the live context's sfx bus for an AnalyserNode, and an offline render of one effect through
   a fresh engine (the whole chain, master included) */
if (/[?&]debug\b/.test(location.search)) sound._dbg = {
  eng: () => eng,
  render(name, opts, secs){
    const O = window.OfflineAudioContext || window.webkitOfflineAudioContext, sr = 48000;
    const ctx = new O(2, Math.round(((secs || 3) + 0.3) * sr), sr), E = new Engine(ctx);
    if (opts && opts._dry){ sfxVerbs(E); E.verbOut.gain.value = 0; }
    if (opts && opts._bus){ E.out.disconnect(); E.sfxBus.connect(ctx.destination); }   // the bus itself, before any dynamics
    for (const [n, o, at] of Array.isArray(name) ? name : [[name, opts, 0]]){
      if (n === 'stopAll') ctx.suspend(0.3 + at).then(() => { E.sfx('stopAll'); ctx.resume(); });   // (a stop needs the clock there)
      else E.sfx(n, o, 0.3 + (at || 0));   // (0.3 s in: the compressors settle from their initial state first)
    }
    return ctx.startRendering();
  },
};

M.sound = sound;
})();
