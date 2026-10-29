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
Test hook: with `?debug` in the URL the scene also exposes `api._dbg = { yawS, pitchS, intro, shot, LOOK, lampS, view() }`
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
MAC.createTerminal({ content, aspect, cols? }) -> {   // cols: 54 on desktop, 40/46 on phones
  canvas,                       // 2D canvas, redrawn only when something changes
  handleKey(e: KeyboardEvent) -> bool,   // true if consumed (call e.preventDefault()); false lets Tab move focus
  handleKeyUp(e),               // passed to a running app's keyUp (games)
  handleTap(u, v) -> bool,      // a click/tap at canvas fractions 0..1: chips, card rows, app tap(col, row)
  insertText(str),              // phones, IME, paste
  update(dt, t) -> bool,        // advance animations (cursor blink, typing-out output); true if canvas changed
  run(cmd),                     // run a command programmatically (#hash deep links)
  scroll(dy),                   // wheel / touch scrollback
  cursorY,                      // bottom of the prompt line, 0..1 of the canvas (phones keep it above the keyboard)
  lum,                          // mean brightness of the last frame drawn, 0..1, tallied while drawing
  busy,                         // an app or command is running (don't rebuild the terminal under it)
  pointer(u, v, down),          // optional: the mouse over the tube (u, v: 0..1 of the canvas, -1, -1 when off it or gone;
                                // down: the main button held). Only the landing uses it: its logo leans toward the pointer
                                // and a drag spins it. main.js calls it from pointermove (both layouts) and on leave
}
```
The landing (every load, until the first command; deep links skip it) is a demoscene-style intro drawn on the canvas:
a title card, then an extruded vector "KN" over copper bars, a starfield and a perspective floor, with a sine scroller of
`MAC.CONTENT` facts. Keys typed while it shows flash a bar and kick the logo; reduced motion gets one still frame. It
animates at 30 fps through the viz `live` mechanism and stops when dismissed, scrolled off, or the reader is open.

## main.js (integrator)
Creates the scene, terminal and typist; routes keydown/keyup to terminal + typist; text input through the hidden
#kbd field (all devices, so assistive tech has a real input); clicks on the tube go through `api.pickScreen` to
`term.handleTap`. Hash deep links: #about #eden #j #writing #contact #links #help, and #post/<slug> for the reader
(anything else in the hash is ignored). One rAF loop, paused when hidden and while the reader is open.
`flat()` is the terminal-only layout: phones, and desktops without WebGL or three.js, after a context loss or
repeated render errors. localStorage is swapped for an in-memory store when the browser blocks it (head.html).

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
                                                          keyUp?(e), insertText?(str) /* phones */, tap?(col, row) -> bool /* phones */ } }
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
