/* Glue: one first-person scene, one terminal, one typist, sound, one loop. Phones, and any machine where the 3D
   cannot run (no WebGL, three.js blocked, the GPU gives up), get the terminal alone. */
(() => {
'use strict';
const M = window.MAC, D = document, $ = s => D.querySelector(s);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TOUCH = matchMedia('(pointer: coarse)').matches;
const small = () => TOUCH;   // phones and tablets: touch has no cursor to look with or lean back, so the terminal alone
const stage = $('#stage'), kbd = $('#kbd'), muteBtn = $('#mute'), hint = $('#hint'), sound = M.sound;
const reading = () => !!(M.reader && M.reader.isOpen);   // the reader owns the keyboard while it is open
let errs = 0;
const oops = e => { if (!errs++) console.error('kept going after:', e); };   // logged once; the loop carries on

/* ---- shared by both layouts ---- */
/* sound: unlocked by the first gesture */
let unlocked = false;
function unlock(){ if (unlocked || !sound) return; unlocked = true; try { sound.unlock(); } catch (e){} }
/* the toggle keeps one label; aria-pressed (and the dot drawn from it) says whether sound is on. Remembered by sound.js */
function setupMute(afterClick, signal){
  if (!sound){ muteBtn.hidden = true; return; }
  const paint = () => muteBtn.setAttribute('aria-pressed', String(!sound.muted));
  muteBtn.addEventListener('click', e => { unlock(); sound.setMuted(!sound.muted); paint(); if (e.detail && afterClick) afterClick(); }, { signal });
  paint();
}
/* #post/<slug>: true when the hash is a post link (opened, or already open) */
function openPost(id){
  const m = /^post\/(.+)$/.exec(id || ''); if (!m) return false;
  let slug = m[1]; try { slug = decodeURIComponent(slug); } catch (e){}
  if (M.reader && !(M.reader.isOpen && M.reader.current === slug)) M.reader.open(slug);
  return true;
}
/* deep links: #about, #j, #eden, #writing, #contact, #links, #help run that command; #post/<slug> opens the reader.
   Anything else in the hash is ignored (a link never runs an arbitrary command line) */
function deepLinks(getTerm, signal){
  const fromHash = () => {
    const id = location.hash.slice(1), t = getTerm();
    if (!openPost(id) && /^(about|j|eden|writing|contact|links|help)$/.test(id) && t.run) t.run(id);
  };
  addEventListener('hashchange', fromHash, { signal });
  return fromHash;
}
/* start once the fonts are in (or after 1.5 s, whichever comes first) */
function whenReady(go){
  (D.fonts ? Promise.race([D.fonts.ready, new Promise(r => setTimeout(r, 1500))]) : Promise.resolve())
    .then(() => { $('#loading').classList.add('gone'); go(); });
}

/* phones and small tablets: just the terminal, full screen (head.html does not even fetch three.js for them) */
if (small()){ flat(); return; }
/* three.js comes in on its own (head.html): the room starts when it is here. A desktop where it fails, or has not
   arrived after 10 s (a hung CDN), gets the terminal alone, as without WebGL */
const start = () => {
  if (window.THREE && !M.createScene && M.loadScene) M.loadScene();   // scene.js was parsed before three.js arrived
  if (!window.THREE || !M.createScene){ console.warn('3D off: three.js did not load'); flat(); return; }
  room();
};
if (window.THREE || !M.three) start();
else Promise.race([M.three, new Promise(r => setTimeout(r, 10000))]).then(start);

function room(){
let api;
try { api = M.createScene(stage); } catch (e){ console.warn('3D off:', e && e.message); stage.textContent = ''; flat(); return; }
/* everything the 3D layout listens to goes when it is torn down (toFlat) */
const ac = new AbortController(), sig = { signal: ac.signal };
const on = (t, type, f, o) => t.addEventListener(type, f, Object.assign({}, sig, o));
let dead = false, raf = 0;
function toFlat(why){
  if (dead) return; dead = true; console.warn('3D off:', why);
  ac.abort(); cancelAnimationFrame(raf); hint.hidden = true;
  try { api.renderer.dispose(); } catch (e){}
  stage.textContent = ''; flat(term);   // the same terminal carries on: scrollback, cwd, a running app
}
if (M.dressRoom) { try { M.dressRoom(api); } catch (e){ console.error(e); } }
M.world = {
  lamp: on => api.setLamp ? api.setLamp(on === undefined ? !api.lampOn : on) : null,
  get lampOn(){ return !!api.lampOn; },
};
const term = M.createTerminal({ content: M.CONTENT, aspect: api.screenAspect });
api.setScreenCanvas(term.canvas);
let typist;
try { typist = M.createTypist(api); if (typist.object3d && !typist.object3d.parent) api.add(typist.object3d); }
catch (e){ oops(e); typist = { keyDown(){}, keyUp(){}, update(){} }; }   // no hands is better than no site
const look = (x, y) => api.setLook && api.setLook(x, y);
/* #kbd is the real text field (screen readers, IME, paste); keystrokes themselves are read from keydown */
const focusInput = () => { if (!reading() && D.activeElement !== kbd) try { kbd.focus({ preventScroll: true }); } catch (e){} };
setupMute(focusInput, ac.signal);

/* ---- input: physical keyboards drive the terminal and the typist's hands ---- */
const held = new Set();
function onDown(e){
  if (e.metaKey || reading()) return;   // Ctrl combos go to the terminal; it only consumes the ones it handles
  if (e.target === muteBtn){ if (e.key.length !== 1 || e.key === ' ') return; focusInput(); }   // letters typed on the toggle go back to the prompt
  unlock();
  if (term.handleKey(e)) e.preventDefault();
  else if (e.target === kbd && e.key.length === 1 && !e.ctrlKey) e.preventDefault();   // a key the terminal ignored types nothing
  const code = e.code || 'KeyA';
  if (!held.has(code)){ held.add(code); typist.keyDown(code); if (api.nudge) api.nudge(); }
}
function onUp(e){ if (term.handleKeyUp) term.handleKeyUp(e); const code = e.code || 'KeyA'; if (held.has(code)){ held.delete(code); typist.keyUp(code); } }
on(window, 'keydown', onDown); on(window, 'keyup', onUp);
on(window, 'blur', () => { for (const c of held) typist.keyUp(c); held.clear(); });

/* text that reaches #kbd without a handled keydown: touch keyboards, IME, paste */
const codeFor = ch => /[a-z]/i.test(ch) ? 'Key' + ch.toUpperCase() : /\d/.test(ch) ? 'Digit' + ch : ch === ' ' ? 'Space' : ch === '.' ? 'Period' : ch === ',' ? 'Comma' : ch === '-' ? 'Minus' : ch === '/' ? 'Slash' : 'Quote';
function takeText(){
  const v = kbd.value; kbd.value = ''; if (!v) return;
  if (v.length > 4){ term.insertText(v); return; }          // a paste: no finger show
  for (const ch of v){ term.insertText(ch); const code = codeFor(ch); typist.keyDown(code); setTimeout(() => typist.keyUp(code), 90); }
}
on(kbd, 'input', e => { if (!e.isComposing) takeText(); });
on(kbd, 'compositionend', takeText);
on(kbd, 'keydown', e => { if (reading()) return; if (['Enter', 'Backspace', 'Tab', 'Escape'].includes(e.key) || e.key.startsWith('Arrow')){ onDown(e); e.stopPropagation(); } });
on(kbd, 'keyup', e => { onUp(e); e.stopPropagation(); });
/* the wheel scrolls the terminal; the cursor looks around, and moving it down leans back to the whole desk */
on(window, 'wheel', e => { if (reading()) return; if (term.scroll){ term.scroll(e.deltaY); e.preventDefault(); } }, { passive: false });
on(stage, 'pointerdown', () => unlock());
/* clicking the tube: command words and card rows on the terminal are clickable (the scene maps the click to the canvas) */
on(stage, 'click', e => {
  if (reading()) return;
  const p = api.pickScreen && term.handleTap ? api.pickScreen(e.clientX, e.clientY) : null;
  if (p && term.handleTap(p.u, p.v)){ unlock(); if (api.markScreenDirty) api.markScreenDirty(); }
  focusInput();
});

/* the one hint: shown once, gone after the first lean or ~12 s. Without pointer look (reduced motion) there is none */
let hintT = 0, hintIn = 0;
const hideHint = () => { if (!hintT) return; clearTimeout(hintT); clearTimeout(hintIn); hintT = 0; hint.style.opacity = '0'; setTimeout(() => { hint.hidden = true; }, 1300); };
on(window, 'pointermove', e => {
  if (e.pointerType !== 'mouse' || reading()) return;
  const p = api.pickScreen ? api.pickScreen(e.clientX, e.clientY) : null;
  if (!REDUCED){
    // over the tube the head holds still, so the bottom rows can be reached and clicked; leaning back starts
    // once the pointer leaves the glass (below it, or beside it low down)
    const ny = e.clientY / innerHeight * 2 - 1;
    look(e.clientX / innerWidth * 2 - 1, p ? Math.min(ny, 0) : ny);
    if (ny > 0.5 && !p) hideHint();
  }
  // clickable words on the tube get a pointer (and light up)
  const want = term.hitTest && term.hitTest(p ? p.u : -1, p ? p.v : -1) ? 'pointer' : '';   // (-1, -1) clears the hover
  if (stage.style.cursor !== want) stage.style.cursor = want;
});
on(D.documentElement, 'mouseleave', () => { look(0, 0); if (term.hitTest) term.hitTest(-1, -1); });

/* the GPU dropped the context (driver reset, GPU switch, too many tabs). three.js r147's restore leaves this scene
   black, so go straight to the flat terminal; a reload brings the room back */
on(api.renderer.domElement, 'webglcontextlost', () => toFlat('the WebGL context was lost'));

/* ---- loop ---- */
function resize(){
  if (small()){ toFlat('the window became phone-sized'); return; }   // a tablet in split view
  api.resize(innerWidth, innerHeight);
}
on(window, 'resize', resize); resize();
/* a GPU that cannot keep up: when most of ~5 s goes to long frames, shadows go first, then pixels below 1x
   (scene.js has already trimmed the pixel ratio down to 1 by then) */
let slowT = 0, spanT = 0, runT = 0, bad = 0, last = performance.now(), T = 0;
const gl = api.renderer.getContext();
function degrade(){
  const r = api.renderer;
  if (r.shadowMap.enabled){ r.shadowMap.enabled = false; api.scene.traverse(o => { if (o.isLight) o.castShadow = false; }); }
  else if (r.getPixelRatio() <= 1 && r.getPixelRatio() > .75) r.setPixelRatio(.75);
}
function frame(now){
  raf = requestAnimationFrame(frame);
  const raw = (now - last) / 1000, dt = Math.min(.05, raw); last = now; T += dt;
  try { if (term.update(dt, T)) api.markScreenDirty(); } catch (e){ oops(e); }
  if (reading()) return;   // the reader sheet covers the room: hold the last frame and save the GPU
  try { typist.update(dt, T); } catch (e){ oops(e); }
  if (gl.isContextLost()) return;   // the contextlost event is on its way (see above)
  try { api.update(dt, T); api.render(); } catch (e){ oops(e); if (++bad > 9) toFlat('the 3D view kept failing'); }
  if ((runT += raw) > 2){ spanT += raw; if (raw > .06) slowT += raw; if (spanT > 5){ if (slowT / spanT > .5) degrade(); spanT = slowT = bad = 0; } }
}
let going = false;   // the loop starts once the fonts are in; a tab shown before that must not start a second one
on(D, 'visibilitychange', () => { cancelAnimationFrame(raf); if (!D.hidden && going){ last = performance.now(); raf = requestAnimationFrame(frame); } });
const fromHash = deepLinks(() => term, ac.signal);
whenReady(() => {
  if (dead) return;
  fromHash(); focusInput(); going = true; cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
  if (!REDUCED && !matchMedia('(hover: none)').matches){   // fades in once the tube has had a moment, out after ~12 s
    hint.style.opacity = '0'; hint.hidden = false;
    hintIn = setTimeout(() => { hint.style.opacity = ''; }, 1800); hintT = setTimeout(hideHint, 14000);
  }
});
}

/* the terminal alone, no 3D. Phones: full width under a header strip, text typed through #kbd. Desktops (a fallback):
   one centred column of up to 54 columns, and the keyboard read from keydown like the 3D layout */
function flat(prev){   // prev: the 3D layout's terminal, when the 3D view gives out mid-visit
  D.body.classList.add('phone'); if (!TOUCH) D.body.classList.add('flat');
  let term = prev || null, cv = null, bw = 0, bh = 0, shift = 0;
  /* sized to fill the screen below the header strip (and above the home indicator); built again when the size
     really changes (a rotation, a desktop window resize). The on-screen keyboard only changes the height on
     phones, so there it never rebuilds: place() lifts the prompt instead */
  const build = () => {
    const probe = D.createElement('div'); probe.className = 'phone-term';
    probe.style.cssText = 'visibility:hidden;padding:0 env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px)';
    stage.appendChild(probe);
    const cs = getComputedStyle(probe), px = v => parseFloat(v) || 0;
    const top = probe.offsetTop, inset = px(cs.paddingBottom), sl = TOUCH ? px(cs.paddingLeft) : 0, sr = TOUCH ? px(cs.paddingRight) : 0; probe.remove();
    // a phone on its side keeps the text clear of the notch and the rounded corners
    const W = TOUCH ? innerWidth - sl - sr : Math.max(200, Math.min(innerWidth - 32, 760)), H = Math.max(200, innerHeight - top - inset - (TOUCH ? 0 : 16));
    const cols = W < 420 ? 40 : W < 600 ? 46 : 54;
    // a rotation or window resize reflows the same terminal (history, files, a running app all kept)
    if (term && term.resize) term.resize(W / H, cols);
    else { term = M.createTerminal({ content: M.CONTENT, aspect: W / H, cols }); if (cv) cv.remove(); }
    cv = term.canvas; cv.className = 'phone-term'; cv.style.width = W + 'px'; if (sl) cv.style.left = sl + 'px'; cv.style.height = H + 'px'; stage.appendChild(cv);
    bw = innerWidth; bh = innerHeight; shift = 0;
  };
  build();
  let rt = 0;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => {
    if (Math.abs(innerWidth - bw) > 40 || (!TOUCH && Math.abs(innerHeight - bh) > 40)) build(); else place();
  }, 150); });
  const focus = () => { if (!reading()) try { kbd.focus({ preventScroll: true }); } catch (e){} };
  setupMute(TOUCH ? null : focus);
  const click = (c, d) => { if (sound) try { sound.key(c, d); } catch (e){} };
  const tap = c => { click(c, true); setTimeout(() => click(c, false), 70); };
  const special = e => ['Enter', 'Backspace', 'Tab', 'Escape', 'Home', 'End', 'PageUp', 'PageDown', 'Delete'].includes(e.key) || e.key.startsWith('Arrow') || ((e.ctrlKey || e.altKey) && e.key.length === 1);
  /* text from #kbd: phones letter by letter (touch keyboards compose every word, so composition is not waited for);
     desktops only see IME and paste here, and wait for the composition to end */
  const take = () => { const v = kbd.value; kbd.value = ''; if (v.length > 4 && !TOUCH){ term.insertText(v); return; } for (const ch of v){ term.insertText(ch); tap(ch === ' ' ? 'Space' : 'KeyA'); } };
  kbd.addEventListener('input', e => { if (TOUCH || !e.isComposing) take(); });
  if (!TOUCH) kbd.addEventListener('compositionend', take);
  addEventListener('keydown', e => {
    if (e.metaKey || reading()) return;
    if (e.target === muteBtn){ if (e.key.length !== 1 || e.key === ' ') return; focus(); }   // letters typed on the toggle go back to the prompt
    if (TOUCH && e.target === kbd && !special(e)) return;   // phones: letters arrive through the input event
    unlock();
    if (term.handleKey(e)){ e.preventDefault(); tap(e.code || 'KeyA'); }
    else if (e.target === kbd && e.key.length === 1 && !e.ctrlKey) e.preventDefault();
  });
  addEventListener('keyup', e => { if (!reading() && term.handleKeyUp) term.handleKeyUp(e); });
  addEventListener('wheel', e => { if (reading() || !term.scroll) return; term.scroll(e.deltaY); e.preventDefault(); }, { passive: false });
  stage.addEventListener('pointerdown', () => { unlock(); });
  stage.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse' || !term.hitTest) return;
    const r = cv.getBoundingClientRect(), want = term.hitTest((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height) ? 'pointer' : '';
    if (stage.style.cursor !== want) stage.style.cursor = want;
  });
  stage.addEventListener('pointerleave', () => { if (term.hitTest) term.hitTest(-1, -1); stage.style.cursor = ''; });
  stage.addEventListener('click', e => {
    if (caught){ caught = false; return; }   // that touch stopped a fling: it was not a tap
    const r = cv.getBoundingClientRect();
    if (term.handleTap && term.handleTap((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)){ unlock(); return; }   // a card row: copy / open
    kbd.focus();
  });
  /* touch drag scrolls the terminal's history; a flick carries on and eases out, and a touch catches it */
  let ty = null, tt = 0, vel = 0, fling = 0, caught = false;
  const glide = () => {
    fling = 0; vel *= 0.95; if (Math.abs(vel) < 0.05 || !term.scroll) return;
    term.scroll(vel * 16 * 2.5); fling = requestAnimationFrame(glide);
  };
  stage.addEventListener('touchstart', e => {
    caught = !!fling; cancelAnimationFrame(fling); fling = 0; vel = 0;
    ty = e.touches[0].clientY; tt = e.timeStamp;
  }, { passive: true });
  stage.addEventListener('touchmove', e => {
    if (ty == null || !term.scroll) return;
    const y = e.touches[0].clientY, dt = Math.max(1, e.timeStamp - tt);
    term.scroll((ty - y) * 2.5); vel = 0.8 * ((ty - y) / dt) + 0.2 * vel; ty = y; tt = e.timeStamp; e.preventDefault();
  }, { passive: false });
  stage.addEventListener('touchend', e => {
    ty = null; if (REDUCED || e.timeStamp - tt > 80 || Math.abs(vel) < 0.3) return;   // a held finger, or a slow drag, stops where it is
    vel = Math.max(-4, Math.min(4, vel)); fling = requestAnimationFrame(glide);
  }, { passive: true });
  // keep the prompt line above the on-screen keyboard: measured from the canvas's untransformed top
  const place = () => {
    const vv = window.visualViewport, bottom = vv ? vv.offsetTop + vv.height : innerHeight;
    const y = stage.getBoundingClientRect().top + cv.offsetTop + term.cursorY * cv.offsetHeight;
    const s = Math.min(0, Math.round(bottom - 8 - y));
    if (s !== shift){ shift = s; cv.style.transform = s ? 'translateY(' + s + 'px)' : ''; }
  };
  if (window.visualViewport){ visualViewport.addEventListener('resize', place); visualViewport.addEventListener('scroll', place); }
  const fromHash = deepLinks(() => term);
  let last = performance.now(), T = 0;
  const frame = now => {
    requestAnimationFrame(frame); const dt = Math.min(.05, (now - last) / 1000); last = now; T += dt;
    try { if (term.update(dt, T)) place(); } catch (e){ oops(e); }
  };
  whenReady(() => { if (!prev) fromHash(); place(); if (!TOUCH) focus(); requestAnimationFrame(frame); });
}
})();
