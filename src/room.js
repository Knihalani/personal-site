/* Room dressing: the things a real desk corner collects. Built once, added through the scene API.
   Everything sits on the right-hand wall and desk corner (the window owns the left) so it frames the
   screen at the edges of the first-person view and rewards looking around.
   Units are metres; the desk top is y = 0.75, the back wall z = -0.48, the computer sits at x ~ 0. */
(() => {
'use strict';
const M = window.MAC = window.MAC || {};
M.dressRoom = function (api){
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const rig = api.rig || {};
  const DESK_Y = rig.deskTop || .75, WALL_Z = rig.wallZ || -.48;
  const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
  const group = new THREE.Group(); group.name = 'room-dressing';
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  /* ---------- helpers ---------- */
  function rrect(w, h, r){ const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s; }
  // a box with softly rounded vertical edges and a small bevel on the faces: reads as made, not primitive
  function softBox(w, h, d, r, bevel){
    const b = Math.min(bevel || r * .5, Math.min(w, h, d) * .2);
    const g = new THREE.ExtrudeGeometry(rrect(w - 2 * b, d - 2 * b, Math.max(.0005, r - b)), { depth: h - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 3, curveSegments: 6 });
    g.rotateX(-Math.PI / 2); g.translate(0, -h / 2 + b, 0); g.computeVertexNormals(); return g;
  }
  // painted once: when the GPU has the pixels, the canvas gives its memory back (keep: the clock face, redrawn every second)
  function canvasTex(w, h, draw, repeat, keep){ const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; if (repeat){ t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    if (!keep) t.onUpdate = () => { if (t.userData.wait) return; t.onUpdate = null; c.width = c.height = 1; };
    return t; }
  // textures lettered in a web font (Caveat, IBM Plex Mono) are painted now with whatever is loaded, then repainted
  // once the font arrives, so a slow font never leaves a note in the fallback hand
  const fontJobs = [];
  function fontTex(w, h, draw){ const t = canvasTex(w, h, draw); t.userData.wait = true;   // (its canvas is kept until the repaint)
    fontJobs.push(() => { const c = t.image, x = c.getContext('2d'); x.clearRect(0, 0, w, h); draw(x, w, h); t.userData.wait = false; t.needsUpdate = true; }); return t; }
  function noiseFill(x, w, h, base, amt, n){ x.fillStyle = base; x.fillRect(0, 0, w, h); for (let i = 0; i < n; i++){ const a = rnd() * amt; x.fillStyle = rnd() < .5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a * .6})`; x.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2); } }
  // one material per look: identical calls share it, so the meshes can be merged into one draw (api.mergeStatic)
  const mats = new Map();
  const mat = (hex, o) => { const k = hex + JSON.stringify(o || {}); let m = mats.get(k);
    if (!m) mats.set(k, m = new THREE.MeshStandardMaterial(Object.assign({ color: lin(hex), roughness: .7, metalness: 0 }, o || {}))); return m; };
  /* built in sections after the first frame (api.defer: the room is dark while the tube powers on), so start-up
     stays short; each section is one slice of work */
  const later = f => api.defer ? api.defer(f) : f();
  api.add(group);
  function mesh(g, m, parent, x, y, z){ const o = new THREE.Mesh(g, m); o.position.set(x || 0, y || 0, z || 0); o.castShadow = true; o.receiveShadow = true; (parent || group).add(o); return o; }

  /* ---------- wood: one walnut-ish material shared by shelf and frames ---------- */
  const woodTex = canvasTex(512, 128, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#5a3a22'); g.addColorStop(1, '#4a2f1b'); x.fillStyle = g; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++){ const y0 = rnd() * h, a = .05 + rnd() * .12; x.strokeStyle = rnd() < .5 ? `rgba(30,16,8,${a})` : `rgba(140,96,60,${a})`; x.lineWidth = .5 + rnd() * 1.6;
      x.beginPath(); x.moveTo(0, y0); for (let u = 0; u <= w; u += 16) x.lineTo(u, y0 + Math.sin(u * .013 + i) * 3 + Math.sin(u * .05 + i * 3) * 1.2); x.stroke(); }
  }, true);
  const wood = new THREE.MeshStandardMaterial({ map: woodTex, roughness: .55, metalness: 0 });
  /* page edges: the fore-edge of a book is a stack of paper, not a painted block. Fine uneven lines, slightly
     yellowed toward the outside; one texture, turned for books standing (lines run up the top face) or lying flat */
  const pageTex = vertical => { const t = canvasTex(64, 64, (x, W, H) => { x.fillStyle = '#e9e0c9'; x.fillRect(0, 0, W, H);
      for (let i = 0; i < 64; i += 1 + (rnd() * 2 | 0)){ x.fillStyle = `rgba(${rnd() < .5 ? '120,100,70' : '255,250,235'},${.08 + rnd() * .18})`; vertical ? x.fillRect(i, 0, 1, H) : x.fillRect(0, i, W, 1); } }, true);
    t.repeat.set(vertical ? 3 : 1, vertical ? 1 : 3); return t; };
  const pagesUp = new THREE.MeshStandardMaterial({ map: pageTex(true), roughness: .95 }), pagesFlat = new THREE.MeshStandardMaterial({ map: pageTex(false), roughness: .95 });

  /* ================= floating shelf with books, a cassette deck's worth of tapes, a cactus ================= */
  later(() => {
  const SH = { x: .5, y: 1.47, w: .56, d: .17, t: .022 };
  const shelf = new THREE.Group(); shelf.position.set(SH.x, SH.y, WALL_Z + SH.d / 2 + .002); group.add(shelf);
  mesh(softBox(SH.w, SH.t, SH.d, .004, .003), wood, shelf);
  const brassM = mat('#8a6a3a', { metalness: .85, roughness: .35 });
  for (const sx of [-1, 1]){ // L brackets, black steel with a brass screw head
    const br = mesh(softBox(.012, .07, .004, .001, .0008), mat('#141414', { metalness: .6, roughness: .45 }), shelf, sx * (SH.w / 2 - .07), -SH.t / 2 - .035, -SH.d / 2 + .003);
    mesh(softBox(.012, .004, .11, .001, .0008), br.material, shelf, sx * (SH.w / 2 - .07), -SH.t / 2 - .002, -SH.d / 2 + .055);
    mesh(new THREE.CylinderGeometry(.0028, .0028, .002, 12).rotateX(Math.PI / 2), brassM, shelf, sx * (SH.w / 2 - .07), -SH.t / 2 - .05, -SH.d / 2 + .006);
  }
  // books: varied heights, spines with lettering, a lean at the end
  const SPINES = [['#2f3d55', 'FIELD GUIDE'], ['#7a2e22', 'NOTES'], ['#c9b48a', 'SYSTEMS'], ['#1f3a2e', 'THE GARDEN'], ['#d8cdb4', 'SIGNALS'], ['#44312a', 'ATLAS'], ['#9a6a2a', 'ON WRITING']];
  let bx = -SH.w / 2 + .03;
  SPINES.forEach(([col, title], i) => {
    const h = .17 + rnd() * .055, w = .022 + rnd() * .018, d = .12 + rnd() * .025, lean = i === SPINES.length - 1 ? -.32 : 0;
    const spine = canvasTex(64, 256, (x, W, H) => { noiseFill(x, W, H, col, .08, 900);
      x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(0, 18, W, 3); x.fillRect(0, H - 22, W, 3);
      x.save(); x.translate(W / 2 + 6, H / 2); x.rotate(-Math.PI / 2); x.fillStyle = new THREE.Color(col).getHSL({}).l > .5 ? '#2a2420' : '#e8dcc0';
      x.font = '600 22px Georgia, serif'; x.textAlign = 'center'; x.fillText(title, 0, 0); x.restore(); });
    const cover = mat(col, { roughness: .8 }), pages = pagesUp;
    const spineM = new THREE.MeshStandardMaterial({ map: spine, roughness: .75 });
    // BoxGeometry face order: +x, -x, +y, -y, +z, -z  ->  covers on the sides, pages on top/back, spine on the front (+z)
    const b = mesh(new THREE.BoxGeometry(w, h, d), [cover, cover, pages, pages, spineM, pages], shelf);
    const bxw = lean ? Math.sin(-lean) * h * .5 + w / 2 : w / 2;
    b.position.set(bx + bxw, SH.t / 2 + (lean ? Math.cos(lean) * h / 2 : h / 2), -SH.d / 2 + d / 2 + .01); b.rotation.z = lean;
    bx += lean ? w + Math.sin(-lean) * h : w + .0015;
  });
  // three cassette tapes stacked flat, labels hand-written
  const tapeLabel = t => fontTex(256, 64, (x, W, H) => { x.fillStyle = '#efe6cf'; x.fillRect(0, 0, W, H); x.fillStyle = '#c4492d'; x.fillRect(0, 0, W, 9);
    x.fillStyle = '#20304f'; x.font = '500 30px Caveat, "Segoe Print", cursive'; x.fillText(t, 10, 46); });
  // smoked clear plastic. Not a transmission material: one of those makes three.js render the whole scene a second
  // time, every frame the shelf is in view
  const tapeM = new THREE.MeshPhysicalMaterial({ color: lin('#b9bec4'), roughness: .12, clearcoat: .8, clearcoatRoughness: .1, transparent: true, opacity: .62 });
  ['mixtape · spring', 'late night', 'side b'].forEach((t, i) => {
    const c = new THREE.Group(); c.position.set(SH.w / 2 - .085, SH.t / 2 + .0085 + i * .0172, -SH.d / 2 + .075); c.rotation.y = (rnd() - .5) * .25; shelf.add(c);
    mesh(softBox(.109, .017, .07, .0015, .001), tapeM, c);
    const lb = mesh(new THREE.PlaneGeometry(.1, .016), new THREE.MeshStandardMaterial({ map: tapeLabel(t), roughness: .8 }), c, 0, 0, .0352);
    lb.castShadow = false;
  });
  // a small cactus in a terracotta pot
  { const pot = new THREE.Group(); pot.position.set(SH.w / 2 - .08, SH.t / 2, -SH.d / 2 + .075 + 0); shelf.add(pot); pot.position.x -= .002; pot.position.z += 0;
    const prof = [V3(0, 0, 0), V3(.026, 0, 0), V3(.031, .045, 0), V3(.034, .048, 0), V3(.034, .056, 0), V3(.03, .056, 0)].map(v => new THREE.Vector2(v.x, v.y));
    pot.position.set(-SH.w / 2 + .3 - .02, SH.t / 2, -SH.d / 2 + .07);
    const tc = mesh(new THREE.LatheGeometry(prof, 32), mat('#a8553a', { roughness: .9 }), pot); tc.material.side = THREE.DoubleSide;
    mesh(new THREE.CylinderGeometry(.029, .029, .004, 24), mat('#2a1d14', { roughness: 1 }), pot, 0, .05, 0);
    const cac = mat('#3f6a48', { roughness: .6 });
    const body = new THREE.SphereGeometry(.02, 24, 18); body.scale(1, 2.1, 1);
    const pos = body.attributes.position; for (let i = 0; i < pos.count; i++){ const x = pos.getX(i), z = pos.getZ(i), a = Math.atan2(z, x), k = 1 + .09 * Math.cos(a * 8); pos.setX(i, x * k); pos.setZ(i, z * k); } body.computeVertexNormals();
    mesh(body, cac, pot, 0, .092, 0);
    const arm = body.clone(); arm.scale(.55, .5, .55); const a1 = mesh(arm, cac, pot, .02, .1, 0); a1.rotation.z = -.5;
  }

  });
  /* ================= cork board with pinned cards, under the shelf ================= */
  later(() => {
  const CB = { x: .5, y: 1.16, w: .4, h: .27 };
  const board = new THREE.Group(); board.position.set(CB.x, CB.y, WALL_Z + .012); group.add(board);
  const cork = canvasTex(512, 352, (x, W, H) => { noiseFill(x, W, H, '#a87a4c', .22, 26000);
    for (let i = 0; i < 2200; i++){ x.fillStyle = `rgba(${rnd() < .5 ? '70,40,18' : '210,170,120'},${.15 + rnd() * .25})`; x.beginPath(); x.arc(rnd() * W, rnd() * H, .6 + rnd() * 1.8, 0, 6.28); x.fill(); } });
  mesh(new THREE.BoxGeometry(CB.w, CB.h, .012), [wood, wood, wood, wood, new THREE.MeshStandardMaterial({ map: cork, roughness: .95 }), wood], board);
  for (const [w, h, x, y] of [[CB.w + .03, .016, 0, CB.h / 2 + .008], [CB.w + .03, .016, 0, -CB.h / 2 - .008], [.016, CB.h, -CB.w / 2 - .008, 0], [.016, CB.h, CB.w / 2 + .008, 0]])
    mesh(softBox(w, h, .022, .003, .002), wood, board, x, y, .004);
  const card = (txt, col, w, h, x, y, rot, pin) => {
    const t = fontTex(256, Math.round(256 * h / w), (c, W, H) => { noiseFill(c, W, H, col, .05, 800);
      if (col === '#f3ecd9'){ c.strokeStyle = 'rgba(80,120,170,.35)'; c.lineWidth = 1; for (let yy = 40; yy < H; yy += 22){ c.beginPath(); c.moveTo(0, yy); c.lineTo(W, yy); c.stroke(); } c.strokeStyle = 'rgba(200,70,60,.4)'; c.beginPath(); c.moveTo(0, 30); c.lineTo(W, 30); c.stroke(); }
      // shrink the hand to fit the longest line and the line count, so any note from content.js fits its card
      const ls = txt.split('\n'); let fs = 34;
      const fit = () => { c.font = '500 ' + fs + 'px Caveat, "Segoe Print", cursive'; return Math.max(...ls.map(l => c.measureText(l).width)) <= W - 26 && 24 + ls.length * fs * 1.06 <= H - 8; };
      while (fs > 16 && !fit()) fs -= 1;
      c.fillStyle = '#23324f'; ls.forEach((l, i) => c.fillText(l, 16, 24 + fs + i * fs * 1.06)); });
    const g = new THREE.PlaneGeometry(w, h, 6, 4); const p = g.attributes.position; // a slight curl at the free corner
    for (let i = 0; i < p.count; i++){ const u = p.getX(i) / w + .5, v = p.getY(i) / h + .5; p.setZ(i, .004 * Math.pow(Math.max(0, u * (1 - v)), 2.2) + .0015); } g.computeVertexNormals();
    const m = mesh(g, new THREE.MeshStandardMaterial({ map: t, roughness: .9, side: THREE.DoubleSide }), board, x, y, .007); m.rotation.z = rot;
    const pinM = mat(pin, { roughness: .35 });
    const pn = new THREE.Group(); pn.position.set(x + Math.sin(-rot) * h * .38, y + Math.cos(rot) * h * .38, .009); board.add(pn);
    mesh(new THREE.CylinderGeometry(.0006, .0006, .008, 6).rotateX(Math.PI / 2), mat('#bbbbbb', { metalness: 1, roughness: .2 }), pn, 0, 0, .002);
    mesh(new THREE.CylinderGeometry(.0035, .0045, .006, 16).rotateX(Math.PI / 2), pinM, pn, 0, 0, .007);
    mesh(new THREE.SphereGeometry(.0046, 16, 12), pinM, pn, 0, 0, .011);
  };
  const NOTES = ((window.MAC.CONTENT || {}).notes || []).concat(['', '', '', '']);   // the four pinned notes come from content.js
  card(NOTES[0] || 'ship it.\nthen ship\nthe next one', '#f3ecd9', .12, .085, -.12, .05, .04, '#c4492d');
  card(NOTES[1] || 'ask better\nquestions', '#f2d65a', .075, .075, .02, .07, -.07, '#2f5aa0');
  card(NOTES[2] || 'sleep >\ncoffee', '#f2a7a0', .07, .07, .13, -.03, .09, '#2b7a4b');
  card(NOTES[3] || 'call home', '#9fd3c7', .075, .055, -.05, -.07, -.05, '#d9a400');
  // a little photo: dusk over a city, with a white border
  { const ph = canvasTex(256, 200, (c, W, H) => { c.fillStyle = '#f4f0e6'; c.fillRect(0, 0, W, H);
      const g = c.createLinearGradient(0, 12, 0, H - 40); g.addColorStop(0, '#2b3e6b'); g.addColorStop(.6, '#d9785a'); g.addColorStop(1, '#f2c38a'); c.fillStyle = g; c.fillRect(12, 12, W - 24, H - 52);
      c.fillStyle = '#1b1b22'; for (let i = 0; i < 18; i++){ const bw = 8 + rnd() * 16, bh = 20 + rnd() * 60; c.fillRect(12 + i * 13, H - 40 - bh, bw, bh); } });
    const p = mesh(new THREE.PlaneGeometry(.075, .059), new THREE.MeshStandardMaterial({ map: ph, roughness: .45 }), board, .135, .075, .008); p.rotation.z = -.06;
    mesh(new THREE.CylinderGeometry(.0035, .0045, .006, 16).rotateX(Math.PI / 2), mat('#e7e2d4', { roughness: .4 }), board, .135, .1, .011); }

  });
  /* ================= framed print, right wall edge: a quiet orbital diagram ================= */
  later(() => {
  { const FR = { x: .92, y: 1.33, w: .2, h: .27 };
    const art = fontTex(320, 432, (c, W, H) => { c.fillStyle = '#ece4d3'; c.fillRect(0, 0, W, H); c.fillStyle = '#e3d9c3'; c.fillRect(28, 28, W - 56, H - 56);
      c.strokeStyle = '#2a2a2a'; c.lineWidth = 1.2; const cx = W / 2, cy = H * .46;
      for (let r = 26; r < 120; r += 22){ c.beginPath(); c.ellipse(cx, cy, r, r * .42, -.35, 0, 6.28); c.stroke(); }
      c.fillStyle = '#c4492d'; c.beginPath(); c.arc(cx, cy, 9, 0, 6.28); c.fill();
      c.fillStyle = '#2a2a2a'; for (let r = 26, i = 0; r < 120; r += 22, i++){ const a = i * 1.7; c.beginPath(); c.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r * .42, 3, 0, 6.28); c.fill(); }
      c.font = '500 12px "IBM Plex Mono", monospace'; c.textAlign = 'center'; c.fillText('ORRERY · PLATE IV', cx, H - 48); });
    const f = new THREE.Group(); f.position.set(FR.x, FR.y, WALL_Z + .012); group.add(f);
    const fm = mat('#1a1715', { roughness: .45 });
    for (const [w, h, x, y] of [[FR.w + .024, .018, 0, FR.h / 2 + .006], [FR.w + .024, .018, 0, -FR.h / 2 - .006], [.018, FR.h + .03, -FR.w / 2 - .006, 0], [.018, FR.h + .03, FR.w / 2 + .006, 0]])
      mesh(softBox(w, h, .024, .002, .0015), fm, f, x, y, 0);
    mesh(new THREE.PlaneGeometry(FR.w, FR.h), new THREE.MeshStandardMaterial({ map: art, roughness: .9 }), f, 0, 0, -.004);
    const glass = mesh(new THREE.PlaneGeometry(FR.w, FR.h), new THREE.MeshPhysicalMaterial({ roughness: .05, transparent: true, opacity: .12, clearcoat: 1, metalness: 0, color: 0xffffff }), f, 0, 0, .006); glass.castShadow = false;
  }

  });
  /* ================= desk corner: a stack of books with a small radio clock on top ================= */
  later(() => {
  // close in beside the machine's right shoulder (behind the mug), turned toward the chair, so the amber readout sits at
  // the right of the lean-back view against the dark wall
  { const st = new THREE.Group(); st.position.set(.345, DESK_Y, -.3); st.rotation.y = -.25; group.add(st);
    let y = 0; [['#3b4a3a', .24, .17, .028], ['#8c3b2c', .23, .16, .024], ['#d6caa9', .21, .15, .02]].forEach(([col, w, d, h], i) => {
      const pages = pagesFlat, cov = mat(col, { roughness: .75 });
      const b = mesh(new THREE.BoxGeometry(w, h, d), [cov, pages, cov, cov, pages, pages], st, (rnd() - .5) * .01, y + h / 2, (rnd() - .5) * .01); b.rotation.y = (rnd() - .5) * .12; y += h; });
    // radio clock: cream plastic, a perforated speaker grille on the left, a dim amber vacuum-fluorescent-ish
    // seven-segment readout on the right (drawn as segments, so it never depends on a web font)
    const rc = new THREE.Group(); rc.position.set(0, y, .01); rc.rotation.y = -.13; st.add(rc);
    mesh(softBox(.15, .062, .07, .012, .004), mat('#d6c8a8', { roughness: .55 }), rc, 0, .031, 0);
    const grille = canvasTex(160, 112, (c, W, H) => { c.fillStyle = '#b3a587'; c.fillRect(0, 0, W, H);
      // a recessed panel edge, then a hex grid of round holes
      c.strokeStyle = 'rgba(60,48,32,.45)'; c.lineWidth = 4; c.strokeRect(2, 2, W - 4, H - 4);
      for (let r = 0, yy = 12; yy < H - 8; yy += 8.5, r++) for (let xx = 12 + (r & 1) * 4.5; xx < W - 9; xx += 9){
        c.fillStyle = '#1c1712'; c.beginPath(); c.arc(xx, yy, 2.5, 0, 6.28); c.fill();
        c.fillStyle = 'rgba(255,245,220,.25)'; c.beginPath(); c.arc(xx + .6, yy + 1.4, 2.5, .2, 2.9); c.fill(); } });
    mesh(new THREE.PlaneGeometry(.056, .04), new THREE.MeshStandardMaterial({ map: grille, roughness: .7 }), rc, -.036, .031, .0352).castShadow = false;
    const SEG = { a: [0, 0, 1, 0], b: [1, 0, 1, 1], c: [1, 1, 1, 2], d: [0, 2, 1, 2], e: [0, 1, 0, 2], f: [0, 0, 0, 1], g: [0, 1, 1, 1] };
    const DIG = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];
    const face = canvasTex(256, 96, () => {}, false, true);
    const draw = () => { const d = new Date(), hh = d.getHours(), mm = d.getMinutes(), c = face.image.getContext('2d');
      c.fillStyle = '#0d0905'; c.fillRect(0, 0, 256, 96);
      const digits = [hh >= 10 ? (hh / 10 | 0) : -1, hh % 10, mm / 10 | 0, mm % 10], X = [20, 70, 140, 190];
      c.lineCap = 'round'; c.lineWidth = 7;
      digits.forEach((n, i) => { for (const k in SEG){ const [x0, y0, x1, y1] = SEG[k], on = n >= 0 && DIG[n].includes(k);
          c.strokeStyle = on ? '#e8a24a' : 'rgba(120,80,30,.08)'; c.shadowColor = '#d98a2b'; c.shadowBlur = on ? 6 : 0;
          const sk = .12, px = v => X[i] + v * 36, py = v => 14 + v * 34;
          c.beginPath(); c.moveTo(px(x0 + .08 * (x1 - x0)) - sk * py(y0) + 6, py(y0 + .06 * (y1 - y0))); c.lineTo(px(x1 - .08 * (x1 - x0)) - sk * py(y1) + 6, py(y1 - .06 * (y1 - y0))); c.stroke(); } });
      c.shadowBlur = 0; c.fillStyle = d.getSeconds() & 1 ? '#e8a24a' : 'rgba(120,80,30,.12)';
      for (const yy of [36, 62]){ c.beginPath(); c.arc(122, yy, 3.6, 0, 6.28); c.fill(); }
      face.needsUpdate = true; };
    const disp = mesh(new THREE.PlaneGeometry(.07, .028), new THREE.MeshStandardMaterial({ map: face, emissive: lin('#ffffff'), emissiveMap: face, emissiveIntensity: .32, roughness: .3 }), rc, .028, .033, .0352);
    disp.castShadow = false;
    // keep the clock honest: it shows the visitor's own time
    draw(); setInterval(draw, 1000);
    mesh(softBox(.016, .008, .016, .003, .002), mat('#b9ad90', { roughness: .5 }), rc, .055, .066, 0);
  }

  });
  /* ================= heavy linen curtains framing the window ================= */
  later(() => {
  { const R = rig.windowRect, WIN = R ? { x: R.x + R.w / 2, y: R.y + R.h / 2, w: R.w, h: R.h } : { x: -.58, y: 1.42, w: .8, h: .84 }; // rig gives the lower-left corner
    const cloth = canvasTex(256, 256, (c, W, H) => { noiseFill(c, W, H, '#3b4250', .12, 9000); c.strokeStyle = 'rgba(255,255,255,.04)'; for (let i = 0; i < W; i += 3){ c.beginPath(); c.moveTo(i, 0); c.lineTo(i, H); c.stroke(); } }, true);
    const cm = new THREE.MeshStandardMaterial({ map: cloth, roughness: .95, side: THREE.DoubleSide });
    for (const side of [-1, 1]){
      const w = .22, h = WIN.h + .5, g = new THREE.PlaneGeometry(w, h, 40, 30), p = g.attributes.position;
      for (let i = 0; i < p.count; i++){ const x = p.getX(i), y = p.getY(i), v = (y + h / 2) / h;
        const gather = .55 + .45 * Math.pow(v, 1.5); p.setX(i, x * gather + side * (1 - gather) * .05);
        p.setZ(i, .018 * Math.sin((x / w) * Math.PI * 7) * (.6 + .4 * v) + .006 * Math.sin(y * 9)); }
      g.computeVertexNormals();
      mesh(g, cm, group, WIN.x + side * (WIN.w / 2 + .03), WIN.y + .05, WALL_Z + .05);
    }
    // the rod
    mesh(new THREE.CylinderGeometry(.007, .007, WIN.w + .55, 16).rotateZ(Math.PI / 2), mat('#1c1a18', { metalness: .6, roughness: .4 }), group, WIN.x, WIN.y + WIN.h / 2 + .3, WALL_Z + .05);
  }

  });
  /* ================= the computer's power cable, drooping off the back of the desk ================= */
  later(() => {
  { const pts = [V3(.08, DESK_Y + .03, -.31), V3(.12, DESK_Y + .004, -.38), V3(.2, DESK_Y + .002, -.44), V3(.26, DESK_Y - .1, -.47), V3(.28, .2, -.47), V3(.33, 0, -.44)];
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, .0035, 8), mat('#d8cfb8', { roughness: .6 }), group); }
  });
  later(() => { if (api.mergeStatic) api.mergeStatic(group); });
  if (document.fonts && document.fonts.load){
    Promise.all([document.fonts.load('500 30px Caveat'), document.fonts.load('500 12px "IBM Plex Mono"')])
      .then(() => { for (const f of fontJobs) f(); if (api.markScreenDirty) api.markScreenDirty(); }, () => {});
  }
  return group;
};
})();
