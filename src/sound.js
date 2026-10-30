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

  /* sfx bus (the intro's effects): its own glue compressor and a limiter, then the master (mute, master limiter) */
  E.offline = !!(window.OfflineAudioContext && ctx instanceof window.OfflineAudioContext);
  E.sfxBus = ctx.createGain(); E.sfxBus.gain.value = 0.9;
  const sGlue = ctx.createDynamicsCompressor();
  sGlue.threshold.value = -16; sGlue.knee.value = 8; sGlue.ratio.value = 4; sGlue.attack.value = 0.002; sGlue.release.value = 0.12;
  const sLim = ctx.createDynamicsCompressor();
  sLim.threshold.value = -4; sLim.knee.value = 0; sLim.ratio.value = 20; sLim.attack.value = 0.001; sLim.release.value = 0.06;
  E.sfxOut = ctx.createGain(); E.sfxOut.gain.value = 0.85;
  E.sfxBus.connect(sGlue); sGlue.connect(sLim); sLim.connect(E.sfxOut); E.sfxOut.connect(E.master);
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
   Built live from Web Audio nodes (oscillators, one shared noise buffer, filters, a tanh saturator, a convolver for the
   impact's tail), so every call can take its own duration, pan and pitch. Each call is a voice: its nodes feed one
   gain, that gain feeds the sfx bus (its own compressor and limiter, then the master, so mute and the master limiter
   apply). At most SFX_MAX voices; a new one fades out the oldest. A voice's nodes are disconnected when it ends.
   The noise buffer, the impulse response and the saturation curve are made once, on first use. */
const SFX_MAX = 8;
let SAT = null;
function satCurve(){
  if (SAT) return SAT;
  const n = 1024, k = 2.4, c = new Float32Array(n), tk = Math.tanh(k);
  for (let i = 0; i < n; i++){ const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / tk; }
  return (SAT = c);
}
function noiseBuffer(ctx){
  const sr = ctx.sampleRate, n = Math.round(2 * sr), b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0), r = rng(911);
  for (let i = 0; i < n; i++) d[i] = r() * 2 - 1;
  return b;
}
/* the impact's room: stereo decaying noise that darkens as it decays (a one-pole lowpass closing), 8 ms predelay */
function impulseBuffer(ctx){
  const sr = ctx.sampleRate, len = Math.round(1.6 * sr), pre = Math.round(0.008 * sr), b = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++){
    const r = rng(4242 + ch * 101), d = b.getChannelData(ch);
    let y = 0, e2 = 0;
    for (let i = pre; i < len; i++){
      const t = (i - pre) / sr, a = Math.exp(-TAU * (900 + 7000 * Math.exp(-t / 0.18)) / sr);
      y = (r() * 2 - 1) * (1 - a) + a * y;
      const v = y * Math.exp(-t / 0.32) * Math.min(1, t / 0.006) * (len - i < 600 ? (len - i) / 600 : 1);
      d[i] = v; e2 += v * v;
    }
    const g = 0.5 / Math.sqrt(e2 || 1); for (let i = 0; i < len; i++) d[i] *= g;   // unit-ish energy: the wet level is the send's
  }
  return b;
}

/* one effect's worth of nodes */
function Voice(E, t){
  const ctx = E.ctx;
  this.E = E; this.ctx = ctx; this.t = t; this.end = t; this.srcs = []; this.dead = false;
  this.out = ctx.createGain(); this.out.connect(E.sfxBus); this.nodes = [this.out];
}
Voice.prototype = {
  keep(n){ this.nodes.push(n); return n; },
  gain(v){ const g = this.keep(this.ctx.createGain()); g.gain.value = v == null ? 1 : v; return g; },
  filter(type, f, Q){ const b = this.keep(this.ctx.createBiquadFilter()); b.type = type; b.frequency.value = f; b.Q.value = Q == null ? 0.707 : Q; return b; },
  sat(drive){   // drive into the shared tanh curve, then back down so its level stays about the same
    const pre = this.gain(drive || 1), ws = this.keep(this.ctx.createWaveShaper()), post = this.gain(0.75);
    ws.curve = satCurve(); ws.oversample = '2x'; pre.connect(ws); ws.connect(post); return [pre, post];
  },
  pan(p){ if (!this.ctx.createStereoPanner) return this.gain(1); const s = this.keep(this.ctx.createStereoPanner()); s.pan.value = clamp(p || 0, -1, 1); return s; },
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
  tail(t){ if (t > this.end) this.end = t; },
  kill(fade){
    if (this.dead) return; this.dead = true;
    const now = this.ctx.currentTime, g = this.out.gain;
    try { g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(0, now + fade); } catch (e){}
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
};

const SFX = {
  /* CRT power-on: the relay's click and a saturated thunk, the tube's static "fwump", a whine rising to the flyback's
     pitch and settling (plus a faint 15.7 kHz), the drive spinning up if its sound is already built */
  boot(v, t){
    v.out.gain.value = 0.9;
    const c = v.gain(); v.ad(c.gain, t, 0.0005, 0.45, 0.014); v.chain(v.noise(t, t + 0.03), v.filter('bandpass', 3200, 1.2), c, v.out);
    const o = v.osc('sine', 85, t, t + 0.4); o.frequency.setValueAtTime(85, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.14);
    const g = v.gain(); v.ad(g.gain, t, 0.002, 0.8, 0.24); v.chain(o, g, v.sat(1.6), v.out);
    const lp = v.filter('lowpass', 160, 1.2); lp.frequency.setValueAtTime(160, t); lp.frequency.exponentialRampToValueAtTime(900, t + 0.08); lp.frequency.exponentialRampToValueAtTime(220, t + 0.6);
    const f = v.gain(); v.ad(f.gain, t + 0.01, 0.03, 0.32, 0.6); v.chain(v.noise(t, t + 0.7, 0.7), lp, f, v.out);
    const w = v.osc('triangle', 1200, t + 0.05, t + 2.3); w.frequency.setValueAtTime(1200, t + 0.05); w.frequency.exponentialRampToValueAtTime(7800, t + 1.1);
    const wg = v.gain(0); wg.gain.setValueAtTime(0.0001, t + 0.05); wg.gain.exponentialRampToValueAtTime(0.035, t + 0.5); wg.gain.setValueAtTime(0.035, t + 1.1); wg.gain.exponentialRampToValueAtTime(0.0001, t + 2.25);
    v.chain(w, v.filter('lowpass', 9000, 0.7), wg, v.out);
    const h = v.osc('sine', 15700, t + 0.3, t + 2.3), hg = v.gain(0); hg.gain.setValueAtTime(0.0001, t + 0.3); hg.gain.exponentialRampToValueAtTime(0.01, t + 1); hg.gain.exponentialRampToValueAtTime(0.0001, t + 2.25); v.chain(h, hg, v.out);
    const d = v.E.cached('disk'); if (d){ const dg = v.gain(0.16); v.chain(v.buf(d[Math.floor(Math.random() * d.length)], t + 0.35), v.filter('highpass', 120), dg, v.out); }
  },
  /* one tube switching on: a relay tick, a thump, the degauss coil's decaying hum (two detuned saws: it wobbles), a faint
     whine; opts.i steps the pitch */
  tubeOn(v, t, o){
    const i = o.i | 0, k = 1 + 0.05 * (((i * 7) % 9) - 4);
    v.out.gain.value = 0.8;
    const c = v.gain(); v.ad(c.gain, t, 0.0005, 0.3, 0.01); v.chain(v.noise(t, t + 0.02), v.filter('bandpass', 2600 * k, 1.5), c, v.out);
    const s = v.osc('sine', 110 * k, t, t + 0.3); s.frequency.setValueAtTime(110 * k, t); s.frequency.exponentialRampToValueAtTime(48 * k, t + 0.09);
    const sg = v.gain(); v.ad(sg.gain, t, 0.002, 0.7, 0.18); v.chain(s, sg, v.sat(1.4), v.out);
    const hum = v.gain(); v.ad(hum.gain, t + 0.005, 0.012, 0.16, 0.4);
    const lp = v.filter('lowpass', 520, 2); lp.connect(hum); hum.connect(v.out);
    v.osc('sawtooth', 55 * k, t, t + 0.45).connect(lp); v.osc('sawtooth', 57.5 * k, t, t + 0.45).connect(lp);
    const w = v.osc('sine', 6800 + 380 * ((i * 5) % 7), t + 0.02, t + 0.95), wg = v.gain(0);
    wg.gain.setValueAtTime(0.0001, t + 0.02); wg.gain.exponentialRampToValueAtTime(0.022, t + 0.17); wg.gain.exponentialRampToValueAtTime(0.0001, t + 0.92); v.chain(w, wg, v.out);
  },
  /* camera move: noise through a bandpass that sweeps up and back down, a lowpassed body under it, panned across */
  whoosh(v, t, o){
    const d = clamp(+o.dur || 0.8, 0.15, 4), dir = o.dir < 0 ? -1 : o.dir > 0 ? 1 : 0, pk = t + 0.55 * d, e = t + d;
    v.out.gain.value = 0.85;
    const env = v.gain(0); env.gain.setValueAtTime(0.0001, t); env.gain.exponentialRampToValueAtTime(0.6, pk); env.gain.exponentialRampToValueAtTime(0.0001, e);
    const p = v.pan(-0.7 * dir); if (dir && p.pan){ p.pan.setValueAtTime(-0.7 * dir, t); p.pan.linearRampToValueAtTime(0.7 * dir, e); }
    const bp = v.filter('bandpass', 260, 0.9); bp.frequency.setValueAtTime(260, t); bp.frequency.exponentialRampToValueAtTime(2300, pk); bp.frequency.exponentialRampToValueAtTime(500, e);
    const lp = v.filter('lowpass', 160, 0.8); lp.frequency.setValueAtTime(160, t); lp.frequency.exponentialRampToValueAtTime(700, pk); lp.frequency.exponentialRampToValueAtTime(200, e);
    const bg = v.gain(0.55);
    v.chain(v.noise(t, e + 0.02, 0.9), bp, env); v.chain(v.noise(t, e + 0.02, 0.6), lp, bg, env); v.chain(env, p, v.out);
  },
  /* whip pan: fast and bright, a high band ripping across */
  whip(v, t, o){
    const d = clamp(+o.dur || 0.24, 0.08, 1), dir = o.dir < 0 ? -1 : 1, pk = t + 0.55 * d, e = t + d;
    v.out.gain.value = 0.8;
    const env = v.gain(0); env.gain.setValueAtTime(0.0001, t); env.gain.exponentialRampToValueAtTime(0.75, pk); env.gain.exponentialRampToValueAtTime(0.0001, e);
    const p = v.pan(-0.85 * dir); if (p.pan){ p.pan.setValueAtTime(-0.85 * dir, t); p.pan.linearRampToValueAtTime(0.85 * dir, e); }
    const bp = v.filter('bandpass', 1400, 1.3); bp.frequency.setValueAtTime(1400, t); bp.frequency.exponentialRampToValueAtTime(7000, pk); bp.frequency.exponentialRampToValueAtTime(2600, e);
    const lp = v.filter('lowpass', 900, 0.7), bg = v.gain(0.3);
    v.chain(v.noise(t, e + 0.02), v.filter('highpass', 700), bp, env); v.chain(v.noise(t, e + 0.02, 0.5), lp, bg, env); v.chain(env, p, v.out);
  },
  /* electric glitch on a cut: a square wave jumping between random pitches through a stuttering gate and the
     saturator, a falling sine zap, a crackle of high noise, the error buzz sped up underneath */
  zap(v, t){
    const d = 0.17 + Math.random() * 0.08, e = t + d;
    v.out.gain.value = 1;
    const sq = v.osc('square', 300, t, e + 0.02);
    for (let x = t; x < e; x += 0.008 + Math.random() * 0.01) sq.frequency.setValueAtTime(120 * Math.pow(2, Math.random() * 3.7), x);
    const gate = v.gain(0);
    for (let x = t, on = 1; x < e; x += 0.007 + Math.random() * 0.014, on ^= 1) gate.gain.setValueAtTime(on ? 1 : 0.15, x);
    gate.gain.setValueAtTime(0, e);
    const ge = v.gain(); v.ad(ge.gain, t, 0.002, 0.5, d);
    v.chain(sq, v.filter('bandpass', 1800, 0.8), gate, ge, v.sat(1.5), v.out);
    const z = v.osc('sine', 2400, t, t + 0.2); z.frequency.setValueAtTime(2400, t); z.frequency.exponentialRampToValueAtTime(90, t + 0.8 * d);
    const zg = v.gain(); v.ad(zg.gain, t, 0.002, 0.45, 0.8 * d); v.chain(z, zg, v.out);
    const cr = v.gain(); v.ad(cr.gain, t, 0.001, 0.4, 0.06); v.chain(v.noise(t, t + 0.1), v.filter('highpass', 3000), cr, gate);
    const er = v.E.getFx('error'); if (er){ const eg = v.gain(); v.ad(eg.gain, t, 0.003, 0.3, 0.09); v.chain(v.buf(er[0], t, 1.6), eg, v.out); }
  },
  /* a small hit: a bright ping, a low knock, a few ms of air; opts.pitch scales it */
  tick(v, t, o){
    const k = clamp(+o.pitch || 1, 0.25, 4);
    v.out.gain.value = 1;
    const a = v.gain(); v.ad(a.gain, t, 0.0005, 1, 0.035); v.chain(v.osc('sine', 2100 * k, t, t + 0.05), a, v.out);
    const b = v.gain(); v.ad(b.gain, t, 0.001, 1.2, 0.06); const s = v.osc('sine', 700 * k, t, t + 0.08); s.frequency.setValueAtTime(700 * k, t); s.frequency.exponentialRampToValueAtTime(420 * k, t + 0.05); v.chain(s, b, v.out);
    const c = v.gain(); v.ad(c.gain, t, 0.0003, 0.8, 0.007); v.chain(v.noise(t, t + 0.02), v.filter('highpass', 5000), c, v.out);
  },
  /* rising tension up to the hit at t + dur: noise through a narrowing, rising bandpass; two detuned saws gliding up
     three octaves through an opening lowpass, with a tremolo that speeds up; both swell and cut dead at the hit */
  riser(v, t, o){
    const d = clamp(+o.dur || 1.5, 0.2, 8), e = t + d;
    v.out.gain.value = 0.8;
    const env = v.gain(0); env.gain.setValueAtTime(0.0001, t); env.gain.exponentialRampToValueAtTime(1, e); env.gain.linearRampToValueAtTime(0, e + 0.012);
    const bp = v.filter('bandpass', 350, 0.8); bp.frequency.setValueAtTime(350, t); bp.frequency.exponentialRampToValueAtTime(6500, e); bp.Q.setValueAtTime(0.8, t); bp.Q.linearRampToValueAtTime(5, e);
    const ng = v.gain(0.5); v.chain(v.noise(t, e + 0.02), bp, ng, env);
    const lp = v.filter('lowpass', 400, 4); lp.frequency.setValueAtTime(400, t); lp.frequency.exponentialRampToValueAtTime(6000, e);
    for (const dt of [0, 9]){ const s = v.osc('sawtooth', 110, t, e + 0.02); s.detune.value = dt; s.frequency.setValueAtTime(110, t); s.frequency.exponentialRampToValueAtTime(880, e); s.connect(lp); }
    const trem = v.gain(0.6), lfo = v.osc('sine', 5, t, e + 0.02), depth = v.gain(0.4);
    lfo.frequency.setValueAtTime(5, t); lfo.frequency.exponentialRampToValueAtTime(24, e); lfo.connect(depth); depth.connect(trem.gain);
    const tg = v.gain(0.2); v.chain(lp, trem, tg, env); env.connect(v.out);
  },
  /* the impact frame: a pitch-dropping sine (a sub-boom when big) pushed into the saturator so small speakers hear its
     harmonics, a clean copy for the real low end, a noise crack and a low thud, all sent into a convolver whose impulse
     is decaying noise (big: a longer, louder tail) */
  impact(v, t, o){
    const big = !!o.big, f0 = big ? 110 : 150, f1 = big ? 30 : 48, drop = big ? 0.5 : 0.16, dec = big ? 1.5 : 0.4;
    v.out.gain.value = big ? 0.95 : 0.8;
    const verb = v.keep(v.ctx.createConvolver()); verb.normalize = false; verb.buffer = v.E.irBuf || (v.E.irBuf = impulseBuffer(v.ctx));
    const wet = v.gain(big ? 0.9 : 0.4); v.chain(verb, v.filter('lowpass', 4500, 0.6), wet, v.out);
    const s = v.osc('sine', f0, t, t + dec + 0.05); s.frequency.setValueAtTime(f0, t); s.frequency.exponentialRampToValueAtTime(f1, t + drop);
    const sg = v.gain(); v.ad(sg.gain, t, 0.002, 0.8, dec);
    const sat = v.sat(big ? 2 : 1.6), sub = v.gain(0.5);
    s.connect(sg); v.chain(sg, sat, v.out); v.chain(sg, sub, v.out);
    const send = v.gain(0.35); (sat[1]).connect(send); send.connect(verb);
    const cr = v.gain(); v.ad(cr.gain, t, 0.0005, big ? 0.85 : 0.55, big ? 0.06 : 0.035);
    v.chain(v.noise(t, t + 0.12), v.filter('highpass', big ? 1500 : 2200), v.filter('peaking', 3500, 1), cr, v.out); cr.connect(verb);
    const th = v.gain(); v.ad(th.gain, t, 0.002, 0.6, big ? 0.2 : 0.09);
    v.chain(v.noise(t, t + 0.25, 0.8), v.filter('lowpass', 500, 0.9), th, v.out); th.connect(verb);
    v.tail(t + dec + 1.65);   // the convolver rings on after its sources stop
  },
  /* hit-stop freeze: a chord and a band of hiss slowing to a halt like stopped tape (pitch and filter falling
     together), then a soft clunk as it stops */
  tapeStop(v, t, o){
    const d = clamp(+o.dur || 0.45, 0.1, 3), e = t + d;
    v.out.gain.value = 0.7;
    const env = v.gain(0); env.gain.setValueAtTime(0.0001, t); env.gain.exponentialRampToValueAtTime(1, t + 0.01); env.gain.setValueAtTime(1, t + 0.4 * d); env.gain.exponentialRampToValueAtTime(0.0001, e);
    const lp = v.filter('lowpass', 2400, 1); lp.frequency.setValueAtTime(2400, t); lp.frequency.exponentialRampToValueAtTime(110, e);
    const cg = v.gain(0.07);
    for (const f of [220, 261.6, 329.6, 440]){ const s = v.osc('sawtooth', f, t, e + 0.02); s.frequency.setValueAtTime(f, t); s.frequency.exponentialRampToValueAtTime(f * 0.07, e); s.connect(lp); }
    v.chain(lp, cg, env);
    const n = v.noise(t, e + 0.02); n.playbackRate.setValueAtTime(1, t); n.playbackRate.exponentialRampToValueAtTime(0.05, e);
    v.chain(n, v.filter('bandpass', 1200, 0.7), v.gain(0.22), env); env.connect(v.out);
    const k = v.osc('sine', 75, e - 0.01, e + 0.15), kg = v.gain(); v.ad(kg.gain, e - 0.01, 0.002, 0.35, 0.09); v.chain(k, kg, v.out);
  },
  /* a word or letter slamming down: the Enter key's recording pitched down (the thock), a short saturated thump, a
     click; big (a whole word) goes lower and heavier, with a crack */
  type(v, t, o){
    const i = o.i | 0, big = !!o.big, k = (1 + 0.03 * (((i * 5) % 7) - 3)) * (big ? 0.85 : 1);
    v.out.gain.value = 1;
    if (keyBufs && keyBufs.heavy){ const L = keyBufs.heavy.d; v.chain(v.buf(L[Math.floor(Math.random() * L.length)], t, 0.78 * k), v.filter('lowpass', 6000, 0.6), v.gain(1.2), v.out); }
    const s = v.osc('sine', 170 * k, t, t + 0.25); s.frequency.setValueAtTime(170 * k, t); s.frequency.exponentialRampToValueAtTime(65 * k, t + (big ? 0.08 : 0.05));
    const sg = v.gain(); v.ad(sg.gain, t, 0.001, big ? 1 : 0.8, big ? 0.2 : 0.12); v.chain(s, sg, v.sat(big ? 1.8 : 1.3), v.out);
    const c = v.gain(); v.ad(c.gain, t, 0.0004, 0.28, 0.012); v.chain(v.noise(t, t + 0.03), v.filter('bandpass', 1800 * k, 1), c, v.out);
    if (big){ const cr = v.gain(); v.ad(cr.gain, t, 0.0005, 0.35, 0.03); v.chain(v.noise(t, t + 0.06), v.filter('highpass', 2500), cr, v.out); }
  },
};
Engine.prototype.cached = function (name){ return this.fxCache[name] || null; };
Engine.prototype.sfx = function (name, opts, when){
  const V = this.sfxVoices;
  if (name === 'stopAll'){ for (const v of V.splice(0)) v.kill(0.02); return; }
  const fn = SFX[name]; if (!fn) return;
  const now = this.ctx.currentTime;
  for (let i = V.length - 1; i >= 0; i--) if (V[i].dead || V[i].end < now) V.splice(i, 1);
  while (V.length >= SFX_MAX) V.shift().kill(0.015);   // polyphony: the oldest makes room
  const v = new Voice(this, Math.max(when, now));
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
    const ctx = new O(2, Math.round((secs || 3) * sr), sr), E = new Engine(ctx);
    for (const [n, o, at] of Array.isArray(name) ? name : [[name, opts, 0]]) E.sfx(n, o, 0.01 + (at || 0));
    return ctx.startRendering();
  },
};

M.sound = sound;
})();
