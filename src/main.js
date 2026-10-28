/* Glue: one first-person scene, one terminal, one typist, sound, one loop. */
(() => {
'use strict';
const M = window.MAC, D = document, $ = s => D.querySelector(s);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TOUCH = matchMedia('(pointer: coarse)').matches;
const stage = $('#stage');
let api;
try { api = M.createScene(stage); } catch (e){ console.error(e); $('#loading').textContent = 'this needs WebGL'; return; }
if (M.dressRoom) { try { M.dressRoom(api); } catch (e){ console.error(e); } }
M.world = {
  lamp: on => api.setLamp ? api.setLamp(on === undefined ? !api.lampOn : on) : null,
  get lampOn(){ return !!api.lampOn; },
};
const term = M.createTerminal({ content: M.CONTENT, aspect: api.screenAspect });
api.setScreenCanvas(term.canvas);
const typist = M.createTypist(api); if (typist.object3d && !typist.object3d.parent) api.add(typist.object3d);
const sound = M.sound;
const look = (x, y) => (api.setLook || api.setPointer || (() => {}))(x, y);

/* ---- sound: unlocked by the first gesture; a small toggle, remembered ---- */
let unlocked = false;
function unlock(){ if (unlocked || !sound) return; unlocked = true; try { sound.unlock(); } catch (e){} }
const muteBtn = $('#mute');
function paintMute(){ const m = sound ? !!sound.muted : true; muteBtn.textContent = m ? 'sound off' : 'sound on'; muteBtn.setAttribute('aria-pressed', String(m)); }
if (!sound) muteBtn.hidden = true;
muteBtn.addEventListener('click', () => { unlock(); sound.setMuted(!sound.muted); paintMute(); });
paintMute();

/* ---- input: physical keyboards drive the terminal and the typist's hands ---- */
const held = new Set();
function onDown(e){
  if (e.metaKey) return;   // Ctrl combos go to the terminal; it only consumes the ones it handles
  if (e.target === muteBtn) return;
  unlock();
  if (term.handleKey(e)) e.preventDefault();
  const code = e.code || 'KeyA';
  if (!held.has(code)){ held.add(code); typist.keyDown(code); if (api.nudge) api.nudge(); }
  firstKey();
}
function onUp(e){ const code = e.code || 'KeyA'; if (held.has(code)){ held.delete(code); typist.keyUp(code); } }
addEventListener('keydown', onDown); addEventListener('keyup', onUp);
addEventListener('blur', () => { for (const c of held) typist.keyUp(c); held.clear(); });

/* ---- phones: tap to raise the keyboard (text arrives via a hidden textarea); drag to look around ---- */
const kbd = $('#kbd');
const codeFor = ch => /[a-z]/i.test(ch) ? 'Key' + ch.toUpperCase() : /\d/.test(ch) ? 'Digit' + ch : ch === ' ' ? 'Space' : ch === '.' ? 'Period' : ch === ',' ? 'Comma' : ch === '-' ? 'Minus' : ch === '/' ? 'Slash' : 'Quote';
kbd.addEventListener('input', () => {
  const v = kbd.value; kbd.value = '';
  for (const ch of v){ term.insertText(ch); const code = codeFor(ch); typist.keyDown(code); setTimeout(() => typist.keyUp(code), 90); }
  firstKey();
});
kbd.addEventListener('keydown', e => { if (['Enter', 'Backspace', 'Tab', 'Escape'].includes(e.key) || e.key.startsWith('Arrow')){ onDown(e); e.stopPropagation(); } });
kbd.addEventListener('keyup', e => { onUp(e); e.stopPropagation(); });
/* two views: scroll (or swipe on touch) steps back to the whole desk or in to the screen; shift+scroll scrolls the terminal */
const setView = v => { if (api.setView) api.setView(v); };
let wheelAcc = 0, wheelLock = 0;
addEventListener('wheel', e => {
  e.preventDefault();
  if (e.shiftKey && term.scroll){ term.scroll(e.deltaY || e.deltaX); return; }
  const now = performance.now(); if (now < wheelLock) return;
  wheelAcc += e.deltaY; if (Math.abs(wheelAcc) < 30) return;
  setView(wheelAcc > 0 ? 'full' : 'screen'); wheelAcc = 0; wheelLock = now + 450;
}, { passive: false });
addEventListener('keydown', e => { if (e.key === 'PageUp' || e.key === 'PageDown'){ if (term.scroll) term.scroll(e.key === 'PageUp' ? -300 : 300); } });
let drag = null;
stage.addEventListener('pointerdown', e => {
  unlock();
  if (e.pointerType !== 'mouse'){ drag = { y: e.clientY, moved: false }; stage.setPointerCapture(e.pointerId); }
});
stage.addEventListener('pointermove', e => {
  if (!drag) return; const dy = e.clientY - drag.y;
  if (Math.abs(dy) > 50 && !drag.moved){ drag.moved = true; setView(dy < 0 ? 'full' : 'screen'); }
});
stage.addEventListener('pointerup', () => { if (drag && !drag.moved) kbd.focus(); drag = null; });
stage.addEventListener('pointercancel', () => { drag = null; });
addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && !REDUCED) look(e.clientX / innerWidth * 2 - 1, e.clientY / innerHeight * 2 - 1); });
D.documentElement.addEventListener('mouseleave', () => look(0, 0));

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
  typist.update(dt, T); api.update(dt, T); if (sound && sound.update) sound.update(dt); api.render();
}
D.addEventListener('visibilitychange', () => { if (D.hidden) cancelAnimationFrame(raf); else { last = performance.now(); raf = requestAnimationFrame(frame); } });
const go = () => { $('#loading').classList.add('gone'); fromHash(); raf = requestAnimationFrame(frame); if (TOUCH) $('#hint').innerHTML = 'tap the screen to type · swipe up to step back'; };
(D.fonts ? Promise.race([D.fonts.ready, new Promise(r => setTimeout(r, 1500))]) : Promise.resolve()).then(go);
})();
