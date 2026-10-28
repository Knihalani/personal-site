/* Glue: one scene, one terminal, one typist, one loop. */
(() => {
'use strict';
const M = window.MAC, D = document, $ = s => D.querySelector(s);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const stage = $('#stage');
let api;
try { api = M.createScene(stage); } catch (e){ console.error(e); $('#loading').textContent = 'this needs WebGL'; return; }
const term = M.createTerminal({ content: M.CONTENT, aspect: api.screenAspect });
api.setScreenCanvas(term.canvas);
const typist = M.createTypist(api); if (typist.object3d && !typist.object3d.parent) api.add(typist.object3d);

/* ---- input: physical keyboards drive both the terminal and the typist's hands ---- */
const held = new Set();
function onDown(e){
  if (e.metaKey) return;   // Ctrl combos go to the terminal; it only consumes the ones it handles
  if (e.target === $('#view')) return;
  if (term.handleKey(e)) e.preventDefault();
  const code = e.code || 'KeyA';
  if (!held.has(code)){ held.add(code); typist.keyDown(code); }
  firstKey();
}
function onUp(e){ const code = e.code || 'KeyA'; if (held.has(code)){ held.delete(code); typist.keyUp(code); } }
addEventListener('keydown', onDown); addEventListener('keyup', onUp);
addEventListener('blur', () => { for (const c of held) typist.keyUp(c); held.clear(); });

/* ---- phones: tap the scene to raise the keyboard; text arrives through a hidden textarea ---- */
const kbd = $('#kbd');
stage.addEventListener('pointerdown', () => { if (matchMedia('(pointer: coarse)').matches){ kbd.focus(); if (view !== 'pov') setView('pov'); } });
kbd.addEventListener('input', () => {
  const v = kbd.value; kbd.value = '';
  for (const ch of v){ term.insertText(ch); const code = /[a-z]/i.test(ch) ? 'Key' + ch.toUpperCase() : /\d/.test(ch) ? 'Digit' + ch : ch === ' ' ? 'Space' : 'Period'; typist.keyDown(code); setTimeout(() => typist.keyUp(code), 90); }
  firstKey();
});
kbd.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'Backspace' || e.key === 'Tab' || e.key.startsWith('Arrow')){ onDown(e); e.stopPropagation(); } });

/* ---- view toggle: cinematic over-the-shoulder, or the screen filling the frame for reading ---- */
let view = 'pov';
function setView(v){ view = v; api.setView(v); const b = $('#view'); b.textContent = v === 'pov' ? 'look around' : 'back to the screen'; b.setAttribute('aria-pressed', String(v !== 'pov')); }
$('#view').addEventListener('click', () => setView(view === 'pov' ? 'scene' : 'pov'));
addEventListener('dblclick', () => setView(view === 'pov' ? 'scene' : 'pov'));
addEventListener('pointermove', e => api.setPointer(e.clientX / innerWidth * 2 - 1, e.clientY / innerHeight * 2 - 1));
addEventListener('wheel', e => { if (term.scroll){ term.scroll(e.deltaY); e.preventDefault(); } }, { passive: false });

let typed = false;
function firstKey(){ if (typed) return; typed = true; $('#hint').style.opacity = '0'; }

/* ---- deep links: #eden, #j, #about, #writing run the matching command ---- */
function fromHash(){ const id = location.hash.slice(1); if (id && term.run) term.run(id); }
addEventListener('hashchange', fromHash);

/* ---- loop ---- */
function resize(){ api.resize(innerWidth, innerHeight); }
addEventListener('resize', resize); resize();
let last = performance.now(), T = 0, raf = 0;
function frame(now){
  raf = requestAnimationFrame(frame);
  const dt = Math.min(.05, (now - last) / 1000); last = now; T += dt;
  if (term.update(dt, T)) api.markScreenDirty();
  typist.update(dt, T); api.update(dt, T); api.render();
}
D.addEventListener('visibilitychange', () => { if (D.hidden) cancelAnimationFrame(raf); else { last = performance.now(); raf = requestAnimationFrame(frame); } });
const go = () => { $('#loading').classList.add('gone'); fromHash(); raf = requestAnimationFrame(frame); };
(D.fonts ? Promise.race([D.fonts.ready, new Promise(r => setTimeout(r, 1500))]) : Promise.resolve()).then(go);
})();
