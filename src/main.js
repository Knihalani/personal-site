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
/* wheel deltas in pixels: a line-based wheel (Firefox with a mouse reports 3 lines a notch) or a page-based one
   would otherwise move the terminal 1/40 as far as a trackpad. Ctrl+wheel (and a trackpad pinch) is left to the
   browser's zoom */
const wheelPx = e => e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? innerHeight : 1);

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
  delete M.world;   // the lamp command must not list or drive a scene that is gone
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
on(window, 'wheel', e => { if (reading() || e.ctrlKey) return; if (term.scroll){ term.scroll(wheelPx(e)); e.preventDefault(); hover(); } }, { passive: false });
on(stage, 'pointerdown', () => unlock());
/* clicking the tube: command words and card rows on the terminal are clickable (the scene maps the click to the canvas) */
on(stage, 'click', e => {
  if (reading()) return;
  const p = api.pickScreen && term.handleTap ? api.pickScreen(e.clientX, e.clientY) : null;
  if (p && term.handleTap(p.u, p.v)){ unlock(); if (api.markScreenDirty) api.markScreenDirty(); }
  focusInput();
});

/* the one hint: shown once, gone after the first lean or ~12 s. Without pointer look (reduced motion) there is none */
let hintT = 0, hintIn = 0, px = -1, py = -1, movedAt = -9;
const hideHint = () => { if (!hintT) return; clearTimeout(hintT); clearTimeout(hintIn); hintT = 0; hint.style.opacity = '0'; setTimeout(() => { hint.hidden = true; }, 1300); };
/* clickable words on the tube get a pointer (and light up). Run again while the view is still settling after a move
   and after a scroll, so the highlight follows what is really under the cursor, not what was there */
function hover(p){
  if (px < 0) return;
  if (p === undefined) p = api.pickScreen ? api.pickScreen(px, py) : null;
  const want = term.hitTest && term.hitTest(p ? p.u : -1, p ? p.v : -1) ? 'pointer' : '';   // (-1, -1) clears the hover
  if (stage.style.cursor !== want) stage.style.cursor = want;
}
on(window, 'pointermove', e => {
  if (e.pointerType !== 'mouse' || reading()) return;
  px = e.clientX; py = e.clientY; movedAt = performance.now();
  const p = api.pickScreen ? api.pickScreen(px, py) : null;
  if (!REDUCED){
    // over the tube the head holds still, so the bottom rows can be reached and clicked; leaning back starts just
    // below the glass's bottom edge (scene.js setLook), so it ramps in from where the tube ends, with no jump
    const ny = e.clientY / innerHeight * 2 - 1;
    look(e.clientX / innerWidth * 2 - 1, p ? Math.min(ny, 0) : ny);
    if (ny > 0.8 && !p) hideHint();   // a real lean (it starts ~0.75)
  }
  if (term.pointer) term.pointer(p ? p.u : -1, p ? p.v : -1, (e.buttons & 1) === 1);   // the landing's logo leans toward it
  hover(p);
});
/* the pointer leaves the window: the head comes back to the tube, unless it left through the bottom edge, which is
   just a lean that overshot (in a window above the dock or taskbar): that keeps the desk in view */
on(D.documentElement, 'mouseleave', e => {
  if (!(e.clientY >= innerHeight - 4 && e.clientX > 0 && e.clientX < innerWidth)) look(0, 0);
  px = py = -1; if (term.hitTest) term.hitTest(-1, -1); if (term.pointer) term.pointer(-1, -1, false);
});

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
  try { if (term.update(dt, T)){ api.markScreenDirty(); if (api.setScreenLum && term.lum != null) api.setScreenLum(term.lum); } } catch (e){ oops(e); }
  if (reading()) return;   // the reader sheet covers the room: hold the last frame and save the GPU
  try { typist.update(dt, T); } catch (e){ oops(e); }
  if (now - movedAt < 1200) hover();   // the view is still easing under a pointer that has stopped
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

/* the terminal alone, no 3D. Phones: full width between a header strip and the dock, text typed through #kbd.
   Desktops (a fallback): one centred column of up to 54 columns, and the keyboard read from keydown like the 3D layout */
function flat(prev){   // prev: the 3D layout's terminal, when the 3D view gives out mid-visit
  D.body.classList.add('phone', TOUCH ? 'touch' : 'flat');
  const dock = TOUCH ? $('#dock') : null;
  let term = prev || null, cv = null, bw = 0, bh = 0, shift = 0, rub = 0;
  /* the canvas's offset: the prompt lifted above the keyboard (shift) plus a rubber-band pull at the ends (rub) */
  const paint = () => { const y = Math.round(shift + rub); cv.style.transform = y ? 'translateY(' + y + 'px)' : ''; };
  /* sized to fill the screen below the header strip (and above the dock and the home indicator); built again when the
     size really changes (a rotation, a desktop window resize). The on-screen keyboard only changes the height on
     phones, so there it never rebuilds: place() lifts the prompt instead */
  const build = () => {
    if (TOUCH) D.body.classList.toggle('land', innerWidth > innerHeight && innerHeight < 520);   // a phone on its side: no header strip, sound in the dock
    const probe = D.createElement('div'); probe.className = 'phone-term';
    probe.style.cssText = 'visibility:hidden;padding:0 env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px)';
    stage.appendChild(probe);
    const cs = getComputedStyle(probe), px = v => parseFloat(v) || 0;
    const top = probe.offsetTop, sl = TOUCH ? px(cs.paddingLeft) : 0, sr = TOUCH ? px(cs.paddingRight) : 0;
    const inset = px(cs.paddingBottom) + (TOUCH ? px(getComputedStyle(D.body).getPropertyValue('--dock-h')) : 0); probe.remove();
    // a phone on its side keeps the text clear of the notch and the rounded corners
    const W = TOUCH ? innerWidth - sl - sr : Math.max(200, Math.min(innerWidth - 32, 760)), H = Math.max(160, innerHeight - top - inset - (TOUCH ? 0 : 16));
    /* phones in portrait keep 40 columns (a VT323 cell of ~9 px: comfortable at arm's length); wider touch screens
       (landscape, tablets) aim for ~9.5 px cells, so a phone on its side still shows a useful number of rows */
    const cols = TOUCH ? (W < 420 ? 40 : Math.max(46, Math.min(84, Math.round(W / 9.5)))) : W < 420 ? 40 : W < 600 ? 46 : 54;
    // a rotation or window resize reflows the same terminal (history, files, a running app all kept)
    if (term && term.resize) term.resize(W / H, cols);
    else { term = M.createTerminal({ content: M.CONTENT, aspect: W / H, cols }); if (cv) cv.remove(); }
    cv = term.canvas; cv.className = 'phone-term'; cv.style.width = W + 'px'; cv.style.left = sl ? sl + 'px' : ''; cv.style.height = H + 'px'; stage.appendChild(cv);
    bw = innerWidth; bh = innerHeight; shift = 0; rub = 0; paint();
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
  addEventListener('wheel', e => { if (reading() || !term.scroll || e.ctrlKey) return; term.scroll(wheelPx(e)); e.preventDefault(); }, { passive: false });
  stage.addEventListener('pointerdown', () => { unlock(); });
  stage.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    const r = cv.getBoundingClientRect(), u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
    if (term.pointer) term.pointer(u, v, (e.buttons & 1) === 1);
    if (!term.hitTest) return;
    const want = term.hitTest(u, v) ? 'pointer' : '';
    if (stage.style.cursor !== want) stage.style.cursor = want;
  });
  stage.addEventListener('pointerleave', () => { if (term.hitTest) term.hitTest(-1, -1); if (term.pointer) term.pointer(-1, -1, false); stage.style.cursor = ''; });
  stage.addEventListener('click', e => {
    if (caught){ caught = false; return; }   // that touch stopped a fling: it was not a tap
    const r = cv.getBoundingClientRect();
    if (term.handleTap && term.handleTap((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)){ unlock(); return; }   // a card row: copy / open
    kbd.focus();
  });

  /* ---- touch: a drag scrolls the history 1:1 under the finger, a flick carries on and eases out (a touch catches it),
     the ends give a little and spring back; a swipe to the right goes back a page ---- */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const buzz = () => { try { if (navigator.vibrate) navigator.vibrate(8); } catch (e){} };
  const rowPx = () => Math.max(4, term.scrollInfo.rowH * cv.offsetHeight);
  /* dy > 0 moves the text up (toward the prompt); false at an end */
  const scrollPx = dy => {
    if (!term.scrollInfo){ term.scroll(dy * 2.5); return true; }
    const i = term.scrollInfo;
    if ((dy > 0 && i.off <= 0) || (dy < 0 && i.off >= i.max)) return false;
    term.scroll(dy / rowPx() * 40); return true;
  };
  const drag = dy => {
    if (rub){ const r = rub - dy * .45; if (r && (r > 0) === (rub > 0)){ rub = clamp(r, -72, 72); paint(); return; } rub = 0; paint(); }
    if (!scrollPx(dy) && !REDUCED){ rub = clamp(rub - dy * .45, -72, 72); paint(); }
  };
  let ty = null, tt = 0, x0 = 0, y0 = 0, axis = '', vel = 0, fling = 0, caught = false, lt = 0;
  const swipe = $('#swipe');
  const cue = (p, go) => { swipe.style.setProperty('--p', p.toFixed(3)); swipe.classList.toggle('go', !!go); };
  const glide = now => {
    const dt = Math.min(32, now - lt); lt = now; vel *= Math.pow(0.9972, dt);
    if (Math.abs(vel) < 0.02){ fling = 0; return; }
    if (!scrollPx(vel * dt)){                       // ran into an end: a small bump, then rest
      fling = 0; if (REDUCED) return;
      rub = clamp(-vel * 16, -28, 28); paint(); setTimeout(() => { rub = 0; paint(); }, 130); return;
    }
    fling = requestAnimationFrame(glide);
  };
  stage.addEventListener('touchstart', e => {
    caught = !!fling; cancelAnimationFrame(fling); fling = 0; vel = 0;
    const t = e.touches[0]; x0 = t.clientX; ty = y0 = t.clientY; tt = e.timeStamp; axis = e.touches.length > 1 ? 'n' : '';
  }, { passive: true });
  stage.addEventListener('touchmove', e => {
    if (ty == null) return;
    const t = e.touches[0], dx = t.clientX - x0, dy0 = t.clientY - y0;
    if (!axis && Math.hypot(dx, dy0) > 9){
      axis = TOUCH && dx > 0 && Math.abs(dx) > Math.abs(dy0) * 1.4 && term.canBack ? 'x' : 'y';
      if (axis === 'y') cv.classList.add('drag'); else swipe.classList.remove('off');
    }
    if (axis === 'x'){ cue(clamp(dx / 90, 0, 1), dx > 80); e.preventDefault(); return; }
    if (axis !== 'y' || !term.scroll) return;
    const y = t.clientY, dt = Math.max(1, e.timeStamp - tt);
    drag(ty - y); vel = 0.75 * ((ty - y) / dt) + 0.25 * vel; ty = y; tt = e.timeStamp; e.preventDefault();
  }, { passive: false });
  const touchEnd = e => {
    const was = axis; ty = null; axis = '';
    if (was === 'x'){
      const t = e.changedTouches[0], dx = t ? t.clientX - x0 : 0;
      swipe.classList.add('off'); cue(0);
      if (dx > 80 && e.type === 'touchend'){ buzz(); term.run('back'); }
      return;
    }
    if (was !== 'y') return;
    cv.classList.remove('drag'); if (rub){ rub = 0; paint(); }   // the ends spring back (the canvas's transition)
    if (REDUCED || e.timeStamp - tt > 80 || Math.abs(vel) < 0.12) return;   // a held finger, or a slow drag, stops where it is
    vel = clamp(vel, -5, 5); lt = performance.now(); fling = requestAnimationFrame(glide);
  };
  stage.addEventListener('touchend', touchEnd, { passive: true });
  stage.addEventListener('touchcancel', touchEnd, { passive: true });

  /* keep the prompt line above the on-screen keyboard (and the dock riding on it): measured from the canvas's
     untransformed top */
  const kbH = () => { const vv = window.visualViewport; return vv ? Math.max(0, Math.round(innerHeight - (vv.offsetTop + vv.height))) : 0; };
  const place = () => {
    const vv = window.visualViewport;
    let bottom = vv ? vv.offsetTop + vv.height : innerHeight;
    if (dock){
      const k = kbH(), open = k > 80;
      D.body.classList.toggle('kb', open); dock.style.bottom = open ? k + 'px' : '';
      if (!open){ if (shift){ shift = 0; paint(); } return; }   // the canvas already ends above the dock
      bottom -= dock.offsetHeight;
    }
    const y = stage.getBoundingClientRect().top + cv.offsetTop + term.cursorY * cv.offsetHeight;
    const s = Math.min(0, Math.round(bottom - 8 - y));
    if (s !== shift){ shift = s; paint(); }
  };
  if (window.visualViewport){ visualViewport.addEventListener('resize', place); visualViewport.addEventListener('scroll', place); }
  const fromHash = deepLinks(() => term);
  const tick = TOUCH ? phone() : () => {};
  let last = performance.now(), T = 0;
  const frame = now => {
    requestAnimationFrame(frame); const dt = Math.min(.05, (now - last) / 1000); last = now; T += dt;
    let changed = false;
    try { if ((changed = term.update(dt, T))) place(); } catch (e){ oops(e); }
    try { tick(changed); } catch (e){ oops(e); }
  };
  whenReady(() => { if (!prev) fromHash(); place(); if (!TOUCH) focus(); requestAnimationFrame(frame); });

  /* ---- phones: the dock, the copied note, the "more" tab and the phone's own back ---- */
  function phone(){
    dock.hidden = false;
    const keys = dock.querySelector('.keys'), kb = dock.querySelector('.kb'), more = $('#more'), toastEl = $('#toast');
    const PAGES = ['about', 'j', 'eden', 'writing', 'contact', 'help'];
    const GAMES = /^(snake|tetris|breakout)$/;
    const SVG = d => '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"/></svg>';
    const ARROW = { ArrowLeft: 'M19 12H5M11 6l-6 6 6 6', ArrowUp: 'M12 19V5M6 11l6-6 6 6', ArrowDown: 'M12 5v14M6 13l6 6 6-6', ArrowRight: 'M5 12h14M13 6l6 6-6 6' };
    const kbOpen = () => D.body.classList.contains('kb') && D.activeElement === kbd;
    const flash = b => { b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 140); };
    const keyEv = (key, type, repeat) => ({ type, key, code: key === ' ' ? 'Space' : key, repeat: !!repeat, isComposing: false, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, synthetic: true, preventDefault(){}, stopPropagation(){} });
    const btn = (label, act, o = {}) => {
      const b = D.createElement('button'); b.type = 'button'; b.className = 'k' + (o.cls ? ' ' + o.cls : '');
      if (o.html) b.innerHTML = o.html; else b.textContent = label;
      b.setAttribute('aria-label', o.aria || label); b._act = act; b._hold = o.hold; return b;
    };
    /* what the dock offers: the pages, or the words that match what is being typed, or a game's keys */
    let mode = null;
    const render = m => {
      mode = m; keys.textContent = ''; dock.classList.toggle('sug', m.startsWith('sug:'));
      dock.setAttribute('aria-label', m.startsWith('app:') ? 'Keys' : m.startsWith('sug:') ? 'Suggestions' : 'Pages');
      if (m.startsWith('app:')){
        keys.appendChild(btn('esc', null, { hold: 'Escape', aria: 'Escape: leave' }));
        for (const k of ['ArrowLeft', 'ArrowUp', 'ArrowDown', 'ArrowRight']) keys.appendChild(btn(k, null, { hold: k, cls: 'ico', html: SVG(ARROW[k]), aria: k.replace('Arrow', '') }));
        keys.appendChild(btn('space', null, { hold: ' ', aria: 'Space' }));
        return;
      }
      if (m.startsWith('sug:')){
        const word = /\S*$/.exec(term.line)[0], list = term.suggest();
        if (!list.length){ const n = D.createElement('span'); n.className = 'note'; n.textContent = 'return runs it'; keys.appendChild(n); return; }
        for (const w of list){
          const b = btn(w, () => pickWord(w)), at = word && w.startsWith(word) ? word.length : 0;
          if (at){ const s = D.createElement('b'); s.textContent = w.slice(0, at); b.textContent = ''; b.append(s, w.slice(at)); }
          keys.appendChild(b);
        }
        keys.scrollLeft = 0; return;
      }
      const cur = m.slice(4);
      for (const p of PAGES){ const b = btn(p, () => go(p)); if (p === cur) b.classList.add('on'); keys.appendChild(b); }
    };
    const fits = () => keys.classList.toggle('over', keys.scrollWidth > keys.clientWidth + 1);   // the edge fades only when there is more to swipe to
    const modeNow = () => {
      if (term.app) return 'app:' + term.app;
      const l = term.line; if (l && l.trim()) return 'sug:' + l;
      return 'nav:' + (term.page || '');
    };
    /* a page key opens that page (the keyboard goes down: it is for reading); a word fills the line, and runs it
       when it is a whole command */
    const go = p => {
      if (term.app) return;
      if (D.activeElement === kbd) kbd.blur();
      if (term.busy) term.handleKey(Object.assign(keyEv('c', 'keydown'), { ctrlKey: true }));   // a command still running (or asking): stop it first
      let k = 0; const later = () => { if (!term.busy) term.run(p); else if (k++ < 30) requestAnimationFrame(later); }; later();
    };
    const pickWord = w => {
      if (!term.pick(w)) return;
      term.handleKey(keyEv('Enter', 'keydown'));
      if (PAGES.includes(w) && D.activeElement === kbd) kbd.blur();
    };
    /* keys act on touch-down (the on-screen keyboard keeps its focus); held keys repeat as on a keyboard */
    let rep = 0, held = null;
    const stopHold = () => { clearTimeout(rep); clearInterval(rep); rep = 0; if (held){ if (term.handleKeyUp) term.handleKeyUp(keyEv(held, 'keyup')); held = null; } };
    dock.addEventListener('pointerdown', e => {
      unlock(); if (e.pointerType !== 'mouse' || e.button === 0) e.preventDefault();
      const b = e.target.closest('.k, .kb'); if (!b) return;
      flash(b); buzz(); tap('KeyA');
      if (b._hold){
        stopHold(); held = b._hold; const k = held;
        term.handleKey(keyEv(k, 'keydown'));
        if (k !== 'Escape' && k !== ' ') rep = setTimeout(() => { rep = setInterval(() => { if (held === k) term.handleKey(keyEv(k, 'keydown', true)); }, 85); }, 320);
      }
    });
    for (const t of ['pointerup', 'pointercancel', 'pointerleave']) dock.addEventListener(t, stopHold);
    dock.addEventListener('click', e => { const b = e.target.closest('.k'); if (b && !b._hold && b._act) b._act(); });
    kb.addEventListener('click', () => { if (kbOpen()) kbd.blur(); else kbd.focus(); });
    /* "more" sits on the dock's edge while a page runs on below: a tap glides down a screen */
    more.addEventListener('click', () => {
      flash(more); const i = term.scrollInfo, n = Math.min(i.off, Math.max(3, Math.floor(1 / i.rowH) - 3)), t0 = performance.now(); let done = 0;
      const step = now => { const k = Math.min(1, (now - t0) / 300), want = n * (1 - Math.pow(1 - k, 3)); if (want > done){ term.scroll((want - done) * 40); done = want; } if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
    /* copied: a note above the dock (terminal.js calls M.toast) */
    let toastT = 0;
    M.toast = (label, text) => {
      toastEl.innerHTML = SVG('M5 12.5l4.5 4.5L19 7.5'); toastEl.append(label + ' ');
      const b = D.createElement('b'); b.textContent = text || ''; toastEl.appendChild(b);
      toastEl.classList.add('show'); buzz(); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), 2200);
    };
    /* the phone's own back (Android's button, iOS's edge swipe) goes back a page while one is open: one history entry
       stands for "a page is open", and is taken off again when the terminal is back at its start */
    let entry = false, skip = false;
    const syncHistory = () => {
      try {
        if (term.canBack && !entry){ history.pushState({ kaiavPage: 1 }, ''); entry = true; }
        else if (!term.canBack && entry && !term.busy){ entry = false; skip = true; history.back(); }
      } catch (e){}
    };
    addEventListener('popstate', () => {
      if (skip){ skip = false; return; }
      entry = false;
      if (reading()){ try { M.reader.close(); } catch (e){} return; }
      if (term.canBack) term.run('back');
    });
    let wasReading = false, moreOn = false, n = 0;
    return changed => {
      const r = reading(); if (r !== wasReading){ wasReading = r; D.body.classList.toggle('reading', r); }
      const m = modeNow();
      if (m !== mode){
        const was = mode || ''; render(m); fits();
        if (m.startsWith('app:') && !was.startsWith('app:') && GAMES.test(term.app) && D.activeElement === kbd) kbd.blur();   // a game wants the screen, not the keyboard
      }
      if (changed || !(n++ % 15)){
        const i = term.scrollInfo, on = !!(i && i.off > 1 && !term.app && !D.body.classList.contains('kb'));
        if (on !== moreOn){ moreOn = on; more.classList.toggle('on', on); }
        fits();
        syncHistory();
      }
    };
  }
}
})();
