/* Typist: the person whose eyes the visitor looks through. Only the forearms, sleeves and hands are ever
   seen (head, hair, hood and torso render into the lamp's shadow map only), so the hands are the hero model:
   a sculpted palm with knuckles and tendons, tapered three-segment fingers with nails, a defined thumb, a skin
   wrist running into a ribbed hoodie cuff, and a sleeve that bunches at the elbow. Arms are 2-bone IK, fingers
   3-segment planar IK. Every keystroke is a timed strike (lift, accelerate, land on the cap centre, follow the
   key down, release with a rebound); the wrist travels as far as the finger needs, and any residual the finger
   cannot reach is fed back into the wrist so contact lands on the cap centre. */
(() => {
'use strict';
const M = window.MAC = window.MAC || {};

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const gauss = (x, w) => Math.exp(-(x / w) * (x / w));
const PI = Math.PI;
const lin = hex => new THREE.Color(hex).convertSRGBToLinear();

/* Exact critically damped spring step (stable for any dt). s = {x, v}. */
function spring(s, target, w, dt){
  const y = s.x - target, e = Math.exp(-w * dt), k = (s.v + w * y) * dt;
  s.x = target + (y + k) * e; s.v = (s.v - w * k) * e; return s.x;
}
/* Under-damped spring (zeta < 1) for the little rebound after a release; sub-stepped, so stable at any dt. */
function bouncy(s, target, w, zeta, dt){
  const n = Math.max(1, Math.ceil(dt * 480)), h = dt / n;
  for (let i = 0; i < n; i++){ s.v += (-w * w * (s.x - target) - 2 * zeta * w * s.v) * h; s.x += s.v * h; }
  return s.x;
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
const KNUCKLE = [1, .8, .76], PLAIN = [1, 1, 1];
const mix3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

/* One finger segment along -Z (dorsal = +Y): tapered, slightly flattened palm-to-back, flushed at the knuckle. */
function fingerSeg(r0, r1, len, distal){
  const g = capsule(r0, r1, len, 20, null, v => {
    const t = clamp(v.y / len, 0, 1);
    v.z *= .87 - (distal ? .05 * t : 0);                 // flatter toward the pad
    v.x *= 1 + (distal ? .05 * smooth(.4, 1, t) : 0);     // fingertips spread a touch
    if (distal && v.z < 0) v.z -= .0012 * gauss(t - .62, .3);   // the fleshy pad
  }, 7);
  g.rotateX(-PI / 2);
  return tint(g, (x, y, z) => {
    const back = smooth(-.2 * r0, .6 * r0, y);
    let k = back * gauss(z / r0, .9) * .9;                                       // knuckle at the proximal joint
    if (distal) k = Math.max(k, .45 * smooth(-len * .7, -len - r1, z));      // pink fingertip
    return mix3(PLAIN, KNUCKLE, clamp(k, 0, 1));
  });
}

/* The palm: a superellipsoid with a dorsal arch, knuckle heads, faint extensor tendons and a thenar pad. */
function palmGeo(ts, KX){
  const g = new THREE.SphereGeometry(1, 64, 40), P = g.attributes.position, C = new Float32Array(P.count * 3);
  for (let i = 0; i < P.count; i++){
    const ux = P.getX(i), uy = P.getY(i), uz0 = P.getZ(i);
    const uz = Math.sign(uz0) * Math.pow(Math.abs(uz0), .55);
    const t = (uz + 1) / 2;                                    // 0 = knuckle end, 1 = wrist end
    const z = -.093 + t * .097;
    const w = .0415 - .011 * smooth(.3, 1, t) + .002 * (ux * ts > 0 ? smooth(.2, .7, t) * (1 - smooth(.7, 1, t)) : 0);
    const x = Math.sign(ux) * Math.pow(Math.abs(ux), .7) * w, xn = x / .0415;
    const top = .0142 * (1 - .5 * xn * xn) * (1 - .3 * smooth(.6, 1, t)) + .0015;
    const bot = .0118 * (1 - .35 * xn * xn) + .0065 * gauss(x - ts * .02, .014) * gauss(z + .035, .03) + .003 * gauss(x + ts * .022, .012) * gauss(z + .04, .035);
    let y = uy > 0 ? Math.pow(uy, .75) * top : -Math.pow(-uy, .75) * bot;
    let red = 0;
    if (uy > 0){
      for (const kx of KX){
        const b = gauss(x - kx, .0072) * gauss(z + .085, .0085);
        y += .0032 * b * uy; red = Math.max(red, b);
        y += .0006 * gauss(x - kx * (1 - .35 * t), .0028) * smooth(.15, .45, t) * (1 - smooth(.6, .95, t)) * uy;   // extensor tendons
      }
    }
    P.setXYZ(i, x, y, z);
    const c = mix3(PLAIN, KNUCKLE, clamp(red * .85, 0, 1));
    C[i * 3] = c[0]; C[i * 3 + 1] = c[1]; C[i * 3 + 2] = c[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  return weldNormals(g);
}

/* ---------------- materials: skin with wrap-diffuse subsurface + rim; cloth with a soft fresnel sheen ---------------- */
function makeMat(kind, U){
  const skin = kind === 'skin', nail = kind === 'nail';
  const m = new THREE.MeshStandardMaterial(skin ? { color: lin(0xc8927a), roughness: .52, metalness: 0, vertexColors: true }
    : nail ? { color: lin(0xe6c0b2), roughness: .28, metalness: 0 }
    : { color: lin(kind === 'cuff' ? 0x34353b : 0x2e3036), roughness: .93, metalness: 0 });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'varying vec3 vTP;\nvarying vec3 vTN;\n' + sh.vertexShader.replace('#include <fog_vertex>',
      '#include <fog_vertex>\n vTP = (modelMatrix * vec4(transformed, 1.0)).xyz;\n vTN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = 'uniform vec3 uScrP;\nuniform vec3 uLampP;\nuniform vec3 uCrtC;\nuniform vec3 uLampC;\nuniform vec3 uAmbC;\nvarying vec3 vTP;\nvarying vec3 vTN;\n' +
      sh.fragmentShader.replace('#include <output_fragment>', `
  {
    vec3 sN = normalize(vTN); sN = gl_FrontFacing ? sN : -sN;
    vec3 sV = normalize(cameraPosition - vTP);
    vec3 lL = normalize(uLampP - vTP), lC = normalize(uScrP - vTP);
    float nl = dot(sN, lL), nc = dot(sN, lC);
    float fr = pow(1.0 - clamp(dot(sN, sV), 0.0, 1.0), 3.0);
    ${skin ? `
    // wrap diffuse: light bleeds past the terminator, reddened as it travels under the skin
    vec3 sss = diffuseColor.rgb * vec3(1.0, 0.45, 0.33);
    float wl = max(0.0, (nl + 0.6) / 1.6) - max(0.0, nl), wc = max(0.0, (nc + 0.6) / 1.6) - max(0.0, nc);
    outgoingLight += sss * (uLampC * wl + uCrtC * wc) * 1.3;
    outgoingLight += sss * uLampC * pow(clamp(dot(sV, -lL), 0.0, 1.0), 6.0) * 0.35;      // thin edges glow when backlit
    outgoingLight += fr * (uLampC * clamp(nl * 0.5 + 0.5, 0.0, 1.0) * 0.45 + uCrtC * clamp(nc * 0.5 + 0.5, 0.0, 1.0) * 0.8 + uAmbC) * vec3(1.0, 0.82, 0.76);`
    : nail ? `
    outgoingLight += fr * (uCrtC * clamp(nc * 0.5 + 0.5, 0.0, 1.0) + uLampC * 0.3) * 0.6;`
    : `
    outgoingLight += fr * 0.8 * (uCrtC * clamp(nc * 0.6 + 0.4, 0.0, 1.0) + uLampC * pow(clamp(nl * 0.7 + 0.3, 0.0, 1.0), 2.0) * 0.6 + uAmbC);`}
  }
#include <output_fragment>`);
  };
  m.customProgramCacheKey = () => 'mac-typist-' + kind;
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
  const U_KEY = uW, TRAVEL = .0032, HOVER = .0045, HAND_W = 30;

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
    uCrtC: { value: new THREE.Color(.36, 1, .62).multiplyScalar(.075) }, uLampC: { value: new THREE.Color(1, .7, .46).multiplyScalar(.2) },
    uAmbC: { value: new THREE.Color(.11, .13, .2).multiplyScalar(.12) },
  };
  const cloth = makeMat('cloth', U), cuffM = makeMat('cuff', U), skin = makeMat('skin', U), nailM = makeMat('nail', U);
  const ghost = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });   // casts the body's shadow, never seen
  const mesh = (geo, mat, parent, pos, rot) => {
    const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = mat !== ghost;
    if (pos) m.position.copy(pos); if (rot) m.rotation.set(rot[0], rot[1], rot[2], rot[3] || 'XYZ');
    if (mat === ghost){ m.userData.noShadow = false; m.renderOrder = -1; }
    parent.add(m); return m;
  };

  /* ---------- body: hips and legs as cloth, the rest shadow-only (the camera sits in the head) ---------- */
  const floorY = clamp(seatW.y > .2 ? -seatW.y : -.42, -.55, -.3);
  const hips = new THREE.Group(); root.add(hips);
  mesh(blob(.165, .085, .15, (x, y, z) => .03 * Math.sin(x * 6 + z * 4) * (y > 0 ? 1 : .3)), cloth, hips, V3(0, .075, .01));
  for (const sd of [-1, 1]){
    const hip = V3(sd * .088, .085, -.01), knee = V3(sd * .112, .105, -.43), ankle = V3(sd * .12, floorY + .075, -.47);
    const seg = (a, b, r0, r1) => { const d = b.clone().sub(a), g = new THREE.Group(); g.position.copy(a); g.quaternion.setFromUnitVectors(V3(0, 1, 0), d.clone().normalize()); hips.add(g);
      mesh(capsule(r0, r1, d.length(), 16, (an, y) => .025 * Math.sin(an * 5 + y * 30) * smooth(0, .1, y)), cloth, g); };
    seg(hip, knee, .074, .056); seg(knee, ankle, .052, .04);
    mesh(blob(.045, .035, .11), cloth, hips, ankle.clone().add(V3(0, -.035, -.055)));
  }
  const SPINE0 = V3(0, .08, .03);
  const spine = new THREE.Group(); spine.position.copy(SPINE0); spine.rotation.order = 'YXZ'; root.add(spine);
  const torsoProf = [[0, -.07], [.14, -.068], [.168, -.045], [.172, -.005], [.163, .03], [.153, .1], [.157, .2], [.17, .29], [.181, .35], [.186, .395], [.17, .435], [.135, .47], [.096, .497], [.064, .515], [0, .522]];
  mesh(lathe(torsoProf, 24, null, v => { v.z *= .64; }), ghost, spine);
  const SHOULDER = [V3(-.172, .44, .005), V3(.172, .44, .005)];
  const EYE_S = V3(0, .665, -.085);                       // eyes, in spine space
  mesh(capsule(.058, .05, .065, 12), ghost, spine, V3(0, .485, -.012));
  mesh(blob(.08, .105, .1), ghost, spine, V3(0, .66, -.03));   // head + hair

  /* ---------- arms: sleeve, elbow bunching, cuff, wrist ---------- */
  const L1 = .29, L2 = .265;
  const upperGeo = capsule(.054, .049, L1, 40,
    (a, y) => .05 * Math.sin(y * 70 + 1.8 * Math.sin(a * 2 + .5)) * smooth(.17, .27, y) + .025 * Math.sin(a * 4 + y * 22) + .02 * Math.sin(a * 3 - y * 30) * (1 - smooth(.04, .12, y)),
    v => { v.x *= 1.04; v.z *= .94; });
  const foreGeo = lathe([[.0001, -.05], [.028, -.046], [.044, -.034], [.052, -.012], [.054, .018], [.051, .05], [.048, .09], [.0455, .13], [.0445, .158], [.0465, .177], [.045, .192],
    [.039, .2], [.0345, .205], [.0335, .214], [.0335, .232], [.031, .2385], [.0255, .2415], [.0001, .242]], 72,
    (a, y) => (1 - smooth(.0, .1, y)) * (.075 * Math.sin(y * 92 + 1.6 * Math.sin(a * 2 + 1)) + .03 * Math.sin(a * 5 + y * 40))            // bunching at the elbow
      + smooth(.05, .1, y) * (1 - smooth(.15, .18, y)) * (.028 * Math.sin(a * 3 + y * 28) + .014 * Math.sin(a * 7 - y * 22))          // drape along the forearm
      + smooth(.15, .168, y) * (1 - smooth(.188, .2, y)) * .045 * Math.sin(a * 4 + y * 50 + 1)                                        // slack piling onto the cuff
      + smooth(.204, .21, y) * (1 - smooth(.232, .238, y)) * .03 * Math.sin(a * 24),                                                 // rib knit
    v => { v.x *= 1.1; v.z *= .86; });
  const wristGeo = tint(capsule(.0225, .0215, .05, 28, null, v => { v.x *= 1.22; v.z *= .78; v.z += .002 * smooth(.02, .05, v.y); }, 6), () => PLAIN);
  const elbowGeo = blob(.056, .056, .056, (x, y, z) => .05 * Math.sin(x * 7 + y * 5) * Math.cos(z * 4));

  /* ---------- hands ---------- */
  const FL = [[.036, .03, .027], [.042, .025, .0195], [.046, .028, .0205], [.043, .026, .0195], [.034, .021, .0185]];
  const FR = [[.0122, .0108, .0098], [.0092, .0084, .0076], [.0096, .0087, .0078], [.009, .0081, .0073], [.008, .0072, .0066]];
  const TABLES = FL.map((L, f) => f === 0 ? fingerTable(L, .8, 1.25) : fingerTable(L, .55, 1.75));
  const segGeo = FL.map((L, f) => L.map((l, j) => fingerSeg(FR[f][j], j < 2 ? FR[f][j + 1] : FR[f][j] * .9, l, j === 2)));
  const nailGeo = FL.map((L, f) => { const r = FR[f][2]; const g = blob(r * .74, r * .2, L[2] * .4, (x, y, z) => -.15 * Math.max(0, -y), 16, 10);
    const P = g.attributes.position; for (let i = 0; i < P.count; i++){ const x = P.getX(i); P.setY(i, P.getY(i) - x * x / (r * 2.2)); } return weldNormals(g); });

  const hands = [];
  for (let h = 0; h < 2; h++){
    const side = h ? 1 : -1, ts = -side;            // ts: which local x side the thumb is on
    const hand = new THREE.Group(); root.add(hand);
    const KN = [V3(ts * .029, -.006, -.028), V3(ts * .026, .003, -.088), V3(ts * .008, .004, -.092), V3(-ts * .011, .003, -.088), V3(-ts * .028, .001, -.08)];
    mesh(palmGeo(ts, KN.slice(1).map(k => k.x)), skin, hand);
    mesh(tint(blob(.0175, .0135, .03, null, 24, 16), () => PLAIN), skin, hand, V3(ts * .021, -.005, -.03), [0, -ts * .25, 0]);   // thenar
    const upper = new THREE.Group(); root.add(upper); mesh(upperGeo, cloth, upper); mesh(elbowGeo, cloth, upper, V3(0, L1, 0));
    const fore = new THREE.Group(); root.add(fore); mesh(foreGeo, cuffM, fore); mesh(wristGeo, skin, fore, V3(0, .21, 0));
    const fingers = [];
    for (let f = 0; f < 5; f++){
      const base = new THREE.Group(); base.position.copy(KN[f]); hand.add(base);
      if (f === 0) base.rotation.set(-.35, -ts * .5, 0, 'YXZ'); else base.rotation.y = ts * (f - 2.4) * -.03;
      const g0 = new THREE.Group(); g0.rotation.order = 'YXZ'; base.add(g0);
      const g1 = new THREE.Group(); g1.position.z = -FL[f][0]; g0.add(g1);
      const g2 = new THREE.Group(); g2.position.z = -FL[f][1]; g1.add(g2);
      mesh(segGeo[f][0], skin, g0); mesh(segGeo[f][1], skin, g1); mesh(segGeo[f][2], skin, g2);
      const nl = mesh(nailGeo[f], nailM, g2, V3(0, FR[f][2] * .74, -FL[f][2] * .64), [-.06, 0, 0]);
      if (f === 0) nl.rotation.z = ts * .25;
      fingers.push({ h, f, base, g0, g1, g2, L: FL[f], T: TABLES[f], clear: FR[f][2] * .9 * .87 + .0004,
        mode: 'idle', code: null, vcode: null, real: false, pressed: false, upReq: false, t: 0, tC: 0, Td: .08, lift: .005, relT: 9,
        w: S(0), depth: S(0), act: 0, K: V3(), from: V3(), P: V3(), tip: V3(), restLocal: V3(), restHome: V3(), reach: V3(), start: 0,
        fid: new VSpring(V3()), fidT: V3(), fidAt: 1 + Math.random() * 4, queue: null, vel: V3(), prevP: V3(), v0: V3() });
    }
    hands.push({ h, side, ts, hand, upper, fore, fingers, homeW: V3(), homeQ: new THREE.Quaternion(), deskW: V3(), deskQ: new THREE.Quaternion(),
      W: null, hold: V3(), region: null, nudge: V3(), lastActive: -9, yaw: S(0), desk: S(0), deskT: 0, elbowOut: S(0) });
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
      const target = C.clone().addScaledVector(n, .054).addScaledVector(kfw, -.05);
      H.homeW.copy(target).sub(kc.clone().applyQuaternion(H.homeQ));
      H.W = new VSpring(H.homeW); H.hold.copy(H.homeW); H.region = new VSpring(H.homeW);
      const inv = new THREE.Matrix4().compose(H.homeW, H.homeQ, V3(1, 1, 1)).invert();
      const ixLat = homes[0].clone().sub(space || C).dot(lat);
      const half = 2.7 * U_KEY;
      const tl = clamp(ixLat + (H.h ? -.35 : .55) * U_KEY, -half, half);
      thumbKey[H.h] = (space || C.clone().addScaledVector(kfw, -2 * U_KEY)).clone().addScaledVector(lat, tl);
      H.fingers.forEach((F, f) => {
        const k = f === 0 ? thumbKey[H.h] : homes[f - 1];
        F.restHome.copy(k).addScaledVector(n, F.clear + (f === 0 ? HOVER * 1.4 : HOVER));
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
  let T = 0, lastKey = -9, lastHand = 0, lamped = !!rig.lampPosition, lampScan = 0, pendShift = null, deskCheck = 6, strikeSeq = 0;
  const act = S(0), lean = S(lean0), sway = S(0), twist = S(0);
  let swayT = 0, swayAt = 6;
  const ZERO = V3(), v1 = V3(), v2 = V3(), v3 = V3(), v4 = V3(), Y = V3(0, 1, 0), qA = new THREE.Quaternion(), mB = new THREE.Matrix4();

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
      const busy = H => H.fingers.reduce((a, G) => a + (G.mode === 'strike' ? 2 : G.mode === 'hold' ? 1 : 0), 0);
      const b0 = busy(hands[0]), b1 = busy(hands[1]);
      return hands[b0 === b1 ? 1 - lastHand : b0 < b1 ? 0 : 1].fingers[0];
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

  function strike(code, vcode, F, delay){
    let K = keyLocal(vcode);
    const real = !!K && has(vcode);
    if (vcode === 'Space' && K) K = thumbKey[F.h].clone();
    if (!K) K = F.restHome.clone().addScaledVector(n, -F.clear - HOVER);     // unknown: just bob the finger
    // the same finger is still on its way to (or has only just touched) another key: finish that stroke first,
    // so every key that goes down is visibly struck, then go straight on to this one
    if (!F.queue && F.vcode && F.code !== code && ((F.mode === 'strike' && !F.pressed) || (F.mode === 'hold' && F.t - F.tC < .03))){
      F.queue = { code, vcode, up: false }; owner.set(code, F); lastKey = T; return;
    }
    if ((F.mode === 'strike' || F.mode === 'hold') && F.vcode){      // the finger leaves a key it was still on
      const old = F.vcode;
      if (!F.pressed && F.real){ doPress(old); timers.push({ at: T + .05, fn: () => doRelease(old) }); }
      else doRelease(old);
    }
    F.mode = 'strike'; F.code = code; F.vcode = vcode; F.real = real; F.pressed = false; F.upReq = false; F.t = -(delay || 0);
    F.K.copy(K); F.from.copy(F.P); F.start = ++strikeSeq;
    F.v0.copy(delay ? ZERO : F.vel); if (F.v0.length() > .6) F.v0.setLength(.6);     // carry the finger's momentum into the new stroke
    const dist = F.from.distanceTo(v1.copy(K).addScaledVector(n, F.clear));
    F.Td = clamp(.06 + dist * .9, .062, .12) + .14 * hands[F.h].desk.x;
    F.lift = clamp(.0035 + dist * .14, .0035, .0085) * (F.f === 0 ? .6 : 1);
    F.reach.copy(reachFor(F, K, real || LAYOUT[vcode] ? vcode + (vcode === 'Space' ? F.h : '') : null));
    // give the wrist time to get there: the finger alone covers ~4 mm, the spring has to bring the rest
    const H = hands[F.h], move = H.W.x.distanceTo(v1.copy(H.homeW).add(F.reach));
    if (move > .004){ let tt = F.Td; while (tt < .16 && move * (1 + HAND_W * tt) * Math.exp(-HAND_W * tt) > .004) tt += .005; F.Td = Math.max(F.Td, tt); }
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
    if (F.queue && F.queue.code === code){ F.queue.up = true; return; }
    if (F.code === code && (F.mode === 'strike' || F.mode === 'hold')){
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
    for (let i = timers.length - 1; i >= 0; i--) if (T >= timers[i].at){ const f = timers[i].fn; timers.splice(i, 1); f(); }
    if (pendShift && T - pendShift.at > .085) flushShift();

    /* ---- posture: lean in a touch while typing, breathing, slow weight shifts ---- */
    const typing = T - lastKey < 1.4 ? 1 : 0;
    spring(act, typing, typing ? 4 : 1.4, dt);
    const breath = Math.sin(T * 2 * PI / 4.6);
    if ((swayT += dt) > swayAt){ swayT = 0; swayAt = 7 + Math.random() * 9; sway.tgt = (Math.random() - .5) * .03; twist.tgt = (Math.random() - .5) * .03; }
    spring(sway, sway.tgt || 0, 1.3, dt); spring(twist, twist.tgt || 0, 1.1, dt);
    spring(lean, lean0 + .03 * act.x, 3, dt);
    spine.rotation.set(-(lean.x + .006 * breath), twist.x + .01 * Math.sin(T * .23), sway.x + .008 * Math.sin(T * .31));
    root.updateWorldMatrix(true, false);
    spine.updateMatrix();

    /* ---- long idle: now and then one hand comes off the keys to rest on the desk ---- */
    if (T - lastKey > 8 && (deskCheck -= dt) <= 0){
      deskCheck = 4 + Math.random() * 6;
      const on = hands.find(H => H.deskT);
      if (!on){ if (Math.random() < .55) hands[Math.random() < .6 ? 0 : 1].deskT = 1; }
      else if (Math.random() < .25) on.deskT = 0;
    }

    for (const H of hands){
      /* ---- wrist: goes where the active fingers need it (precomputed reach), drifts with the active region ---- */
      const tgt = v2.set(0, 0, 0); let wsum = 0, lead = null;
      for (const F of H.fingers){
        if (F.mode !== 'strike' && F.mode !== 'hold') continue;
        const wgt = F.mode === 'strike' ? (F.f === 0 ? .35 : 1) * (.35 + 3 * smooth(.15, .85, F.t / F.Td)) /* the finger about to land owns the wrist */ : MOD.test(F.code || '') ? .15 : .5;
        tgt.addScaledVector(F.reach, wgt); wsum += wgt;
        if (F.mode === 'strike' && F.t / F.Td > .6 && (!lead || F.t / F.Td > lead.t / lead.Td)) lead = F;   // the finger about to land
      }
      let w = 7;
      if (wsum > 0){
        tgt.multiplyScalar(1 / wsum).add(H.homeW);
        H.hold.copy(tgt); H.lastActive = T; w = HAND_W;
        H.region.step(tgt, 5, dt);
      } else {
        H.region.step(H.homeW, T - H.lastActive < .6 ? .5 : 2.5, dt);
        if (T - H.lastActive < .35) w = 14;
        H.hold.copy(H.homeW).lerp(H.region.x, .35).addScaledVector(n, .0022 * breath).addScaledVector(kfw, .0015 * Math.sin(T * .7 + H.h * 2)).addScaledVector(lat, .001 * Math.sin(T * .43 + H.h));
      }
      const W = H.W.step(H.hold, w, dt);
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
      const pole = V3(H.side * (.85 + H.elbowOut.x), -.6, .3).normalize();
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
      for (const F of H.fingers){
        F.act = F.mode === 'strike' ? smooth(0, 1, F.t / F.Td) : F.mode === 'hold' ? 1 : F.mode === 'release' ? clamp(F.w.x, 0, 1) : 0;
      }
      for (const F of H.fingers){
        // idle: resting pose + breathing + an occasional small lift, plus tendon coupling to busy neighbours
        if ((F.fidAt -= dt) <= 0){
          F.fidAt = 1.5 + Math.random() * 5;
          if (F.fidT.lengthSq() > 0) F.fidT.set(0, 0, 0);
          else { F.fidT.set(0, .002 + Math.random() * .004, (Math.random() - .5) * .004); F.fidAt = .25 + Math.random() * .4; }
        }
        F.fid.step(F.mode === 'idle' && !wsum ? F.fidT : ZERO, 14, dt);
        const idle = v2.copy(F.restLocal).add(F.fid.x); idle.y += .0009 * Math.sin(T * 1.7 + F.f * 1.3 + H.h * 2);
        idle.applyMatrix4(H.hand.matrix);
        let cp = 0; for (const G of H.fingers) if (G !== F) cp += COUPLE[G.f][F.f] * G.act * (G.mode === 'strike' ? Math.sin(PI * clamp(G.t / G.Td, 0, 1)) * .6 + .4 : 1);
        if (cp > 0) idle.addScaledVector(n, -.0024 * Math.min(cp, 1.2));
        if (dk > 0){ const hgt = idle.dot(n) - (deskLocalH + FR[F.f][2] * .9); idle.addScaledVector(n, -hgt * dk * (F.f ? .85 : .5)); }

        if (F.mode === 'strike'){
          F.t += dt;
          const Kc = v3.copy(F.K).addScaledVector(n, F.clear);
          let u = clamp(F.t / F.Td, 0, 1);
          const e = smooth(0, .78, u);
          // anticipation: a quick lift early on, then an accelerating drop that meets the cap with speed
          // (the lift runs on an eased clock so it leaves with zero vertical speed but still lands moving down)
          const ul = u * u * (2 - u);
          const hgt = F.lift * (.5 * 4 * ul * (1 - ul) + .5 * 6.75 * ul * (1 - ul) * (1 - ul)) + .0015 * Math.sin(PI * Math.min(1, ul * 2.5)) * (1 - ul);
          F.P.copy(F.from).lerp(Kc, e).addScaledVector(n, hgt).addScaledVector(F.v0, F.Td * u * (1 - u) * (1 - u));
          solveFinger(F, F.P);
          if (u >= 1){
            const err = F.tip.distanceTo(Kc);
            if (err < .0015 || F.t > F.Td + .06){
              F.mode = 'hold'; F.pressed = true; F.tC = F.t; F.depth.x = 0; F.depth.v = .9;
              contacts.push({ code: F.vcode, err: F.tip.clone().sub(Kc), t: F.t, at: T.toFixed(2) + '/h' + F.h });
              if (contacts.length > 400) contacts.shift();
              if (F.real) doPress(F.vcode); else snd(F.vcode, true);
            }
          }
          if (F === lead){           // what the finger cannot reach, the wrist makes up next frame
            const err = v1.copy(F.P).sub(F.tip);
            if (err.length() > 2e-4){ err.multiplyScalar(.5); if (err.length() > .0006) err.setLength(.0006); H.nudge.add(err); }   // gently: never a visible kick
            if (H.nudge.length() > .016) H.nudge.setLength(.016);
          }
        } else if (F.mode === 'hold'){
          F.t += dt;
          spring(F.depth, 1, 75, dt);
          F.P.copy(F.K).addScaledVector(n, F.clear - F.depth.x * TRAVEL);
          solveFinger(F, F.P);
          if (F.upReq && F.t - F.tC > .045){
            const c = F.vcode; F.upReq = false; F.mode = 'release'; F.relT = 0; F.w.x = 1; F.w.v = 0;
            if (F.real) doRelease(c); else snd(c, false);
          }
          if (F.queue && F.t - F.tC >= .03){      // a stroke queued behind this one: go now
            const q = F.queue; F.queue = null;
            strike(q.code, q.vcode, F, 0);
            if (q.up){ F.upReq = true; }
            solveFinger(F, F.P);         // reachFor() posed this finger while probing: put it back for this frame
          }
        } else {
          F.relT += dt;
          if (F.mode === 'release'){
            spring(F.depth, 0, 55, dt);
            bouncy(F.w, 0, F.f === 0 ? 24 : 30, .5, dt);
            if (F.relT > .5 || (Math.abs(F.w.x) < .003 && Math.abs(F.w.v) < .05)){ F.mode = 'idle'; F.code = null; F.vcode = null; }
          }
          const Kc = v3.copy(F.K).addScaledVector(n, F.clear - F.depth.x * TRAVEL);
          const k = F.mode === 'release' ? F.w.x : 0;
          F.P.copy(idle).lerp(Kc, clamp(k, -.2, 1));
          if (F.mode === 'release') F.P.addScaledVector(n, .0035 * Math.sin(PI * clamp(F.relT / .11, 0, 1)));
          solveFinger(F, F.P);
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

  root.userData.dbg = { hands, s, contacts, spineOff, lean0 };
  return { object3d: root, keyDown, keyUp, update };
};
})();
