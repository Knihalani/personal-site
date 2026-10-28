# Kaiav's desk: module contract

The site is one 3D scene: a night room, a warm desk lamp, a beige 1980s compact all-in-one computer whose
CRT shows a working terminal, a keyboard on the desk, and the silhouette of a person typing on it. When the
visitor types, the silhouette's hands press the same keys on the 3D keyboard, and the keys go down.

Files in `src/` are concatenated into one page by `build.py` (see ORDER there). three.js r147 is loaded as
the global `THREE` from `https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js`. Addons, if needed,
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
    screenCenter: THREE.Vector3,
  },
  add(obj3d),
  setView(name),                // 'scene' (cinematic over-the-shoulder) | 'screen' (dolly in so the terminal fills the view)
  setPointer(nx, ny),           // -1..1, subtle camera parallax
  pickScreen(clientX, clientY) -> {u, v} | null,   // raycast to the CRT glass; u, v are 0..1 from the TOP-LEFT of the
                                // terminal canvas (barrel bow and overscan inset accounted for); null off the image
  update(dt, t),
  render(),
  resize(w, h),
}
```

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
MAC.createTerminal({ content, aspect }) -> {
  canvas,                       // 2D canvas, redrawn only when something changes
  handleKey(e: KeyboardEvent) -> bool,   // true if consumed (call e.preventDefault())
  insertText(str),              // for mobile / IME input
  update(dt, t) -> bool,        // advance animations (cursor blink, typing-out output); true if canvas changed
  run(cmd),                     // run a command programmatically (used for #hash deep links)
}
```

## main.js (integrator)
Creates the scene, terminal and typist; routes keydown/keyup to terminal + typist; mobile input via a hidden
textarea; hash deep links (#eden, #j, #about, #writing run the matching command); one rAF loop; pause when hidden.

## Testing
Build into your own scratch folder: `python3 build.py --out <dir>`. Missing modules are stubbed by
`src/stubs.js`, so each module can be tested alone.

---------------------------------------------------------------------------------------------------
# v2 additions (POV-only, full terminal, sound)

## View
There is ONE view: the typist's own eyes (first person). At rest the CRT fills most of the frame and is fully
legible. Moving the pointer looks around like a seated head would: down (up to ~35°) to watch the hands type
on the keyboard, a little left/right/up. On touch, a drag looks around and springs back. `setView` is gone;
`setLook(nx, ny)` replaces `setPointer` (nx, ny in -1..1, from the pointer position; 0,0 = looking at the screen).
The typist's head/hair/torso must not intrude into the camera (hide head meshes or keep them behind the near plane).
The visible parts are the forearms, sleeves and hands, so they must look great from above and behind.

## Sound: src/sound.js
```js
MAC.sound = {
  unlock(),                 // call from the first user gesture (keydown / pointerdown)
  key(code, down),          // mechanical key sound for KeyboardEvent.code, on press and release (varies per key, Space/Enter/Shift heavier)
  event(name),              // 'boot' (CRT power-on thunk + degauss + whine), 'disk' (floppy seek), 'beep' (terminal bell), 'error'
  setMuted(bool), muted,    // remembered in localStorage
  update(dt),               // room tone, CRT whine fades
}
```
The typist calls `MAC.sound.key(code, true)` at finger contact and `(code, false)` at release (if MAC.sound exists).
The terminal calls `MAC.sound.event('disk' | 'beep' | 'error')` where it makes sense.

## Terminal extension API (terminal.js implements it; apps.js uses it)
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
// scr = { cols, rows, clear(), put(x, y, text, style /* 'normal'|'dim'|'bright'|'faint'|'accent'|'inverse'|{fg, inverse} */),
//         fill(x, y, w, h, ch, style), cursor(x, y, shape /* 'block'|'bar'|'under'|null */) }

// Virtual filesystem (persisted to localStorage, seeded on first run)
// fs = { resolve(path, cwd) -> abs, exists(p), isDir(p), read(p) -> string|null, write(p, text), append(p, text),
//        list(p) -> [{ name, dir, size, mtime }], mkdir(p), rm(p, recursive), mv(a, b), cp(a, b), stat(p) }
```
