/* Typist: a dark silhouette at the desk whose hands press the same keys the visitor types.
   Everything is procedural (lathe / capsule / blob geometry) and lives under one root Group sitting on
   rig.seat. Arms are 2-bone IK, fingers are 3-segment planar IK, and every target runs through a
   critically damped spring, so bursts of fast typing stay fluid. */
(() => {
'use strict';
const M = window.MAC = window.MAC || {};

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const PI = Math.PI;

/* Exact critically damped spring step (stable for any dt). s = {x, v}. */
function spring(s, target, w, dt){
  const y = s.x - target, e = Math.exp(-w * dt), k = (s.v + w * y) * dt;
  s.x = target + (y + k) * e; s.v = (s.v - w * k) * e; return s.x;
}
class VSpring {
  constructor(v){ this.x = v.clone(); this.v = V3(); }
  step(t, w, dt){
    const e = Math.exp(-w * dt);
    for (const c of 'xyz'){ const y = this.x[c] - t[c], k = (this.v[c] + w * y) * dt; this.x[c] = t[c] + (y + k) * e; this.v[c] = (this.v[c] - w * k) * e; }
    return this.x;
  }
}
const S = x => ({ x, v: 0 });

/* ---------------- keyboard knowledge: standard ANSI layout (key-centre x in key units, row) ---------------- */
const LAYOUT = {};
const ROW = (r, s) => s.split(' ').forEach(t => { const [c, x] = t.split(':'); LAYOUT[c] = [+x, r]; });
ROW(-1, 'Escape:0.5 F1:2.5 F2:3.5 F3:4.5 F4:5.5 F5:7 F6:8 F7:9 F8:10 F9:11.5 F10:12.5 F11:13.5 F12:14.5');
ROW(0, 'Backquote:0.5 Digit1:1.5 Digit2:2.5 Digit3:3.5 Digit4:4.5 Digit5:5.5 Digit6:6.5 Digit7:7.5 Digit8:8.5 Digit9:9.5 Digit0:10.5 Minus:11.5 Equal:12.5 Backspace:14');
ROW(1, 'Tab:0.75 KeyQ:2 KeyW:3 KeyE:4 KeyR:5 KeyT:6 KeyY:7 KeyU:8 KeyI:9 KeyO:10 KeyP:11 BracketLeft:12 BracketRight:13 Backslash:14.25');
ROW(2, 'CapsLock:0.875 KeyA:2.25 KeyS:3.25 KeyD:4.25 KeyF:5.25 KeyG:6.25 KeyH:7.25 KeyJ:8.25 KeyK:9.25 KeyL:10.25 Semicolon:11.25 Quote:12.25 Enter:13.875');
ROW(3, 'ShiftLeft:1.125 IntlBackslash:1.5 KeyZ:2.75 KeyX:3.75 KeyC:4.75 KeyV:5.75 KeyB:6.75 KeyN:7.75 KeyM:8.75 Comma:9.75 Period:10.75 Slash:11.75 ShiftRight:14.125 ArrowUp:16.5');
ROW(4, 'ControlLeft:0.625 MetaLeft:1.875 AltLeft:3.125 Space:6.875 AltRight:10.625 MetaRight:11.875 ContextMenu:13.125 ControlRight:14.375 ArrowLeft:15.5 ArrowDown:16.5 ArrowRight:17.5');

/* Touch-typing finger map. Hand 0 = left, 1 = right; finger 0 = thumb, 1 index, 2 middle, 3 ring, 4 pinky. */
const FINGER = {};
const FM = (h, f, s) => s.split(' ').forEach(c => { FINGER[c] = [h, f]; });
FM(0, 4, 'Escape F1 F2 Backquote Digit1 Tab KeyQ CapsLock KeyA ShiftLeft IntlBackslash KeyZ ControlLeft');
FM(0, 3, 'F3 Digit2 KeyW KeyS KeyX');
FM(0, 2, 'F4 Digit3 KeyE KeyD KeyC');
FM(0, 1, 'F5 Digit4 Digit5 KeyR KeyT KeyF KeyG KeyV KeyB');
FM(0, 0, 'AltLeft MetaLeft');
FM(1, 0, 'AltRight MetaRight ContextMenu');
FM(1, 1, 'F6 F7 Digit6 Digit7 KeyY KeyU KeyH KeyJ KeyN KeyM ArrowLeft');
FM(1, 2, 'F8 Digit8 KeyI KeyK Comma ArrowUp ArrowDown');
FM(1, 3, 'F9 Digit9 KeyO KeyL Period ArrowRight');
FM(1, 4, 'F10 F11 F12 Digit0 Minus Equal Backspace KeyP BracketLeft BracketRight Backslash Semicolon Quote Enter Slash ShiftRight ControlRight');
const HOME = [[null, 'KeyF', 'KeyD', 'KeyS', 'KeyA'], [null, 'KeyJ', 'KeyK', 'KeyL', 'Semicolon']];

/* ---------------- geometry helpers ---------------- */
function weldNormals(g){
  g.computeVertexNormals();
  const P = g.attributes.position, N = g.attributes.normal, map = new Map();
  for (let i = 0; i < P.count; i++){
    const k = Math.round(P.getX(i) * 2e4) + ',' + Math.round(P.getY(i) * 2e4) + ',' + Math.round(P.getZ(i) * 2e4);
    let e = map.get(k); if (!e){ e = [0, 0, 0, []]; map.set(k, e); }
    e[0] += N.getX(i); e[1] += N.getY(i); e[2] += N.getZ(i); e[3].push(i);
  }
  for (const e of map.values()){ const l = Math.hypot(e[0], e[1], e[2]) || 1; for (const i of e[3]) N.setXYZ(i, e[0] / l, e[1] / l, e[2] / l); }
  N.needsUpdate = true; return g;
}
/* Lathe around +Y. prof = [[r, y], ...]. fold(angle, y) -> radial scale offset. post(v) reshapes the vertex. */
function lathe(prof, seg, fold, post){
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y)), seg);
  const P = g.attributes.position, v = V3();
  for (let i = 0; i < P.count; i++){
    v.fromBufferAttribute(P, i);
    const r = Math.hypot(v.x, v.z);
    if (fold && r > 2e-4){ const k = 1 + fold(Math.atan2(v.z, v.x), v.y); v.x *= k; v.z *= k; }
    if (post) post(v);
    P.setXYZ(i, v.x, v.y, v.z);
  }
  return weldNormals(g);
}
/* Tapered capsule along +Y from 0 to len. */
function capsule(r0, r1, len, seg = 12, fold){
  const prof = [], n = 5;
  for (let k = 0; k <= n; k++){ const a = -PI / 2 + PI / 2 * k / n; prof.push([r0 * Math.cos(a), r0 * Math.sin(a)]); }
  for (let k = 0; k <= n; k++){ const a = PI / 2 * k / n; prof.push([r1 * Math.cos(a), len + r1 * Math.sin(a)]); }
  return lathe(prof, seg, fold);
}
/* Smooth ellipsoid with optional displacement disp(x,y,z on unit sphere). */
function blob(rx, ry, rz, disp, ws = 20, hs = 14){
  const g = new THREE.SphereGeometry(1, ws, hs), P = g.attributes.position;
  for (let i = 0; i < P.count; i++){
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i), k = disp ? 1 + disp(x, y, z) : 1;
    P.setXYZ(i, x * rx * k, y * ry * k, z * rz * k);
  }
  return weldNormals(g);
}

/* ---------------- silhouette material: near-black with a fresnel rim lit by the CRT and the lamp ---------------- */
function makeMat(color, U){
  const m = new THREE.MeshStandardMaterial({ color, roughness: .82, metalness: 0 });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'varying vec3 vRimP;\nvarying vec3 vRimN;\n' + sh.vertexShader.replace('#include <fog_vertex>',
      '#include <fog_vertex>\n vRimP = (modelMatrix * vec4(transformed, 1.0)).xyz;\n vRimN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = 'uniform vec3 uRimScreen;\nuniform vec3 uRimLamp;\nuniform vec3 uRimCrt;\nuniform vec3 uRimWarm;\nuniform vec3 uRimAmb;\nvarying vec3 vRimP;\nvarying vec3 vRimN;\n' +
      sh.fragmentShader.replace('#include <output_fragment>', `
  {
    vec3 rN = normalize(vRimN); rN = gl_FrontFacing ? rN : -rN;
    vec3 rV = normalize(cameraPosition - vRimP);
    float rF = pow(1.0 - clamp(dot(rN, rV), 0.0, 1.0), 3.2);
    float sS = clamp(dot(rN, normalize(uRimScreen - vRimP)) * .65 + .35, 0.0, 1.0);
    float sL = clamp(dot(rN, normalize(uRimLamp - vRimP)) * .75 + .25, 0.0, 1.0);
    outgoingLight += rF * (uRimCrt * sS * sS + uRimWarm * sL * sL * sL + uRimAmb);
  }
#include <output_fragment>`);
  };
  m.customProgramCacheKey = () => 'mac-typist-rim';
  return m;
}

/* ---------------- planar finger IK table: tip of a 3-segment chain vs curl ---------------- */
function fingerTable(L, k2, cmax){
  const n = 64, d = [], a = [], c = [];
  for (let i = 0; i <= n; i++){
    const ci = cmax * i / n, p2 = ci, p3 = ci * (1 + k2);
    const u = L[0] + L[1] * Math.cos(p2) + L[2] * Math.cos(p3), v = L[1] * Math.sin(p2) + L[2] * Math.sin(p3);
    c.push(ci); d.push(Math.hypot(u, v)); a.push(Math.atan2(v, u));
  }
  return { c, d, a, n };
}

M.createTypist = function createTypist(api){
  const kb = api.keyboard, rig = api.rig;
  const root = new THREE.Group(); root.name = 'typist';

  /* ---------- placement & proportions from the real layout ---------- */
  const seatW = rig.seat.clone(), kbW = rig.keyboardCenter.clone(), scrW = rig.screenCenter.clone();
  const nW = (rig.keyboardNormal ? rig.keyboardNormal.clone() : V3(0, 1, 0)).normalize();
  const toScr = scrW.clone().sub(seatW); toScr.y = 0;
  if (toScr.lengthSq() < 1e-6) toScr.copy(kbW).sub(seatW).setY(0);
  if (toScr.lengthSq() < 1e-6) toScr.set(0, 0, -1);
  const kbRel = kbW.clone().sub(seatW), kbH = kbRel.y, kbD = Math.hypot(kbRel.x, kbRel.z);
  const s = clamp(.6 * (kbH / .27) + .4 * (kbD / .5), .85, 1.25);
  root.position.copy(seatW);
  root.rotation.y = Math.atan2(-toScr.x, -toScr.z);
  root.scale.setScalar(s);
  root.updateMatrixWorld(true);
  const invRootQ = root.quaternion.clone().invert();
  const toLocal = w => root.worldToLocal(w.clone());
  const dirLocal = w => w.clone().applyQuaternion(invRootQ).normalize();

  /* keyboard frame (world): lat = typist's right along the rows, fwd = away from typist, n = key-surface up */
  try { if (api.scene) api.scene.updateMatrixWorld(true); } catch (e){}   // key positions may not have been rendered yet
  const has = c => { try { return !!kb.hasKey(c); } catch (e){ return false; } };
  const wpos = c => { try { const p = has(c) && kb.keyWorldPos(c); return p ? p.clone() : null; } catch (e){ return null; } };
  const anchors = [];
  for (const c of ['KeyF', 'KeyJ', 'KeyD', 'KeyK', 'KeyS', 'KeyL', 'KeyA', 'KeyG', 'KeyH', 'KeyR', 'KeyU', 'KeyE', 'KeyI', 'KeyW', 'KeyO', 'KeyQ', 'KeyP', 'KeyV', 'KeyN', 'KeyC', 'KeyM', 'Digit5', 'Digit6', 'Space']){
    const p = wpos(c); if (p) anchors.push({ c, p, ux: LAYOUT[c][0], row: LAYOUT[c][1] });
  }
  let latW = null, uW = .019;
  for (let i = 0; i < anchors.length && !latW; i++) for (let j = i + 1; j < anchors.length; j++){
    const A = anchors[i], B = anchors[j];
    if (A.row === B.row && A.c !== 'Space' && B.c !== 'Space' && Math.abs(A.ux - B.ux) >= 1 && A.p.distanceTo(B.p) > 1e-4){
      const d = B.p.clone().sub(A.p); uW = d.length() / Math.abs(B.ux - A.ux); latW = d.multiplyScalar(Math.sign(B.ux - A.ux)).normalize(); break;
    }
  }
  if (!latW) latW = V3(1, 0, 0).applyQuaternion(root.quaternion);
  latW.sub(nW.clone().multiplyScalar(latW.dot(nW))).normalize();
  const fwdW = nW.clone().cross(latW).normalize();
  if (fwdW.dot(V3(0, 0, -1).applyQuaternion(root.quaternion)) < 0){ fwdW.negate(); latW.negate(); }
  const useAnchors = anchors.filter(a => a.c !== 'Space').slice(0, 6);
  function layoutWorld(code){
    const L = LAYOUT[code]; if (!L) return null;
    if (!useAnchors.length){ // no known keys at all: centre the standard layout on keyboardCenter
      return kbW.clone().addScaledVector(latW, (L[0] - 7.5) * uW).addScaledVector(fwdW, (2 - L[1]) * uW);
    }
    const acc = V3();
    for (const A of useAnchors) acc.add(A.p.clone().addScaledVector(latW, (L[0] - A.ux) * uW).addScaledVector(fwdW, (A.row - L[1]) * uW));
    return acc.multiplyScalar(1 / useAnchors.length);
  }
  /* key top in root-local space; real key if the scene has it, else the standard layout fitted to known keys */
  const keyLocal = code => { const p = wpos(code) || layoutWorld(code); return p ? toLocal(p) : null; };

  const n = dirLocal(nW), lat = dirLocal(latW), kfw = dirLocal(fwdW);
  const U_KEY = uW / s, TRAVEL = .0035 / s, HOVER = .005;

  /* ---------- materials ---------- */
  const U = {
    uRimScreen: { value: scrW.clone() }, uRimLamp: { value: kbW.clone().addScaledVector(latW, -.45).add(V3(0, .55, 0)) },
    uRimCrt: { value: new THREE.Color(0x7fe0b0).multiplyScalar(.26) }, uRimWarm: { value: new THREE.Color(0xffa860).multiplyScalar(.5) },
    uRimAmb: { value: new THREE.Color(0x1c2230).multiplyScalar(.25) },
  };
  const cloth = makeMat(0x060608, U), skin = makeMat(0x070505, U), hairM = makeMat(0x040405, U);
  const meshes = [];
  const mesh = (geo, mat, parent, pos, rot) => {
    const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = false;
    if (pos) m.position.copy(pos); if (rot) m.rotation.set(rot[0], rot[1], rot[2], rot[3] || 'XYZ');
    parent.add(m); meshes.push(m); return m;
  };

  /* ---------- body ---------- */
  const floorY = clamp(seatW.y > .2 ? -seatW.y / s : -.42, -.55, -.3);
  const hips = new THREE.Group(); root.add(hips);
  mesh(blob(.165, .085, .15, (x, y, z) => .03 * Math.sin(x * 6 + z * 4) * (y > 0 ? 1 : .3)), cloth, hips, V3(0, .075, .01));
  for (const sd of [-1, 1]){
    const hip = V3(sd * .088, .085, -.01), knee = V3(sd * .112, .105, -.43), ankle = V3(sd * .12, floorY + .075, -.47);
    const seg = (a, b, r0, r1) => { const d = b.clone().sub(a), g = new THREE.Group(); g.position.copy(a); g.quaternion.setFromUnitVectors(V3(0, 1, 0), d.clone().normalize()); hips.add(g);
      mesh(capsule(r0, r1, d.length(), 12, (an, y) => .025 * Math.sin(an * 5 + y * 30) * smooth(0, .1, y)), cloth, g); };
    seg(hip, knee, .074, .056); seg(knee, ankle, .052, .04);
    mesh(blob(.045, .035, .11), cloth, hips, ankle.clone().add(V3(0, -.035, -.055)));
  }

  const SPINE0 = V3(0, .08, .03);
  const spine = new THREE.Group(); spine.position.copy(SPINE0); spine.rotation.order = 'YXZ'; root.add(spine);
  const torsoProf = [[0, -.07], [.14, -.068], [.168, -.045], [.172, -.005], [.163, .03], [.153, .1], [.157, .2], [.17, .29], [.181, .35], [.186, .395], [.17, .435], [.135, .47], [.096, .497], [.064, .515], [0, .522]];
  const torsoGeo = lathe(torsoProf, 36,
    (a, y) => .018 * Math.sin(a * 9 + y * 13 + Math.sin(a * 3) * 1.7) * smooth(.04, .16, y) * (1 - smooth(.3, .42, y))   // vertical drape folds
      + .012 * Math.sin(y * 70 + a * 2) * smooth(.02, .06, y) * (1 - smooth(.12, .2, y))                                  // bunching above the hem
      + .01 * Math.sin(a * 5 - y * 20) * smooth(.28, .4, y) * (1 - smooth(.44, .5, y)),                                  // pull across the back
    v => { v.z *= .64; v.z += .03 * smooth(.18, .46, v.y) * (v.z > 0 ? 1 : .35); });                                      // rounded, slightly hunched back
  const torso = mesh(torsoGeo, cloth, spine);
  // the hood: a soft collar hugging the neck, and the hood itself piled in folds on the upper back
  const collar = new THREE.TorusGeometry(.064, .02, 10, 32); collar.rotateX(PI / 2);
  { const P = collar.attributes.position; for (let i = 0; i < P.count; i++){ const x = P.getX(i), y = P.getY(i), z = P.getZ(i), a = Math.atan2(z, x); const k = 1 + .05 * Math.sin(a * 5); P.setXYZ(i, x * 1.15 * k, y * (1 + .4 * Math.max(0, Math.sin(a))), z * k); } weldNormals(collar); }
  mesh(collar, cloth, spine, V3(0, .5, .004), [.28, 0, 0]);
  const fold = (a, b, c) => (x, y, z) => (z > -.2 ? 1 : .2) * (a * Math.sin(x * 7 + y * 4) * Math.cos(y * 5 - x * 2) + b * Math.max(0, y)) - c * Math.max(0, -y) * Math.max(0, z);
  mesh(blob(.1, .095, .052, fold(.07, .05, .1)), cloth, spine, V3(0, .448, .095), [.48, 0, 0]);
  mesh(blob(.07, .05, .042, fold(.06, .03, 0)), cloth, spine, V3(0, .505, .07), [.75, 0, 0]);

  const SHOULDER = [V3(-.172, .44, .005), V3(.172, .44, .005)];
  for (let h = 0; h < 2; h++) mesh(blob(.05, .044, .06, (x, y) => .02 * Math.sin(x * 5 + y * 4)), cloth, spine, SHOULDER[h].clone().add(V3(-Math.sign(SHOULDER[h].x) * .018, -.014, 0)));

  const neck = new THREE.Group(); neck.position.set(0, .505, -.012); neck.rotation.order = 'YXZ'; spine.add(neck);
  mesh(capsule(.058, .05, .065, 14), skin, neck, V3(0, -.02, 0));
  const head = new THREE.Group(); head.position.set(0, .064, 0); head.rotation.order = 'YXZ'; neck.add(head);
  mesh(blob(.077, .102, .094), skin, head, V3(0, .095, -.012));
  mesh(blob(.056, .05, .064), skin, head, V3(0, .045, -.036));                         // jaw
  for (const sd of [-1, 1]) mesh(blob(.009, .022, .015), skin, head, V3(sd * .073, .088, -.006), [0, -sd * .3, sd * .1]);  // ears
  // hair: a tousled cap over the top and back of the skull, with a short nape
  mesh(blob(.083, .086, .1, (x, y, z) => smooth(-.3, .2, y) * (.028 * Math.sin(x * 6 + z * 4 + 1) * Math.sin(y * 5 + z * 3) + .04 * Math.max(0, y) * Math.max(0, z + .3)) + .015 * Math.sin(Math.atan2(z, x) * 7) * smooth(-.1, .5, y), 36, 24),
    hairM, head, V3(0, .126, .004));
  mesh(blob(.068, .052, .056, (x, y, z) => .02 * Math.sin(x * 8 + y * 5)), hairM, head, V3(0, .07, .036));
  { // loose tufts break the skull's outline so it reads as hair, not a helmet
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const tuft = blob(.016, .008, .024, (x, y, z) => .08 * Math.max(0, z));
    for (let i = 0; i < 9; i++){
      const az = (i / 9) * PI * 2 + rnd() * .3, el = .25 + rnd() * .45;
      const dir = V3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
      const m = mesh(tuft, hairM, head, V3(dir.x * .07, .124 + dir.y * .07, .004 + dir.z * .085));
      m.lookAt(m.position.clone().add(V3(dir.x * .6, -.25 + rnd() * .2, dir.z * .6 + .5)));
      m.rotateZ(rnd() * PI);
    }
  }

  /* ---------- arms ---------- */
  const L1 = .29, L2 = .265;
  const upperGeo = capsule(.05, .044, L1, 16, (a, y) => .045 * Math.sin(a * 4 + y * 26) * smooth(.12, .26, y) + .025 * Math.sin(a * 3 - y * 18) * (1 - smooth(.05, .14, y)));
  const foreGeo = lathe([[.0001, -.044], [.024, -.039], [.04, -.026], [.046, 0], [.044, .06], [.041, .15], [.043, .19], [.041, .215], [.034, .228], [.02, .232], [.0001, .233]], 16,
    (a, y) => .04 * Math.sin(a * 4 + y * 40) * smooth(.15, .2, y) + .03 * Math.sin(a * 3 + y * 25) * (1 - smooth(.0, .06, y)));
  const wristGeo = capsule(.026, .024, .06, 12);

  /* ---------- hands ---------- */
  const FL = [[.034, .03, .026], [.04, .025, .019], [.044, .028, .02], [.041, .026, .019], [.035, .022, .018]];
  const FR = [[.0125, .011, .0098], [.0094, .0086, .0077], [.0098, .0088, .0079], [.0092, .0083, .0075], [.0082, .0074, .0067]];
  const TABLES = FL.map((L, f) => f === 0 ? fingerTable(L, .8, 1.25) : fingerTable(L, .55, 1.75));
  const segGeo = FL.map((L, f) => L.map((l, j) => { const g = capsule(FR[f][j], j < 2 ? FR[f][j + 1] : FR[f][j] * .92, l, 10); g.rotateX(-PI / 2); return g; }));

  const hands = [];
  for (let h = 0; h < 2; h++){
    const side = h ? 1 : -1, ts = -side;            // ts: which local x side the thumb is on
    const hand = new THREE.Group(); root.add(hand);
    mesh(blob(.04, .0135, .047, (x, y) => .25 * Math.max(0, y) * (1 - x * x) * .3), skin, hand, V3(0, .003, -.05));
    mesh(blob(.029, .016, .028), skin, hand, V3(0, .001, -.01));
    mesh(blob(.017, .013, .029), skin, hand, V3(ts * .022, -.004, -.032));
    const upper = new THREE.Group(); root.add(upper); mesh(upperGeo, cloth, upper);
    const fore = new THREE.Group(); root.add(fore); mesh(foreGeo, cloth, fore); mesh(wristGeo, skin, fore, V3(0, .2, 0));
    const KN = [V3(ts * .03, -.006, -.03), V3(ts * .026, .003, -.088), V3(ts * .008, .004, -.092), V3(-ts * .011, .003, -.088), V3(-ts * .028, .001, -.081)];
    const fingers = [];
    for (let f = 0; f < 5; f++){
      const base = new THREE.Group(); base.position.copy(KN[f]); hand.add(base);
      if (f === 0) base.rotation.set(-.35, -ts * .5, 0, 'YXZ'); else base.rotation.y = ts * (f - 2.4) * -.03;
      const g0 = new THREE.Group(); g0.rotation.order = 'YXZ'; base.add(g0);
      const g1 = new THREE.Group(); g1.position.z = -FL[f][0]; g0.add(g1);
      const g2 = new THREE.Group(); g2.position.z = -FL[f][1]; g1.add(g2);
      mesh(segGeo[f][0], skin, g0); mesh(segGeo[f][1], skin, g1); mesh(segGeo[f][2], skin, g2);
      fingers.push({ h, f, base, g0, g1, g2, L: FL[f], T: TABLES[f], clear: FR[f][2] + .0006,
        mode: 'idle', w: S(0), depth: S(0), code: null, real: false, pressed: false, upReq: false, t: 0, tC: 0,
        K: V3(), from: V3(), P: V3(), tip: V3(), restLocal: V3(), restHome: V3(), fid: new VSpring(V3()), fidT: V3(), fidAt: 1 + Math.random() * 4 });
    }
    hands.push({ h, side, ts, hand, upper, fore, fingers, homeW: V3(), homeQ: new THREE.Quaternion(), W: null, hold: V3(), lastActive: -9, yaw: S(0), elbowOut: S(0) });
  }

  /* ---------- home pose: knuckles behind the home row, fingertips hovering over A S D F / J K L ; ---------- */
  const thumbKey = [null, null];
  {
    const space = keyLocal('Space');
    for (const H of hands){
      const homes = HOME[H.h].slice(1).map(keyLocal), C = homes.reduce((a, p) => a.add(p), V3()).multiplyScalar(.25);
      const fwd = kfw.clone().addScaledVector(lat, H.h ? -.1 : .1).normalize().addScaledVector(n, -.17).normalize();
      const up = n.clone().addScaledVector(fwd, -n.dot(fwd)).normalize(), back = fwd.clone().negate();
      const right = up.clone().cross(back).normalize();
      H.homeQ.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, back))
        .multiply(new THREE.Quaternion().setFromAxisAngle(V3(0, 0, 1), -H.side * .2));
      const kc = H.fingers.slice(1).reduce((a, F) => a.add(F.base.position), V3()).multiplyScalar(.25);
      const target = C.clone().addScaledVector(n, .056).addScaledVector(kfw, -.05);
      H.homeW.copy(target).sub(kc.applyQuaternion(H.homeQ));
      H.W = new VSpring(H.homeW); H.hold.copy(H.homeW);
      const inv = new THREE.Matrix4().compose(H.homeW, H.homeQ, V3(1, 1, 1)).invert();
      // thumbs rest on the space bar just inboard of the index finger
      const ixLat = homes[0].clone().sub(space || C).dot(lat);
      const half = 2.7 * U_KEY;
      const tl = clamp(ixLat + (H.h ? -.35 : .55) * U_KEY, -half, half);
      thumbKey[H.h] = (space || C.clone().addScaledVector(kfw, -2 * U_KEY)).clone().addScaledVector(lat, tl);
      H.fingers.forEach((F, f) => {
        const k = f === 0 ? thumbKey[H.h] : homes[f - 1];
        F.restHome.copy(k).addScaledVector(n, F.clear + (f === 0 ? HOVER * 1.3 : HOVER));
        F.restLocal.copy(F.restHome).applyMatrix4(inv);
      });
    }
  }

  /* lean the torso so the shoulder-to-wrist distance gives a relaxed bend in the arms */
  const shoulderAt = (h, th, out) => out.copy(SHOULDER[h]).applyAxisAngle(V3(1, 0, 0), -th).add(SPINE0);
  let lean0 = .15, best = 1e9;
  for (let th = .04; th <= .42; th += .01){
    let e = 0; const tmp = V3();
    for (const H of hands) e += Math.abs(shoulderAt(H.h, th, tmp).distanceTo(H.homeW) - .79 * (L1 + L2));
    e += th * .05; if (e < best){ best = e; lean0 = th; }
  }

  /* ---------- runtime state ---------- */
  const owner = new Map(), down = new Set(), timers = [];
  let T = 0, lastKey = -9, lastHand = 0, lamped = false, lampScan = 0;
  const act = S(0), lean = S(0), sway = S(0), twist = S(0), headYaw = S(0), headPitch = S(0), headRoll = S(0);
  let swayT = 0, swayAt = 6, rollT = 0, rollAt = 4, rollUntil = 0;
  const ZERO = V3(), v1 = V3(), v2 = V3(), v3 = V3(), qTmp = new THREE.Quaternion(), Y = V3(0, 1, 0);

  const doPress = c => { if (!down.has(c)){ down.add(c); try { kb.press(c); } catch (e){} } };
  const doRelease = c => { if (down.has(c)){ down.delete(c); try { kb.release(c); } catch (e){} } };

  function pickFinger(code, pos){
    if (code === 'Space'){ const h = 1 - lastHand; return hands[h].fingers[0]; }
    const m = FINGER[code]; if (m) return hands[m[0]].fingers[m[1]];
    if (!pos) return hands[1].fingers[1];
    let bestF = null, bd = 1e9;            // unknown key with a position: nearest home fingertip
    for (const H of hands) for (const F of H.fingers){
      const d = pos.clone().sub(F.restHome); const dl = Math.abs(d.dot(lat)), df = d.dot(kfw);
      const sc = dl + (F.f === 0 ? (df < -1.5 * U_KEY ? 0 : 3 * U_KEY) : Math.max(0, -df - 1.5 * U_KEY));
      if (sc < bd){ bd = sc; bestF = F; }
    }
    return bestF;
  }

  function keyDown(code){
    let pos = keyLocal(code);
    const real = !!pos && has(code);
    const F = pickFinger(code, pos);
    if (code === 'Space' && pos) pos = thumbKey[F.h].clone();
    if (!pos) pos = F.P.clone().addScaledVector(n, -F.clear - HOVER);       // unknown: just bob the finger
    if (F.mode === 'down' && F.code && (F.code !== code || F.upReq)){   // finger leaves a key it was still on
      const old = F.code;
      if (!F.pressed && F.real) doPress(old);
      if (F.upReq) timers.push({ at: T + .05, fn: () => doRelease(old) });
    }
    F.mode = 'down'; F.code = code; F.real = real; F.pressed = false; F.upReq = false; F.t = 0;
    F.K.copy(pos); F.from.copy(F.P); F.w.x = 0; F.w.v = 0; F.depth.x = 0; F.depth.v = 0;
    owner.set(code, F); lastKey = T;
    if (F.f !== 0 && !/^(Shift|Control|Alt|Meta)/.test(code)) lastHand = F.h;
  }
  function keyUp(code){
    const F = owner.get(code); owner.delete(code);
    if (F && F.code === code && F.mode === 'down'){
      if (!F.pressed){ F.upReq = true; return; }   // tapped faster than the finger travels: release right after contact
      F.mode = 'up'; F.code = null;
    }
    doRelease(code);
  }

  function solveFinger(F, Proot){
    v1.copy(Proot).applyMatrix4(root.matrixWorld); F.base.worldToLocal(v1);
    const th = F.f === 0;
    const psi = clamp(Math.atan2(-v1.x, -v1.z), th ? -.7 : -.38, th ? .7 : .38);
    const u = -v1.x * Math.sin(psi) - v1.z * Math.cos(psi), v = -v1.y;
    const D = Math.hypot(u, v), A = Math.atan2(v, u), Tb = F.T;
    let i = 0; while (i < Tb.n && Tb.d[i + 1] > D) i++;
    let c, al;
    if (i >= Tb.n){ c = Tb.c[Tb.n]; al = Tb.a[Tb.n]; }
    else { const k = clamp((Tb.d[i] - D) / Math.max(1e-6, Tb.d[i] - Tb.d[i + 1]), 0, 1); c = Tb.c[i] + (Tb.c[i + 1] - Tb.c[i]) * k; al = Tb.a[i] + (Tb.a[i + 1] - Tb.a[i]) * k; }
    if (D >= Tb.d[0]){ c = 0; al = 0; }
    const p = clamp(A - al, th ? -.5 : -.3, th ? 1.1 : 1.35);
    F.g0.rotation.set(-p, psi, 0);
    F.g1.rotation.x = -c; F.g2.rotation.x = -c * (th ? .8 : .55);
    F.g0.updateMatrixWorld(true);
    F.tip.set(0, 0, -F.L[2]); F.g2.localToWorld(F.tip); root.worldToLocal(F.tip);
  }

  function findLamp(){
    if (!api.scene) return;
    let bestL = null, sc = -1;
    api.scene.traverse(o => { if ((o.isPointLight || o.isSpotLight) && o.visible){ const c = o.color, w = (c.r - c.b + .2) * (o.intensity || 1); if (w > sc){ sc = w; bestL = o; } } });
    if (bestL){ bestL.getWorldPosition(U.uRimLamp.value); lamped = true; }
  }

  function update(dt, t){
    dt = clamp(dt || 0, 0, .05); T += dt;
    if (!lamped && (lampScan -= dt) <= 0){ lampScan = 1.5; findLamp(); }
    for (let i = timers.length - 1; i >= 0; i--) if (T >= timers[i].at){ timers[i].fn(); timers.splice(i, 1); }

    /* ---- posture: lean in while typing, breathing, weight shifts ---- */
    const typing = T - lastKey < 1.4 ? 1 : 0;
    spring(act, typing, typing ? 4 : 1.4, dt);
    const breath = Math.sin(T * 2 * PI / 4.6);
    if ((swayT += dt) > swayAt){ swayT = 0; swayAt = 7 + Math.random() * 9; sway.tgt = (Math.random() - .5) * .05; twist.tgt = (Math.random() - .5) * .04; }
    spring(sway, sway.tgt || 0, 1.3, dt); spring(twist, twist.tgt || 0, 1.1, dt);
    spring(lean, lean0 + .055 * act.x, 3, dt);
    spine.rotation.set(-(lean.x + .008 * breath), twist.x + .012 * Math.sin(T * .23), sway.x + .01 * Math.sin(T * .31));
    torso.scale.set(1 + .006 * breath, 1 + .003 * breath, 1 + .012 * breath);
    root.updateWorldMatrix(true, false);
    spine.updateMatrix();

    /* ---- hands: wrist eases toward whatever the active fingers need, limited travel ---- */
    for (const H of hands){
      const tgt = v2.set(0, 0, 0); let wsum = 0;
      for (const F of H.fingers){
        if (F.mode !== 'down') continue;
        const d = v1.copy(F.K).sub(F.restHome); d.addScaledVector(n, -d.dot(n));
        const len = d.length(), g = len < 1e-6 ? 0 : clamp(1 - .014 / len, .12, 1);
        const wgt = F.f === 0 ? .25 : /^(Shift|Control|Alt|Meta)/.test(F.code || '') ? .5 : 1;
        tgt.add(v3.copy(H.homeW).addScaledVector(d, g).addScaledVector(n, -.004).multiplyScalar(wgt)); wsum += wgt;
      }
      let w = 7;
      if (wsum > 0){ H.hold.copy(tgt.multiplyScalar(1 / wsum)); H.lastActive = T; w = 34; }
      else if (T - H.lastActive < .35) w = 18;
      else H.hold.copy(H.homeW).addScaledVector(n, .0025 * breath).addScaledVector(kfw, .002 * Math.sin(T * .7 + H.h * 2));
      const W = H.W.step(H.hold, w, dt);
      const dLat = v1.copy(W).sub(H.homeW).dot(lat);
      spring(H.yaw, clamp(-dLat * 3.2, -.25, .25), 12, dt);
      H.hand.quaternion.setFromAxisAngle(n, H.yaw.x).multiply(H.homeQ);

      /* arm: 2-bone IK, shoulder -> elbow -> wrist, elbows out and down */
      const Sh = v3.copy(SHOULDER[H.h]); Sh.y += .003 * breath; Sh.applyMatrix4(spine.matrix);
      const Wp = v1.copy(W), dv = Wp.clone().sub(Sh); let dist = dv.length(); dv.normalize();
      dist = clamp(dist, Math.abs(L1 - L2) + .01, L1 + L2 - .004);
      Wp.copy(Sh).addScaledVector(dv, dist);
      spring(H.elbowOut, clamp(dLat * H.side * 4, -.4, .6), 6, dt);
      const pole = V3(H.side * (.85 + H.elbowOut.x), -.5, .35).normalize();
      pole.addScaledVector(dv, -pole.dot(dv)).normalize();
      const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist), hh = Math.sqrt(Math.max(0, L1 * L1 - a * a));
      const E = Sh.clone().addScaledVector(dv, a).addScaledVector(pole, hh);
      H.upper.position.copy(Sh); H.upper.quaternion.setFromUnitVectors(Y, v2.copy(E).sub(Sh).normalize());
      H.fore.position.copy(E); H.fore.quaternion.setFromUnitVectors(Y, v2.copy(Wp).sub(E).normalize());
      H.hand.position.copy(Wp);
      H.hand.updateMatrix(); H.hand.updateMatrixWorld(true);

      /* fingers */
      for (const F of H.fingers){
        // idle fidgets: an occasional small lift or curl of a resting finger
        if ((F.fidAt -= dt) <= 0){
          F.fidAt = 1.5 + Math.random() * 5;
          if (F.fidT.lengthSq() > 0) F.fidT.set(0, 0, 0);
          else { F.fidT.set(0, .003 + Math.random() * .005, (Math.random() - .5) * .006); F.fidAt = .25 + Math.random() * .4; }
        }
        F.fid.step(F.mode === 'idle' ? F.fidT : ZERO, 14, dt);
        const idle = v2.copy(F.restLocal).add(F.fid.x); idle.y += .0012 * Math.sin(T * 1.7 + F.f * 1.3 + H.h * 2); idle.applyMatrix4(H.hand.matrix);
        if (F.mode === 'down'){
          F.t += dt;
          spring(F.w, 1, 78, dt); spring(F.depth, F.pressed ? 1 : 0, 70, dt);
          const Kc = v3.copy(F.K).addScaledVector(n, F.clear - F.depth.x * TRAVEL);
          const e = F.w.x, arc = Math.min(.016, .006 + .3 * F.from.distanceTo(Kc));
          F.P.copy(F.from).lerp(Kc, e).addScaledVector(n, arc * Math.sin(PI * Math.min(1, e)));
        } else {
          spring(F.w, 0, F.f === 0 ? 26 : 32, dt); spring(F.depth, 0, 50, dt);
          if (F.w.x < .002 && Math.abs(F.w.v) < .05) F.mode = 'idle';
          const Kc = v3.copy(F.K).addScaledVector(n, F.clear - F.depth.x * TRAVEL);
          F.P.copy(idle).lerp(Kc, F.w.x).addScaledVector(n, .005 * Math.sin(PI * F.w.x));
        }
        solveFinger(F, F.P);
        if (F.mode === 'down'){
          const Kc = v3.copy(F.K).addScaledVector(n, F.clear);
          if (!F.pressed && ((F.w.x > .8 && F.tip.distanceTo(Kc) < .0025) || F.t > .09)){
            F.pressed = true; F.tC = F.t; if (F.real) doPress(F.code);
          }
          if (F.pressed && F.upReq && F.t - F.tC > .04){
            const c = F.code; F.upReq = false; F.mode = 'up'; F.code = null; doRelease(c);
          }
        }
      }
    }

    /* ---- head: tracks the screen, leans in while typing, an occasional thoughtful tilt ---- */
    if ((rollT += dt) > rollAt){ rollT = 0; rollAt = 5 + Math.random() * 8; rollUntil = T + 1.2 + Math.random() * 2; headRoll.tgt = (Math.random() < .5 ? -1 : 1) * (.05 + Math.random() * .05); }
    if (T > rollUntil) headRoll.tgt = 0;
    const hp = v1.set(0, .63, -.02).applyMatrix4(spine.matrix), ls = toLocal(scrW).sub(hp);
    const yaw = clamp(Math.atan2(-ls.x, -ls.z), -.6, .6), pitch = Math.atan2(ls.y, Math.hypot(ls.x, ls.z));
    spring(headYaw, yaw + .03 * Math.sin(T * .17), 3, dt);
    spring(headPitch, clamp(pitch, -.5, .45) - .06 * act.x, 3, dt);
    spring(headRoll, headRoll.tgt || 0, 2.2, dt);
    neck.rotation.set(-.14 - .04 * act.x, headYaw.x * .3, 0);
    head.rotation.set(headPitch.x + lean.x + .14 + .04 * act.x + .01 * breath, headYaw.x * .7, headRoll.x);
  }

  // settle into the home pose before the first frame
  for (let i = 0; i < 40; i++) update(1 / 30, 0);
  T = 0; lastKey = -9;

  return { object3d: root, keyDown, keyUp, update };
};
})();
