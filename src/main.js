/* Glue: one first-person scene, one terminal, one typist, sound, one loop. */
(() => {
'use strict';
const M = window.MAC, D = document, $ = s => D.querySelector(s);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TOUCH = matchMedia('(pointer: coarse)').matches;
const stage = $('#stage');
let api;
try { api = M.createScene(stage); } catch (e){ console.error(e); $('#loading').textContent = 'this needs WebGL'; return; }
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
let drag = null;
stage.addEventListener('pointerdown', e => {
  unlock();
  if (e.pointerType !== 'mouse'){ drag = { x: e.clientX, y: e.clientY, moved: false }; stage.setPointerCapture(e.pointerId); }
});
stage.addEventListener('pointermove', e => {
  if (drag){ const dx = (e.clientX - drag.x) / innerWidth * 2.2, dy = (e.clientY - drag.y) / innerHeight * 2.2; if (Math.hypot(dx, dy) > .03) drag.moved = true; look(Math.max(-1, Math.min(1, dx)), Math.max(-1, Math.min(1, dy))); }
});
stage.addEventListener('pointerup', e => { if (drag && !drag.moved) kbd.focus(); drag = null; look(0, 0); });
stage.addEventListener('pointercancel', () => { drag = null; look(0, 0); });
addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && !REDUCED) look(e.clientX / innerWidth * 2 - 1, e.clientY / innerHeight * 2 - 1); });
D.documentElement.addEventListener('mouseleave', () => look(0, 0));
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
  typist.update(dt, T); api.update(dt, T); if (sound && sound.update) sound.update(dt); api.render();
}
D.addEventListener('visibilitychange', () => { if (D.hidden) cancelAnimationFrame(raf); else { last = performance.now(); raf = requestAnimationFrame(frame); } });
const go = () => { $('#loading').classList.add('gone'); fromHash(); raf = requestAnimationFrame(frame); if (TOUCH) $('#hint').innerHTML = 'tap the screen to type · drag to look around'; };
(D.fonts ? Promise.race([D.fonts.ready, new Promise(r => setTimeout(r, 1500))]) : Promise.resolve()).then(go);
})();
