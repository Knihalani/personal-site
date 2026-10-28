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
