
/* =====================================================================
   HELD ITEMS, DROPS AND THE SKY SAIL, modelled properly
   - every item icon is extruded into a 1-voxel-thick mesh (front, back, and side walls only where
     a pixel has an empty neighbour), the way indie voxel games render held items
   - first person renders in its own pass (own camera, depth cleared) so items never clip into walls;
     the pass mirrors the main camera so lighting stays in world space, with a rim light for readability
   - the sail is a real paraglider: arced cells with two-tone fabric, inflating leading edge, trailing
     edge, lines to a harness bar; it unfurls cell by cell from the centre and folds back on close
   ===================================================================== */
const SPRITE_GEO = {};
function itemPixels(key, id, w){
  if (!w && id < 100){ const px = new Uint8ClampedArray(1024); px.set(tileBuf[B_TILES[id * 6 + 2]]); return { px, em: new Uint8Array(256), dep: new Float32Array(256).fill(1) }; }
  return itemArt(id, w);
}
function spriteKey(id, w){ return w ? 'w' + w.f + '_' + w.r : 'i' + id; }
// extrude the shaded pixel art: front and back faces per pixel, side walls where the silhouette (or the thickness) steps,
// thickness per material (blades thin, hafts, gems and dough thicker), emissive per pixel (gems, glow trims)
function spriteGeo(id, w){
  const key = spriteKey(id, w); if (SPRITE_GEO[key]) return SPRITE_GEO[key];
  const A = itemPixels(key, id, w), px = A.px, pos = [], nor = [], col = [], emv = [], idx = [];
  const op = (x, y) => x >= 0 && y >= 0 && x < 16 && y < 16 && px[(y * 16 + x) * 4 + 3] > 100;
  const dp = (x, y) => op(x, y) ? A.dep[y * 16 + x] * .5 / 16 : 0;
  const S = 1 / 16;
  const quad = (a, b, c, d, n, r, g2, b2, e) => { const k = pos.length / 3; for (const p of [a, b, c, d]){ pos.push(p[0], p[1], p[2]); nor.push(n[0], n[1], n[2]); col.push(r, g2, b2); emv.push(e); } idx.push(k, k + 1, k + 2, k, k + 2, k + 3); };
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++){
    if (!op(x, y)) continue;
    const o = (y * 16 + x) * 4, r = px[o] / 255, g2 = px[o + 1] / 255, b2 = px[o + 2] / 255, e = A.em[y * 16 + x], D2 = dp(x, y);
    const x0 = (x - 8) * S, x1 = x0 + S, y1 = (8 - y) * S, y0 = y1 - S;
    quad([x0, y0, D2], [x1, y0, D2], [x1, y1, D2], [x0, y1, D2], [0, 0, 1], r, g2, b2, e);
    quad([x1, y0, -D2], [x0, y0, -D2], [x0, y1, -D2], [x1, y1, -D2], [0, 0, -1], r * .8, g2 * .8, b2 * .8, e);
    // side walls: the full depth where the neighbour is empty, the step where the neighbour is thinner (front and back)
    const wall = (nd, mk) => { if (nd >= D2) return; mk(nd, D2); mk(-D2, -nd); };
    wall(dp(x, y - 1), (a, b) => quad([x0, y1, b], [x1, y1, b], [x1, y1, a], [x0, y1, a], [0, 1, 0], Math.min(1, r * 1.08), Math.min(1, g2 * 1.08), Math.min(1, b2 * 1.08), e));
    wall(dp(x, y + 1), (a, b) => quad([x0, y0, a], [x1, y0, a], [x1, y0, b], [x0, y0, b], [0, -1, 0], r * .62, g2 * .62, b2 * .62, e));
    wall(dp(x - 1, y), (a, b) => quad([x0, y0, a], [x0, y0, b], [x0, y1, b], [x0, y1, a], [-1, 0, 0], r * .92, g2 * .92, b2 * .92, e));
    wall(dp(x + 1, y), (a, b) => quad([x1, y0, b], [x1, y0, a], [x1, y1, a], [x1, y1, b], [1, 0, 0], r * .72, g2 * .72, b2 * .72, e));
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); geo.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3)); geo.setAttribute('aEm', new THREE.Float32BufferAttribute(emv, 1)); geo.setIndex(idx);
  return (SPRITE_GEO[key] = geo);
}
// the material for held items and drops: world lighting, a rim light, a soft specular glint, per-pixel glow
function heldMat(o){ o = o || {};
  return new THREE.ShaderMaterial({ uniforms: Object.assign({}, U, { uRim: { value: o.rim === undefined ? .55 : o.rim }, uGlow: { value: o.glow || 0 }, uFill: { value: o.fill || 0 } }),
    vertexShader: `attribute vec3 aCol; attribute float aEm; varying vec3 vC; varying vec3 vN; varying vec3 vW; varying float vE;
      void main(){ mat4 m = modelMatrix;
        #ifdef USE_INSTANCING
        m = m * instanceMatrix;
        #endif
        vec4 wp = m * vec4(position, 1.0); vC = aCol; vE = aEm; vN = normalize(mat3(m) * normal); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `${GL_COMMON} uniform float uRim, uGlow, uFill; varying vec3 vC; varying vec3 vN; varying vec3 vW; varying float vE;
      void main(){ vec3 n = normalize(vN), v = normalize(cameraPosition - vW); vec3 c = litCol(vC, n, 1.0, 0.0);
        c += vC * uFill * (0.55 + 0.45 * max(dot(n, normalize(vec3(-0.4, 0.7, 0.6))), 0.0)); // a soft key fill so held items read at night
        c += (uSunCol * 0.6 + uAmbSky * 0.5) * pow(1.0 - max(dot(n, v), 0.0), 2.5) * uRim;
        c += uSunCol * pow(max(dot(reflect(-uSunDir, n), v), 0.0), 24.0) * 0.18;
        float g = vE * (0.75 + 0.25 * sin(uTime * 3.0 + vW.y * 4.0)); c = mix(c, vC * 1.35, clamp(g + uGlow * vE, 0.0, 1.0));
        c = fogIt(c, vW); gl_FragColor = vec4(grade(c), 1.0); }` }); }
// how each kind of item sits in the hand: grip pivot (in sprite pixels), rotation and scale
function holdOf(id, w){
  // grip pivot in sprite pixels, rotation (pitch, yaw, roll in YXZ) and scale: blades rise up and to the left of the hand,
  // heavy heads sit higher, food is cupped in the palm, tools are carried head-up
  if (w) return [{ grip: [3, 12.5], rot: [-.3, -1.32, .7], s: .54, pos: [0, .02, 0] }, { grip: [2.5, 13.5], rot: [-.55, -1.42, .62], s: .6, pos: [0, -.02, .04] }, { grip: [3.5, 13], rot: [-.2, -1.3, .72], s: .58, pos: [0, .02, 0] }, { grip: [3, 11.5], rot: [-.28, -1.25, .74], s: .4, pos: [0, .01, 0] }][w.f];
  if (id === PICK || id === STICK) return { grip: [4, 13], rot: [-.25, -1.25, .78], s: .48, pos: [0, .02, 0] };
  return { grip: [8, 12], rot: [.15, -.6, 0], s: .3, pos: [0, .06, -.02] };
}
/* ---- the first-person pass ---- */
let handHook = null, hScene = null, hCam = null, handItem = null, handBlock = null, handArm = null, handGrip = null, smear = null;
const handMatSprite = glOK ? null : null;
function buildHandPass(){
  hScene = new THREE.Scene(); hCam = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, .02, 20); hCam.rotation.order = 'YXZ'; hScene.add(hCam);
  const sweater = [.38, .52, .5], cuff = [.3, .42, .4], skin = [.72, .53, .41], skin2 = [.64, .46, .35];
  // a blocky forearm: sleeve, cuff, then a fist that wraps the grip
  handArm = new THREE.Mesh(boxGeo([[0, 0, .3, .15, .15, .46, sweater], [0, 0, .07, .16, .16, .06, cuff], [0, .005, -.05, .13, .13, .14, skin], [-.03, .07, -.08, .07, .02, .1, skin2], [.055, .02, -.1, .03, .08, .06, skin2]]), heldMat({ rim: .4, fill: .25 }));
  handArm.rotation.set(.62, .42, 0);
  handGrip = new THREE.Group(); handGrip.position.set(0, .02, -.08);
  handItem = new THREE.Mesh(new THREE.BufferGeometry(), heldMat({ rim: .55, fill: .25 }));
  handBlock = new THREE.Mesh(new THREE.BoxGeometry(.2, .2, .2), dropShader(false)); handBlock.material.depthTest = true; handBlock.material.depthWrite = true; handBlock.material.transparent = false;
  handHook = new THREE.Mesh(hookGeo(), heldMat({ rim: .55, fill: .25 })); handHook.scale.setScalar(.85); handHook.rotation.set(-.05, -1.05, .1); handHook.position.set(-.02, .06, -.04); handHook.visible = false;
  handGrip.add(handItem, handBlock, handHook);
  hand = new THREE.Group(); hand.add(handArm, handGrip); hCam.add(hand);
  handIcon = new THREE.Object3D();
  // smear: an additive ribbon swept along the strike, revealed and faded by a uniform
  const N = 18, pos = [], uv = [], idx = [];
  for (let i = 0; i <= N; i++){ const u = i / N; for (const r of [0, 1]){ pos.push(0, 0, 0); uv.push(u, r); } if (i < N){ const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); } }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); sg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); sg.setIndex(idx);
  smear = new THREE.Mesh(sg, new THREE.ShaderMaterial({ uniforms: { uP: { value: 0 }, uA: { value: 0 }, uC: { value: new THREE.Color(1, 1, 1) } }, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uP; uniform float uA; uniform vec3 uC; varying vec2 vU; void main(){ float lead = smoothstep(uP - 0.55, uP, vU.x) * step(vU.x, uP); float edge = smoothstep(0.0, 0.35, vU.y) * smoothstep(1.0, 0.75, vU.y); float a = lead * edge * uA * (0.35 + 0.65 * vU.y); gl_FragColor = vec4(uC * a, a); }` }));
  smear.visible = false; smear.frustumCulled = false; hCam.add(smear);
}
function setSmearShape(kind){
  const p = smear.geometry.attributes.position, N = (p.count / 2) - 1;
  for (let i = 0; i <= N; i++){ const u = i / N;
    let ax, ay, az, bx, by, bz;
    if (kind === 1){ const z = -.35 - u * .55; ax = .1; ay = -.12; az = z; bx = .1; by = -.02; bz = z; } // spear: a straight streak
    else if (kind === 5){ const a = -1.1 + u * 2.3; ax = Math.sin(a) * .35; az = -Math.cos(a) * .35 - .25; ay = -.06 - ax * .2; bx = Math.sin(a) * .85; bz = -Math.cos(a) * .85 - .25; by = -.06 - bx * .2; } // backhand: the mirrored sweep
    else if (kind === 6){ const a = 1.3 - u * 2.7; ax = Math.sin(a) * .4; az = -Math.cos(a) * .4 - .3; ay = -.2 + ax * .1; bx = Math.sin(a) * 1.0; bz = -Math.cos(a) * 1.0 - .3; by = -.2 + bx * .1; } // heavy axe sweep
    else if (kind === 2){ const a = 1.9 - u * 2.4; ax = .18; ay = Math.sin(a) * .32 - .1; az = -Math.cos(a) * .32 - .55; bx = .18; by = Math.sin(a) * .72 - .1; bz = -Math.cos(a) * .72 - .55; } // axe: vertical chop
    else { const a = (kind === 3 ? .7 : 1.15) - u * (kind === 3 ? 1.6 : 2.3); const tilt = kind === 3 ? .35 : .18; ax = Math.sin(a) * .35; az = -Math.cos(a) * .35 - .25; ay = -.12 + ax * tilt; bx = Math.sin(a) * .85; bz = -Math.cos(a) * .85 - .25; by = -.12 + bx * tilt; } // sword/dagger: horizontal sweep
    p.setXYZ(i * 2, ax, ay, az); p.setXYZ(i * 2 + 1, bx, by, bz);
  }
  p.needsUpdate = true;
}
let heldKey = '';
function updateHand(){
  if (!hand) return;
  const s = inv[sel], id = s ? s.id : 0, w = s && s.w;
  const show = !third && state !== 'title';
  hand.visible = show;
  const key = s ? spriteKey(id, w) : '';
  const hook = heldFamily() === 'grapple'; handHook.visible = hook;
  handBlock.visible = !hook && !!s && isBlockItem(id) && B_RT[id] !== 3; handItem.visible = !hook && !!s && !handBlock.visible;
  if (handBlock.visible){ handBlock.material.uniforms.uTileH.value = B_TILES[id * 6]; handBlock.position.set(-.03, .12, -.06); handBlock.rotation.set(.35, .75, .05); handBlock.scale.setScalar(1.45); }
  if (handItem.visible && key !== heldKey){
    const geo = spriteGeo(id, w), H = holdOf(id, w); handItem.geometry = geo;
    // put the grip pixel on the pivot, then orient
    handItem.position.set(0, 0, 0); handItem.rotation.set(0, 0, 0); handItem.scale.setScalar(H.s);
    const gx = (H.grip[0] - 8) / 16 * H.s, gy = (8 - H.grip[1]) / 16 * H.s;
    _eu.set(H.rot[0], H.rot[1], H.rot[2], 'YXZ'); handItem.quaternion.setFromEuler(_eu);
    const off = new THREE.Vector3(-gx, -gy, 0).applyQuaternion(handItem.quaternion); handItem.position.copy(off).add(_sv.set(H.pos[0], H.pos[1], H.pos[2]));
    handItem.material.uniforms.uGlow.value = w && w.r >= 4 ? .3 : 0;
  }
  heldKey = key;
}
function renderHandPass(){
  if (!hand || !hand.visible || third || state === 'title' || (HR.sailO || 0) > .3) return;
  hCam.position.copy(camera.position); hCam.quaternion.copy(camera.quaternion);
  const fov = 70 + (camera.fov - 72) * .25; if (Math.abs(hCam.fov - fov) > .05 || hCam.aspect !== camera.aspect){ hCam.fov = fov; hCam.aspect = camera.aspect; hCam.updateProjectionMatrix(); }
  renderer.autoClear = false; renderer.clearDepth(); renderer.render(hScene, hCam); renderer.autoClear = true;
}

/* ---- drops: blocks stay little cubes; items and weapons are the extruded models, rare ones glow ---- */
const SPRITE_DROPS = {};
function spriteDropMesh(id, w){
  const key = spriteKey(id, w); if (SPRITE_DROPS[key]) return SPRITE_DROPS[key];
  const m = new THREE.InstancedMesh(spriteGeo(id, w), heldMat({ rim: .6, fill: .15 }), 24); m.count = 0; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.visible = false; scene.add(m);
  return (SPRITE_DROPS[key] = m);
}

/* ---- the sky sail ---- */
const SAILN = 9, SAILK = [0, .07, .22, .45, .72, 1], SAILTH = [.075, .14, .17, .14, .085, .012];
let sailRig = null;
function makeSail(withBar){
  const cols = SAILN * 2 + 1, rows = SAILK.length; // columns: rib, mid, rib, mid ... rib
  const nTop = cols * rows, nVert = nTop * 2 + cols * 2 * 2 + rows * 2 * 2;
  const pos = new Float32Array(nVert * 3), col = new Float32Array(nVert * 3), idx = [];
  const C1 = [.95, .87, .66], C2 = [.79, .41, .33], SLOT = [.2, .14, .13];
  const cellOf = c => Math.min(SAILN - 1, Math.floor(c / 2));
  const setC = (v, c) => { col[v * 3] = c[0]; col[v * 3 + 1] = c[1]; col[v * 3 + 2] = c[2]; };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++){ const cell = cellOf(c), base = (cell % 2 ? C2 : C1), rib = c % 2 === 0 ? .82 : 1, te = r === rows - 1 ? .78 : 1;
    setC(r * cols + c, [base[0] * rib * te, base[1] * rib * te, base[2] * rib * te]); setC(nTop + r * cols + c, [base[0] * .74 * rib, base[1] * .74 * rib, base[2] * .74 * rib]); }
  const T = (r, c) => r * cols + c, Bm = (r, c) => nTop + r * cols + c;
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++){ idx.push(T(r, c), T(r + 1, c), T(r + 1, c + 1), T(r, c), T(r + 1, c + 1), T(r, c + 1)); idx.push(Bm(r, c), Bm(r + 1, c + 1), Bm(r + 1, c), Bm(r, c), Bm(r, c + 1), Bm(r + 1, c + 1)); }
  // leading edge (the open cell mouths) and trailing edge strips
  let v = nTop * 2; const le0 = v; for (let c = 0; c < cols; c++){ setC(v, c % 2 ? SLOT : [.6, .45, .38]); setC(v + 1, SLOT); v += 2; }
  for (let c = 0; c < cols - 1; c++){ const a = le0 + c * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const te0 = v; for (let c = 0; c < cols; c++){ setC(v, [.55, .3, .25]); setC(v + 1, [.45, .25, .2]); v += 2; }
  for (let c = 0; c < cols - 1; c++){ const a = te0 + c * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  // tip walls
  const tw0 = v; for (let s = 0; s < 2; s++) for (let r = 0; r < rows; r++){ setC(v, [.7, .55, .45]); setC(v + 1, [.5, .38, .3]); v += 2; }
  for (let s = 0; s < 2; s++) for (let r = 0; r < rows - 1; r++){ const a = tw0 + (s * rows + r) * 2; if (s) idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); else idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aCol', new THREE.BufferAttribute(col, 3)); g.setIndex(idx);
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nVert * 3), 3)); g.attributes.position.setUsage(THREE.DynamicDrawUsage);
  const mesh = new THREE.Mesh(g, litMat({ rim: .3, emis: .42, side: THREE.DoubleSide })); // sunlit fabric reads as translucent from below mesh.frustumCulled = false;
  // suspension lines: from the underside of every rib to the two ends of the harness bar
  const nl = (SAILN + 1) * 2 * 2, lp = new Float32Array(nl * 3); const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(lp, 3)); lg.attributes.position.setUsage(THREE.DynamicDrawUsage);
  const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x3a2e28, transparent: true, opacity: .85 })); lines.frustumCulled = false;
  const grp = new THREE.Group(); grp.add(mesh, lines);
  let bar = null; if (withBar){ bar = new THREE.Mesh(boxGeo([[0, 0, 0, .78, .06, .06, [.45, .3, .19]], [-.3, 0, 0, .1, .09, .09, [.24, .2, .19]], [.3, 0, 0, .1, .09, .09, [.24, .2, .19]], [0, .03, 0, .06, .1, .06, [.85, .66, .3]]]), litMat({ rim: .3 })); bar.position.set(0, -1.62, .05); grp.add(bar); }
  return { grp, mesh, lines, bar, cols, rows, nTop, le0, te0, tw0, infl: new Float32Array(SAILN), open: 0 };
}
// deform: spread (0 folded .. 1 open), per-cell inflation, flex (speed), returns nothing
function poseSail(S, open, flex, t, fp){
  const { cols, rows, nTop } = S, p = S.mesh.geometry.attributes.position.array, A = 1.02, Rr = 1.8, zL = -.62, zT = .56;
  const spread = sstep(0, .55, open);
  for (let i = 0; i < SAILN; i++){ const dc = Math.abs(i - (SAILN - 1) / 2) / ((SAILN - 1) / 2); S.infl[i] = clamp(open * 1.7 - dc * .7, 0, 1); }
  const infl = c => { const a = S.infl[Math.min(SAILN - 1, Math.floor(c / 2))], b = S.infl[Math.max(0, Math.min(SAILN - 1, Math.ceil(c / 2) - 1))]; return (a + b) * .5; };
  const flutter = (1 - open) * .06;
  const put = (v, x, y, z) => { p[v * 3] = x; p[v * 3 + 1] = y; p[v * 3 + 2] = z; };
  const pts = (r, c, top) => {
    const th0 = (-A + 2 * A * c / (cols - 1)) * (.07 + .93 * spread), u = SAILK[r], z = zL + (zT - zL) * u;
    const inf = infl(c), mid = c % 2 === 1, bul = mid ? .04 * inf : 0, thick = SAILTH[r] * (.22 + .78 * inf);
    const reflex = (u - .3) * flex * .12 + Math.sin(t * 9 + c * .7 + u * 4) * flutter;
    const rad = Rr + (top ? bul : -thick - (mid ? .015 * inf : 0)), sx = Math.sin(th0), cyy = Math.cos(th0);
    return [sx * rad, cyy * rad - Rr + reflex - (1 - spread) * .25 * (1 - Math.abs(th0)), z];
  };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++){ const a = pts(r, c, true), b = pts(r, c, false); put(r * cols + c, a[0], a[1], a[2]); put(nTop + r * cols + c, b[0], b[1], b[2]); }
  for (let c = 0; c < cols; c++){ const a = pts(0, c, true), b = pts(0, c, false); put(S.le0 + c * 2, a[0], a[1], a[2] - .005); put(S.le0 + c * 2 + 1, b[0], b[1], b[2] - .005); const e = pts(rows - 1, c, true), f = pts(rows - 1, c, false); put(S.te0 + c * 2, e[0], e[1], e[2]); put(S.te0 + c * 2 + 1, f[0], f[1], f[2]); }
  for (let s = 0; s < 2; s++){ const c = s ? cols - 1 : 0; for (let r = 0; r < rows; r++){ const a = pts(r, c, true), b = pts(r, c, false), v = S.tw0 + (s * rows + r) * 2; put(v, a[0], a[1], a[2]); put(v + 1, b[0], b[1], b[2]); } }
  const g = S.mesh.geometry; g.attributes.position.needsUpdate = true; g.computeVertexNormals();
  // lines: two per rib (front and rear riser) down to the bar ends
  const lp = S.lines.geometry.attributes.position.array; let k = 0; const by = -1.62 * (.3 + .7 * spread), bx = .32;
  for (let j = 0; j <= SAILN; j++){ const c = j * 2; for (const r of [1, 3]){ const q = pts(r, c, false); const ex = c < cols / 2 ? -bx : bx, f = fp ? .28 : 1; lp[k++] = q[0]; lp[k++] = q[1]; lp[k++] = q[2]; lp[k++] = q[0] + (ex - q[0]) * f; lp[k++] = q[1] + (by - q[1]) * f; lp[k++] = q[2] + (.05 - q[2]) * f; } } // first person: only the upper risers, so nothing cuts across the view
  S.lines.geometry.attributes.position.needsUpdate = true; S.lines.material.opacity = .85 * spread;
  if (S.bar) S.bar.position.y = by;
}
function setSailGold(S){ const c = S.mesh.geometry.attributes.aCol; for (let i = 0; i < c.count; i++){ const r = c.getX(i), g = c.getY(i); if (r > .7 && g > .6) c.setXYZ(i, 1, .85, .42); } c.needsUpdate = true; }
let standSail = null, standBase = null;
function buildSailModels(){
  sailRig = makeSail(true); sailRig.grp.visible = false; scene.add(sailRig.grp);
  if (SAIL_STAND){
    standSail = makeSail(true); poseSail(standSail, .88, 0, 0); standSail.grp.scale.setScalar(.36); scene.add(standSail.grp);
    const W = [.45, .31, .2], W2 = [.36, .24, .15], BR = [.85, .66, .3];
    standBase = new THREE.Mesh(boxGeo([[0, .06, 0, .96, .12, .96, W2], [0, .14, 0, .8, .06, .8, W], [-.36, .78, 0, .1, 1.24, .1, W], [.36, .78, 0, .1, 1.24, .1, W], [0, 1.38, 0, .86, .08, .1, W2], [0, .18, .41, .3, .1, .02, BR]]), litMat({ rim: .3 }));
    standBase.position.set(SAIL_STAND.x, SAIL_STAND.y - 1.9, SAIL_STAND.z); scene.add(standBase);
  }
}
function updateStandSail(t){
  if (!standSail) return; const on = SAIL_STAND && !SAIL_STAND.taken && Math.abs(PL.x - SAIL_STAND.x) + Math.abs(PL.z - SAIL_STAND.z) < 120;
  standSail.grp.visible = !!on; if (!on) return;
  standSail.grp.position.set(SAIL_STAND.x, SAIL_STAND.y - .5 + .62 + Math.sin(t * 1.6) * .04, SAIL_STAND.z); standSail.grp.rotation.set(Math.sin(t * 1.1) * .04, t * .35, Math.sin(t * 1.3) * .05);
}
