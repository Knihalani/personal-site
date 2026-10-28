/* Sound: everything procedural Web Audio, no files, no network.
   Keystrokes and events are synthesised sample-by-sample into AudioBuffers once (at unlock), so playback is
   just a BufferSource -> Gain -> Panner per hit. Ambience (room tone, rain, distant city, CRT hum, flyback
   whine) runs as a small live graph that update(dt) gently steers.
   Mix: keys/events -> (dry + short generated room reverb) -> glue compressor -> limiter -> mute -> out. */
(() => {
'use strict';
const M = window.MAC = window.MAC || {};

const TAU = Math.PI * 2;
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const LS_KEY = 'mac.sound.muted';

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
function ring(out, sr, t0, f, tau, amp, glide){
  const i0 = Math.round(t0 * sr), n = Math.min(out.length - i0, Math.round(tau * 9 * sr)), att = Math.round(0.0006 * sr);
  let ph = 0;
  for (let i = 0; i < n; i++){
    const t = i / sr, fr = glide ? f * (1 + glide * Math.exp(-t / (tau * 0.5))) : f;
    ph += TAU * fr / sr;
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

/* ---------------- keyswitch synthesis (physical-ish modal model) ----------------
   Real switch sounds are noise-excited and inharmonic, with no clear pitch: most energy sits at 1-6 kHz,
   plus a brief low knock from the case. Each stroke here is a few very short noise impulses, each driving a
   bank of damped two-pole resonant modes (the plate, keycap and case ringing) at randomised inharmonic
   frequencies. No sine bodies anywhere: every component is noise through resonators or filters.
   Layers: stem bottom-out (+ a lighter tactile pre-hit), plate/case ring, a short noise case knock;
   on release, the higher, drier top-out clack and an occasional faint spring ping; space/enter/backspace
   add a stabiliser rattle (noise micro-impacts through their own small metallic bank). */
const KEY_CLASSES = {
  // fs: mode-frequency scale; ds: decay scale; knock: [Hz lo, Hz hi, amount]; tact: tactile pre-hit amount;
  // stab: stabiliser rattle hits; len: buffer length (s); down/up: playback levels
  normal: { fs: 1.0,  ds: 1.0,  knock: [190, 280, 0.5], tact: 0.35, stab: 0, len: 0.10, down: 0.42, up: 0.26 },
  soft:   { fs: 0.94, ds: 0.9,  knock: [180, 250, 0.55], tact: 0.2,  stab: 0, len: 0.10, down: 0.32, up: 0.18 },
  heavy:  { fs: 0.86, ds: 1.15, knock: [160, 230, 0.7], tact: 0.3,  stab: 3, len: 0.14, down: 0.62, up: 0.30 },
  space:  { fs: 0.72, ds: 1.3,  knock: [140, 200, 0.85], tact: 0.25, stab: 5, len: 0.18, down: 0.52, up: 0.32 },
};
/* playback for the recorded keys (keysamples.js): levels and pitch per class */
const SAMPLED = {
  normal: { down: 0.46, up: 0.13, rate: 1.0 },
  soft:   { down: 0.34, up: 0.09, rate: 0.97 },
  heavy:  { down: 0.6, up: 0.18, rate: 0.9 },
  space:  { down: 0.6, up: 0.19, rate: 0.84 },
};
/* plate / cap / case modes: [lo Hz, hi Hz, decay s, rel amp] */
const PLATE_MODES = [[950, 1300, 0.032, 0.7], [1500, 1950, 0.024, 1.0], [2150, 2700, 0.018, 0.9],
  [2900, 3500, 0.014, 0.75], [3700, 4400, 0.011, 0.55], [4700, 5600, 0.008, 0.4], [6000, 7200, 0.006, 0.18]];

/* Short noise impulse (exponential, ~exc seconds) as an excitation array. */
function excite(n, sr, r, exc){
  const e = new Float32Array(n), m = Math.min(n, Math.round(exc * 8 * sr)), att = Math.max(2, Math.round(0.00008 * sr));
  for (let i = 0; i < m; i++) e[i] = (r() * 2 - 1) * Math.exp(-i / sr / exc) * (i < att ? i / att : 1);
  return e;
}
/* Drive a bank of two-pole resonators (f, decay, amp) with excitation x, adding into out at t0.
   Each mode is normalised to its own peak so amps are meaningful. */
function modal(out, sr, t0, x, modes, gain){
  const i0 = Math.round(t0 * sr), n = out.length - i0; if (n <= 0) return;
  const tmp = new Float32Array(n);
  for (const [f, decay, amp] of modes){
    if (f >= sr * 0.45) continue;
    const R = Math.exp(-1 / (decay * sr)), c = 2 * R * Math.cos(TAU * f / sr), R2 = R * R;
    let y1 = 0, y2 = 0, pk = 0;
    for (let i = 0; i < n; i++){ const y = (i < x.length ? x[i] : 0) + c * y1 - R2 * y2; y2 = y1; y1 = y; tmp[i] = y; const a = y < 0 ? -y : y; if (a > pk) pk = a; }
    if (pk > 0){ const g = gain * amp / pk; for (let i = 0; i < n; i++) out[i0 + i] += tmp[i] * g; }
  }
}
function plateModes(r, c, fMul, dMul){
  return PLATE_MODES.map(([lo, hi, d, a]) => [(lo + (hi - lo) * r()) * c.fs * fMul,
    d * c.ds * dMul * (0.7 + r() * 0.6), a * (0.55 + r() * 0.9)]);
}

function synthKeyDown(cls, sr, seed){
  const r = rng(seed), c = KEY_CLASSES[cls], out = new Float32Array(Math.round(c.len * sr));
  const modes = plateModes(r, c, 1, 1), n = out.length;
  const tb = 0.003 + r() * 0.004;                       // tactile bump -> stem bottoms out
  /* tactile pre-hit: the same structure struck lightly */
  modal(out, sr, 0, excite(n, sr, r, 0.00015), modes.slice(1, 5), 0.25 * c.tact);
  /* stem bottom-out: plate, cap and case ring */
  modal(out, sr, tb, excite(n, sr, r, 0.00025 + r() * 0.0002), modes, 0.55);
  /* broadband click of the impact itself */
  burst(out, sr, r, tb, 0.00018, 'hp', 1800, 0.7, 0.45);
  /* low case knock: noise-excited, gone within ~15 ms */
  burst(out, sr, r, tb, 0.0035 + r() * 0.002, 'bp', c.knock[0] + (c.knock[1] - c.knock[0]) * r(), 1.6, c.knock[2], 0.018);
  /* stabiliser rattle: noise micro-impacts through a small metallic bank */
  if (c.stab){
    const sm = [[2300 + r() * 500, 0.006, 1], [3300 + r() * 600, 0.005, 0.8], [4600 + r() * 700, 0.004, 0.6], [1500 + r() * 300, 0.007, 0.5]];
    let t = tb + 0.0015;
    for (let i = 0; i < c.stab; i++){
      t += 0.002 + r() * 0.005;
      modal(out, sr, t, excite(Math.round(0.03 * sr), sr, r, 0.0001), sm, 0.2 * Math.pow(0.7, i) * (0.6 + r() * 0.8));
    }
  }
  onePoleLP(out, sr, 9500);
  return finish(out, sr, 1, 8);
}
function synthKeyUp(cls, sr, seed){
  const r = rng(seed ^ 0x9e3779b9), c = KEY_CLASSES[cls], out = new Float32Array(Math.round(0.07 * sr)), n = out.length;
  /* top-out clack: higher, drier (shorter decays), fewer low modes */
  const modes = plateModes(r, c, 1.18 + r() * 0.1, 0.55).slice(1);
  const tr = 0.0015 + r() * 0.002;
  modal(out, sr, tr, excite(n, sr, r, 0.00015), modes, 0.5);
  burst(out, sr, r, tr, 0.00012, 'hp', 2500, 0.7, 0.35);
  burst(out, sr, r, tr, 0.002, 'bp', c.knock[1] * 1.3, 1.6, c.knock[2] * 0.35, 0.01);
  /* occasional faint spring ping */
  if (r() < 0.4) modal(out, sr, tr + 0.001, excite(Math.round(0.01 * sr), sr, r, 0.0001), [[4800 + r() * 2200, 0.03, 1]], 0.06);
  if (c.stab) modal(out, sr, tr + 0.004 + r() * 0.004, excite(Math.round(0.02 * sr), sr, r, 0.0001), [[2600 + r() * 600, 0.005, 1], [3800 + r() * 600, 0.004, 0.7]], 0.15);
  onePoleLP(out, sr, 10000);
  return finish(out, sr, 1, 5);
}

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

function synthBoot(sr){
  const r = rng(1984), out = new Float32Array(Math.round(3.2 * sr));
  /* power switch: a hefty rocker snap + relay, then the chassis thunk as the transformer energises */
  burst(out, sr, r, 0.0, 0.0012, 'bp', 1900, 1.5, 0.55);
  burst(out, sr, r, 0.012, 0.0018, 'bp', 900, 1.8, 0.45);
  ring(out, sr, 0.012, 62, 0.14, 0.55, 0.45);
  ring(out, sr, 0.012, 140, 0.05, 0.22);
  /* transformer energise: a short 60 Hz hum swell */
  harmonicBuzz(out, sr, 0.02, 60, 900, 1.6, t => Math.min(1, t / 0.01) * Math.exp(-t / 0.18), 0.12);
  /* degauss "bwong": 60 Hz buzz with rich harmonics through a falling formant, decaying */
  {
    const t0 = 0.18, i0 = Math.round(t0 * sr), dur = 1.7, n = Math.round(dur * sr), tmp = new Float32Array(n);
    harmonicBuzz(tmp, sr, 0, 60, 4000, 0.9, t => Math.min(1, t / 0.012) * Math.exp(-t / 0.42) * (1 + 0.25 * Math.sin(TAU * 7 * t) * Math.exp(-t / 0.3)), 1);
    const bp = biquad('bp', 900, 2.2, sr), lp = biquad('lp', 2500, 0.7, sr);
    for (let i = 0; i < n; i++){
      if ((i & 63) === 0){ const t = i / sr; bp.set(170 + 800 * Math.exp(-t / 0.22), 2.2); }
      const t = i / sr, fund = Math.sin(TAU * 60 * t) * 0.35 + Math.sin(TAU * 120 * t + 1) * 0.25;
      const env = Math.min(1, t / 0.012) * Math.exp(-t / 0.5);
      out[i0 + i] += 0.6 * (bp(tmp[i]) * 1.4 + lp(tmp[i]) * 0.25 + fund * env * 0.6);
    }
  }
  /* EHT charging: faint static tick-and-tsss as the tube comes up */
  for (let k = 0; k < 26; k++){ const t = 0.5 + Math.pow(r(), 1.7) * 1.4; burst(out, sr, r, t, 0.0003, 'hp', 3500, 0.7, 0.03 + r() * 0.05); }
  burst(out, sr, r, 0.45, 0.35, 'hp', 5000, 0.7, 0.012, 0.9);
  return finish(onePoleLP(out, sr, 11000), sr, 0.9, 40);
}
/* Floppy drive motor whir (spin-up or running), length `dur`. */
function addMotor(out, sr, r, t0, dur, spinUp, amp){
  const i0 = Math.round(t0 * sr), n = Math.min(out.length - i0, Math.round(dur * sr));
  const bp = biquad('bp', 300, 3, sr), bp2 = biquad('bp', 1200, 6, sr);
  let ph = 0, ph2 = 0;
  for (let i = 0; i < n; i++){
    const t = i / sr, sp = spinUp ? 1 - Math.exp(-t / 0.35) : 1;
    if ((i & 63) === 0){ bp.set(140 + 260 * sp, 3); bp2.set(700 + 600 * sp, 6); }
    ph += TAU * (22 + 28 * sp) / sr; ph2 += TAU * 5 * sp / sr;
    const flutter = 1 + 0.18 * Math.sin(ph2);
    const env = Math.min(1, t / 0.08) * Math.min(1, (dur - t) / 0.25);
    const nz = r() * 2 - 1;
    out[i0 + i] += amp * env * flutter * (bp(nz) * 0.9 + bp2(nz) * 0.25 * sp + Math.sin(ph) * 0.12 * sp);
  }
}
function synthDisk(sr, seed){
  const r = rng(seed), dur = 0.75 + r() * 0.25, out = new Float32Array(Math.round(dur * sr));
  addMotor(out, sr, r, 0, dur, false, 0.12);
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
function synthSpinUp(sr){
  const r = rng(5150), out = new Float32Array(Math.round(1.9 * sr));
  addMotor(out, sr, r, 0, 1.9, true, 0.14);
  return finish(out, sr, 0.5, 60);
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
function synthDrop(sr, seed){
  const r = rng(seed), out = new Float32Array(Math.round(0.03 * sr));
  burst(out, sr, r, 0, 0.0003, 'bp', 2500 + r() * 2500, 2, 0.6);
  ring(out, sr, 0.0003, 3200 + r() * 3000, 0.003, 0.25);
  return finish(onePoleLP(out, sr, 9000), sr, 1, 6);
}
/* Looping noise beds. color: 'brown' | 'pink'. Ends crossfaded so the loop is seamless. */
function noiseLoop(sr, secs, color, seed){
  const r = rng(seed), n = Math.round(secs * sr), xf = Math.round(0.5 * sr), raw = new Float32Array(n + xf);
  let b = 0, p0 = 0, p1 = 0, p2 = 0;
  for (let i = 0; i < raw.length; i++){
    const w = r() * 2 - 1;
    if (color === 'brown'){ b = (b + 0.02 * w) * 0.997; raw[i] = b * 3.5; }
    else { p0 = 0.99765 * p0 + w * 0.099; p1 = 0.963 * p1 + w * 0.2965; p2 = 0.57 * p2 + w * 1.0527; raw[i] = (p0 + p1 + p2 + w * 0.1848) * 0.2; }
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = raw[i];
  for (let i = 0; i < xf; i++){ const g = i / xf; out[i] = raw[i] * Math.sqrt(g) + raw[n + i] * Math.sqrt(1 - g); }
  return finish(out, sr, 1, 0.0001);
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

/* ---------------- engine (works on AudioContext or OfflineAudioContext) ---------------- */
function Engine(ctx){
  const sr = ctx.sampleRate, E = this;
  const mk = (arr) => { const b = ctx.createBuffer(1, arr.length, sr); b.getChannelData(0).set(arr); return b; };
  E.ctx = ctx;
  E.offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;

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
  E.ambBus = ctx.createGain(); E.ambBus.gain.value = 0; E.ambBus.connect(E.master);

  /* pre-rendered key variants: per class, a pool of down/up strokes */
  E.keys = {};
  const POOL = { normal: 14, soft: 6, heavy: 6, space: 6 };
  const addVariant = cls => { const k = E.keys[cls], seed = hash(cls) + k.d.length * 7919;
    k.d.push(mk(synthKeyDown(cls, sr, seed))); k.u.push(mk(synthKeyUp(cls, sr, seed + 104729))); };
  /* 3 variants per class right away (first keystroke must sound), the rest a few at a time in later tasks */
  const S = (window.MAC || {}).KEY_SAMPLES;
  if (S && S.hits && S.hits.length){
    /* real recordings: decode the PCM once; heavy keys and space lean on the darkest hits */
    const pcm = S.hits.map(b64 => { const bin = atob(b64), n = bin.length >> 1, f = new Float32Array(n);
      for (let i = 0; i < n; i++){ const v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); f[i] = (v > 32767 ? v - 65536 : v) / 32768; }
      return f; });
    const mkRate = (f, from) => { if (from === sr) return mk(f);
      const n = Math.round(f.length * sr / from), o = new Float32Array(n), r = from / sr;
      for (let i = 0; i < n; i++){ const x = i * r, j = x | 0, t = x - j; o[i] = (f[j] || 0) * (1 - t) + (f[j + 1] || 0) * t; } return mk(o); };
    /* release: the first ~28 ms of a hit, faded fast, played quieter and a touch higher */
    const upOf = f => { const n = Math.min(f.length, Math.round(0.028 * S.sr)), o = f.slice(0, n);
      for (let i = 0; i < n; i++) o[i] *= Math.pow(1 - i / n, 2); return o; };
    const downs = pcm.map(f => mkRate(f, S.sr)), ups = pcm.map(f => mkRate(upOf(f), S.sr));
    const dark = Math.max(3, Math.ceil(pcm.length * 0.35));
    for (const cls in POOL){
      const lo = cls === 'heavy' || cls === 'space';
      E.keys[cls] = { d: lo ? downs.slice(0, dark) : downs, u: lo ? ups.slice(0, dark) : ups, sampled: true };
    }
    E.sampled = true;
    E.fillKeys = done => { if (done) done(); };
  } else
  for (const cls in POOL){ E.keys[cls] = { d: [], u: [] }; for (let i = 0; i < 3; i++) addVariant(cls); }
  if (!E.sampled) E.fillKeys = (done) => {
    const todo = []; for (const cls in POOL) for (let i = E.keys[cls].d.length; i < POOL[cls]; i++) todo.push(cls);
    const step = () => { for (let j = 0; j < 4 && todo.length; j++) addVariant(todo.shift()); if (todo.length) setTimeout(step, 16); else if (done) done(); };
    if (E.offline){ while (todo.length) addVariant(todo.shift()); } else setTimeout(step, 16);
  };
  if (E.offline) E.fillKeys();
  /* event + droplet buffers are built lazily (or by warm()), so unlock stays light */
  const FX = {
    beep: () => [mk(synthBeep(sr))],
    error: () => [mk(synthError(sr))],
    disk: () => [0, 1, 2, 3].map(i => mk(synthDisk(sr, 300 + i * 17))),
    drops: () => [0, 1, 2, 3, 4, 5].map(i => mk(synthDrop(sr, 900 + i))),
  };
  const cache = {};
  E.getFx = name => cache[name] || (FX[name] ? (cache[name] = FX[name]()) : null);
  E.warm = () => { for (const n in FX) E.getFx(n); };
  E.voices = 0;
}
Engine.prototype.play = function (buf, bus, when, gain, rate, pan, lpF){
  const ctx = this.ctx;
  if (this.voices > 40 && !this.offline) return;
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
  const k = infoFor(code), pool = this.keys[k.cls], list = down ? pool.d : pool.u, c = KEY_CLASSES[k.cls];
  /* each key leans on 3 neighbouring variants of its pool, plus an occasional wildcard; never the same twice in a row */
  let idx;
  for (let tries = 0; tries < 4; tries++){
    idx = Math.random() < 0.8 ? (k.pool + Math.floor(Math.random() * 3)) % list.length : Math.floor(Math.random() * list.length);
    if (idx !== (down ? k.last : k.lastU)) break;
  }
  if (down) k.last = idx; else k.lastU = idx;
  const sm = this.sampled ? SAMPLED[k.cls] : null;
  const level = (sm ? (down ? sm.down : sm.up) : (down ? c.down : c.up)) * k.gain * (0.88 + Math.random() * 0.24);
  const rate = k.rate * (sm ? sm.rate * (down ? 1 : 1.12) : 1) * (0.985 + Math.random() * 0.03);
  this.play(list[idx], this.keyBus, when, level, rate, k.pan + (Math.random() - 0.5) * 0.04, k.bright * (0.92 + Math.random() * 0.16));
};
Engine.prototype.event = function (name, when){
  const ctx = this.ctx, sr = ctx.sampleRate;
  if (name === 'boot'){
    if (!this.bootBuf){ const a = synthBoot(sr); this.bootBuf = ctx.createBuffer(1, a.length, sr); this.bootBuf.getChannelData(0).set(a); }
    if (!this.spinBuf){ const a = synthSpinUp(sr); this.spinBuf = ctx.createBuffer(1, a.length, sr); this.spinBuf.getChannelData(0).set(a); }
    this.play(this.bootBuf, this.fxBus, when, 0.42, 1, 0);
    this.play(this.spinBuf, this.fxBus, when + 0.55, 0.22, 1, 0.25);
    this.play(this.getFx('disk')[0], this.fxBus, when + 1.35, 0.26, 1, 0.25);
    this.startWhine(when + 0.35);
    return;
  }
  const L = name !== 'drops' && this.getFx(name); if (!L) return;
  const buf = L[Math.floor(Math.random() * L.length)];
  const lvl = name === 'beep' ? 0.085 : name === 'error' ? 0.15 : 0.26;
  this.play(buf, this.fxBus, when, lvl, name === 'disk' ? 0.97 + Math.random() * 0.06 : 1, name === 'disk' ? 0.25 : 0);
};
/* 15.734 kHz flyback whine: felt, not heard. Starts around -60 dBFS and settles lower (update fades it). */
Engine.prototype.startWhine = function (when){
  if (this.whine) return;
  const ctx = this.ctx;
  if (ctx.sampleRate < 33000) return;
  const o = ctx.createOscillator(); o.frequency.value = 15734;
  const g = ctx.createGain(); g.gain.value = 0;
  g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(0.0009, when + 1.6);
  g.gain.setTargetAtTime(0.00035, when + 4, 6);
  o.connect(g); g.connect(this.out);   // after the compressor: never pumped up by it
  o.start(when);
  this.whine = { o, g };
};
Engine.prototype.startAmbience = function (when){
  if (this.amb) return;
  const ctx = this.ctx, sr = ctx.sampleRate, mk = (a, ch2) => {
    const b = ctx.createBuffer(ch2 ? 2 : 1, a.length, sr); b.getChannelData(0).set(a); if (ch2) b.getChannelData(1).set(ch2); return b; };
  const A = this.amb = {};
  /* room tone: soft brown noise, low-passed */
  const room = ctx.createBufferSource(); room.buffer = mk(noiseLoop(sr, 7, 'brown', 11), noiseLoop(sr, 7, 'brown', 12)); room.loop = true;
  const roomLP = ctx.createBiquadFilter(); roomLP.type = 'lowpass'; roomLP.frequency.value = 320;
  const roomG = ctx.createGain(); roomG.gain.value = 0.012;
  room.connect(roomLP); roomLP.connect(roomG); roomG.connect(this.ambBus); room.start(when);
  /* rain on the glass: band-limited pink noise, plus droplets from update() */
  A.noise = mk(noiseLoop(sr, 6, 'pink', 21), noiseLoop(sr, 6, 'pink', 22));
  const rain = ctx.createBufferSource(); rain.buffer = A.noise; rain.loop = true;
  const rhp = ctx.createBiquadFilter(); rhp.type = 'highpass'; rhp.frequency.value = 1100;
  const rlp = ctx.createBiquadFilter(); rlp.type = 'lowpass'; rlp.frequency.value = 4200;
  A.rainG = ctx.createGain(); A.rainG.gain.value = 0.003;
  rain.connect(rhp); rhp.connect(rlp); rlp.connect(A.rainG); A.rainG.connect(this.ambBus); rain.start(when, 2.3);
  /* CRT / mains hum: 60 Hz with a few harmonics, barely there */
  const real = new Float32Array([0, 0, 0, 0, 0, 0, 0]), imag = new Float32Array([0, 1, 0.7, 0.45, 0.15, 0.2, 0.06]);
  const hum = ctx.createOscillator(); hum.setPeriodicWave(ctx.createPeriodicWave(real, imag)); hum.frequency.value = 60;
  A.humG = ctx.createGain(); A.humG.gain.value = 0.0025;
  hum.connect(A.humG); A.humG.connect(this.ambBus); hum.start(when);
  A.nextWhoosh = 3 + Math.random() * 6; A.t = 0; A.rainPhase = Math.random() * 10;
  /* fade everything in over ~2 s */
  const g = this.ambBus.gain; g.cancelScheduledValues(when); g.setValueAtTime(0, when); g.setTargetAtTime(1, when, 0.6);
};
/* a distant car / gust: band-passed noise sweeping across the window */
Engine.prototype.whoosh = function (when){
  const ctx = this.ctx, A = this.amb, dur = 3 + Math.random() * 3.5, dir = Math.random() < 0.5 ? -1 : 1;
  const src = ctx.createBufferSource(); src.buffer = A.noise; src.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
  const f0 = 180 + Math.random() * 120;
  bp.frequency.setValueAtTime(f0, when); bp.frequency.linearRampToValueAtTime(f0 * 2.3, when + dur * 0.5); bp.frequency.linearRampToValueAtTime(f0 * 1.1, when + dur);
  const g = ctx.createGain(), peak = 0.03 + Math.random() * 0.03;
  g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(peak, when + dur * 0.5); g.gain.linearRampToValueAtTime(0, when + dur);
  src.connect(bp); bp.connect(g);
  let node = g;
  if (ctx.createStereoPanner){ const p = ctx.createStereoPanner(); p.pan.setValueAtTime(-0.6 * dir, when); p.pan.linearRampToValueAtTime(0.6 * dir, when + dur); g.connect(p); node = p; }
  node.connect(this.ambBus);
  src.start(when, Math.random() * 5); src.stop(when + dur + 0.05);
  src.onended = () => { try { node.disconnect(); } catch (e){} };
};
Engine.prototype.tick = function (dt){
  const A = this.amb; if (!A) return;
  const now = this.ctx.currentTime;
  A.t += dt;
  A.nextWhoosh -= dt;
  if (A.nextWhoosh <= 0){ this.whoosh(now + 0.02); A.nextWhoosh = 8 + Math.random() * 16; }
  /* rain intensity drifts slowly; droplets tick on the glass */
  const rainOn = M.sound && M.sound.rain !== false;
  const inten = rainOn ? 0.55 + 0.45 * Math.sin(A.t * 0.07 + A.rainPhase) * Math.sin(A.t * 0.031 + 1) : 0;
  A.rainG.gain.setTargetAtTime(0.0035 * Math.max(0, inten), now, 1.5);
  const rate = 7 * Math.max(0, inten);
  let k = Math.min(4, Math.floor(rate * dt + Math.random()));     // Poisson-ish
  if (Math.random() > rate * dt) k = 0;
  while (k-- > 0){
    const D = this.getFx('drops');
    this.play(D[Math.floor(Math.random() * D.length)], this.ambBus, now + Math.random() * dt,
      0.004 + Math.random() * 0.008, 0.8 + Math.random() * 0.5, 0.5 + Math.random() * 0.4);
  }
};

/* ---------------- public API ---------------- */
let eng = null, booted = false, muted = false, hidden = false;
try { muted = localStorage.getItem(LS_KEY) === '1'; } catch (e){}

function ready(){
  if (!eng) return false;
  const ctx = eng.ctx;
  if (ctx.state !== 'running'){ if (!muted && !hidden && ctx.state === 'suspended') ctx.resume().catch(() => {}); return false; }
  return !muted;
}

const sound = {
  rain: true,
  get muted(){ return muted; },
  unlock(){
    try {
      if (!eng){
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
        const ctx = new AC({ latencyHint: 'interactive' });
        eng = new Engine(ctx);
        eng.out.gain.value = muted ? 0 : 1;
      }
      const ctx = eng.ctx, go = () => {
        if (booted) return; booted = true;
        /* spread the synthesis over a few tasks so the first keystroke never hitches */
        setTimeout(() => {
          try {
            if (!muted) eng.event('boot', ctx.currentTime + 0.03); else eng.startWhine(ctx.currentTime);
            setTimeout(() => { try { eng.startAmbience(ctx.currentTime + 0.05); } catch (e){} }, 60);
            setTimeout(() => { try { eng.fillKeys(); } catch (e){} }, 200);
            setTimeout(() => { try { eng.warm(); } catch (e){} }, 2600);
          } catch (e){}
        }, 0);
      };
      if (ctx.state === 'running') go();
      else if (!hidden){ const p = ctx.resume(); if (p && p.then) p.then(go, () => {}); else go(); }
    } catch (e){ /* audio is a nicety; never break the page */ }
  },
  key(code, down){
    if (!ready()) return;
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
  update(dt){
    if (!eng || muted || hidden || eng.ctx.state !== 'running') return;
    try { eng.tick(clamp(+dt || 0, 0, 0.25)); } catch (e){}
  },
  /* testing hook: render a scripted sequence offline. script(api) schedules via api.key(code, down, t) / api.event(name, t). */
  _renderOffline(seconds, script, sampleRate){
    const sr = sampleRate || 48000, O = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ctx = new O(2, Math.round(seconds * sr), sr), e = new Engine(ctx);
    e.startAmbience(0);
    script({ key: (c, d, t) => e.key(c, d, t), event: (n, t) => e.event(n, t) });
    return ctx.startRendering();
  },
};

document.addEventListener('visibilitychange', () => {
  hidden = document.visibilityState === 'hidden';
  if (!eng) return;
  try { if (hidden) eng.ctx.suspend(); else if (!muted && booted) eng.ctx.resume(); } catch (e){}
});

M.sound = sound;
})();
