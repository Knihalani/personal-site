/* scene.js: the room, the machine, the keyboard and the light. Implements MAC.createScene (see CONTRACT.md).
   Units are metres. The desk top is at y = 0.75; the typist faces -z; the wall is behind the computer.
   Everything procedural is built once at start-up: no image files, no addons. */
(function sceneModule(){
'use strict';
const M = window.MAC = window.MAC || {};
if (typeof THREE === 'undefined'){ M.loadScene = sceneModule; return; }   // three.js loads async (head.html): main.js runs this again once it is here

/* Phosphor: soft green, a desaturated, slightly minty P1. Amber would melt into the room, because the only other
   light is a 2700K lamp. Green sits opposite it on the colour wheel, so the tube separates from the room and the
   typist gets a two-tone key and fill: warm lamp from the left, cool green screen from the front. P1 green is also
   the brightest-feeling phosphor for small text, which keeps the terminal readable. */
const PHOSPHOR = [0.60, 1.00, 0.70];

const V3 = THREE.Vector3;
const DESK_Y = 0.75;
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lin = hex => new THREE.Color(hex).convertSRGBToLinear();

/* ---------- noise ---------- */
const PERM = (() => { const p = new Uint8Array(512), a = []; let s = 1337;
  for (let i = 0; i < 256; i++) a.push(i);
  for (let i = 255; i > 0; i--){ s = (s * 16807) % 2147483647; const j = s % (i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; }
  for (let i = 0; i < 512; i++) p[i] = a[i & 255]; return p; })();
const hash = (i, j) => PERM[(PERM[i & 255] + j) & 255] / 255;
function vnoise(x, y){
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, o = 4){ let s = 0, a = .5, f = 1, n = 0; for (let i = 0; i < o; i++){ s += a * vnoise(x * f, y * f); n += a; a *= .5; f *= 2.03; } return s / n; }
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

/* ---------- canvas textures ---------- */
function cnv(w, h){ const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(c, srgb = true, aniso = 4){ const t = new THREE.CanvasTexture(c); if (srgb) t.encoding = THREE.sRGBEncoding; t.anisotropy = aniso; return t; }
/* Per-pixel painter: f(u, v, out) writes rgb 0..1 into out[0..2] and an optional height into out[3]. */
function paint(w, h, f, withHeight){
  const [c, x] = cnv(w, h), img = x.createImageData(w, h), d = img.data;
  let hc, hx, himg, hd;
  if (withHeight){ [hc, hx] = cnv(w, h); himg = hx.createImageData(w, h); hd = himg.data; }
  const o = [0, 0, 0, .5];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++){
    o[3] = .5; f(i / (w - 1), 1 - j / (h - 1), o); const k = (j * w + i) * 4;
    d[k] = clamp(o[0], 0, 1) * 255; d[k + 1] = clamp(o[1], 0, 1) * 255; d[k + 2] = clamp(o[2], 0, 1) * 255; d[k + 3] = 255;
    if (hd){ const g = clamp(o[3], 0, 1) * 255; hd[k] = hd[k + 1] = hd[k + 2] = g; hd[k + 3] = 255; }
  }
  x.putImageData(img, 0, 0); if (hx) hx.putImageData(himg, 0, 0);
  return withHeight ? [c, hc] : c;
}
/* signed distance to a rounded rectangle centred at the origin */
function sdRR(x, y, hw, hh, r){ const qx = Math.abs(x) - hw + r, qy = Math.abs(y) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r; }

/* ---------- geometry helpers ---------- */
/* Rounded box with k arc segments per edge and m interior segments per axis. Face-aware UVs are proportional to
   position (so painted textures line up with deformations), and deform(v, face, u, v) can sculpt it. */
function roundedBox(w, h, d, r, k, m = [1, 1, 1], deform){
  const g = new THREE.BoxGeometry(w, h, d, 2 * k + m[0], 2 * k + m[1], 2 * k + m[2]);
  const P = g.attributes.position, N = g.attributes.normal, UV = g.attributes.uv, n = P.count;
  const H = [w / 2, h / 2, d / 2], face = new Int8Array(n), v = new V3(), inner = new V3(), dl = new V3();
  const remap = (c, ax) => { const hh = H[ax], segs = 2 * k + m[ax], i = Math.round((c + hh) / (2 * hh) * segs);
    if (i <= k) return -hh + r * i / k; if (i >= segs - k) return hh - r * (segs - i) / k; return -hh + r + (2 * hh - 2 * r) * (i - k) / m[ax]; };
  for (let i = 0; i < n; i++){
    const nx = N.getX(i), ny = N.getY(i), nz = N.getZ(i);
    const f = nx > .5 ? 0 : nx < -.5 ? 1 : ny > .5 ? 2 : ny < -.5 ? 3 : nz > .5 ? 4 : 5; face[i] = f;
    const x = remap(P.getX(i), 0), y = remap(P.getY(i), 1), z = remap(P.getZ(i), 2);
    let u, vv;
    switch (f){
      case 0: u = (H[2] - z) / d; vv = (y + H[1]) / h; break;
      case 1: u = (z + H[2]) / d; vv = (y + H[1]) / h; break;
      case 2: u = (x + H[0]) / w; vv = (H[2] - z) / d; break;
      case 3: u = (x + H[0]) / w; vv = (z + H[2]) / d; break;
      case 4: u = (x + H[0]) / w; vv = (y + H[1]) / h; break;
      default: u = (H[0] - x) / w; vv = (y + H[1]) / h;
    }
    UV.setXY(i, u, vv);
    v.set(x, y, z); inner.set(clamp(x, -H[0] + r, H[0] - r), clamp(y, -H[1] + r, H[1] - r), clamp(z, -H[2] + r, H[2] - r));
    dl.subVectors(v, inner); if (dl.lengthSq() > 1e-14) v.copy(inner).addScaledVector(dl.normalize(), r);
    if (deform) deform(v, f, u, vv);
    P.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals(); weldNormals(g); g.userData.face = face; return g;
}
/* average normals of coincident vertices so the six faces of a rounded box shade as one surface */
function weldNormals(g){
  const P = g.attributes.position, N = g.attributes.normal, map = new Map(), keys = new Array(P.count);
  for (let i = 0; i < P.count; i++){
    const k = Math.round(P.getX(i) * 1e5) + '_' + Math.round(P.getY(i) * 1e5) + '_' + Math.round(P.getZ(i) * 1e5); keys[i] = k;
    let a = map.get(k); if (!a){ a = [0, 0, 0]; map.set(k, a); } a[0] += N.getX(i); a[1] += N.getY(i); a[2] += N.getZ(i);
  }
  for (let i = 0; i < P.count; i++){ const a = map.get(keys[i]), l = Math.hypot(a[0], a[1], a[2]) || 1; N.setXYZ(i, a[0] / l, a[1] / l, a[2] / l); }
}
function mesh(geo, mat, shadow = true, recv = true){ const m = new THREE.Mesh(geo, mat); m.castShadow = shadow; m.receiveShadow = recv; return m; }
function rod(a, b, r, mat, seg = 8){ const d = new V3().subVectors(b, a), L = d.length();
  const m = mesh(new THREE.CylinderGeometry(r, r, L, seg), mat); m.position.copy(a).addScaledVector(d, .5);
  m.quaternion.setFromUnitVectors(new V3(0, 1, 0), d.normalize()); return m; }

/* ================================================================================================= */
M.createScene = function createScene(container){
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  if (!renderer.capabilities.isWebGL2 && !renderer.getContext()) throw new Error('no webgl');
  /* pixel ratio: up to 2, but never more than ~3.7 MP of render target (a 1920x1080 window on a 2x display renders
     at ~1.33x; 1280x800 at 2x stays near 1.9x). The tube text is still magnified at rest, so it stays sharp. */
  const PX_BUDGET = 3.7e6;
  const prFor = (w, h) => Math.max(1, Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(PX_BUDGET / Math.max(1, w * h))));
  let pixelRatio = prFor(innerWidth, innerHeight), prCap = 2;
  renderer.setPixelRatio(pixelRatio);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.physicallyCorrectLights = true;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;   // the lamp is fixed: the shadow pass re-renders only while something moves (see render())
  renderer.setClearColor(0x050608, 1);
  container.appendChild(renderer.domElement);
  const ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  scene.background = lin(0x050608);
  scene.fog = new THREE.FogExp2(lin(0x06070a), .16);
  const camera = new THREE.PerspectiveCamera(33, 16 / 10, .02, 30);

  /* ---------------- materials ---------------- */
  /* warm off-white ABS, a few years into yellowing: noise mottling, a faint warm sheen to fake subsurface */
  const PLASTIC = [0.86, 0.815, 0.728];   // warm beige under a 2700K lamp, not grey-olive under the tube
  const plasticBase = (u, v, o, sx, sy) => {
    const n = fbm(u * sx * 6, v * sy * 6, 4), s = vnoise(u * sx * 140, v * sy * 140);
    const y = .015 + .03 * fbm(u * sx * 1.5 + 9, v * sy * 1.5, 3); // uneven yellowing
    const k = .965 + .05 * (n - .5) + .02 * (s - .5);
    o[0] = PLASTIC[0] * k; o[1] = PLASTIC[1] * k * (1 - y * .4); o[2] = PLASTIC[2] * k * (1 - y * 1.6);
    o[3] = .5 + .04 * (s - .5);
  };
  const grime = (o, a) => { o[0] *= 1 - a; o[1] *= 1 - a * 1.04; o[2] *= 1 - a * 1.12; };
  function plasticMat(map, bump, extra = {}){
    return new THREE.MeshPhysicalMaterial(Object.assign({ color: 0xffffff, map, bumpMap: bump || null, bumpScale: .0009,
      roughness: .56, metalness: 0, sheen: .35, sheenRoughness: .55, sheenColor: lin(0xfff0dc), clearcoat: .05, clearcoatRoughness: .5 }, extra));
  }

  /* ================= THE COMPUTER ================= */
  const CW = .246, CH = .345, CD = .275, CR = .022;
  const SLOPE = Math.tan(5 * Math.PI / 180), SLOPE_Y0 = -.112; // face leans back above the chin
  const BZ = { y: .046, hw: .1095, hh: .0855, r: .023, wall: .015, depth: .021 }; // recessed CRT bezel
  const faceZ = y => CD / 2 - Math.max(0, y - SLOPE_Y0) * SLOPE;
  const SLOT = { x: .043, y: -.074, hw: .047, hh: .0028 };
  const computer = new THREE.Group();
  {
    // ---- textures (front, side, top, back) ----
    const FW = 512, FH = Math.round(512 * CH / CW);
    const [frontC, frontH] = paint(FW, FH, (u, v, o) => {
      plasticBase(u, v, o, 1, CH / CW);
      const x = (u - .5) * CW, y = (v - .5) * CH;
      const sd = sdRR(x, y - BZ.y, BZ.hw, BZ.hh, BZ.r);
      // grime collects on the recess walls and in a thin halo just outside the lip
      if (sd < 0) grime(o, .05 + .16 * sstep(0, -BZ.wall, sd) + .08 * Math.exp(-Math.abs(sd + BZ.wall * .9) * 900));
      else grime(o, .07 * Math.exp(-sd * 260));
      // floppy slot surround: a moulded oval dimple
      const ss = sdRR(x - SLOT.x, y - SLOT.y, SLOT.hw + .006, SLOT.hh + .006, .007);
      if (ss < .002){ grime(o, .05 * sstep(.002, -.004, ss)); o[3] -= .25 * sstep(.002, -.005, ss); }
      // chin: two moulded lines and a debossed model badge
      for (const gy of [-.121, -.127]){ const dd = Math.abs(y - gy); if (dd < .0011 && Math.abs(x) < CW / 2 - .012){ o[3] -= .3 * (1 - dd / .0011); grime(o, .1 * (1 - dd / .0011)); } }
      // keyboard jack recess (lower left)
      const js = sdRR(x + .07, y + .148, .0075, .0045, .002); if (js < .0015){ grime(o, .25 * sstep(.0015, -.002, js)); o[3] -= .4 * sstep(.0015, -.001, js); }
      // ventilation grille strip under the chin lines
      if (y < -.135 && y > -.152 && Math.abs(x) < .055 && Math.abs(x) > .02){ const p = ((x + 1) * 1000 / 3.2) % 1; if (p < .45){ o[3] -= .35; grime(o, .3); } }
    }, true);
    const sideFn = (mirror) => (u, v, o) => {
      plasticBase(mirror ? 1 - u : u, v, o, CD / CW, CH / CW);
      const z = u * CD, y = v * CH; // z from the front edge, y from the bottom
      // vent slits toward the rear and top of each side
      if (z > .15 && z < .245 && y > .19 && y < .30){ const p = (y * 1000 / 7.5) % 1, w = sstep(.15, .16, z) * sstep(.245, .235, z);
        if (p < .38 && w > 0){ o[3] -= .45 * w; grime(o, .35 * w); } else if (p < .5 && w > 0) o[3] += .08 * w; }
      grime(o, .06 * sstep(.03, 0, y)); // dusty foot line
    };
    const [sideC, sideH] = paint(256, Math.round(256 * CH / CD), sideFn(false), true);
    const [topC, topH] = paint(256, Math.round(256 * CD / CW), (u, v, o) => {
      plasticBase(u, v, o, 1, CD / CW);
      const x = (u - .5) * CW, z = (1 - v) * CD; // z from the back
      // rear carry handle: a deep moulded recess along the back of the top
      const hs = sdRR(x, z - .035, .062, .014, .012);
      if (hs < .002){ const t = sstep(.002, -.008, hs); o[3] -= .5 * t; grime(o, .1 + .4 * t); }
      // top vents
      if (z > .065 && z < .12 && Math.abs(x) < .085){ const p = ((x + 1) * 1000 / 6) % 1; if (p < .4){ o[3] -= .4; grime(o, .38); } }
      grime(o, .05 * fbm(u * 3, v * 3, 2)); // a little dust settles on top
    }, true);
    const backC = paint(128, 128, (u, v, o) => { plasticBase(u, v, o, 1, 1); grime(o, .08); });
    const T = (c, s = true) => tex(c, s, ANISO);
    const sideT = T(sideC), sideHT = T(sideH, false), sideT2 = sideT.clone(), sideHT2 = sideHT.clone();
    for (const t of [sideT2, sideHT2]){ t.wrapS = THREE.RepeatWrapping; t.repeat.x = -1; t.offset.x = 1; t.needsUpdate = true; }
    const mFront = plasticMat(T(frontC), T(frontH, false));
    const mSideR = plasticMat(sideT, sideHT), mSideL = plasticMat(sideT2, sideHT2);
    const mTop = plasticMat(T(topC), T(topH, false)), mBack = plasticMat(T(backC));

    // ---- body: rounded box, face sloped back, rear tapered, CRT recess pushed into the front ----
    const body = roundedBox(CW, CH, CD, CR, 4, [56, 80, 16], (p, f) => {
      if (f === 4){ const sd = sdRR(p.x, p.y - BZ.y, BZ.hw, BZ.hh, BZ.r); if (sd < 0) p.z -= BZ.depth * sstep(0, -BZ.wall, sd); }
      const w = clamp((p.z + CD / 2) / CD, 0, 1);
      if (p.y > SLOPE_Y0) p.z -= (p.y - SLOPE_Y0) * SLOPE * w;
      const t = clamp(-p.z / (CD / 2), 0, 1); // taper toward the back
      p.x *= 1 - .07 * t; p.y = -CH / 2 + (p.y + CH / 2) * (1 - .045 * t);
    });
    computer.add(mesh(body, [mSideR, mSideL, mTop, mBack, mFront, mBack]));

    // moulded bezel lip: a soft raised rim around the tube recess, its profile rounded by a multi-step bevel
    const backT = T(backC); backT.wrapS = backT.wrapT = THREE.RepeatWrapping;
    const lipM = plasticMat(backT, null, { roughness: .5 });
    const frameGeo = (ohw, ohh, or, ihw, ihh, ir, depth, bt, bs, segs) => {
      const sh = rrShape(ohw, ohh, or); sh.holes.push(rrShape(ihw, ihh, ir));
      const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: bt, bevelSize: bs, bevelSegments: segs, curveSegments: 10 });
      const UV = g.attributes.uv; for (let i = 0; i < UV.count; i++) UV.setXY(i, UV.getX(i) * 4, UV.getY(i) * 4);
      return g; };
    {
      const lip = mesh(frameGeo(BZ.hw + .0075, BZ.hh + .0075, BZ.r + .0075, BZ.hw + .002, BZ.hh + .002, BZ.r + .002, .0006, .0017, .0019, 5), lipM);
      const z = faceZ(BZ.y); lip.position.set(0, BZ.y, z - .0006); lip.rotation.x = -Math.atan(SLOPE); computer.add(lip);
      // a hairline parting groove just outside the lip, where the bezel moulding meets the case
      const gs = rrShape(BZ.hw + .0107, BZ.hh + .0107, BZ.r + .0107); gs.holes.push(rrShape(BZ.hw + .0096, BZ.hh + .0096, BZ.r + .0096));
      const groove = mesh(new THREE.ShapeGeometry(gs, 12), new THREE.MeshStandardMaterial({ color: lin(0x6d6556), roughness: .8 }), false);
      groove.position.set(0, BZ.y, faceZ(BZ.y) + .0003); groove.rotation.x = -Math.atan(SLOPE); computer.add(groove);
    }
    // floppy slot: a raised mouth with real depth, a dark throat, the spring door set back inside, and the eject button
    const dark = new THREE.MeshStandardMaterial({ color: lin(0x0b0a09), roughness: .9 });
    {
      const mouth = mesh(frameGeo(SLOT.hw + .0042, SLOT.hh + .0034, (SLOT.hh + .0034) * .9, SLOT.hw + .0004, SLOT.hh + .0004, SLOT.hh * .95, .0018, .0011, .0012, 3), lipM);
      mouth.position.set(SLOT.x, SLOT.y, faceZ(SLOT.y) - .0004); mouth.rotation.x = -Math.atan(SLOPE); computer.add(mouth);
      // throat walls in shadow, so the opening reads as a slot rather than a sticker
      const throat = mesh(new THREE.BoxGeometry(SLOT.hw * 2 + .0006, SLOT.hh * 2 + .0006, .0042), new THREE.MeshStandardMaterial({ color: lin(0x15130f), roughness: .95, side: THREE.BackSide }), false);
      throat.position.set(SLOT.x, SLOT.y, faceZ(SLOT.y) + .0006); throat.rotation.x = -Math.atan(SLOPE); computer.add(throat);
      const door = mesh(new THREE.PlaneGeometry(SLOT.hw * 2 - .002, SLOT.hh * 2 - .0004), new THREE.MeshStandardMaterial({ color: lin(0x2a2722), roughness: .55, metalness: .3 }), false);
      door.position.set(SLOT.x, SLOT.y + .0002, faceZ(SLOT.y) + .0009); door.rotation.x = -Math.atan(SLOPE) - .18; computer.add(door);
      const eject = mesh(roundedBox(.011, .0042, .004, .0012, 2), lipM);
      eject.position.set(SLOT.x + SLOT.hw - .008, SLOT.y - SLOT.hh - .0095, faceZ(SLOT.y - .0095) + .0009); eject.rotation.x = -Math.atan(SLOPE); computer.add(eject);
      // drive activity lamp, unlit: a tiny dome of dark red lens
      const led = mesh(new THREE.SphereGeometry(.0018, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: lin(0x3a0a06), roughness: .2, clearcoat: 1 }), false);
      led.rotation.x = Math.PI / 2 - Math.atan(SLOPE); led.position.set(SLOT.x - SLOT.hw - .01, SLOT.y, faceZ(SLOT.y)); computer.add(led);
    }
    const slotZ = faceZ(SLOT.y);
    const sg = new THREE.ShapeGeometry(rrShape(SLOT.hw, SLOT.hh, SLOT.hh * .95), 6);
    const slot = mesh(sg, dark, false); slot.position.set(SLOT.x, SLOT.y, slotZ + .0004); slot.rotation.x = -Math.atan(SLOPE); computer.add(slot);
    const notch = mesh(new THREE.CircleGeometry(.0045, 16, Math.PI, Math.PI), dark, false);
    notch.position.set(SLOT.x + SLOT.hw - .012, SLOT.y - SLOT.hh + .0002, slotZ + .00045); notch.rotation.x = -Math.atan(SLOPE); computer.add(notch);
    const jack = mesh(new THREE.ShapeGeometry(rrShape(.0062, .0033, .0015)), dark, false);
    jack.position.set(-.07, -.148, faceZ(-.148) + .0004); computer.add(jack);
    // feet
    for (const [fx, fz] of [[-.09, .1], [.09, .1], [-.08, -.1], [.08, -.1]]){ const ft = mesh(new THREE.CylinderGeometry(.008, .009, .006, 12), dark, false); ft.position.set(fx, -CH / 2 - .002, fz); computer.add(ft); }
  }
  function rrShape(hw, hh, r){ const s = new THREE.Shape(); s.moveTo(-hw + r, -hh); s.lineTo(hw - r, -hh); s.quadraticCurveTo(hw, -hh, hw, -hh + r);
    s.lineTo(hw, hh - r); s.quadraticCurveTo(hw, hh, hw - r, hh); s.lineTo(-hw + r, hh); s.quadraticCurveTo(-hw, hh, -hw, hh - r);
    s.lineTo(-hw, -hh + r); s.quadraticCurveTo(-hw, -hh, -hw + r, -hh); return s; }

  /* ---- the CRT: curved glass with a custom shader ---- */
  const GW = 2 * (BZ.hw - BZ.wall) + .006, GH = GW * .75; // 4:3 tube, slightly larger than the recess floor
  const SCREEN_ASPECT = 4 / 3;
  const glassGeo = new THREE.PlaneGeometry(GW, GH, 40, 30);
  { const P = glassGeo.attributes.position, R = .42, z0 = Math.sqrt(R * R - (GW / 2) ** 2 - (GH / 2) ** 2);
    for (let i = 0; i < P.count; i++){ const x = P.getX(i), y = P.getY(i); P.setZ(i, Math.sqrt(R * R - x * x - y * y) - z0); }
    glassGeo.computeVertexNormals(); }
  const GLASS_BULGE = .42 - Math.sqrt(.42 * .42 - (GW / 2) ** 2 - (GH / 2) ** 2);
  const blankTex = new THREE.DataTexture(new Uint8Array([10, 13, 10, 255]), 1, 1); blankTex.needsUpdate = true;
  const screenU = {
    uTex: { value: blankTex }, uHas: { value: 0 }, uRes: { value: new THREE.Vector2(1024, 768) }, uTime: { value: 0 },
    uFlicker: { value: 1 }, uRoll: { value: REDUCED ? 0 : 1 }, uPhos: { value: new THREE.Vector3(...PHOSPHOR) }, uMono: { value: .88 },
    uWarm: { value: 1 }, uLamp: { value: new V3() }, uInset: { value: new THREE.Vector2(.036, .042) }, uBright: { value: 1 }, uLampAmt: { value: 1 },
  };
  const screenMat = new THREE.ShaderMaterial({
    uniforms: screenU, extensions: { derivatives: true },
    vertexShader: `
      varying vec2 vUv; varying vec3 vW; varying vec3 vN;
      void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform sampler2D uTex; uniform float uHas, uTime, uFlicker, uRoll, uMono, uBright, uLampAmt, uWarm; uniform vec2 uRes, uInset; uniform vec3 uPhos, uLamp;
      varying vec2 vUv; varying vec3 vW; varying vec3 vN;
      float luma(vec3 c){ return dot(c, vec3(.299, .587, .114)); }
      vec3 phos(vec3 c){ float l = luma(c); vec3 m = uPhos * l + vec3(pow(l, 3.)) * .32; return mix(c, m, uMono); }
      float rr(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }
      vec3 S(vec2 t){ return texture2D(uTex, t).rgb; }
      void main(){
        // gentle barrel distortion: the image bows with the glass
        vec2 c = vUv - .5; c *= 1. + .055 * dot(c, c); vec2 uv = c + .5;
        vec2 t = (uv - uInset) / (1. - 2. * uInset);
        float edge = rr(t - .5, vec2(.5), .03), ea = max(fwidth(edge), 1e-4);
        float inside = 1. - smoothstep(-ea, ea * .5, edge);
        vec3 col = vec3(0.);
        if (uHas > .5 && inside > 0.){
          // the canvas is sampled without mipmaps (no blur); a 4-tap box over this pixel's footprint keeps
          // strokes crisp when magnified and stops them shimmering when the tube is minified
          vec2 dx = dFdx(t) * .25, dy = dFdy(t) * .25;
          vec3 s = .25 * (S(t + dx + dy) + S(t - dx + dy) + S(t + dx - dy) + S(t - dx - dy));
          // phosphor halation: a soft ring of taps, added under the text, never replacing it
          vec2 px = 1. / uRes; vec3 g = vec3(0.);
          for (int i = 0; i < 8; i++){ float a = float(i) * .7853982 + .3927; vec2 o = vec2(cos(a), sin(a)) * px;
            g += S(t + o * 2.2) + .55 * S(t + o * 5.5); }
          g /= 12.4;
          vec3 ps = phos(s), pg = phos(g);
          col = ps + pg * .2 * (1. - .6 * luma(ps));
          // scanlines (one per 4 canvas rows); strongest in the dark gaps, fading out before they can alias
          float y = t.y * uRes.y / 4.; float fw = fwidth(y);
          float sAmt = .2 * clamp(1.6 - fw * 2.2, 0., 1.) * (1. - .55 * luma(s));
          col *= 1. - sAmt * (.5 - .5 * cos(y * 6.2831853));
          // shadow mask: soft RGB triads, only when there are enough device pixels to show them
          float x = t.x * uRes.x / 3.; float fx = fwidth(x); float mAmt = .07 * clamp(1.3 - fx * 1.7, 0., 1.);
          vec3 mask = .5 + .5 * cos(6.2831853 * (x - vec3(0., .3333, .6667)));
          col *= 1. - mAmt + 2. * mAmt * mask;
          // vignette, flicker and a slow, barely-there refresh band
          float v = 16. * t.x * t.y * (1. - t.x) * (1. - t.y); col *= mix(.74, 1., pow(clamp(v, 0., 1.), .3));
          col *= uFlicker * (1. + uRoll * .012 * smoothstep(.0, .5, .5 - abs(fract(t.y - uTime * .06) - .5) * 6.));
          col *= inside * uBright;
          // power-on: the raster opens out from a bright horizontal line, then the phosphor settles to full
          if (uWarm < 1.){ float op = smoothstep(0., .45, uWarm), hy = abs(t.y - .5);
            float band = 1. - smoothstep(.5 * op * op, .5 * op * op + .004 + .01 * (1. - op), hy);
            col = col * band * smoothstep(.2, 1., uWarm) + uPhos * band * .5 * (1. - smoothstep(.0, .55, uWarm)) * inside; }
        }
        // the unlit tube is a dark grey-green, slightly lighter in the middle where the glass is thickest
        vec3 base = vec3(.018, .024, .021) * (1. - .45 * length(vUv - .5));
        // the bezel lip shades the glass: deepest along the top and the lamp-side (left) edge
        float sh = smoothstep(0., .09, 1. - vUv.y) * smoothstep(0., .075, vUv.x) * smoothstep(0., .04, 1. - vUv.x) * smoothstep(0., .035, vUv.y);
        float occ = mix(.2, 1., sh);
        // glass: the lamp as a soft warm bloom and a tight glint, room sheen at grazing angles
        vec3 V = normalize(cameraPosition - vW), N = normalize(vN);
        vec3 L = normalize(uLamp - vW), R = reflect(-V, N);
        float rl = max(dot(R, L), 0.);
        vec3 refl = vec3(1., .74, .48) * (pow(rl, 220.) * .5 + pow(rl, 18.) * .05 + pow(rl, 4.) * .018) * uLampAmt;
        refl += vec3(1., .78, .55) * .03 * uLampAmt * smoothstep(.5, 0., length((vUv - vec2(.05, .9)) * vec2(1., 1.4)));  // lamp-lit room, top left
        // the window, faint and cool, ghosted in the upper left of the glass
        refl += vec3(.25, .32, .5) * .012 * smoothstep(.22, .0, length((vUv - vec2(.12, .8)) * vec2(1.3, 1.)));
        refl += vec3(.03, .036, .045) * pow(1. - max(dot(N, V), 0.), 3.);
        refl += vec3(.006, .007, .009) * smoothstep(.2, 1., vUv.y);   // a hint of the dark room above
        // the outer rim of the image falls off where the beam lands at a steep angle
        float rim = smoothstep(.0, .05, min(min(vUv.x, 1. - vUv.x), min(vUv.y, 1. - vUv.y)));
        gl_FragColor = vec4(col * mix(.55, 1., rim) + (base + refl) * occ, 1.);
      }`,
  });
  const glass = new THREE.Mesh(glassGeo, screenMat);
  glass.position.set(0, BZ.y, faceZ(BZ.y) - BZ.depth + .0015);
  glass.rotation.x = -Math.atan(SLOPE);
  computer.add(glass);

  const computerYaw = .11;
  computer.position.set(.015, DESK_Y + CH / 2 + .005, -.175);
  computer.rotation.y = computerYaw;
  scene.add(computer);
  computer.updateMatrixWorld(true);
  const screenCenter = glass.localToWorld(new V3(0, 0, GLASS_BULGE));
  const screenNormal = new V3(0, 0, 1).applyQuaternion(glass.getWorldQuaternion(new THREE.Quaternion())).normalize();

  /* ================= THE DESK & ROOM ================= */
  const DESK = { w: 1.56, d: .84, t: .036, z: -.03 };
  {
    const [woodC, woodH] = paint(1024, 512, (u, v, o) => {
      const X = u * DESK.w, Y = v * DESK.d;
      const warp = fbm(X * .9, Y * 3.2, 4) * .055 + fbm(X * .25 + 5, Y * .8, 3) * .09;
      const yy = Y + warp;
      const ring = Math.pow(Math.abs(Math.sin(yy * Math.PI * 44)), 6), ring2 = Math.pow(Math.abs(Math.sin(yy * Math.PI * 13 + 1.3)), 3);
      const streak = fbm(X * 3, Y * 90, 3), pore = vnoise(X * 260, Y * 1100);
      const t = clamp(.32 * ring + .22 * ring2 + .35 * (streak - .45) + (pore > .86 ? .12 : 0), 0, 1);
      // oiled walnut: warm mid-brown with darker late-wood
      o[0] = lerp(.36, .17, t); o[1] = lerp(.215, .095, t); o[2] = lerp(.13, .055, t);
      const wear = fbm(X * 1.4 + 3, Y * 1.4, 3); const k = .9 + .2 * wear; o[0] *= k; o[1] *= k; o[2] *= k;
      o[3] = .5 - .2 * t + (pore > .86 ? -.08 : 0);
    }, true);
    const woodT = tex(woodC, true, ANISO), woodRT = tex(woodH, false, ANISO);
    const deskTop = new THREE.MeshStandardMaterial({ map: woodT, bumpMap: woodRT, bumpScale: .00015, roughness: .55, metalness: 0 });
    const deskSide = new THREE.MeshStandardMaterial({ color: lin(0x3a2416), roughness: .6 });
    // the top: a rounded-corner slab with a soft, eased edge profile (bevelled in five steps) that catches the lamp
    const BT = .009, BS = .007;
    const tg = new THREE.ExtrudeGeometry(rrShape(DESK.w / 2 - BS, DESK.d / 2 - BS, .012), { depth: DESK.t - 2 * BT, bevelEnabled: true, bevelThickness: BT, bevelSize: BS, bevelSegments: 6, curveSegments: 6 });
    tg.rotateX(-Math.PI / 2); tg.translate(0, -DESK.t + BT, 0);
    { const P = tg.attributes.position, UV = tg.attributes.uv; for (let i = 0; i < P.count; i++) UV.setXY(i, (P.getX(i) + DESK.w / 2) / DESK.w, 1 - (P.getZ(i) + DESK.d / 2) / DESK.d); }
    const top = mesh(tg, [deskTop, deskTop]); top.position.set(0, DESK_Y, DESK.z); scene.add(top);
    const legM = new THREE.MeshStandardMaterial({ color: lin(0x22160e), roughness: .7 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]){ const l = mesh(new THREE.BoxGeometry(.05, DESK_Y - DESK.t, .05), legM); l.position.set(sx * (DESK.w / 2 - .05), (DESK_Y - DESK.t) / 2, DESK.z + sz * (DESK.d / 2 - .05)); scene.add(l); }
    const apron = mesh(new THREE.BoxGeometry(DESK.w - .1, .07, .02), legM); apron.position.set(0, DESK_Y - DESK.t - .035, DESK.z + DESK.d / 2 - .06); scene.add(apron);
    // a shallow drawer under the right side
    const drw = mesh(new THREE.BoxGeometry(.42, .075, .012), deskSide); drw.position.set(.42, DESK_Y - DESK.t - .04, DESK.z + DESK.d / 2 - .045); scene.add(drw);
    const knob = mesh(new THREE.SphereGeometry(.009, 12, 8), new THREE.MeshStandardMaterial({ color: lin(0x9a7a4a), metalness: .8, roughness: .35 })); knob.position.set(.42, DESK_Y - DESK.t - .04, DESK.z + DESK.d / 2 - .036); scene.add(knob);
  }

  // wall with a window cut into it
  const WALL_Z = DESK.z - DESK.d / 2 - .03;
  const WIN = { x: -.58, y: 1.42, hw: .4, hh: .42, depth: .14 };
  {
    const wallC = paint(512, 256, (u, v, o) => { const n = fbm(u * 18, v * 9, 5), m = fbm(u * 3 + 2, v * 1.5, 3); const k = .85 + .25 * n + .15 * m;
      o[0] = .15 * k; o[1] = .158 * k; o[2] = .166 * k; }); // cool, slightly blue-grey plaster (dark, but not so dark the ACES toe crushes it to pure black)
    const wallM = new THREE.MeshStandardMaterial({ map: tex(wallC), roughness: .95 });
    const s = new THREE.Shape(); s.moveTo(-3, 0); s.lineTo(3, 0); s.lineTo(3, 3); s.lineTo(-3, 3); s.lineTo(-3, 0);
    const hole = new THREE.Path(); hole.moveTo(WIN.x - WIN.hw, WIN.y - WIN.hh); hole.lineTo(WIN.x + WIN.hw, WIN.y - WIN.hh); hole.lineTo(WIN.x + WIN.hw, WIN.y + WIN.hh); hole.lineTo(WIN.x - WIN.hw, WIN.y + WIN.hh); hole.lineTo(WIN.x - WIN.hw, WIN.y - WIN.hh);
    s.holes.push(hole);
    const wg = new THREE.ShapeGeometry(s); { const P = wg.attributes.position, UV = wg.attributes.uv; for (let i = 0; i < P.count; i++) UV.setXY(i, (P.getX(i) + 3) / 6, P.getY(i) / 3); }
    const wall = mesh(wg, wallM, false); wall.position.z = WALL_Z; scene.add(wall);
    const side = mesh(new THREE.PlaneGeometry(4, 3), wallM, false); side.rotation.y = Math.PI / 2; side.position.set(-1.6, 1.5, WALL_Z + 2); scene.add(side);
    const floorM = new THREE.MeshStandardMaterial({ color: lin(0x17110c), roughness: .8 });
    const floor = mesh(new THREE.PlaneGeometry(6, 6), floorM, false); floor.rotation.x = -Math.PI / 2; floor.position.z = WALL_Z + 3; scene.add(floor);
    // window reveal, sill and mullions in dark painted wood
    const frameM = new THREE.MeshStandardMaterial({ color: lin(0x1a1b1d), roughness: .7 });
    const revM = new THREE.MeshStandardMaterial({ color: lin(0x1c1e21), roughness: .95 });
    const zz = WALL_Z - WIN.depth / 2;
    const add = (g, m, x, y, z) => { const o = mesh(g, m, false); o.position.set(x, y, z); scene.add(o); return o; };
    add(new THREE.BoxGeometry(.02, WIN.hh * 2, WIN.depth), revM, WIN.x - WIN.hw - .01, WIN.y, zz);
    add(new THREE.BoxGeometry(.02, WIN.hh * 2, WIN.depth), revM, WIN.x + WIN.hw + .01, WIN.y, zz);
    add(new THREE.BoxGeometry(WIN.hw * 2 + .04, .02, WIN.depth), revM, WIN.x, WIN.y + WIN.hh + .01, zz);
    add(new THREE.BoxGeometry(WIN.hw * 2 + .1, .025, WIN.depth + .05), frameM, WIN.x, WIN.y - WIN.hh - .012, zz + .025);
    const gz = WALL_Z - WIN.depth + .01;
    add(new THREE.BoxGeometry(.028, WIN.hh * 2, .03), frameM, WIN.x, WIN.y, gz);
    add(new THREE.BoxGeometry(WIN.hw * 2, .028, .03), frameM, WIN.x, WIN.y + .08, gz);
    for (const [g, x, y] of [[new THREE.BoxGeometry(.04, WIN.hh * 2, .04), WIN.x - WIN.hw + .02, WIN.y], [new THREE.BoxGeometry(.04, WIN.hh * 2, .04), WIN.x + WIN.hw - .02, WIN.y],
      [new THREE.BoxGeometry(WIN.hw * 2, .04, .04), WIN.x, WIN.y + WIN.hh - .02], [new THREE.BoxGeometry(WIN.hw * 2, .05, .04), WIN.x, WIN.y - WIN.hh + .025]]) add(g, frameM, x, y, gz);
    // the night outside: deep sky, a far city, sodium glow and a tree in silhouette
    const [nc, nx] = cnv(1024, 768);
    const sky = nx.createLinearGradient(0, 0, 0, 768); sky.addColorStop(0, '#05080f'); sky.addColorStop(.55, '#0c1322'); sky.addColorStop(.8, '#1d1a22'); sky.addColorStop(1, '#2a1c16');
    nx.fillStyle = sky; nx.fillRect(0, 0, 1024, 768);
    seed = 11;
    for (let i = 0; i < 70; i++){ nx.fillStyle = `rgba(200,210,255,${.15 + rnd() * .35})`; nx.fillRect(rnd() * 1024, rnd() * 330, 1.2, 1.2); }
    for (let layer = 0; layer < 2; layer++){
      let x = -20; const base = layer ? 640 : 590;
      while (x < 1044){ const bw = 30 + rnd() * 70, bh = (layer ? 40 : 90) + rnd() * (layer ? 120 : 200);
        nx.fillStyle = layer ? '#07080c' : '#0b0d14'; nx.fillRect(x, base - bh, bw, 768);
        for (let wy = base - bh + 8; wy < base - 4; wy += 9) for (let wx = x + 5; wx < x + bw - 5; wx += 8) if (rnd() < (layer ? .16 : .1)){
          const warm = rnd() < .75; nx.fillStyle = warm ? `rgba(255,${170 + rnd() * 50 | 0},${90 + rnd() * 40 | 0},${.35 + rnd() * .5})` : `rgba(170,200,255,${.3 + rnd() * .4})`; nx.fillRect(wx, wy, 4, 5); }
        x += bw + rnd() * 6; }
    }
    nx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 26; i++){ const x = rnd() * 1024, y = 600 + rnd() * 140, r = 10 + rnd() * 26; const g = nx.createRadialGradient(x, y, 0, x, y, r);
      const c = rnd() < .8 ? '255,160,80' : '150,190,255'; g.addColorStop(0, `rgba(${c},.35)`); g.addColorStop(1, `rgba(${c},0)`); nx.fillStyle = g; nx.fillRect(x - r, y - r, r * 2, r * 2); }
    nx.globalCompositeOperation = 'source-over';
    nx.strokeStyle = '#020203'; nx.fillStyle = '#020203'; nx.lineCap = 'round';
    const branch = (x, y, a, len, w, d) => { if (d > 7 || len < 6) return; const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
      nx.lineWidth = w; nx.beginPath(); nx.moveTo(x, y); nx.quadraticCurveTo((x + x2) / 2 + (rnd() - .5) * len * .3, (y + y2) / 2, x2, y2); nx.stroke();
      if (d > 4) for (let i = 0; i < 3; i++){ nx.beginPath(); nx.ellipse(x2 + (rnd() - .5) * 14, y2 + (rnd() - .5) * 14, 4 + rnd() * 5, 2 + rnd() * 3, rnd() * 3, 0, 7); nx.fill(); }
      const n = 2 + (rnd() < .4 ? 1 : 0); for (let i = 0; i < n; i++) branch(x2, y2, a + (rnd() - .5) * 1.1, len * (.62 + rnd() * .2), w * .66, d + 1); };
    branch(-30, 520, -.55, 160, 26, 0); branch(1060, 300, Math.PI + .35, 120, 18, 1);
    const nightT = tex(nc, true, 2);
    const night = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.65), new THREE.MeshBasicMaterial({ map: nightT, fog: false, color: new THREE.Color(.85, .85, .85) }));
    night.position.set(WIN.x + .05, WIN.y - .05, WALL_Z - .75); scene.add(night);
    // faint pane reflection so the glass reads as glass
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(WIN.hw * 2, WIN.hh * 2), new THREE.MeshStandardMaterial({ color: 0x000000, roughness: .08, metalness: .9, transparent: true, opacity: .18, depthWrite: false }));
    pane.position.set(WIN.x, WIN.y, gz - .005); scene.add(pane);
  }

  /* ================= THE KEYBOARD ================= */
  const U = .019, KB = { w: .316, d: .14, tilt: .085, yaw: .03, x: .015, z: .13, kz0: .008 };
  const keyBounce = { value: .12 };    // warm bounce on the cap skirts (see topM), scaled by the lamp in applyLamp
  const ROW_ANGLE = [.15, .075, 0, -.05, -.085], ROW_LIFT = [.0024, .001, 0, .0003, .0009];
  const KEY_H = .0095, KEY_BASE = .0042, TRAVEL = .0032, DISH = .0008;
  const L = (s) => s.split('').map(c => ['Key' + c, 1, c]);
  const ROWS = [
    [['Backquote', 1, '~', '`'], ...'1234567890'.split('').map((c, i) => ['Digit' + c, 1, '!@#$%^&*()'[i], c]), ['Minus', 1, '_', '-'], ['Equal', 1, '+', '='], ['Backspace', 2, 'delete', '', 1]],
    [['Tab', 1.5, 'tab', '', 1], ...L('QWERTYUIOP'), ['BracketLeft', 1, '{', '['], ['BracketRight', 1, '}', ']'], ['Backslash', 1.5, '|', '\\']],
    [['CapsLock', 1.75, 'caps lock', '', 1], ...L('ASDFGHJKL'), ['Semicolon', 1, ':', ';'], ['Quote', 1, '"', "'"], ['Enter', 2.25, 'return', '', 1]],
    [['ShiftLeft', 2.25, 'shift', '', 1], ...L('ZXCVBNM'), ['Comma', 1, '<', ','], ['Period', 1, '>', '.'], ['Slash', 1, '?', '/'], ['ShiftRight', 2.75, 'shift', '', 1]],
    [['ControlLeft', 1.25, 'ctrl', '', 1], ['AltLeft', 1.25, 'alt', '', 1], ['MetaLeft', 1.25, '◆', '', 1], ['Space', 6.25, '', ''], ['AltRight', 1, 'alt', '', 1],
     ['ArrowLeft', 1, '←', '', 1], ['ArrowRight', 1, '→', '', 1], ['ArrowDown', 1, '↓', '', 1], ['ArrowUp', 1, '↑', '', 1]],
  ];
  // codes the board does not have, mapped to where a hand would plausibly go
  const ALIAS = { Escape: 'Backquote', Delete: 'Backspace', NumpadEnter: 'Enter', MetaRight: 'MetaLeft', ControlRight: 'AltRight', OSLeft: 'MetaLeft', OSRight: 'MetaLeft', IntlBackslash: 'ShiftLeft', ContextMenu: 'AltRight' };
  const keys = new Map(), activeKeys = new Set();
  const kb = new THREE.Group();
  const housings = []; // switch housings on the plate: they show through the gaps and as a cap sinks, so the travel reads as real
  {
    // legend atlas: one canvas, one cell per key, cap colour baked in
    const AW = 2048, AH = 1024, CPX = 128; // 2x: legends stay sharp when the typist looks down at the board
    const [ac, ax] = cnv(AW, AH);
    const ALPHA_C = [222, 212, 190], MOD_C = [170, 160, 146];
    let cx = 0, cy = 0; const cells = {};
    const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
    for (const row of ROWS) for (const [code, w, a, b, mod] of row){
      const cw = Math.round(w * CPX); if (cx + cw > AW){ cx = 0; cy += CPX; }
      const col = mod ? MOD_C : ALPHA_C;
      const g = ax.createRadialGradient(cx + cw / 2, cy + CPX * .45, 4, cx + cw / 2, cy + CPX * .45, Math.max(cw, CPX) * .7);
      g.addColorStop(0, `rgb(${col[0] + 6},${col[1] + 6},${col[2] + 5})`); g.addColorStop(1, `rgb(${col[0] - 10},${col[1] - 11},${col[2] - 12})`);
      ax.fillStyle = g; ax.fillRect(cx, cy, cw, CPX);
      ax.fillStyle = mod ? 'rgba(46,40,33,.85)' : 'rgba(52,45,37,.92)'; ax.textBaseline = 'alphabetic';
      const lx = cx + 26;
      if (a && a.length === 1 && b){ ax.font = `500 30px ${FONT}`; ax.fillText(a, lx, cy + 50); ax.fillText(b, lx, cy + 96); }
      else if (/^[A-Z]$/.test(a)){ ax.font = `500 38px ${FONT}`; ax.fillText(a, lx, cy + 60); }
      else if (/^[←-↓◆]$/.test(a)){ ax.font = `500 36px ${FONT}`; ax.textAlign = 'center'; ax.fillText(a, cx + cw / 2, cy + 76); ax.textAlign = 'left'; }
      else if (a){ ax.font = `500 22px ${FONT}`; ax.fillText(a, lx, cy + 98); }
      cells[code] = [cx / AW, (cx + cw) / AW, 1 - (cy + CPX) / AH, 1 - cy / AH];
      cx += cw;
    }
    const atlas = tex(ac, true, ANISO);
    const topM = new THREE.MeshStandardMaterial({ map: atlas, roughness: .62 });
    /* bounce: the lamp's pool on the desk in front of the board lights the cap skirts that face the typist (the lamp
       itself never reaches them, so from the lean-back view they would read as a row of black bars). A soft warm term
       on faces turned toward the typist, fading on the tops; it follows the lamp switch (applyLamp). */
    topM.onBeforeCompile = sh => {
      sh.uniforms.uKeyBounce = keyBounce;
      sh.fragmentShader = 'uniform float uKeyBounce;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  {
    vec3 nW = inverseTransformDirection(normal, viewMatrix);
    float face = clamp(nW.z * .85 + .3, 0.0, 1.0) * (1.0 - .8 * clamp(nW.y, 0.0, 1.0));
    totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, .7, .46) * (uKeyBounce * face);
  }`);
    };
    topM.customProgramCacheKey = () => 'mac-keycap-bounce';

    // case: base slab plus a raised surround, all in the same slightly-more-yellowed plastic
    const kbC = paint(256, 128, (u, v, o) => { plasticBase(u, v, o, 1, .45); o[1] *= .985; o[2] *= .95; });
    const caseM = plasticMat(tex(kbC, true, ANISO), null, { roughness: .6 });
    const plateM = new THREE.MeshStandardMaterial({ color: lin(0x6e6656), roughness: .85 });
    const base = mesh(roundedBox(KB.w, .016, KB.d, .006, 3), caseM); base.position.y = -.008; kb.add(base);
    const keyHW = 7.5 * U + .001, keyFront = KB.kz0 + 2.5 * U + .001, keyBack = KB.kz0 - 2.5 * U - .001;
    const bar = (x0, x1, z0, z1) => { const b = mesh(roundedBox(x1 - x0, .012, z1 - z0, .004, 2), caseM); b.position.set((x0 + x1) / 2, -.001, (z0 + z1) / 2); kb.add(b); };
    bar(-KB.w / 2, KB.w / 2, -KB.d / 2, keyBack); bar(-KB.w / 2, KB.w / 2, keyFront, KB.d / 2);
    bar(-KB.w / 2, -keyHW, keyBack - .002, keyFront + .002); bar(keyHW, KB.w / 2, keyBack - .002, keyFront + .002);
    const plate = mesh(new THREE.PlaneGeometry(2 * keyHW, keyFront - keyBack), plateM, false); plate.rotation.x = -Math.PI / 2; plate.position.set(0, .0002, KB.kz0); kb.add(plate);
    // a tiny power lamp on the back bar
    const led = mesh(new THREE.BoxGeometry(.006, .0012, .003), new THREE.MeshBasicMaterial({ color: new THREE.Color(.3, 1.4, .5), toneMapped: false }), false);
    led.position.set(KB.w / 2 - .03, .0052, -KB.d / 2 + .015); kb.add(led);

    // caps
    ROWS.forEach((row, r) => {
      let col = 0;
      for (const [code, w, , , mod] of row){
        const bw = w * U - .0026, bd = U - .0026, hw = bw / 2, hd = bd / 2, [u0, u1, v0, v1] = cells[code];
        const g = roundedBox(bw, KEY_H, bd, .0016, 2, [3, 1, 3], (p, f, u, vv) => {
          const t = (p.y + KEY_H / 2) / KEY_H; // 0 at the skirt, 1 on top
          p.x *= (hw - .0013 * t) / hw; p.z *= (hd - .0016 * t) / hd;
          const top = sstep(KEY_H / 2 - .0022, KEY_H / 2, p.y);
          const xn = Math.min(1, Math.abs(p.x) / (hw - .0013)); p.y -= DISH * (1 - xn * xn) * top * (w > 2 ? .6 : 1);
        });
        const UV = g.attributes.uv, face = g.userData.face;
        // one material per cap (one draw call instead of six): the skirt samples a clean corner of its own cell,
        // which carries the cap colour shaded slightly darker, like the old separate side material
        const su = u1 - 4 / AW, sv = v0 + 4 / AH;
        for (let i = 0; i < UV.count; i++) if (face[i] === 2) UV.setXY(i, lerp(u0, u1, UV.getX(i)), lerp(v0, v1, UV.getY(i))); else UV.setXY(i, su, sv);
        const cap = mesh(g, topM);
        const holder = new THREE.Group();
        const restY = KEY_BASE + KEY_H / 2 + ROW_LIFT[r];
        holder.position.set(-7.5 * U + (col + w / 2) * U, restY, KB.kz0 + (r - 2) * U);
        holder.rotation.x = ROW_ANGLE[r];
        holder.add(cap); kb.add(holder);
        keys.set(code, { holder, restY, row: r, off: 0, vel: 0, target: 0, world: null });
        housings.push([holder.position.x, holder.position.z, w]);
        col += w;
      }
    });
  }
  {
    const hg = roundedBox(.0138, .0036, .0138, .0008, 1), hm = new THREE.MeshStandardMaterial({ color: lin(0x2e2a25), roughness: .7 });
    const stemG = new THREE.BoxGeometry(.0042, .003, .0042), stemM = new THREE.MeshStandardMaterial({ color: lin(0x7b5f38), roughness: .5 });
    const im = new THREE.InstancedMesh(hg, hm, 120), is = new THREE.InstancedMesh(stemG, stemM, 120), mtx = new THREE.Matrix4(); let n = 0;
    for (const [x, z, w] of housings){ const xs = w >= 2 ? [x - (w * U) / 2 + U * .6, x, x + (w * U) / 2 - U * .6] : [x];
      for (const xx of xs){ if (n >= 120) break; mtx.makeTranslation(xx, .0018, z); im.setMatrixAt(n, mtx); mtx.makeTranslation(xx, .0045, z); is.setMatrixAt(n, mtx); n++; } }
    im.count = is.count = n; im.receiveShadow = true; is.receiveShadow = true; kb.add(im, is);
  }
  // set the wedge on the desk: the front edge sits on the wood, the back rides on two feet
  kb.rotation.order = 'YXZ'; kb.rotation.set(KB.tilt, KB.yaw, 0);
  kb.position.set(KB.x, DESK_Y + .016 * Math.cos(KB.tilt) + (KB.d / 2) * Math.sin(KB.tilt) + .001, KB.z);
  scene.add(kb);
  { const ftM = new THREE.MeshStandardMaterial({ color: lin(0x1b1916), roughness: .9 });
    for (const sx of [-1, 1]){ const f = mesh(new THREE.BoxGeometry(.03, .016, .012), ftM); f.position.set(sx * .12, -.018, -KB.d / 2 + .012); f.rotation.x = -KB.tilt; kb.add(f); } }
  kb.updateMatrixWorld(true);
  for (const k of keys.values()){ k.world = k.holder.localToWorld(new V3(0, KEY_H / 2 - DISH * .6, 0)); }
  const keyboardCenter = kb.localToWorld(new V3(0, KEY_BASE + KEY_H, KB.kz0));
  const keyboardNormal = new V3(0, 1, 0).applyQuaternion(kb.quaternion).normalize();

  /* coiled cable from the back of the keyboard to the jack in the computer's chin */
  {
    const S = kb.localToWorld(new V3(-.105, -.006, -KB.d / 2 + .002));
    const J = computer.localToWorld(new V3(-.07, -.148, faceZ(-.148) - .004));
    const lift = DESK_Y + .0085;
    const base = new THREE.CatmullRomCurve3([S, new V3(S.x - .005, lift + .004, S.z - .03), new V3(S.x - .06, lift, S.z - .065), new V3(J.x - .07, lift, J.z + .065),
      new V3(J.x - .02, lift, J.z + .03), new V3(J.x, J.y, J.z + .012), J], false, 'centripetal');
    const pts = [], N = 900, up = new V3(0, 1, 0), side = new V3(), up2 = new V3(), T = new V3();
    for (let i = 0; i <= N; i++){
      const t = i / N, p = base.getPoint(t); base.getTangent(t, T);
      side.crossVectors(T, up).normalize(); up2.crossVectors(side, T).normalize();
      const r = .0058 * sstep(.08, .16, t) * sstep(.86, .78, t), th = t * 48 * Math.PI * 2;
      p.addScaledVector(side, Math.cos(th) * r).addScaledVector(up2, Math.sin(th) * r); pts.push(p);
    }
    const cable = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 760, .0017, 6, false), new THREE.MeshStandardMaterial({ color: lin(0xb9b09b), roughness: .55 }));
    scene.add(cable);
    const plug = mesh(new THREE.BoxGeometry(.011, .007, .012), new THREE.MeshStandardMaterial({ color: lin(0xb3a993), roughness: .6 }));
    plug.position.copy(computer.localToWorld(new V3(-.07, -.148, faceZ(-.148) + .006))); plug.rotation.y = computerYaw; scene.add(plug);
  }

  /* ================= THE LAMP ================= */
  const LAMP = { base: new V3(-.5, DESK_Y, -.25), elbow: new V3(-.54, 1.12, -.31), head: new V3(-.31, 1.13, -.07), target: new V3(-.17, DESK_Y, .13) };
  const lampDir = new V3().subVectors(LAMP.target, LAMP.head).normalize();
  const bulbPos = new V3();
  let bulbMat = null, shadeInnerMat = null, shadeLipMat = null; const shadeRim = { value: 1 };
  {
    const enamel = new THREE.MeshStandardMaterial({ color: lin(0x1d2620), roughness: .42, metalness: .35 }); // bottle-green enamel, nearly black
    const brass = new THREE.MeshStandardMaterial({ color: lin(0xb08a52), roughness: .35, metalness: .9 });
    const g = new THREE.Group(); scene.add(g);
    const baseG = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(.078, 0), new THREE.Vector2(.08, .006), new THREE.Vector2(.074, .02), new THREE.Vector2(.03, .028), new THREE.Vector2(.016, .034), new THREE.Vector2(0, .035)], 40);
    const b = mesh(baseG, enamel); b.position.copy(LAMP.base); g.add(b);
    const p0 = LAMP.base.clone().add(new V3(0, .045, 0));
    g.add(rod(LAMP.base.clone().add(new V3(0, .03, 0)), p0, .007, enamel));
    const pair = (a, c, r) => { const d = new V3().subVectors(c, a), s = new V3().crossVectors(d, new V3(0, 1, 0)).normalize().multiplyScalar(.011);
      if (!isFinite(s.x) || s.lengthSq() < 1e-8) s.set(.011, 0, 0);
      g.add(rod(a.clone().add(s), c.clone().add(s), r, enamel)); g.add(rod(a.clone().sub(s), c.clone().sub(s), r, enamel)); return s; };
    const s1 = pair(p0, LAMP.elbow, .0045); pair(LAMP.elbow, LAMP.head, .0042);
    const joint = (p, s) => { const j = rod(p.clone().addScaledVector(s, 1.6), p.clone().addScaledVector(s, -1.6), .009, brass, 16); g.add(j); };
    joint(p0, s1); joint(LAMP.elbow, s1); joint(LAMP.head, new V3().crossVectors(new V3().subVectors(LAMP.head, LAMP.elbow), new V3(0, 1, 0)).normalize().multiplyScalar(.011));
    // tension springs along the lower arm
    { const a = p0.clone().add(new V3(0, .03, .0)), c = LAMP.elbow.clone().add(new V3(0, -.08, 0)), d = new V3().subVectors(c, a), Lr = d.length(); d.normalize();
      const off = new V3().crossVectors(d, s1).normalize().multiplyScalar(.016), side = s1.clone().normalize(), w = new V3().crossVectors(d, side).normalize();
      for (const sg of [1, -1]){ const pts = []; for (let i = 0; i <= 220; i++){ const t = i / 220, th = t * 46 * Math.PI * 2;
          pts.push(a.clone().addScaledVector(d, t * Lr).add(off).addScaledVector(side, sg * .011 + Math.cos(th) * .0032).addScaledVector(w, Math.sin(th) * .0032)); }
        g.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 260, .0007, 4), brass)); } }
    // the shade: a bell with a rolled lip. Outside, glossy dark enamel that keeps a soft edge against the room;
    // inside, white enamel lit by the bulb itself (baked as a gradient: hot round the bulb, falling off toward the
    // mouth), and a pale rolled lip where the two meet, so it reads as a cone you can see into, not a flat disc
    const prof = [[0, 0], [.018, 0], [.024, -.006], [.028, -.03], [.036, -.056], [.052, -.086], [.068, -.11], [.073, -.118], [.0745, -.122], [.071, -.123]].reverse().map(([x, y]) => new THREE.Vector2(x, y)); // bottom-up so normals face out
    const shade = new THREE.Group();
    const shadeOuterM = new THREE.MeshPhysicalMaterial({ color: lin(0x26332b), roughness: .34, metalness: .25, clearcoat: .7, clearcoatRoughness: .3 });
    shadeOuterM.onBeforeCompile = sh => {   // a faint warm fresnel edge (the lit desk below reflected in the enamel)
      sh.uniforms.uRim = shadeRim;
      sh.fragmentShader = 'uniform float uRim;\n' + sh.fragmentShader.replace('#include <output_fragment>',
        'float shF = pow(1. - clamp(dot(normalize(normal), normalize(vViewPosition)), 0., 1.), 3.);\n outgoingLight += vec3(.06, .045, .03) * shF * uRim;\n#include <output_fragment>');
    };
    shade.add(mesh(new THREE.LatheGeometry(prof, 64), shadeOuterM));
    const innerG = new THREE.LatheGeometry(prof.slice(1).map(v => new THREE.Vector2(v.x * .975, v.y + .0012)), 64);
    { const P = innerG.attributes.position, C = new Float32Array(P.count * 3), bz = -.074;
      for (let i = 0; i < P.count; i++){ const r = Math.hypot(P.getX(i), P.getZ(i)), y = P.getY(i), d = Math.hypot(r, y - bz);
        // inverse-square from the bulb, softened, with a slight warm shift as it falls off toward the mouth
        const k = clamp(Math.pow(.052 / Math.max(d, .03), 2), .18, 1.4), m = sstep(-.06, -.122, y);
        C[i * 3] = 1.25 * k; C[i * 3 + 1] = (1.02 - .1 * m) * k; C[i * 3 + 2] = (.74 - .16 * m) * k; }
      innerG.setAttribute('color', new THREE.BufferAttribute(C, 3)); }
    const innerM = shadeInnerMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xffffff, side: THREE.BackSide });
    shade.add(mesh(innerG, innerM, false));
    // the rolled lip: a pale edge that catches the bulb
    const lipM = shadeLipMat = new THREE.MeshStandardMaterial({ color: lin(0xd9cdb6), emissive: lin(0xffc98f), emissiveIntensity: .35, roughness: .5 });
    const lipR = mesh(new THREE.TorusGeometry(.0728, .0016, 8, 72), lipM, false); lipR.rotation.x = Math.PI / 2; lipR.position.y = -.1222; shade.add(lipR);
    bulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, .86, .62), toneMapped: false });
    const bulb = mesh(new THREE.SphereGeometry(.024, 24, 16), bulbMat, false);
    bulb.position.y = -.074; shade.add(bulb);
    shade.add(mesh(new THREE.CylinderGeometry(.012, .016, .03, 16), brass)); // socket collar
    shade.position.copy(LAMP.head).addScaledVector(lampDir, -.02);
    shade.quaternion.setFromUnitVectors(new V3(0, -1, 0), lampDir);
    g.add(shade); shade.updateMatrixWorld(true);
    bulb.getWorldPosition(bulbPos);
    g.traverse(o => { if (o.isMesh && o !== bulb && o.material !== innerM && o.material !== lipM) o.castShadow = true; });
  }

  /* ================= LIGHTS ================= */
  const KEY_BOUNCE = .12;
  // the lamp: warm 2700K spot with soft shadows
  const lamp = new THREE.SpotLight(lin(0xffe7cf), 5.6, 4, .8, .72, 2);
  lamp.position.copy(bulbPos); lamp.target.position.copy(bulbPos).addScaledVector(lampDir, 1);
  lamp.castShadow = true; lamp.shadow.mapSize.set(1024, 1024); lamp.shadow.camera.near = .05; lamp.shadow.camera.far = 2.4;
  lamp.shadow.bias = -.0004; lamp.shadow.normalBias = .004;
  scene.add(lamp, lamp.target);
  // bounce off the lit desk: a low warm fill that keeps the darks from going dead
  const bounce = new THREE.PointLight(lin(0xa8927e), .2, 2.5, 2); bounce.position.set(-.08, DESK_Y + .09, .16); scene.add(bounce);
  // the tube lights the room: a wide, shadowless green-white spot from the glass
  const glow = new THREE.SpotLight(new THREE.Color(PHOSPHOR[0] * .8, PHOSPHOR[1], PHOSPHOR[2] * .9), .5, 3, 1.25, 1, 2);
  glow.position.copy(screenCenter).addScaledVector(screenNormal, .02); glow.target.position.copy(screenCenter).addScaledVector(screenNormal, 1).add(new V3(0, -.35, 0));
  scene.add(glow, glow.target);
  // spill: the tube also washes its own bezel, the lip and the front of the case in soft green (the spot can't, it faces away)
  const spill = new THREE.PointLight(new THREE.Color(.82, 1, .86), .03, .9, 2);   // mostly white: a green wash turns the beige olive
  spill.position.copy(screenCenter).addScaledVector(screenNormal, .1); scene.add(spill);
  // night through the window: a cool rim from behind the machine, and a whisper of ambient
  const moon = new THREE.DirectionalLight(lin(0x6f86b8), .18); moon.position.set(WIN.x, WIN.y + .3, WALL_Z - 1); moon.target.position.set(.2, .9, .8); scene.add(moon, moon.target);
  const hemi = new THREE.HemisphereLight(lin(0x405070), lin(0x1a120c), .34); scene.add(hemi);
  screenU.uLamp.value.copy(bulbPos);

  /* ---- a faint light shaft under the shade (no dust: specks read as stars against the dark wall) ---- */
  const shaftAmt = { value: 1 };
  {
    const len = bulbPos.distanceTo(LAMP.target) * 1.05, r0 = .06, r1 = len * Math.tan(.6) * .95;
    const cg = new THREE.CylinderGeometry(r0, r1, len, 40, 1, true); cg.translate(0, -len / 2, 0);
    const cone = new THREE.Mesh(cg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uLen: { value: len }, uAmt: shaftAmt },
      vertexShader: `varying float vA; varying vec3 vN; varying vec3 vV; uniform float uLen;
        void main(){ vA = -position.y / uLen; vec4 w = modelMatrix * vec4(position, 1.); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz);
          gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `varying float vA; varying vec3 vN; varying vec3 vV; uniform float uAmt;
        void main(){ float e = pow(abs(dot(vN, vV)), 2.2); float a = e * pow(1. - vA, 1.4) * smoothstep(0., .08, vA) * .05 * uAmt;
          gl_FragColor = vec4(vec3(1., .78, .52) * a, 1.); }`,
    }));
    cone.position.copy(bulbPos); cone.quaternion.setFromUnitVectors(new V3(0, -1, 0), lampDir); cone.renderOrder = 2; scene.add(cone);
  }
  /* ================= PROPS ================= */
  {
    // mug: speckled cream stoneware with an iron-brown dipped rim, coffee gone cold
    const mugC = paint(256, 128, (u, v, o) => { const s = vnoise(u * 300, v * 150), rim = sstep(.86, .9, v);
      o[0] = lerp(.82, .32, rim); o[1] = lerp(.78, .19, rim); o[2] = lerp(.68, .11, rim); if (s > .86 && rim < .5){ o[0] *= .45; o[1] *= .42; o[2] *= .4; } });
    const mugM = new THREE.MeshPhysicalMaterial({ map: tex(mugC), roughness: .35, clearcoat: .6, clearcoatRoughness: .2 });
    const prof = [[0, .001], [.034, 0], [.039, .004], [.0405, .02], [.041, .092], [.0395, .096], [.036, .096], [.035, .092], [.0345, .01], [0, .009]].map(([x, y]) => new THREE.Vector2(x, y));
    const mug = new THREE.Group(); mug.add(mesh(new THREE.LatheGeometry(prof, 40), mugM));
    const hdl = mesh(new THREE.TorusGeometry(.024, .0058, 10, 24, Math.PI * 1.1), mugM); hdl.rotation.z = -Math.PI / 2 - .17; hdl.position.set(.04, .05, 0); mug.add(hdl);
    const cof = mesh(new THREE.CircleGeometry(.0345, 32), new THREE.MeshPhysicalMaterial({ color: lin(0x1a0d06), roughness: .15, clearcoat: 1 }), false); cof.rotation.x = -Math.PI / 2; cof.position.y = .072; mug.add(cof);
    mug.position.set(.38, DESK_Y, -.02); mug.rotation.y = -2.2; scene.add(mug);

    // notebook (A5, navy cloth), elastic band, a pen laid across it
    const nb = new THREE.Group();
    const clothC = paint(128, 128, (u, v, o) => { const n = .9 + .1 * vnoise(u * 90, v * 90) + .06 * Math.sin(u * 400) * Math.sin(v * 400); o[0] = .09 * n; o[1] = .12 * n; o[2] = .2 * n; });
    const cover = new THREE.MeshStandardMaterial({ map: tex(clothC), roughness: .85 });
    const pages = new THREE.MeshStandardMaterial({ color: lin(0xe6dcc6), roughness: .9 });
    const c1 = mesh(roundedBox(.148, .0025, .21, .001, 1), cover); c1.position.y = .00125; nb.add(c1);
    const pg = mesh(new THREE.BoxGeometry(.142, .011, .204), pages); pg.position.set(.001, .0075, 0); nb.add(pg);
    const c2 = mesh(roundedBox(.148, .0025, .21, .001, 1), cover); c2.position.y = .0142; nb.add(c2);
    const band = mesh(new THREE.BoxGeometry(.006, .0165, .211), new THREE.MeshStandardMaterial({ color: lin(0x111111), roughness: .6 })); band.position.set(.058, .0078, 0); nb.add(band);
    const pen = new THREE.Group();
    pen.add(mesh(new THREE.CylinderGeometry(.0045, .0045, .13, 16), new THREE.MeshStandardMaterial({ color: lin(0x121212), roughness: .3, metalness: .2 })));
    const tip = mesh(new THREE.ConeGeometry(.0045, .016, 16), new THREE.MeshStandardMaterial({ color: lin(0xb08a52), metalness: .9, roughness: .3 })); tip.position.y = -.073; tip.rotation.x = Math.PI; pen.add(tip);
    const clip = mesh(new THREE.BoxGeometry(.0018, .045, .003), new THREE.MeshStandardMaterial({ color: lin(0xb08a52), metalness: .9, roughness: .3 })); clip.position.set(0, .04, .005); pen.add(clip);
    pen.rotation.set(Math.PI / 2, 0, .5); pen.position.set(-.01, .0205, .01); nb.add(pen);
    nb.position.set(-.33, DESK_Y, .14); nb.rotation.y = .32; scene.add(nb);

    // 3.5" floppies: one by the keyboard, two stacked beside the machine
    const labelC = (title) => { const [c, x] = cnv(256, 200); x.fillStyle = '#ece4d2'; x.fillRect(0, 0, 256, 200);
      x.fillStyle = '#b8413a'; x.fillRect(0, 0, 256, 14); x.strokeStyle = 'rgba(70,90,140,.35)'; x.lineWidth = 1.5;
      for (let y = 50; y < 200; y += 30){ x.beginPath(); x.moveTo(10, y); x.lineTo(246, y); x.stroke(); }
      x.fillStyle = '#20263a'; x.font = 'italic 600 30px "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive'; x.fillText(title, 16, 74); return tex(c); };
    const diskM = new THREE.MeshStandardMaterial({ color: lin(0x26282c), roughness: .45 });
    const shutM = new THREE.MeshStandardMaterial({ color: lin(0xb9bdc2), roughness: .3, metalness: 1 });
    const disk = (title, x, y, z, ry) => { const d = new THREE.Group();
      d.add(mesh(roundedBox(.09, .0033, .094, .0012, 1), diskM));
      const sh = mesh(new THREE.BoxGeometry(.048, .0037, .03), shutM); sh.position.set(-.008, 0, -.032); d.add(sh);
      const lb = mesh(new THREE.PlaneGeometry(.07, .052), new THREE.MeshStandardMaterial({ map: labelC(title), roughness: .8 }), false);
      lb.rotation.x = -Math.PI / 2; lb.position.set(0, .00168, .016); d.add(lb);
      d.position.set(x, y + .00165, z); d.rotation.y = ry; scene.add(d); };
    disk('eden', .28, DESK_Y, .27, -.42);
    disk('system', .27, DESK_Y, -.08, .18); disk('notes 86', .272, DESK_Y + .0034, -.08, .3);

    // a snake plant in a dark glazed pot, silhouetted against the window
    const pot = mesh(new THREE.LatheGeometry([[0, 0], [.05, 0], [.056, .005], [.062, .11], [.066, .114], [.063, .117], [0, .105]].map(([x, y]) => new THREE.Vector2(x, y)), 32),
      new THREE.MeshPhysicalMaterial({ color: lin(0x2b2420), roughness: .3, clearcoat: .5 }));
    pot.position.set(-.64, DESK_Y, -.31); scene.add(pot);
    const leafM = new THREE.MeshStandardMaterial({ color: lin(0x2c3d26), roughness: .55, side: THREE.DoubleSide });
    seed = 21;
    for (let i = 0; i < 9; i++){
      const h = .25 + rnd() * .3, w = .016 + rnd() * .014, s = new THREE.Shape();
      s.moveTo(-w * .55, 0); s.bezierCurveTo(-w, h * .4, -w * .8, h * .8, 0, h); s.bezierCurveTo(w * .8, h * .8, w, h * .4, w * .55, 0); s.lineTo(-w * .55, 0);
      const lg = new THREE.ShapeGeometry(s, 10); const P = lg.attributes.position;
      const bend = (rnd() - .5) * .9, twist = (rnd() - .5) * 1.4;
      for (let j = 0; j < P.count; j++){ const x = P.getX(j), y = P.getY(j), t = y / h; P.setXYZ(j, x * Math.cos(twist * t), y, x * Math.sin(twist * t) + bend * t * t * h * .5); }
      lg.computeVertexNormals();
      const lf = mesh(lg, leafM); const a = i / 9 * Math.PI * 2 + rnd();
      lf.position.set(-.64 + Math.cos(a) * .022, DESK_Y + .1, -.31 + Math.sin(a) * .022); lf.rotation.set((rnd() - .5) * .35, a, (rnd() - .5) * .35); scene.add(lf);
    }
  }

  /* ================= THE CHAIR ================= */
  const SEAT = new V3(0, .5, .68);
  {
    const fabC = paint(128, 128, (u, v, o) => { const n = .85 + .15 * vnoise(u * 120, v * 120) + .05 * Math.sin((u + v) * 500); o[0] = .075 * n; o[1] = .072 * n; o[2] = .07 * n; });
    const fab = new THREE.MeshStandardMaterial({ map: tex(fabC), roughness: .95 });
    const metal = new THREE.MeshStandardMaterial({ color: lin(0x1c1c1e), roughness: .4, metalness: .7 });
    const ch = new THREE.Group();
    const seat = mesh(roundedBox(.46, .065, .44, .028, 3), fab); seat.position.set(0, -.0325, 0); ch.add(seat);
    const back = mesh(roundedBox(.42, .34, .055, .025, 3), fab); back.position.set(0, .33, .25); back.rotation.x = -.12; ch.add(back);
    ch.add(rod(new V3(0, -.065, .16), new V3(0, -.06, .26), .012, metal)); ch.add(rod(new V3(0, -.06, .26), new V3(0, .17, .265), .012, metal));
    ch.add(rod(new V3(0, -.07, 0), new V3(0, -SEAT.y + .1, 0), .022, metal));
    for (let i = 0; i < 5; i++){ const a = i / 5 * Math.PI * 2 + .3, e = new V3(Math.cos(a) * .3, -SEAT.y + .06, Math.sin(a) * .3);
      ch.add(rod(new V3(0, -SEAT.y + .09, 0), e, .014, metal)); const w = mesh(new THREE.SphereGeometry(.024, 12, 8), metal); w.position.copy(e).add(new V3(0, -.035, 0)); ch.add(w); }
    ch.position.copy(SEAT); ch.rotation.y = -.04; scene.add(ch);
  }

  /* ================= CAMERA: the typist's own eyes ================= */
  /* One view: the typist's eyes. At rest the camera is square-on to the tube with the glass filling the frame;
     looking down blends toward a second solved shot, sat back and above, that takes in the machine, the keyboard
     and both hands (see solveShots). The resting eye (rig.eye) sits ~0.6 m from the glass and a little above it. */
  const D2R = Math.PI / 180;
  const LOOK = { down: 35 * D2R };
  const REST_FILL = .76;                      // glass height / frame height at rest
  const YAW_REST = 7 * D2R, YAW_FULL = 8 * D2R, UP_MAX = 2.5 * D2R;   // how far the head turns: little while reading, more when leaned back
  const flatN = new V3(screenNormal.x, 0, screenNormal.z).normalize();
  const EYE_D = .6, EYE_UP = .125;
  const eyeRest = screenCenter.clone().addScaledVector(flatN, EYE_D); eyeRest.y = screenCenter.y + EYE_UP;
  const aimRest = screenCenter.clone().add(new V3(0, -.003, 0));
  const restDir = new V3().subVectors(aimRest, eyeRest).normalize();
  const YAW0 = Math.atan2(-restDir.x, -restDir.z), PITCH0 = Math.asin(restDir.y);
  let aspect = 16 / 10;
  // critically damped springs (x, v, target) for yaw/pitch
  const yawS = { x: 0, v: 0, t: 0 }, pitchS = { x: 0, v: 0, t: 0 };
  const crit = (s, w, dt) => { let rem = dt; while (rem > 1e-6){ const h = Math.min(rem, 1 / 240); rem -= h;
    s.v += (w * w * (s.t - s.x) - 2 * w * s.v) * h; s.x += s.v * h; } };
  /* Two solved shots; the pointer blends between them (setLook: down leans back).
     'screen': square-on to the tube, close, the glass filling the frame (the reading view, at rest).
     'full'  : sat back and above, looking down: the whole machine, the whole keyboard and both hands. */
  const camN = screenNormal.clone().normalize();
  const camQS = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new V3(), camN.clone().negate(), new V3(0, 1, 0)));
  const camUpS = new V3(0, 1, 0).applyQuaternion(camQS);
  const FULL = { back: .62, up: .42, kbFront: .05 };
  const eyeFull = eyeRest.clone().addScaledVector(flatN, FULL.back); eyeFull.y += FULL.up;
  eyeFull.x = (screenCenter.x + keyboardCenter.x) / 2;
  const fullPts = (() => {
    const ps = [], gx = new V3().crossVectors(new V3(0, 1, 0), flatN).normalize();
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) ps.push(screenCenter.clone().addScaledVector(gx, sx * (GW / 2 + .035)).add(new V3(0, sy * (GH / 2 + .035), 0)));
    const kx = new V3(Math.cos(KB.yaw), 0, -Math.sin(KB.yaw)), kz = new V3(Math.sin(KB.yaw), 0, Math.cos(KB.yaw));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) ps.push(keyboardCenter.clone().addScaledVector(kx, sx * (KB.w / 2 + .02)).addScaledVector(kz, sz > 0 ? KB.d / 2 + FULL.kbFront : -KB.d / 2));
    return ps;
  })();
  const shot = { screen: { pos: new V3(), q: new THREE.Quaternion(), fov: 30 }, full: { pos: eyeFull.clone(), q: new THREE.Quaternion(), fov: 40 } };
  function solveShots(){
    // screen: the glass fills ~72% of the height (or ~84% of the width on narrow windows), dead centre, square-on,
    // so the bezel and a margin of the case frame it all round
    const fovS = 30, tv = Math.tan(fovS / 2 * D2R);
    const need = Math.max((GH / 2) / REST_FILL, (GW / 2) / (.84 * aspect));
    shot.screen.pos.copy(screenCenter).addScaledVector(camN, need / tv).addScaledVector(camUpS, .0);
    shot.screen.q.copy(camQS); shot.screen.fov = fovS;
    // full: aim and fov solved so the machine, keyboard and hands sit centred with a small margin
    const inv = new THREE.Matrix4(), m = new THREE.Matrix4(), e = new THREE.Euler(0, 0, 0, 'YXZ');
    let yaw = YAW0, pitch = PITCH0 - .3, tvv = .3, th = .3;
    for (let it = 0; it < 8; it++){
      e.set(pitch, yaw, 0); shot.full.q.setFromEuler(e);
      m.compose(eyeFull, shot.full.q, new V3(1, 1, 1)); inv.copy(m).invert();
      let vmin = 9, vmax = -9, hmin = 9, hmax = -9;
      for (const p of fullPts){ const c = p.clone().applyMatrix4(inv), d = -c.z, av = Math.atan2(c.y, d), ah = Math.atan2(c.x, d);
        vmin = Math.min(vmin, av); vmax = Math.max(vmax, av); hmin = Math.min(hmin, ah); hmax = Math.max(hmax, ah); }
      pitch += (vmin + vmax) / 2; yaw -= (hmin + hmax) / 2;
      tvv = Math.tan((vmax - vmin) / 2); th = Math.tan((hmax - hmin) / 2);
    }
    shot.full.fov = Math.min(85, 2 * Math.atan(Math.max(tvv, th / aspect) * 1.02) / D2R);
  }
  const _q = new THREE.Quaternion();
  const _qy = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _Y = new V3(0, 1, 0), _X = new V3(1, 0, 0);
  function applyCamera(){
    // the pointer looks around: down leans back toward the full view (the hands), sideways/up turn the head a little
    const down = clamp(-pitchS.x / LOOK.down, 0, 1);
    const k = sstep(0, 1, down);
    // narrow windows turn less, so the glass never leaves more than ~15% of itself out of frame while reading, and
    // the whole keyboard stays in the lean view at either extreme
    const lookUp = Math.max(0, pitchS.x), lookYaw = yawS.x * lerp(YAW_REST * Math.min(1, Math.pow(aspect / 1.25, 1.8)), YAW_FULL * Math.min(1, Math.pow(aspect / 1.6, 1.5)), k);
    camera.position.lerpVectors(shot.screen.pos, shot.full.pos, k);
    // the head travels a slight arc (up and back first) rather than a straight dolly
    camera.position.y += Math.sin(k * Math.PI) * .04;
    _q.copy(shot.screen.q).slerp(shot.full.q, k);
    _qy.setFromAxisAngle(_Y, lookYaw); _qp.setFromAxisAngle(_X, lookUp * (1 - .5 * k));
    camera.quaternion.copy(_qy).multiply(_q).multiply(_qp);
    const fov = lerp(shot.screen.fov, shot.full.fov, k);
    camera.fov = fov; camera.aspect = aspect; camera.updateProjectionMatrix();
  }
  /* never see inside the typist's head: anything added to the scene whose bounds wrap the eye is hidden */
  const added = [], hidden = new Set(), _sph = new THREE.Sphere();
  function hideNearEye(){
    for (const m of hidden){ m.visible = true; } hidden.clear();
    for (const root of added) root.traverse(m => {
      if (!m.isMesh || !m.visible || !m.geometry) return;
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      _sph.copy(m.geometry.boundingSphere).applyMatrix4(m.matrixWorld);
      if (_sph.distanceToPoint(camera.position) < camera.near + .045){ m.visible = false; hidden.add(m); }
    });
  }

  /* ================= SCREEN TEXTURE & GLOW ================= */
  let screenTex = null, screenCanvas = null, lumDirty = false, lumTimer = 0, lumTarget = .35, lum = .35, lumFed = false;
  const lc = document.createElement('canvas'); lc.width = 16; lc.height = 12; const lx = lc.getContext('2d', { willReadFrequently: true });
  function sampleLum(){
    if (!screenCanvas) return; try { lx.drawImage(screenCanvas, 0, 0, 16, 12); const d = lx.getImageData(0, 0, 16, 12).data; let s = 0;
      for (let i = 0; i < d.length; i += 4) s += .299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]; lumTarget = s / (d.length / 4) / 255; } catch (e){ /* tainted canvas: keep the default */ }
  }

  /* ================= THE LAMP SWITCH ================= */
  /* setLamp(true): the switch clicks, a beat later the filament catches, stutters twice, then swells in from a deep
     orange to its full 2700K. setLamp(false): the filament glows down over ~150 ms. With the lamp off the eye
     adapts (a slow exposure lift) and the tube and the window carry the room. */
  const LAMP_COL = lin(0xffe7cf), LAMP_DIM = lin(0xff8a3c), BULB_HOT = new THREE.Color(1, .86, .62), BULB_DIM = new THREE.Color(1, .36, .08);
  const FLICK = [0, .55, .08, .0, .8, .25, .9, .45, .7];   // 40 ms steps after the relay delay
  const lampS = { on: true, t: 9, level: 1, adapt: 0 };
  const _c = new THREE.Color();
  function lampLevel(dt){
    if (lampS.on){
      lampS.t += dt; const t = lampS.t;
      if (REDUCED){ lampS.level += (1 - lampS.level) * (1 - Math.exp(-dt * 5)); return; }
      if (t < .16) lampS.level *= Math.exp(-dt * 20);
      else if (t < .16 + FLICK.length * .04) lampS.level = FLICK[Math.floor((t - .16) / .04)];
      else { const f = t - .16 - FLICK.length * .04; lampS.level = Math.max(lampS.level, .45 + .55 * (1 - Math.exp(-f * 3.2))); if (f > 3) lampS.level = 1; }
    } else lampS.level *= Math.exp(-dt * (REDUCED ? 8 : 16));
  }
  function applyLamp(dt){
    const L = lampS.level, warm = sstep(.2, 1, L), off = 1 - sstep(0, .8, L);
    lamp.intensity = 5.6 * L; lamp.visible = L > .002;
    lamp.color.copy(LAMP_DIM).lerp(LAMP_COL, warm);
    bounce.intensity = .2 * L; keyBounce.value = KEY_BOUNCE * L;
    shadeInnerMat.color.setScalar(.03 + .97 * L); shadeLipMat.emissiveIntensity = .35 * L; shadeRim.value = L;
    _c.copy(BULB_DIM).lerp(BULB_HOT, warm).multiplyScalar(Math.min(1, L * 1.4));
    bulbMat.color.setRGB(.07 + _c.r, .065 + _c.g, .06 + _c.b);
    shaftAmt.value = Math.pow(L, 1.5);
    screenU.uLampAmt.value = L;
    // the eye opens up slowly in the dark, and snaps back when the light returns
    lampS.adapt += (off - lampS.adapt) * (1 - Math.exp(-dt * (off > lampS.adapt ? .9 : 4)));
    moon.intensity = .18 + .45 * lampS.adapt; hemi.intensity = .34 + .16 * lampS.adapt;
    renderer.toneMappingExposure = 1.05 + .75 * lampS.adapt;
  }

  /* ================= API ================= */
  let frames = 0, slowAcc = 0, perfT = 0, sag = 0;
  /* the reveal: from black, the tube powers on (a bright line opens into the raster) while the lamp glows up and
     the eye adapts. ~1.3 s; the first keystroke or a lean skips to the end. Reduced motion: no reveal. */
  const intro = { t: REDUCED ? 9 : 0, end: 1.35 };
  const skipIntro = () => { if (intro.t < intro.end) intro.t = intro.end; };
  /* render on demand: the loop calls render() every frame, but a still picture (settled camera, no key or lamp
     motion, nothing new on the tube) is drawn at ~20 fps so the flicker keeps breathing at a fraction of
     the GPU cost. The shadow map re-renders only while hands or keys move, plus a slow refresh for idle fidgets. */
  let sinceMove = 0, sinceRender = 9, screenDirty = true, shadowAge = 9, drew = false, warmed = false;
  const _ray = new THREE.Raycaster(), _ndc = new THREE.Vector2();
  const api = {
    renderer, scene, camera, screenAspect: SCREEN_ASPECT,
    setScreenCanvas(c){
      screenCanvas = c;
      if (screenTex) screenTex.dispose();
      screenTex = new THREE.CanvasTexture(c);
      // read up close: no mipmaps (they blur text at mild minification); the shader box-filters per pixel instead
      screenTex.minFilter = THREE.LinearFilter; screenTex.magFilter = THREE.LinearFilter; screenTex.generateMipmaps = false; screenTex.anisotropy = 1;
      screenTex.encoding = THREE.LinearEncoding; screenTex.wrapS = screenTex.wrapT = THREE.ClampToEdgeWrapping;
      screenU.uTex.value = screenTex; screenU.uHas.value = 1; screenU.uRes.value.set(c.width, c.height); lumDirty = true;
    },
    setScreenLum(v){ if (v >= 0 && v <= 1){ lumTarget = v; lumFed = true; } },   // the terminal tallies its own brightness: no pixel readback
    markScreenDirty(){ if (screenTex){ screenTex.needsUpdate = true; lumDirty = true; screenDirty = true; } },
    /* clientX/Y -> where that point lands on the terminal canvas: {u, v} in 0..1 from its top-left, or null off the
       image. Follows the CRT shader's mapping (barrel bow, then the overscan inset), so it matches what is drawn. */
    pickScreen(cx, cy){
      const r = renderer.domElement.getBoundingClientRect(); if (!r.width || !r.height) return null;
      _ndc.set((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      _ray.setFromCamera(_ndc, camera);
      const hit = _ray.intersectObject(glass, false)[0]; if (!hit || !hit.uv) return null;
      const x = hit.uv.x - .5, y = hit.uv.y - .5, b = 1 + .055 * (x * x + y * y);
      const I = screenU.uInset.value, u = (x * b + .5 - I.x) / (1 - 2 * I.x), v = (y * b + .5 - I.y) / (1 - 2 * I.y);
      if (u < 0 || u > 1 || v < 0 || v > 1) return null;
      return { u, v: 1 - v };
    },
    keyboard: {
      hasKey: code => keys.has(code) || keys.has(ALIAS[code]),
      keyWorldPos(code){ const k = keys.get(code) || keys.get(ALIAS[code]); return k ? k.world.clone() : null; },
      keyRow(code){ const k = keys.get(code) || keys.get(ALIAS[code]); return k ? k.row : -1; },
      press(code){ const k = keys.get(code) || keys.get(ALIAS[code]); if (k){ k.target = -TRAVEL; activeKeys.add(k); sinceMove = 0; api.nudge(); } },
      release(code){ const k = keys.get(code) || keys.get(ALIAS[code]); if (k){ k.target = 0; activeKeys.add(k); } },
    },
    rig: { seat: SEAT.clone(), keyboardCenter, keyboardNormal, screenCenter: screenCenter.clone(), lampPosition: bulbPos.clone(), keySpacing: U,
      eye: eyeRest.clone(),          // where the camera (the typist's eyes) sits at rest, world space
      // for room dressing: put wall props on z = wallZ and keep them out of windowRect
      deskTop: DESK_Y, wallZ: WALL_Z, windowRect: { x: WIN.x - WIN.hw - .05, y: WIN.y - WIN.hh - .025, w: WIN.hw * 2 + .1, h: WIN.hh * 2 + .045 } }, // x, y = lower-left corner, includes the trim and sill
    add(o){ scene.add(o); added.push(o); o.traverse(m => { if (m.isMesh && !m.userData.noShadow) m.castShadow = true; }); },
    /* the desk lamp: true/false; get lampOn for the current switch state */
    setLamp(on){ on = !!on; if (on === lampS.on) return; lampS.on = on; lampS.t = 0; sag = REDUCED ? 0 : 1; },
    get lampOn(){ return lampS.on; },
    /* nx, ny in -1..1 from the pointer (0,0 = the screen). ny > 0 looks down toward the keyboard. */
    setLook(nx, ny){
      nx = clamp(+nx || 0, -1, 1); ny = clamp(+ny || 0, -1, 1);
      // a wide dead zone around the reading view: the whole upper half of the window and the middle band are rest,
      // so the screen holds still while the cursor wanders over it. Leaning back starts three quarters of the way down and is complete near the bottom edge.
      // yaw is normalised here (-1..1) and scaled in applyCamera: ~4.5 deg while reading, ~10 deg leaned back.
      const ax = Math.abs(nx), sx = sstep(.18, .95, ax);
      yawS.t = -Math.sign(nx) * sx;
      pitchS.t = ny > 0 ? -sstep(.5, .92, ny) * LOOK.down : sstep(.45, 1, -ny) * UP_MAX;
    },
    /* a keystroke: skips the intro reveal and wakes the (idle-throttled) renderer */
    nudge(){ skipIntro(); sinceMove = 0; },
    update(dt, t){
      if (intro.t < intro.end && pitchS.t < -.2) skipIntro();   // leaning back skips the reveal too
      const drewLast = drew; drew = false;
      sinceMove += dt; sinceRender += dt;
      if (Math.abs(yawS.v) + Math.abs(pitchS.v) > 2e-3 || Math.abs(yawS.t - yawS.x) + Math.abs(pitchS.t - pitchS.x) > 1e-3) sinceMove = 0;
      crit(yawS, 6, dt); crit(pitchS, 5.6, dt);   // critically damped: settles in ~0.8 s, never overshoots
      applyCamera();
      // keys: a stiff spring down, a looser one back up with a small overshoot
      for (const k of activeKeys){
        const down = k.target < 0, w = down ? 75 : 62, z = down ? 1 : .5;
        let rem = dt; while (rem > 1e-6){ const h = Math.min(rem, 1 / 300); rem -= h;
          k.vel += (-w * w * (k.off - k.target) - 2 * z * w * k.vel) * h; k.off += k.vel * h; }
        if (k.off < -TRAVEL){ k.off = -TRAVEL; k.vel = 0; } // bottomed out
        k.holder.position.y = k.restY + k.off;
        if (Math.abs(k.off - k.target) < 2e-6 && Math.abs(k.vel) < 1e-4){ k.off = k.target; k.holder.position.y = k.restY + k.off; activeKeys.delete(k); }
      }
      // tube: flicker, roll, and how much light the text throws into the room
      screenU.uTime.value = t;
      screenU.uFlicker.value = REDUCED ? 1 : 1 + .0045 * Math.sin(t * 2 * Math.PI * 7.7) + .003 * Math.sin(t * 2 * Math.PI * 1.3) + .002 * (Math.random() - .5);
      lumTimer -= dt; if (lumDirty && !lumFed && lumTimer <= 0){ lumDirty = false; lumTimer = 1.2; sampleLum(); }   // a GPU->CPU readback of the terminal canvas: keep it rare
      lum += (lumTarget - lum) * (1 - Math.exp(-dt * 4));
      lampLevel(dt);
      if (intro.t < intro.end + .5){
        intro.t += dt; const it = intro.t;
        // the lamp's filament glows up a beat after the tube; the eye opens from black over the first half second
        lampS.level = Math.min(lampS.level, lampS.on ? sstep(.25, 1.25, it) : lampS.level);
        screenU.uWarm.value = clamp(it / 1.1, 0, 1);
        sinceMove = 0;
      } else {
        screenU.uWarm.value = 1;
        // once the reveal is over, compile every material that is still off-screen (desk, keys, room) on idle time,
        // so the first lean back does not stall on shader compiles
        if (!warmed){ warmed = true; const ric = window.requestIdleCallback || (f => setTimeout(f, 50)); ric(() => { try { renderer.compile(scene, camera); } catch (e){} }); }
      }
      applyLamp(dt);
      if (intro.t < intro.end + .5) renderer.toneMappingExposure *= sstep(0, .6, intro.t);
      // the tube sags for a moment when the lamp switches on or off: they share a wall socket
      if (sag > 0){ sag = Math.max(0, sag - dt * 5); sinceMove = 0; }
      screenU.uBright.value = 1 - .22 * Math.sin(Math.min(1, sag) * Math.PI) * (sag > .5 ? 1 : .6);
      if (lampS.level > .002 && lampS.level < .999) sinceMove = 0;
      // during the reveal the lamp is still dark and the eye is adapting, so an undamped tube light would wash the
      // beige case green: hold the tube's light on the room back until the lamp has come up
      const reveal = intro.t < intro.end + .5 ? sstep(.6, intro.end + .5, intro.t) : 1;
      glow.intensity = (.2 + .6 * Math.min(lum, .6)) * (screenU.uHas.value ? 1 : .4) * screenU.uFlicker.value * (1 + 1.6 * lampS.adapt) * (.25 + .75 * reveal);
      spill.intensity = (.0026 + .01 * Math.min(lum, .6)) * (screenU.uHas.value ? 1 : .4) * screenU.uFlicker.value * (1 + 1.2 * lampS.adapt) * reveal;
      // keep it smooth on modest GPUs: step the pixel ratio down if frames run long
      // only frames that were actually drawn count (idle frames are throttled), and not during the reveal
      if (drewLast && intro.t > intro.end){ perfT += dt; frames++; if (dt > .026) slowAcc++; }
      if (perfT > 2.5){ if (frames > 20 && slowAcc / frames > .5 && pixelRatio > 1){ pixelRatio = prCap = Math.max(1, pixelRatio - .25); renderer.setPixelRatio(pixelRatio);
          const s = renderer.getSize(new THREE.Vector2()); renderer.setSize(s.x, s.y, false); } perfT = 0; frames = 0; slowAcc = 0; }
    },
    render(){
      const busy = sinceMove < 1.6 || activeKeys.size > 0 || screenDirty;
      if (!busy && sinceRender < 1 / 20 - .004) return;
      sinceRender = 0; screenDirty = false; drew = true;
      // shadows: every frame while hands/keys/lamp move; otherwise a slow refresh (hands fidget), slower still at rest
      const leaned = sstep(0, 1, clamp(-pitchS.x / LOOK.down, 0, 1));
      shadowAge++;
      if (sinceMove < 1.6 || shadowAge > (leaned > .05 ? 3 : 20)){ renderer.shadowMap.needsUpdate = true; shadowAge = 0; }
      scene.updateMatrixWorld(); hideNearEye(); renderer.render(scene, camera);
    },
    resize(w, h){
      const pr = Math.min(prFor(w, h), prCap); if (Math.abs(pr - pixelRatio) > .01){ pixelRatio = pr; renderer.setPixelRatio(pr); }
      renderer.setSize(w, h, false); aspect = w / Math.max(1, h); screenDirty = true; camera.aspect = aspect; camera.updateProjectionMatrix();
      solveShots(); applyCamera();
    },
  };
  // test hook only: ?debug exposes the camera springs (e.g. pitchS.x = pitchS.t = -LOOK.down to force the lean)
  if (/[?&]debug\b/.test(location.search)) api._dbg = { yawS, pitchS, intro, shot, LOOK, lampS };
  api.resize(container.clientWidth || innerWidth, container.clientHeight || innerHeight);
  return api;
};
})();
