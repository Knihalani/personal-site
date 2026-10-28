/* Glue: one first-person scene, one terminal, one typist, sound, one loop. Phones get the terminal alone. */
(() => {
'use strict';
const M = window.MAC, D = document, $ = s => D.querySelector(s);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TOUCH = matchMedia('(pointer: coarse)').matches;
const stage = $('#stage'), kbd = $('#kbd'), muteBtn = $('#mute'), sound = M.sound;
const reading = () => !!(M.reader && M.reader.isOpen);   // the reader owns the keyboard while it is open

/* ---- shared by both layouts ---- */
/* sound: unlocked by the first gesture */
let unlocked = false;
function unlock(){ if (unlocked || !sound) return; unlocked = true; try { sound.unlock(); } catch (e){} }
/* the toggle keeps one label; aria-pressed (and the dot drawn from it) says whether sound is on. Remembered by sound.js */
function setupMute(afterClick){
  if (!sound){ muteBtn.hidden = true; return; }
  const paint = () => muteBtn.setAttribute('aria-pressed', String(!sound.muted));
  muteBtn.addEventListener('click', e => { unlock(); sound.setMuted(!sound.muted); paint(); if (e.detail && afterClick) afterClick(); });
  paint();
}
/* #post/<slug>: true when the hash is a post link (opened, or already open) */
function openPost(id){
  const m = /^post\/(.+)$/.exec(id || ''); if (!m) return false;
  let slug = m[1]; try { slug = decodeURIComponent(slug); } catch (e){}
  if (M.reader && !(M.reader.isOpen && M.reader.current === slug)) M.reader.open(slug);
  return true;
}
/* deep links: #eden, #j, #about, #writing run the matching command; #post/<slug> opens the reader */
function deepLinks(term){
  const fromHash = () => { const id = location.hash.slice(1); if (!openPost(id) && id && term.run) term.run(id); };
  addEventListener('hashchange', fromHash);
  return fromHash;
}
/* start once the fonts are in (or after 1.5 s, whichever comes first) */
function whenReady(go){
  (D.fonts ? Promise.race([D.fonts.ready, new Promise(r => setTimeout(r, 1500))]) : Promise.resolve())
    .then(() => { $('#loading').classList.add('gone'); go(); });
}

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
const look = (x, y) => api.setLook && api.setLook(x, y);
/* #kbd is the real text field (screen readers, IME, paste); keystrokes themselves are read from keydown */
const focusInput = () => { if (!reading() && D.activeElement !== kbd) try { kbd.focus({ preventScroll: true }); } catch (e){} };
setupMute(focusInput);

/* ---- input: physical keyboards drive the terminal and the typist's hands ---- */
const held = new Set();
function onDown(e){
  if (e.metaKey || reading()) return;   // Ctrl combos go to the terminal; it only consumes the ones it handles
  if (e.target === muteBtn) return;
  unlock();
  if (term.handleKey(e)) e.preventDefault();
  else if (e.target === kbd && e.key.length === 1 && !e.ctrlKey) e.preventDefault();   // a key the terminal ignored types nothing
  const code = e.code || 'KeyA';
  if (!held.has(code)){ held.add(code); typist.keyDown(code); if (api.nudge) api.nudge(); }
}
function onUp(e){ if (term.handleKeyUp) term.handleKeyUp(e); const code = e.code || 'KeyA'; if (held.has(code)){ held.delete(code); typist.keyUp(code); } }
addEventListener('keydown', onDown); addEventListener('keyup', onUp);
addEventListener('blur', () => { for (const c of held) typist.keyUp(c); held.clear(); });

/* text that reaches #kbd without a handled keydown: touch keyboards, IME, paste */
const codeFor = ch => /[a-z]/i.test(ch) ? 'Key' + ch.toUpperCase() : /\d/.test(ch) ? 'Digit' + ch : ch === ' ' ? 'Space' : ch === '.' ? 'Period' : ch === ',' ? 'Comma' : ch === '-' ? 'Minus' : ch === '/' ? 'Slash' : 'Quote';
function takeText(){
  const v = kbd.value; kbd.value = ''; if (!v) return;
  if (v.length > 4){ term.insertText(v); return; }          // a paste: no finger show
  for (const ch of v){ term.insertText(ch); const code = codeFor(ch); typist.keyDown(code); setTimeout(() => typist.keyUp(code), 90); }
}
kbd.addEventListener('input', e => { if (!e.isComposing) takeText(); });
kbd.addEventListener('compositionend', takeText);
kbd.addEventListener('keydown', e => { if (reading()) return; if (['Enter', 'Backspace', 'Tab', 'Escape'].includes(e.key) || e.key.startsWith('Arrow')){ onDown(e); e.stopPropagation(); } });
kbd.addEventListener('keyup', e => { onUp(e); e.stopPropagation(); });
/* the wheel scrolls the terminal; the cursor looks around, and moving it down leans back to the whole desk */
addEventListener('wheel', e => { if (reading()) return; if (term.scroll){ term.scroll(e.deltaY); e.preventDefault(); } }, { passive: false });
addEventListener('keydown', e => { if (reading()) return; if (e.key === 'PageUp' || e.key === 'PageDown'){ if (term.scroll) term.scroll(e.key === 'PageUp' ? -300 : 300); } });
stage.addEventListener('pointerdown', () => unlock());
/* clicking the tube: command words and card rows on the terminal are clickable (the scene maps the click to the canvas) */
stage.addEventListener('click', e => {
  if (reading()) return;
  const p = api.pickScreen && term.handleTap ? api.pickScreen(e.clientX, e.clientY) : null;
  if (p && term.handleTap(p.u, p.v)){ unlock(); if (api.markScreenDirty) api.markScreenDirty(); }
  focusInput();
});

/* the one hint: shown once, gone after the first lean or ~12 s. Without pointer look (reduced motion) there is none */
const hint = $('#hint');
let hintT = 0;
const hideHint = () => { if (!hintT) return; clearTimeout(hintT); hintT = 0; hint.style.opacity = '0'; setTimeout(() => { hint.hidden = true; }, 1300); };
addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse' || REDUCED || reading()) return;
  const ny = e.clientY / innerHeight * 2 - 1;
  look(e.clientX / innerWidth * 2 - 1, ny);
  if (ny > 0.5) hideHint();
});
D.documentElement.addEventListener('mouseleave', () => look(0, 0));

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
const fromHash = deepLinks(term);
whenReady(() => {
  fromHash(); focusInput(); raf = requestAnimationFrame(frame);
  if (!REDUCED && !matchMedia('(hover: none)').matches){ hint.hidden = false; hintT = setTimeout(hideHint, 12000); }
});

function phone(){
  D.body.classList.add('phone');
  /* the terminal fills the screen below the header strip (and above the home indicator) */
  const probe = D.createElement('div'); probe.className = 'phone-term'; probe.style.cssText = 'visibility:hidden;padding-bottom:env(safe-area-inset-bottom, 0px)';
  stage.appendChild(probe);
  const top = probe.offsetTop, inset = parseFloat(getComputedStyle(probe).paddingBottom) || 0; probe.remove();
  const W = innerWidth, H = Math.max(200, innerHeight - top - inset);
  const term = M.createTerminal({ content: M.CONTENT, aspect: W / H, cols: W < 420 ? 40 : W < 600 ? 46 : 54 });
  const cv = term.canvas; cv.className = 'phone-term'; cv.style.height = H + 'px'; stage.appendChild(cv);
  setupMute(null);
  const click = (c, d) => { if (sound) try { sound.key(c, d); } catch (e){} };
  const tap = c => { click(c, true); setTimeout(() => click(c, false), 70); };
  kbd.addEventListener('input', () => { const v = kbd.value; kbd.value = ''; for (const ch of v){ term.insertText(ch); tap(ch === ' ' ? 'Space' : 'KeyA'); } });
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
  // keep the prompt line above the on-screen keyboard: measured from the canvas's untransformed top
  let shift = 0;
  const place = () => {
    const vv = window.visualViewport, bottom = vv ? vv.offsetTop + vv.height : innerHeight;
    const y = stage.getBoundingClientRect().top + cv.offsetTop + term.cursorY * cv.offsetHeight;
    const s = Math.min(0, Math.round(bottom - 8 - y));
    if (s !== shift){ shift = s; cv.style.transform = s ? 'translateY(' + s + 'px)' : ''; }
  };
  if (window.visualViewport){ visualViewport.addEventListener('resize', place); visualViewport.addEventListener('scroll', place); }
  const fromHash = deepLinks(term);
  let last = performance.now(), T = 0;
  const frame = now => { requestAnimationFrame(frame); const dt = Math.min(.05, (now - last) / 1000); last = now; T += dt; if (term.update(dt, T)) place(); };
  whenReady(() => { fromHash(); place(); requestAnimationFrame(frame); });
}
})();
