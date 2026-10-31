# Kaiav's desk: module contract

The site is one 3D scene: a night room, a warm desk lamp, a beige 1980s compact all-in-one computer whose
CRT shows a working terminal, a keyboard on the desk, and the silhouette of a person typing on it. When the
visitor types, the silhouette's hands press the same keys on the 3D keyboard, and the keys go down.

Files in `src/` are concatenated into one page by `build.py` (see ORDER there). three.js r147 is loaded as
the global `THREE` from `https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js`, by a small async loader in
`head.html` (`MAC.three` is a promise of true/false; touch devices skip it). If scene.js runs before THREE arrives it
registers `MAC.loadScene` instead, and main.js calls it once three.js is in (or goes terminal-only after 10 s). Addons, if needed,
load from `https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/...` (they attach to `THREE.*`) and must be
added to the `<script src>` list in `head.html` by the integrator (ask in your report; don't edit head.html).

Everything hangs off one namespace: `window.MAC`.

## content.js (integrator)
`MAC.CONTENT`: name, links, j, eden, about, writing. All copy comes from here.

## scene.js (scene agent)
```js
MAC.createScene(container: HTMLElement) -> {
  renderer, scene, camera,
  setScreenCanvas(canvas),      // the terminal's 2D canvas becomes the CRT image
  markScreenDirty(),            // call when the terminal canvas changed this frame
  setScreenLum(v),              // 0..1 mean screen brightness from the terminal (term.lum); drives the glow without a pixel readback
  screenAspect: number,         // width / height of the visible screen area (terminal sizes itself to this)
  keyboard: {
    hasKey(code) -> bool,               // KeyboardEvent.code, e.g. 'KeyA', 'Space', 'Enter', 'ShiftLeft'
    keyWorldPos(code) -> THREE.Vector3, // top-centre of the key cap, world space (null if missing)
    keyRow(code) -> number,             // 0 = number row ... 4 = space row (helps the typist pick a finger)
    press(code), release(code),         // animate the key cap down / up
  },
  rig: {                        // where the typist sits
    seat: THREE.Vector3,        // centre of the chair seat, world space
    keyboardCenter: THREE.Vector3,
    keyboardNormal: THREE.Vector3,   // up direction of the key surface
    screenCenter, lampPosition, keySpacing,
    eye,                        // camera rest position (the typist's eyes)
    deskTop, wallZ, windowRect, // for room.js (MAC.dressRoom(api))
  },
  add(obj3d),                    // also turns on castShadow for its meshes, unless mesh.userData.noShadow
  defer(fn),                     // start-up work for later: fn runs (a generator: steps) in ~6 ms slices between frames.
                                // The scene paints its off-screen textures this way; room.js builds its sections and
                                // typist.js meshes the hands through it, so the first frame comes early and never stalls
  mergeStatic(group),           // merges a group's static meshes that share a material into one draw (skips userData.keep)
  setLook(nx, ny),              // pointer in -1..1 (0,0 = the screen); ny > 0 leans back toward the desk and hands
  nudge(),                      // a keystroke happened: skips the intro reveal, wakes the renderer
  setLamp(on), lampOn,          // the desk lamp switch (main.js exposes it as MAC.world.lamp)
  pickScreen(clientX, clientY) -> {u, v} | null,   // raycast to the CRT glass; u, v are 0..1 from the TOP-LEFT of the
                                // terminal canvas (barrel bow and overscan inset accounted for); null off the image
  update(dt, t),
  render(),
  resize(w, h),
}
```
Test hook: with `?debug` in the URL the scene also exposes `api._dbg = { yawS, pitchS, intro, shot, LOOK, lampS, view(), jobs(), flushJobs(), push }`
(`flushJobs()` finishes the deferred work at once; `push.t = 9` skips the settle-in camera move)
(`view()` returns `{ yawRest, leanAt, leanEnd, fullFov }`)
(e.g. `pitchS.x = pitchS.t = -LOOK.down` forces the lean-back view). Not present otherwise.

## typist.js (typist agent)
```js
MAC.createTypist(sceneApi) -> {
  object3d,                     // already positioned on sceneApi.rig.seat; integrator calls sceneApi.add(object3d)
  keyDown(code),                // a hand travels to keyWorldPos(code) and presses (call sceneApi.keyboard.press at contact)
  keyUp(code),                  // finger lifts (call sceneApi.keyboard.release)
  update(dt, t),
}
```
The typist calls `sceneApi.keyboard.press/release` itself, timed to finger contact, so key motion and finger
motion stay in sync. Unknown codes: pick the nearest key or just bob a finger.

## terminal.js (terminal agent)
```js
MAC.createTerminal({ content, aspect, cols?, width? }) -> {   // width: phones ask for a canvas as wide as the tube in device pixels (720..1280)   // cols: 54 on desktop, 40 on phones in portrait, up to 84 on wider touch screens
  canvas,                       // 2D canvas, redrawn only when something changes
  handleKey(e: KeyboardEvent) -> bool,   // true if consumed (call e.preventDefault()); false lets Tab move focus
  handleKeyUp(e),               // passed to a running app's keyUp (games)
  handleTap(u, v) -> bool,      // a click/tap at canvas fractions 0..1: chips, card rows, app tap(col, row)
  handleDrag(u, v, phase) -> bool,   // phones: a finger moving on the tube while an app runs ('start' | 'move' | 'end'); passed
                                // to app drag(col, row, phase) with fractional cells; true when the app took the gesture
  insertText(str),              // assistive tech on phones, IME, paste
  resize(aspect, cols),         // a new tube size (aspect 0.3..5); with the same cols (only the height changed: the phone's
                                // keyboard folding), a reader scrolled back or a page held at its top keeps its top row
  update(dt, t) -> bool,        // advance animations (cursor blink, typing-out output); true if canvas changed
  run(cmd),                     // run a command programmatically (#hash deep links)
  scroll(dy),                   // wheel / touch scrollback
  cursorY,                      // bottom of the prompt line, 0..1 of the canvas (phones keep it above the keyboard)
  lum,                          // mean brightness of the last frame drawn, 0..1, tallied while drawing
  busy,                         // an app or command is running (don't rebuild the terminal under it)
  cursorOn,                     // the blinking block is lit right now (main.js copies the phone bloom only while it is dark,
                                // so its halo never lingers over a blink); every key restarts the blink, lit
  pointer(u, v, down),          // optional: the mouse over the tube (u, v: 0..1 of the canvas, -1, -1 when off it or gone;
                                // down: the main button held). Only the landing uses it: its logo leans toward the pointer
                                // and a drag spins it. main.js calls it from pointermove (both layouts) and on leave
  // read-only state and two helpers for the phone dock (main.js flat()):
  suggest(q?) -> [names],       // what the word being typed could become, best first (the same completion Tab uses);
                                // with q, commands matching q. [] while an app, a ctrl+r search or a boot is on
  pick(name) -> bool,           // takes a suggestion into the line (+ a space); true when the line is then a whole
                                // command that needs no argument (main.js then sends Enter)
  line, app, page,              // the line being typed; the running app's name or ''; the page on screen ('' = welcome)
  canBack,                      // a page is open and nothing is running: back has somewhere to go
  appStatus,                    // the running app's status(), if it has one: { note, keys: [{ label, key, ctrl?, hint? }] } (the phone strip)
  scrollInfo,                   // { off: rows up from the bottom, max, rowH: a row as 0..1 of the canvas } (1:1 touch scrolling)
}
```
Phones (pointer: coarse) play the intro once, its opening (`DEMO.LENGTH`, about 14.3 s; any tap or key skips it), then settle on a title card:
the name, the role line and a boot-disk menu of big rows (about, j, eden, writing when published, contact, links, play),
tapped or chosen by number, the arrows and return; a returning visitor lands on the card with "welcome back", and `demo`
plays the intro again. Home and back on phones are this card. Contact on phones gives each address [email] (mailto) and
[copy] (one confirmation: the toast), the profiles inline. `leave()` calls `MAC.pageTurn(canvas)` when main.js offers it
(the phone's afterglow). Test hooks: `intro` and `home` (read-only). On phones the card carries a slowly turning KN badge
(its own small vector drawing, not the intro's logo), and when an animation is all that changes and nothing scrolls,
only its rows are redrawn (the brightness tally `lum` swaps that drawing's share, so it stays the whole screen's). On desktops:
The landing (every load, until the first command; deep links skip it) is an anime-OP-style opening drawn on the canvas,
12.8 s to the slam (silent) on its own fixed 150 bpm grid (a film of 11.2 s played through a cut: every word is held whole and
still for at least 0.4 s by half beats or beats added while its backdrop keeps moving, and two camera moves play faster) (a cut or a hit every half beat or beat), in one phosphor: the tube
ignites on a tunnel of bezels; KAIAV, NIHALANI and a huge 16 slam in (the name becoming a header); an impact frame; the
picture was the middle tube of a wall of CRTs: the camera blasts back, flies along the wall as the tubes switch on in
cascades (each a word or motif: KN, J, EDEN, AGENTS, CONTEXT, FOUNDERS, 16, a globe, a graph), whips round and dives
into the J tube (a turning globe with CO-FOUNDER, YOUNG FOUNDERS and GLOBAL slammed flat over it), out in a barrel roll and into
the EDEN tube (EDEN and AGENTS drawn by linking constellations, CONTEXT squeezed in by brackets); the wall becomes a
flip-board spelling JUST START a tube to a letter and hits as three comic panels (JUST / START / !); every tube flips to KN, the KN bursts out of the middle one in
wireframe, turns chrome on a split impact frame, and is cut from angle to angle on the hits while the wall behind it
collapses into it, the shots shortening to a 0.1 s run, into the slam on the set (an inverted, overscaled frame, a
hit-stop with a white ring shockwave, the land). Each act has its own way of putting words on screen (slams, globe
bands, constellations, flip tiles). Impact frames last two or three frames over a short hit-stop (the picture's clock
holds, then catches up); one is a bright full frame (the slam), the rest dark field with bright line art. Motion blur is real (sub-frame samples averaged). Then a loop in movements of 16 s, each
opened by a full turn of the KN and a quiet ring: the set alone first, then (cycling) the wall of CRTs drifting past
the intro's words with the KN orbiting, the J globe turning round it, the Eden constellation behind it, the set again;
each backdrop eases in and out over the dimmed bars. A glint every eight beats, and a sine scroller of `MAC.CONTENT`
facts (the name, J, Eden) in the intro's vector type with its reflection. Keys glint the type, or give the
logo one more smooth turn and a hop; reduced motion gets one still frame. It is silent. It animates at 30 fps through
the viz `live` mechanism and stops when dismissed, scrolled off, or the reader is open. Test hooks (read-only, `?debug`): `introAge` (the intro's real age, s, from its first frame) and
`introPose` (the logo's pose in the last frame).

## main.js (integrator)
Creates the scene, terminal and typist; routes keydown/keyup to terminal + typist; text input through the hidden
#kbd field (all devices, so assistive tech has a real input); clicks on the tube go through `api.pickScreen` to
`term.handleTap` (a click on the glass during the intro does nothing unless it lands on a chip, such as the help line's `help`). Hash deep links: #about #eden #j #writing #contact #links #help, and #post/<slug> for the reader
(anything else in the hash is ignored). One rAF loop, paused when hidden and while the reader is open.
`flat()` is the terminal-only layout: phones, and desktops without WebGL or three.js, after a context loss or
repeated render errors. Desktops get one centred column, unchanged. Touch screens get the computer in the hand:
- the case (built by main.js into #stage): the tube's recess, a KN-84 model plate, a floppy slot whose lamp flickers with
  `MAC.sound.event('disk')`, the sound lamp (#mute) behind a lens;
  the bloom is redrawn only when the picture settles (hidden while the tube animates, never under a finger), a tap on
  the glass glows under the finger, the current page's strip key stays latched down, and the page shell shows the case
  (not a black page) while the fonts load; a fine grain from one inline SVG turbulence (static);
  Archivo (condensed for the case's lettering) loads on phones only (head.html);
- the tube (#tube, built by main.js): the canvas in a beige bezel, with a bloom (the frame drawn at 1/6 size into a second
  canvas, blurred by CSS, screen-blended; one drawImage per changed frame), scanlines, vignette and glass in one CSS overlay,
  and a power-on animation;
- the keyboard (#kb in head.html, `keyboard()` in main.js), which replaces the phone's own: #kbd keeps
  `inputmode="none"` and is never focused by a tap. QWERTY with esc / tab / ctrl / arrows (portrait: a row on top;
  landscape: around the letters), two symbol layers, shift (tap: once, double tap: caps lock, or hold), ctrl (a one-shot
  modifier, or hold), delete and arrows repeat while held (delete held past ~1.5 s goes a word at a time, ctrl+Backspace).
  Space types when it is let go (or as soon as another key is pressed, keeping order); held and slid sideways it is a
  trackpad, an ArrowLeft/Right per ~9 px. Other keys act on pointerdown, one pointer per finger, and send
  KeyboardEvent-shaped objects (`synthetic: true, touchKey: true`) to `term.handleKey`, then `term.handleKeyUp` on release;
  each press and release plays `MAC.sound.key(code, down)` with the key's real code. A strip of function keys above:
  the pages (they fold the keyboard away, for reading), `term.suggest` words while typing, the app's name in an app. The
  keyboard folds down to the strip (its last key; also when a drag reads back up a page), sliding like a tray: one
  WAAPI transform (240 ms down / 260 ms up) with the tube resized once, at the start of a fold and the end of an unfold. It starts folded on the title
  card and folds for every page however it was opened (strip, menu, a tapped word, a typed command); it comes back on a
  tap on the prompt line (or under it; elsewhere a tap is a reader's), its key, or an app that wants letters. Strip pages: about, j, eden, writing (when
  published), contact, links, help; the current one lit.
- every full-screen app gets controls made for it (main.js `PADS`, and the app's `status()`):
  tetris: left / right side by side and soft drop under them for the left thumb, turn either way and hard drop for the
  right, hold and pause above (170 ms / 50 ms auto-shift, held soft drop); snake: the arrows only, four big keys in a cross
  filling the pad, each a turn on touchdown (two queued at most, repeats and reversals ignored), no swipes or taps on the
  field, pause / again / quit on the strip; breakout: two big halves for the paddle (it speeds up while held), serve and pause over them;
  typing: the letters with `,` and `'` in place of `-` and `/`, and the test's speed and keys on the strip; the editor:
  the letters, and its shortcuts of the moment on the strip; timer and clock: the keyboard folds away and their keys sit
  on the strip. Pads swap with the letters (`abc` / `pad`); on a phone on its side a pad's halves sit either side of the
  tube, like a handheld (body.land.gaming). Pad keys never auto-repeat: games time held `touchKey` keys themselves. Touches
  on the tube go to the app's `drag` first (swipes, the paddle).
- 1:1 drag scrolling with momentum and rubber-band ends; a swipe right (and the phone's own back, through one history
  entry) goes `back`; `MAC.toast(label, text)`, which terminal.js calls when it copies an address (never for secrets).
Test hook: with `?debug` in the URL, flat() and room() set `MAC._term` to the terminal. localStorage is swapped for an in-memory store when the browser blocks it (head.html).

## Testing
Build into your own scratch folder: `python3 build.py --out <dir>`. Add `--dev` to include `src/stubs.js`, which
stubs missing modules so each can be tested alone (production builds leave it out).

---------------------------------------------------------------------------------------------------
# View, sound, terminal extensions, reader

## View
There is ONE view: the typist's own eyes (first person). At rest the CRT fills most of the frame and is fully
legible. Moving the pointer looks around like a seated head would: down past the glass's bottom edge (~87% of the
window) leans back to the
whole desk and the hands, a little left/right/up. `setLook(nx, ny)` is the only view control. The typist has no head or torso meshes (the camera is the head); hips/legs never cast shadows.
The visible parts are the forearms, sleeves and hands, so they must look great from above and behind.

## Sound: src/sound.js
```js
MAC.sound = {
  unlock(),                 // call from the first user gesture (keydown / pointerdown)
  key(code, down),          // mechanical key sound for KeyboardEvent.code, on press and release (varies per key, Space/Enter/Shift heavier)
  event(name),              // 'disk' (floppy seek), 'beep' (terminal bell), 'error'
  setMuted(bool), muted,    // remembered in localStorage
}
```
The landing intro is silent (there are no intro sound effects and no music).
With `?debug`, `MAC.sound._dbg = { eng() }`: the live engine.
The typist calls `MAC.sound.key(code, true)` at finger contact and `(code, false)` at release (if MAC.sound exists).
The terminal calls `MAC.sound.event('disk' | 'beep' | 'error')` where it makes sense.

## Terminal extension API (terminal.js implements it; apps.js, extras.js and editor.js use it)
```js
MAC.TERM = { cmds: {}, apps: {} };   // created by terminal.js if missing; apps.js may load after and register

// Plain commands (print to scrollback; support pipes and > / >> redirection through io)
MAC.TERM.cmds[name] = { desc: 'one line', usage: 'name [args]', run(argv, io) }   // may return a Promise
// io = { out(text), err(text), stdin: string, fs, env, cwd, exit(code), sleep(ms), cols, rows, runApp(name, argv) }
//   out/err accept text containing \n. ANSI-ish styling via io.out(text, style) with style one of
//   'dim' | 'bright' | 'faint' | 'accent' | 'inverse'.

// Full-screen apps (vim, games, top...) take over the whole terminal grid until they exit
MAC.TERM.apps[name] = { desc, usage, start(api, argv) -> { key(e) -> bool, tick(dt) -> bool /*dirty*/, render(scr),
                                                          keyUp?(e), insertText?(str) /* phones */, tap?(col, row) -> bool /* phones */,
                                                          drag?(col, row, phase) -> bool /* phones: swipes; true once the gesture is the app's */,
                                                          status?() -> { note, keys } /* phones: state and keys for the strip */ } }
// key events from the phone's keyboard carry touchKey: true (a keyUp always follows; no auto-repeat). A full-screen app
// pauses itself when the tab is hidden (apps.js)
// api = { cols, rows, fs, env, cwd, exit(code), print(text) /* goes to scrollback after exit */, sound: MAC.sound }
// scr = { cols, rows, clear(), put(x, y, text, style /* 'normal'|'dim'|'bright'|'faint'|'accent'|'inverse'|{fg, inverse, inset} */),
//         fill(x, y, w, h, ch, style), cursor(x, y, shape /* 'block'|'bar'|'under'|null */),
//         dot(x, y, r, style), bar(x, y, w, h, style),   // vectors over the grid at FLOAT cell coordinates (dot: centre, radius r in
//                                                         // cell widths, round whatever the cell shape); for things that glide. clear() drops them
//         aspect }                                        // a cell's height / width (about 2.25): to move evenly in screen space

// Virtual filesystem (persisted to localStorage, seeded on first run)
// fs = { resolve(path, cwd) -> abs, exists(p), isDir(p), read(p) -> string|null, write(p, text), append(p, text),
//        list(p) -> [{ name, dir, size, mtime }], mkdir(p), rm(p, recursive), mv(a, b), cp(a, b), stat(p) }
```

## reader.js
```js
MAC.reader = { open(slugOrId) -> bool, close(), isOpen, current /* slug */, posts(), find(q), slugOf(p), sanitize(html) }
```
A DOM sheet over the scene (full screen on phones) for `MAC.CONTENT.writing.posts`
(`{ id, slug, title, subtitle, date, tags, status, summary, html, wordCount, url? }`; published only, newest first;
`url` without `html` opens the link). Deep link `#post/<slug>` (main.js `fromHash`). While open it takes every keydown
(capture phase) so nothing reaches the terminal or the typist; main.js also checks `MAC.reader.isOpen`.
Terminal: `writing` lists posts as a card, `read <slug|n>` / `open post <slug>` open one.
