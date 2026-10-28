
/* ================= sound & music (s1) =================
 SOUND STYLE: warm, airy and tactile. Every effect is three layers: a transient (the click or snap that
 tells you what happened), a body (the material: thump, knock, ring) and a tail (grit, debris, room).
 Nothing is sampled; everything is synthesised, and the busy one-shots are pre-rendered once into
 small buffers (OfflineAudioContext, 32 kHz, 2-4 variants each) so playback costs one node per voice.

 GRAPH (auGraph builds the same graph for the live AudioContext and for the offline test renders):
   music: patch voices ─ tape (tanh, slight asymmetry) ─ LPF 12.5k ─ duck ─┬───────────── master
                                                                         └─ hall send ─ hall IR 3.6s ─ master
   sfx:   voices (panner HRTF on desktop / equal-power on touch, distance + occlusion low-pass) ─┬─ master
   amb:   beds (wind, whistle, leaves, water, Wilds drone) + spatial one-shots ─────────────────┤
   ui:    clicks, panels, toasts ────────────────────────────────────────────────────────────┤
          sfx + amb sends ─ room: open IR 1.2s ⇄ cave IR 2.6s (crossfaded underground) ───────┘
   master ─ glue compressor (-14 dB, 2:1) ─ tape saturation ─ limiter (-6 dB, 20:1, 1 ms) ─ ceiling (-1.2 dB) ─ out
 Per-bus sliders (master, music, effects, ambience, interface) in the pause menu; M mutes.
 Voice pool: 24 voices, stealing the lowest priority (then oldest): 0 ambient detail, 1 footsteps and
 creature voices, 2 world hits, 3 player actions and enemies, 4 interface and stingers.

 MIX TARGETS: SFX peaks about -6 dBFS (the biggest hits), footsteps about -16, UI about -16 to -20,
 ambience about -24 LUFS, music about -20 LUFS, ducking 4-12 dB under stingers, hurt, death and
 captions; master true peak at or below -1 dBFS, no clipping, no clicks.

 SCORE (data in SCORE below): home key D major. The Kaiav leitmotif is five notes, A–D–C#–F#–E (a rising
 fourth, a lean down, then a reaching sixth that leaves the phrase open). It plays on bell in the title,
 kalimba softly in daytime and night exploration (every other cycle), bell plus choir at the film's end
 and kalimba plus bells for the sail gift.
   title  76 bpm D major   T1 T2
   day    84 bpm D major   forms of A A2 B B2 C; e-piano, pad, sub, pluck, kalimba, brush, rim
   night  66 bpm D lydian colour (Gmaj7, Dmaj7/F#, Em9); bells, dark pad, 'oo' choir; no drums
   wilds  92 bpm B minor   ostinato pluck, pulsing sub, choir, kick; bridge leans on C major (bII)
   combat 126 bpm B minor  kick, rim backbeat, 16th brush, 16th pluck ostinato, choir and bell stabs
   cine   80 bpm           wake (D minor) → title (key change up to E major, impact) → eden → j → about
                           → contact → end (back to D, V–I, motif) → gift (the sail; motif resolves)
 The conductor schedules on AudioContext time with a 100 ms look-ahead, starts stems and states on bar
 boundaries, and varies the music over time: section forms are re-drawn each cycle, optional stems
 drop out (20%), voicings shift and melodies are generated fresh from the scale and chord tones.
*/
const db = x => Math.pow(10, x / 20);
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const NOTES = [0, 2, 4, 7, 9];
function srng(s){ s = (s >>> 0) || 1; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }
const AU = { ctx: null, G: null, A: null, cond: null, muted: false, ready: false,
  vol: { master: 1, music: .8, sfx: 1, amb: .85, ui: .8 }, base: { master: 1, music: .6, sfx: .7, amb: .75, ui: .8 },
  bakes: {}, last: {}, voices: [], stolen: 0, dropped: 0, hrtf: !TOUCH, glideG: null, glideF: null, dkLvl: 1, dkEnd: 0, hold: 0 };
const VOICES = 24;
/* per-context helpers: seeded white and brown noise (brown loops seamlessly), Karplus–Strong tables */
const AUX = new WeakMap();
function aux(c){
  let k = AUX.get(c); if (k) return k;
  const r = srng(7), sr = c.sampleRate, n = Math.floor(sr * 2), w = c.createBuffer(1, n, sr), wd = w.getChannelData(0);
  for (let i = 0; i < n; i++) wd[i] = r() * 2 - 1;
  const L = Math.floor(sr * .25), m = n * 2, tmp = new Float32Array(m + L); let y = 0;
  for (let i = 0; i < m + L; i++){ y = (y + .02 * (r() * 2 - 1)) / 1.02; tmp[i] = y * 3.2; }
  const b = c.createBuffer(1, m, sr), bd = b.getChannelData(0); bd.set(tmp.subarray(0, m));
  for (let i = 0; i < L; i++){ const u = i / L; bd[i] = tmp[i] * u + tmp[m + i] * (1 - u); }
  k = { wn: w, bn: b, ks: {}, r }; AUX.set(c, k); return k;
}
function tapeCurve(drive, bias){ const n = 2048, a = new Float32Array(n), o = Math.tanh(drive * bias); for (let i = 0; i < n; i++){ const x = i / (n - 1) * 2 - 1; a[i] = (Math.tanh(drive * (x + bias)) - o) / drive; } return a; }
function makeIR(c, dur, o){
  const sr = c.sampleRate, n = Math.floor(sr * dur), b = c.createBuffer(2, n, sr), r = srng(o.seed), pre = Math.floor(sr * (o.pre || .012));
  for (let ch = 0; ch < 2; ch++){
    const d = b.getChannelData(ch); let lp = 0;
    for (let i = pre; i < n; i++){ const u = (i - pre) / (n - pre), k = o.d0 + (o.d1 - o.d0) * u; lp += (r() * 2 - 1 - lp) * k; d[i] = lp * Math.pow(1 - u, o.shape) * Math.exp(-u * o.decay); }
    for (let e = 0; e < (o.early || 0); e++){ const i = pre + Math.floor(sr * (.003 + r() * .06)); if (i < n) d[i] += (r() - .5) * 1.4 * (1 - e / o.early); }
    for (let i = 0; i < 64 && i < n; i++) d[n - 1 - i] *= i / 64;
  }
  return b;
}
function auGraph(c){
  const G = { c }, gn = v => { const g = c.createGain(); g.gain.value = v; return g; };
  const lim = c.createDynamicsCompressor(); lim.threshold.value = -6; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = .001; lim.release.value = .12;
  G.ceil = gn(db(-1.2)); lim.connect(G.ceil); G.ceil.connect(c.destination);
  const tape = c.createWaveShaper(); tape.curve = tapeCurve(.7, .02); tape.oversample = '2x'; tape.connect(lim);
  const glue = c.createDynamicsCompressor(); glue.threshold.value = -14; glue.knee.value = 10; glue.ratio.value = 2; glue.attack.value = .015; glue.release.value = .3; glue.connect(tape);
  G.master = gn(1); G.master.connect(glue); G.tape = tape; G.glue = glue; G.lim = lim;
  G.music = gn(1); G.sfx = gn(1); G.amb = gn(1); G.ui = gn(1); G.duck = gn(1);
  const mt = c.createWaveShaper(); mt.curve = tapeCurve(1.3, .04); const mlp = c.createBiquadFilter(); mlp.type = 'lowpass'; mlp.frequency.value = 12500; mlp.Q.value = .5;
  G.music.connect(mt); mt.connect(mlp); mlp.connect(G.duck); G.duck.connect(G.master);
  G.sfx.connect(G.master); G.amb.connect(G.master); G.ui.connect(G.master);
  G.hall = gn(1); const hc = c.createConvolver(); hc.buffer = makeIR(c, 3.6, { seed: 3, d0: .85, d1: .12, shape: 1.4, decay: 2.2, pre: .02 }); const hr = gn(.55); G.hall.connect(hc); hc.connect(hr); hr.connect(G.master);
  const ms = gn(.3); G.duck.connect(ms); ms.connect(G.hall);
  G.room = gn(1); const oc = c.createConvolver(); oc.buffer = makeIR(c, 1.2, { seed: 5, d0: .7, d1: .2, shape: 2, decay: 3, pre: .008, early: 6 });
  const cc = c.createConvolver(); cc.buffer = makeIR(c, 2.6, { seed: 9, d0: .5, d1: .1, shape: 1.2, decay: 1.6, pre: .025, early: 14 });
  G.openG = gn(.9); G.caveG = gn(0); G.room.connect(oc); oc.connect(G.openG); G.openG.connect(G.master); G.room.connect(cc); cc.connect(G.caveG); G.caveG.connect(G.master);
  const ss = gn(.14); G.sfx.connect(ss); ss.connect(G.room); const as = gn(.12); G.amb.connect(as); as.connect(G.room);
  // keep the reverbs awake: a convolver that idles and wakes again can glitch on its first block, so feed both a -110 dB floor
  if (c.createConstantSource){ const k = c.createConstantSource(); k.offset.value = 3e-6; k.connect(G.hall); k.connect(G.room); k.start(); }
  G.bus = { s: G.sfx, a: G.amb, u: G.ui, m: G.music };
  return G;
}
function applyVol(){ const G = AU.G; if (!G) return; const t = AU.ctx.currentTime, V = AU.vol, B = AU.base;
  G.master.gain.setTargetAtTime(AU.muted ? 0 : V.master * B.master, t, .05);
  for (const k of ['music', 'sfx', 'amb', 'ui']) G[k].gain.setTargetAtTime(V[k] * B[k], t, .05); }
/* ---- synthesis primitives: all take (context, output, time) so they run live or offline ---- */
function O(c, o, t, type, f0, f1, dur, pk, a){ const s = c.createOscillator(), g = c.createGain(); s.type = type; s.frequency.setValueAtTime(f0, t); if (f1 && f1 !== f0) s.frequency.exponentialRampToValueAtTime(f1, t + dur); a = a || .003;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + a); g.gain.setTargetAtTime(0, t + a, dur / 5); s.connect(g); g.connect(o); s.start(t); s.stop(t + a + dur * 1.5 + .02); return s; }
function N(c, o, t, dur, type, f0, q, pk, a, f1){ const X = aux(c), s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); s.buffer = X.wn; f.type = type; f.frequency.setValueAtTime(f0, t); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur); f.Q.value = q; a = a || .002;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + a); g.gain.setTargetAtTime(0, t + a, dur / 5); s.connect(f); f.connect(g); g.connect(o); s.start(t, X.r() * 1.2, a + dur * 1.5 + .03); }
function W(c, o, t, dur, type, f0, fm, f1, q, pk, at){ const X = aux(c), s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); s.buffer = X.wn; f.type = type; f.Q.value = q; const tp = t + dur * Math.max(.05, at);
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(fm, tp); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, tp); g.gain.linearRampToValueAtTime(0, t + dur); s.connect(f); f.connect(g); g.connect(o); s.start(t, X.r() * 1.2, dur + .05); }
function F(c, o, t, f, ratio, idx, dur, pk, a){ const car = c.createOscillator(), mod = c.createOscillator(), mg = c.createGain(), g = c.createGain(); car.frequency.value = f; mod.frequency.value = f * ratio;
  mg.gain.setValueAtTime(f * idx, t); mg.gain.setTargetAtTime(f * idx * .08, t, dur / 4); mod.connect(mg); mg.connect(car.frequency); a = a || .003;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + a); g.gain.setTargetAtTime(0, t + a, dur / 5); car.connect(g); g.connect(o); const e = t + a + dur * 1.5 + .02; car.start(t); mod.start(t); car.stop(e); mod.stop(e); }
function BQ(c, o, type, f, q){ const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.connect(o); return b; }
/* ---- the effect palette: [len, variants (0 = synthesised live), priority, bus, peak or gain, pitch variance, room send, hall send, duck] ---- */
const SFXD = {};
function SD(k, o, f){ SFXD[k] = Object.assign({ k, len: .3, n: 2, pri: 2, bus: 's', pk: db(-14), g: 1, pv: .05, wet: .08, h: 0, dk: 0, dh: 0 }, o, { f }); }
// movement: footsteps by material, jump, land, slide, mantle, sprint breath, dash, sail, flap
SD('step:grass', { len: .18, n: 4, pri: 1, pk: db(-17), pv: .07 }, (c, o, t, r) => { N(c, o, t, .018, 'bandpass', 2400 + r() * 900, 1.4, .25); N(c, o, t + .003, .09, 'lowpass', 480 + r() * 240, .7, .9, .006); O(c, o, t, 'sine', 110, 60, .055, .5); N(c, o, t + .035 + r() * .02, .07, 'bandpass', 1500 + r() * 600, 1.1, .12, .01); });
SD('step:sand', { len: .22, n: 4, pri: 1, pk: db(-18), pv: .07 }, (c, o, t, r) => { N(c, o, t, .13, 'highpass', 1600 + r() * 900, .6, .5, .02); N(c, o, t, .06, 'lowpass', 380, .7, .6, .006); N(c, o, t + .05, .08, 'bandpass', 4200, 1, .12, .02); });
SD('step:stone', { len: .14, n: 4, pri: 1, pk: db(-17), pv: .07 }, (c, o, t, r) => { N(c, o, t, .02, 'bandpass', 3000 + r() * 1200, 1.8, .7); O(c, o, t, 'sine', 190 + r() * 30, 120, .045, .5); N(c, o, t + .004, .05, 'lowpass', 900, .8, .35); N(c, o, t + .02, .04, 'highpass', 5000, .7, .08); });
SD('step:wood', { len: .2, n: 4, pri: 1, pk: db(-16), pv: .07 }, (c, o, t, r) => { O(c, o, t, 'triangle', 220 + r() * 30, 150, .07, .7); O(c, o, t + .002, 'sine', 440 + r() * 40, 430, .12, .12); N(c, o, t, .035, 'bandpass', 1100, 1.2, .5); N(c, o, t + .01, .06, 'lowpass', 500, .7, .3); });
SD('step:glass', { len: .16, n: 3, pri: 1, pk: db(-18), pv: .06 }, (c, o, t, r) => { N(c, o, t, .015, 'bandpass', 5200, 3, .6); O(c, o, t, 'sine', 2600 + r() * 300, 2580, .08, .15); O(c, o, t + .004, 'sine', 3900 + r() * 300, 3880, .06, .08); N(c, o, t, .05, 'lowpass', 700, .7, .4); });
SD('step:leaf', { len: .18, n: 4, pri: 1, pk: db(-19), pv: .08 }, (c, o, t, r) => { for (let i = 0; i < 5; i++) N(c, o, t + r() * .07, .025 + r() * .02, 'bandpass', 2800 + r() * 3500, 1.6, .35); N(c, o, t, .06, 'lowpass', 520, .7, .6, .006); });
SD('jump', { len: .25, n: 3, pri: 3, pk: db(-17) }, (c, o, t, r) => { W(c, o, t, .16, 'bandpass', 500, 1500, 1100, .9, .6, .35); O(c, o, t, 'sine', 130, 210, .07, .35); N(c, o, t, .02, 'lowpass', 600, .7, .4); });
SD('land', { len: .45, n: 3, pri: 3, pk: db(-10) }, (c, o, t, r) => { O(c, o, t, 'sine', 120, 42, .2, 1); N(c, o, t, .22, 'lowpass', 360, .8, .9, .004); N(c, o, t + .006, .09, 'bandpass', 1900 + r() * 600, 1, .25); for (let i = 0; i < 4; i++) N(c, o, t + .05 + r() * .15, .03, 'bandpass', 2500 + r() * 2500, 2, .08); });
SD('slide', { len: .75, n: 2, pri: 2, pk: db(-13) }, (c, o, t, r) => { W(c, o, t, .6, 'lowpass', 1400, 1100, 450, .6, .8, .12); N(c, o, t, .55, 'bandpass', 3200, 2, .12, .05); for (let i = 0; i < 12; i++) N(c, o, t + .03 + r() * .5, .012, 'bandpass', 2000 + r() * 4000, 3, .12 * (1 - i / 14)); });
SD('vault', { len: .3, n: 3, pri: 3, pk: db(-14) }, (c, o, t, r) => { N(c, o, t, .035, 'bandpass', 1500 + r() * 400, 1.1, .8); O(c, o, t, 'sine', 170, 110, .05, .4); W(c, o, t + .03, .17, 'bandpass', 600, 1300, 800, .9, .35, .4); });
SD('breath', { len: .55, n: 3, pri: 1, pk: db(-25), wet: 0 }, (c, o, t, r) => { W(c, o, t, .42, 'bandpass', 900, 1300, 1000, .8, .6, .35); W(c, o, t, .32, 'bandpass', 1800, 2200, 1900, 2, .2, .3); });
SD('dash', { len: .5, n: 3, pri: 3, pk: db(-9) }, (c, o, t, r) => { W(c, o, t, .38, 'bandpass', 300, 2600, 600, .8, 1, .35); O(c, o, t, 'sine', 95, 48, .26, .6); N(c, o, t + .02, .22, 'highpass', 4200, .7, .15, .04); });
SD('sail', { len: .7, n: 2, pri: 3, pk: db(-11) }, (c, o, t, r) => { [0, .05, .11, .18, .27].forEach((d, i) => N(c, o, t + d, .07, 'bandpass', 650 + i * 130 + r() * 80, 1.2, .9 * (1 - i * .13), .004)); W(c, o, t, .55, 'bandpass', 350, 1100, 600, .7, .4, .45); });
SD('flap', { len: .45, n: 3, pri: 3, pk: db(-10) }, (c, o, t, r) => { N(c, o, t, .18, 'bandpass', 420 + r() * 80, .9, 1, .01); N(c, o, t, .16, 'lowpass', 240, .7, .8, .01); W(c, o, t + .04, .3, 'bandpass', 600, 1500, 900, .9, .3, .3); O(c, o, t, 'triangle', 220, 360, .18, .1); });
// grappling hook: fire twang, rope whirr, thunk per material, creak, ratchet reel, release
SD('gFire', { len: .45, n: 3, pri: 3, pk: db(-10) }, (c, o, t, r) => { N(c, o, t, .012, 'bandpass', 4200, 3, .6); O(c, o, t, 'triangle', 340 + r() * 30, 240, .28, .5); O(c, o, t, 'sine', 1020, 770, .14, .18); W(c, o, t + .01, .26, 'bandpass', 1400, 5200, 3800, 3, .4, .6); });
SD('gWhirr', { len: .6, n: 2, pri: 2, pk: db(-21) }, (c, o, t, r) => { for (let i = 0; i < 14; i++) N(c, o, t + i * .04, .03, 'bandpass', 2100 + i * 40, 4, (1 - i / 16) * .6, .006); });
SD('gThunk:stone', { len: .4, n: 2, pri: 3, pk: db(-9) }, (c, o, t, r) => { N(c, o, t, .03, 'bandpass', 2700, 1.4, 1); O(c, o, t, 'sine', 150, 58, .16, .9); N(c, o, t + .004, .1, 'lowpass', 900, .8, .5); for (let i = 0; i < 5; i++) N(c, o, t + .03 + r() * .2, .02, 'bandpass', 2000 + r() * 3000, 2, .12); });
SD('gThunk:wood', { len: .4, n: 2, pri: 3, pk: db(-9) }, (c, o, t, r) => { O(c, o, t, 'triangle', 250, 150, .12, 1); N(c, o, t, .05, 'bandpass', 950, 1.3, .7); O(c, o, t, 'sine', 520, 515, .22, .12); N(c, o, t + .01, .08, 'lowpass', 600, .8, .4); });
SD('gThunk:soft', { len: .35, n: 2, pri: 3, pk: db(-10) }, (c, o, t, r) => { N(c, o, t, .16, 'lowpass', 520, .8, 1, .004); O(c, o, t, 'sine', 110, 48, .13, .8); N(c, o, t + .01, .06, 'bandpass', 1800, 1, .2); });
SD('gThunk:glass', { len: .6, n: 2, pri: 3, pk: db(-10) }, (c, o, t, r) => { N(c, o, t, .015, 'bandpass', 4800, 3, .8); O(c, o, t, 'sine', 2900, 2880, .32, .25); O(c, o, t, 'sine', 4130, 4100, .22, .15); O(c, o, t, 'sine', 140, 70, .1, .5); });
SD('gCreak', { len: .4, n: 3, pri: 2, pk: db(-20) }, (c, o, t, r) => { const f = BQ(c, o, 'bandpass', 800 + r() * 300, 5); O(c, f, t, 'sawtooth', 120 + r() * 40, 95 + r() * 30, .26, .9, .05); O(c, f, t + .03, 'sawtooth', 180 + r() * 30, 150, .18, .4, .04); });
SD('gReel', { len: .4, n: 2, pri: 2, pk: db(-15) }, (c, o, t, r) => { for (let i = 0; i < 9; i++){ N(c, o, t + i * .032, .012, 'bandpass', 3100 + r() * 300, 6, 1 - i * .07); O(c, o, t + i * .032, 'sine', 1800, 1790, .012, .15); } });
SD('gRelease', { len: .4, n: 2, pri: 3, pk: db(-14) }, (c, o, t, r) => { N(c, o, t, .025, 'bandpass', 2600, 2, 1); O(c, o, t, 'triangle', 600, 900, .06, .3); W(c, o, t + .02, .3, 'bandpass', 600, 1700, 700, .8, .4, .35); });
// blocks: mining hits, crack ticks, breaks, place, pickup
SD('hit:stone', { len: .2, n: 4, pri: 2, pk: db(-14) }, (c, o, t, r) => { N(c, o, t, .03, 'bandpass', 1900 + r() * 500, 1.5, 1); O(c, o, t, 'sine', 230 + r() * 40, 160, .05, .4); N(c, o, t + .01, .06, 'highpass', 4500, .7, .12); });
SD('hit:wood', { len: .22, n: 4, pri: 2, pk: db(-14) }, (c, o, t, r) => { O(c, o, t, 'triangle', 270 + r() * 40, 190, .07, .8); N(c, o, t, .04, 'bandpass', 850 + r() * 200, 1.3, .7); O(c, o, t, 'sine', 540, 535, .1, .1); });
SD('hit:soft', { len: .2, n: 4, pri: 2, pk: db(-15) }, (c, o, t, r) => { N(c, o, t, .07, 'lowpass', 620 + r() * 200, .8, 1, .004); N(c, o, t, .03, 'bandpass', 1700, 1.2, .25); O(c, o, t, 'sine', 120, 70, .05, .4); });
SD('hit:leaf', { len: .2, n: 3, pri: 2, pk: db(-17) }, (c, o, t, r) => { for (let i = 0; i < 4; i++) N(c, o, t + r() * .05, .03, 'bandpass', 2500 + r() * 3500, 1.5, .6); N(c, o, t, .05, 'lowpass', 600, .7, .4); });
SD('hit:glass', { len: .25, n: 3, pri: 2, pk: db(-15) }, (c, o, t, r) => { N(c, o, t, .015, 'bandpass', 4600, 3, 1); O(c, o, t, 'sine', 2500 + r() * 400, 2480, .1, .25); O(c, o, t, 'sine', 3700 + r() * 300, 3680, .07, .12); });
SD('flesh', { len: .25, n: 4, pri: 3, pk: db(-9) }, (c, o, t, r) => { N(c, o, t, .08, 'lowpass', 520 + r() * 150, .9, 1, .003); O(c, o, t, 'sine', 150, 62, .09, .9); N(c, o, t, .03, 'bandpass', 1300 + r() * 400, 1.2, .5); N(c, o, t + .005, .02, 'highpass', 3500, .7, .2); });
SD('crit', { len: .6, n: 2, pri: 3, pk: db(-7), h: .2 }, (c, o, t, r) => { N(c, o, t, .08, 'lowpass', 520, .9, 1); O(c, o, t, 'sine', 160, 60, .1, .9); N(c, o, t, .02, 'highpass', 5000, .7, .4); O(c, o, t + .01, 'sine', 2093, 2090, .38, .22); O(c, o, t + .01, 'sine', 3140, 3135, .26, .12); O(c, o, t + .01, 'triangle', 1047, 1046, .3, .12); });
SD('crack', { len: .08, n: 3, pri: 2, pk: db(-22) }, (c, o, t, r) => { N(c, o, t, .014, 'bandpass', 3400 + r() * 800, 5, 1); N(c, o, t + .004, .025, 'bandpass', 1700, 2, .4); });
SD('brk:stone', { len: .6, n: 3, pri: 2, pk: db(-10) }, (c, o, t, r) => { N(c, o, t, .03, 'bandpass', 2400, 1.2, 1); N(c, o, t, .24, 'bandpass', 1000 + r() * 300, .8, .9, .004); O(c, o, t, 'sine', 210, 80, .16, .7); for (let i = 0; i < 8; i++) N(c, o, t + .05 + r() * .35, .02 + r() * .03, 'bandpass', 1500 + r() * 3500, 2.5, .25 * (1 - i / 9)); });
SD('brk:wood', { len: .55, n: 3, pri: 2, pk: db(-10) }, (c, o, t, r) => { O(c, o, t, 'triangle', 230, 120, .14, .9); N(c, o, t, .2, 'bandpass', 700 + r() * 200, .9, .8, .004); N(c, o, t, .02, 'highpass', 3000, .7, .3); for (let i = 0; i < 6; i++) N(c, o, t + .05 + r() * .3, .03, 'bandpass', 800 + r() * 1500, 2, .25 * (1 - i / 7)); });
SD('brk:soft', { len: .5, n: 3, pri: 2, pk: db(-11) }, (c, o, t, r) => { N(c, o, t, .22, 'lowpass', 650, .8, 1, .004); O(c, o, t, 'sine', 130, 60, .12, .6); for (let i = 0; i < 6; i++) N(c, o, t + .04 + r() * .3, .03, 'bandpass', 900 + r() * 1600, 1.5, .25 * (1 - i / 7)); });
SD('brk:sand', { len: .5, n: 2, pri: 2, pk: db(-12) }, (c, o, t, r) => { N(c, o, t, .3, 'highpass', 1500, .6, .8, .01); N(c, o, t, .14, 'lowpass', 420, .8, 1, .004); W(c, o, t + .05, .3, 'bandpass', 2500, 3500, 2000, .8, .3, .2); });
SD('brk:leaf', { len: .45, n: 3, pri: 2, pk: db(-13) }, (c, o, t, r) => { for (let i = 0; i < 10; i++) N(c, o, t + r() * .25, .04, 'bandpass', 2200 + r() * 4500, 1.4, .6 * (1 - i / 12)); N(c, o, t, .12, 'lowpass', 700, .7, .5); });
SD('brk:glass', { len: .8, n: 2, pri: 2, pk: db(-10) }, (c, o, t, r) => { N(c, o, t, .02, 'highpass', 3000, .7, 1); O(c, o, t, 'sine', 1800, 2600, .2, .3); for (let i = 0; i < 12; i++){ const d = r() * .45; O(c, o, t + d, 'sine', 3000 + r() * 4500, 0, .05 + r() * .08, .25 * (1 - d)); } N(c, o, t, .3, 'highpass', 5000, .7, .3, .004); });
SD('place', { len: .25, n: 3, pri: 2, pk: db(-12) }, (c, o, t, r) => { O(c, o, t, 'sine', 165 + r() * 20, 72, .1, 1); N(c, o, t, .07, 'lowpass', 900, .9, .6); N(c, o, t, .012, 'bandpass', 2600, 2, .35); });
SD('pickup', { len: .4, n: 1, pri: 2, pk: db(-17), pv: .004, h: .2 }, (c, o, t, r) => { O(c, o, t, 'sine', 1320, 1322, .14, .6); O(c, o, t + .045, 'triangle', 1980, 1982, .12, .25); O(c, o, t + .07, 'sine', 2640, 2642, .16, .18); });
// combat: swings by weight, hurt, heartbeat, death and respawn
SD('swing:l', { len: .25, n: 3, pri: 2, pk: db(-15) }, (c, o, t, r) => { W(c, o, t, .16, 'bandpass', 900, 3400, 1600, 1.1, 1, .45); });
SD('swing:m', { len: .3, n: 3, pri: 2, pk: db(-13) }, (c, o, t, r) => { W(c, o, t, .22, 'bandpass', 600, 2500, 1000, 1, 1, .5); W(c, o, t, .2, 'highpass', 3000, 5000, 3500, .7, .3, .5); });
SD('swing:h', { len: .45, n: 3, pri: 2, pk: db(-11) }, (c, o, t, r) => { W(c, o, t, .34, 'bandpass', 280, 1500, 500, .9, 1, .55); O(c, o, t + .1, 'sine', 80, 50, .2, .4); });
SD('hurt', { len: .5, n: 2, pri: 4, pk: db(-8), dk: -4, dh: .4 }, (c, o, t, r) => { O(c, o, t, 'sine', 160, 55, .22, 1); N(c, o, t, .16, 'lowpass', 850, .9, .7); O(c, o, t + .01, 'triangle', 330, 300, .25, .15); O(c, o, t + .01, 'triangle', 349, 318, .25, .15); N(c, o, t, .015, 'highpass', 3000, .7, .3); });
SD('heartbeat', { len: .5, n: 1, pri: 3, pk: db(-14), wet: 0, pv: .01 }, (c, o, t, r) => { O(c, o, t, 'sine', 72, 44, .13, 1, .006); N(c, o, t, .06, 'lowpass', 180, .7, .5); O(c, o, t + .2, 'sine', 62, 40, .11, .75, .006); N(c, o, t + .2, .05, 'lowpass', 160, .7, .35); });
SD('die', { len: 2.2, n: 0, pri: 4, g: 1.6, h: .4, dk: -12, dh: 2 }, (c, o, t, r, p) => { [392, 330, 262, 196].forEach((f, i) => F(c, o, t + i * .15, f, 1, 1.2, .8, .12, .01)); O(c, o, t, 'sine', 90, 35, 1.2, .4, .01); W(c, o, t, 1.2, 'lowpass', 400, 900, 200, .7, .25, .2); });
SD('respawn', { len: 1.6, n: 0, pri: 4, g: 1.4, h: .4 }, (c, o, t, r, p) => { [523, 659, 784, 1047, 1319].forEach((f, i) => O(c, o, t + .1 + i * .07, 'sine', f, 0, .9, .06, .01)); W(c, o, t, .9, 'highpass', 800, 4000, 6000, .7, .15, .8); });
// enemies (0 slime, 1 goblin, 2 sentinel, 3 wisp, 4 archer): telegraph cue, attack, death
SD('tele:0', { len: .5, n: 2, pri: 3, pk: db(-13) }, (c, o, t, r) => { O(c, o, t, 'sine', 170, 430, .32, .7, .02); const f = BQ(c, o, 'bandpass', 900, 4); O(c, f, t, 'triangle', 200, 520, .3, .4, .03); N(c, o, t + .2, .08, 'bandpass', 1200, 3, .15); });
SD('tele:1', { len: .55, n: 2, pri: 3, pk: db(-13) }, (c, o, t, r) => { const f = BQ(c, o, 'bandpass', 700 + r() * 100, 3); O(c, f, t, 'sawtooth', 92, 124, .42, 1, .06); O(c, f, t, 'sawtooth', 94, 121, .42, .6, .06); N(c, o, t, .3, 'lowpass', 380, .8, .4, .08); });
SD('tele:2', { len: 1.4, n: 2, pri: 3, pk: db(-12) }, (c, o, t, r) => { const f = BQ(c, o, 'lowpass', 500, 1.5); O(c, f, t, 'sawtooth', 52, 108, 1, .8, .6); O(c, o, t, 'sine', 210, 440, 1, .25, .7); W(c, o, t, 1, 'bandpass', 400, 2400, 2600, 2, .3, .9); });
SD('tele:3', { len: .6, n: 2, pri: 3, pk: db(-15) }, (c, o, t, r) => { for (let i = 0; i < 6; i++) O(c, o, t + i * .06, 'sine', 1200 + i * 190 + r() * 60, 0, .25, .25, .02); O(c, o, t, 'sine', 900, 1800, .5, .25, .2); });
SD('tele:4', { len: .55, n: 2, pri: 3, pk: db(-14) }, (c, o, t, r) => { const f = BQ(c, o, 'bandpass', 1000, 6); O(c, f, t, 'sawtooth', 140, 200, .45, .9, .15); N(c, o, t + .38, .01, 'bandpass', 3500, 4, .4); });
SD('atk:0', { len: .35, n: 2, pri: 3, pk: db(-12) }, (c, o, t, r) => { O(c, o, t, 'triangle', 180, 520, .26, .8); N(c, o, t, .08, 'lowpass', 700, 1, .5); for (let i = 0; i < 3; i++) O(c, o, t + .05 + i * .04, 'sine', 600 + r() * 400, 900, .05, .15); });
SD('atk:1', { len: .3, n: 2, pri: 3, pk: db(-12) }, (c, o, t, r) => { W(c, o, t, .2, 'bandpass', 700, 2600, 1200, 1, 1, .4); const f = BQ(c, o, 'bandpass', 650, 3); O(c, f, t, 'sawtooth', 150, 105, .18, .6, .01); });
SD('atk:2', { len: .75, n: 2, pri: 3, pk: db(-8) }, (c, o, t, r) => { O(c, o, t, 'sine', 90, 32, .6, 1, .004); N(c, o, t, .5, 'lowpass', 380, .9, .9, .004); N(c, o, t, .03, 'bandpass', 1800, 1, .4); for (let i = 0; i < 6; i++) N(c, o, t + .05 + r() * .3, .03, 'bandpass', 800 + r() * 2000, 2, .2); });
SD('atk:3', { len: .35, n: 2, pri: 3, pk: db(-13) }, (c, o, t, r) => { O(c, o, t, 'sine', 1400, 400, .22, .5, .004); W(c, o, t, .25, 'highpass', 2500, 6000, 3000, .7, .4, .2); O(c, o, t, 'square', 700, 240, .1, .08); });
SD('atk:4', { len: .4, n: 2, pri: 3, pk: db(-12) }, (c, o, t, r) => { O(c, o, t, 'triangle', 300, 280, .25, .7); O(c, o, t, 'sine', 900, 880, .12, .2); W(c, o, t + .02, .32, 'bandpass', 1600, 3800, 2200, 2, .35, .3); });
for (let k = 0; k < 5; k++) SD('eDie:' + k, { len: .8, n: 2, pri: 3, pk: db(-11), h: .15 }, (c, o, t, r) => { O(c, o, t, 'triangle', 400 - k * 40, 80, .35, .7); N(c, o, t + .04, .25, 'lowpass', 900, 1, .5); W(c, o, t, .4, 'highpass', 2000, 5000, 3000, .7, .2, .2); [660, 880].forEach((f, i) => O(c, o, t + .12 + i * .06, 'sine', f * (1 + k * .06), 0, .3, .18)); });
SD('notice', { len: .3, n: 1, pri: 3, pk: db(-16) }, (c, o, t, r) => { O(c, o, t, 'triangle', 820, 1100, .08, .6); O(c, o, t + .08, 'triangle', 1100, 1420, .1, .5); });
// chests: creak, latch, sparkle; rarity stingers and big rewards
SD('chestCreak', { len: .55, n: 2, pri: 3, pk: db(-14) }, (c, o, t, r) => { const f = BQ(c, o, 'bandpass', 600 + r() * 150, 7); O(c, f, t, 'sawtooth', 85, 135, .45, 1, .08); O(c, f, t + .1, 'sawtooth', 120, 150, .3, .5, .05); });
SD('latch', { len: .2, n: 2, pri: 3, pk: db(-12) }, (c, o, t, r) => { N(c, o, t, .015, 'bandpass', 3200, 3, 1); O(c, o, t, 'sine', 1900, 1880, .06, .25); N(c, o, t + .05, .012, 'bandpass', 2600, 3, .6); });
SD('sparkle', { len: .8, n: 2, pri: 2, pk: db(-19), h: .4 }, (c, o, t, r) => { for (let i = 0; i < 9; i++) O(c, o, t + r() * .5, 'sine', 2200 + r() * 3500, 0, .15 + r() * .15, .25); });
for (let k = 0; k < 4; k++) SD('sting:' + k, { len: 1.6, n: 0, pri: 4, g: 1.3, h: .45, dk: -4 - k, dh: .8 + k * .3 }, (c, o, t, r) => { const n = [[72, 79], [72, 76, 79], [72, 76, 79, 84], [72, 76, 79, 83, 86, 91]][k]; n.forEach((m, i) => { F(c, o, t + i * .075, mtof(m), 2, k > 1 ? 1.8 : 1.2, 1.1, .07, .004); O(c, o, t + i * .075, 'triangle', mtof(m), 0, .6, .03); }); if (k >= 2) O(c, o, t, 'sine', mtof(48), 0, 1.2, .12, .05); if (k >= 3) W(c, o, t, 1.4, 'highpass', 3000, 7000, 5000, .7, .06, .6); });
SD('legendary', { len: 2.6, n: 0, pri: 4, g: 1.3, h: .5, dk: -9, dh: 2.2 }, (c, o, t, r) => { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => { F(c, o, t + i * .09, f, 3.5, 2.5, 1.8, .07, .004); O(c, o, t + i * .09, 'sine', f * 2, 0, .7, .025); }); O(c, o, t, 'sine', 65.4, 0, 2.4, .2, .3); W(c, o, t, 1.8, 'highpass', 2000, 8000, 6000, .7, .1, .7); });
SD('reward', { len: 1.8, n: 0, pri: 4, g: 1.3, h: .5, dk: -7, dh: 1.6 }, (c, o, t, r) => { [523, 784, 1047, 1319, 1568].forEach((f, i) => F(c, o, t + i * .07, f, 2, 1.2, 1.2, .08, .004)); for (let i = 0; i < 6; i++) O(c, o, t + .3 + r() * .5, 'sine', 3000 + r() * 2500, 0, .2, .03); });
// creatures: voices, birds, owl, crickets, drips; pet and feed
SD('voice:puffle', { len: .5, n: 3, pri: 1, pk: db(-14) }, (c, o, t, r) => { const f = BQ(c, o, 'bandpass', 700, 1.5); O(c, f, t, 'sine', 330 + r() * 40, 240, .34, 1, .04); O(c, f, t, 'triangle', 332, 242, .3, .4, .05); O(c, o, t, 'sine', 660, 480, .2, .15, .04); });
SD('voice:kit', { len: .5, n: 3, pri: 1, pk: db(-15) }, (c, o, t, r) => { const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3; f.frequency.setValueAtTime(900, t); f.frequency.linearRampToValueAtTime(1700, t + .15); f.frequency.linearRampToValueAtTime(1000, t + .35); f.connect(o);
  const s = c.createOscillator(), g = c.createGain(); s.type = 'sawtooth'; s.frequency.setValueAtTime(620 + r() * 80, t); s.frequency.linearRampToValueAtTime(980 + r() * 120, t + .12); s.frequency.linearRampToValueAtTime(700, t + .34);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + .03); g.gain.setTargetAtTime(0, t + .26, .04); s.connect(g); g.connect(f); s.start(t); s.stop(t + .5); });
SD('voice:jelly', { len: .4, n: 3, pri: 1, pk: db(-15), h: .2 }, (c, o, t, r) => { for (let i = 0; i < 4; i++) O(c, o, t + i * .065, 'sine', 500 + i * 120 + r() * 80, 900 + i * 150, .07, .6, .006); });
for (let k = 0; k < 4; k++) SD('bird:' + k, { len: .55, n: 2, pri: 0, bus: 'a', pk: db(-24), wet: .15, pv: .06 }, (c, o, t, r) => {
  if (k === 0){ O(c, o, t, 'sine', 2800, 3300, .12, .8, .01); O(c, o, t + .18, 'sine', 3100, 2500, .16, .7, .01); }
  else if (k === 1){ for (let i = 0; i < 9; i++) O(c, o, t + i * .035, 'sine', 4200 + r() * 300, 3900, .03, .5, .004); }
  else if (k === 2){ for (let i = 0; i < 3; i++) O(c, o, t + i * .13, 'sine', 3800, 2300, .07, .8, .004); }
  else { const s = c.createOscillator(), l = c.createOscillator(), lg = c.createGain(), g = c.createGain(); s.frequency.value = 2500 + r() * 400; l.frequency.value = 28; lg.gain.value = 320; l.connect(lg); lg.connect(s.frequency); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.6, t + .03); g.gain.setTargetAtTime(0, t + .3, .04); s.connect(g); g.connect(o); s.start(t); l.start(t); s.stop(t + .5); l.stop(t + .5); } });
SD('owl', { len: 1.3, n: 2, pri: 0, bus: 'a', pk: db(-23), wet: .3 }, (c, o, t, r) => { const f = BQ(c, o, 'lowpass', 900, .7); O(c, f, t, 'sine', 390, 370, .32, 1, .06); O(c, f, t + .45, 'sine', 380, 350, .25, .8, .05); O(c, f, t + .75, 'sine', 385, 355, .4, .9, .06); N(c, o, t, .3, 'bandpass', 400, 2, .05, .05); });
SD('cricket', { len: .3, n: 3, pri: 0, bus: 'a', pk: db(-25), wet: .1 }, (c, o, t, r) => { const f0 = 4300 + r() * 500; for (let i = 0; i < 5; i++) O(c, o, t + i * .042, 'sine', f0, f0 * .99, .022, .8, .003); });
SD('drip', { len: .25, n: 3, pri: 0, bus: 'a', pk: db(-15), wet: .5 }, (c, o, t, r) => { O(c, o, t, 'sine', 1700 + r() * 400, 800, .06, 1, .001); O(c, o, t + .025, 'sine', 900, 1300, .05, .4, .002); });
SD('heart', { len: .9, n: 0, pri: 2, g: 1.2, h: .35 }, (c, o, t, r) => { F(c, o, t, 1047, 2, 1, .5, .07); F(c, o, t + .09, 1568, 2, 1, .6, .055); });
SD('eat', { len: .55, n: 2, pri: 3, pk: db(-13) }, (c, o, t, r) => { for (let i = 0; i < 3; i++){ N(c, o, t + i * .09, .05, 'bandpass', 1800 + i * 300 + r() * 200, 2.5, .8); N(c, o, t + i * .09, .03, 'lowpass', 400, .8, .5); } O(c, o, t + .32, 'sine', 330, 495, .12, .3); });
// interface
SD('ui', { len: .08, n: 2, pri: 4, bus: 'u', pk: db(-16), wet: 0 }, (c, o, t, r) => { O(c, o, t, 'sine', 1250, 900, .03, 1, .002); N(c, o, t, .008, 'bandpass', 3200, 2, .4); });
SD('hover', { len: .05, n: 1, pri: 4, bus: 'u', pk: db(-28), wet: 0 }, (c, o, t, r) => { O(c, o, t, 'sine', 1900, 1850, .02, 1, .002); });
SD('panel', { len: .35, n: 2, pri: 4, bus: 'u', pk: db(-20), wet: 0 }, (c, o, t, r) => { W(c, o, t, .24, 'bandpass', 500, 1900, 900, .8, 1, .4); N(c, o, t + .12, .08, 'bandpass', 3000, 1, .25, .02); });
SD('toast', { len: .7, n: 1, pri: 4, bus: 'u', pk: db(-21), h: .3, wet: 0 }, (c, o, t, r) => { F(c, o, t, 1568, 2, 1, .4, 1, .004); F(c, o, t + .08, 2093, 2, .8, .45, .7, .004); });
SD('deny', { len: .32, n: 1, pri: 4, bus: 'u', pk: db(-15), wet: 0 }, (c, o, t, r) => { O(c, o, t, 'triangle', 233, 220, .09, 1, .004); O(c, o, t + .11, 'triangle', 196, 185, .13, 1, .004); });
SD('craft', { len: .6, n: 2, pri: 4, bus: 'u', pk: db(-13), h: .3, wet: 0 }, (c, o, t, r) => { N(c, o, t, .02, 'bandpass', 2600, 3, 1); O(c, o, t, 'sine', 1320, 0, .3, .4); O(c, o, t + .08, 'sine', 1980, 0, .35, .35); O(c, o, t, 'triangle', 180, 120, .06, .5); });
SD('page', { len: .3, n: 2, pri: 4, bus: 'u', pk: db(-19), wet: 0 }, (c, o, t, r) => { W(c, o, t, .22, 'bandpass', 1800, 3500, 2600, .9, 1, .3); });
// world beats (rare, synthesised live with full tails)
SD('befriend', { len: 1, n: 0, pri: 4, g: 1.4, h: .4, dk: -4, dh: .8 }, (c, o, t, r) => { [523, 659, 784, 1047].forEach((f, i) => { F(c, o, t + i * .08, f, 2, .8, .6, .06); O(c, o, t + i * .08, 'triangle', f, 0, .5, .04); }); });
SD('shard', { len: 1.2, n: 0, pri: 4, g: 1.4, h: .5, dk: -5, dh: 1 }, (c, o, t, r) => { [784, 988, 1175, 1568, 1976].forEach((f, i) => F(c, o, t + i * .06, f, 3.5, 1.5, .8, .06)); });
SD('waystone', { len: 2, n: 0, pri: 4, g: 1.4, h: .5, dk: -6, dh: 1.4 }, (c, o, t, r) => { O(c, o, t, 'triangle', 196, 0, 1.4, .1, .2); O(c, o, t, 'sine', 294, 0, 1.4, .07, .3); F(c, o, t + .2, 784, 3.5, 2, 1.4, .06); F(c, o, t + .35, 1175, 3.5, 2, 1.2, .045); });
SD('boing', { len: .45, n: 2, pri: 3, pk: db(-11) }, (c, o, t, r) => { O(c, o, t, 'triangle', 180, 620, .28, 1); O(c, o, t, 'sine', 90, 310, .28, .5); N(c, o, t, .05, 'lowpass', 500, .8, .4); });
SD('grow', { len: .3, n: 1, pri: 2, pk: db(-18), pv: .004 }, (c, o, t, r) => { O(c, o, t, 'triangle', 330, 336, .12, 1); N(c, o, t, .05, 'bandpass', 2500, 2, .4); });
SD('rescue', { len: 1, n: 0, pri: 4, g: 1.4, h: .4 }, (c, o, t, r) => { O(c, o, t, 'sine', 400, 800, .35, .1, .02); O(c, o, t + .2, 'sine', 600, 300, .5, .08, .02); W(c, o, t, .6, 'bandpass', 400, 1600, 600, .8, .12, .5); });
SD('whoosh', { len: .8, n: 2, pri: 3, pk: db(-11) }, (c, o, t, r) => { W(c, o, t, .7, 'bandpass', 300, 1800, 400, .8, 1, .45); W(c, o, t + .05, .5, 'highpass', 2500, 5000, 3000, .7, .25, .5); });
SD('chime', { len: 1.8, n: 1, pri: 2, pk: db(-15), pv: .002, h: .45 }, (c, o, t, r) => { O(c, o, t, 'sine', 587.3, 0, 1.4, .7, .002); O(c, o, t, 'sine', 587.3 * 2.01, 0, .7, .2, .002); O(c, o, t, 'sine', 587.3 * 3.98, 0, .25, .08, .002); });
SD('ring', { len: .8, n: 1, pri: 3, pk: db(-14), pv: .002, h: .4 }, (c, o, t, r) => { O(c, o, t, 'triangle', 784, 0, .5, .8, .003); O(c, o, t + .06, 'sine', 1176, 0, .5, .45, .003); });
SD('gift', { len: 3, n: 0, pri: 4, g: 1.3, h: .55 }, (c, o, t, r) => { W(c, o, t, 1.6, 'highpass', 2000, 7000, 5000, .7, .06, .7); for (let i = 0; i < 10; i++) O(c, o, t + .4 + r() * 1.2, 'sine', 2500 + r() * 3000, 0, .3, .025); });
// film: voxel builds and crumbles, risers, impacts, whooshes (on the music bus so they sit inside the score)
SD('voxClick', { len: .15, n: 1, pri: 1, bus: 'm', pk: db(-26), pv: .004, h: .5 }, (c, o, t, r) => { O(c, o, t, 'sine', 1175, 1178, .09, 1, .002); N(c, o, t, .02, 'highpass', 6000, 1, .3); });
SD('voxBuild', { len: 1.3, n: 1, pri: 1, bus: 'm', pk: db(-24), h: .3 }, (c, o, t, r) => { W(c, o, t, 1.2, 'highpass', 3000, 6500, 4000, .6, 1, .3); for (let i = 0; i < 10; i++) N(c, o, t + r() * 1, .01, 'bandpass', 4000 + r() * 4000, 4, .4); });
SD('voxCrumble', { len: 1.8, n: 0, pri: 3, bus: 'm', g: 1.2 }, (c, o, t, r) => { N(c, o, t, 1.6, 'lowpass', 140, .8, .3, .05); O(c, o, t, 'sine', 48, 30, 1.4, .18, .05); for (let k = 0; k < 14; k++) N(c, o, t + .1 + k * .07 + r() * .05, .05, 'bandpass', 900 + r() * 2400, 3, .05); });
SD('riser', { len: 3.4, n: 0, pri: 3, bus: 'm', g: 1, h: .3 }, (c, o, t, r) => { W(c, o, t, 3, 'bandpass', 300, 5200, 5600, 2.5, .14, .95); const f = BQ(c, o, 'lowpass', 1800, .7); O(c, f, t, 'sawtooth', 110, 440, 3, .025, 2.6); W(c, o, t + .6, 2.4, 'highpass', 5000, 9000, 9000, .6, .05, .97); });
SD('impact', { len: 2.6, n: 0, pri: 4, bus: 'm', g: 1, h: .5 }, (c, o, t, r, p) => { const a = p || 1; O(c, o, t, 'sine', 140, 40, .12, .7 * a, .002); O(c, o, t, 'sine', 62, 30, 1.6, .45 * a, .004); N(c, o, t, .35, 'lowpass', 260, .7, .3 * a); N(c, o, t, .06, 'bandpass', 3200, 1.2, .08 * a); W(c, o, t, 1.6, 'highpass', 4000, 7000, 5000, .7, .04 * a, .08); });
SD('cwhoosh', { len: 1, n: 0, pri: 3, bus: 'm', g: 1 }, (c, o, t, r) => { W(c, o, t, .9, 'bandpass', 400, 2600, 500, 1.2, .3, .38); });
SD('rumble', { len: 1.8, n: 0, pri: 3, bus: 'm', g: 1 }, (c, o, t, r) => { N(c, o, t, 1.6, 'lowpass', 140, .8, .3, .05); O(c, o, t, 'sine', 48, 30, 1.4, .18, .05); });
const STEPM = { grass: 'grass', soft: 'grass', sand: 'sand', stone: 'stone', wood: 'wood', glass: 'glass', leaf: 'leaf' };
const HITM = { grass: 'soft', soft: 'soft', sand: 'soft', stone: 'stone', wood: 'wood', glass: 'glass', leaf: 'leaf' };
const BRKM = { grass: 'soft', soft: 'soft', sand: 'sand', stone: 'stone', wood: 'wood', glass: 'glass', leaf: 'leaf' };
const THKM = { grass: 'soft', soft: 'soft', sand: 'soft', leaf: 'soft', stone: 'stone', wood: 'wood', glass: 'glass' };
/* ---- pre-render the busy one-shots: one offline render per batch, sliced, trimmed and peak-normalised ---- */
async function bakeAll(){
  const OAC = Wn.OfflineAudioContext || Wn.webkitOfflineAudioContext; if (!OAC) { AU.ready = true; return; }
  const c = AU.ctx, sr = 32000, keys = Object.keys(SFXD).filter(k => SFXD[k].n > 0);
  for (let bi = 0; bi < keys.length; bi += 10){
    const ks = keys.slice(bi, bi + 10), slots = []; let tot = 0;
    for (const k of ks) for (let v = 0; v < SFXD[k].n; v++){ slots.push([k, tot, SFXD[k].len]); tot += SFXD[k].len + .05; }
    let buf; try { const oc = new OAC(1, Math.ceil(tot * sr), sr); slots.forEach(([k, at], i) => SFXD[k].f(oc, oc.destination, at + .002, srng(i * 131 + bi * 7 + 5), 1)); buf = await oc.startRendering(); } catch (e){ continue; }
    const d = buf.getChannelData(0);
    for (const [k, at, len] of slots){
      const a = Math.floor(at * sr), n = Math.floor(len * sr); let e = n, pk = 0;
      // the renderer very occasionally emits a lone one-sample spike (seen on swept filters); repair any before measuring
      for (let i = a + 2; i < a + n - 2; i++){ const x = Math.abs(d[i]); if (x > .02 && x > 6 * Math.max(Math.abs(d[i - 1]), Math.abs(d[i + 1]), Math.abs(d[i - 2]), Math.abs(d[i + 2]))){ d[i] = (d[i - 1] + d[i + 1]) * .5; AU.despiked = (AU.despiked || 0) + 1; } } while (e > 64 && Math.abs(d[a + e - 1]) < 2e-4) e--;
      for (let i = 0; i < e; i++){ const v = Math.abs(d[a + i]); if (v > pk) pk = v; } if (pk > 1e-5) SFXD[k].est = 1 / pk;
      const b = c.createBuffer(1, e, sr), cd = b.getChannelData(0), s = pk > 1e-5 ? SFXD[k].pk / pk : 0;
      for (let i = 0; i < e; i++) cd[i] = d[a + i] * s; for (let j = 0; j < 48 && j < e; j++) cd[e - 1 - j] *= j / 48;
      (AU.bakes[k] = AU.bakes[k] || []).push(b);
    }
    await new Promise(r => setTimeout(r, 16));
  }
  AU.ready = true;
}
/* ---- spatial: listener follows the camera; sources get a panner, a distance low-pass and an occlusion test ---- */
const LIS = { x: 0, y: 0, z: 0 };
function setPos(p, x, y, z){ if (p.positionX){ p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z); }
function mkPanner(c){ const p = c.createPanner(); p.panningModel = AU.hrtf ? 'HRTF' : 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 3; p.maxDistance = 120; p.rolloffFactor = 1.15; return p; }
function occlusion(x, y, z, d){ const n = Math.min(40, Math.ceil(d / .75)); let hits = 0, lk = -1;
  for (let i = 1; i < n; i++){ const f = i / n, bx = Math.floor(LIS.x + (x - LIS.x) * f), by = Math.floor(LIS.y + (y - LIS.y) * f), bz = Math.floor(LIS.z + (z - LIS.z) * f), k = (by * 4096 + bz) * 4096 + bx;
    if (k === lk) continue; lk = k; if (B_OPQ[getB(bx, by, bz)] && ++hits >= 2) return 2; } return hits; }
function spatial(c, g, p){ const pn = mkPanner(c); setPos(pn, p.x, p.y, p.z); const d = Math.hypot(p.x - LIS.x, p.y - LIS.y, p.z - LIS.z), oc = c === AU.ctx ? occlusion(p.x, p.y, p.z, d) : 0;
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = .5; lp.frequency.value = Math.max(350, 18000 * Math.exp(-d / 45) * (oc > 1 ? .1 : oc ? .3 : 1));
  if (oc) g.gain.value *= oc > 1 ? .55 : .75; g.connect(lp); lp.connect(pn); return pn; }
function audioListen(cam){ const c = AU.ctx; if (!c) return; const L = c.listener, p = cam.position, e = cam.matrixWorld.elements, t = c.currentTime; LIS.x = p.x; LIS.y = p.y; LIS.z = p.z;
  if (L.positionX){ L.positionX.setTargetAtTime(p.x, t, .02); L.positionY.setTargetAtTime(p.y, t, .02); L.positionZ.setTargetAtTime(p.z, t, .02);
    L.forwardX.setTargetAtTime(-e[8], t, .02); L.forwardY.setTargetAtTime(-e[9], t, .02); L.forwardZ.setTargetAtTime(-e[10], t, .02); L.upX.setTargetAtTime(e[4], t, .02); L.upY.setTargetAtTime(e[5], t, .02); L.upZ.setTargetAtTime(e[6], t, .02); }
  else { L.setPosition(p.x, p.y, p.z); L.setOrientation(-e[8], -e[9], -e[10], e[4], e[5], e[6]); } }
/* ---- voices: play a baked buffer (or synthesise live) through the pool, spatialised when given a position ---- */
function playOn(c, G, k, o, t){
  const D0 = SFXD[k]; if (!D0) return null; o = o || {};
  const g = c.createGain(), live = c === AU.ctx, rate = (o.rate || 1) * (1 + (Math.random() - .5) * 2 * D0.pv);
  g.gain.value = (o.gain === undefined ? 1 : o.gain) * (1 + (Math.random() - .5) * .16) * (D0.n ? 1 : D0.g);
  let end, s = null; const vs = live || o.baked ? AU.bakes[k] : null;
  if (vs){ let i = Math.floor(Math.random() * vs.length); if (vs.length > 1 && i === AU.last[k]) i = (i + 1) % vs.length; AU.last[k] = i;
    s = c.createBufferSource(); s.buffer = vs[i]; s.playbackRate.value = rate; s.connect(g); s.start(t); end = t + vs[i].duration / rate; }
  else if (D0.n && !o.raw){ // not baked yet (or offline): render live, then normalise by the baked peak target with a fixed estimate
    const pg = c.createGain(); pg.gain.value = D0.pk * (D0.est || 1); D0.f(c, pg, t, Math.random, o.a || 1); pg.connect(g); end = t + D0.len; if (rate !== 1) { /* pitch variation only on baked voices */ } }
  else { D0.f(c, g, t, Math.random, o.a || 1); end = t + D0.len; }
  let n = g; if (o.pos) n = spatial(c, g, o.pos); n.connect(G.bus[o.bus || D0.bus]);
  if (D0.wet && o.wet !== 0){ const w = c.createGain(); w.gain.value = D0.wet; n.connect(w); w.connect(G.room); }
  if (D0.h){ const w = c.createGain(); w.gain.value = D0.h; n.connect(w); w.connect(G.hall); }
  if (live) setTimeout(() => { try { n.disconnect(); g.disconnect(); } catch (e){} }, (end - c.currentTime) * 1000 + 400);
  return { g, s, end };
}
function fire(k, o){
  if (!SND.ok() || !AU.G) return null; const c = AU.ctx, D0 = SFXD[k]; if (!D0) return null; o = o || {};
  const now = c.currentTime, pri = o.pri !== undefined ? o.pri : D0.pri, V = AU.voices;
  if (o.pos){ const d = Math.hypot(o.pos.x - LIS.x, o.pos.y - LIS.y, o.pos.z - LIS.z); if (d > 70) return null; }
  for (let i = V.length - 1; i >= 0; i--) if (V[i].end < now) V.splice(i, 1);
  if (V.length >= VOICES){ let w = -1; for (let i = 0; i < V.length; i++){ const v = V[i]; if (v.pri > pri) continue; if (w < 0 || v.pri < V[w].pri || (v.pri === V[w].pri && v.t0 < V[w].t0)) w = i; }
    if (w < 0){ AU.dropped++; return null; } const v = V[w]; try { const p = v.g.gain; (p.cancelAndHoldAtTime ? p.cancelAndHoldAtTime(now) : p.cancelScheduledValues(now)); p.setTargetAtTime(0, now, .006); if (v.s) v.s.stop(now + .05); } catch (e){} V.splice(w, 1); AU.stolen++; }
  const t = now + .004 + (o.dt || 0), r = playOn(c, AU.G, k, o, t); if (!r) return null;
  V.push({ t0: t, end: r.end, pri, g: r.g, s: r.s }); if (D0.dk) duck(D0.dk, D0.dh); return r;
}
function duck(dbv, hold){ const G = AU.G; if (!G) return; const c = AU.ctx, now = c.currentTime, lin = db(dbv), p = G.duck.gain;
  if (now < AU.dkEnd && lin > AU.dkLvl) AU.dkEnd = Math.max(AU.dkEnd, now + hold); else { AU.dkLvl = lin; AU.dkEnd = now + hold; }
  (p.cancelAndHoldAtTime ? p.cancelAndHoldAtTime(now) : p.cancelScheduledValues(now)); p.setTargetAtTime(AU.dkLvl, now, .04); p.setTargetAtTime(1, AU.dkEnd, .45); }
/* ---- ambience: looping beds plus scheduled spatial one-shots ---- */
function ambBeds(c, G){
  const X = aux(c), A = { bird: 2, crk: 1, owl: 12, drip: 1, hb: 0, br: 0, shim: 6 }, gn = v => { const g = c.createGain(); g.gain.value = v; return g; }, bq = (type, f, q) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
  const loop = (buf, rate, off) => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; s.start(c.currentTime + .01, off % buf.duration); return s; };
  A.wind = gn(0); A.windF = bq('bandpass', 380, .7); loop(X.bn, 1, 0).connect(A.windF); A.windF.connect(A.wind); A.wind.connect(G.amb);
  A.low = gn(0); const lf = bq('lowpass', 150, .5); loop(X.bn, .55, 1.3).connect(lf); lf.connect(A.low); A.low.connect(G.amb);
  A.whis = gn(0); A.whisF = bq('bandpass', 1300, 10); loop(X.wn, .9, .4).connect(A.whisF); A.whisF.connect(A.whis); A.whis.connect(G.amb);
  A.leaf = gn(0); const lh = bq('bandpass', 3800, .5), lm = gn(.5), mod = gn(.9); loop(X.wn, 1, .9).connect(lh); lh.connect(lm); lm.connect(A.leaf); A.leaf.connect(G.amb); loop(X.bn, .04, 2.1).connect(mod); mod.connect(lm.gain);
  A.water = gn(0); A.waterP = mkPanner(c); A.waterP.refDistance = 6; const w1 = bq('lowpass', 1700, .5), w2 = bq('peaking', 650, 1); w2.gain.value = 5; loop(X.wn, 1, .2).connect(w1); w1.connect(w2); w2.connect(A.water); A.water.connect(A.waterP); A.waterP.connect(G.amb);
  A.drone = gn(0); const dl = bq('lowpass', 240, 1.2), dlfo = c.createOscillator(), dlg = gn(90); dlfo.frequency.value = .07; dlfo.connect(dlg); dlg.connect(dl.frequency); dlfo.start();
  [[55, 'sawtooth', .5], [55.35, 'sawtooth', .5], [82.4, 'triangle', .4], [110.3, 'sine', .25]].forEach(([f, ty, v]) => { const o = c.createOscillator(), g = gn(v); o.type = ty; o.frequency.value = f; o.connect(g); g.connect(dl); o.start(); }); dl.connect(A.drone); A.drone.connect(G.amb);
  A.glide = gn(0); A.glideF = bq('bandpass', 600, .8); loop(X.wn, 1, .7).connect(A.glideF); A.glideF.connect(A.glide); A.glide.connect(G.sfx);
  return A;
}
function ambSet(A, p, t, G){
  const k = p.cine ? .3 : 1, cv = 1 - p.cave * .8, S = (g, v, tau) => g.setTargetAtTime(v, t, tau || .4);
  S(A.wind.gain, (.16 + .2 * p.alt + .22 * p.gust) * cv * k, .25); S(A.windF.frequency, 300 + 260 * p.gust + 220 * p.alt, .25);
  S(A.low.gain, ((.07 + .14 * p.alt) * cv + .24 * p.cave) * k); S(A.whis.gain, (.012 + .04 * p.alt) * (.3 + p.gust) * cv * k, .25); S(A.whisF.frequency, 1100 + 700 * p.gust, .3);
  S(A.leaf.gain, .03 * p.trees * (.35 + .9 * p.gust) * cv * k * (p.day * .6 + .4), .3);
  if (p.water){ setPos(A.waterP, p.water.x, p.water.y, p.water.z); S(A.water.gain, .22 * k, .6); } else S(A.water.gain, 0, .6);
  S(A.drone.gain, .11 * p.drone * k, .8);
  if (G){ S(G.openG.gain, .9 * (1 - p.cave), 1); S(G.caveG.gain, 1.1 * p.cave, 1); }
}
function around(r, a, b, up){ const an = r() * 6.283, d = a + r() * (b - a); return { x: LIS.x + Math.cos(an) * d, y: LIS.y + (up || 0) + r() * 4 - 1, z: LIS.z + Math.sin(an) * d }; }
function ambEvents(A, dt, p, r, play){
  if (p.cine) return;
  A.bird -= dt; if (A.bird <= 0){ A.bird = (1.6 + r() * 5) / (.35 + p.trees); if (p.day > .5 && p.cave < .5) play('bird:' + ((r() * 4) | 0), { pos: around(r, 9, 26, 4), gain: .55 + r() * .45 }); }
  A.crk -= dt; if (A.crk <= 0){ A.crk = .3 + r() * 1.1; if (p.day < .45 && p.cave < .5) play('cricket', { pos: around(r, 4, 14, -1), gain: .4 + r() * .6 }); }
  A.owl -= dt; if (A.owl <= 0){ A.owl = 14 + r() * 22; if (p.day < .35 && r() < .7) play('owl', { pos: around(r, 18, 32, 6) }); }
  A.drip -= dt; if (A.drip <= 0){ A.drip = .35 + r() * 1.6; if (p.cave > .5) play('drip', { pos: around(r, 2, 8, 1), rate: .8 + r() * .5 }); }
  A.shim -= dt; if (A.shim <= 0){ A.shim = 6 + r() * 8; if (p.isle === 'eden' && p.day > .3) play('chime', { rate: Math.pow(2, (NOTES[(r() * 5) | 0] + 12) / 12), gain: .35, pos: around(r, 6, 14, 3) }); }
  if (p.lowhp > 0){ A.hb -= dt; if (A.hb <= 0){ A.hb = .85 - p.lowhp * .2; play('heartbeat', { gain: .5 + p.lowhp * .5 }); } } else A.hb = 0;
  if (p.sprint){ A.br -= dt; if (A.br <= 0){ A.br = 1.25 + r() * .2; play('breath', {}); } } else A.br = .6;
}
let treeCnt = 0, treeT = 0, caveV = 0, caveT = 0;
function ambParams(dt){
  const p = AU.pp || (AU.pp = {}), x = PL.x, y = PL.y, z = PL.z, ut = U ? U.uTime.value : 0;
  const gw = (x * .78 + z * .62) * .045 - ut * .33; p.gust = Math.pow(Math.max(0, Math.sin(gw)), 6) * (.6 + .4 * Math.sin(ut * .21));
  p.alt = Math.min(1, Math.max(0, (y - 50) / 34) * .7 + (state === 'play' && !PL.onGround && voidBelow(PL) ? .3 : 0));
  p.day = U ? 1 - U.uNight.value : 1; p.cine = state === 'cine' || state === 'title';
  treeT -= dt; if (treeT <= 0){ treeT = 1; let n = 0; for (const tr of TREES){ const dx = tr[0] - x, dz = tr[2] - z; if (dx * dx + dz * dz < 324) n++; } treeCnt = Math.min(1, n / 10); }
  p.trees = treeCnt;
  caveT -= dt; if (caveT <= 0){ caveT = .4; const hx = Math.floor(x), hy = Math.floor(y + 1.6), hz = Math.floor(z); let roof = 0, side = 0;
    for (let k = 1; k < 14; k++) if (B_OPQ[getB(hx, hy + k, hz)]){ roof = 1; break; }
    for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let k = 1; k < 9; k++) if (B_OPQ[getB(hx + ax * k, hy, hz + az * k)]){ side++; break; }
    caveV = roof && side >= 3 ? 1 : roof && side >= 2 ? .5 : 0; }
  p.cave = p.cave === undefined ? caveV : p.cave + (caveV - p.cave) * Math.min(1, dt * 2);
  let wb = null, wd = 40 * 40; for (const f of FALLS){ const dx = f.x - x, dy = f.y - y, dz = f.z - z, d = dx * dx + dy * dy * .3 + dz * dz; if (d < wd){ wd = d; wb = f; } } p.water = wb ? { x: wb.x, y: wb.y - Math.min(4, (wb.h || 2) * .5), z: wb.z } : null;
  let ne = 0; if (inWilds) for (const e of ENEMIES){ if (e.st === ES.DEAD) continue; const d = Math.hypot(e.x - x, e.z - z); if (d < 32) ne = Math.max(ne, 1 - d / 32); }
  p.drone = inWilds ? .35 + .65 * ne : 0;
  p.lowhp = inWilds && php <= 6 && !dead ? 1 - php / 7 : 0;
  p.sprint = state === 'play' && PL.onGround && Math.hypot(PL.vx, PL.vz) > 7.2;
  const ii = islandAt(x, z); p.isle = ii >= 0 && ISL[ii] ? ISL[ii].id : '';
  return p;
}
/* ---- music: patches ---- */
function adsr(p, t, pk, A, D, S, end, R){ p.setValueAtTime(0, t); p.linearRampToValueAtTime(pk, t + A); p.setTargetAtTime(pk * S, t + A, D / 3 + .001); const e = Math.max(end, t + A + .01); p.setTargetAtTime(0, e, R / 4 + .001); return e + R * 1.7; }
function mo(C, pan, wet){ const c = C.c, sp = c.createStereoPanner ? c.createStereoPanner() : c.createGain(); if (sp.pan) sp.pan.value = Math.max(-1, Math.min(1, pan || 0)); sp.connect(C.G.music); if (wet){ const w = c.createGain(); w.gain.value = wet; sp.connect(w); w.connect(C.G.hall); } return sp; }
function ksBuf(c, m){ const X = aux(c), base = m - (((m % 3) + 3) % 3); let b = X.ks[base]; if (b) return b; const sr = c.sampleRate, Nn = Math.max(2, Math.round(sr / mtof(base))), len = Math.floor(sr * 2.4), buf = c.createBuffer(1, len, sr), d = buf.getChannelData(0), r = srng(base * 77 + 1);
  let lp = 0; for (let i = 0; i < Nn; i++){ lp += (r() * 2 - 1 - lp) * .5; d[i] = lp; } const dec = .997 - Math.max(0, base - 60) * .00025;
  for (let i = Nn; i < len; i++) d[i] = dec * .5 * (d[i - Nn] + d[i - Nn - 1 >= 0 ? i - Nn - 1 : 0]);
  let mean = 0; for (let i = 0; i < Nn; i++) mean += d[i]; mean /= Nn; let pk = 0; for (let i = 0; i < len; i++){ d[i] -= mean * Math.pow(dec, i / Nn); pk = Math.max(pk, Math.abs(d[i])); }
  const fi = Math.min(Nn, 48); for (let i = 0; i < len; i++) d[i] /= pk || 1; for (let i = 0; i < fi; i++) d[i] *= i / fi; for (let i = 0; i < 256; i++) d[len - 1 - i] *= i / 256;
  b = X.ks[base] = { buf, f0: sr / Nn }; return b; }
const P = {
  ep(C, t, m, v, dur, pan){ const c = C.c, f = mtof(m), o = mo(C, pan, .18), car = c.createOscillator(), mod = c.createOscillator(), mg = c.createGain(), g = c.createGain(), ti = c.createOscillator(), tg = c.createGain();
    car.frequency.value = f; mod.frequency.value = f; mg.gain.setValueAtTime(f * (1.1 + v * 1.4), t); mg.gain.setTargetAtTime(f * .18, t, .3); mod.connect(mg); mg.connect(car.frequency);
    ti.frequency.value = f * 7.02; tg.gain.setValueAtTime(0, t); tg.gain.linearRampToValueAtTime(.035 * v * C.amp, t + .002); tg.gain.setTargetAtTime(0, t + .002, .025); ti.connect(tg); tg.connect(o);
    const e = adsr(g.gain, t, .13 * v * C.amp, .004, 1.6, .22, t + dur, .5); car.connect(g); g.connect(o); for (const x of [car, mod, ti]){ x.start(t); x.stop(e); } },
  bell(C, t, m, v, dur, pan){ const c = C.c, f = mtof(m), o = mo(C, pan, .5), car = c.createOscillator(), mod = c.createOscillator(), mg = c.createGain(), g = c.createGain();
    car.frequency.value = f; mod.frequency.value = f * 3.51; mg.gain.setValueAtTime(f * 2.2 * v, t); mg.gain.setTargetAtTime(f * .1, t, .5); mod.connect(mg); mg.connect(car.frequency);
    const e = adsr(g.gain, t, .085 * v * C.amp, .002, 2.6, 0, t + dur, 1.4); car.connect(g); g.connect(o); car.start(t); mod.start(t); car.stop(e); mod.stop(e); return { g, end: e }; },
  kal(C, t, m, v, dur, pan){ const c = C.c, f = mtof(m), o = mo(C, pan, .4); O(c, o, t, 'sine', f, 0, 2.2, .16 * v * C.amp, .002); O(c, o, t, 'sine', f * 5.4, 0, .2, .04 * v * C.amp, .001); O(c, o, t, 'sine', f * 2.01, 0, .8, .03 * v * C.amp, .002); N(c, o, t, .006, 'bandpass', 3000, 1.5, .03 * v * C.amp, .001); },
  pluck(C, t, m, v, dur, pan){ const c = C.c, K = ksBuf(c, m), s = c.createBufferSource(), lp = c.createBiquadFilter(), g = c.createGain(), o = mo(C, pan, .28); s.buffer = K.buf; s.playbackRate.value = mtof(m) / K.f0;
    lp.type = 'lowpass'; lp.frequency.value = 1400 + v * 4500; lp.Q.value = .4; g.gain.setValueAtTime(.2 * v * C.amp, t); g.gain.setTargetAtTime(0, t + dur, .1); s.connect(lp); lp.connect(g); g.connect(o); s.start(t); s.stop(t + dur + .8); },
  sub(C, t, m, v, dur){ const c = C.c, f = mtof(m), o = mo(C, 0, 0), a = c.createOscillator(), b = c.createOscillator(), bg = c.createGain(), lp = c.createBiquadFilter(), g = c.createGain();
    a.frequency.value = f; b.type = 'triangle'; b.frequency.value = f * 2; bg.gain.value = .14; lp.type = 'lowpass'; lp.frequency.value = 240; b.connect(bg); bg.connect(lp); a.connect(lp); lp.connect(g); g.connect(o);
    const e = adsr(g.gain, t, .26 * v * C.amp, .012, .5, .75, t + dur, .2); a.start(t); b.start(t); a.stop(e); b.stop(e); },
  pad(C, t, notes, v, dur, dark){ const c = C.c, o = mo(C, 0, .45), lp = c.createBiquadFilter(), g = c.createGain(), top = 650 + (1 - dark) * 1600, lfo = c.createOscillator(), lg = c.createGain();
    lp.type = 'lowpass'; lp.Q.value = .7; lp.frequency.setValueAtTime(260, t); lp.frequency.linearRampToValueAtTime(top, t + 1.6); lfo.frequency.value = .09 + C.r() * .05; lg.gain.value = top * .3; lfo.connect(lg); lg.connect(lp.frequency);
    const e = adsr(g.gain, t, .042 * v * C.amp, 1.3, 1.5, .8, t + dur, 2.6), os = [lfo];
    notes.forEach((m, i) => { const sp = c.createStereoPanner ? c.createStereoPanner() : c.createGain(); if (sp.pan) sp.pan.value = notes.length > 1 ? (i / (notes.length - 1) - .5) * 1.1 : 0; sp.connect(lp);
      for (const dc of [-7 - C.r() * 3, 7 + C.r() * 3]){ const x = c.createOscillator(); x.type = 'sawtooth'; x.frequency.value = mtof(m); x.detune.value = dc; x.connect(sp); os.push(x); } });
    lp.connect(g); g.connect(o); for (const x of os){ x.start(t); x.stop(e); } return { g, end: e }; },
  choir(C, t, notes, v, dur, vow){ const c = C.c, o = mo(C, 0, .55), g = c.createGain(), sum = c.createGain(), vib = c.createOscillator(), vg = c.createGain(); vib.frequency.value = 5.2; vg.gain.value = 7; vib.connect(vg); sum.gain.value = 1;
    const FM = { a: [[730, 1], [1090, .5], [2440, .25]], o: [[450, 1], [800, .55], [2830, .12]], u: [[325, 1], [700, .4], [2530, .1]] }, A0 = FM[vow] || FM.a, B0 = vow === 'a' ? FM.o : FM.u;
    A0.forEach(([f, a], i) => { const bp = c.createBiquadFilter(), bg = c.createGain(); bp.type = 'bandpass'; bp.Q.value = 7 + i * 2; bp.frequency.setValueAtTime(f, t); bp.frequency.linearRampToValueAtTime(B0[i][0], t + dur); bg.gain.value = a; sum.connect(bp); bp.connect(bg); bg.connect(g); });
    const os = [vib]; notes.forEach((m, i) => { for (const dc of [-9, 9]){ const x = c.createOscillator(); x.type = 'sawtooth'; x.frequency.value = mtof(m); x.detune.value = dc + (C.r() - .5) * 4; vg.connect(x.detune); x.connect(sum); os.push(x); } });
    const e = adsr(g.gain, t, .2 * v * C.amp, 1.3, 1.2, .85, t + dur, 2.4); g.connect(o); for (const x of os){ x.start(t); x.stop(e); } return { g, end: e }; },
  kick(C, t, v){ const c = C.c, o = mo(C, 0, .04); O(c, o, t, 'sine', 150, 44, .1, .55 * v * C.amp, .002); N(c, o, t, .006, 'bandpass', 1600, 1, .08 * v * C.amp, .001); },
  brush(C, t, v, pan){ const c = C.c, o = mo(C, pan, .12); N(c, o, t, .07, 'bandpass', 5200, .6, .1 * v * C.amp, .018); },
  rim(C, t, v, pan){ const c = C.c, o = mo(C, pan, .2); O(c, o, t, 'triangle', 1720, 0, .02, .07 * v * C.amp, .001); O(c, o, t, 'triangle', 820, 0, .035, .05 * v * C.amp, .001); N(c, o, t, .02, 'bandpass', 2300, 3, .06 * v * C.amp, .001); }
};
/* ---- music: score data ---- */
const PCN = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const QUAL = { '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], sus4: [0, 5, 7], sus2: [0, 2, 7], add9: [0, 4, 7, 14], m9: [0, 3, 7, 10, 14], '7sus4': [0, 5, 7, 10], maj9: [0, 4, 7, 11, 14] };
function chordOf(name, tr){ const m = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(name); const root = PCN[m[1]] + tr; return { root, q: QUAL[m[2]] || QUAL[''], bass: m[3] ? PCN[m[3]] + tr : root, name }; }
function voicing(ch, lo, hi){ const out = []; for (const iv of ch.q){ const n = lo + (((ch.root + iv - lo) % 12) + 12) % 12; if (n <= hi && !out.includes(n)) out.push(n); } return out.sort((a, b) => a - b); }
function chordTones(ch, lo, hi){ const out = []; for (let n = lo; n <= hi; n++) if (ch.q.some(iv => ((n - ch.root - iv) % 12 + 12) % 12 === 0)) out.push(n); return out; }
const MAJ = k => [0, 2, 4, 5, 7, 9, 11].map(x => (x + k) % 12), MIN = k => [0, 2, 3, 5, 7, 8, 10].map(x => (x + k) % 12);
const RH = { calm: [[[0, 2], [2, 1], [3, 1]], [[0, 1.5], [1.5, .5], [2, 2]], [[0, 3], [3, 1]], [[1, 1], [2, 1.5], [3.5, .5]]],
  day: [[[0, 1], [1, .5], [1.5, 1.5], [3, 1]], [[0, .5], [.5, .5], [1, 1], [2.5, 1.5]], [[0, 1.5], [1.5, 1], [2.5, .5], [3, 1]], [[.5, 1], [1.5, .5], [2, 2]]],
  sparse: [[[0, 3]], [[1, 2], [3, 1]], [[0, 1.5], [2.5, 1.5]], [[2, 2]]],
  busy: [[[0, .5], [.5, .5], [1, .5], [1.5, .5], [2, 1], [3, 1]], [[0, .75], [.75, .75], [1.5, .5], [2, 2]]] };
const EPP = [[[0, 1.4, .9], [1.5, .5, .55], [2.5, 1.3, .7]], [[0, 2, .85], [2, 2, .7]], [[0, .9, .8], [1, .4, .45], [2, .9, .7], [3.5, .5, .5]], [[.5, 1.4, .7], [2.5, 1.4, .65]]];
const BRP = { day: [[1, .55], [3, .55], [.5, .16], [1.5, .2], [2.5, .16], [3.5, .22]], s16: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(i => [i / 4, [.55, .15, .32, .18][i % 4]]) };
const SCORE = {
  motif: [[0, 69, .5], [.5, 74, 1], [1.5, 73, .5], [2, 78, 1.5], [3.5, 76, 2.5]],
  st: {
    title: { bpm: 76, tr: 0, amp: 1, scale: MAJ(2), mel: [69, 88], rh: RH.calm, dark: .3, sub: [[0, 3.5]], pl: [62, 81], plP: 'updown8',
      sec: { T1: { ch: ['Dadd9', 'Gmaj7', 'Bm7', 'A7sus4'], stems: ['pad', 'sub', 'choirA', 'bellS'], motif: 'bell', mv: .75 },
             T2: { ch: ['Gmaj7', 'Dadd9/F#', 'Em9', 'Asus4'], stems: ['pad', 'sub', 'kal', 'pluck'] } }, forms: [['T1', 'T2']] },
    day: { bpm: 84, tr: 0, amp: 1, scale: MAJ(2), mel: [71, 88], rh: RH.day, dark: .35, sub: [[0, 1.5], [2.5, 1.2]], pl: [62, 81], plP: 'updown8', br: BRP.day, rimP: [[3.5, .35]],
      sec: { A: { ch: ['D', 'Bm7', 'Gmaj7', 'Asus4'], stems: ['pad', 'ep', 'sub'] },
             A2: { ch: ['D', 'F#m7', 'Gmaj7', 'A'], stems: ['pad', 'ep', 'sub', 'pluck', 'kal'], motif: 'kal', mv: .5, mEvery: 2 },
             B: { ch: ['Gmaj7', 'A', 'F#m7', 'Bm7'], stems: ['pad', 'ep', 'sub', 'pluck', 'brush', 'kal'] },
             B2: { ch: ['Em7', 'A7sus4', 'Dadd9', 'D'], stems: ['pad', 'ep', 'sub', 'pluck', 'brush', 'kal', 'rim'] },
             C: { ch: ['Em9', 'Gmaj7', 'Bm7', 'A7sus4'], stems: ['pad', 'bell', 'sub', 'choirA'] } },
      forms: [['A', 'A2', 'B', 'B2'], ['A2', 'B', 'C', 'B2'], ['A', 'B', 'B2', 'C'], ['C', 'A2', 'B', 'B2']] },
    night: { bpm: 66, tr: 0, amp: .95, scale: MAJ(2), mel: [74, 93], rh: RH.sparse, dark: .75, sub: [[0, 3.6]], pl: [62, 79], plP: 'q',
      sec: { A: { ch: ['Gmaj7', 'Dmaj7/F#', 'Em9', 'Asus4'], stems: ['pad', 'bell', 'sub', 'choirU'] },
             B: { ch: ['Bm7', 'Gmaj7', 'Dadd9', 'A7sus4'], stems: ['pad', 'bell', 'sub', 'choirU'], motif: 'kal', mv: .35, mEvery: 2 },
             C: { ch: ['Em9', 'Gmaj7', 'Dmaj7', 'Dmaj7'], stems: ['pad', 'pluck', 'sub'] } },
      forms: [['A', 'B', 'A', 'C'], ['B', 'A', 'C', 'A']] },
    wilds: { bpm: 92, tr: 0, amp: .95, scale: MIN(11), mel: [66, 83], rh: RH.day, dark: .6, sub: 'pulse8', pl: [59, 74], plP: 'ost8', kickP: [0], rimP: [[3, .5], [3.5, .25]],
      sec: { A: { ch: ['Bm', 'G', 'Em', 'F#'], stems: ['pad', 'pluck', 'sub', 'choirU'] },
             B: { ch: ['Bm', 'D', 'Em', 'F#7'], stems: ['pad', 'pluck', 'sub', 'kick', 'rim', 'choirU'] },
             C: { ch: ['G', 'Em', 'C', 'F#'], stems: ['pad', 'choirA', 'bell', 'sub', 'kick'] } },
      forms: [['A', 'B', 'A', 'C'], ['A', 'C', 'B', 'B']] },
    combat: { bpm: 126, tr: 0, amp: 1, scale: MIN(11), mel: [71, 86], rh: RH.busy, dark: .45, sub: 'pulse8', pl: [59, 78], plP: 'ost16', kickP: [0, 1.5, 2, 3.5], rimP: [[1, .8], [3, .8]], br: BRP.s16,
      sec: { A: { ch: ['Bm', 'Bm', 'G', 'F#'], stems: ['pad', 'pluck', 'sub', 'kick', 'rim', 'brush'] },
             B: { ch: ['Em', 'F#', 'Bm', 'F#7'], stems: ['pad', 'pluck', 'sub', 'kick', 'rim', 'brush', 'choirA', 'bellS'] } },
      forms: [['A', 'A', 'B', 'A'], ['A', 'B', 'A', 'B']] },
    cine: { bpm: 80, tr: 0, amp: 1.1, scale: MAJ(2), mel: [69, 88], rh: RH.calm, dark: .4, sub: [[0, 3.6]], pl: [62, 81], plP: 'updown8', br: BRP.day, kickP: [0, 2], rimP: [[1, .5], [3, .5]],
      sec: { wake: { ch: ['Dm9', 'Bbmaj7', 'Gm7', 'Asus4'], stems: ['pad', 'choirU', 'sub', 'bellS'], dark: .85 },
             title: { tr: 2, ch: ['Dadd9', 'Bm7', 'Gmaj7', 'A7sus4'], stems: ['pad', 'choirA', 'sub', 'ep', 'pluck', 'kick'], motif: 'bell', mv: .85, impact: 1 },
             eden: { tr: 2, ch: ['Gmaj7', 'Dadd9', 'Em9', 'A'], stems: ['pad', 'kal', 'pluck', 'ep', 'sub', 'brush'], impact: .5 },
             j: { tr: 2, ch: ['Bm7', 'G', 'D', 'A'], stems: ['pad', 'pluck16', 'sub8', 'kick4', 'rim', 'ep'], impact: .7 },
             about: { tr: 2, ch: ['Gmaj7', 'A', 'F#m7', 'Bm7'], stems: ['pad', 'ep', 'kal', 'sub'], impact: .4 },
             contact: { tr: 2, ch: ['G', 'A', 'Bm7', 'A'], stems: ['pad', 'pluck', 'ep', 'sub', 'brush', 'choirA'], impact: .5 },
             end: { tr: 0, ch: ['Gmaj7', 'A7sus4', 'Dadd9', 'Dadd9'], stems: ['pad', 'choirA', 'sub', 'bellS'], motif: 'bell', mv: .8, mBar: 2, impact: .8 },
             gift: { tr: 0, ch: ['Dadd9', 'Gmaj7/D', 'Dadd9', 'Dadd9'], stems: ['pad', 'sub', 'bellS'], motif: 'kal', mv: .7, impact: .4 } }, forms: [] }
  } };
/* ---- music: conductor ---- */
const HUM = r => (r() - .5) * .016; // ±8 ms
function scaleStep(m, k, sc){ let n = m; const d = k > 0 ? 1 : -1; for (let i = 0; i < Math.abs(k); i++){ do n += d; while (!sc.includes(((n % 12) + 12) % 12)); } return n; }
function nearTone(m, ch){ let best = m, bd = 99; for (let d = -2; d <= 2; d++){ const n = m + d; if (ch.q.some(iv => ((n - ch.root - iv) % 12 + 12) % 12 === 0) && Math.abs(d) < bd){ bd = Math.abs(d); best = n; } } return best; }
function condMake(c, G, seed){ return { c, G, r: srng(seed || 11), st: '', want: 'title', cue: 'wake', t: 0, sec: '', bi: 9, fi: 0, form: null, cyc: 0, q: [], held: [], drop: null, vo: 0, amp: 1, mel: 0, motifTill: 0, epP: EPP[0], lastForm: -1 }; }
function condEv(C, t, f){ C.q.push({ t, f }); }
function condHold(C, h){ if (h) C.held.push(h); }
function melBar(C, t, b, ch, S, patch, v0, sparse){ const r = C.r, rh = S.rh[(r() * S.rh.length) | 0], [lo, hi] = S.mel;
  for (const [bt, du] of rh){ const at = t + bt * b; if (at < C.motifTill || r() < (sparse ? .35 : .14)) continue;
    let m = C.mel || ((lo + hi) >> 1); m = scaleStep(m, [-2, -1, -1, 1, 1, 2, 3, -3][(r() * 8) | 0], S.scale); if (m < lo) m = scaleStep(m, 4, S.scale); if (m > hi) m = scaleStep(m, -4, S.scale); if (bt % 2 === 0) m = nearTone(m, ch); C.mel = m;
    const v = v0 * (bt % 2 === 0 ? 1 : .8) * (.85 + r() * .3), tt = at + HUM(r), pan = (r() - .5) * .6; condEv(C, tt, () => condHold(C, P[patch](C, tt, m, v, du * b, pan))); } }
const STEM = {
  pad(C, t, b, ch, i, S, sec){ const cs = sec.ch; if (i > 0 && cs[i - 1] === cs[i]) return; let n = 1; while (i + n < cs.length && cs[i + n] === cs[i]) n++;
    const v = voicing(ch, 50 + C.vo, 64 + C.vo), d = sec.dark !== undefined ? sec.dark : S.dark, tt = t + HUM(C.r); condEv(C, tt, () => condHold(C, P.pad(C, tt, v, .6, n * 4 * b + .3, d))); },
  ep(C, t, b, ch, i, S){ const v = voicing(ch, 58 + C.vo, 72 + C.vo); for (const [bt, du, vel] of C.epP){ const at = t + bt * b + HUM(C.r); v.forEach((m, k) => { const tt = at + k * .009; condEv(C, tt, () => P.ep(C, tt, m, vel * (.85 + C.r() * .2), du * b, (k / Math.max(1, v.length - 1) - .5) * .5)); }); } },
  sub(C, t, b, ch, i, S){ const m = 33 + (((ch.bass - 33) % 12) + 12) % 12, pat = S.sub;
    if (pat === 'pulse8'){ for (let k = 0; k < 8; k++){ const tt = t + k * b / 2 + HUM(C.r) * .4; condEv(C, tt, () => P.sub(C, tt, m, k % 2 ? .6 : .95, b * .42)); } }
    else for (const [bt, du] of pat){ const tt = t + bt * b; condEv(C, tt, () => P.sub(C, tt, m, .9, du * b)); } },
  sub8(C, t, b, ch, i, S){ STEM.sub(C, t, b, ch, i, Object.assign({}, S, { sub: 'pulse8' })); },
  pluck(C, t, b, ch, i, S, sec, pat){ const tones = chordTones(ch, S.pl[0], S.pl[1]); if (!tones.length) return; const P8 = pat || S.plP, r = C.r; let seq, step;
    if (P8 === 'updown8'){ const up = tones.slice(0, 5); seq = up.concat(up.slice(1, -1).reverse()).slice(0, 8); while (seq.length < 8) seq.push(up[seq.length % up.length]); step = .5; }
    else if (P8 === 'ost8'){ const l = tones.slice(0, 4); seq = [0, 2, 1, 2, 0, 3, 1, 2].map(k => l[k % l.length]); step = .5; }
    else if (P8 === 'ost16'){ const l = tones.slice(0, 4); seq = []; for (let k = 0; k < 16; k++) seq.push(l[[0, 2, 1, 2][k % 4] + (k >= 8 && k % 4 === 3 ? 1 : 0)] || l[0]); step = .25; }
    else { seq = [0, 1, 2, 3].map(() => tones[(r() * tones.length) | 0]); step = 1; }
    seq.forEach((m, k) => { const bt = k * step, sw = step === .5 && k % 2 ? b * .04 : 0, tt = t + bt * b + sw + HUM(r), v = (bt % 1 === 0 ? .62 : .42) * (.85 + r() * .25); condEv(C, tt, () => P.pluck(C, tt, m, v, step * b * 1.6, (k % 2 ? .3 : -.3))); }); },
  pluck16(C, t, b, ch, i, S, sec){ STEM.pluck(C, t, b, ch, i, S, sec, 'ost16'); },
  kal(C, t, b, ch, i, S){ melBar(C, t, b, ch, S, 'kal', .55, false); },
  bell(C, t, b, ch, i, S){ melBar(C, t, b, ch, S, 'bell', .5, true); },
  bellS(C, t, b, ch, i, S){ const tones = chordTones(ch, 74, 88), r = C.r; if (!tones.length) return; const m = tones[(r() * tones.length) | 0], tt = t + HUM(r); condEv(C, tt, () => condHold(C, P.bell(C, tt, m, .45, 3.5 * b, (r() - .5) * .8)));
    if (r() < .5){ const m2 = tones[(r() * tones.length) | 0], t2 = t + 2 * b + HUM(r); condEv(C, t2, () => condHold(C, P.bell(C, t2, m2, .32, 1.8 * b, (r() - .5) * .8))); } },
  choirA(C, t, b, ch, i, S, sec){ STEM.choir(C, t, b, ch, i, S, sec, 'a'); },
  choirU(C, t, b, ch, i, S, sec){ STEM.choir(C, t, b, ch, i, S, sec, 'u'); },
  choir(C, t, b, ch, i, S, sec, vw){ const cs = sec.ch; if (i > 0 && cs[i - 1] === cs[i]) return; let n = 1; while (i + n < cs.length && cs[i + n] === cs[i]) n++; const v = voicing(ch, 57, 70).slice(-3), tt = t + HUM(C.r); condEv(C, tt, () => condHold(C, P.choir(C, tt, v, .5, n * 4 * b, vw))); },
  kick(C, t, b, ch, i, S){ for (const bt of (S.kickP || [0])){ const tt = t + bt * b; condEv(C, tt, () => P.kick(C, tt, bt === 0 ? 1 : .75)); } },
  kick4(C, t, b){ for (let k = 0; k < 4; k++){ const tt = t + k * b; condEv(C, tt, () => P.kick(C, tt, k === 0 ? 1 : .7)); } },
  brush(C, t, b, ch, i, S){ const r = C.r; for (const [bt, v] of (S.br || BRP.day)){ const sw = (bt * 2) % 2 === 1 ? b * .05 : 0, tt = t + bt * b + sw + HUM(r); condEv(C, tt, () => P.brush(C, tt, v * (.85 + r() * .3), (r() - .5) * .5)); } },
  rim(C, t, b, ch, i, S){ const r = C.r; for (const [bt, v] of (S.rimP || [[1, .5], [3, .5]])){ const tt = t + bt * b + HUM(r); condEv(C, tt, () => P.rim(C, tt, v, .25)); } }
};
const CORE = new Set(['pad', 'sub', 'sub8', 'choirU']);
function motifAt(C, t, b, patch, tr, v){ for (const [bt, m, du] of SCORE.motif){ const tt = t + bt * b + HUM(C.r) * .5, mm = m + tr; condEv(C, tt, () => condHold(C, P[patch](C, tt, mm, v * (du > 1 ? 1 : .85), du * b + .2, (bt / 4 - .5) * .4))); if (patch === 'bell' && v > .7) condEv(C, tt, () => P.kal(C, tt, mm - 12, v * .5, du * b, 0)); }
  C.motifTill = t + 6 * b; }
function condBar(C){
  const r = C.r; if (C.want !== C.st){ C.st = C.want; C.sec = ''; C.form = null; C.bi = 9; }
  const S = SCORE.st[C.st], b = 60 / S.bpm, t = C.t; C.amp = S.amp;
  if (C.st === 'cine'){ if (C.sec !== C.cue){ C.sec = C.cue; C.bi = 0; C.cueBar = true; } else if (C.bi >= 4) C.bi = 0; }
  else if (C.bi >= 4){ C.fi++; if (!C.form || C.fi >= C.form.length){ let k = (r() * S.forms.length) | 0; if (S.forms.length > 1 && k === C.lastForm) k = (k + 1) % S.forms.length; if (!C.form) k = 0; C.lastForm = k; C.form = S.forms[k]; C.fi = 0; C.cyc++; }
    C.sec = C.form[C.fi]; C.bi = 0; C.drop = new Set(); for (const s of S.sec[C.sec].stems) if (!CORE.has(s) && r() < .2) C.drop.add(s); C.vo = [0, 2, -2, 3][(r() * 4) | 0]; C.epP = EPP[(r() * EPP.length) | 0]; }
  const sec = S.sec[C.sec], tr = S.tr + (sec.tr || 0), ch = chordOf(sec.ch[C.bi], tr);
  if (C.st === 'cine' && C.bi === 0 && C.cueBar){ C.cueBar = false; C.drop = null; if (sec.impact){ const a = sec.impact; condEv(C, t, () => playOn(C.c, C.G, 'impact', { a }, t)); } }
  const mb = sec.mBar || 0;
  if (sec.motif && C.bi === mb && (!sec.mEvery || C.cyc % sec.mEvery === 0)) motifAt(C, t, b, sec.motif, tr, sec.mv || .5);
  const SS = sec.tr ? Object.assign({}, S, { scale: S.scale.map(x => (x + sec.tr) % 12), mel: [S.mel[0] + sec.tr, S.mel[1] + sec.tr] }) : S;
  for (const s of sec.stems) if (!(C.drop && C.drop.has(s)) && STEM[s]) STEM[s](C, t, b, ch, C.bi, SS, sec);
  C.bi++; C.t += 4 * b;
}
function condPump(C, until){ while (C.t < until) condBar(C); C.q.sort((a, b) => a.t - b.t); let i = 0; while (i < C.q.length && C.q[i].t < until){ C.q[i].f(); i++; } if (i) C.q.splice(0, i);
  if (C.held.length > 24){ const now = C.c.currentTime; C.held = C.held.filter(h => h.end > now); } }
function condCue(C, name, now){ if (C.st === 'cine' && C.cue === name && C.want === 'cine') return; C.want = 'cine'; C.cue = name; C.q = C.q.filter(e => e.t < now + .02);
  for (const h of C.held) if (h.end > now){ const p = h.g.gain; try { (p.cancelAndHoldAtTime ? p.cancelAndHoldAtTime(now) : p.cancelScheduledValues(now)); p.setTargetAtTime(0, now, .35); } catch (e){} } C.held = []; C.t = now + .06; }
function condState(C, w, now){ if (C.want === w) return; const leavingCine = C.want === 'cine'; C.want = w; if (leavingCine){ C.q = C.q.filter(e => e.t < now + .02); for (const h of C.held) if (h.end > now){ const p = h.g.gain; try { (p.cancelAndHoldAtTime ? p.cancelAndHoldAtTime(now) : p.cancelScheduledValues(now)); p.setTargetAtTime(0, now, .6); } catch (e){} } C.held = []; C.t = Math.max(C.t, now + .8); } }
/* ---- live wiring ---- */
let combatHold = 0;
function musicWant(){ if (AU.hold > AU.ctx.currentTime) return 'cine'; if (state === 'cine' || CINE.on) return 'cine'; if (state === 'title') return 'title';
  if (inWilds){ const fight = tAcc - combatT < 6 || ENEMIES.some(e => (e.st === ES.CHASE || e.st === ES.TELE || e.st === ES.ATK) && Math.hypot(e.x - PL.x, e.z - PL.z) < 26); if (fight) combatHold = tAcc + 4; return tAcc < combatHold ? 'combat' : 'wilds'; }
  const n = U ? U.uNight.value : 0, cur = AU.cond.want; return cur === 'night' ? (n > .4 ? 'night' : 'day') : (n > .55 ? 'night' : 'day'); }
function audioStart(){
  if (AU.ctx){ if (AU.ctx.state === 'suspended' && !D.hidden) AU.ctx.resume().catch(() => {}); return; }
  const AC = Wn.AudioContext || Wn.webkitAudioContext; if (!AC) return;
  try { AU.ctx = new AC({ latencyHint: 'interactive' }); } catch (e){ try { AU.ctx = new AC(); } catch (e2){ return; } }
  const c = AU.ctx; AU.G = auGraph(c); applyVol(); AU.A = ambBeds(c, AU.G); AU.glideG = AU.A.glide; AU.glideF = AU.A.glideF;
  AU.cond = condMake(c, AU.G, (Date.now() & 0xffff) + 1); AU.cond.t = c.currentTime + .3; AU.cond.want = musicWant();
  setInterval(() => { const C = AU.cond; if (!C || c.state !== 'running' || AU.muted) return; const now = c.currentTime; if (C.t < now - .05){ C.t = now + .05; C.q = []; } condPump(C, now + .1); }, 25);
  setTimeout(() => bakeAll(), 60);
}
let auT = 0, auMT = 0, hoverEl = null, hoverT = 0, toastSndT = 0;
function audioFrame(dt){
  const c = AU.ctx; if (!c || c.state !== 'running' || !AU.G) return;
  audioListen(camera);
  auT -= dt; if (auT > 0) return; const step = .1 - auT; auT = .1;
  const p = ambParams(step); ambSet(AU.A, p, c.currentTime, AU.G); ambEvents(AU.A, step, p, Math.random, (k, o) => fire(k, o));
  auMT -= step; if (auMT <= 0){ auMT = .5; const w = musicWant(); if (w !== 'cine') condState(AU.cond, w, c.currentTime); }
}
function setMuted(m){
  AU.muted = m; applyVol();
  const b = $('#bMute'); b.setAttribute('aria-pressed', m ? 'true' : 'false'); b.setAttribute('aria-label', m ? 'Unmute sound' : 'Mute sound');
  const i = b.querySelector('.ico'); if (i && ICONS.sound){ i.style.backgroundImage = 'url(' + (m ? ICONS.mute : ICONS.sound) + ')'; }
  $('#vSound').textContent = m ? 'Off' : 'On';
  saveDirty = true;
}
function setVol(k, v){ AU.vol[k] = Math.max(0, Math.min(1, v)); applyVol(); saveDirty = true; }
D.addEventListener('pointerover', e => { const el = e.target && e.target.closest ? e.target.closest('button, .slot, label.btn') : null; if (el && el !== hoverEl){ hoverEl = el; const n = performance.now(); if (n - hoverT > 45){ hoverT = n; SND.hover(); } } else if (!el) hoverEl = null; });
const SND = {
  ok(){ return !!(AU.ctx && !AU.muted && AU.ctx.state === 'running'); },
  step(m){ fire('step:' + (STEPM[m] || 'stone'), { gain: m === 'soft' ? .55 : 1 }); },
  land(k){ fire('land', { gain: Math.min(1.2, .35 + k * .9), rate: 1.05 - Math.min(.2, k * .15) }); fire('step:grass', { gain: .6 }); },
  hit(m){ fire(m === 'flesh' ? 'flesh' : 'hit:' + (HITM[m] || 'stone')); },
  crit(){ fire('crit'); },
  crack(s){ fire('crack', { rate: .85 + s * .05 }); },
  brk(m){ fire('brk:' + (BRKM[m] || 'stone')); },
  place(){ fire('place'); },
  pickup(k){ fire('pickup', { rate: Math.pow(1.06, k || 0) }); },
  ui(){ fire('ui'); }, hover(){ fire('hover'); }, panel(){ fire('panel'); },
  toast(){ const n = performance.now(); if (n - toastSndT > 400){ toastSndT = n; fire('toast'); } },
  deny(){ fire('deny'); }, craft(){ fire('craft'); }, page(){ fire('page'); },
  heart(){ fire('heart'); }, befriend(){ fire('befriend'); }, shard(){ fire('shard'); }, waystone(){ fire('waystone'); }, boing(){ fire('boing'); },
  sail(){ fire('sail'); }, grow(k){ fire('grow', { rate: Math.pow(2, (k % 12) / 12) }); }, rescue(){ fire('rescue'); fire('whoosh', { gain: .6 }); }, whoosh(){ fire('whoosh'); },
  jump(){ fire('jump'); }, dash(){ fire('dash'); }, slide(){ fire('slide'); }, vault(){ fire('vault'); }, flap(){ fire('flap'); },
  chime(k){ fire('chime', { rate: Math.pow(2, (NOTES[k % 5] + 12 * Math.floor(k / 5 % 2)) / 12) }); },
  ring(k){ fire('ring', { rate: Math.pow(2, [0, 2, 4, 7, 9, 12, 14][k % 7] / 12) }); },
  notice(t, e){ fire('notice', { pos: e ? { x: e.x, y: e.y + 1, z: e.z } : null, rate: 1 + (t || 0) * .04 }); },
  tele(t, e){ fire('tele:' + (t || 0), { pos: e ? { x: e.x, y: e.y + 1, z: e.z } : null }); },
  enemyAtk(t, e){ fire('atk:' + (t || 0), { pos: e ? { x: e.x, y: e.y + 1, z: e.z } : null }); },
  enemyDie(t, e){ fire('eDie:' + Math.min(4, t || 0), { pos: e ? { x: e.x, y: e.y + 1, z: e.z } : null }); },
  swing(f){ fire(f === 2 ? 'swing:h' : f === 3 || f === 0 ? 'swing:l' : 'swing:m'); },
  hurt(){ fire('hurt'); }, die(){ fire('die'); }, respawn(){ fire('respawn'); }, eat(){ fire('eat'); },
  chestOpen(r, c){ const pos = c ? { x: c.x + .5, y: c.y + .5, z: c.z + .5 } : null; fire('latch', { pos }); fire('chestCreak', { pos, dt: .06 }); fire('sparkle', { pos, dt: .3, gain: .6 + r * .15 }); fire('sting:' + Math.min(3, r), { dt: .35 }); },
  legendary(){ fire('legendary'); }, reward(){ fire('reward'); },
  voice(k, m){ fire('voice:' + (k === 'puffle' || k === 'kit' ? k : 'jelly'), { pos: m ? { x: m.x, y: m.y + .6, z: m.z } : null }); },
  chirp(){ fire('bird:' + ((Math.random() * 4) | 0)); }, cricket(){ fire('cricket'); },
  grappleFire(){ fire('gFire'); fire('gWhirr', { dt: .05 }); },
  grappleThunk(m, x, y, z){ fire('gThunk:' + (THKM[m] || 'stone'), { pos: x !== undefined ? { x, y, z } : null }); },
  grappleReel(){ fire('gReel'); }, grappleCreak(sp){ fire('gCreak', { gain: Math.min(1.3, .5 + sp * .03) }); }, grappleRelease(){ fire('gRelease'); },
  gift(){ const gn = AU.ctx ? AU.ctx.currentTime : 0; if (gn - (AU.giftT || -99) < 8) return; AU.giftT = gn; fire('gift'); AU.hold = AU.ctx ? AU.ctx.currentTime + 14 : 0; if (AU.cond && AU.ctx) condCue(AU.cond, 'gift', AU.ctx.currentTime); },
  capDuck(){ duck(-4, 2.2); },
  // film score hooks
  score(name){ if (!AU.ctx || !AU.cond) return; const now = AU.ctx.currentTime;
    if (name === 'start'){ condCue(AU.cond, 'wake', now); return; }
    if (name === 'stop'){ if (AU.hold < now) condState(AU.cond, musicWant(), now); return; }
    if (SCORE.st.cine.sec[name]) condCue(AU.cond, name, now); },
  cineHit(k){ fire('impact', { a: (k || 1) * .6 }); },
  cineSfx(n){ if (n === 'riser') fire('riser'); else if (n === 'whoosh') fire('cwhoosh'); else if (n === 'rumble') fire('rumble'); else if (n === 'arp'){ const tr = AU.cond && AU.cond.cue && SCORE.st.cine.sec[AU.cond.cue] ? SCORE.st.cine.sec[AU.cond.cue].tr || 0 : 0; [62, 66, 69, 74, 78, 81].forEach((m, i) => fire('voxClick', { rate: mtof(m + 12 + tr) / 1175, dt: i * .13, gain: 1.6 })); } },
  voxBuild(n){ fire('voxBuild', { gain: .6 + Math.min(.6, n / 6000) }); },
  voxClick(i){ const tr = AU.cond && SCORE.st.cine.sec[AU.cond.cue] ? SCORE.st.cine.sec[AU.cond.cue].tr || 0 : 0; fire('voxClick', { rate: mtof(86 + tr + NOTES[i % 5] + (i % 10 >= 5 ? 12 : 0)) / 1175 }); },
  voxCrumble(){ fire('voxCrumble'); }
};
