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
/* the room's code ships inert (build.py: <script type="text/plain" id="desk3d">): run it now, desktops only */
{ const d = D.getElementById('desk3d'); if (d && !M.createTypist){ const s = D.createElement('script'); s.textContent = d.textContent; D.head.appendChild(s); } }
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

/* the terminal alone, no 3D. Phones: the computer in the hand, a curved tube in a beige bezel over the desk's keyboard
   (keyboard() below), which replaces the phone's own. Desktops (a fallback): one centred column of up to 54
   columns, and the keyboard read from keydown like the 3D layout */
function flat(prev){   // prev: the 3D layout's terminal, when the 3D view gives out mid-visit
  D.body.classList.add('phone', TOUCH ? 'touch' : 'flat');
  let term = prev || null, cv = null, bw = 0, bh = 0, shift = 0, rub = 0;
  /* phones: the tube (the canvas, its bloom, the glass over them) and the keyboard. #kbd stays the real text field
     for assistive tech, but never brings up the phone's keyboard */
  let tapGlow = null, tube = null, scr = null, bloom = null, bx = null, keys = null, kbTouch = { t: -1e9, x: 0, y: 0 };
  /* the click a browser may send where a key's touch ended, when the key folded or changed under it */
  const strayClick = e => performance.now() - kbTouch.t < 350 && Math.hypot(e.clientX - kbTouch.x, e.clientY - kbTouch.y) < 20;
  if (TOUCH){
    kbd.setAttribute('inputmode', 'none'); kbd.setAttribute('virtualkeyboardpolicy', 'manual');
    tube = D.createElement('div'); tube.id = 'tube'; scr = D.createElement('div'); scr.className = 'scr';
    bloom = D.createElement('canvas'); bloom.className = 'bloom'; bx = bloom.getContext('2d');
    tube.appendChild(scr); if (!prev) scr.style.visibility = 'hidden';   // nothing on the glass until the fonts are in (no fallback flash): then it powers on
    /* the case's details: the tube's recess, the model plate, the floppy slot and its lamp */
    const part = (cls, html) => { const d = D.createElement('div'); d.className = cls; if (html) d.innerHTML = html; stage.appendChild(d); return d; };
    part('recess'); stage.appendChild(tube);
    part('plate', 'KN-84<i></i><span>personal computer</span>');
    const chin = part('chin', '<i class="dled"></i><i class="slot"></i>'), dled = chin.querySelector('.dled');
    if (sound && sound.event){   // the disk lamp flickers with the drive's sound
      const ev0 = sound.event.bind(sound); let dt = 0;
      sound.event = name => { if (name === 'disk'){ dled.classList.add('on'); clearTimeout(dt); let n = 0; const f = () => { dled.classList.toggle('on', n % 3 !== 2); if (++n < 9) dt = setTimeout(f, 70 + Math.random() * 60); else dled.classList.remove('on'); }; f(); } return ev0(name); };
    }
    const tc = $('meta[name="theme-color"]'); if (tc) tc.content = '#c3b79f';
    keys = keyboard();
    /* a page turn: the old page, copied once, glows green and fades over ~300 ms as the new one types in */
    if (!REDUCED){
      const ghost = D.createElement('canvas'); ghost.className = 'ghost'; scr.appendChild(ghost); const gx = ghost.getContext('2d');
      M.pageTurn = src => {
        if (!src || !src.width) return;
        if (ghost.width !== src.width || ghost.height !== src.height){ ghost.width = src.width; ghost.height = src.height; }
        try { gx.drawImage(src, 0, 0); } catch (e){ return; }
        if (ghost.animate) ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, easing: 'cubic-bezier(.3,.6,.4,1)' });   // (no reflow to restart it)
      };
    }
  }
  /* the canvas's offset: the prompt lifted above the keyboard (shift, desktops) plus a rubber-band pull at the ends (rub) */
  const paint = () => { const y = Math.round(shift + rub), t = y ? 'translateY(' + y + 'px)' : ''; cv.style.transform = t; if (bloom) bloom.style.transform = t; };
  /* sized to fill the tube (phones) or the window below the header strip (desktops); built again when the size really
     changes: a rotation, the keyboard folding, a desktop window resize. The same terminal reflows */
  const build = () => {
    let W, H, cols;
    if (TOUCH){
      const land = innerWidth > innerHeight && innerHeight < 520;
      D.body.classList.toggle('land', land); keys.layout(land);
      D.body.style.setProperty('--kbh', keys.height() + 'px');
      W = Math.max(160, tube.clientWidth); H = Math.max(120, tube.clientHeight);
      /* portrait keeps 40 columns (a VT323 cell of ~9 px: comfortable at arm's length); wider screens aim for ~9.5 px */
      cols = W < 420 ? 40 : Math.max(46, Math.min(84, Math.round(W / 9.5)));
    } else {
      const probe = D.createElement('div'); probe.className = 'phone-term';
      probe.style.cssText = 'visibility:hidden;padding:0 0 env(safe-area-inset-bottom, 0px)';
      stage.appendChild(probe);
      const top = probe.offsetTop, inset = parseFloat(getComputedStyle(probe).paddingBottom) || 0; probe.remove();
      W = Math.max(200, Math.min(innerWidth - 32, 760)); H = Math.max(160, innerHeight - top - inset - 16);
      cols = W < 420 ? 40 : W < 600 ? 46 : 54;
    }
    if (term && term.resize) term.resize(W / H, cols);
    else {
      /* phones: a canvas as wide as the tube in device pixels (portrait), within 720..1280 */
      const width = TOUCH ? Math.max(720, Math.min(1280, Math.round(Math.min(screen.width || innerWidth, screen.height || innerHeight) * (devicePixelRatio || 2)))) : undefined;
      term = M.createTerminal({ content: M.CONTENT, aspect: W / H, cols, width }); if (cv) cv.remove();
    }
    cv = term.canvas; cv.className = 'phone-term'; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    if (TOUCH){
      if (cv.parentNode !== scr){ scr.appendChild(cv); scr.appendChild(bloom); }
      bloom.width = Math.round(cv.width / 6); bloom.height = Math.round(cv.height / 6); glow();
    } else stage.appendChild(cv);
    bw = innerWidth; bh = innerHeight; shift = 0; rub = 0; paint();
  };
  /* the phosphor's bloom: the frame, shrunk to a sixth and blurred by the compositor, laid over it in screen mode.
     One cheap draw per changed frame */
  /* the bloom is drawn when the picture settles: the downscale is the costliest thing a phone does in a frame, so while
     the tube animates (the intro, a game, a fling) the glow fades out instead of chasing every frame, and comes back
     ~150 ms after the last change */
  let glowDue = false, lastChange = -1e9, runFrom = -1e9, glowOn = true;
  const glowShow = on => { if (on !== glowOn){ glowOn = on; bloom.style.opacity = on ? '' : '0'; } };
  function glow(){
    if (!bx) return;
    const t = performance.now();
    if (t - lastChange > 250) runFrom = t;   // a still picture before this change
    lastChange = t; glowDue = true;
    if (t - runFrom > 120) glowShow(false);   // changing frame after frame: animating
  }
  let glowAt = -1e9;
  function glowSettle(){
    const t = performance.now();
    if (!glowDue || t - lastChange < 150 || t - glowAt < 600 || ty != null || fling) return;   // (a blinking cursor alone: a redraw a second at most; never under a finger or a fling)
    glowDue = false; glowAt = t;
    try { bx.imageSmoothingQuality = 'low'; bx.drawImage(cv, 0, 0, bloom.width, bloom.height); } catch (e){}
    glowShow(true);
  }
  build();
  if (TOUCH) keys.fold(true);   // home opens on the title card, the keyboard folded until a letter is wanted
  if (/[?&]debug\b/.test(location.search)) M._term = term;   // test hook (see CONTRACT.md), never otherwise
  let rt = 0;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => {
    if (TOUCH ? Math.abs(innerWidth - bw) > 2 || Math.abs(innerHeight - bh) > 2 : Math.abs(innerWidth - bw) > 40 || Math.abs(innerHeight - bh) > 40) build(); else place();
  }, 150); });
  const focus = () => { if (!reading()) try { kbd.focus({ preventScroll: true }); } catch (e){} };
  setupMute(TOUCH ? null : focus);
  const click = (c, d) => { if (sound) try { sound.key(c, d); } catch (e){} };
  const tap = c => { click(c, true); setTimeout(() => click(c, false), 70); };
  const special = e => ['Enter', 'Backspace', 'Tab', 'Escape', 'Home', 'End', 'PageUp', 'PageDown', 'Delete'].includes(e.key) || e.key.startsWith('Arrow') || ((e.ctrlKey || e.altKey) && e.key.length === 1);
  /* text from #kbd: assistive tech on phones (letter by letter), IME and paste on desktops (after the composition) */
  const take = () => { const v = kbd.value; kbd.value = ''; if (v.length > 4 && !TOUCH){ term.insertText(v); return; } for (const ch of v){ term.insertText(ch); tap(ch === ' ' ? 'Space' : 'KeyA'); } };
  kbd.addEventListener('input', e => { if (TOUCH || !e.isComposing) take(); });
  if (!TOUCH) kbd.addEventListener('compositionend', take);
  /* a hardware keyboard (desktops; a tablet's or a phone's keyboard case) */
  addEventListener('keydown', e => {
    if (e.metaKey || reading()) return;
    if (e.target === muteBtn){ if (e.key.length !== 1 || e.key === ' ') return; focus(); }   // letters typed on the toggle go back to the prompt
    if (TOUCH && e.target === kbd && !special(e)) return;   // assistive tech: letters arrive through the input event
    unlock();
    if (term.handleKey(e)){ e.preventDefault(); tap(e.code || 'KeyA'); if (keys) keys.echo(e.code, true); }
    else if (e.target === kbd && e.key.length === 1 && !e.ctrlKey) e.preventDefault();
  });
  addEventListener('keyup', e => { if (keys) keys.echo(e.code, false); if (!reading() && term.handleKeyUp) term.handleKeyUp(e); });
  addEventListener('wheel', e => { if (reading() || !term.scroll || e.ctrlKey) return; term.scroll(wheelPx(e)); e.preventDefault(); }, { passive: false });
  stage.addEventListener('pointerdown', e => {
    unlock();
    if (!tube || REDUCED || e.pointerType === 'mouse') return;   // phones: the phosphor answers under the finger
    const r = tube.getBoundingClientRect(); if (e.clientY > r.bottom || e.clientY < r.top) return;
    if (!tapGlow){ tapGlow = D.createElement('i'); tapGlow.className = 'tapglow'; tube.appendChild(tapGlow); }
    tapGlow.style.left = (e.clientX - r.left) + 'px'; tapGlow.style.top = (e.clientY - r.top) + 'px';
    if (tapGlow.animate) tapGlow.animate([{ opacity: 1, transform: 'scale(.35)' }, { opacity: 0, transform: 'scale(1.15)' }], { duration: 420, easing: 'ease-out' });   // (no reflow to restart it)
  }, { passive: true });
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
    if (performance.now() < swallow){ swallow = 0; return; }
    if (TOUCH && strayClick(e)) return;   // a key's own touch, its cap gone under it (a fold, a new layer): not a tap on the tube
    const r = cv.getBoundingClientRect();
    if (term.handleTap && term.handleTap((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)){ unlock(); return; }   // a card row: copy / open
    /* a tap on the prompt line (or under it) brings the keyboard back (the phone's own never opens); elsewhere on a page a
       tap is just a reader's touch */
    if (TOUCH){ const v = (e.clientY - r.top) / r.height, i = term.scrollInfo; if (v >= term.cursorY - 2.5 * (i ? i.rowH : 0.05)) keys.fold(false); }
    else kbd.focus();
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
  /* a running app may take the finger itself (term.handleDrag: swipes in snake and tetris, the breakout paddle) */
  let appDrag = null, dragUsed = false, swallow = 0;
  const toCv = t => { const r = cv.getBoundingClientRect(); return [(t.clientX - r.left) / r.width, (t.clientY - r.top) / r.height]; };
  stage.addEventListener('touchstart', e => {
    caught = !!fling; cancelAnimationFrame(fling); fling = 0; vel = 0;
    const t = e.touches[0]; x0 = t.clientX; ty = y0 = t.clientY; tt = e.timeStamp; axis = e.touches.length > 1 ? 'n' : '';
    appDrag = null; dragUsed = false;
    if (term.app && term.handleDrag && e.touches.length === 1){ appDrag = t.identifier; const [u, v] = toCv(t); term.handleDrag(u, v, 'start'); }
  }, { passive: true });
  stage.addEventListener('touchmove', e => {
    if (appDrag != null){
      const t = [...e.touches].find(x => x.identifier === appDrag); if (!t) return;
      const [u, v] = toCv(t); if (term.handleDrag(u, v, 'move')) dragUsed = true;
      if (e.cancelable) e.preventDefault(); return;
    }
    if (ty == null) return;
    const t = e.touches[0], dx = t.clientX - x0, dy0 = t.clientY - y0;
    if (!axis && Math.hypot(dx, dy0) > 9){
      axis = TOUCH && dx > 0 && Math.abs(dx) > Math.abs(dy0) * 1.4 && term.canBack ? 'x' : 'y';
      if (axis === 'y') cv.classList.add('drag'); else swipe.classList.remove('off');
    }
    if (axis === 'x'){ cue(clamp(dx / 90, 0, 1), dx > 80); if (e.cancelable) e.preventDefault(); return; }
    if (axis !== 'y' || !term.scroll) return;
    const y = t.clientY, dt = Math.max(1, e.timeStamp - tt);
    drag(ty - y); vel = 0.75 * ((ty - y) / dt) + 0.25 * vel; ty = y; tt = e.timeStamp; if (e.cancelable) e.preventDefault();
  }, { passive: false });
  const touchEnd = e => {
    if (appDrag != null){
      const t = [...e.changedTouches].find(x => x.identifier === appDrag);
      if (t){ const [u, v] = toCv(t); if (term.handleDrag(u, v, 'end')) dragUsed = true; appDrag = null; if (dragUsed) swallow = performance.now() + 450; }   // a swipe is not a tap
      ty = null; axis = ''; return;
    }
    const was = axis; ty = null; axis = '';
    if (was === 'x'){
      const t = e.changedTouches[0], dx = t ? t.clientX - x0 : 0;
      swipe.classList.add('off'); cue(0);
      if (dx > 80 && e.type === 'touchend'){ buzz(); term.run('back'); }
      return;
    }
    if (was !== 'y') return;
    cv.classList.remove('drag'); if (rub){ rub = 0; paint(); }   // the ends spring back (the canvas's transition)
    /* reading back up a long page: the keyboard folds away to give it the whole tube */
    if (keys && term.scrollInfo && term.scrollInfo.off > 0 && !term.app && keys.settled()) keys.fold(true);
    if (REDUCED || e.timeStamp - tt > 80 || Math.abs(vel) < 0.12) return;   // a held finger, or a slow drag, stops where it is
    vel = clamp(vel, -5, 5); lt = performance.now(); fling = requestAnimationFrame(glide);
  };
  stage.addEventListener('touchend', touchEnd, { passive: true });
  stage.addEventListener('touchcancel', touchEnd, { passive: true });

  /* desktops: keep the prompt line above the bottom of the visual viewport (measured from the canvas's untransformed
     top). Phones have no keyboard of their own to dodge: the tube already ends above the keys */
  const place = () => {
    if (TOUCH) return;
    const vv = window.visualViewport, bottom = vv ? vv.offsetTop + vv.height : innerHeight;
    const y = stage.getBoundingClientRect().top + cv.offsetTop + term.cursorY * cv.offsetHeight;
    const s = Math.min(0, Math.round(bottom - 8 - y));
    if (s !== shift){ shift = s; paint(); }
  };
  if (window.visualViewport && !TOUCH){ visualViewport.addEventListener('resize', place); visualViewport.addEventListener('scroll', place); }
  const fromHash = deepLinks(() => term);
  const tick = TOUCH ? phone() : () => {};
  let last = performance.now(), T = 0;
  const frame = now => {
    requestAnimationFrame(frame); const dt = Math.min(.05, (now - last) / 1000); last = now; T += dt;
    let changed = false;
    try { if ((changed = term.update(dt, T))){ place(); glow(); } else if (glowDue) glowSettle(); } catch (e){ oops(e); }
    try { tick(changed); } catch (e){ oops(e); }
  };
  whenReady(() => {
    if (!prev) fromHash(); place(); if (!TOUCH) focus(); requestAnimationFrame(frame);
    if (TOUCH) scr.style.visibility = '';
    if (TOUCH && !REDUCED && !prev){ tube.classList.add('on'); setTimeout(() => tube.classList.remove('on'), 1100); scr.classList.add('on'); scr.addEventListener('animationend', () => scr.classList.remove('on'), { once: true }); }   // the tube warms up
  });

  /* ---- phones: the keyboard. The desk's board, drawn in CSS (head.html): QWERTY, two layers of digits and symbols,
     esc, tab, ctrl and the arrows, a pad for games. Keys act the instant a thumb lands (each touch on its own, so two
     thumbs never drop a key), travel down, play the key's own Topre recording on press and on release, and send
     KeyboardEvent-shaped objects to the terminal ---- */
  function keyboard(){
    const el = $('#kb'), board = el.querySelector('.board');
    el.hidden = false;
    const SVG = d => '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"/></svg>';
    const ARROW = { left: 'M19 12H5M11 6l-6 6 6 6', up: 'M12 19V5M6 11l6-6 6 6', down: 'M12 5v14M6 13l6 6 6-6', right: 'M5 12h14M13 6l6 6-6 6' };
    /* what each named key is: its legend, KeyboardEvent key and code, and how it behaves */
    const SP = {
      shift: { lg: 'shift', code: 'ShiftLeft', mod: 1, led: 1 }, ctrl: { lg: 'ctrl', code: 'ControlLeft', mod: 1, led: 1 },
      bksp: { lg: 'delete', key: 'Backspace', code: 'Backspace', mod: 1, rep: 1 }, ret: { lg: 'return', key: 'Enter', code: 'Enter', mod: 1 },
      space: { lg: '', key: ' ', code: 'Space' }, esc: { lg: 'esc', key: 'Escape', code: 'Escape', mod: 1 }, tab: { lg: 'tab', key: 'Tab', code: 'Tab', mod: 1 },
      left: { key: 'ArrowLeft', rep: 1 }, up: { key: 'ArrowUp', rep: 1 }, down: { key: 'ArrowDown', rep: 1 }, right: { key: 'ArrowRight', rep: 1 },
      n123: { lg: '123', code: 'AltLeft', mod: 1, c: 1, layer: 'sym' }, abc: { lg: 'ABC', code: 'AltLeft', mod: 1, c: 1, layer: 'let' },
      sym2: { lg: '#+=', code: 'ShiftLeft', mod: 1, c: 1, layer: 'sym2' }, sym1: { lg: '123', code: 'ShiftLeft', mod: 1, c: 1, layer: 'sym' },
      p: { lg: 'pause', key: 'p', code: 'KeyP', mod: 1, c: 1 }, gap: { gap: 1 }, letters: { lg: 'abc', code: 'AltLeft', mod: 1, c: 1, unpad: 1 },
    };
    for (const a of ['left', 'up', 'down', 'right']) Object.assign(SP[a], { code: SP[a].key, mod: 1, c: 1, arrow: 1, lg: SVG(ARROW[a]), html: 1 });
    /* a character's physical key on a US board (the sound of that key; shifted characters say so) */
    const SHIFTED = { '~': 'Backquote', '!': 'Digit1', '@': 'Digit2', '#': 'Digit3', '$': 'Digit4', '%': 'Digit5', '^': 'Digit6', '&': 'Digit7', '*': 'Digit8', '(': 'Digit9', ')': 'Digit0',
      _: 'Minus', '+': 'Equal', '{': 'BracketLeft', '}': 'BracketRight', '|': 'Backslash', ':': 'Semicolon', '"': 'Quote', '<': 'Comma', '>': 'Period', '?': 'Slash' };
    const PLAIN = { '`': 'Backquote', '-': 'Minus', '=': 'Equal', '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash', ';': 'Semicolon', "'": 'Quote', ',': 'Comma', '.': 'Period', '/': 'Slash' };
    const codeOf = ch => /[a-z]/i.test(ch) ? 'Key' + ch.toUpperCase() : /\d/.test(ch) ? 'Digit' + ch : SHIFTED[ch] || PLAIN[ch] || 'Quote';
    /* layouts: rows of keys; a {name:width} token is a named key, anything else a character. Portrait has a row of
       esc, tab, ctrl and the arrows on top; landscape puts them around the letters, as on the desk */
    const P = {
      fn: '{esc:1.25} {tab:1.25} {ctrl:1.25} {gap:.75} {left:1.375} {up:1.375} {down:1.375} {right:1.375}',
      let: ['q w e r t y u i o p', 'a s d f g h j k l', '{shift:1.5} z x c v b n m {bksp:1.5}', '{n123:1.25} - {space:3.75} . / {ret:2}'],
      sym: ['1 2 3 4 5 6 7 8 9 0', '- / : ; ( ) $ & @ "', "{sym2:1.5} . , ? ! ' | ~ {bksp:1.5}", '{abc:1.25} _ {space:3.75} . / {ret:2}'],
      sym2: ['[ ] { } # % ^ * + =', '_ \\ | ~ < > ` & ; :', `{sym1:1.5} . , ? ! ' " @ {bksp:1.5}`, '{abc:1.25} _ {space:3.75} . / {ret:2}'],
    };
    const L = {
      let: ['{esc:1.25} q w e r t y u i o p {bksp:1.75}', '{tab:1.5} a s d f g h j k l {ret:2.5}', '{shift:2} z x c v b n m , . / {up}', '{ctrl:1.5} {n123:1.5} - {space:5} ~ {left} {down} {right}'],
      sym: ['{esc:1.25} 1 2 3 4 5 6 7 8 9 0 {bksp:1.75}', '{tab:1.5} - / : ; ( ) $ & @ {ret:2.5}', `{sym2:2} " . , ? ! ' | ~ * {up}`, '{ctrl:1.5} {abc:1.5} _ {space:5} = {left} {down} {right}'],
      sym2: ['{esc:1.25} [ ] { } # % ^ * + = {bksp:1.75}', '{tab:1.5} _ \\ | ~ < > ` & ; {ret:2.5}', `{sym1:2} : . , ? ! ' " @ $ {up}`, '{ctrl:1.5} {abc:1.5} _ {space:5} = {left} {down} {right}'],
    };
    /* typing tests want the comma and the apostrophe where a shell wants - and / */
    const VARIANT = { typing: { let4: "{n123:1.25} , {space:3.75} . ' {ret:1.75}" } };
    /* pads: a layout per app, from how each is played. Grid areas name the keys; '.' is a gap (portrait) or the tube
       (a phone on its side, where the pad's halves sit either side of it, like a handheld). Every landscape pad has an
       'letters' key, the way back to the keyboard (portrait has it on the strip) */
    const PK = {
      left: { key: 'ArrowLeft', icon: ARROW.left }, right: { key: 'ArrowRight', icon: ARROW.right },
      soft: { key: 'ArrowDown', icon: ARROW.down, sub: 'soft drop' },
      drop: { key: ' ', code: 'Space', icon: 'M12 3.5v11M7 10l5 5 5-5M5 20h14', sub: 'drop' },
      cw: { key: 'ArrowUp', code: 'KeyX', icon: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5V9H15', sub: 'turn' },
      ccw: { key: 'z', code: 'KeyZ', icon: 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5V9H9', sub: 'turn' },
      hold: { key: 'c', code: 'KeyC', lg: 'hold' }, p: { key: 'p', code: 'KeyP', lg: 'pause' }, esc: { key: 'Escape', lg: 'esc' },
      serve: { key: ' ', code: 'Space', lg: 'serve' },
      bleft: { key: 'ArrowLeft', icon: 'M15 5l-7 7 7 7', big: 1 }, bright: { key: 'ArrowRight', icon: 'M9 5l7 7-7 7', big: 1 },
      again: { key: 'Enter', lg: 'again' }, up: { key: 'ArrowUp', icon: ARROW.up }, down: { key: 'ArrowDown', icon: ARROW.down },
      letters: { lg: 'abc', code: 'AltLeft', unpad: 1 },
    };
    const S2 = 'calc(var(--side) / 2 - 2px)';
    const PADS = {
      /* movement on the left thumb (left, right side by side; soft drop under them), turning and dropping on the right */
      tetris: { cols: '1fr 1fr .28fr 1fr 1fr', rows: '.62fr 1fr 1fr', areas: ['esc p . hold hold', 'left right . ccw cw', 'soft soft . drop drop'],
        lcols: [S2, S2, '1fr', S2, S2].join(' '), lrows: '.7fr 1fr 1fr', lareas: ['esc p . letters hold', 'left right . ccw cw', 'soft soft . drop drop'] },
      /* the whole pad is the controller and the only one: four big keys in a cross (up and down full width, left and
         right halves), each a turn the moment a thumb lands. Pause, again and quit are on the strip, away from the
         thumbs (a phone on its side: the cross on the left, those keys on the right) */
      snake: { cols: '1fr 1fr', rows: '.9fr 1.1fr .9fr', areas: ['up up', 'left right', 'down down'],
        lcols: [S2, S2, '1fr', S2, S2].join(' '), lrows: '1fr 1.15fr 1fr', lareas: ['up up . p letters', 'left right . again again', 'down down . esc esc'] },
      /* two big halves for the paddle, serve over them */
      breakout: { cols: '1fr 1fr 1fr 1fr', rows: '.72fr 1.3fr', areas: ['esc p serve serve', 'bleft bleft bright bright'],
        lcols: [S2, S2, '1fr', S2, S2].join(' '), lrows: '.7fr 1fr 1fr', lareas: ['esc serve . p letters', 'bleft bleft . bright bright', 'bleft bleft . bright bright'] },
    };
    for (const n in PK){ const k = PK[n]; Object.assign(k, { name: n, w: 1, mod: k.lg ? 1 : 0, c: 1 }); if (!k.code) k.code = k.key || 'KeyA'; if (k.icon){ k.lg = SVG(k.icon) + (k.sub ? '<small>' + k.sub + '</small>' : ''); k.html = 1; k.arrow = 1; } }
    const parse = tok => {
      const m = /^\{(\w+)(?::([\d.]+))?\}$/.exec(tok);
      if (m) return Object.assign({ name: m[1], w: +(m[2] || 1) }, SP[m[1]]);
      return { ch: tok, w: 1, code: codeOf(tok), c: !/[a-z]/i.test(tok) };
    };
    let land = null, layer = 'let', pad = '', variant = '', shiftSt = 0, shiftAt = 0, ctrlOn = false, folded = false;   // shiftSt: 0 off, 1 once, 2 caps lock
    const slots = new Map();   // slot id -> key element (so a held key survives a layer change)
    const keyEl = (k, slot) => {
      const d = D.createElement('div'); d.className = 'key' + (k.mod ? ' mod' : '') + (k.c ? ' c' : '') + (k.arrow ? ' arrow' : '') + (k.gap ? ' gap' : '') + (k.name ? ' k-' + k.name : '');
      if (k.w !== 1) d.style.setProperty('--w', k.w);
      const cap = D.createElement('span'); cap.className = 'cap'; d.appendChild(cap);
      if (k.ml) cap.style.setProperty('--ml', k.ml); if (k.mr) cap.style.setProperty('--mr', k.mr);
      const lg = D.createElement('span'); lg.className = 'lg';
      if (k.html) lg.innerHTML = k.lg; else lg.textContent = k.ch != null ? (/[a-z]/.test(k.ch) ? k.ch.toUpperCase() : k.ch) : k.lg;
      cap.appendChild(lg);
      if (k.led){ const l = D.createElement('i'); l.className = 'led'; cap.appendChild(l); }
      d._k = k; d._slot = slot; slots.set(slot, d); return d;
    };
    const render = () => {
      board.textContent = ''; slots.clear(); board.classList.toggle('gaming', !!pad);
      if (pad){
        const def = PADS[pad], areas = land ? def.lareas : def.areas, g = D.createElement('div'); g.className = 'pad pad-' + pad;
        g.style.gridTemplateColumns = land ? def.lcols : def.cols; g.style.gridTemplateRows = land ? def.lrows : def.rows;
        g.style.gridTemplateAreas = areas.map(r => '"' + r + '"').join(' ');
        for (const n of new Set(areas.join(' ').split(' '))){
          if (n === '.') continue;
          const d = keyEl(PK[n], 'pad:' + n);
          d.style.gridArea = n; g.appendChild(d);
        }
        board.appendChild(g); return;
      }
      const rows = (land ? L : P)[layer].slice();
      if (!land && layer === 'let' && VARIANT[variant]) rows[3] = VARIANT[variant].let4;
      if (!land) rows.unshift(P.fn);
      rows.forEach((r, y) => {
        const row = D.createElement('div'); row.className = 'row' + (!land && y === 0 ? ' fn' : '');
        const toks = r.split(' ').map(parse);
        /* the middle letter row sits half a key in: its end keys take that half (no dead gaps between keys) */
        if (!land && layer === 'let' && y === 2){ toks[0].w = 1.5; toks[0].ml = '33.3%'; toks[toks.length - 1].w = 1.5; toks[toks.length - 1].mr = '33.3%'; }
        toks.forEach((k, x) => row.appendChild(keyEl(k, (k.name && !k.ch ? k.name : y + ':' + x))));
        board.appendChild(row);
      });
      paintMods();
    };
    const paintMods = () => {
      for (const d of board.querySelectorAll('.k-shift')){ d.classList.toggle('on', shiftSt === 1 || !!shiftHeld()); d.classList.toggle('lock', shiftSt === 2); }
      for (const d of board.querySelectorAll('.k-ctrl')) d.classList.toggle('on', ctrlOn);
    };
    const setLayer = l => {
      if (l === layer) return; layer = l;
      const held = [...active.values()]; render();
      for (const a of held){ const n = slots.get(a.el._slot); if (n && n._k.name === a.el._k.name && a.el._k.name){ a.el = n; n.classList.add('down'); } }
    };

    /* ---- sending keys ---- */
    const ev = (type, key, code, o = {}) => ({ type, key, code, repeat: !!o.repeat, isComposing: false, ctrlKey: !!o.ctrl, altKey: false, metaKey: false, shiftKey: !!o.shift, synthetic: true, touchKey: true, preventDefault(){}, stopPropagation(){} });
    const send = (key, code, o) => { try { term.handleKey(ev('keydown', key, code, o)); } catch (e){ oops(e); } };
    const sendUp = (key, code) => { try { if (term.handleKeyUp) term.handleKeyUp(ev('keyup', key, code)); } catch (e){ oops(e); } };
    const shiftHeld = () => { for (const a of active.values()) if (a.el._k.name === 'shift') return a; return null; };
    const ctrlHeld = () => { for (const a of active.values()) if (a.el._k.name === 'ctrl') return a; return null; };
    /* what a key does on the way down */
    const act = (k, a) => {
      if (k.layer){ setLayer(k.layer); return; }
      if (k.unpad){ api.setPad(''); return; }   // a phone on its side: the pad's own way to the letters
      if (k.name === 'shift'){
        const t = performance.now();
        shiftSt = shiftSt === 2 ? 0 : shiftSt === 1 ? (t - shiftAt < 380 ? 2 : 0) : 1; shiftAt = t; paintMods(); return;
      }
      if (k.name === 'ctrl'){ ctrlOn = !ctrlOn; paintMods(); return; }
      const sh = shiftSt > 0 || !!shiftHeld(), ct = ctrlOn || !!ctrlHeld();
      let key = k.key, code = k.code;
      if (k.ch != null){
        key = k.ch; if (/[a-z]/.test(key) && sh && !ct) key = key.toUpperCase();
        a.shift = sh && /[a-z]/i.test(k.ch) || !!SHIFTED[k.ch];
      } else a.shift = sh;
      a.key = key;
      send(key, code, { shift: a.shift, ctrl: ct });
      /* one-shot modifiers are used up (a held one stays while it is held) */
      let used = false;
      if (shiftSt === 1){ shiftSt = 0; used = true; }
      const sa = shiftHeld(); if (sa) sa.used = true;
      if (ctrlOn){ ctrlOn = false; used = true; }
      const ca = ctrlHeld(); if (ca) ca.used = true;
      if (used) paintMods();
      /* digits and symbols are a short trip: a space or return takes you back to the letters */
      if (!pad && layer !== 'let' && (k.name === 'space' || k.name === 'ret')) setLayer('let');
      if (k.rep && !pad) a.rep = setTimeout(function again(n){ if (!active.has(a.id)) return; send(key, code, { repeat: true, shift: a.shift }); a.rep = setTimeout(again, n > 14 ? 40 : 70, (n || 0) + 1); }, 420, 0);
    };

    /* ---- touches: pointer events, one per finger ---- */
    const active = new Map();   // pointerId -> { id, el, key, rep, used }
    const pops = [];
    const popFor = (a, k) => {
      if (k.ch == null) return;
      let p = pops.find(x => !x._on); if (!p){ p = D.createElement('div'); p.className = 'pop'; D.body.appendChild(p); pops.push(p); }
      const r = a.rect, w = Math.max(44, r.width * 1.45), h = Math.max(50, r.height * 1.12);
      p.textContent = a.key && a.key.length === 1 ? a.key : k.ch;
      p.style.width = w + 'px'; p.style.height = h + 'px';
      p.style.left = clamp(r.left + r.width / 2 - w / 2, 3, innerWidth - w - 3) + 'px'; p.style.top = (r.top - h - 8) + 'px';
      p._on = true; p.classList.add('on'); a.pop = p; a.popAt = performance.now();
    };
    const popOff = a => { const p = a.pop; if (!p) return; a.pop = null; const wait = Math.max(0, 70 - (performance.now() - a.popAt)); setTimeout(() => { p._on = false; p.classList.remove('on'); }, wait); };
    /* where a cap is, for its preview: measured once (keys stay put) and before the press changes any style, so a
       fast typist never waits on a layout */
    let rectGen = 0; addEventListener('resize', () => { rectGen++; });
    const capRect = el => { if (el._rg !== rectGen){ el._rect = el.querySelector('.cap').getBoundingClientRect(); el._rg = rectGen; } return el._rect; };
    const press = (el, id, x, y) => {
      const k = el._k; if (!k || k.gap) return;
      const a = { id, el };
      if (!pad && k.ch != null) a.rect = capRect(el);
      unlock(); buzz();
      active.set(id, a);
      el.classList.add('down');
      if (sound) try { sound.key(k.code || 'KeyA', true); } catch (e){}
      a.code = k.code;
      act(k, a);
      if (!pad) popFor(a, k);
    };
    const release = id => {
      const a = active.get(id); if (!a) return;
      active.delete(id); clearTimeout(a.rep); a.el.classList.remove('down'); popOff(a);
      if (sound) try { sound.key(a.code || 'KeyA', false); } catch (e){}
      const k = a.el._k;
      if (a.key) sendUp(a.key, a.code);
      /* shift or ctrl held while other keys were typed: let go, and it is off */
      if (k.name === 'shift' && a.used){ shiftSt = 0; }
      if (k.name === 'ctrl' && a.used){ ctrlOn = false; }
      if (k.name === 'shift' || k.name === 'ctrl') paintMods();
    };
    const kbPointers = new Set();   // touches that began on the keys (a fold can take their caps away mid-touch)
    board.addEventListener('pointerdown', e => {
      kbPointers.add(e.pointerId);
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      const el = e.target.closest('.key'); if (!el || !board.contains(el)) return;
      if (active.has(e.pointerId)) release(e.pointerId);
      press(el, e.pointerId, e.clientX, e.clientY);
    });
    for (const t of ['pointerup', 'pointercancel']) addEventListener(t, e => { if (kbPointers.delete(e.pointerId)) kbTouch = { t: performance.now(), x: e.clientX, y: e.clientY }; release(e.pointerId); }, true);
    /* no magnifier, callout, double-tap zoom or emulated mouse on the keys */
    board.addEventListener('touchstart', e => { if (e.cancelable) e.preventDefault(); }, { passive: false });
    board.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('blur', () => { for (const id of [...active.keys()]) release(id); });

    /* a hardware key also moves its cap on screen */
    const echo = (code, down) => {
      if (!code || folded) return;
      for (const d of board.querySelectorAll('.key')){ const k = d._k; if (k && (k.code === code || (k.ch && codeOf(k.ch) === code && !k.c))){ d.classList.toggle('down', down); if (down) setTimeout(() => d.classList.remove('down'), 600); break; } }
    };
    /* a phone on its side plays like a handheld: the pad's two halves sit either side of the tube, which keeps the
       whole height (head.html: body.land.gaming) */
    const height = () => land && pad && !folded ? 0 : el.offsetHeight;
    const relayout = () => { const h = height() + 'px', was = D.body.style.getPropertyValue('--kbh'); D.body.style.setProperty('--kbh', h); return was !== h; };
    const api = {
      el, echo, height,
      settled: () => performance.now() - appEndedAt > 1500,   // a page read back after an app, not the app's last swipe
      layout(l){ if (l === land) return; land = l; render(); },
      get pad(){ return pad; },
      /* name: an app with a pad of its own (PADS), or '' for the keyboard */
      hasPad: name => !!PADS[name],
      setPad(name){ name = PADS[name] ? name : ''; if (!name && pad) appEndedAt = performance.now(); if (name === pad) return; pad = name; if (!name) layer = 'let'; for (const id of [...active.keys()]) release(id); D.body.classList.toggle('gaming', !!name); render(); if (relayout()) build(); if (onPad) onPad(); },
      setVariant(v){ v = v || ''; if (v === variant) return; variant = v; if (!pad && layer === 'let') render(); },
      set onPad(f){ onPad = f; },
      get folded(){ return folded; },
      fold(f){
        f = !!f; if (f === folded) return; folded = f;
        for (const id of [...active.keys()]) release(id);
        D.body.classList.toggle('fold', f);
        const b = el.querySelector('.fold'); if (b){ b.setAttribute('aria-expanded', String(!f)); b.setAttribute('aria-label', f ? 'Bring the keyboard back' : 'Fold the keyboard away'); }
        if (!f && !REDUCED){ board.classList.remove('rise'); void board.offsetWidth; board.classList.add('rise'); }
        relayout(); build();
        if (!f && !term.app && term.scrollInfo && term.scrollInfo.off > 0) term.scroll(1e5);   // the keys come up for typing: show the prompt
      },
    };
    let onPad = null, appEndedAt = 0;
    return api;
  }

  /* ---- phones: the strip over the keys, the copied note and the phone's own back ---- */
  function phone(){
    const strip = keys.el.querySelector('.sk'), foldBtn = keys.el.querySelector('.fold'), toastEl = $('#toast');
    /* the pages on the strip: writing only once something is published */
    const pages = () => ['about', 'j', 'eden', ...(M.reader && M.reader.posts && M.reader.posts().length ? ['writing'] : []), 'contact', 'links', 'help'];
    const STRIP_ONLY = /^(timer|clock)$/;
    const SVG = d => '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"/></svg>';
    const keyEv = (key, type) => ({ type, key, code: key === ' ' ? 'Space' : key, repeat: false, isComposing: false, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, synthetic: true, preventDefault(){}, stopPropagation(){} });
    const fk = (label, act, o = {}) => {
      const b = D.createElement('button'); b.type = 'button'; b.className = 'fk' + (o.cls ? ' ' + o.cls : '');
      if (o.html) b.innerHTML = o.html; else b.textContent = label;
      b.setAttribute('aria-label', o.aria || label); b._act = act; return b;
    };
    /* the sound switch: on the bezel in portrait, a key on the strip on a phone on its side */
    const placeMute = () => { const land = D.body.classList.contains('land'); if (land && muteBtn.parentNode !== strip.parentNode) strip.parentNode.insertBefore(muteBtn, foldBtn); else if (!land && muteBtn.parentNode !== D.body) D.body.insertBefore(muteBtn, keys.el); };
    /* what the strip offers: the pages, or the words that match what is being typed, or a game's name and its pad */
    let mode = null;
    const render = m => {
      mode = m; strip.textContent = ''; strip.className = 'sk ' + m.split(':')[0];
      strip.setAttribute('aria-label', m.startsWith('app:') ? 'Keys' : m.startsWith('sug:') ? 'Suggestions' : 'Pages');
      if (m.startsWith('app:')){
        /* the app's name or its state (a typing test's speed), the pad / letters swap for a game, then the app's own
           keys of the moment (the editor's shortcuts, the timer's) from its status() */
        const st = term.appStatus || {}, app = term.app;
        const n = D.createElement('span'); n.className = 'note'; n.textContent = st.note || app; strip.appendChild(n);
        if (keys.hasPad(app)) strip.appendChild(fk(keys.pad ? 'abc' : 'pad', () => { keys.setPad(keys.pad ? '' : app); mode = null; }, { aria: keys.pad ? 'Letters' : 'Game pad' }));
        for (const k of st.keys || []){
          const b = fk(k.label, () => {
            const e = Object.assign(keyEv(k.key, 'keydown'), { ctrlKey: !!k.ctrl, touchKey: true, code: { ' ': 'Space', '-': 'Minus', '+': 'Equal' }[k.key] || (/^[a-z]$/i.test(k.key) ? 'Key' + k.key.toUpperCase() : k.key) });
            term.handleKey(e); if (term.handleKeyUp) term.handleKeyUp(Object.assign({}, e, { type: 'keyup' }));
          }, { aria: k.label });
          if (k.hint){ const i = D.createElement('i'); i.textContent = k.hint; b.prepend(i); }
          strip.appendChild(b);
        }
        return;
      }
      if (m.startsWith('sug:')){
        const word = /\S*$/.exec(term.line)[0], list = term.suggest();
        if (!list.length){ const n = D.createElement('span'); n.className = 'note'; n.textContent = 'return runs it'; strip.appendChild(n); return; }
        for (const w of list){
          const b = fk(w, () => pickWord(w)), at = word && w.startsWith(word) ? word.length : 0;
          if (at){ const s = D.createElement('b'), wrap = D.createElement('span'); s.textContent = w.slice(0, at); wrap.append(s, w.slice(at)); b.textContent = ''; b.appendChild(wrap); }   // one flex item: no gap inside the word
          strip.appendChild(b);
        }
        strip.scrollLeft = 0; return;
      }
      const cur = m.split(':')[1] || '', on = p => p === cur || (p === 'help' && /^help\b/.test(cur));   // (the page, from 'nav:<page>:<canBack>')
      if (term.canBack) strip.appendChild(fk('back', () => { if (term.canBack) term.run('back'); }, { cls: 'ico', html: SVG('M15 6l-6 6 6 6'), aria: 'Back' }));
      for (const p of pages()){ const b = fk(p, () => go(p)); if (on(p)) b.classList.add('on'); strip.appendChild(b); }
    };
    const fits = () => strip.classList.toggle('over', strip.scrollWidth > strip.clientWidth + 1);   // the edge fades only when there is more to swipe to
    const modeNow = () => {
      if (term.app){ const st = term.appStatus; return 'app:' + term.app + ':' + keys.pad + ':' + (st ? JSON.stringify(st) : ''); }
      const l = term.line; if (l && l.trim()) return 'sug:' + l;
      return 'nav:' + (term.page || '') + ':' + term.canBack;
    };
    /* a page key opens that page, and the keyboard folds away (it is for reading); a word fills the line, and runs it
       when it is a whole command */
    const go = p => {
      if (term.app) return;
      if (term.busy) term.handleKey(Object.assign(keyEv('c', 'keydown'), { ctrlKey: true }));   // a command still running (or asking): stop it first
      let k = 0; const later = () => { if (!term.busy){ term.run(p); keys.fold(true); } else if (k++ < 30) requestAnimationFrame(later); }; later();
    };
    const pickWord = w => { if (term.pick(w)) term.handleKey(keyEv('Enter', 'keydown')); };
    /* strip keys go down under the thumb and click like keys; they act on release, so the strip can be swiped */
    const fkSound = (b, d) => { if (sound) try { sound.key(b === foldBtn ? 'Fn' : 'F' + (1 + [...strip.children].indexOf(b) % 12), d); } catch (e){} };
    const row = keys.el.querySelector('.strip');
    row.addEventListener('pointerdown', e => {
      const b = e.target.closest('.fk'); if (!b || b === muteBtn) return;
      unlock(); buzz(); b.classList.add('down'); fkSound(b, true);
      const up = () => { b.classList.remove('down'); fkSound(b, false); removeEventListener('pointerup', up, true); removeEventListener('pointercancel', up, true); };
      addEventListener('pointerup', up, true); addEventListener('pointercancel', up, true);
    });
    /* a key's touch whose cap folded away under it ends over the strip: that is not a press of the strip */
    row.addEventListener('click', e => { if (strayClick(e)) return; const b = e.target.closest('.fk'); if (b && b._act) b._act(); });
    foldBtn.addEventListener('click', e => { if (!strayClick(e)) keys.fold(!keys.folded); });
    keys.onPad = () => { mode = null; };
    /* copied: a note over the tube (terminal.js calls M.toast) */
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
    let wasReading = false, n = 0, wasApp = '', exitAt = 0, lastPage = '', sugAt = 0;
    return changed => {
      const r = reading(); if (r !== wasReading){ wasReading = r; D.body.classList.toggle('reading', r); }
      /* each app gets its controls: a game its own pad (and the keyboard comes up for it); the editor and the typing
         test the letters (the typing test with , and ' to hand); the timer and the clock only their keys on the strip,
         the keyboard folded away so the digits get the screen. Leaving brings the letters back */
      if (term.app !== wasApp){
        const a = term.app, was = wasApp; wasApp = a;   // (first: a hiccup below must not leave this to be redone every frame)
        if (!a) exitAt = performance.now();
        keys.setVariant(a === 'typing' ? 'typing' : '');
        keys.setPad(keys.hasPad(a) ? a : '');
        if (STRIP_ONLY.test(a)) keys.fold(true);
        else if (a || was) keys.fold(false);
      }
      /* and with no app running, the plain keyboard, whatever happened on the way out: the letters, unfolded for a moment
         after an app ends (a fold the visitor asks for later stands) */
      if (!term.app){
        if (keys.pad) keys.setPad('');
        if (exitAt && performance.now() - exitAt < 1200 && keys.folded) keys.fold(false);
      }
      /* every way into a page (strip, menu, a tapped word, a typed command) gives it the whole tube */
      const pg = term.app ? lastPage : term.page || '';
      if (pg !== lastPage){ if (pg) keys.fold(true); lastPage = pg; }
      placeMute();
      const m = modeNow();
      /* the strip: at once when it changes kind (pages, words, an app); while typing, the words a beat after the keys stop
         (the matching runs over every command, and a fast thumb should not wait on it) */
      if (m !== mode){
        const now = performance.now(), typingOn = m.startsWith('sug:') && mode && mode.startsWith('sug:');
        if (!typingOn || now - sugAt > 90){ render(m); fits(); sugAt = now; }
      }
      if (changed || !(n++ % 15)){
        syncHistory();
      }
    };
  }
}
})();
