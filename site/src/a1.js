
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

/* ---- the sky sail: a voxel paraglider ----
   Eleven cells along a shallow arc (a wing, not a parachute dome), each a stepped (pixel-crafted) airfoil of boxes with a dark cell mouth at the leading edge,
   ribs between cells and a thinner trailing edge. Lines run from two points on every rib to a pair of carabiners, plus
   brake lines from the wingtips to the hands. The group origin is the harness, so banking swings the wing about the pilot.
   The cells are rigid little models transformed on the CPU each frame (a few thousand vertices): inflation, spread,
   flex, flutter and stall are per-cell scales and rotations. */
const SAILN = 11, SAIL_R = 3.1, SAIL_A = .74, SAIL_C = 1.25, SAIL_TH = .26, SAIL_W = SAIL_R * 2 * SAIL_A / SAILN;
// the airfoil, stepped like voxels: [u0, u1, top, bottom] along the chord (u: 0 leading edge .. 1 trailing edge), in thicknesses
const SAIL_PROF = [[0, .12, -.2, -.86], [.12, .38, 0, -1], [.38, .66, -.1, -.88], [.66, .88, -.3, -.68], [.88, 1, -.44, -.56]];
const SAIL_COL = { a: [.93, .86, .68], b: [.78, .42, .33], tip: [.86, .62, .27], slot: [.16, .11, .1] };
const SAIL_GOLD = { a: [1, .87, .48], b: [.9, .63, .27], tip: [.98, .76, .32], slot: [.2, .13, .08] };
let sailRig = null;
function sailCellBoxes(i, P){
  const w = SAIL_W, zL = -SAIL_C / 2, d = Math.abs(i - (SAILN - 1) / 2), fab = d === (SAILN - 1) / 2 ? P.tip : d % 2 ? P.b : P.a, out = [];
  const sh = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
  SAIL_PROF.forEach((s, k) => { const y0 = s[2] * SAIL_TH, y1 = s[3] * SAIL_TH, z0 = zL + s[0] * SAIL_C, z1 = zL + s[1] * SAIL_C, c = sh(fab, k >= 3 ? .93 : 1);
    out.push([0, (y0 + y1) / 2, (z0 + z1) / 2, w * .985, y0 - y1, z1 - z0, c]);
    // rib on the left edge of every cell (and the right edge of the last): a darker seam a touch proud of the skin
    out.push([-w / 2, (y0 + y1) / 2, (z0 + z1) / 2, .03, y0 - y1 + .014, z1 - z0 + .004, sh(fab, .66)]);
    if (i === SAILN - 1) out.push([w / 2, (y0 + y1) / 2, (z0 + z1) / 2, .03, y0 - y1 + .014, z1 - z0 + .004, sh(fab, .66)]); });
  // the cell mouth: a dark opening on the leading edge, framed by a lighter lip above it
  const n = SAIL_PROF[0], ny = (n[2] + n[3]) / 2 * SAIL_TH, nh = (n[2] - n[3]) * SAIL_TH;
  out.push([0, ny - nh * .08, zL - .006, w * .62, nh * .56, .014, P.slot], [0, ny + nh * .34, zL - .005, w * .8, nh * .12, .012, sh(fab, 1.12)]);
  // wingtip stabilisers hang below the outer cells
  if (i === 0 || i === SAILN - 1){ const sx = i ? w / 2 : -w / 2; out.push([sx, -SAIL_TH * 1.15, .14, .025, SAIL_TH * .55, SAIL_C * .45, sh(fab, .95)]); }
  return out;
}
function makeSail(withBar){
  const parts = [], cellOf = [];
  for (let i = 0; i < SAILN; i++){ const g = boxGeo(sailCellBoxes(i, SAIL_COL)); parts.push(g); for (let v = 0; v < g.attributes.position.count; v++) cellOf.push(i); }
  const nV = cellOf.length, base = new Float32Array(nV * 3), bnor = new Float32Array(nV * 3), col = new Float32Array(nV * 3), gold = new Float32Array(nV * 3), idx = [];
  let o = 0;
  parts.forEach((g, i) => { base.set(g.attributes.position.array, o * 3); const gn = g.attributes.normal.array;
    for (let k = 1; k < gn.length; k += 3) if (gn[k] < -.5){ gn[k] = .55; gn[k + 1] = .4; } // thin sunlit fabric: the underside glows instead of going muddy
    bnor.set(gn, o * 3); col.set(g.attributes.aCol.array, o * 3);
    gold.set(boxGeo(sailCellBoxes(i, SAIL_GOLD)).attributes.aCol.array, o * 3); const ix = g.index.array; for (let k = 0; k < ix.length; k++) idx.push(ix[k] + o); o += g.attributes.position.count; g.dispose(); });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(base), 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(bnor), 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aCol', new THREE.BufferAttribute(col, 3)); geo.setIndex(idx);
  // lit like every other model: world light, sky ambient and the same rim; only a hint of glow so it reads against the sky
  const mesh = new THREE.Mesh(geo, litMat({ rim: .3, emis: .06 })); mesh.frustumCulled = false;
  const nl = (SAILN + 1) * 2 + 2, lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nl * 6), 3).setUsage(THREE.DynamicDrawUsage));
  const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x2a2220, transparent: true, opacity: .8 })); lines.frustumCulled = false;
  const grp = new THREE.Group(); grp.rotation.order = 'YXZ'; grp.add(mesh, lines);
  let bar = null;
  if (withBar){ const M = [.45, .3, .19], K = [.85, .66, .3], S = [.24, .2, .19];
    bar = new THREE.Mesh(boxGeo([[0, 0, .02, .5, .05, .05, M], [-.25, .02, 0, .07, .13, .07, K], [.25, .02, 0, .07, .13, .07, K], [-.27, .5, .06, .06, .1, .06, S], [.27, .5, .06, .06, .1, .06, S]]), litMat({ rim: .3 })); grp.add(bar); }
  return { grp, mesh, lines, bar, base, bnor, cellOf, col, gold, cell: new Float32Array(SAILN * 8), open: 0 };
}
const _sailT = [0, 0, 0];
// transform a point given in cell-local space by cell i's current pose (into group space)
function sailXf(S, i, lx, ly, lz){
  const c = S.cell, k = i * 8, sx = c[k], sy = c[k + 1], crx = Math.cos(c[k + 2]), srx = Math.sin(c[k + 2]), crz = Math.cos(c[k + 3]), srz = Math.sin(c[k + 3]);
  const x = lx * sx, y = ly * sy, y1 = y * crx - lz * srx, z1 = y * srx + lz * crx;
  _sailT[0] = x * crz - y1 * srz + c[k + 4]; _sailT[1] = x * srz + y1 * crz + c[k + 5]; _sailT[2] = z1 + c[k + 6]; return _sailT;
}
/* pose the wing. open: 0 folded .. 1 flying. flex: -.3 .. 1 with airspeed. t: time. fp: first-person framing.
   o (optional): { bank, stall, RM } bank in radians (+ = turning left), stall 0..1, RM 0 for reduced motion */
function poseSail(S, open, flex, t, fp, o){
  o = o || {}; const RM = o.RM === undefined ? (REDUCED ? 0 : 1) : o.RM, stall = (o.stall || 0), bank = o.bank || 0;
  const lift0 = o.lift || (fp ? 2.55 : 2.6), fwd = o.fwd === undefined ? (fp ? 3.3 : .22) : o.fwd;
  const spread = sstep(0, .55, open), lift = lift0 * (.4 + .6 * sstep(0, .6, open)), A = SAIL_A * (1 - .07 * Math.max(flex, 0)) * (.14 + .86 * spread);
  const mid = (SAILN - 1) / 2, c = S.cell;
  for (let i = 0; i < SAILN; i++){
    const side = i < mid ? -1 : i > mid ? 1 : 0, dc = Math.abs(i - mid) / mid;
    // inflation runs from the centre cell out to the tips, each with a little overshoot; folding runs it back, tips first
    const s = clamp(open * 1.8 - dc * .8, 0, 1); let inf = RM ? EZ.outBack(s) : sstep(0, 1, s);
    inf *= 1 - stall * (.22 + .14 * Math.sin(t * 9 + i * 1.3)) * (.4 + .6 * dc);
    const billow = 1 + RM * (.025 + .02 * Math.max(flex, 0)) * Math.sin(t * (2.2 + Math.max(flex, 0) * 2.5) + i * .8);
    let th = ((i + .5) / SAILN * 2 - 1) * A; th *= 1 + stall * .22 * dc * dc;
    // brakes: the inside of a turn pulls its trailing edge down; tips flutter, more with speed
    const brake = Math.max(0, -side * bank) * 1.1 * (.3 + .7 * dc), fl = dc > .45 ? (dc - .45) / .55 : 0;
    const rx = (1 - Math.min(inf, 1)) * .55 - .05 * Math.max(flex, 0) + brake + RM * fl * (.035 + .05 * Math.max(flex, 0)) * Math.sin(t * 21 + i * 2.1);
    const rz = -th + RM * fl * .03 * Math.sin(t * 17 + i * 1.7);
    const k = i * 8; c[k] = .5 + .5 * Math.min(inf, 1.05); c[k + 1] = Math.max(.12, inf * billow); c[k + 2] = rx; c[k + 3] = rz;
    c[k + 4] = Math.sin(th) * SAIL_R; c[k + 5] = Math.cos(th) * SAIL_R - SAIL_R + lift; c[k + 6] = -fwd;
  }
  const p = S.mesh.geometry.attributes.position.array, nr = S.mesh.geometry.attributes.normal.array, B = S.base, N = S.bnor, cell = S.cellOf;
  for (let v = 0, n = cell.length; v < n; v++){
    const i = cell[v], k = i * 8, j = v * 3, sx = c[k], sy = c[k + 1], crx = Math.cos(c[k + 2]), srx = Math.sin(c[k + 2]), crz = Math.cos(c[k + 3]), srz = Math.sin(c[k + 3]);
    const x = B[j] * sx, y = B[j + 1] * sy, z = B[j + 2], y1 = y * crx - z * srx, z1 = y * srx + z * crx;
    p[j] = x * crz - y1 * srz + c[k + 4]; p[j + 1] = x * srz + y1 * crz + c[k + 5]; p[j + 2] = z1 + c[k + 6];
    const ny = N[j + 1] * crx - N[j + 2] * srx, nz = N[j + 1] * srx + N[j + 2] * crx;
    nr[j] = N[j] * crz - ny * srz; nr[j + 1] = N[j] * srz + ny * crz; nr[j + 2] = nz;
  }
  S.mesh.geometry.attributes.position.needsUpdate = true; S.mesh.geometry.attributes.normal.needsUpdate = true;
  // lines: front and rear riser from every rib to the carabiner on its side; brake lines from the tips to the hands
  const cb = o.cb || (fp ? [.52, -.62, -.18] : [.25, 0, 0]), lp = S.lines.geometry.attributes.position.array, zL = -SAIL_C / 2, yb = -SAIL_TH * .9;
  let q = 0; const seg = (a, bx, by, bz) => { lp[q++] = a[0]; lp[q++] = a[1]; lp[q++] = a[2]; lp[q++] = bx; lp[q++] = by; lp[q++] = bz; };
  for (let r = 0; r <= SAILN; r++){ const i = Math.min(r, SAILN - 1), lx = r === SAILN ? SAIL_W / 2 : -SAIL_W / 2, sd = r <= mid ? -1 : 1;
    const keep = !fp || r <= 1 || r >= SAILN - 1 || r === 3 || r === SAILN - 3; // first person: a few lines frame the view, they do not cage it
    for (const u of [.22, .62]){ const a = sailXf(S, i, lx, yb, zL + u * SAIL_C); if (keep) seg(a, cb[0] * sd, cb[1], cb[2]); else seg(a, a[0], a[1], a[2]); } }
  const hy = fp ? cb[1] : cb[1] + .42, hz = fp ? cb[2] : cb[2] - .1;
  seg(sailXf(S, 0, -SAIL_W / 2, -SAIL_TH * .5, -zL), -(fp ? cb[0] : .55), hy - Math.max(0, bank) * .25, hz);
  seg(sailXf(S, SAILN - 1, SAIL_W / 2, -SAIL_TH * .5, -zL), (fp ? cb[0] : .55), hy - Math.max(0, -bank) * .25, hz);
  S.lines.geometry.attributes.position.needsUpdate = true; S.lines.material.opacity = .8 * spread;
  if (S.bar) S.bar.position.set(0, cb[1], cb[2]);
}
function setSailGold(S){ const a = S.mesh.geometry.attributes.aCol; a.array.set(S.gold); a.needsUpdate = true; }
let standSail = null, standBase = null;
function buildSailModels(){
  sailRig = makeSail(true); sailRig.grp.visible = false; scene.add(sailRig.grp);
  if (SAIL_STAND){
    standSail = makeSail(true); poseSail(standSail, 1, 0, 0, false, { RM: 0 }); standSail.grp.scale.setScalar(.34); scene.add(standSail.grp);
    const W = [.45, .31, .2], W2 = [.36, .24, .15], BR = [.85, .66, .3];
    standBase = new THREE.Mesh(boxGeo([[0, .06, 0, .96, .12, .96, W2], [0, .14, 0, .8, .06, .8, W], [-.36, .78, 0, .1, 1.24, .1, W], [.36, .78, 0, .1, 1.24, .1, W], [0, 1.38, 0, .86, .08, .1, W2], [0, .18, .41, .3, .1, .02, BR]]), litMat({ rim: .3 }));
    standBase.position.set(SAIL_STAND.x, SAIL_STAND.y - 1.9, SAIL_STAND.z); scene.add(standBase);
  }
}
// the display sail hangs from the stand's crossbar and breathes in the breeze (re-posed only when you are close)
function updateStandSail(t){
  if (!standSail) return; const d = SAIL_STAND ? Math.abs(PL.x - SAIL_STAND.x) + Math.abs(PL.z - SAIL_STAND.z) : 1e9, on = SAIL_STAND && !SAIL_STAND.taken && d < 120;
  standSail.grp.visible = !!on; if (!on) return;
  if (d < 40 && !REDUCED) poseSail(standSail, 1, .15 + .15 * Math.sin(t * .7), t, false);
  standSail.grp.position.set(SAIL_STAND.x, SAIL_STAND.y - .46 + Math.sin(t * 1.6) * .03, SAIL_STAND.z); standSail.grp.rotation.set(Math.sin(t * 1.1) * .04, t * .35, Math.sin(t * 1.3) * .05);
}
