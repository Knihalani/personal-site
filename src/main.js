/* Glue: one first-person scene, one terminal, one typist, sound, one loop. */
(() => {
'use strict';
const M = window.MAC, D = document, $ = s => D.querySelector(s);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TOUCH = matchMedia('(pointer: coarse)').matches;
const stage = $('#stage');
/* phones and small tablets: just the terminal, full screen, no 3D */
if (TOUCH && Math.min(innerWidth, innerHeight) < 820){ phone(); return; }
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
const reading = () => !!(M.reader && M.reader.isOpen);   // the reader owns the keyboard while it is open
function onDown(e){
  if (e.metaKey || reading()) return;   // Ctrl combos go to the terminal; it only consumes the ones it handles
  if (e.target === muteBtn) return;
  unlock();
  if (term.handleKey(e)) e.preventDefault();
  const code = e.code || 'KeyA';
  if (!held.has(code)){ held.add(code); typist.keyDown(code); if (api.nudge) api.nudge(); }
  firstKey();
}
function onUp(e){ if (term.handleKeyUp) term.handleKeyUp(e); const code = e.code || 'KeyA'; if (held.has(code)){ held.delete(code); typist.keyUp(code); } }
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
kbd.addEventListener('keydown', e => { if (reading()) return; if (['Enter', 'Backspace', 'Tab', 'Escape'].includes(e.key) || e.key.startsWith('Arrow')){ onDown(e); e.stopPropagation(); } });
kbd.addEventListener('keyup', e => { onUp(e); e.stopPropagation(); });
/* the wheel scrolls the terminal; the cursor looks around, and moving it down leans back to the whole desk */
addEventListener('wheel', e => { if (reading()) return; if (term.scroll){ term.scroll(e.deltaY); e.preventDefault(); } }, { passive: false });
addEventListener('keydown', e => { if (reading()) return; if (e.key === 'PageUp' || e.key === 'PageDown'){ if (term.scroll) term.scroll(e.key === 'PageUp' ? -300 : 300); } });
stage.addEventListener('pointerdown', () => unlock());
/* clicking the tube: command words and card rows on the terminal are clickable (the scene maps the click to the canvas) */
stage.addEventListener('click', e => {
  if (reading() || !api.pickScreen || !term.handleTap) return;
  const p = api.pickScreen(e.clientX, e.clientY); if (p && term.handleTap(p.u, p.v)){ unlock(); if (api.markScreenDirty) api.markScreenDirty(); }
});
addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && !REDUCED && !reading()) look(e.clientX / innerWidth * 2 - 1, e.clientY / innerHeight * 2 - 1); });
D.documentElement.addEventListener('mouseleave', () => look(0, 0));

let typed = false;
function firstKey(){ if (typed) return; typed = true; $('#hint').style.opacity = '0'; }

/* ---- deep links: #eden, #j, #about, #writing run the matching command; #post/<slug> opens the reader ---- */
function fromHash(){ const id = location.hash.slice(1); if (!openPost(id) && id && term.run) term.run(id); }
addEventListener('hashchange', fromHash);

/* ---- loop ---- */
function resize(){ api.resize(innerWidth, innerHeight); }
addEventListener('resize', resize); resize();
let last = performance.now(), T = 0, raf = 0;
function frame(now){
  raf = requestAnimationFrame(frame);
  const dt = Math.min(.05, (now - last) / 1000); last = now; T += dt;
  if (term.update(dt, T)) api.markScreenDirty();
  if (reading()) return;   // the reader sheet covers the room: hold the last frame and save the GPU
  typist.update(dt, T); api.update(dt, T); if (sound && sound.update) sound.update(dt); api.render();
}
D.addEventListener('visibilitychange', () => { if (D.hidden) cancelAnimationFrame(raf); else { last = performance.now(); raf = requestAnimationFrame(frame); } });
const go = () => { $('#loading').classList.add('gone'); fromHash(); raf = requestAnimationFrame(frame); };
(D.fonts ? Promise.race([D.fonts.ready, new Promise(r => setTimeout(r, 1500))]) : Promise.resolve()).then(go);

function phone(){
  D.body.classList.add('phone');
  const W = innerWidth, H = (window.visualViewport ? visualViewport.height : innerHeight);
  const term = M.createTerminal({ content: M.CONTENT, aspect: W / innerHeight, cols: W < 420 ? 40 : W < 600 ? 46 : 54 });
  const cv = term.canvas; cv.className = 'phone-term'; stage.appendChild(cv);
  const sound = M.sound, kbd = $('#kbd'), muteBtn = $('#mute');
  let unlocked = false; const unlock = () => { if (unlocked || !sound) return; unlocked = true; try { sound.unlock(); } catch (e){} };
  const paint = () => { const m = sound ? !!sound.muted : true; muteBtn.textContent = m ? 'sound off' : 'sound on'; };
  if (!sound) muteBtn.hidden = true; else { muteBtn.addEventListener('click', () => { unlock(); sound.setMuted(!sound.muted); paint(); }); paint(); }
  $('#hint').innerHTML = 'tap to type · try <b>help</b>';
  const click = (c, d) => { if (sound) try { sound.key(c, d); } catch (e){} };
  const tap = c => { click(c, true); setTimeout(() => click(c, false), 70); };
  kbd.addEventListener('input', () => { const v = kbd.value; kbd.value = ''; for (const ch of v){ term.insertText(ch); tap(ch === ' ' ? 'Space' : 'KeyA'); } $('#hint').style.opacity = '0'; });
  const reading = () => !!(M.reader && M.reader.isOpen);
  kbd.addEventListener('keydown', e => { if (reading()) return; if (['Enter', 'Backspace', 'Tab', 'Escape', 'Home', 'End', 'PageUp', 'PageDown', 'Delete'].includes(e.key) || e.key.startsWith('Arrow') || ((e.ctrlKey || e.altKey) && e.key.length === 1)){ unlock(); if (term.handleKey(e)) e.preventDefault(); tap(e.key === 'Enter' ? 'Enter' : e.key === 'Backspace' ? 'Backspace' : 'KeyA'); } });
  addEventListener('keydown', e => { if (e.target === kbd || e.metaKey || reading()) return; unlock(); if (term.handleKey(e)) e.preventDefault(); });
  stage.addEventListener('pointerdown', () => { unlock(); });
  stage.addEventListener('click', e => {
    const r = cv.getBoundingClientRect();
    if (term.handleTap && term.handleTap((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)){ unlock(); return; }   // a card row: copy / open
    kbd.focus();
  });
  // touch drag scrolls the terminal's history
  let ty = null; stage.addEventListener('touchstart', e => { ty = e.touches[0].clientY; }, { passive: true });
  stage.addEventListener('touchmove', e => { if (ty == null || !term.scroll) return; const y = e.touches[0].clientY; term.scroll((ty - y) * 2.5); ty = y; e.preventDefault(); }, { passive: false });
  // keep the prompt line above the on-screen keyboard
  const place = () => {
    const vh = window.visualViewport ? visualViewport.height : innerHeight, ch = cv.getBoundingClientRect().height || innerHeight;
    const y = term.cursorY * ch, shift = Math.min(0, vh - 18 - y);
    cv.style.transform = 'translateY(' + shift.toFixed(1) + 'px)';
  };
  if (window.visualViewport) visualViewport.addEventListener('resize', place);
  function fromHash(){ const id = location.hash.slice(1); if (!openPost(id) && id && term.run) term.run(id); }
  addEventListener('hashchange', fromHash);
  let last = performance.now(), T = 0;
  const frame = now => { requestAnimationFrame(frame); const dt = Math.min(.05, (now - last) / 1000); last = now; T += dt; if (term.update(dt, T)) place(); };
  const go = () => { $('#loading').classList.add('gone'); fromHash(); requestAnimationFrame(frame); };
  (D.fonts ? Promise.race([D.fonts.ready, new Promise(r => setTimeout(r, 1500))]) : Promise.resolve()).then(go);
}
/* #post/<slug>: true when the hash is a post link (opened, or already open) */
function openPost(id){
  const m = /^post\/(.+)$/.exec(id || ''); if (!m) return false;
  let slug = m[1]; try { slug = decodeURIComponent(slug); } catch (e){}
  if (M.reader && !(M.reader.isOpen && M.reader.current === slug)) M.reader.open(slug);
  return true;
}
})();
