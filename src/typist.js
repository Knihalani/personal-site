/* Typist: the person whose eyes the visitor looks through. Only the forearms, sleeves and hands are ever
   seen (there is no head or torso: the camera is the head), so the hands are the hero model:
   a slightly flattened, round-edged palm whose knuckles are only a gentle ridge, three-segment fingers that taper
   continuously to flattened tips, a thumb resting on the space bar, a wrist running into a ribbed hoodie cuff, and a sleeve that bunches at the elbow. Arms are 2-bone IK, fingers
   3-segment planar IK. Every keystroke is a timed strike (lift, accelerate, land on the cap centre, follow the
   key down, release with a rebound); the wrist travels as far as the finger needs, and any residual the finger
   cannot reach is fed back into the wrist so contact lands on the cap centre. */
(() => {
'use strict';
const M = window.MAC = window.MAC || {};

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const PI = Math.PI;
const lin = hex => new THREE.Color(hex).convertSRGBToLinear();

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
/* Smooth 1D value noise (quintic fade) and a 3-octave sum in about -1..1: idle drift that never reads as a sine. */
const hash1 = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
function noise1(x){ const i = Math.floor(x), f = x - i, u = f * f * f * (f * (f * 6 - 15) + 10); const a = hash1(i); return (a + (hash1(i + 1) - a) * u) * 2 - 1; }
const fbm = (x, s) => noise1(x + s * 17.3) * .62 + noise1(x * 2.13 + s * 5.1 + 3.7) * .27 + noise1(x * 4.37 + s * 2.9 + 9.1) * .11;

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
FM(0, 4, 'Escape F1 Backquote Digit1 Tab KeyQ CapsLock KeyA ShiftLeft IntlBackslash KeyZ ControlLeft');
FM(0, 3, 'F2 Digit2 KeyW KeyS KeyX');
FM(0, 2, 'F3 F4 Digit3 KeyE KeyD KeyC');
FM(0, 1, 'F5 Digit4 Digit5 KeyR KeyT KeyF KeyG KeyV KeyB');
FM(0, 0, 'AltLeft MetaLeft');
FM(1, 0, 'AltRight MetaRight ContextMenu');
FM(1, 1, 'F6 F7 Digit6 Digit7 KeyY KeyU KeyH KeyJ KeyN KeyM');
FM(1, 2, 'F8 Digit8 KeyI KeyK Comma ArrowLeft ArrowUp ArrowDown');
FM(1, 3, 'F9 Digit9 KeyO KeyL Period ArrowRight');
FM(1, 4, 'F10 F11 F12 Digit0 Minus Equal Backspace KeyP BracketLeft BracketRight Backslash Semicolon Quote Enter Slash ShiftRight ControlRight');
const HOME = [[null, 'KeyF', 'KeyD', 'KeyS', 'KeyA'], [null, 'KeyJ', 'KeyK', 'KeyL', 'Semicolon']];
const MOD = /^(Shift|Control|Alt|Meta)/;
/* tendon coupling between fingers (index 1..4): ring is tied to its neighbours far more than the index is */
const COUPLE = [[0, .06, .02, 0, 0], [.06, 0, .32, .1, .04], [.02, .32, 0, .48, .14], [0, .1, .48, 0, .5], [0, .04, .14, .5, 0]];

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
function capsule(r0, r1, len, seg = 12, fold, post, n = 6){
  const prof = [];
  for (let k = 0; k <= n; k++){ const a = -PI / 2 + PI / 2 * k / n; prof.push([r0 * Math.cos(a), r0 * Math.sin(a)]); }
  for (let k = 0; k <= n; k++){ const a = PI / 2 * k / n; prof.push([r1 * Math.cos(a), len + r1 * Math.sin(a)]); }
  return lathe(prof, seg, fold, post);
}
/* Smooth ellipsoid with optional displacement disp(x,y,z on unit sphere). */
function blob(rx, ry, rz, disp, ws = 24, hs = 16){
  const g = new THREE.SphereGeometry(1, ws, hs), P = g.attributes.position;
  for (let i = 0; i < P.count; i++){
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i), k = disp ? 1 + disp(x, y, z) : 1;
    P.setXYZ(i, x * rx * k, y * ry * k, z * rz * k);
  }
  return weldNormals(g);
}
/* per-vertex tint (multiplies the material colour): fn(x, y, z) -> [r, g, b] */
function tint(g, fn){
  const P = g.attributes.position, C = new Float32Array(P.count * 3);
  for (let i = 0; i < P.count; i++){ const c = fn(P.getX(i), P.getY(i), P.getZ(i)); C[i * 3] = c[0]; C[i * 3 + 1] = c[1]; C[i * 3 + 2] = c[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(C, 3)); return g;
}
const PLAIN = [1, 1, 1];

/* ---------------- the hand surface: a signed-distance field, polygonised once with surface nets ---------------- */
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * .25; };
/* Surface nets over [lo, hi] with cell size h: one vertex per surface cell, one quad per sign-changing edge.
   Far-field values come from a coarse pass so only the narrow band near the surface is evaluated finely. */
function* surfaceNets(sdf, lo, hi, h){
  const nx = Math.ceil((hi[0] - lo[0]) / h) + 1, ny = Math.ceil((hi[1] - lo[1]) / h) + 1, nz = Math.ceil((hi[2] - lo[2]) / h) + 1;
  const C = 3, cx = Math.ceil((nx - 1) / C) + 1, cy = Math.ceil((ny - 1) / C) + 1, cz = Math.ceil((nz - 1) / C) + 1;
  const G = new Float32Array(cx * cy * cz);
  for (let k = 0; k < cz; k++){ for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++)
    G[i + cx * (j + cy * k)] = sdf(lo[0] + i * C * h, lo[1] + j * C * h, lo[2] + k * C * h); yield; }
  const F = new Float32Array(nx * ny * nz), band = 3.8 * h;
  for (let k = 0; k < nz; k++, yield) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++){
    const g = G[Math.round(i / C) + cx * (Math.round(j / C) + cy * Math.round(k / C))];
    const edge = i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1;
    F[i + nx * (j + ny * k)] = edge ? Math.max(h, Math.abs(g)) : Math.abs(g) > band ? g : sdf(lo[0] + i * h, lo[1] + j * h, lo[2] + k * h);
  }
  const id = (i, j, k) => i + nx * (j + ny * k), cid = (i, j, k) => i + (nx - 1) * (j + (ny - 1) * k);
  const cell = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1), pos = [];
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++, yield) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++){
    let m = 0;
    for (let c = 0; c < 8; c++){ cv[c] = F[id(i + (c & 1), j + (c >> 1 & 1), k + (c >> 2))]; if (cv[c] < 0) m |= 1 << c; }
    if (m === 0 || m === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of E){
      if ((cv[a] < 0) === (cv[b] < 0)) continue;
      const t = cv[a] / (cv[a] - cv[b]);
      sx += (a & 1) + ((b & 1) - (a & 1)) * t; sy += (a >> 1 & 1) + ((b >> 1 & 1) - (a >> 1 & 1)) * t; sz += (a >> 2) + ((b >> 2) - (a >> 2)) * t; n++;
    }
    cell[cid(i, j, k)] = pos.length / 3;
    pos.push(lo[0] + (i + sx / n) * h, lo[1] + (j + sy / n) * h, lo[2] + (k + sz / n) * h);
  }
  const idx = [];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip){ const t = b; b = d; d = t; }
    const d1 = (pos[a * 3] - pos[c * 3]) ** 2 + (pos[a * 3 + 1] - pos[c * 3 + 1]) ** 2 + (pos[a * 3 + 2] - pos[c * 3 + 2]) ** 2;
    const d2 = (pos[b * 3] - pos[d * 3]) ** 2 + (pos[b * 3 + 1] - pos[d * 3 + 1]) ** 2 + (pos[b * 3 + 2] - pos[d * 3 + 2]) ** 2;
    if (d1 < d2) idx.push(a, b, c, a, c, d); else idx.push(a, b, d, b, c, d);
  };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++){
    const f0 = F[id(i, j, k)] < 0;
    if (i < nx - 1 && f0 !== (F[id(i + 1, j, k)] < 0))
      quad(cell[cid(i, j - 1, k - 1)], cell[cid(i, j, k - 1)], cell[cid(i, j, k)], cell[cid(i, j - 1, k)], !f0);
    if (j < ny - 1 && f0 !== (F[id(i, j + 1, k)] < 0))
      quad(cell[cid(i - 1, j, k - 1)], cell[cid(i - 1, j, k)], cell[cid(i, j, k)], cell[cid(i, j, k - 1)], !f0);
    if (k < nz - 1 && f0 !== (F[id(i, j, k + 1)] < 0))
      quad(cell[cid(i - 1, j - 1, k)], cell[cid(i, j - 1, k)], cell[cid(i, j, k)], cell[cid(i - 1, j, k)], !f0);
  }
  return { pos, idx };
}

/* ---------------- material: one silhouette shader for every typist mesh ---------------- */
function makeMat(U){
  // The typist is a silhouette: matte near-black (#050505), no skin or cloth shading inside the shape, only a
  // faint cool rim from the CRT and a faint warm one from the lamp, so the outline reads against the dark keys.
  const m = new THREE.MeshStandardMaterial({ color: lin(0x050505), roughness: 1, metalness: 0 });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'varying vec3 vTP;\nvarying vec3 vTN;\n' + sh.vertexShader.replace('#include <fog_vertex>',
      '#include <fog_vertex>\n vTP = (modelMatrix * vec4(transformed, 1.0)).xyz;\n vTN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = 'uniform vec3 uScrP;\nuniform vec3 uLampP;\nuniform float uLampK;\nvarying vec3 vTP;\nvarying vec3 vTN;\n' +
      sh.fragmentShader.replace('#include <output_fragment>', `
  {
    vec3 sN = normalize(vTN); sN = gl_FrontFacing ? sN : -sN;
    vec3 sV = normalize(cameraPosition - vTP);
    float nc = dot(sN, normalize(uScrP - vTP)), nl = dot(sN, normalize(uLampP - vTP));
    float fr = pow(1.0 - clamp(dot(sN, sV), 0.0, 1.0), 4.0);
    // two thin rims: cool where the edge turns to the tube, warm (2700K) where it turns to the lamp
    float cool = clamp(0.6 * max(nc, 0.0) + 0.12, 0.0, 1.0), warm = max(nl, 0.0) * uLampK;
    float fw = pow(1.0 - clamp(dot(sN, sV), 0.0, 1.0), 3.0);
    outgoingLight = vec3(0.0015) + fr * cool * vec3(0.085, 0.12, 0.155) + fw * warm * vec3(0.32, 0.175, 0.07);
  }
#include <output_fragment>`);
  };
  m.customProgramCacheKey = () => 'mac-typist-silhouette';
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

  /* ---------- placement: on the seat, facing the screen, real-world scale ---------- */
  const seatW = rig.seat.clone(), kbW = rig.keyboardCenter.clone(), scrW = rig.screenCenter.clone();
  const nW = (rig.keyboardNormal ? rig.keyboardNormal.clone() : V3(0, 1, 0)).normalize();
  const toScr = scrW.clone().sub(seatW); toScr.y = 0;
  if (toScr.lengthSq() < 1e-6) toScr.copy(kbW).sub(seatW).setY(0);
  if (toScr.lengthSq() < 1e-6) toScr.set(0, 0, -1);
  const s = 1;
  root.position.copy(seatW);
  root.rotation.y = Math.atan2(-toScr.x, -toScr.z);
  root.updateMatrixWorld(true);
  const invRootQ = root.quaternion.clone().invert();
  const toLocal = w => root.worldToLocal(w.clone());
  const dirLocal = w => w.clone().applyQuaternion(invRootQ).normalize();

  /* keyboard frame (world): lat = typist's right along the rows, fwd = away from typist, n = key-surface up */
  try { if (api.scene) api.scene.updateMatrixWorld(true); } catch (e){}
  const has = c => { try { return !!kb.hasKey(c); } catch (e){ return false; } };
  const wpos = c => { try { const p = has(c) && kb.keyWorldPos(c); return p ? p.clone() : null; } catch (e){ return null; } };
  const anchors = [];
  for (const c of ['KeyF', 'KeyJ', 'KeyD', 'KeyK', 'KeyS', 'KeyL', 'KeyA', 'KeyG', 'KeyH', 'KeyR', 'KeyU', 'KeyE', 'KeyI', 'KeyW', 'KeyO', 'KeyQ', 'KeyP', 'KeyV', 'KeyN', 'KeyC', 'KeyM', 'Digit5', 'Digit6', 'Space']){
    const p = wpos(c); if (p) anchors.push({ c, p, ux: LAYOUT[c][0], row: LAYOUT[c][1] });
  }
  let latW = null, uW = rig.keySpacing || .019;
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
    if (!useAnchors.length) return kbW.clone().addScaledVector(latW, (L[0] - 7.5) * uW).addScaledVector(fwdW, (2 - L[1]) * uW);
    const acc = V3();
    for (const A of useAnchors) acc.add(A.p.clone().addScaledVector(latW, (L[0] - A.ux) * uW).addScaledVector(fwdW, (A.row - L[1]) * uW));
    return acc.multiplyScalar(1 / useAnchors.length);
  }
  const keyLocal = code => { const p = wpos(code) || layoutWorld(code); return p ? toLocal(p) : null; };

  const n = dirLocal(nW), lat = dirLocal(latW), kfw = dirLocal(fwdW);
  const U_KEY = uW, TRAVEL = .0032, HOVER = .0045;
  const REST_GAP = .0005, KNUCKLE_UP = .028, KNUCKLE_BACK = .052;   // fingertips rest on the caps (a hair above: never pressing)

  /* the desk surface just in front of the keyboard (for a hand resting there during long idles) */
  const spaceW = wpos('Space') || layoutWorld('Space');
  let deskYw = spaceW.y - .03;
  try {
    const rc = new THREE.Raycaster(), o = kbW.clone().addScaledVector(fwdW, -4.6 * uW - .07); o.y += .3;
    rc.set(o, V3(0, -1, 0)); rc.far = .7;
    const hit = rc.intersectObjects(api.scene ? api.scene.children : [], true).find(h => h.object.isMesh && h.object.visible && !(h.object.material && h.object.material.transparent));
    if (hit) deskYw = clamp(hit.point.y, spaceW.y - .09, spaceW.y - .004);
  } catch (e){}

  /* ---------- materials ---------- */
  const lampW = rig.lampPosition ? rig.lampPosition.clone() : kbW.clone().addScaledVector(latW, -.45).add(V3(0, .55, 0));
  const U = {
    uScrP: { value: scrW.clone() }, uLampP: { value: lampW },
    uLampK: { value: 1 },
  };
  const sil = makeMat(U);   // hips, legs, sleeves and hands all share it
  const mesh = (geo, mat, parent, pos, rot) => {
    const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true;
    if (pos) m.position.copy(pos); if (rot) m.rotation.set(rot[0], rot[1], rot[2], rot[3] || 'XYZ');
    parent.add(m); return m;
  };
  // hips and legs sit under the desk, out of the lamp's reach: they draw (cheaply) but never enter the shadow map
  const noCast = o => o.traverse(m => { if (m.isMesh){ m.castShadow = false; m.userData.noShadow = true; } });

  /* ---------- body: hips and legs as cloth. No head, neck or torso meshes: the camera sits in the head, and from the
     lamp (in front of and beside the typist) their shadows fall behind the chair where nothing shows them. ---------- */
  const floorY = clamp(seatW.y > .2 ? -seatW.y : -.42, -.55, -.3);
  const hips = new THREE.Group(); root.add(hips);
  mesh(blob(.165, .085, .15, (x, y, z) => .03 * Math.sin(x * 6 + z * 4) * (y > 0 ? 1 : .3)), sil, hips, V3(0, .075, .01));
  for (const sd of [-1, 1]){
    const hip = V3(sd * .088, .085, -.01), knee = V3(sd * .112, .105, -.43), ankle = V3(sd * .12, floorY + .075, -.47);
    const seg = (a, b, r0, r1) => { const d = b.clone().sub(a), g = new THREE.Group(); g.position.copy(a); g.quaternion.setFromUnitVectors(V3(0, 1, 0), d.clone().normalize()); hips.add(g);
      mesh(capsule(r0, r1, d.length(), 16, (an, y) => .025 * Math.sin(an * 5 + y * 30) * smooth(0, .1, y)), sil, g); };
    seg(hip, knee, .074, .056); seg(knee, ankle, .052, .04);
    mesh(blob(.045, .035, .11), sil, hips, ankle.clone().add(V3(0, -.035, -.055)));
  }
  noCast(hips);
  const SPINE0 = V3(0, .08, .03);
  const spine = new THREE.Group(); spine.position.copy(SPINE0); spine.rotation.order = 'YXZ'; root.add(spine);
  const SHOULDER = [V3(-.172, .44, .005), V3(.172, .44, .005)];
  const EYE_S = V3(0, .665, -.085);                       // eyes, in spine space

  /* ---------- arms: sleeve, elbow bunching, cuff, wrist ---------- */
  const L1 = .29, L2 = .265;
  const upperGeo = capsule(.046, .041, L1, 40,
    (a, y) => .05 * Math.sin(y * 70 + 1.8 * Math.sin(a * 2 + .5)) * smooth(.17, .27, y) + .025 * Math.sin(a * 4 + y * 22) + .02 * Math.sin(a * 3 - y * 30) * (1 - smooth(.04, .12, y)),
    v => { v.x *= 1.04; v.z *= .94; });
  // the forearm sleeve: drapes from the elbow and ends in a ribbed cuff mid-forearm, so a slim wrist shows
  const sleeveFold = (a, y) => (1 - smooth(.0, .1, y)) * (.075 * Math.sin(y * 92 + 1.6 * Math.sin(a * 2 + 1)) + .03 * Math.sin(a * 5 + y * 40))            // bunching at the elbow
      + smooth(.05, .1, y) * (1 - smooth(.13, .155, y)) * (.028 * Math.sin(a * 3 + y * 28) + .014 * Math.sin(a * 7 - y * 22))          // drape along the forearm
      + smooth(.13, .15, y) * (1 - smooth(.158, .166, y)) * .045 * Math.sin(a * 4 + y * 50 + 1);                                       // slack piling onto the cuff
  const RIBS = 30, ribBand = y => smooth(.168, .173, y) * (1 - smooth(.192, .197, y));
  const foreGeo = lathe([[.0001, -.05], [.028, -.046], [.044, -.034], [.052, -.012], [.054, .018], [.051, .05], [.048, .09], [.046, .12], [.0452, .145], [.0456, .158],
    [.0425, .166], [.039, .171], [.038, .18], [.038, .19], [.0372, .197], [.0345, .2012], [.0315, .2022], [.0292, .199]], 150,
    (a, y) => sleeveFold(a, y) + ribBand(y) * .05 * Math.max(-.6, Math.cos(a * RIBS)),                        // + rib knit on the cuff
    v => { v.x *= 1.1; v.z *= .86; });
  tint(foreGeo, () => PLAIN);
  const elbowGeo = blob(.047, .047, .047, (x, y, z) => .05 * Math.sin(x * 7 + y * 5) * Math.cos(z * 4));

  /* ---------- hands ---------- */
  /* Hand scale: the fingers are modelled at adult size, then drawn at HS. Seen from ~45 cm above, full-size black hands
     read as mittens over the board; at ~68% they sit on the keys like hands do in photos of someone typing. The palm
     is not scaled from a template: it is as wide as the knuckles, which sit one key pitch apart over the home keys
     (fingers nearly parallel, pinkies in on A and ;), so a palm spans just under four keys (~70 mm). */
  const HS = .68;
  const SKIN_H = .0036;     // surface-nets cell size (hand space; ~2.5 mm in the world, so meshing costs what it did before)
  const FL = [[.036, .03, .026], [.041, .025, .019], [.045, .028, .02], [.042, .026, .019], [.032, .02, .0165]];
  /* finger radius (hand space) at the knuckle, the two finger joints and the tip: it narrows continuously all the way
     down, so no joint reads as a bead and the tip is the slimmest point (a flattened pad, not a ball) */
  const FR = [[.0128, .0114, .0099, .0077], [.0108, .0094, .008, .0064], [.0111, .0097, .0082, .0065], [.0105, .0091, .0077, .0061], [.0091, .008, .0068, .0054]];
  const TIPFL = 1.38;        // how much the last joint flattens (pad below, nail above) by the tip
  const TABLES = FL.map((L, f) => f === 0 ? fingerTable(L, .8, 1.25) : fingerTable(L, .55, 1.75));

  const hands = [];
  for (let h = 0; h < 2; h++){
    const side = h ? 1 : -1, ts = -side;            // ts: which local x side the thumb is on
    const hand = new THREE.Group(); hand.scale.setScalar(HS); root.add(hand);
    const KN = [V3(ts * .037, -.009, -.024), V3(ts * .026, .003, -.088), V3(ts * .008, .004, -.092), V3(-ts * .011, .003, -.088), V3(-ts * .028, .001, -.08)];
    const upper = new THREE.Group(); root.add(upper); mesh(upperGeo, sil, upper); mesh(elbowGeo, sil, upper, V3(0, L1, 0));
    const fore = new THREE.Group(); root.add(fore); mesh(foreGeo, sil, fore);
    const fingers = [];
    for (let f = 0; f < 5; f++){
      const base = new THREE.Group(); base.position.copy(KN[f]); hand.add(base);
      if (f === 0) base.rotation.set(-.4, -ts * .6, 0, 'YXZ'); else base.rotation.y = ts * (f - 2.4) * -.05;
      const g0 = new THREE.Group(); g0.rotation.order = 'YXZ'; base.add(g0);
      const g1 = new THREE.Group(); g1.position.z = -FL[f][0]; g0.add(g1);
      const g2 = new THREE.Group(); g2.position.z = -FL[f][1]; g1.add(g2);
      // clear: fingertip axis end to key top. The tip tapers to ~.68 of the DIP radius (see the skin), so the pad
      // that meets the cap sits about that far below the axis, in world units
      fingers.push({ h, f, base, g0, g1, g2, L: FL[f], T: TABLES[f], clear: FR[f][3] / TIPFL * 1.12 * HS + .0003,
        mode: 'idle', code: null, vcode: null, real: false, pressed: false, upReq: false, t: 0, tC: 0, Td: .08, lift: .005, relT: 9,
        w: S(0), depth: S(0), act: 0, K: V3(), from: V3(), P: V3(), tip: V3(), restLocal: V3(), restHome: V3(), reach: V3(),
        fid: new VSpring(V3()), fidT: V3(), queue: [], vel: V3(), prevP: V3(), v0: V3(), hNow: 0, wW: 30 });
    }
    hands.push({ h, side, ts, KN, hand, upper, fore, fingers, homeW: V3(), homeQ: new THREE.Quaternion(), deskW: V3(), deskQ: new THREE.Quaternion(),
      W: null, Wt: null, hold: V3(), region: null, nudge: V3(), lastActive: -9, yaw: S(0), desk: S(0), deskT: 0, elbowOut: S(0),
      fidAt: 2 + Math.random() * 4, fidF: null });
  }

  /* ---------- home pose: knuckles behind the home row, fingertips hovering over A S D F / J K L ; ---------- */
  const thumbKey = [null, null];
  {
    const space = keyLocal('Space');
    for (const H of hands){
      const homes = HOME[H.h].slice(1).map(keyLocal), C = homes.reduce((a, p) => a.add(p), V3()).multiplyScalar(.25);
      // the back of the hand rises gently from a low wrist to the knuckles (~11 deg), the way relaxed typing hands do
      const fwd = kfw.clone().addScaledVector(lat, H.h ? -.17 : .17).normalize().addScaledVector(n, .2).normalize();   // turned in a little, in line with the forearm
      const up = n.clone().addScaledVector(fwd, -n.dot(fwd)).normalize(), back = fwd.clone().negate();
      const right = up.clone().cross(back).normalize();
      H.homeQ.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, back))
        .multiply(new THREE.Quaternion().setFromAxisAngle(V3(0, 0, 1), -H.side * .13));
      const kc = H.fingers.slice(1).reduce((a, F) => a.add(F.base.position), V3()).multiplyScalar(.25 * HS);
      // knuckles ~2.8 cm above the home-row caps and ~5 cm behind them: the fingers curl down onto the keys
      const target = C.clone().addScaledVector(n, KNUCKLE_UP).addScaledVector(kfw, -KNUCKLE_BACK);
      H.homeW.copy(target).sub(kc.clone().applyQuaternion(H.homeQ));
      /* Even curl: a real typist's fingers all bend about the same (MCP ~25, PIP ~45, DIP ~25 deg), the long middle
         finger landing a little further up its key and the pinky a little lower. So the relaxed pose is chosen first
         and the knuckles are placed where that pose puts every tip on its home key (a few mm off the anatomical arc,
         after the hand itself is shifted to fit). The finger IK then reproduces this pose exactly at rest. */
      H.KN0 = H.KN.map(k => k.clone());
      {
        const tipOff = (F, mcp, pip, psi) => {
          const sv = [F.base.position.clone(), F.g0.rotation.clone(), F.g1.rotation.x, F.g2.rotation.x];
          F.base.position.set(0, 0, 0); F.g0.rotation.set(-mcp, psi, 0); F.g1.rotation.x = -pip; F.g2.rotation.x = -pip * .55;
          for (const g of [F.base, F.g0, F.g1, F.g2]) g.updateMatrix();
          const o = V3(0, 0, -F.L[2]).applyMatrix4(F.g2.matrix).applyMatrix4(F.g1.matrix).applyMatrix4(F.g0.matrix).applyMatrix4(F.base.matrix);
          F.base.position.copy(sv[0]); F.g0.rotation.copy(sv[1]); F.g1.rotation.x = sv[2]; F.g2.rotation.x = sv[3];
          for (const g of [F.base, F.g0, F.g1, F.g2]) g.updateMatrix();
          return o;
        };
        // per finger: MCP, PIP (DIP follows at .55; the bend spread along the finger, not hooked at the PIP), splay (+ = away from the thumb), tip offset along the key (m, + = forward)
        const POSE = [null, [.42, .56, -.03, .001], [.46, .58, 0, .0035], [.46, .58, .025, .0015], [.4, .6, .05, -.002]];
        const tipH = (inv, f) => homes[f - 1].clone().addScaledVector(n, H.fingers[f].clear + REST_GAP).addScaledVector(kfw, POSE[f][3]).applyMatrix4(inv);
        const kn = [];
        for (let it = 0; it < 3; it++){
          const inv = new THREE.Matrix4().compose(H.homeW, H.homeQ, V3(HS, HS, HS)).invert(), mean = V3();
          for (let f = 1; f < 5; f++){
            const F = H.fingers[f], P = POSE[f];
            kn[f] = tipH(inv, f).sub(tipOff(F, P[0], P[1], H.ts * P[2]));
            mean.add(kn[f].clone().sub(H.KN[f]));
          }
          H.homeW.addScaledVector(mean.multiplyScalar(.25).applyQuaternion(H.homeQ), HS);   // move the hand, not the knuckles
        }
        const inv = new THREE.Matrix4().compose(H.homeW, H.homeQ, V3(HS, HS, HS)).invert();
        for (let f = 1; f < 5; f++){
          const F = H.fingers[f], P = POSE[f];
          H.KN[f].copy(tipH(inv, f).sub(tipOff(F, P[0], P[1], H.ts * P[2]))); F.base.position.copy(H.KN[f]);
        }
      }
      H.W = new VSpring(H.homeW); H.Wt = new VSpring(H.homeW); H.hold.copy(H.homeW); H.region = new VSpring(H.homeW);
      const inv = new THREE.Matrix4().compose(H.homeW, H.homeQ, V3(HS, HS, HS)).invert();
      const ixLat = homes[0].clone().sub(space || C).dot(lat);
      const half = 2.7 * U_KEY;
      const tl = clamp(ixLat + (H.h ? -.6 : .7) * U_KEY, -half, half);   // in under the index, where the thumb shows
      thumbKey[H.h] = (space || C.clone().addScaledVector(kfw, -2 * U_KEY)).clone().addScaledVector(lat, tl);
      H.fingers.forEach((F, f) => {
        const k = f === 0 ? thumbKey[H.h] : homes[f - 1];
        F.restHome.copy(k).addScaledVector(n, F.clear + (f === 0 ? .0025 : REST_GAP));
        F.restLocal.copy(F.restHome).applyMatrix4(inv);
      });
      // resting on the desk: wrist down on the wood in front of the board, hand turned out and flattened
      const deskL = toLocal(V3(0, deskYw, 0).add(kbW.clone().setY(0)));
      H.deskW.copy(H.homeW).addScaledVector(kfw, -(2.4 * U_KEY + .085)).addScaledVector(lat, H.side * .05);
      H.deskW.addScaledVector(n, (deskL.clone().sub(H.deskW).dot(n)) + .021);
      H.deskQ.setFromAxisAngle(n, -H.side * .32).multiply(H.homeQ).multiply(new THREE.Quaternion().setFromAxisAngle(V3(1, 0, 0), .16))
        .multiply(new THREE.Quaternion().setFromAxisAngle(V3(0, 0, 1), H.side * .12));
    }
  }
  const deskLocalH = toLocal(V3(kbW.x, deskYw, kbW.z)).dot(n);
  /* the key-top surface (height along n, by distance along the board), from one key per row: a finger that is not
     pressing never sinks below it, wherever the hand has gone */
  const rowRef = ['Space', 'KeyB', 'KeyG', 'KeyT', 'Digit5'].map(keyLocal).filter(Boolean).map(p => [p.dot(kfw), p.dot(n)]).sort((a, b) => a[0] - b[0]);
  const capTop = f => {
    const R = rowRef; if (!R.length) return -1e9;
    if (f <= R[0][0]) return R[0][1];
    for (let i = 0; i < R.length - 1; i++) if (f <= R[i + 1][0]){ const d = R[i + 1][0] - R[i][0]; return d > 1e-6 ? R[i][1] + (R[i + 1][1] - R[i][1]) * (f - R[i][0]) / d : R[i][1]; }
    return R[R.length - 1][1];
  };

  /* ---------- trunk: lean so the arms hang relaxed; when the scene gives the eye position, put the eyes there ---------- */
  const eyeL = rig.eye ? toLocal(rig.eye) : null;
  const rotX = (v, th) => v.clone().applyAxisAngle(V3(1, 0, 0), -th);
  let lean0 = .15, spineOff = V3(), best = 1e9;
  for (let th = -.1; th <= .6; th += .01){
    let off = V3();
    if (eyeL){ off = eyeL.clone().sub(SPINE0).sub(rotX(EYE_S, th)); }
    let e = 0;
    for (const H of hands) e += Math.abs(rotX(SHOULDER[H.h], th).add(SPINE0).add(off).distanceTo(H.homeW) - .8 * (L1 + L2));
    e += Math.abs(th - .15) * .05 + (eyeL ? off.length() * .02 : 0);
    if (e < best){ best = e; lean0 = th; spineOff = off; }
  }
  if (spineOff.length() > .45) spineOff.setLength(.45);
  spine.position.copy(SPINE0).add(spineOff);
  hips.position.set(spineOff.x * .6, 0, spineOff.z * .6);

  /* ---------- runtime state ---------- */
  const owner = new Map(), down = new Set(), timers = [], contacts = [];
  let T = 0, lastKey = -9, lastHand = 0, lamped = !!rig.lampPosition, lampScan = 0, pendShift = null, deskCheck = 6;
  const act = S(0), lean = S(lean0), sway = S(0), twist = S(0);
  let swayT = 0, swayAt = 6, lampRef = null, lampMax = 0, lampFind = 0, bPh = Math.random() * 6;
  const ZERO = V3(), vI = V3(), v1 = V3(), v2 = V3(), v3 = V3(), v4 = V3(), vS = V3(), mB = new THREE.Matrix4();

  const snd = (c, d) => { try { if (M.sound && M.sound.key) M.sound.key(c, d); } catch (e){} };
  const doPress = c => { if (!down.has(c)){ down.add(c); try { kb.press(c); } catch (e){} snd(c, true); } };
  const doRelease = c => { if (down.has(c)){ down.delete(c); try { kb.release(c); } catch (e){} snd(c, false); } };

  /* hand pose for a wrist position: a little yaw toward where it is reaching */
  const yawFor = (H, W) => clamp(-W.clone().sub(H.homeW).dot(lat) * 3.2, -.25, .25);
  function poseHand(H, W, yaw, desk){
    H.hand.position.copy(W);
    H.hand.quaternion.setFromAxisAngle(n, yaw).multiply(H.homeQ);
    if (desk > 0) H.hand.quaternion.slerp(H.deskQ, desk);
    H.hand.updateMatrix(); H.hand.updateMatrixWorld(true);
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
    const p = clamp(A - al, th ? -.5 : -.35, th ? 1.1 : 1.35);
    F.g0.rotation.set(-p, psi, 0);
    F.g1.rotation.x = -c; F.g2.rotation.x = -c * (th ? .8 : .55);
    F.g0.updateMatrixWorld(true);
    F.tip.set(0, 0, -F.L[2]); F.g2.localToWorld(F.tip); root.worldToLocal(F.tip);
  }
  /* solve; if the target was out of reach and the pad would end up inside the caps, aim higher until it clears them */
  function solveSafe(F, P, below){
    solveFinger(F, P);
    let sink = capTop(F.tip.dot(kfw)) + F.clear - below - F.tip.dot(n);
    if (sink > .0004){ vS.copy(P); for (let i = 0; i < 4 && sink > .0004; i++){ vS.addScaledVector(n, sink * 1.5); solveFinger(F, vS); sink = capTop(F.tip.dot(kfw)) + F.clear - below - F.tip.dot(n); } }
  }

  /* Where the wrist has to be for finger F to land on key-top K: the hand moves ~40% of the way on its own (as a
     typist's does), then the residual the finger cannot reach is iterated out with the real finger IK. Cached. */
  const reachCache = new Map();
  function reachFor(F, K, key){
    const ck = key && (F.h + ':' + F.f + ':' + key);
    if (ck && reachCache.has(ck)) return reachCache.get(ck);
    const H = hands[F.h], Kc = K.clone().addScaledVector(n, F.clear);
    const d = Kc.clone().sub(F.restHome); d.addScaledVector(n, -d.dot(n));
    const W = H.homeW.clone().addScaledVector(d, F.f === 0 ? .25 : .42);
    const saveP = H.hand.position.clone(), saveQ = H.hand.quaternion.clone();
    for (let it = 0; it < 12; it++){
      poseHand(H, W, yawFor(H, W), 0); solveFinger(F, Kc);
      const err = Kc.clone().sub(F.tip); if (err.length() < 2e-4) break;
      W.addScaledVector(err, .9);
    }
    H.hand.position.copy(saveP); H.hand.quaternion.copy(saveQ); H.hand.updateMatrix(); H.hand.updateMatrixWorld(true);
    const r = W.sub(H.homeW);
    if (ck) reachCache.set(ck, r);
    return r;
  }

  function fingerFor(code, pos){
    if (code === 'Space'){      // the thumb of the less busy hand; on a tie, the hand that did not type last
      // (a hand reaching up the board counts as busy: its thumb can no longer get back to the bar; a sideways shift does not
      // matter, the thumb just meets the bar further along)
      const busy = H => H.fingers.reduce((a, G) => a + (G.mode === 'strike' ? 2 : G.mode === 'hold' ? 1 : 0), 0)
        + Math.max(0, v1.copy(H.hold).sub(H.homeW).dot(kfw), v1.copy(H.W.x).sub(H.homeW).dot(kfw)) * 160;
      const b0 = busy(hands[0]), b1 = busy(hands[1]);
      return hands[Math.abs(b0 - b1) < .5 ? 1 - lastHand : b0 < b1 ? 0 : 1].fingers[0];
    }
    const m = FINGER[code];
    let F = null;
    if (m) F = hands[m[0]].fingers[m[1]];
    else if (pos){                         // unknown key with a position: nearest home fingertip
      let bd = 1e9;
      for (const H of hands) for (const G of H.fingers){
        const d = pos.clone().sub(G.restHome); const dl = Math.abs(d.dot(lat)), df = d.dot(kfw);
        const sc = dl + (G.f === 0 ? (df < -1.5 * U_KEY ? 0 : 3 * U_KEY) : Math.max(0, -df - 1.5 * U_KEY));
        if (sc < bd){ bd = sc; F = G; }
      }
    } else F = hands[1].fingers[1];
    // that finger is holding a modifier (a pinky on Shift): its neighbour takes the key
    if (F.f && (F.mode === 'hold' || F.mode === 'strike') && F.code && MOD.test(F.code) && F.code !== code && owner.has(F.code)){
      F = hands[F.h].fingers[F.f === 1 ? 2 : F.f - 1];
    }
    return F;
  }
  const handOf = code => { const m = FINGER[code]; return m ? m[0] : null; };

  function strike(code, vcode, F, delay, fromQueue){
    let K = keyLocal(vcode);
    const real = !!K && has(vcode);
    let barOff = 0;
    if (vcode === 'Space' && K){        // the thumb meets the bar wherever its hand is along the board
      const H = hands[F.h], c = K.dot(lat);
      K = thumbKey[F.h].clone(); const k0 = K.dot(lat);
      barOff = clamp(H.hold.clone().sub(H.homeW).dot(lat), c - 2.6 * U_KEY - k0, c + 2.6 * U_KEY - k0);
      K.addScaledVector(lat, barOff);
    }
    if (!K) K = F.restHome.clone().addScaledVector(n, -F.clear - HOVER);     // unknown: just bob the finger
    // the same finger is still on its way to (or has only just touched) another key: finish that stroke first,
    // so every key that goes down is visibly struck, then go straight on to this one
    if (!fromQueue && F.vcode && (F.queue.length || (F.mode === 'strike' && !F.pressed) || (F.mode === 'hold' && F.t - F.tC < .025))){
      F.queue.push({ code, vcode, up: false }); owner.set(code, F); lastKey = T; return;
    }
    if ((F.mode === 'strike' || F.mode === 'hold') && F.vcode){      // the finger leaves a key it was still on
      const old = F.vcode;
      if (!F.pressed && F.real){ doPress(old); timers.push({ at: T + .05, fn: () => doRelease(old) }); }
      else doRelease(old);
    }
    // Shift first, then the letter: a stroke on the hand whose pinky is still on its way to Shift waits for it to land
    if (!MOD.test(vcode)) for (const G of hands[F.h].fingers)
      if (G !== F && G.mode === 'strike' && !G.pressed && G.code && MOD.test(G.code)) delay = Math.max(delay || 0, G.Td - G.t + .008);
    const resting = F.mode === 'idle' || (F.mode === 'release' && F.relT > .08);
    F.mode = 'strike'; F.code = code; F.vcode = vcode; F.real = real; F.pressed = false; F.upReq = false; F.t = -(delay || 0); F.e1 = undefined;
    F.K.copy(K); F.from.copy(F.P);
    F.v0.copy(delay ? ZERO : F.vel); if (F.v0.length() > .45) F.v0.setLength(.45);     // carry the finger's momentum into the new stroke
    const dist = F.from.distanceTo(v1.copy(K).addScaledVector(n, F.clear));
    F.reach.copy(reachFor(F, K, real || LAYOUT[vcode] ? vcode + (vcode === 'Space' ? F.h : '') : null)).addScaledVector(lat, barOff);
    /* A touch typist's stroke is short and decisive: ~35-50 ms from the base knuckle for a key under the finger, longer
       only as far as the finger (and, for big reaches, the hand) has to travel. The wrist is driven to arrive with it. */
    const H = hands[F.h], move = H.W.x.distanceTo(v1.copy(H.homeW).add(F.reach));
    F.Td = clamp(.04 + dist * .2 + move * .25 + Math.max(0, dist - .025) * .9 + Math.max(0, move - .012) * .9, .04, .13) + .14 * H.desk.x;
    // a finger lifting off its resting cap rises a couple of mm; one already travelling arcs higher over the keys between
    F.lift = (F.f === 0 ? .0012 : resting ? .003 : .0018) + clamp(dist - .012, 0, .05) * (F.f === 0 ? .05 : .11);
    // wrist stiffness: lands the hand with the finger on a big reach; lazy when the finger alone can make up the gap
    F.wW = 16 + (clamp(7.6 / Math.max(.03, F.Td + (delay || 0)), 30, 120) - 16) * smooth(.002, .008, move);
    owner.set(code, F);
    lastKey = T;
    if (F.f !== 0 && !MOD.test(code)) lastHand = F.h;
  }

  function startShift(code, hand){
    const vcode = hand === null ? code : hand ? 'ShiftRight' : 'ShiftLeft';
    const F = hands[vcode === 'ShiftRight' ? 1 : 0].fingers[4];
    strike(code, vcode, F, 0);
    return F;
  }
  function flushShift(){ if (pendShift){ const p = pendShift; pendShift = null; startShift(p.code, null); } }

  function keyDown(code){
    if (owner.has(code) || (pendShift && pendShift.code === code)) return;
    lastKey = T;
    for (const H of hands) H.deskT = 0;
    if (/^Shift/.test(code)){ flushShift(); pendShift = { code, at: T }; return; }
    let delay = 0;
    if (pendShift){
      const hk = code === 'Space' ? null : handOf(code);
      startShift(pendShift.code, hk === null ? null : 1 - hk); pendShift = null; delay = .03;
    }
    const pos = keyLocal(code);
    const F = fingerFor(code, pos);
    strike(code, code, F, delay);
  }
  function keyUp(code){
    if (pendShift && pendShift.code === code){ const F = startShift(code, null); pendShift = null; F.upReq = true; owner.delete(code); return; }
    const F = owner.get(code); owner.delete(code);
    if (!F) return;
    // at most one stroke of a key is still 'down': the one in flight, or else the one waiting in this finger's queue
    const live = F.code === code && (F.mode === 'strike' || F.mode === 'hold') && !F.upReq;
    if (!live){ const q = F.queue.find(e => e.code === code && !e.up); if (q){ q.up = true; return; } }
    if (live){
      if (!F.pressed){ F.upReq = true; return; }      // tapped faster than the finger travels: release right after contact
      F.mode = 'release'; F.relT = 0; F.w.x = 1; F.w.v = 0;
      doRelease(F.vcode);
    }
  }

  function findLamp(){
    if (!api.scene) return;
    let bestL = null, sc = -1;
    api.scene.traverse(o => { if ((o.isPointLight || o.isSpotLight) && o.visible){ const c = o.color, w = (c.r - c.b + .2) * (o.intensity || 1); if (w > sc){ sc = w; bestL = o; } } });
    if (bestL){ bestL.getWorldPosition(U.uLampP.value); lamped = true; }
  }

  function update(dt, t){
    dt = clamp(dt || 0, 0, .05); T += dt;
    if (!lamped && (lampScan -= dt) <= 0){ lampScan = 1.5; findLamp(); }
    // the warm rim follows the lamp's switch: track the spot light at the lamp's position
    if (!lampRef && api.scene && (lampFind -= dt) <= 0){ lampFind = 2; let bd = .3;
      api.scene.traverse(o => { if (o.isSpotLight){ const d = o.getWorldPosition(V3()).distanceTo(U.uLampP.value); if (d < bd){ bd = d; lampRef = o; } } }); }
    if (lampRef){ lampMax = Math.max(lampMax, lampRef.intensity); U.uLampK.value = lampRef.visible && lampMax > 0 ? lampRef.intensity / lampMax : 0; }
    for (let i = timers.length - 1; i >= 0; i--) if (T >= timers[i].at){ const f = timers[i].fn; timers.splice(i, 1); f(); }
    if (pendShift && T - pendShift.at > .085) flushShift();

    /* ---- posture: lean in a touch while typing, breathing, slow weight shifts ---- */
    const typing = T - lastKey < 1.4 ? 1 : 0;
    spring(act, typing, typing ? 4 : 1.4, dt);
    // breathing: ~4.6 s cycles whose length and depth wander, not a metronome
    bPh += dt * 2 * PI / 4.6 * (1 + .22 * fbm(T * .09, 1));
    const breath = Math.sin(bPh) * (.8 + .25 * fbm(T * .13, 2));
    if ((swayT += dt) > swayAt){ swayT = 0; swayAt = 7 + Math.random() * 9; sway.tgt = (Math.random() - .5) * .03; twist.tgt = (Math.random() - .5) * .03; }
    spring(sway, sway.tgt || 0, 1.3, dt); spring(twist, twist.tgt || 0, 1.1, dt);
    spring(lean, lean0 + .03 * act.x, 3, dt);
    spine.rotation.set(-(lean.x + .006 * breath), twist.x + .009 * fbm(T * .05, 3), sway.x + .007 * fbm(T * .06, 4));
    root.updateWorldMatrix(true, false);
    spine.updateMatrix();

    /* ---- long idle: now and then one hand comes off the keys to rest on the desk ---- */
    /* the resting spot is below the lean-back frame: while the visitor looks down at the desk, both hands stay on
       (or come back to) the keys, so the view never shows a one-handed typist */
    const watched = api.camera && api.camera.getWorldDirection(v1).y < -.3;
    if (watched){ for (const H of hands) H.deskT = 0; deskCheck = Math.max(deskCheck, 3); }
    else if (T - lastKey > 8 && (deskCheck -= dt) <= 0){
      deskCheck = 4 + Math.random() * 6;
      const on = hands.find(H => H.deskT);
      if (!on){ if (Math.random() < .55) hands[Math.random() < .6 ? 0 : 1].deskT = 1; }
      else if (Math.random() < .25) on.deskT = 0;
    }

    for (const H of hands){
      /* ---- wrist: goes where the active fingers need it (precomputed reach), drifts with the active region ---- */
      /* the hand commits to every stroke in flight from its first frame (the reach of the finger about to land weighs
         most), through a cascaded spring: a bell-shaped speed with no snap at either end. Small reaches drive it
         lazily (the fingers do the work, so fast typing leaves the hands nearly still); big ones (digits, Backspace,
         Enter) bring the hand, and with it the forearm and elbow, in time for contact. Quiet again, it eases home. */
      const tgt = v2.set(0, 0, 0); let wsum = 0, lead = null, wW = 0;
      for (const F of H.fingers){
        if (F.mode !== 'strike' && F.mode !== 'hold') continue;
        // (a thumb going for the bar while its hand is out on a reach brings the hand back with it)
        const wgt = F.mode === 'strike' ? (F.f === 0 ? .25 + 2 * smooth(.006, .02, H.W.x.distanceTo(H.homeW)) : 1) * (F.t < 0 ? .4 : .6 + smooth(0, .7, F.t / F.Td))
          * (MOD.test(F.code || '') ? 2 : 1) : MOD.test(F.code || '') ? .3 : F.f === 0 ? .12 : .45;     // a pinky holding Shift anchors the hand
        tgt.addScaledVector(F.reach, wgt); wsum += wgt;
        if (F.mode === 'strike'){
          wW = Math.max(wW, F.wW);
          if (F.t / F.Td > .5 && (!lead || F.t / F.Td > lead.t / lead.Td)) lead = F;   // the finger about to land
        }
      }
      let w;
      if (wsum > 0){
        tgt.multiplyScalar(1 / wsum).add(H.homeW);
        H.hold.copy(tgt); H.lastActive = T; w = wW || 20;
        H.region.step(tgt, 5, dt);
      } else {
        const q = T - H.lastActive;
        H.region.step(H.homeW, q < .6 ? .5 : 2.5, dt);
        w = q < .4 ? 15 : 9;
        // at rest: the breath lifts the wrist a little, and it wanders by about a millimetre (noise, not a sine)
        H.hold.copy(H.homeW).lerp(H.region.x, .35).addScaledVector(n, .0009 * (1 + breath) + .0004 * fbm(T * .37, 10 + H.h))
          .addScaledVector(kfw, .0011 * fbm(T * .21, 20 + H.h)).addScaledVector(lat, .0009 * fbm(T * .17, 30 + H.h));
      }
      H.Wt.step(H.hold, w, dt);
      const W = H.W.step(H.Wt.x, w, dt);
      spring(H.desk, H.deskT, H.deskT ? 2.6 : 9, dt);
      const dk = smooth(0, 1, H.desk.x);
      H.nudge.multiplyScalar(Math.exp(-(lead ? 3 : 7) * dt));
      spring(H.yaw, yawFor(H, W), 14, dt);
      const Wp = v4.copy(W).lerp(H.deskW, dk).add(H.nudge);
      if (dk > 0 && dk < 1) Wp.addScaledVector(n, .03 * Math.sin(PI * dk));      // lift over the keyboard edge

      /* ---- arm: 2-bone IK, shoulder -> elbow -> wrist, elbow out and down; cloth frames keep a stable roll ---- */
      const Sh = v3.copy(SHOULDER[H.h]); Sh.y += .003 * breath; Sh.applyMatrix4(spine.matrix);
      const dv = Wp.clone().sub(Sh); let dist = dv.length(); dv.normalize();
      dist = clamp(dist, Math.abs(L1 - L2) + .01, L1 + L2 - .004);
      Wp.copy(Sh).addScaledVector(dv, dist);
      poseHand(H, Wp, H.yaw.x * (1 - dk), dk);
      const dLat = v1.copy(W).sub(H.homeW).dot(lat);
      spring(H.elbowOut, clamp(dLat * H.side * 4, -.4, .6), 6, dt);
      const pole = V3(H.side * (1.25 + H.elbowOut.x), -.55, .3).normalize();   // elbows out by the sides: the forearms come in from the corners
      pole.addScaledVector(dv, -pole.dot(dv)).normalize();
      const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist), hh = Math.sqrt(Math.max(0, L1 * L1 - a * a));
      const E = Sh.clone().addScaledVector(dv, a).addScaledVector(pole, hh);
      const frame = (g, from, to, xHint) => {
        const yA = to.clone().sub(from).normalize(), xA = xHint.clone().addScaledVector(yA, -xHint.dot(yA)).normalize(), zA = xA.clone().cross(yA);
        g.position.copy(from); g.quaternion.setFromRotationMatrix(mB.makeBasis(xA, yA, zA));
      };
      frame(H.upper, Sh, E, V3(H.side, 0, 0));
      frame(H.fore, E, Wp, V3(1, 0, 0).applyQuaternion(H.hand.quaternion));

      /* ---- fingers ---- */
      // idle adjustments: once the hand has been still a while, every few seconds one finger shifts or lifts a hair
      // on its key and settles again (never a tapping rhythm, never off the key)
      if ((H.fidAt -= dt) <= 0){
        if (H.fidF){ H.fidF.fidT.set(0, 0, 0); H.fidF = null; H.fidAt = 2.5 + Math.random() * 6.5; }
        else if (!wsum && T - H.lastActive > 1.5 && dk < .5){
          const G = H.fingers[1 + Math.floor(Math.random() * 4)];
          if (G.mode === 'idle' && !G.queue.length){
            G.fidT.set((Math.random() - .5) * .0016, .0003 + Math.random() * .0011, (Math.random() - .5) * .002);
            H.fidF = G; H.fidAt = .4 + Math.random() * .8;
          } else H.fidAt = 1;
        } else H.fidAt = 1 + Math.random();
      }
      for (const F of H.fingers){
        F.fid.step(F.mode === 'idle' && !wsum ? F.fidT : ZERO, 10, dt);
        // resting on the cap: the pad stays planted while the hand breathes and drifts above it (the finger flexes
        // instead), and only lifts off for an idle adjustment or with a neighbour's stroke
        const idle = v2.copy(F.restLocal).applyMatrix4(H.hand.matrix);
        idle.addScaledVector(n, (F.restHome.dot(n) - idle.dot(n)) * (1 - dk) * (1 - smooth(.003, .012, H.W.x.distanceTo(H.homeW))));
        vI.copy(F.fid.x).applyQuaternion(H.hand.quaternion); idle.add(vI);
        // sympathetic motion: shared tendons make a finger rise a little with its neighbours' lift (ring with middle most)
        let cp = 0; for (const G of H.fingers) if (G !== F) cp += COUPLE[G.f][F.f] * G.hNow;
        if (cp > 0) idle.addScaledVector(n, Math.min(cp * .4, .0012));
        if (dk > 0){ const hgt = idle.dot(n) - (deskLocalH + FR[F.f][3] * .8 * HS); idle.addScaledVector(n, -hgt * dk * (F.f ? .85 : .5)); }
        // a finger that is not pressing never sinks into the caps, wherever the hand has gone
        if (dk < 1){ const fl = capTop(idle.dot(kfw)) + F.clear + .0002 - idle.dot(n); if (fl > 0) idle.addScaledVector(n, fl * (1 - dk)); }

        // a stroke queued behind this finger's last one starts as soon as that key has been visibly hit
        if (F.queue.length && (F.mode === 'release' || F.mode === 'idle' || (F.mode === 'hold' && F.t - F.tC >= .025))){
          const q = F.queue.shift();
          strike(q.code, q.vcode, F, 0, true);
          if (q.up){ F.upReq = true; if (owner.get(q.code) === F && !F.queue.some(e => e.code === q.code && !e.up)) owner.delete(q.code); }   // its key is already up
        }

        if (F.mode === 'strike'){
          F.t += dt;
          const Kc = v3.copy(F.K).addScaledVector(n, F.clear);
          const u = clamp(F.t / F.Td, 0, 1);
          const e = smooth(0, .8, u);           // across the keys: eased, on the cap centre before the last of the drop
          // the drop: the finger leaves with no vertical jerk (eased clock), peaks early and meets the cap still moving
          // down, so the contact reads as a decisive tap rather than a landing
          const ul = u * u * (2 - u), hgt = F.lift * 4 * ul * (1 - ul);
          F.hNow = hgt;
          F.P.copy(F.from).lerp(Kc, e).addScaledVector(n, hgt).addScaledVector(F.v0, F.Td * u * (1 - u) * (1 - u));
          solveSafe(F, F.P, 0);
          if (u >= 1){
            const err = F.tip.distanceTo(Kc);
            if (F.e1 === undefined) F.e1 = err;
            if (err < .0015 || F.t > F.Td + .1){
              F.mode = 'hold'; F.pressed = true; F.tC = F.t; F.depth.x = 0; F.depth.v = 55; F.hNow = 0;
              contacts.push({ e1: F.e1, Td: F.Td, code: F.vcode, err: F.tip.clone().sub(Kc), t: F.t, at: T.toFixed(2) + '/h' + F.h });
              if (contacts.length > 400) contacts.shift();
              if (F.real) doPress(F.vcode); else snd(F.vcode, true);
            }
          }
          if (F === lead){           // what the finger cannot reach, the wrist makes up next frame
            const err = v1.copy(F.P).sub(F.tip);
            if (err.length() > 2e-4){ err.multiplyScalar(.5); if (err.length() > .002) err.setLength(.002); H.nudge.add(err); }   // gently: never a visible kick
            if (H.nudge.length() > .02) H.nudge.setLength(.02);
          }
        } else if (F.mode === 'hold'){
          // the finger follows the cap to the bottom of its travel and dwells there while the key is held
          F.t += dt; F.hNow = 0;
          spring(F.depth, 1, 95, dt);
          F.P.copy(F.K).addScaledVector(n, F.clear - F.depth.x * TRAVEL);
          solveFinger(F, F.P);
          if (F.upReq && F.t - F.tC > .045){
            const c = F.vcode; F.upReq = false; F.mode = 'release'; F.relT = 0; F.w.x = 1; F.w.v = 0;
            if (F.real) doRelease(c); else snd(c, false);
          }
        } else {
          F.relT += dt;
          let rb = 0;
          if (F.mode === 'release'){
            // quick release: the finger rides the cap back up, lifts a hair off it and eases home (critically damped:
            // no rubbery wobble)
            spring(F.depth, 0, 60, dt);
            spring(F.w, 0, F.f === 0 ? 28 : 32, dt);
            rb = (F.f === 0 ? .0005 : .001) * Math.sin(PI * clamp(F.relT / .14, 0, 1));
            if (F.relT > .5 || (F.w.x < .002 && Math.abs(F.w.v) < .03)){ F.mode = 'idle'; F.code = null; F.vcode = null; rb = 0; }
          }
          const Kc = v3.copy(F.K).addScaledVector(n, F.clear - F.depth.x * TRAVEL);
          F.P.copy(idle).lerp(Kc, F.mode === 'release' ? clamp(F.w.x, 0, 1) : 0).addScaledVector(n, rb);
          F.hNow = rb;
          solveSafe(F, F.P, F.mode === 'release' ? TRAVEL * clamp(F.depth.x, 0, 1) : 0);
        }
        if (dt > 0){ F.vel.copy(F.P).sub(F.prevP).multiplyScalar(1 / dt); F.prevP.copy(F.P); }
      }
    }
  }

  // settle into the home pose before the first frame
  for (const H of hands) for (const F of H.fingers) F.P.copy(F.restHome);
  for (let i = 0; i < 40; i++) update(1 / 30, 0);
  T = 0; lastKey = -9;
  for (const H of hands) H.lastActive = -9;

  /* ---------- the skin: one continuous surface per hand (palm, knuckles, fingers, thumb, wrist and forearm), modelled
     as a signed-distance field in the settled home pose, polygonised once, and skinned to the wrist, forearm and
     finger joints. Idle hands show the sculpted shape exactly; strikes bend it at the joints. ---------- */
  /* Meshing both hands costs ~0.8 s of CPU, so it is not done before the first frame: each hand's field is set up
     now (capturing the home pose and the bind matrices), then polygonised in small slices on idle time after the
     page is interactive. At rest the camera faces the tube, so the hands are never seen before they are ready. */
  root.updateMatrixWorld(true);
  const skinStats = [];
  const now = () => (typeof performance !== 'undefined' ? performance : Date).now();
  const skinJobs = hands.map(H => function* (){
    const t0 = now();
    const bindM = H.hand.matrixWorld.clone(), bones = [H.hand, H.fore]; H.fingers.forEach(F => bones.push(F.g0, F.g1, F.g2));
    const boneInv = bones.map(b => b.matrixWorld.clone().invert());
    const ts = H.ts, q = [0, 0, 0];
    const handInv = H.hand.matrixWorld.clone().invert();
    const rel = o => handInv.clone().multiply(o.matrixWorld);           // a bone's rest frame in hand space
    const inv = m => m.clone().invert().elements;
    const ap = (e, x, y, z) => { q[0] = e[0] * x + e[4] * y + e[8] * z + e[12]; q[1] = e[1] * x + e[5] * y + e[9] * z + e[13]; q[2] = e[2] * x + e[6] * y + e[10] * z + e[14]; return q; };
    // per finger: hand->bone transforms, lengths and radii (lateral; the dorsal-ventral axis is flattened)
    const CH = H.fingers.map(F => {
      const f = F.f, th = f === 0, R = FR[f], gs = [F.g0, F.g1, F.g2];
      // one tapered, sphere-swept tube per bone; neighbouring bones share the joint radius, so the chain is seamless.
      // Only the last bone flattens, toward the tip (the pad below, the nail above), so the end is not a ball.
      const segs = gs.map((g, j) => ({ e: inv(rel(g)), L: F.L[j], r0: R[j], r1: R[j + 1], flat: th ? 1.1 : 1.12, flat2: j === 2 ? TIPFL : 0 }));
      const pts = gs.map(g => V3().setFromMatrixPosition(rel(g))); pts.push(V3(0, 0, -F.L[2]).applyMatrix4(rel(F.g2)));
      const c = pts.reduce((a, p) => a.add(p), V3()).multiplyScalar(.25);
      return { f, th, segs, pts, c, rad: Math.max(...pts.map(p => p.distanceTo(c))) + .022, flat: th ? 1.08 : 1.12, joints: [0, F.L[0], F.L[0] + F.L[1]] };
    });
    const segD = (S, x, y, z, flat) => {
      ap(S.e, x, y, z); const hh = -q[2], t = clamp(hh / S.L, 0, 1);
      const fl = S.flat2 ? S.flat + (S.flat2 - S.flat) * smooth(0, 1, t) : (S.flat || flat);
      return Math.hypot(q[0], q[1] * fl, hh - t * S.L) - (S.r0 + (S.r1 - S.r0) * t);
    };
    const chainD = (C, x, y, z, from) => { let d = segD(C.segs[from], x, y, z, C.flat); for (let j = from + 1; j < 3; j++) d = smin(d, segD(C.segs[j], x, y, z, C.flat), .0012); return d; };
    /* palm: one slightly flattened box with rounded edges, as wide as the knuckles it carries, narrowing a little to
       the wrist; its front edge follows the knuckle arc and covers the knuckle heads, so the knuckles read only as a
       gentle ridge where the fingers leave it (no separate balls). The back of the hand is flat-ish, the heel fuller. */
    const kx = [1, 2, 3, 4].map(f => H.KN[f].x * ts), kz = [1, 2, 3, 4].map(f => H.KN[f].z), ky = [1, 2, 3, 4].map(f => H.KN[f].y);
    const xIn = kx[0] + FR[1][0] * .9, xOut = kx[3] - FR[4][0] * 1.05, zW = .014;    // inner (thumb) and outer edges at the knuckles; wrist line
    const kzAt = xs => {          // knuckle line, piecewise linear across the four knuckles (xs: thumb side +)
      if (xs >= kx[0]) return kz[0]; if (xs <= kx[3]) return kz[3];
      for (let i = 0; i < 3; i++) if (xs <= kx[i] && xs >= kx[i + 1]){ const u = (xs - kx[i + 1]) / (kx[i] - kx[i + 1]); return kz[i + 1] + (kz[i] - kz[i + 1]) * u; }
      return kz[1];
    };
    const kyM = (ky[0] + ky[1] + ky[2] + ky[3]) / 4, RR = .0075;
    const palmDist = (x, y, z) => {
      const xs = x * ts;
      const zf = kzAt(clamp(xs, xOut, xIn)) + .002, t = clamp((z - zf) / (zW - zf), 0, 1);       // 0 at the knuckles, 1 at the wrist
      const st = smooth(.25, 1, t);
      const xi = xIn - .008 * st, xo = xOut + .012 * st;                 // narrows toward the wrist, more on the little-finger side
      const top = kyM + .0068 - .0012 * t, bot = kyM - .0098 - .0052 * smooth(.2, .9, t);   // back of the hand / palm and heel
      const cx = (xi + xo) / 2, cy = (top + bot) / 2, cz = (zf + zW) / 2;
      const qx = Math.abs(xs - cx) - ((xi - xo) / 2 - RR), qy = Math.abs(y - cy) - ((top - bot) / 2 - RR), qz = Math.abs(z - cz) - ((zW - zf) / 2 - RR);
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - RR;
    };
    // wrist and forearm: an elliptical section widening toward the elbow
    const Fe = inv(rel(H.fore));
    const foreDist = (x, y, z) => {
      ap(Fe, x, y, z); const sb = L2 - q[1], k = smooth(.0, .085, sb), a = .0235 + .0055 * k, b = .0158 + .0055 * k; q[2] += .0015 * (1 - k);
      const e = Math.hypot(q[0] / a, q[2] / b) + 1e-9;
      const c1 = -sb / .014, c2 = (sb - .085) / .02, cap = Math.max(0, c1, c2), cs = cap === c1 ? .014 : .02;
      const e2 = e * e, cc = cap * cap, r = Math.sqrt(Math.sqrt(e2 * e2 + cc * cc)) + 1e-9;
      const de = (e / r) ** 3, dc = (cap / r) ** 3;
      const gx = de * q[0] / (a * a * e), gz = de * q[2] / (b * b * e), gy = dc / cs;
      return (r - 1) / Math.hypot(gx, gy, gz);
    };
    const palmD = (x, y, z) => smin(palmDist(x, y, z), foreDist(x, y, z), .016);
    const sdf = (x, y, z) => {
      const pg = smin(palmD(x, y, z), segD(CH[0].segs[0], x, y, z, 1.25), .011);        // + the thumb's fleshy metacarpal (thenar)
      let d = pg;
      for (const C of CH){
        if (Math.hypot(x - C.c.x, y - C.c.y, z - C.c.z) - C.rad > pg + .01) continue;
        d = Math.min(d, smin(pg, chainD(C, x, y, z, C.th ? 1 : 0), C.th ? .006 : .0055));   // fingers blend into the palm, never into each other
      }
      return d;
    };
    // bounds: the chains plus the forearm stub
    const lo = [1, 1, 1], hi = [-1, -1, -1], grow = p => { for (let i = 0; i < 3; i++){ lo[i] = Math.min(lo[i], p.getComponent(i) - .026); hi[i] = Math.max(hi[i], p.getComponent(i) + .026); } };
    for (const C of CH) C.pts.forEach(grow);
    const dF = V3(0, 1, 0).transformDirection(rel(H.fore));        // elbow -> wrist, in hand space
    grow(V3()); grow(dF.clone().multiplyScalar(-.1)); grow(V3(0, 0, .02));
    for (let i = 0; i < 3; i++){ lo[i] -= .012; hi[i] += .012; }
    yield 'setup';
    const SN = yield* surfaceNets(sdf, lo, hi, SKIN_H); const tSN = now() - t0;
    const nv = SN.pos.length / 3, P = new Float32Array(SN.pos), N = new Float32Array(nv * 3), SI = new Uint16Array(nv * 4), SW = new Float32Array(nv * 4);
    const grad = (x, y, z, o) => {      // tetrahedral gradient: 4 samples
      const e = .0003, a = sdf(x + e, y - e, z - e), b = sdf(x - e, y - e, z + e), c = sdf(x - e, y + e, z - e), d = sdf(x + e, y + e, z + e);
      o[0] = a - b - c + d; o[1] = -a - b + c + d; o[2] = -a + b - c + d;
      const l = Math.hypot(o[0], o[1], o[2]) || 1; o[0] /= l; o[1] /= l; o[2] /= l; };
    const g = [0, 0, 0], w = new Float32Array(17), pp = V3(), ab = V3(), ap2 = V3();
    for (let i = 0; i < nv; i++){
      if ((i & 127) === 127) yield;
      let x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      const d0 = sdf(x, y, z); grad(x, y, z, g); x -= d0 * g[0]; y -= d0 * g[1]; z -= d0 * g[2];    // onto the surface
      P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z; N[i * 3] = g[0]; N[i * 3 + 1] = g[1]; N[i * 3 + 2] = g[2];
      // weights: palm vs each finger by a soft nearest-part rule, then along the finger by smooth steps at the joints
      w.fill(0);
      const dp = palmD(x, y, z), dc = CH.map(C => chainD(C, x, y, z, 0));
      const m = Math.min(dp, ...dc), TAU = .0021;
      const ep = Math.exp(-(dp - m) / TAU), ec = dc.map(d => Math.exp(-(d - m) / TAU)), sum = ep + ec.reduce((a, b) => a + b, 0);
      ap(Fe, x, y, z); const wf = smooth(-.004, .04, L2 - q[1]);
      w[0] += ep / sum * (1 - wf); w[1] += ep / sum * wf;
      pp.set(x, y, z);
      CH.forEach((C, f) => {
        const share = ec[f] / sum; if (share < 1e-4) return;
        let best = 1e9, sArc = 0, acc = 0;
        for (let j = 0; j < 3; j++){
          ab.copy(C.pts[j + 1]).sub(C.pts[j]); const L = ab.length();
          const t = clamp(ap2.copy(pp).sub(C.pts[j]).dot(ab) / (L * L), j ? 0 : -1e9, j < 2 ? 1 : 1e9);
          const d = ap2.copy(C.pts[j]).addScaledVector(ab, t).distanceTo(pp);
          if (d < best){ best = d; sArc = acc + t * L; }
          acc += L;
        }
        const s1 = C.joints[1], s2 = C.joints[2], b1 = C.th ? .009 : .0085, b2 = .0068;
        const w2 = smooth(s2 - b2, s2 + b2, sArc), w0 = 1 - smooth(s1 - b1, s1 + b1, sArc), w1 = Math.max(0, 1 - w0 - w2);
        w[2 + f * 3] += share * w0; w[3 + f * 3] += share * w1; w[4 + f * 3] += share * w2;
      });
      const order = [...w.keys()].sort((a, b) => w[b] - w[a]).slice(0, 4);
      const tot = order.reduce((a, k) => a + w[k], 0) || 1;
      order.forEach((k, j) => { SI[i * 4 + j] = k; SW[i * 4 + j] = w[k] / tot; });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
    geo.setIndex(SN.idx);
    const sm = new THREE.SkinnedMesh(geo, sil);
    sm.bind(new THREE.Skeleton(bones, boneInv), bindM);     // inverses captured in the home pose, before any key was struck
    sm.frustumCulled = false; sm.castShadow = true; sm.receiveShadow = true; sm.name = 'hand-skin';
    root.add(sm); H.skin = sm;
    skinStats.push({ verts: nv, tris: SN.idx.length / 3, nets: Math.round(tSN), ms: Math.round(now() - t0) });
  }());
  for (const g of skinJobs) g.next();            // set up now: runs to the 'setup' yield, so the bind pose is the home pose
  {
    // then mesh in ~6 ms slices between frames; a hidden tab or no idle time still finishes (timeout)
    const idle = window.requestIdleCallback ? (f => requestIdleCallback(f, { timeout: 60 })) : (f => setTimeout(f, 16));
    let j = 0;
    const slice = () => {
      const end = now() + 8;
      while (j < skinJobs.length && now() < end){ if (skinJobs[j].next().done) j++; }
      if (j < skinJobs.length) idle(slice); else if (api.renderer && api.scene && api.camera) try { api.renderer.compile(api.scene, api.camera); } catch (e){}
    };
    setTimeout(() => idle(slice), 250);
  }

  root.userData.dbg = { hands, s, skinStats, contacts, spineOff, lean0 };
  return { object3d: root, keyDown, keyUp, update };
};
})();
