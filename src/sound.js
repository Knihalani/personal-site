/* Sound: Web Audio, no network.
   Keys are real recordings (keysamples.js: one MP3 sprite, decoded once and sliced per class); without them the
   keys stay silent. Events (disk seek, terminal bell, error buzz) are synthesised sample-by-sample into
   AudioBuffers on first use. Playback is a BufferSource -> lowpass -> Gain -> Panner per hit.
   Mix: keys/events -> (dry + short generated room reverb) -> glue compressor -> limiter -> mute -> out.
   Also the landing intro's chiptune (MUSIC, sound.music), on its own bus into the same master chain. */
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

/* ---------------- music: the landing intro's chiptune ----------------
   A small C64/Amiga-style tune in A minor at 120 bpm, synthesised live with oscillators (no samples): a 12.5% pulse
   arpeggio, a 25% pulse lead with vibrato and a dotted-eighth echo, a filtered saw bass, and drums (a pitch-dropping
   sine kick, a noise snare, hats, a crash). A seven-bar intro scored to the landing's opening, beat for beat: the
   tube warming up and the name (a sweep, the arpeggio's filter opening, the beam's ticks), J (the bass and kick come
   in), the wall of tubes (a run of blips as they switch on, a whoosh as the camera pushes in), THE GOAT? (everything
   cuts to a ticking hat; each letter lands with a pitched bloop, the question mark with a "huh?", a riser, a breath of
   silence), the answer (the band back on the downbeat, a blip for each copper bar), the build (a snare roll and a
   riser), then the drop into a sixteen-bar A/B loop. Everything is band-limited and enveloped, and the bus sits
   under the master chain (so the mute toggle silences it) at a moderate level.
   It plays only while the intro asks for it: the demo calls music.alive() every frame it draws; with no call for
   ~300 ms (the intro dismissed, scrolled away or covered) it fades out and stops. It starts only once the page has
   been touched (the AudioContext unlocked by a gesture) and only when not muted. env(t) gives the visuals the same
   beat (kick, snare, bar, the drop) from the same pattern, with or without sound. */
const MUSIC = (() => {
  const BPM = 120, STEP = 60 / BPM / 4, BAR = STEP * 16, INTRO = 7, LOOP = 16;   // (the intro is the landing's opening: 14 s)
  const mf = m => 440 * Math.pow(2, (m - 69) / 12);
  const PC = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
  const nm = s => { const m = /^([A-G]#?)(\d)$/.exec(s); return m ? PC[m[1]] + 12 * (+m[2] + 1) : null; };
  /* chords: root (bass octave) and quality */
  const CH = { Am: [45, 0], F: [41, 1], C: [48, 1], G: [43, 1], E: [40, 1], Em: [40, 0], Dm: [38, 0] };
  const INTRO_CH = ['Am', 'F', 'C', 'G', 'Am', 'F', 'E'];
  const A_CH = ['Am', 'F', 'C', 'G', 'Am', 'F', 'G', 'E'], B_CH = ['F', 'G', 'Em', 'Am', 'Dm', 'Am', 'E', 'E'];
  /* the lead, in eighths: a note, '-' holds, '.' rests */
  const LEAD = [
    'A4 . C5 E5 . D5 C5 .', 'A4 . C5 F5 . E5 C5 .', 'G4 . C5 E5 . G5 E5 C5', 'D5 - - B4 . G4 . .',
    'A4 . C5 E5 . D5 C5 .', 'A4 . C5 F5 . A5 G5 F5', 'E5 . D5 . B4 . D5 .', 'E5 - - . G#4 . B4 .',
    'C6 . A5 . F5 . A5 C6', 'D6 . B5 . G5 . B5 D6', 'E6 . B5 . G5 . E5 G5', 'A5 - - . E5 . A5 .',
    'F5 . D5 . A4 . D5 F5', 'E5 . C5 . A4 . C5 E5', 'G#5 . E5 . B4 . E5 G#5', 'B5 - - - - - . .',
  ].map(b => b.split(' ').map(x => x === '-' ? -1 : x === '.' ? 0 : nm(x)));
  const chordAt = bar => bar < INTRO ? INTRO_CH[bar] : ((bar - INTRO) % LOOP < 8 ? A_CH : B_CH)[(bar - INTRO) % 8];
  const TN = [0, 0, 0], tones = name => { const c = CH[name]; TN[0] = c[0]; TN[1] = c[0] + (c[1] ? 4 : 3); TN[2] = c[0] + 7; return TN; };   // (one array, reused: the scheduler makes no garbage)
  /* the drums, per sixteenth: k kick, s snare, h hat, o open hat */
  const DR = { k: 0, s: 0, h: 0, o: 0, c: 0 };
  const drums = (bar, st) => {
    const r = DR; r.k = r.s = r.h = r.o = r.c = 0;   // (one object, reused)
    if (bar < INTRO){
      const goat = bar === 4 && st >= 4;                               // THE GOAT?: the band stops; a hat ticks
      if (bar === 0){ if (st === 3) r.k = .55; if (st >= 8 && st % 2 === 0) r.h = .18; return r; }   // the name lands; the beam's ticks
      if (bar === 1){ if (st === 0 || st === 8) r.k = .9; if (st === 12) r.s = .7; r.h = st % 2 === 0 ? .28 : 0; if (st === 6) r.o = .5; return r; }
      if (goat){ if (st % 2 === 0 && st < 12) r.h = .3; return r; }
      if (st % 4 === 0) r.k = 1;
      if (bar === 6) r.s = st < 8 ? (st % 2 === 0 ? .35 + .03 * st : 0) : .45 + .035 * (st - 8);   // the roll into the drop (and the slam)
      else if (st === 4 || st === 12) r.s = .85;
      if (bar === 2 && st >= 14) r.s = .6;                             // a fill as the camera pulls back
      r.h = st % 2 === 0 ? .32 : 0;
      if ((bar === 2 && st === 10) || (bar === 3 && st === 5)) r.o = .6;   // the whooshes' tails
      if (bar === 5 && st === 0) r.c = 1;                              // the answer's downbeat
      return r;
    }
    const lb = (bar - INTRO) % LOOP, B = lb >= 8;
    if (st === 0 || st === 8 || (B && st === 10) || (lb % 4 === 3 && st === 14)) r.k = 1;
    if (st === 4 || st === 12) r.s = 1;
    if (lb % 8 === 7 && st >= 13) r.s = .5 + .15 * (st - 13);     // a fill every eight bars
    if (st % 2 === 0) r.h = st % 4 === 0 ? .5 : .35;
    if (st === 14) r.o = .5;
    if (lb % 8 === 0 && st === 0) r.c = 1;                         // a crash on each section's downbeat
    return r;
  };
  /* the beat for the visuals at song time t (s): envelopes since the last kick, snare, bar line and drop */
  const out = { kick: 0, snare: 0, bar: 0, drop: 0, step: 0, barN: 0, part: 0 };
  function env(t){
    if (!(t >= 0)){ out.kick = out.snare = out.bar = out.drop = 0; out.part = -1; return out; }
    const n = Math.floor(t / STEP), bar = Math.floor(n / 16), st = n - bar * 16;
    out.step = n; out.barN = bar; out.part = bar < INTRO ? 0 : ((bar - INTRO) % LOOP < 8 ? 1 : 2);
    let kd = 9, sd = 9;
    for (let i = 0; i < 16 && (kd === 9 || sd === 9); i++){
      const m = n - i; if (m < 0) break;
      const b = Math.floor(m / 16), d = drums(b, m - b * 16), dt = t - m * STEP;
      if (kd === 9 && d.k) kd = dt; if (sd === 9 && d.s >= .5) sd = dt;
    }
    out.kick = Math.exp(-kd * 9); out.snare = Math.exp(-sd * 8); out.bar = Math.exp(-(t - bar * BAR) * 3);
    const ls = Math.floor((bar - INTRO) / 8);
    out.drop = bar >= INTRO ? Math.exp(-(t - (INTRO + ls * 8) * BAR) * (ls === 0 ? 1.6 : 3)) * (ls === 0 ? 1 : .5) : 0;
    return out;
  }

  let eng = null, bus = null, an = null, anBuf = null, echo = null, waves = null, noise = null;
  let playing = false, t0 = 0, next = 0, n = 0, timer = 0, alive = 0, stopAt = 0;
  function setup(E){
    const ctx = E.ctx; eng = E;
    bus = ctx.createGain(); bus.gain.value = 0;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 40;
    an = ctx.createAnalyser(); an.fftSize = 512; anBuf = new Float32Array(512);   // inline, so it is always pulled
    bus.connect(an); an.connect(hp); hp.connect(E.master);
    /* a dotted-eighth echo for the lead, darker each time round */
    echo = ctx.createDelay(1); echo.delayTime.value = STEP * 3;
    const fb = ctx.createGain(), elp = ctx.createBiquadFilter(); fb.gain.value = .32; elp.type = 'lowpass'; elp.frequency.value = 1900;
    const ret = ctx.createGain(); ret.gain.value = .32;
    echo.connect(elp); elp.connect(fb); fb.connect(echo); elp.connect(ret); ret.connect(bus);
    /* pulse waves (12.5% and 25%) with the top harmonics rolled off */
    const pw = d => { const N = 28, re = new Float32Array(N), im = new Float32Array(N); for (let k = 1; k < N; k++){ const a = 2 / (k * Math.PI) * Math.sin(k * Math.PI * d) * Math.pow(.93, k); re[k] = a; } return ctx.createPeriodicWave(re, im); };
    waves = { p12: pw(.125), p25: pw(.25) };
    const len = Math.round(ctx.sampleRate * .5), nb = ctx.createBuffer(1, len, ctx.sampleRate), d = nb.getChannelData(0), r = rng(77);
    for (let i = 0; i < len; i++) d[i] = r() * 2 - 1;
    noise = nb;
  }
  /* one note: an oscillator through a lowpass and an envelope */
  function tone(type, f, at, dur, vol, cut, q, dest, opts){
    const ctx = eng.ctx, o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    if (type.startsWith('pw:')) o.setPeriodicWave(waves[type.slice(3)]); else o.type = type;
    o.frequency.setValueAtTime(f, at);
    if (opts && opts.slide) o.frequency.exponentialRampToValueAtTime(opts.slide, at + (opts.slideT || .1));
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(cut, at); lp.Q.value = q || .7;
    if (opts && opts.cutTo) lp.frequency.exponentialRampToValueAtTime(opts.cutTo, at + (opts.cutT || .15));
    const a = (opts && opts.a) || .004, rel = (opts && opts.rel) || .06, sus = opts && opts.sus != null ? opts.sus : .65;
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(vol, at + a);
    g.gain.setTargetAtTime(vol * sus, at + a, dur * .35);
    g.gain.setTargetAtTime(0, at + dur, rel / 3);
    if (opts && opts.vib){
      const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 5.6; lg.gain.setValueAtTime(0, at); lg.gain.linearRampToValueAtTime(opts.vib, at + .25);
      l.connect(lg); lg.connect(o.detune); l.start(at); l.stop(at + dur + rel + .05);
    }
    o.connect(lp); lp.connect(g); g.connect(dest);
    if (opts && opts.send){ const s = ctx.createGain(); s.gain.value = opts.send; g.connect(s); s.connect(echo); }
    o.start(at); o.stop(at + dur + rel + .05);
    o.onended = () => { try { g.disconnect(); } catch (e){} };
  }
  function hit(at, vol, type, f, q, dur){
    const ctx = eng.ctx, s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noise; s.playbackRate.value = .8 + Math.random() * .4;
    fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(.0005, at + dur);
    s.connect(fl); fl.connect(g); g.connect(bus); s.start(at, Math.random() * .2); s.stop(at + dur + .02);
    s.onended = () => { try { g.disconnect(); } catch (e){} };
  }
  function kick(at, v){
    const ctx = eng.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(160, at); o.frequency.exponentialRampToValueAtTime(52, at + .1);
    g.gain.setValueAtTime(.0001, at); g.gain.exponentialRampToValueAtTime(.9 * v, at + .004); g.gain.exponentialRampToValueAtTime(.001, at + .3);
    o.connect(g); g.connect(bus); o.start(at); o.stop(at + .32);
    hit(at, .05 * v, 'bandpass', 2600, 1.2, .012);   // a click, so a small speaker hears the beat
    o.onended = () => { try { g.disconnect(); } catch (e){} };
  }
  /* a noise sweep through a moving bandpass (whooshes and risers) */
  function sweep(at, dur, f0, f1, vol, q){
    const ctx = eng.ctx, s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noise; s.loop = true; fl.type = 'bandpass'; fl.Q.value = q || 2;
    fl.frequency.setValueAtTime(f0, at); fl.frequency.exponentialRampToValueAtTime(f1, at + dur);
    g.gain.setValueAtTime(.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + dur * .85); g.gain.linearRampToValueAtTime(0, at + dur);
    s.connect(fl); fl.connect(g); g.connect(bus); s.start(at); s.stop(at + dur + .02);
    s.onended = () => { try { g.disconnect(); } catch (e){} };
  }
  /* the intro's cues, on the picture's beats (bar, sixteenth) */
  function cues(at, bar, st){
    if (bar === 0 && st === 0){ tone('sine', 220, at, .34, .1, 3000, .7, bus, { slide: 880, slideT: .32, sus: .8, rel: .05 }); }   // the tube warming up
    if (bar === 0 && st === 3){ tone('pw:p25', mf(57), at, .9, .06, 1400, .7, bus, { sus: .5, rel: .4, send: .3 }); tone('pw:p25', mf(64), at, .9, .05, 1400, .7, bus, { sus: .5, rel: .4 }); }   // the name lands
    if (bar === 1 && st === 7) sweep(at, .14, 900, 5000, .12, 1.5);   // the crane
    if (bar === 2 && st === 10) sweep(at, .42, 5000, 500, .1, 1.2);   // the pull back
    if (bar === 3 && st < 4){                                         // the wall switching on: a blip a tube, two a sixteenth
      const sc = [69, 72, 76, 79, 81, 84, 88, 91];
      for (let k = 0; k < 2; k++){ const i = st * 2 + k; tone('pw:p12', mf(sc[i]), at + k * STEP / 2, .05, .06, 4000, .7, bus, { sus: .3, rel: .03 }); }
    }
    if (bar === 3 && st === 5) sweep(at, .5, 600, 6000, .12, 1.3);    // the push back in
    if (bar === 4){
      if (st >= 4 && st < 6) for (let k = 0; k < 2; k++) hit(at + k * .06, .05, 'highpass', 5200, .7, .02);   // THE, typed
      if (st >= 6 && st <= 9){ const p = [64, 67, 71, 74][st - 6]; tone('pw:p25', mf(p + 12), at, .12, .09, 3200, .7, bus, { slide: mf(p), slideT: .1, sus: .4, rel: .05 }); }   // G O A T land
      if (st === 12){ tone('pw:p25', mf(76), at, .11, .09, 3000, .7, bus, { sus: .6, rel: .04 }); tone('pw:p25', mf(83), at + .12, .2, .09, 3000, .7, bus, { sus: .6, rel: .08, vib: 20 }); }   // ?: "huh?"
      if (st === 12) sweep(at + .05, .42, 300, 7000, .14, 2.2);       // the riser, cut dead on the downbeat
    }
    if (bar === 5 && st >= 4 && st <= 12 && st % 2 === 0){ const p = [69, 72, 76, 79, 81][(st - 4) / 2]; tone('pw:p12', mf(p + 12), at, .07, .07, 4000, .7, bus, { sus: .3, rel: .04, send: .3 }); }   // the copper bars drop in
    if (bar === 6 && st === 8) sweep(at, 1.0, 400, 8000, .12, 1.6); // the rush
  }
  function step(at, n){
    const bar = Math.floor(n / 16), st = n - bar * 16, ch = tones(chordAt(bar)), intro = bar < INTRO;
    const quiet = intro && bar === 4 && st >= 4;                      // THE GOAT?: no arpeggio, no bass
    if (intro) cues(at, bar, st);
    /* arpeggio: up through the chord, an octave up, sixteenths */
    const arp = [0, 1, 2, 1][st % 4] + (st % 8 >= 4 ? 3 : 0), m = arp < 3 ? ch[arp] + 24 : ch[arp - 3] + 36;
    const cut = intro ? 1100 + 1700 * Math.pow((bar * 16 + st) / (INTRO * 16), 1.3) : 2600;
    if (!quiet) tone('pw:p12', mf(m), at, STEP * .7, intro ? .09 : .045, cut, 1.2, bus, { sus: .4, rel: .05 });
    /* bass: eighths, root with an octave jump, plucked (in from J) */
    if (st % 2 === 0 && !quiet && (!intro || bar >= 1)){
      const r = ch[0], bm = [r, r, r + 12, r, r, r + 7, r + 12, r + 7][st / 2];   // (A2-ish: low enough to anchor, high enough for a laptop speaker)
      tone('sawtooth', mf(bm), at, STEP * 1.6, .17, 1500, 3, bus, { cutTo: 380, cutT: .16, sus: .5, rel: .06 });
    }
    else if (intro && bar === 0 && (st === 3 || st === 11)) tone('sawtooth', mf(ch[0]), at, STEP * 7, .12, 700, 1.5, bus, { cutTo: 300, cutT: .8, sus: .7, rel: .3 });   // under the name: a held, darkening root
    /* lead */
    if ((!intro || bar === 2 || bar === 3 || bar === 5 || bar === 6) && st % 2 === 0){   // (in the intro the theme is previewed, darker and an octave down)
      const L = LEAD[intro ? [0, 0, 0, 1, 0, 4, 7][bar] : (bar - INTRO) % LOOP], i = st / 2, note = L[i];
      if (note > 0){ let k = 1; while (i + k < 8 && L[i + k] === -1) k++;
        if (intro) tone('pw:p25', mf(note - 12), at, STEP * 2 * k - .02, .07, 1100, .7, bus, { vib: 6, send: .3, sus: .7, rel: .14 });
        else tone('pw:p25', mf(note), at, STEP * 2 * k - .02, .1, note > 81 ? 1700 : 2300, .7, bus, { vib: 8, send: .4, sus: .7, rel: .14 }); }
    }
    /* drums */
    const d = drums(bar, st);
    if (d.k) kick(at, d.k);
    if (d.s){ hit(at, .22 * d.s, 'bandpass', 1500, .8, .15); tone('triangle', 190, at, .03, .12 * d.s, 3000, .7, bus, { slide: 120, slideT: .05, sus: 0, rel: .03 }); }
    if (d.h) hit(at, .04 * d.h, 'highpass', 7000, .7, .03);
    if (d.o) hit(at, .035 * d.o, 'highpass', 6500, .7, .2);
    if (d.c) hit(at, .1, 'highpass', 4200, .5, 1.6);
  }
  function tick(){
    if (!eng) return;
    const ctx = eng.ctx, now = ctx.currentTime;
    if (performance.now() - alive > 300 && !stopAt) api.stop(.9);
    if (stopAt){ if (now >= stopAt){ clearInterval(timer); timer = 0; playing = false; stopAt = 0; } return; }
    if (ctx.state !== 'running') return;
    if (next < now) { const skip = Math.ceil((now - next) / STEP); n += skip; next += skip * STEP; }   // after a pause: rejoin the beat, don't burst
    while (next < now + .12){ try { step(next, n); } catch (e){} n++; next += STEP; }
  }
  const api = {
    BPM, STEP, BAR, INTRO, env,
    get playing(){ return playing && !stopAt; },
    /* the intro calls this every frame it shows: starts the tune (once a gesture has unlocked audio, never muted) and keeps it going */
    alive(E, isMuted, pos){
      alive = performance.now();
      if (isMuted){ if (playing && !stopAt) api.stop(.15); return false; }
      if (playing && !stopAt) return true;
      if (!E || E.ctx.state !== 'running' || stopAt) return false;
      if (!bus) setup(E);
      const now = E.ctx.currentTime;
      /* join at the picture's place (pos, seconds into the tune), on the next sixteenth */
      const p0 = Math.max(0, pos || 0); n = Math.ceil((p0 + .08) / STEP); t0 = now - p0; next = t0 + n * STEP; playing = true;
      bus.gain.cancelScheduledValues(now); bus.gain.setValueAtTime(0, now); bus.gain.linearRampToValueAtTime(.3, now + .15);
      clearInterval(timer); timer = setInterval(tick, 25); tick();
      return true;
    },
    stop(fade){
      if (!playing || !eng) return;
      const now = eng.ctx.currentTime, f = Math.max(.05, fade || .6);
      bus.gain.cancelScheduledValues(now); bus.gain.setValueAtTime(bus.gain.value, now); bus.gain.linearRampToValueAtTime(0, now + f);
      stopAt = now + f + .05;
      if (eng.ctx.state !== 'running'){ clearInterval(timer); timer = 0; playing = false; stopAt = 0; }
    },
    /* seconds into the tune (as heard), -1 when not playing */
    time(){ if (!playing || stopAt || !eng) return -1; const c = eng.ctx; return c.currentTime - t0 - (c.outputLatency || c.baseLatency || 0); },
    /* renders the first `sec` seconds offline and resolves to the RMS of each half second (a test hook: no live audio involved) */
    render(sec){
      const O = window.OfflineAudioContext || window.webkitOfflineAudioContext; if (!O) return Promise.resolve(null);
      const sr = 22050, ctx = new O(1, Math.round(sr * sec), sr), keep = [eng, bus, an, anBuf, echo, waves, noise];
      setup({ ctx, master: ctx.destination }); bus.gain.value = .3;
      for (let i = 0, t = .05; t < sec; i++, t += STEP) step(t, i);
      [eng, bus, an, anBuf, echo, waves, noise] = keep;
      return ctx.startRendering().then(b => { const d = b.getChannelData(0), h = sr / 2, r = []; for (let i = 0; i + h <= d.length; i += h){ let q = 0; for (let j = i; j < i + h; j++) q += d[j] * d[j]; r.push(Math.sqrt(q / h)); } return r; });
    },
    /* the bus's loudness right now, 0..1 (for tests, and the visuals' VU) */
    level(){ if (!an || !playing) return 0; an.getFloatTimeDomainData(anBuf); let s = 0; for (let i = 0; i < anBuf.length; i++) s += anBuf[i] * anBuf[i]; return Math.sqrt(s / anBuf.length); },
  };
  return api;
})();

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
  /* the landing intro's tune (see MUSIC): music.alive() every frame the intro shows; env(t) for its beat */
  music: {
    alive(pos){ return MUSIC.alive(eng, muted || hidden, pos); },
    stop(fade){ MUSIC.stop(fade); },
    time(){ return MUSIC.time(); },
    level(){ return MUSIC.level(); },
    render(sec){ return MUSIC.render(sec); },
    env: MUSIC.env,
    get playing(){ return MUSIC.playing; },
    BPM: MUSIC.BPM, BAR: MUSIC.BAR, INTRO: MUSIC.INTRO,
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
