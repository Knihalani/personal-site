
const hyp2 = (a, b) => Math.sqrt(a * a + b * b), hyp3 = (a, b, c) => Math.sqrt(a * a + b * b + c * c);
/* ================= animation toolkit =================
   springs (critically damped, implicit, stable at any dt), easing curves, keyframed clips,
   smooth 1D noise for additive layers. All state lives in plain objects: zero allocation per frame. */
const Spr = (x) => ({ x: x || 0, v: 0 });
function spring(s, target, omega, dt){
  const f = 1 + 2 * dt * omega, oo = omega * omega, hoo = dt * oo, hhoo = dt * hoo, inv = 1 / (f + hhoo);
  const nx = (f * s.x + dt * s.v + hhoo * target) * inv; s.v = (s.v + hoo * (target - s.x)) * inv; s.x = nx; return nx;
}
// springy scalar with no object: returns new value, velocity kept in a parallel field
const EZ = {
  lin: t => t, inQuad: t => t * t, outQuad: t => 1 - (1 - t) * (1 - t), inOutSine: t => .5 - Math.cos(Math.PI * t) / 2,
  outCubic: t => 1 - (1 - t) * (1 - t) * (1 - t), inCubic: t => t * t * t, outBack: t => { const c = 1.70158, u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; },
  inBack: t => { const c = 1.70158; return (c + 1) * t * t * t - c * t * t; }, outElastic: t => t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - .75) * 2.094) + 1
};
// clip = { d: duration, k: [[t, value, ease], ...] } sampled into a scalar; a pose is several clips sharing a timeline
function clipAt(c, t){ const k = c.k; if (t <= k[0][0]) return k[0][1]; for (let i = 1; i < k.length; i++){ if (t <= k[i][0]){ const a = k[i - 1], b = k[i], u = (t - a[0]) / (b[0] - a[0]); return a[1] + (b[1] - a[1]) * (b[2] || EZ.inOutSine)(u); } } return k[k.length - 1][1]; }
const Clip = (keys) => ({ k: keys, d: keys[keys.length - 1][0] });
// envelope for cross-faded additive layers: fades in over a, holds, fades out over b
const env = (t, d, a, b) => t <= 0 || t >= d ? 0 : Math.min(1, EZ.inOutSine(Math.min(1, t / a)), EZ.inOutSine(Math.min(1, (d - t) / b)));
function noise1(t, seed){ const i = Math.floor(t), f = t - i, a = h2(i, seed), b = h2(i + 1, seed); return a + (b - a) * f * f * (3 - 2 * f) - .5; }

/* ================= inventory, items, recipes ================= */
const inv = new Array(36).fill(null);
let carried = null, sel = 0, saveDirty = false;
// the satchel starts empty: everything you carry, you gathered
function resetInventory(){ inv.fill(null); carried = null; sel = 0; }
let lastAddSlot = -1;
function invAdd(id, n, w){
  const mx = maxStack(id); lastAddSlot = -1;
  if (w){ for (let i = 0; i < 36; i++) if (!inv[i]){ inv[i] = { id, n: 1, w }; lastAddSlot = i; if (!wildStats.best || wDps(w) > wDps(wildStats.best)) wildStats.best = w; invChanged(); bumpSlot(i); return 0; } invChanged(); return 1; }
  for (let i = 0; i < 36 && n; i++){ const s = inv[i]; if (s && s.id === id && s.n < mx){ const k = Math.min(n, mx - s.n); s.n += k; n -= k; if (lastAddSlot < 0) lastAddSlot = i; } }
  for (let i = 0; i < 36 && n; i++){ if (!inv[i]){ const k = Math.min(n, mx); inv[i] = { id, n: k }; n -= k; if (lastAddSlot < 0) lastAddSlot = i; } }
  invChanged(); if (lastAddSlot >= 0) bumpSlot(lastAddSlot); if (id === LOG || id === LEAVES || id === BLOSSOM) tut('gather'); return n;
}
function countItem(id){ let n = 0; for (let i = 0; i < 36; i++){ const s = inv[i]; if (s && (s.id === id || (id === -1 && FLOWERS.indexOf(s.id) >= 0))) n += s.n; } return n; }
function takeItem(id, n){ for (let i = 35; i >= 0 && n; i--){ const s = inv[i]; if (s && (s.id === id || (id === -1 && FLOWERS.indexOf(s.id) >= 0))){ const k = Math.min(n, s.n); s.n -= k; n -= k; if (!s.n) inv[i] = null; } } }
function hasItem(id){ return countItem(id) > 0; }
const RECIPES = [
  { out: [SEED, 3], ing: [[LEAVES, 2], [-1, 1]], hint: 'Use it to grow a vine bridge where you look' },
  { out: [BUN, 2], ing: [[-1, 2]], hint: 'Puffles adore these' },
  { out: [BISCUIT, 2], ing: [[PLANKS, 1], [-1, 1]], hint: 'Kits will follow you anywhere for one' },
  { out: [LANTERN, 2], ing: [[ORE, 1], [STICK, 1]], hint: 'Sunstone glows in stone. Lights the night' },
  { out: [PICK, 1], ing: [[COBBLE, 3], [STICK, 2]], hint: 'Mines everything faster' },
  { out: [PLANKS, 4], ing: [[LOG, 1]], hint: 'Chop any tree for logs' },
  { out: [STICK, 4], ing: [[PLANKS, 2]], hint: '' }
];
function canCraft(r){ for (const g of r.ing) if (countItem(g[0]) < g[1]) return false; return true; }
function craft(r){ if (!canCraft(r)){ SND.deny(); return false; } for (const g of r.ing) takeItem(g[0], g[1]); invAdd(r.out[0], r.out[1]); SND.craft(); if (r.out[0] === SEED) tut('craft'); return true; }
const iconCache = {};
const tileCanvas = (tile) => { const c = D.createElement('canvas'); c.width = c.height = 16; const g = c.getContext('2d'); const im = g.createImageData(16, 16); im.data.set(tileBuf[tile]); g.putImageData(im, 0, 0); return c; };
function iconURL(id){
  if (iconCache[id]) return iconCache[id];
  const cv = D.createElement('canvas'); cv.width = cv.height = 32; const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
  if (id >= 100) drawItem(g, id);
  else if (B_RT[id] === 3){ g.drawImage(tileCanvas(B_TILES[id * 6 + 2]), 0, 0, 32, 32); }
  else {
    // isometric cube built pixel-exact on a 32px grid
    const top = tileCanvas(B_TILES[id * 6 + 2]).getContext('2d').getImageData(0, 0, 16, 16).data, side = tileCanvas(B_TILES[id * 6]).getContext('2d').getImageData(0, 0, 16, 16).data;
    const out = g.createImageData(32, 32), O = out.data;
    const put = (x, y, src, u, v, k) => { if (x < 0 || y < 0 || x > 31 || y > 31) return; const s = ((v & 15) * 16 + (u & 15)) * 4, d = (y * 32 + x) * 4; if (src[s + 3] < 100) return; O[d] = src[s] * k; O[d + 1] = src[s + 1] * k; O[d + 2] = src[s + 2] * k; O[d + 3] = 255; };
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++){
      // top rhombus: centre (16,8), half-width 14, half-height 7
      const tx = (x - 16) / 14, ty = (y - 8) / 7;
      if (Math.abs(tx) + Math.abs(ty) <= 1){ const u = Math.floor((tx + ty + 1) / 2 * 16), v = Math.floor((ty - tx + 1) / 2 * 16); put(x, y, top, Math.min(15, u), Math.min(15, v), 1); continue; }
      if (x >= 2 && x < 16){ const u = Math.floor((x - 2) / 14 * 16), yt = 8 + (x - 2) * .5; if (y >= yt && y < yt + 16) put(x, y, side, u, Math.floor(y - yt), .78); }
      else if (x >= 16 && x < 30){ const u = Math.floor((x - 16) / 14 * 16), yt = 15 - (x - 16) * .5; if (y >= yt && y < yt + 16) put(x, y, side, u, Math.floor(y - yt), .6); }
    }
    // 1px ink outline
    const A2 = new Uint8Array(1024); for (let i = 0; i < 1024; i++) A2[i] = O[i * 4 + 3];
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++){ const i = y * 32 + x; if (A2[i]) continue; if ((x > 0 && A2[i - 1]) || (x < 31 && A2[i + 1]) || (y > 0 && A2[i - 32]) || (y < 31 && A2[i + 32])){ O[i * 4] = 14; O[i * 4 + 1] = 13; O[i * 4 + 2] = 17; O[i * 4 + 3] = 255; } }
    g.putImageData(out, 0, 0);
  }
  return (iconCache[id] = cv.toDataURL());
}
/* ================= world editing ================= */
const _rel = new Int32Array(6);
function setBlock(x, y, z, id){
  if (x < 0 || y < 0 || z < 0 || x >= WX || y >= WY || z >= WZ) return;
  const i = wi(x, y, z), old = world[i]; if (old === id) return;
  if (!orig.has(i)) orig.set(i, old);
  world[i] = id;
  if (orig.get(i) === id){ edits.delete(i); orig.delete(i); } else edits.set(i, id);
  const ch = chunks[ckey(x >> 4, 0, z >> 4)]; ch.count += (id ? 1 : 0) - (old ? 1 : 0);
  let near = light[i];
  if (i + 1 < light.length && light[i + 1] > near) near = light[i + 1]; if (i > 0 && light[i - 1] > near) near = light[i - 1];
  if (i + LAYER < light.length && light[i + LAYER] > near) near = light[i + LAYER]; if (i - LAYER >= 0 && light[i - LAYER] > near) near = light[i - LAYER];
  if (B_EMIT[old] || B_EMIT[id] || (B_OPQ[old] !== B_OPQ[id] && near > 1)){
    if (relight(x, y, z, _rel)) markBox(_rel[0] - 1, _rel[1] - 1, _rel[2] - 1, _rel[3] + 1, _rel[4] + 1, _rel[5] + 1);
  }
  markBox(x - 1, y - 1, z - 1, x + 1, y + 1, z + 1);
  saveDirty = true; if (mapImg) mapColumn(x, z);
}

/* ================= collision: swept AABB per axis =================
   Entities: {x,y,z (feet centre), hw, h}. The leading face sweeps into new cells; the
   other two axes are shrunk by EPS so sliding along a wall never catches on seams. */
const EPS = 1e-3;
function sweepAxis(e, axis, d0){
  if (d0 !== undefined) e.sd = d0;
  const d = e.sd;
  if (d === 0) return false;
  const hw = e.hw;
  let a0, a1, b0, b1, c0, c1; // swept-axis range of cells, and the two perpendicular ranges
  if (axis === 0){ b0 = Math.floor(e.y + EPS); b1 = Math.floor(e.y + e.h - EPS); c0 = Math.floor(e.z - hw + EPS); c1 = Math.floor(e.z + hw - EPS);
    if (d > 0){ a0 = Math.floor(e.x + hw - EPS) + 1; a1 = Math.floor(e.x + hw + d); for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) for (let c = c0; c <= c1; c++) if (solidAt(a, b, c)){ e.x = a - hw - EPS; return true; } }
    else { a0 = Math.floor(e.x - hw + EPS) - 1; a1 = Math.floor(e.x - hw + d); for (let a = a0; a >= a1; a--) for (let b = b0; b <= b1; b++) for (let c = c0; c <= c1; c++) if (solidAt(a, b, c)){ e.x = a + 1 + hw + EPS; return true; } }
    e.x += d; return false;
  }
  if (axis === 2){ b0 = Math.floor(e.y + EPS); b1 = Math.floor(e.y + e.h - EPS); c0 = Math.floor(e.x - hw + EPS); c1 = Math.floor(e.x + hw - EPS);
    if (d > 0){ a0 = Math.floor(e.z + hw - EPS) + 1; a1 = Math.floor(e.z + hw + d); for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) for (let c = c0; c <= c1; c++) if (solidAt(c, b, a)){ e.z = a - hw - EPS; return true; } }
    else { a0 = Math.floor(e.z - hw + EPS) - 1; a1 = Math.floor(e.z - hw + d); for (let a = a0; a >= a1; a--) for (let b = b0; b <= b1; b++) for (let c = c0; c <= c1; c++) if (solidAt(c, b, a)){ e.z = a + 1 + hw + EPS; return true; } }
    e.z += d; return false;
  }
  b0 = Math.floor(e.x - hw + EPS); b1 = Math.floor(e.x + hw - EPS); c0 = Math.floor(e.z - hw + EPS); c1 = Math.floor(e.z + hw - EPS);
  if (d > 0){ a0 = Math.floor(e.y + e.h - EPS) + 1; a1 = Math.floor(e.y + e.h + d); for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) for (let c = c0; c <= c1; c++) if (solidAt(b, a, c)){ e.y = a - e.h - EPS; return true; } }
  else { a0 = Math.floor(e.y + EPS) - 1; a1 = Math.floor(e.y + d); for (let a = a0; a >= a1; a--) for (let b = b0; b <= b1; b++) for (let c = c0; c <= c1; c++) if (solidAt(b, a, c)){ e.y = a + 1; return true; } }
  e.y += d; return false;
}
function boxFree(x, y, z, hw, h){
  const x0 = Math.floor(x - hw + EPS), x1 = Math.floor(x + hw - EPS), y0 = Math.floor(y + EPS), y1 = Math.floor(y + h - EPS), z0 = Math.floor(z - hw + EPS), z1 = Math.floor(z + hw - EPS);
  for (let b = y0; b <= y1; b++) for (let c = z0; c <= z1; c++) for (let a = x0; a <= x1; a++) if (solidAt(a, b, c)) return false;
  return true;
}
function supported(x, y, z, hw){ // any solid block directly under the footprint
  const yy = Math.floor(y - .05), x0 = Math.floor(x - hw + EPS), x1 = Math.floor(x + hw - EPS), z0 = Math.floor(z - hw + EPS), z1 = Math.floor(z + hw - EPS);
  for (let c = z0; c <= z1; c++) for (let a = x0; a <= x1; a++) if (solidAt(a, yy, c)) return true;
  return false;
}
function fullySupported(x, y, z, hw){
  const yy = Math.floor(y - .05);
  return solidAt(Math.floor(x - hw), yy, Math.floor(z - hw)) && solidAt(Math.floor(x + hw), yy, Math.floor(z - hw)) && solidAt(Math.floor(x - hw), yy, Math.floor(z + hw)) && solidAt(Math.floor(x + hw), yy, Math.floor(z + hw));
}
/* horizontal move with automatic step-up (<= 1 block). Returns true if blocked. */
function moveHoriz(e, axis, d0, canStep){
  if (d0 !== undefined) e.md = d0;
  const d = e.md;
  if (d === 0) return false;
  const ox = e.x, oz = e.z;
  if (!(e.sd = d, sweepAxis(e, axis))) return false;
  if (!canStep) return true;
  const rest = d - (axis === 0 ? e.x - ox : e.z - oz);
  const tx = axis === 0 ? e.x + rest + Math.sign(d) * .05 : e.x, tz = axis === 2 ? e.z + rest + Math.sign(d) * .05 : e.z;
  let sh = -1;
  for (let k = 1; k <= (canStep === 2 ? 2 : 1); k++){ const top = Math.floor(e.y + EPS) + k, h = top - e.y; if (h <= 0 || h > (canStep === 2 ? 2.05 : 1.01)) continue; if (boxFree(e.x, top, e.z, e.hw, e.h) && boxFree(tx, top, tz, e.hw, e.h) && supported(tx, top, tz, e.hw)){ sh = h; break; } }
  if (sh < 0) return true;
  e.y += sh; if (axis === 0) e.x = tx; else e.z = tz;
  e.stepOff += sh;
  return false;
}

/* height of a climbable ledge directly ahead (top of the blocking column), or -1 */
function ledgeHeight(e, dx, dz){
  const tx = e.x + dx * (e.hw + .12), tz = e.z + dz * (e.hw + .12);
  for (let k = 1; k <= 3; k++){ const top = Math.floor(e.y + EPS) + k, h = top - e.y; if (h <= 0 || h > 2.05) continue;
    if (boxFree(e.x, top, e.z, e.hw, e.h) && boxFree(tx, top, tz, e.hw, e.h) && supported(tx, top, tz, e.hw)) return h; }
  return -1;
}

/* DDA voxel raycast */
const HIT = { ok: false, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, id: 0, t: 0 };
function raycast(ox, oy, oz, dx, dy, dz, maxD, out, solidOnly){
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
  const tdx = dx ? Math.abs(1 / dx) : 1e9, tdy = dy ? Math.abs(1 / dy) : 1e9, tdz = dz ? Math.abs(1 / dz) : 1e9;
  let tx = dx ? (dx > 0 ? (x + 1 - ox) : (ox - x)) * tdx : 1e9, ty = dy ? (dy > 0 ? (y + 1 - oy) : (oy - y)) * tdy : 1e9, tz = dz ? (dz > 0 ? (z + 1 - oz) : (oz - z)) * tdz : 1e9;
  let t = 0, nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < 160 && t <= maxD; i++){
    const id = getB(x, y, z);
    if (id && id !== WATER && (!solidOnly || B_SOLID[id])){ out.ok = true; out.x = x; out.y = y; out.z = z; out.nx = nx; out.ny = ny; out.nz = nz; out.id = id; out.t = t; return true; }
    if (tx < ty && tx < tz){ x += sx; t = tx; tx += tdx; nx = -sx; ny = 0; nz = 0; }
    else if (ty < tz){ y += sy; t = ty; ty += tdy; nx = 0; ny = -sy; nz = 0; }
    else { z += sz; t = tz; tz += tdz; nx = 0; ny = 0; nz = -sz; }
  }
  out.ok = false; return false;
}


/* ================= player ================= */
// tuning (see design doc). Fast and fluid but controllable.
const STEP_DT = 1 / 120, WALK = 5.5, SPRINT = 8.5, SNEAK = 2.2, G_ACCEL = 10, AIR_ACCEL = 3.4, FRICTION = 15, STOP_SPEED = 3.2; // crisp starts (~.1 s) and stops (~.15 s), no drift
const GRAV = 32, FALL_MULT = 1.55, HANG_MULT = .5, TERMINAL = 50, JUMP_V = 10.2, COYOTE = .11, JUMP_BUF = .13, SPRINT_JUMP_BOOST = 1.08;
const SLIDE_T = .7, SLIDE_V = 11, DASH_V = 15, DASH_CD = .85;
const GLIDE_BASE = 9, GLIDE_MAX = 23, GLIDE_MIN = 5.5, LIFT = 12, BOUNCE_V = 21, CATCH_Y = 12, CATCH_T = 1.1;
// paraglider: trim airspeed, still-air sink at trim, max turn rate (rad/s), energy gravity going down / up
const GL_SINK = 1.4, GL_SINK1 = 1.0, GL_TURN = 1.85, GL_GDN = 9.8, GL_GUP = 14;
const PL = { x: 160.5, y: 70, z: 190, px: 160.5, py: 70, pz: 190, vx: 0, vy: 0, vz: 0, hw: .3, h: 1.8, onGround: false, wasGround: false, inWater: false, yaw: 0, pitch: 0,
  stepOff: 0, sd: 0.5, md: 0.5, coyote: 0, jumpBuf: 0, air: 0, gliding: false, gs: 9.5, flaps: 0, sneak: false, slideT: 0, dashCD: 0, airDash: true, vault: 0, eyeOff: 0, mantleCD: 0, glideLock: 0, autoJT: 0, sailOpen: false, turn: 0, bank: 0, udv: 0, gam: 0, hd: 0, steer: 0,
  stable: 0, walk: 0, stepAcc: 0, stepPh: 0, stall: 0, landKick: 0, punch: 0, trailT: 0, safe: null, catching: false, wallT: 0, wallNx: 0, wallNz: 0 };
const INP = { x: 0, z: 0, jump: false, jumpEdge: false, sprint: false, sneak: false, sneakEdge: false, dashEdge: false, dashX: 0, dashZ: 0, use: false };
let tAccNoSail = 0, hasSail = false, inUpdraft = 0, festival = 0, goldSail = false, sailLevel = 0;
function updraftAt(x, y, z){
  let s = 0;
  for (let i = 0; i < UPDRAFTS.length; i++){ const u = UPDRAFTS[i]; const dx = x - u.x, dz = z - u.z, d2 = dx * dx + dz * dz; if (d2 < u.r * u.r && y < u.top){ const k = (1 - Math.sqrt(d2) / u.r) * Math.min(1, (u.top - y) / 6); if (k > s) s = k; } }
  for (let i = 0; i < WILD_UD.length; i++){ const u = WILD_UD[i]; const dx = x - u.x, dz = z - u.z, d2 = dx * dx + dz * dz; if (d2 < u.r * u.r && y < u.top){ const k = (1 - Math.sqrt(d2) / u.r) * Math.min(1, (u.top - y) / 6); if (k > s) s = k; } }
  return s;
}
function stepPlayer(dt){
  const P = PL;
  P.px = P.x; P.py = P.y; P.pz = P.z;
  tAccNoSail = Math.max(0, tAccNoSail - dt);
  if (P.catching){ P.sailOpen = false; if (GR.st) GR.st = 0; stepCatch(dt); return; }
  const hooked = GR.st === 2; P.wallT = Math.max(0, P.wallT - dt);
  const jumpEdge = INP.jumpEdge; INP.jumpEdge = false;
  if (jumpEdge) P.jumpBuf = JUMP_BUF;
  P.jumpBuf = Math.max(0, P.jumpBuf - dt); P.dashCD = Math.max(0, P.dashCD - dt);
  P.coyote = P.onGround ? COYOTE : Math.max(0, P.coyote - dt);
  P.inWater = getB(Math.floor(P.x), Math.floor(P.y + .4), Math.floor(P.z)) === WATER;
  const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
  let wx = -sy * INP.z + cy * INP.x, wz = -cy * INP.z - sy * INP.x;
  const wl = hyp2(wx, wz), mag = Math.min(1, wl); if (wl > 1e-4){ wx /= wl; wz /= wl; }
  let hs = hyp2(P.vx, P.vz);
  const sprint = INP.sprint && INP.z > .3 && !INP.sneak;
  // slide: crouch while sprinting. A crouch press in the air closes the sail.
  const crouchEdge = INP.sneakEdge;
  if (INP.sneakEdge && P.onGround && hs > 6.5 && P.slideT <= 0){ const k = Math.max(hs, SLIDE_V) / hs; P.vx *= k; P.vz *= k; P.slideT = SLIDE_T; SND.slide(); dust(P.x, P.y, P.z, 8, 2.5); P.punch = Math.max(P.punch, .3); }
  INP.sneakEdge = false;
  if (P.slideT > 0){ P.slideT -= dt; if (!P.onGround || hs < 3.2) P.slideT = Math.min(P.slideT, 0); }
  P.sneak = INP.sneak && P.onGround && P.slideT <= 0;
  // dash: Q (in the air too, once; with the sail open it adds to the glide instead of replacing it)
  if (INP.dashEdge){ INP.dashEdge = false; if (P.dashCD <= 0 && (P.onGround || P.airDash) && !P.inWater){
    let dx = -sy * INP.dashZ + cy * INP.dashX, dz = -cy * INP.dashZ - sy * INP.dashX; const dl = hyp2(dx, dz); if (dl < .1){ dx = -sy; dz = -cy; } else { dx /= dl; dz /= dl; }
    if (P.gliding){ const s0 = Math.max(DASH_V, hs + 4); P.vx = dx * s0; P.vz = dz * s0; P.vy = Math.max(P.vy, P.udv); P.airDash = false; }
    else { P.vx = dx * DASH_V; P.vz = dz * DASH_V; if (!P.onGround){ P.vy = Math.max(P.vy, 2.5); P.airDash = false; } }
    P.dashCD = DASH_CD; P.punch = Math.max(P.punch, .9); SND.dash(); dashBurst(P.x, P.y + .9, P.z, dx, dz); hs = DASH_V; } }
  let wishSpeed = (P.sneak ? SNEAK : sprint ? SPRINT : WALK) * mag * (P.inWater ? .6 : 1) * (CB.guard ? .55 : 1); // guarding slows you
  // glide? hold Space in the air
  const was = P.gliding;
  P.glideLock = Math.max(0, P.glideLock - dt);
  // sail: press Space in mid-air to open it (stays open), press again (or crouch) to close; holding Space through a jump also opens it at the apex
  if (jumpEdge && !P.onGround && P.coyote <= 0 && !hooked && P.wallT > 0 && tryWallKick(P)){ /* kicked off the wall */ }
  else if (jumpEdge && !P.onGround && P.coyote <= 0 && !P.inWater && P.air > .08 && !hooked){
    if (!hasSail){ if (tAccNoSail <= 0){ toast(storySeen ? 'You need a sky sail to glide' : 'Wake the Memory Engine first: it has a gift for you'); tAccNoSail = 3; } }
    else if (P.gliding){ if (!(sailLevel >= 2 && P.flaps > 0)){ P.sailOpen = false; P.glideLock = .25; P.jumpBuf = 0; } }
    else { P.sailOpen = true; P.glideLock = 0; P.jumpBuf = 0; } // velocity is kept as it is: the wing takes the momentum it is given
  }
  if (crouchEdge && P.sailOpen && !P.onGround){ P.sailOpen = false; P.glideLock = .25; }
  if (P.onGround || P.inWater || !hasSail || hooked) P.sailOpen = false;
  P.gliding = hasSail && !hooked && !P.onGround && !P.inWater && P.glideLock <= 0 && (P.sailOpen || (INP.jump && (P.vy < .5 || P.gliding) && P.air > .14));
  if (P.gliding && !was){ P.udv = 0; P.turn = 0; P.steer = 0; P.gs = hyp3(P.vx, P.vy, P.vz); SND.sail(); }
  if (!P.gliding){ P.bank *= Math.exp(-6 * dt); P.turn = 0; }
  inUpdraft = updraftAt(P.x, P.y, P.z);
  if (P.gliding){
    if (inUpdraft > .2 && sailLevel >= 2) P.flaps = 3;
    // rising air is a separate, smoothed layer: it lifts the wing without touching its airspeed or heading
    { const du = (inUpdraft * LIFT - P.udv) * (1 - Math.exp(-2.4 * dt)); P.udv += du; P.vy += du; }
    if (jumpEdge && sailLevel >= 2 && P.flaps > 0){ P.flaps--; P.vy = P.udv + Math.max(P.vy - P.udv, 0) + 6.5; glideBoost(2); P.punch = Math.max(P.punch, .8); SND.flap(); sparkle(P.x, P.y + 2, P.z, 8, 1, .95, .8); }
    stepGlide(P, dt);
    P.trailT -= dt; if (P.trailT <= 0){ P.trailT = .045; glideTrail(P.x, P.y + 2.95, P.z, Math.sin(P.hd), Math.cos(P.hd), P.gs); }
  } else {
    if (P.onGround){
      const fr = P.slideT > 0 ? .7 : FRICTION, sp = hyp2(P.vx, P.vz);
      if (sp > 0){
        if (mag > 0 && P.slideT <= 0){ // moving: bleed only the sideways part (crisp turns) and any excess over the wish speed
          const along = P.vx * wx + P.vz * wz, sx = P.vx - wx * along, sz = P.vz - wz * along, k = Math.exp(-fr * 1.4 * dt);
          let al = along; if (al > wishSpeed){ al = Math.max(wishSpeed, al - Math.max(al, STOP_SPEED) * fr * dt); } else if (al < 0) al *= Math.exp(-fr * dt);
          P.vx = wx * al + sx * k; P.vz = wz * al + sz * k;
        } else { const drop = Math.max(sp, STOP_SPEED) * fr * dt, ns = Math.max(0, sp - drop) / sp; P.vx *= ns; P.vz *= ns; }
      }
      if (P.slideT <= 0){ const cur = P.vx * wx + P.vz * wz, add = wishSpeed - cur; if (add > 0){ const a = Math.min(G_ACCEL * wishSpeed * dt, add); P.vx += a * wx; P.vz += a * wz; } }
      else if (mag > 0){ const sp2 = hyp2(P.vx, P.vz); P.vx += wx * 6 * dt; P.vz += wz * 6 * dt; const s3 = hyp2(P.vx, P.vz); P.vx *= sp2 / s3; P.vz *= sp2 / s3; }
    } else {
      // air control keeps momentum: only add toward the wish direction, never brake below current speed
      const cur = P.vx * wx + P.vz * wz, cap = Math.max(wishSpeed, 3) * (mag > 0 ? 1 : 0), add = cap - cur;
      if (add > 0 && mag > 0){ const a = Math.min(AIR_ACCEL * Math.max(wishSpeed, 5) * dt, add); P.vx += a * wx; P.vz += a * wz; }
      const sp = hyp2(P.vx, P.vz), AIRCAP = 12.5; if (sp > AIRCAP && GR.st !== 2){ const k = Math.exp(-1.1 * dt), ns = AIRCAP + (sp - AIRCAP) * k; P.vx *= ns / sp; P.vz *= ns / sp; } // slide jumps, flings and dashes keep their speed
    }
    if (P.inWater){ P.vy -= 9 * dt; if (P.vy < -3) P.vy = -3; if (INP.jump && P.vy < 3.6) P.vy = Math.min(P.vy + 24 * dt, 3.6); }
    else {
      let g = GRAV; const held = (INP.jump && !hooked) || P.autoJT > 0; P.autoJT = Math.max(0, P.autoJT - dt);
      if (P.vy < 0) g *= FALL_MULT; else if (held && P.vy < 2.4) g *= HANG_MULT; else if (!held && P.vy > 0) g *= 1.7; // apex hang, fast fall, short hops
      if (P.vy > -2.4 && P.vy < 0 && INP.jump && !hooked) g = GRAV * HANG_MULT;
      if (hooked) g = GRAV;
      P.vy -= g * dt;
      if (inUpdraft > 0 && P.vy < 0) P.vy += inUpdraft * 30 * dt;
      if (P.vy < -TERMINAL) P.vy = -TERMINAL;
    }
    if (P.jumpBuf > 0 && P.coyote > 0 && !P.inWater && !(hooked && !P.onGround)){
      P.vy = JUMP_V; P.jumpBuf = 0; P.coyote = 0; P.onGround = false; P.air = 0;
      if (sprint || P.slideT > 0){ const sp = hyp2(P.vx, P.vz), ns = Math.min(sp * SPRINT_JUMP_BOOST, 12); if (sp > 0){ P.vx *= ns / sp; P.vz *= ns / sp; } }
      P.slideT = 0; SND.jump(); dust(P.x, P.y, P.z, 4, 1.5);
    }
  }
  if (GR.st) grappleStep(dt, P, wx, wz, mag);
  // integrate: Y, then X and Z with step-up / vault (up to 2 blocks while pressing forward or airborne)
  const fallV = P.vy, dy = P.vy * dt;
  P.onGround = false;
  if ((P.sd = dy, sweepAxis(P, 1))){ if (dy < 0) P.onGround = true; P.vy = 0; }
  else if (dy < 0 && supported(P.x, P.y, P.z, P.hw) && P.y - Math.floor(P.y) < .002) P.onGround = true;
  // horizontal: plain swept collision (no teleporting step-ups). Climbing happens with real velocity:
  // grounded + auto-jump -> a normal jump; airborne near a ledge top -> a short mantle boost.
  const ox = P.x, oz = P.z, svx = P.vx, svz = P.vz;
  let bx = 0, bz = 0;
  if ((P.md = P.vx * dt, moveHoriz(P, 0, undefined, 0))){ bx = Math.sign(svx); P.vx = 0; }
  if (P.sneak && !supported(P.x, P.y, P.z, P.hw)){ P.x = ox; P.vx = 0; }
  if ((P.md = P.vz * dt, moveHoriz(P, 2, undefined, 0))){ bz = Math.sign(svz); P.vz = 0; }
  if (P.sneak && !supported(P.x, P.y, P.z, P.hw)){ P.z = oz; P.vz = 0; }
  P.mantleCD = Math.max(0, P.mantleCD - dt);
  if ((bx || bz) && !P.onGround){ P.wallT = .18; P.wallNx = -bx; P.wallNz = -bz; }
  if ((bx || bz) && INP.sprint && P.onGround) INP.sprintBreak = true; // sprinting into a wall ends the sprint
  if ((bx || bz) && (mag > 0 || P.gliding)){
    const into = mag > 0 ? wx * bx + wz * bz : -sy * bx - cy * bz; // how hard the player pushes (or glides) into the wall
    if (into > .5){
      const h = ledgeHeight(P, bx, bz);
      if (h > 0){
        if (P.inWater){ if (h <= 1.4 && P.mantleCD <= 0){ P.vy = Math.max(P.vy, 7); P.mantleCD = .3; } } // climb out onto the bank
        else if (P.onGround && autoJump && h <= 1.05 && P.jumpBuf <= 0){ P.jumpBuf = .05; P.autoJT = .4; } // jumps next tick through the normal path
        else if (!P.onGround && P.mantleCD <= 0 && h <= (P.gliding ? 1.3 : .75) && P.vy < 7){
          P.vy = Math.min(9, Math.max(P.vy, Math.sqrt(2 * GRAV * 1.7 * (h + .2))));
          P.mantleCD = .3; P.vault = 1; if (P.gliding){ P.gliding = false; P.sailOpen = false; P.glideLock = .25; }
          SND.vault(); animPlace();
        }
      }
    }
  }
  if (P.onGround && !P.wasGround){
    const k = clamp(-fallV / 34, 0, 1);
    if (k > .25){ P.landKick = Math.min(.26, k * .3); SND.land(k); landRing(P.x, P.y, P.z, k); }
    else if (k > .07){ P.landKick = k * .22; SND.step('soft'); dust(P.x, P.y, P.z, 3, 1.2); } // small hops land softly too
    P.airDash = true; P.flaps = sailLevel >= 2 ? 3 : 0; GR.kicks = 0;
  }
  P.wasGround = P.onGround;
  P.air = P.onGround ? 0 : P.air + dt;
  P.vault = Math.max(0, P.vault - dt * 4);
  // puffle companion bounce
  if (companion && companion.type === 'puffle' && P.vy < -1){ const m = companion; if (Math.abs(P.x - m.x) < .8 && Math.abs(P.z - m.z) < .8 && P.y > m.y + .5 && P.y < m.y + 1.4){ P.vy = BOUNCE_V; P.punch = 1.2; m.squash = 1; SND.boing(); sparkle(m.x, m.y + 1, m.z, 8, 1, .95, .8); P.air = .2; P.airDash = true; } }
  // footsteps with dust
  hs = hyp2(P.vx, P.vz);
  // footsteps: stride grows a little with speed, so cadence tracks speed (2.7/s walking, 3.6/s sprinting); the head bob is phase-locked to it
  if (P.onGround && hs > .6){ P.walk += hs * dt; const stride = 1.55 + hs * .09; P.stepPh += hs * dt / stride; if (P.stepPh >= 1){ P.stepPh -= 1; const id = getB(Math.floor(P.x), Math.floor(P.y - .5), Math.floor(P.z)); SND.step(B_SND[id] || 'grass'); if (hs > 3) dust(P.x, P.y, P.z, hs > 7 ? 3 : 1, .8, id); } }
  // safe ground tracking: grounded, fully supported, not water, stable for .5s
  if (P.onGround && hs < 9 && fullySupported(P.x, P.y, P.z, P.hw - .02) && !P.inWater){ P.stable += dt; if (P.stable > .5){ if (!P.safe) P.safe = { x: 0, y: 0, z: 0, yaw: 0 }; P.safe.x = P.x; P.safe.y = P.y; P.safe.z = P.z; P.safe.yaw = P.yaw; P.stable = .25; } }
  else P.stable = 0;
  // the jelly catches real falls into the void (not drops into a cave or a swing on the rope)
  if (!P.catching && GR.st !== 2 && (P.y < CATCH_Y || (P.safe && P.vy < -4 && !P.gliding && P.y < P.safe.y - 14 && voidBelow(P)))) startCatch();
}
/* paraglider flight model. The velocity vector is the state: each step it is read (relative to any rising air) as
   airspeed V, flight-path angle gam and heading hd, steered, and written back, so dashes, flings, rings and walls carry through.
   - steering: the heading turns toward where you look at a limited rate (~106 deg/s) and the wing banks with the turn rate
   - pitch: looking level holds a best-glide attitude (auto-level); looking down dives (up to ~20 m/s); looking up trades speed for height
   - extra speed lifts the nose by itself, so a dive ends in a smooth pull-up arc; a slow wing lowers its nose (soft stall) */
function stepGlide(P, dt){
  const ax = P.vx, ay = P.vy - P.udv, az = P.vz, hsA = hyp2(ax, az);
  let V = hyp3(ax, ay, az), hd = hsA > .4 ? Math.atan2(-ax, -az) : P.yaw, gam = Math.atan2(ay, Math.max(hsA, 1e-3));
  // keyboard/stick: A/D swing the view (and so the heading target) gently, on top of mouse look
  P.steer += (INP.x - P.steer) * (1 - Math.exp(-5 * dt)); if (Math.abs(P.steer) > .01) P.yaw -= P.steer * 1.25 * dt;
  const err = angDiff(P.yaw, hd), rate = clamp(err * 3.2, -GL_TURN, GL_TURN);
  P.turn += (rate - P.turn) * (1 - Math.exp(-7 * dt)); hd += P.turn * dt;
  P.bank += (clamp(P.turn / GL_TURN, -1, 1) * .5 - P.bank) * (1 - Math.exp(-5 * dt));
  const trim = GLIDE_BASE + (sailLevel >= 1 ? .5 : 0), sink = sailLevel >= 1 ? GL_SINK1 : GL_SINK, g0 = -Math.atan2(sink, trim);
  const drag = GL_GDN * Math.sin(-g0) / (trim * trim) * (wHas(heldWeapon(), 'feather') ? .8 : 1);
  const pt = clamp(P.pitch, -1.3, 1.2);
  let cmd = g0;
  if (pt < -.2) cmd += (pt + .2) * .95; // look down: dive
  else if (pt > .22) cmd += (pt - .22) * .5; // look up: climb on spare speed
  cmd += clamp((V - trim) * .045, -.08, .45) * (pt < -.2 ? .5 : 1); // spare speed lifts the nose: dives end in an arc
  const stallV = GLIDE_MIN + 1.2; if (V < stallV) cmd = Math.min(cmd, g0 - (stallV - V) * .16); // soft stall recovery
  cmd = clamp(cmd, -1.15, .55);
  gam += clamp((cmd - gam) * 3, -2.4, 2.4) * dt;
  const sg = Math.sin(gam);
  V += (-(sg > 0 ? GL_GUP : GL_GDN) * sg - drag * V * V) * dt;
  V = clamp(V, 0, GLIDE_MAX);
  P.stall += (clamp((stallV + .3 - V) / 1.2, 0, 1) - P.stall) * (1 - Math.exp(-4 * dt));
  const ch = Math.cos(gam) * V;
  P.vx = -Math.sin(hd) * ch; P.vz = -Math.cos(hd) * ch; P.vy = sg * V + P.udv;
  P.gs = V; P.hd = hd; P.gam = gam;
}
// a push along the glide (rings, flaps): scales the air-relative velocity, never redirects it
function glideBoost(dv){
  const P = PL, ay = P.vy - P.udv, v = hyp3(P.vx, ay, P.vz);
  if (v < .5){ P.vx -= Math.sin(P.yaw) * dv; P.vz -= Math.cos(P.yaw) * dv; return; }
  const k = Math.min(GLIDE_MAX, v + dv) / v; P.vx *= k; P.vz *= k; P.vy = P.udv + ay * k;
}
function voidBelow(P){ const x = Math.floor(P.x), z = Math.floor(P.z); for (let y = Math.floor(P.y); y > Math.max(0, P.y - 30); y--) if (B_SOLID[getB(x, y, z)]) return false; return true; }
/* small feel helpers: dust, landing rings, dash bursts, glider trails */
const _dc = [.6, .55, .5];
function dust(x, y, z, n, sp, id){
  const c = (id && B_COL[id]) || _dc; n = LOW ? Math.ceil(n / 2) : n;
  for (let i = 0; i < n; i++){ const a = Math.random() * 6.283, v = sp * (.4 + Math.random() * .6); emit(x + Math.cos(a) * .2, y + .05, z + Math.sin(a) * .2, Math.cos(a) * v, .6 + Math.random(), Math.sin(a) * v, c[0] * 1.05, c[1] * 1.05, c[2] * 1.05, .13 + Math.random() * .08, .45 + Math.random() * .3, 0, 3); }
}
function landRing(x, y, z, k){ const id = getB(Math.floor(x), Math.floor(y - .5), Math.floor(z)); dust(x, y, z, 6 + Math.round(k * 10), 2 + k * 3, id); }
function dashBurst(x, y, z, dx, dz){ for (let i = 0; i < (LOW ? 6 : 12); i++) emit(x - dx * .6 + (Math.random() - .5) * .6, y + (Math.random() - .5) * 1.2, z - dz * .6 + (Math.random() - .5) * .6, -dx * (2 + Math.random() * 3), (Math.random() - .5), -dz * (2 + Math.random() * 3), .95, .93, .86, .3, .35 + Math.random() * .2, 2, 0); }
function glideTrail(x, y, z, sy, cy, gs){ if (LOW && Math.random() < .5) return; const g = goldSail ? [1, .85, .45] : [.95, .95, .92]; for (const s of [-1.85, 1.85]) emit(x + cy * s + sy * .5, y, z - sy * s + cy * .8, 0, 0, 0, g[0], g[1], g[2], .18 + gs * .006, .6, 2, 0); }
/* ---- the catch: a sky jelly scoops you up and sets you back on your last safe spot ---- */
const CATCH = { t: 0, fx: 0, fy: 0, fz: 0, tx: 0, ty: 0, tz: 0, yaw: 0 };
function validSafe(){
  const s = PL.safe;
  const ok = (x, y, z) => boxFree(x, y, z, PL.hw, PL.h) && supported(x, y, z, PL.hw);
  if (s && ok(s.x, s.y, s.z)) return [s.x, s.y, s.z];
  const bx = Math.floor(s ? s.x : SPAWN.x), bz = Math.floor(s ? s.z : SPAWN.z), by = Math.floor(s ? s.y : SPAWN.y);
  if (s) for (let r = 1; r <= 8; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++){ if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; for (let dy = 2; dy >= -3; dy--){ const x = bx + dx + .5, y = by + dy, z = bz + dz + .5; if (ok(x, y, z) && fullySupported(x, y, z, PL.hw)) return [x, y, z]; } }
  return [SPAWN.x, SPAWN.y, SPAWN.z];
}
function startCatch(){
  const P = PL; P.catching = true; CATCH.t = 0; CATCH.fx = P.x; CATCH.fy = P.y; CATCH.fz = P.z; CATCH.yaw = P.yaw;
  const t = validSafe(); CATCH.tx = t[0]; CATCH.ty = t[1]; CATCH.tz = t[2];
  P.gliding = false; SND.rescue();
}
function stepCatch(dt){
  const P = PL; CATCH.t += dt; const u = Math.min(1, CATCH.t / CATCH_T);
  // ease in-out along a lifted arc; jelly arrives in the first 20%
  const e = u < .2 ? 0 : (u - .2) / .8, k = e * e * (3 - 2 * e);
  const mx = (CATCH.fx + CATCH.tx) / 2, mz = (CATCH.fz + CATCH.tz) / 2, my = Math.max(CATCH.fy, CATCH.ty) + 9;
  const a = 1 - k;
  const fy = u < .2 ? CATCH.fy - (1 - u / .2) * 1.2 : CATCH.fy;
  P.x = a * a * CATCH.fx + 2 * a * k * mx + k * k * CATCH.tx;
  P.y = a * a * fy + 2 * a * k * my + k * k * (CATCH.ty + .02);
  P.z = a * a * CATCH.fz + 2 * a * k * mz + k * k * CATCH.tz;
  P.vx = P.vy = P.vz = 0;
  if (u >= 1){ P.catching = false; P.x = CATCH.tx; P.y = CATCH.ty; P.z = CATCH.tz; P.px = P.x; P.py = P.y; P.pz = P.z; P.onGround = true; P.wasGround = true; P.air = 0; P.stable = 0; P.landKick = .08; sparkle(P.x, P.y + .3, P.z, 10, .75, .7, 1); SND.voice('jelly'); catches++; if (catches === 1) toast('A sky jelly caught you. Falling is always safe here.'); }
}
let catches = 0;

/* ================= vineseed: grow a living bridge along the look direction ================= */
const VG = { on: false, x: 0, y: 0, z: 0, dx: 0, dz: 0, n: 0, t: 0, diag: false, tipT: 0 };
const VINE_MAX = 24, VINE_RATE = .055;
function startVine(){
  const s = inv[sel]; if (!s || s.id !== SEED || VG.on) return false;
  const a = Math.round(Math.atan2(-Math.cos(PL.yaw), -Math.sin(PL.yaw)) / (Math.PI / 4));
  const dx = Math.round(Math.cos(a * Math.PI / 4)), dz = Math.round(Math.sin(a * Math.PI / 4));
  const by = Math.floor(PL.y + EPS) - 1;
  let x = Math.floor(PL.x), z = Math.floor(PL.z), found = false;
  for (let i = 0; i < 3; i++){ x += dx; z += dz; if (vineCellFree(x, by, z)){ found = true; break; } }
  if (!found){ SND.deny(); toast('No room for a vine there'); return false; }
  VG.on = true; VG.x = x; VG.y = by; VG.z = z; VG.dx = dx; VG.dz = dz; VG.n = 0; VG.t = 0; VG.diag = dx !== 0 && dz !== 0;
  s.n--; if (!s.n) inv[sel] = null; invChanged(); animPlace(); tut('vine');
  return true;
}
function vineCellFree(x, y, z){ const b = getB(x, y, z); if (y < 1 || y >= WY - 3 || x < 1 || z < 1 || x >= WX - 1 || z >= WZ - 1) return false; if (b && b !== WATER && B_RT[b] !== 3) return false; return !solidAt(x, y + 1, z) && !solidAt(x, y + 2, z); }
function stepVine(dt){
  if (!VG.on) return;
  VG.t += dt; VG.tipT += dt;
  while (VG.on && VG.t >= VINE_RATE){
    VG.t -= VINE_RATE;
    if (!vineCellFree(VG.x, VG.y, VG.z) || VG.n >= VINE_MAX){ VG.on = false; break; }
    setBlock(VG.x, VG.y, VG.z, VINE); VG.tipT = 0;
    if (VG.diag && vineCellFree(VG.x + VG.dx, VG.y, VG.z)) setBlock(VG.x + VG.dx, VG.y, VG.z, VINE);
    burst(VG.x, VG.y, VG.z, LEAVES, 3); SND.grow(VG.n);
    VG.n++; VG.x += VG.dx; VG.z += VG.dz;
    if (VG.n % 8 === 0) VG.y -= 1;
  }
}

/* ================= mobs: per-species state machines, A* on the walkable grid, steering ================= */
const MOBS = [];
const MS = { IDLE: 0, WANDER: 1, GRAZE: 2, FOLLOW: 3, FLEE: 4, PET: 5, LEAD: 6 };
const SPEC = {
  puffle: { hw: .42, h: .95, walk: 1.3, run: 3.4, treat: BUN, name: 'Puffle', treatName: 'Flower bun', ability: 'Jump on it to bounce sky-high' },
  kit: { hw: .26, h: .62, walk: 2.1, run: 5, treat: BISCUIT, name: 'Kit', treatName: 'Kit biscuit', ability: 'Sniffs out sky relics' },
  jelly: { hw: .55, h: .8, walk: 1.4, run: 4, treat: 0, name: 'Sky jelly', fly: true }
};
let companion = null;
/* ---- A* (zero-alloc, 33x33 window, max 500 expansions) ---- */
const AW = 33, AH = 16, AN = AW * AW;
const aG = new Float32Array(AN), aF = new Float32Array(AN), aY = new Int16Array(AN), aFrom = new Int16Array(AN), aStamp = new Int32Array(AN), aClosed = new Int32Array(AN), aHeap = new Int16Array(AN);
let aSearch = 0, aHeapN = 0;
function heapPush(n){ let i = aHeapN++; aHeap[i] = n; while (i > 0){ const p = (i - 1) >> 1; if (aF[aHeap[p]] <= aF[n]) break; aHeap[i] = aHeap[p]; aHeap[p] = n; i = p; } }
function heapPop(){ const top = aHeap[0], last = aHeap[--aHeapN]; let i = 0; if (aHeapN){ aHeap[0] = last; for (;;){ const l = i * 2 + 1, r = l + 1; let m = i; if (l < aHeapN && aF[aHeap[l]] < aF[aHeap[m]]) m = l; if (r < aHeapN && aF[aHeap[r]] < aF[aHeap[m]]) m = r; if (m === i) break; const t = aHeap[m]; aHeap[m] = aHeap[i]; aHeap[i] = t; i = m; } } return top; }
function standable(x, y, z){ const b = getB(x, y, z); return !B_SOLID[b] && b !== WATER && B_SOLID[getB(x, y - 1, z)] && !B_SOLID[getB(x, y + 1, z)]; }
function standY(x, y, z){ if (standable(x, y, z)) return y; if (standable(x, y + 1, z) && !B_SOLID[getB(x, y + 2, z)]) return y + 1; if (standable(x, y - 1, z)) return y - 1; if (standable(x, y - 2, z)) return y - 2; return -999; }
function columnOK(x, z, isle){ if (x < 1 || z < 1 || x >= WX - 1 || z >= WZ - 1) return false; return isle < 0 || isl[x + z * WX] === isle; }
function cliffy(x, y, z){ // a drop of more than 2 next to this cell
  if (standY(x + 1, y, z) < -900 && !solidAt(x + 1, y, z)) return true; if (standY(x - 1, y, z) < -900 && !solidAt(x - 1, y, z)) return true;
  if (standY(x, y, z + 1) < -900 && !solidAt(x, y, z + 1)) return true; if (standY(x, y, z - 1) < -900 && !solidAt(x, y, z - 1)) return true; return false;
}
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
function findPath(m, tx, ty, tz, isle){
  const sx = Math.floor(m.x), sz = Math.floor(m.z); let sy = standY(sx, Math.floor(m.y + .01), sz); if (sy < -900) sy = Math.floor(m.y + .01);
  tx = clamp(tx, sx - AH, sx + AH); tz = clamp(tz, sz - AH, sz + AH);
  aSearch++; aHeapN = 0;
  const s0 = AH * AW + AH; aStamp[s0] = aSearch; aG[s0] = 0; aY[s0] = sy; aFrom[s0] = -1; aF[s0] = hyp2(tx - sx, tz - sz); heapPush(s0);
  let best = s0, bestH = aF[s0], exp = 0;
  while (aHeapN && exp < 500){
    const n = heapPop(); if (aClosed[n] === aSearch) continue; aClosed[n] = aSearch; exp++;
    const nx = ((n / AW) | 0) - AH + sx, nz = (n % AW) - AH + sz, ny = aY[n];
    const h = hyp2(tx - nx, tz - nz); if (h < bestH){ bestH = h; best = n; } if (h < .5) break;
    for (let d = 0; d < 8; d++){
      const ax = nx + DIRS[d][0], az = nz + DIRS[d][1];
      if (Math.abs(ax - sx) > AH || Math.abs(az - sz) > AH || !columnOK(ax, az, isle)) continue;
      const ay = standY(ax, ny, az); if (ay < -900) continue;
      if (d >= 4){ // no corner cutting
        if (standY(nx + DIRS[d][0], ny, nz) !== ny || standY(nx, ny, nz + DIRS[d][1]) !== ny || ay !== ny) continue;
      }
      const j = (ax - sx + AH) * AW + (az - sz + AH); if (aClosed[j] === aSearch) continue;
      const g = aG[n] + (d >= 4 ? 1.414 : 1) + (ay > ny ? .6 : 0) + (cliffy(ax, ay, az) ? 3 : 0);
      if (aStamp[j] !== aSearch || g < aG[j]){ aStamp[j] = aSearch; aG[j] = g; aY[j] = ay; aFrom[j] = n; aF[j] = g + hyp2(tx - ax, tz - az) * 1.05; heapPush(j); }
    }
  }
  // reconstruct into the mob's waypoint buffer
  let len = 0, n = best; while (n >= 0 && len < 64){ len++; n = aFrom[n]; }
  len = Math.min(len, 40); n = best;
  for (let i = len - 1; i >= 0; i--){ m.path[i * 3] = ((n / AW) | 0) - AH + sx; m.path[i * 3 + 1] = aY[n]; m.path[i * 3 + 2] = (n % AW) - AH + sz; n = aFrom[n]; if (n < 0) break; }
  m.pathLen = len; m.pathI = len > 1 ? 1 : 0; m.goalErr = bestH;
  return bestH < 1.5;
}
/* ---- spatial hash (4-block cells) for separation ---- */
const HC = 4, HW = WX / HC, hashHead = new Int16Array(HW * HW), hashNext = new Int16Array(128);
function rebuildHash(){ hashHead.fill(-1); for (let i = 0; i < MOBS.length; i++){ const m = MOBS[i]; const c = clamp(Math.floor(m.x / HC), 0, HW - 1) + clamp(Math.floor(m.z / HC), 0, HW - 1) * HW; hashNext[i] = hashHead[c]; hashHead[c] = i; } }
function spawnMobs(){
  MOBS.length = 0; rs = 777; companion = null;
  const add = (type, isle, n) => { const pts = MOB_SPAWNS[isle] || []; for (let k = 0; k < n && pts.length; k++){ const p = pts[(k * 5 + 1) % pts.length], S = SPEC[type];
    MOBS.push({ type, x: p[0], y: p[1], z: p[2], px: p[0], py: p[1], pz: p[2], vx: 0, vy: 0, vz: 0, hw: S.hw, h: S.h, onGround: false, stepOff: 0, sd: 0.5, md: 0.5, yaw: rnd() * 6.28, pyaw: 0, headYaw: 0, headPitch: 0,
      st: MS.IDLE, timer: rnd() * 3, isle, home: { x: ISL[isle].x + .5, z: ISL[isle].z + .5, r: ISL[isle].r * .7, y: p[1] }, path: new Int16Array(120), pathLen: 0, pathI: 0, goalErr: 0, replan: 0, stuck: 0, lastD: 0,
      phase: rnd() * 6, spd: 0, squash: 0, heartT: 0, lod: 0, tickAcc: 0, i: 0, friend: false, pawT: 0, poof: 0, act: 0, actT: 0, actD: 0, react: 0, reactT: 0, sleep: false, zT: 0,
      A: { hy: Spr(), hp: Spr(), eL: Spr(), eR: Spr(), t1: Spr(), t2: Spr(), sq: Spr(1), lean: Spr(), blink: 1, blinkT: 2 + rnd() * 3, gait: 0, prevVy: 0, lastYaw: 0 } }); } };
  add('puffle', 0, 12); add('kit', 0, 10);
  const jPts = []; for (let k = 0; k < 10; k++){ const a = k / 10 * Math.PI * 2 + .3, rr = 62 + (k % 3) * 9; jPts.push([HOMEC.x + Math.cos(a) * rr, 64 + (k % 4) * 3, HOMEC.z + Math.sin(a) * rr]); }
  jPts.forEach((p, k) => MOBS.push({ type: 'jelly', x: p[0], y: p[1], z: p[2], px: p[0], py: p[1], pz: p[2], vx: 0, vy: 0, vz: 0, hw: .55, h: .8, yaw: 0, pyaw: 0, headYaw: 0, headPitch: 0, st: MS.WANDER, timer: 0, phase: k * 1.7,
    home: { x: p[0], y: p[1], z: p[2], r: 12 }, tx: p[0], ty: p[1], tz: p[2], act: 0, actT: 0, actD: 0, react: 0, reactT: 0, sleep: false, zT: 0, A: { hy: Spr(), hp: Spr(), eL: Spr(), eR: Spr(), t1: Spr(), t2: Spr(), sq: Spr(1), lean: Spr(), blink: 1, blinkT: 2 + rnd() * 3, gait: 0, prevVy: 0, lastYaw: 0 }, squash: 0, heartT: 0, lod: 0, tickAcc: 0, i: 0, spd: 0, stepOff: 0, sd: 0.5, md: 0.5, isle: -1, fvx: 0, fvy: 0, fvz: 0, fleeT: 0 }));
  const cnt = { puffle: 0, kit: 0, jelly: 0 }; MOBS.forEach(m => m.i = cnt[m.type]++);
  const nap = MOBS.filter(m => m.type === 'puffle')[5]; if (nap){ nap.sleep = true; nap.act = ACT.SLEEP; nap.actD = 1e9; }
  return cnt;
}
const AI_DT = 1 / 30;
function mobSetState(m, st, t){ m.st = st; m.timer = t; m.pathLen = 0; m.replan = 0; m.stuck = 0; }
function pickWander(m){
  for (let k = 0; k < 6; k++){
    const a = rnd() * 6.283, r = 2 + rnd() * m.home.r;
    const tx = Math.floor(m.home.x + Math.cos(a) * r), tz = Math.floor(m.home.z + Math.sin(a) * r);
    if (!columnOK(tx, tz, m.isle)) continue;
    let y = WY - 2; while (y > 0 && !B_SOLID[getB(tx, y, tz)]) y--;
    if (!standable(tx, y + 1, tz) || cliffy(tx, y + 1, tz)) continue;
    if (findPath(m, tx, y + 1, tz, m.isle)) return true;
  }
  return false;
}
function nearestShard(x, z, maxD){ let best = null, bd = maxD; for (const s of SHARDS){ if (found.has(s.i)) continue; const d = hyp2(s.x - x, s.z - z); if (d < bd){ bd = d; best = s; } } return best; }
function tickGroundMob(m, dt){
  const S = SPEC[m.type];
  const dx = PL.x - m.x, dz = PL.z - m.z, dist = hyp2(dx, dz) || .001;
  m.timer -= dt; m.replan -= dt;
  let speed = 0, face = false;
  const isComp = m === companion;
  // ---- decide
  if (m.st === MS.PET){ if (m.timer <= 0) mobSetState(m, isComp ? MS.FOLLOW : MS.IDLE, 1.5); face = true; }
  else if (m.st === MS.FLEE){ speed = S.run; if (m.timer <= 0) mobSetState(m, isComp ? MS.FOLLOW : MS.IDLE, 1); else if (m.replan <= 0){ m.replan = .8; const fx = Math.floor(m.x - dx / dist * 8), fz = Math.floor(m.z - dz / dist * 8); findPath(m, fx, Math.floor(m.y), fz, isComp ? -1 : m.isle); } }
  else if (isComp){
    // kits lead toward a nearby shard when the player is close behind
    const sh = m.type === 'kit' ? nearestShard(m.x, m.z, 34) : null;
    if (sh && dist < 10){ m.st = MS.LEAD; if (m.replan <= 0){ m.replan = .7; findPath(m, Math.floor(sh.x), Math.floor(sh.y), Math.floor(sh.z), -1); } speed = hyp2(sh.x - m.x, sh.z - m.z) < 1.6 ? 0 : S.walk * 1.6; if (!speed) face = true; }
    else {
      m.st = MS.FOLLOW;
      if (dist > 22 && PL.onGround){ teleportNear(m); return; }
      if (dist > 2.6 && m.replan <= 0){ m.replan = .5; if (!findPath(m, Math.floor(PL.x), Math.floor(PL.y), Math.floor(PL.z), -1) && m.goalErr > 6 && PL.onGround){ m.stuck += .5; if (m.stuck > 2) teleportNear(m); } }
      speed = dist > 2.6 ? clamp(dist * .8, S.walk, S.run) : 0; if (!speed){ m.pathLen = 0; face = true; }
    }
  }
  else if (m.sleep){ m.zT -= dt; if (m.zT <= 0){ m.zT = 1.4; emit(m.x + .2, m.y + 1.1, m.z, .15, .5, 0, .85, .88, 1, .22, 1.6, 2, -.05); } }
  else if (m.st === MS.IDLE || m.st === MS.GRAZE){
    if (dist < 5 && m.act === 0) face = true;
    if (m.timer <= 0){
      const r = rnd();
      if (r < .5 && pickWander(m)){ m.st = MS.WANDER; m.timer = 12; m.act = 0; }
      else { m.st = MS.IDLE; const pool = m.type === 'kit' ? KIT_ACTS : PUF_ACTS; m.act = pool[Math.floor(rnd() * pool.length)]; m.actT = 0; m.actD = ACT_D[m.act]; m.timer = m.actD + .3; }
    }
  }
  else if (m.st === MS.WANDER){ speed = S.walk; if (m.pathI >= m.pathLen || m.timer <= 0){ mobSetState(m, MS.IDLE, 1 + rnd() * 3); speed = 0; } }
  // ---- steer along the path
  let ddx = 0, ddz = 0;
  if (speed > 0 && m.pathI < m.pathLen){
    const wx = m.path[m.pathI * 3] + .5, wz = m.path[m.pathI * 3 + 2] + .5;
    let ex = wx - m.x, ez = wz - m.z; const ed = hyp2(ex, ez);
    if (ed < .35){ m.pathI++; }
    else { const last = m.pathI === m.pathLen - 1, arrive = last ? clamp(ed / 1.2, .25, 1) : 1; ddx = ex / ed * speed * arrive; ddz = ez / ed * speed * arrive;
      if (ed > m.lastD - .01 && m.onGround){ m.stuck += dt; if (m.stuck > 1.2){ m.stuck = 0; m.pathLen = 0; m.replan = 0; if (m.st === MS.WANDER) mobSetState(m, MS.IDLE, .5); } } else m.stuck = Math.max(0, m.stuck - dt); m.lastD = ed; }
  }
  // separation (spatial hash)
  const cx = clamp(Math.floor(m.x / HC), 0, HW - 1), cz = clamp(Math.floor(m.z / HC), 0, HW - 1);
  for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++){
    const X = cx + ox, Z = cz + oz; if (X < 0 || Z < 0 || X >= HW || Z >= HW) continue;
    for (let j = hashHead[X + Z * HW]; j >= 0; j = hashNext[j]){ const o = MOBS[j]; if (o === m || o.type === 'jelly') continue; const sx = m.x - o.x, sz = m.z - o.z, d2 = sx * sx + sz * sz; if (d2 < 1.4 && d2 > 1e-4){ const k = (1.4 - d2) * 1.6 / Math.sqrt(d2); ddx += sx * k; ddz += sz * k; } }
  }
  { const sx = m.x - PL.x, sz = m.z - PL.z, d2 = sx * sx + sz * sz; if (d2 < 1 && d2 > 1e-4){ const k = (1 - d2) * 2 / Math.sqrt(d2); ddx += sx * k; ddz += sz * k; } }
  const kk = 1 - Math.exp(-10 * dt);
  m.vx += (ddx - m.vx) * kk; m.vz += (ddz - m.vz) * kk;
  m.vy -= GRAV * dt; if (m.vy < -30) m.vy = -30;
  // integrate with the same swept collision; refuse any step that would leave solid ground
  const ox = m.x, oz = m.z;
  m.onGround = false;
  if ((m.sd = m.vy * dt, sweepAxis(m, 1))){ if (m.vy < 0) m.onGround = true; m.vy = 0; }
  if ((m.md = m.vx * dt, moveHoriz(m, 0, undefined, m.onGround))) m.vx *= .2;
  if ((m.md = m.vz * dt, moveHoriz(m, 2, undefined, m.onGround))) m.vz *= .2;
  if (m.onGround && !supported(m.x, m.y, m.z, .05) && !groundBelow(m.x, m.y, m.z)){ m.x = ox; m.z = oz; m.vx = m.vz = 0; m.pathLen = 0; }
  if (!isComp && m.isle >= 0 && isl[Math.floor(m.x) + Math.floor(m.z) * WX] !== m.isle && m.onGround){ m.x = ox; m.z = oz; m.vx = m.vz = 0; m.pathLen = 0; }
  m.spd = hyp2(m.vx, m.vz);
  // facing: from velocity when moving, else toward the player when interested
  let ty = m.yaw; if (m.spd > .3) ty = Math.atan2(-m.vx, -m.vz); else if (face && dist < 7) ty = Math.atan2(-dx, -dz);
  const turn = angDiff(ty, m.yaw), maxT = 7 * dt; m.yaw += clamp(turn, -maxT, maxT);
  // head: look at the player within limits
  let hy = 0, hp = 0; if (dist < 6){ hy = clamp(angDiff(Math.atan2(-dx, -dz), m.yaw), -1, 1); hp = clamp(Math.atan2((PL.y + 1.5) - (m.y + m.h), dist) * .6, -.4, .5); }
  if (m.act === ACT.SNIFF){ hy = 0; hp = -.7; }
  m.headYaw = hy; m.headPitch = hp; // targets; springs smooth them per rendered frame
  if (m.act){ m.actT += dt; if (m.actT >= m.actD && !m.sleep) m.act = 0; }
  if (m.reactT > 0) m.reactT -= dt;
  if (m.st !== MS.IDLE && !m.sleep) m.act = 0;
  if (m.happy > 0) m.happy -= dt;
  if (m.st === MS.PET){ m.heartT -= dt; if (m.heartT <= 0){ m.heartT = .5; hearts(m.x, m.y + m.h + .3, m.z, 1); } }
  if (m.st === MS.LEAD && m.spd > .5){ m.pawT -= dt; if (m.pawT <= 0){ m.pawT = .28; emit(m.x, Math.floor(m.y) + .06, m.z, 0, 0, 0, .3, .22, .18, .14, 3, 3, 0); } }
  if (m.y < -4) teleportHome(m);
}
function groundBelow(x, y, z){ const fx = Math.floor(x), fz = Math.floor(z), fy = Math.floor(y + .01); return solidAt(fx, fy - 1, fz) || solidAt(fx, fy - 2, fz); }
function teleportHome(m){ const p = (MOB_SPAWNS[m.isle] || [[HOMEC.x + .5, 60, HOMEC.z + .5]])[0]; m.x = m.px = p[0]; m.y = m.py = p[1]; m.z = m.pz = p[2]; m.vx = m.vy = m.vz = 0; m.pathLen = 0; }
function teleportNear(m){
  for (let r = 2; r <= 4; r++) for (let k = 0; k < 8; k++){ const a = k / 8 * 6.283 + PL.yaw + Math.PI; const x = Math.floor(PL.x + Math.sin(a) * r), z = Math.floor(PL.z + Math.cos(a) * r); const y = standY(x, Math.floor(PL.y + .01), z); if (y > -900 && boxFree(x + .5, y, z + .5, m.hw, m.h)){ sparkle(m.x, m.y + .5, m.z, 6, .95, .9, .8); m.x = m.px = x + .5; m.y = m.py = y; m.z = m.pz = z + .5; m.vx = m.vy = m.vz = 0; m.pathLen = 0; m.stuck = 0; sparkle(m.x, m.y + .5, m.z, 8, .95, .9, .8); return; } }
}
function tickJelly(m, dt, t){
  m.timer -= dt;
  const dx = PL.x - m.x, dz = PL.z - m.z, dist = hyp2(dx, dz);
  if (m.timer <= 0 || hyp3(m.tx - m.x, m.ty - m.y, m.tz - m.z) < 1.5){ m.timer = 6 + rnd() * 5; m.tx = m.home.x + (rnd() - .5) * 2 * m.home.r; m.tz = m.home.z + (rnd() - .5) * 2 * m.home.r; m.ty = clamp(m.home.y + (rnd() - .5) * 8, 22, 56); }
  // seek + arrive
  let ex = m.tx - m.x, ey = m.ty - m.y, ez = m.tz - m.z; const ed = hyp3(ex, ey, ez) || 1;
  const sp = SPEC.jelly.walk * clamp(ed / 4, .3, 1);
  let ax = ex / ed * sp, ay = ey / ed * sp, az = ez / ed * sp;
  if (m.st === MS.FLEE){ m.timer = Math.min(m.timer, 2); ax = -dx / (dist || 1) * 4; az = -dz / (dist || 1) * 4; ay = 1; if ((m.fleeT -= dt) <= 0) m.st = MS.WANDER; }
  // terrain avoidance: probe ahead and below; steer up and around
  const vl = hyp2(m.vx, m.vz) || 1;
  for (let k = 1; k <= 3; k++){ const px = m.x + m.vx / vl * k * 1.2, pz = m.z + m.vz / vl * k * 1.2; if (solidAt(Math.floor(px), Math.floor(m.y + .3), Math.floor(pz)) || solidAt(Math.floor(px), Math.floor(m.y - 1), Math.floor(pz))){ ay += 3 / k; ax -= m.vx / vl * 1.5 / k; az -= m.vz / vl * 1.5 / k; break; } }
  if (solidAt(Math.floor(m.x), Math.floor(m.y - 1.5), Math.floor(m.z))) ay += 1.5;
  if (dist < 2.2 && Math.abs(PL.y + 1 - m.y) < 2.5){ ax -= dx / (dist || 1) * 1.5; az -= dz / (dist || 1) * 1.5; }
  const k = 1 - Math.exp(-1.6 * dt); m.vx += (ax - m.vx) * k; m.vy += (ay - m.vy) * k; m.vz += (az - m.vz) * k;
  (m.sd = m.vy * dt, sweepAxis(m, 1)); (m.sd = m.vx * dt, sweepAxis(m, 0)); (m.sd = m.vz * dt, sweepAxis(m, 2));
  m.spd = hyp2(m.vx, m.vz);
  if (m.spd > .1) m.yaw += clamp(angDiff(Math.atan2(-m.vx, -m.vz), m.yaw), -2 * dt, 2 * dt);
}
function angDiff(a, b){ let d = a - b; while (d > Math.PI) d -= 6.2832; while (d < -Math.PI) d += 6.2832; return d; }
let aiAcc = 0, aiFrame = 0;
const _frus = glOK ? new THREE.Frustum() : null, _pm = glOK ? new THREE.Matrix4() : null, _sph = glOK ? new THREE.Sphere() : null;
function stepMobs(dt, t){
  aiAcc += dt;
  if (aiAcc < AI_DT) return;
  aiAcc -= AI_DT; if (aiAcc > AI_DT * 3) aiAcc = 0;
  aiFrame++;
  rebuildHash();
  _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); _frus.setFromProjectionMatrix(_pm);
  for (let i = 0; i < MOBS.length; i++){
    const m = MOBS[i];
    const d = hyp2(m.x - PL.x, m.z - PL.z);
    // LOD: near = every tick, mid = every 3rd tick, far + offscreen = frozen
    let every = 1;
    if (m !== companion){ if (d > 56){ _sph.center.set(m.x, m.y, m.z); _sph.radius = 2; if (d > 96 && !_frus.intersectsSphere(_sph)) { m.px = m.x; m.py = m.y; m.pz = m.z; m.pyaw = m.yaw; continue; } every = 3; } }
    if ((aiFrame + i) % every) continue;
    const ddt = AI_DT * every;
    m.px = m.x; m.py = m.y; m.pz = m.z; m.pyaw = m.yaw;
    if (m.type === 'jelly') tickJelly(m, ddt, t); else tickGroundMob(m, ddt);
    if (m.squash > 0) m.squash = Math.max(0, m.squash - ddt * 3);
    m.stepOff *= Math.exp(-12 * ddt);
  }
}
function mobAlpha(){ return clamp(aiAcc / AI_DT, 0, 1); }
let MI = {};
const _m0 = glOK ? new THREE.Matrix4() : null, _m1 = glOK ? new THREE.Matrix4() : null, _m2 = glOK ? new THREE.Matrix4() : null, _eu = glOK ? new THREE.Euler() : null, _sv = glOK ? new THREE.Vector3() : null, _col = glOK ? new THREE.Color() : null;
function instMesh(geo, mat, n){ const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n)); m.count = n; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); for (let i = 0; i < n; i++) m.setColorAt(i, _col.setRGB(1, 1, 1)); scene.add(m); return m; }
let jellyGeo = null, jellyTentGeo = null, jellyMat = null;
const ACT = { SLEEP: 1, SIT: 2, SNIFF: 3, SCRATCH: 4, YAWN: 5, HOP: 6 }, ACT_D = [0, 9, 3.2, 2.2, 1.8, 2, 1.6];
const PUF_ACTS = [ACT.SIT, ACT.SNIFF, ACT.YAWN, ACT.HOP, ACT.SCRATCH], KIT_ACTS = [ACT.SIT, ACT.SNIFF, ACT.SCRATCH, ACT.YAWN];
const REACT = { STARTLE: 1, HAPPY: 2 }, REACT_D = [0, .6, 1.5];
function buildMobs(){
  const cnt = spawnMobs();
  const mat = litMat({ rim: .32 });
  // ---- Puffle: a round cloud-bun with lop ears, a face patch, tiny paws and a pom tail (tinted per mob)
  const W = [1, .98, .95], W2 = [.94, .9, .86], FACE = [1, .97, .92], PINK = [.93, .62, .64], INK = [.12, .1, .13], WHITE = [1, 1, 1];
  const pBody = boxGeo([[0, 0, 0, .86, .7, .86, W], [0, 0, 0, .96, .56, .74, W], [0, 0, 0, .74, .56, .96, W], [0, .3, 0, .62, .14, .62, W], [0, -.3, 0, .62, .12, .62, W2],
    [0, -.02, -.47, .52, .36, .04, FACE], [0, -.05, -.495, .09, .06, .03, PINK], [-.18, -.12, -.492, .1, .05, .02, PINK], [.18, -.12, -.492, .1, .05, .02, PINK], [0, -.15, -.49, .1, .02, .02, INK], [0, .38, .05, .1, .12, .1, W], [.06, .44, .08, .06, .08, .06, W2], [0, -.18, -.38, .4, .2, .1, FACE], [-.26, -.06, -.475, .08, .04, .02, [1, .78, .8]], [.26, -.06, -.475, .08, .04, .02, [1, .78, .8]]]); // + a hair tuft, a belly patch, rosy cheeks
  const pEyes = boxGeo([[-.13, 0, -.49, .1, .14, .03, INK], [.13, 0, -.49, .1, .14, .03, INK], [-.11, .04, -.507, .035, .035, .01, WHITE], [.15, .04, -.507, .035, .035, .01, WHITE]]);
  const pEar = boxGeo([[0, -.2, 0, .16, .42, .09, W], [0, -.2, -.047, .09, .32, .01, PINK], [0, -.42, 0, .14, .06, .08, W2]]);
  const pFoot = boxGeo([[0, -.04, 0, .2, .08, .26, W2], [0, -.04, -.12, .18, .07, .04, [.86, .78, .74]]]);
  const pTail = boxGeo([[0, 0, 0, .2, .2, .16, W], [0, .04, .02, .14, .14, .14, WHITE]]);
  // ---- Kit: a sky fennec with oversized ears, a two-part brush tail and a teal scarf
  const SAND = [.86, .62, .38], SAND2 = [.74, .5, .3], CREAM = [.98, .92, .82], TEAL = [.3, .6, .58], DARK = [.2, .14, .12];
  const kBody = boxGeo([[0, 0, 0, .34, .3, .64, SAND], [0, -.11, -.02, .27, .08, .52, CREAM], [0, .08, -.27, .4, .12, .12, TEAL], [.14, .02, -.34, .08, .18, .04, TEAL]]);
  const kHead = boxGeo([[0, 0, 0, .38, .32, .32, SAND], [0, -.08, -.2, .2, .13, .14, CREAM], [0, -.04, -.28, .07, .06, .03, DARK], [-.16, -.07, -.06, .07, .12, .2, CREAM], [.16, -.07, -.06, .07, .12, .2, CREAM], [0, .15, .02, .3, .04, .26, SAND2], [-.15, -.09, -.25, .14, .01, .01, [.98, .95, .9]], [.15, -.09, -.25, .14, .01, .01, [.98, .95, .9]], [0, -.14, -.25, .06, .02, .02, [.6, .3, .3]], [0, .1, -.17, .16, .02, .02, SAND2]]); // + whiskers, a tongue tip, a brow
  const kEyes = boxGeo([[-.095, 0, -.165, .07, .09, .02, INK], [.095, 0, -.165, .07, .09, .02, INK], [-.08, .025, -.177, .025, .025, .01, WHITE], [.11, .025, -.177, .025, .025, .01, WHITE]]);
  const kEar = boxGeo([[0, .19, 0, .16, .38, .06, SAND], [0, .18, -.031, .1, .28, .01, PINK], [0, .37, 0, .1, .06, .065, DARK]]);
  const kTail1 = boxGeo([[0, 0, .17, .17, .17, .34, SAND]]);
  const kTail2 = boxGeo([[0, 0, .15, .2, .2, .3, SAND], [0, 0, .33, .16, .16, .1, CREAM]]);
  const kLeg = boxGeo([[0, -.12, 0, .1, .26, .1, SAND2], [0, -.25, -.015, .11, .04, .13, DARK], [0, -.24, -.08, .11, .03, .03, CREAM]]);
  const jc = [.74, .68, .92];
  jellyGeo = boxGeo([[0, 0, 0, 1, .36, 1, jc], [0, .26, 0, .8, .26, .8, [.8, .74, .95]], [0, .45, 0, .5, .16, .5, [.88, .84, .98]], [0, -.08, -.505, .14, .04, .02, [.95, .6, .7]], [0, .12, 0, .34, .3, .34, [1, .92, .78]], [0, -.2, 0, 1.12, .08, 1.12, [.68, .6, .9]], [-.36, .1, -.4, .14, .06, .06, [.98, .9, 1]], [.3, .32, .24, .1, .06, .1, [.98, .9, 1]]]); // + a glowing core, a frilly skirt, speckles
  const jEyes = boxGeo([[-.18, 0, -.505, .08, .12, .02, [.2, .16, .3]], [.18, 0, -.505, .08, .12, .02, [.2, .16, .3]]]);
  jellyTentGeo = boxGeo([[0, -.35, 0, .08, .7, .08, [.86, .8, .98]]]);
  jellyMat = litMat({ emis: .45, rim: .5, transparent: true, alpha: .88 });
  const P = cnt.puffle, K = cnt.kit, J = cnt.jelly;
  MI = {
    pBody: instMesh(pBody, mat, P), pEyes: instMesh(pEyes, mat, P), pEar: instMesh(pEar, mat, P * 2), pFoot: instMesh(pFoot, mat, P * 2), pTail: instMesh(pTail, mat, P),
    kBody: instMesh(kBody, mat, K), kHead: instMesh(kHead, mat, K), kEyes: instMesh(kEyes, mat, K), kEar: instMesh(kEar, mat, K * 2), kTail1: instMesh(kTail1, mat, K), kTail2: instMesh(kTail2, mat, K), kLeg: instMesh(kLeg, mat, K * 4),
    jDome: instMesh(jellyGeo, jellyMat, J + 1), jEyes: instMesh(jEyes, jellyMat, J + 1), jTent: instMesh(jellyTentGeo, jellyMat, (J + 1) * 6)
  };
  const tints = [[1, .93, .86], [.9, .96, .9], [.93, .9, 1], [1, .9, .9], [.98, .97, .92]];
  MOBS.forEach(m => { if (m.type === 'puffle'){ const c = tints[m.i % tints.length]; MI.pBody.setColorAt(m.i, _col.setRGB(c[0], c[1], c[2])); MI.pTail.setColorAt(m.i, _col); MI.pEar.setColorAt(m.i * 2, _col); MI.pEar.setColorAt(m.i * 2 + 1, _col); } });
  MI.pBody.instanceColor.needsUpdate = true; MI.pTail.instanceColor.needsUpdate = true; MI.pEar.instanceColor.needsUpdate = true;
  MI.nJ = J; MI.list = Object.keys(MI).filter(k => MI[k] && MI[k].isInstancedMesh).map(k => MI[k]);
}
const JD = { x: 0.5, y: 0.5, z: 0.5, yaw: 0.5, t: 0.5, ph: 0.5, s: 0.5, blink: 1 };
const _m3 = glOK ? new THREE.Matrix4() : null;
function drawJelly(i){
  const x = JD.x, y = JD.y, z = JD.z, yaw = JD.yaw, t = JD.t, ph = JD.ph, s = JD.s;
  const pul = Math.sin(t * 2.2 + ph), sq = pul * .07;
  _m0.makeRotationY(yaw); _m0.scale(_sv.set(s * (1 + sq), s * (1 - sq), s * (1 + sq))); _m0.setPosition(x, y, z);
  MI.jDome.setMatrixAt(i, _m0);
  _m1.makeScale(1, JD.blink, 1); _m1.setPosition(0, .02, 0); _m2.multiplyMatrices(_m0, _m1); MI.jEyes.setMatrixAt(i, _m2);
  for (let j = 0; j < 6; j++){ const a = j / 6 * 6.283, w = t * 2.4 + j + ph; _eu.set(Math.sin(w) * .35 + pul * .15, 0, Math.cos(w * .83 + j * 1.3) * .25, 'YXZ'); _m1.makeRotationFromEuler(_eu); _m1.setPosition(Math.cos(a) * .32, -.16, Math.sin(a) * .32); _m2.multiplyMatrices(_m0, _m1); MI.jTent.setMatrixAt(i * 6 + j, _m2); }
}
// local transform helper: rotation (YXZ), non-uniform scale, then position -> _m1
function local(rx, ry, rz, sx, sy, sz, px, py, pz){ _eu.set(rx, ry, rz, 'YXZ'); _m1.makeRotationFromEuler(_eu); if (sx !== 1 || sy !== 1 || sz !== 1) _m1.scale(_sv.set(sx, sy, sz)); _m1.setPosition(px, py, pz); }
function blinkStep(A, dt){ A.blinkT -= dt; if (A.blinkT < 0){ A.blink = A.blinkT > -.13 ? .12 : 1; if (A.blinkT < -.13) A.blinkT = 1.8 + Math.random() * 4; } else A.blink = 1; }
function renderMobs(t, dt){
  const a = mobAlpha();
  for (let k = 0; k < MOBS.length; k++){
    const m = MOBS[k], i = m.i, A = m.A;
    const x = m.px + (m.x - m.px) * a, y = m.py + (m.y - m.py) * a - m.stepOff, z = m.pz + (m.z - m.pz) * a, yaw = m.pyaw + angDiff(m.yaw, m.pyaw) * a;
    const turn = angDiff(yaw, A.lastYaw) / Math.max(dt, 1e-3); A.lastYaw = yaw;
    blinkStep(A, dt);
    const sleeping = m.sleep || m.act === ACT.SLEEP;
    if (m.type === 'jelly'){ JD.x = x; JD.y = y + .5; JD.z = z; JD.yaw = yaw; JD.t = t; JD.ph = m.phase; JD.s = 1.3; JD.blink = A.blink; drawJelly(i); continue; }
    const S = SPEC[m.type], spdN = Math.min(1, m.spd / S.walk);
    // reactions (additive layers with envelopes so nothing pops)
    const rD = REACT_D[m.react] || 1, ru = m.reactT > 0 ? 1 - m.reactT / rD : 1, re = m.reactT > 0 ? env(rD - m.reactT, rD, .08, .25) : 0;
    const startle = m.react === REACT.STARTLE ? re : 0, happy = m.react === REACT.HAPPY ? re : 0;
    const ae = m.act ? env(m.actT, m.actD, .35, .35) : 0, act = m.act;
    const sitW = act === ACT.SIT ? ae : 0, sniffW = act === ACT.SNIFF ? ae : 0, scrW = act === ACT.SCRATCH ? ae : 0, yawnW = act === ACT.YAWN ? ae : 0, hopW = act === ACT.HOP ? ae : 0, slpW = sleeping ? 1 : 0;
    spring(A.hy, m.headYaw * (1 - slpW), 7, dt); spring(A.hp, m.headPitch * (1 - slpW) + yawnW * .45, 7, dt);
    if (m.type === 'puffle'){
      // hop locomotion: one hop per .7 m, squash on contact, stretch on take-off
      A.gait += m.spd * dt / .7; const f = A.gait % 1, moving = spdN > .1 ? 1 : 0;
      let hop = Math.sin(Math.PI * f) * .24 * spdN * moving;
      hop += Math.max(0, Math.sin(Math.PI * ((m.actT * 2.1) % 1))) * .2 * hopW + Math.sin(Math.PI * ru) * .38 * startle + Math.abs(Math.sin(t * 9)) * .12 * happy;
      const contact = moving ? (1 - sstep(.0, .14, Math.min(f, 1 - f))) : 0;
      const sqT = 1 - contact * .16 * spdN + (moving && f > .12 && f < .45 ? .07 : 0) - sitW * .1 - slpW * .1 + Math.sin(t * (slpW ? 1.3 : 2) + k) * (slpW ? .035 : .015) + startle * .12;
      spring(A.sq, sqT, 16, dt); const sq = A.sq.x;
      const bodyY = .44 + hop - sitW * .05 - slpW * .07, lean = spdN * .12 + sniffW * .22 - yawnW * .18;
      const wig = happy * Math.sin(t * 15) * .3 + scrW * Math.sin(t * 22) * .06;
      _m0.makeRotationY(yaw + A.hy.x * .4 + wig); _m0.setPosition(x, y, z);
      local(lean, 0, scrW * Math.sin(t * 22) * .05, 1 + (1 - sq) * .6, sq, 1 + (1 - sq) * .6, 0, bodyY, 0); _m2.multiplyMatrices(_m0, _m1); MI.pBody.setMatrixAt(i, _m2);
      _m3.copy(_m2);
      _m1.makeScale(1, sleeping ? .1 : A.blink * (1 - yawnW * .6), 1); _m1.setPosition(0, .06, 0); _m2.multiplyMatrices(_m3, _m1); MI.pEyes.setMatrixAt(i, _m2);
      // ears: lop ears on springs driven by vertical motion -> secondary flop
      const vyB = (hop - A.prevVy) / Math.max(dt, 1e-3); A.prevVy = hop;
      const earT = 1.15 - clamp(vyB * .12, -.6, .6) - startle * .9 + happy * Math.sin(t * 15) * .2 + slpW * .25;
      spring(A.eL, earT + Math.sin(t * 1.7 + k) * .04, 10, dt); spring(A.eR, earT + Math.sin(t * 1.9 + k) * .04, 9, dt);
      local(.15, 0, A.eL.x, 1, 1, 1, -.27, .3, -.06); _m2.multiplyMatrices(_m3, _m1); MI.pEar.setMatrixAt(i * 2, _m2);
      local(.15, 0, -A.eR.x, 1, 1, 1, .27, .3, -.06); _m2.multiplyMatrices(_m3, _m1); MI.pEar.setMatrixAt(i * 2 + 1, _m2);
      spring(A.t1, -turn * .08 + happy * Math.sin(t * 18) * .4, 12, dt);
      local(0, A.t1.x, 0, 1, 1, 1, 0, .02, .46); _m2.multiplyMatrices(_m3, _m1); MI.pTail.setMatrixAt(i, _m2);
      // paws: planted on the ground, tucked mid-hop, one scratches
      const tuck = Math.sin(Math.PI * f) * spdN * moving;
      for (let j = 0; j < 2; j++){ const sx = j ? .2 : -.2; local(-tuck * .7 + (j === 1 ? Math.sin(t * 24) * .5 * scrW : 0), 0, 0, 1, 1, 1, sx, .07 + hop * .7, -.12 - tuck * .05); _m2.multiplyMatrices(_m0, _m1); MI.pFoot.setMatrixAt(i * 2 + j, _m2); }
    } else {
      // trot: diagonal pairs, feet travel with the ground (stride .55 m), body bobs twice per cycle
      A.gait += m.spd * dt / .55; const ph = A.gait * 6.2832, amp = Math.min(1, m.spd / 1.6) * .75;
      const bob = Math.abs(Math.cos(ph)) * .035 * amp + Math.sin(Math.PI * ru) * .32 * startle + Math.abs(Math.sin(t * 10)) * .08 * happy;
      const bodyY = .42 + bob - sitW * .06, pitch = -sitW * .38 + amp * .04 * Math.sin(ph * 2);
      _m0.makeRotationY(yaw); _m0.setPosition(x, y, z);
      local(pitch, 0, happy * Math.sin(t * 14) * .1, 1, 1, 1, 0, bodyY, 0); _m2.multiplyMatrices(_m0, _m1); MI.kBody.setMatrixAt(i, _m2); _m3.copy(_m2);
      const nod = sniffW * Math.sin(t * 17) * .06;
      local(-.1 - A.hp.x - sitW * -.25 + nod, A.hy.x, scrW * .25 + happy * Math.sin(t * 12) * .15, 1, 1, 1, 0, .17 + sitW * .04, -.38); _m2.multiplyMatrices(_m3, _m1); MI.kHead.setMatrixAt(i, _m2);
      _m3.copy(_m2);
      _m1.makeScale(1, sleeping ? .1 : A.blink * (1 - yawnW * .7), 1); _m1.setPosition(0, .04, 0); _m2.multiplyMatrices(_m3, _m1); MI.kEyes.setMatrixAt(i, _m2);
      const flick = noise1(t * .9, k * 7) * .5, earBase = -.12 - startle * .9 - yawnW * .5 + happy * .15;
      spring(A.eL, earBase + flick * .5 - turn * .05, 11, dt); spring(A.eR, earBase - flick * .4 + turn * .05, 10, dt);
      local(A.eL.x, .2, .28, 1, 1, 1, -.12, .14, .04); _m2.multiplyMatrices(_m3, _m1); MI.kEar.setMatrixAt(i * 2, _m2);
      local(A.eR.x, -.2, -.28, 1, 1, 1, .12, .14, .04); _m2.multiplyMatrices(_m3, _m1); MI.kEar.setMatrixAt(i * 2 + 1, _m2);
      // tail chain: segment 2 lags segment 1 (secondary motion), wag speeds up when happy, leading or following
      const wagF = happy ? 16 : (m === companion || m.st === MS.LEAD) ? 9 : 3.5, wagA = happy ? .7 : (m === companion ? .45 : .22);
      spring(A.t1, Math.sin(t * wagF + k) * wagA - turn * .25, 14, dt); spring(A.t2, A.t1.x * 1.4, 8, dt);
      _m0.makeRotationY(yaw); _m0.setPosition(x, y, z);
      local(-.55 + bob * 2 - sitW * .3, A.t1.x, 0, 1, 1, 1, 0, .48 + bob, .3); _m2.multiplyMatrices(_m0, _m1); MI.kTail1.setMatrixAt(i, _m2); _m3.copy(_m2);
      local(.3, A.t2.x - A.t1.x, 0, 1, 1, 1, 0, 0, .33); _m2.multiplyMatrices(_m3, _m1); MI.kTail2.setMatrixAt(i, _m2);
      for (let j = 0; j < 4; j++){
        const front = j < 2, off = (j === 0 || j === 3) ? 0 : Math.PI, s = Math.sin(ph + off), c = Math.cos(ph + off);
        let ang = s * amp * .8 + (c > 0 ? -c * .35 * amp : 0);
        if (!front) ang -= sitW * 1.25; if (j === 3) ang += Math.sin(t * 28) * .9 * scrW;
        local(ang, 0, 0, 1, 1, 1, j & 1 ? .11 : -.11, .26 + bob + (front ? 0 : -sitW * .02), front ? -.22 : .23); _m2.multiplyMatrices(_m0, _m1); MI.kLeg.setMatrixAt(i * 4 + j, _m2);
      }
    }
  }
  // rescue jelly during a catch
  if (PL.catching){ const u = Math.min(1, CATCH.t / CATCH_T); const drop = u < .2 ? (1 - EZ.outCubic(u / .2)) * 6 : (u > .9 ? EZ.inCubic((u - .9) / .1) * 4 : 0); const ex = PL.px + (PL.x - PL.px) * renderAlpha, ey = PL.py + (PL.y - PL.py) * renderAlpha, ez = PL.pz + (PL.z - PL.pz) * renderAlpha; JD.x = ex; JD.y = ey + 3.1 + drop; JD.z = ez; JD.yaw = PL.yaw; JD.t = t; JD.ph = 0; JD.s = 1.6; JD.blink = 1; drawJelly(MI.nJ); MI.jDome.count = MI.jEyes.count = MI.nJ + 1; MI.jTent.count = (MI.nJ + 1) * 6; }
  else { MI.jDome.count = MI.jEyes.count = MI.nJ; MI.jTent.count = MI.nJ * 6; }
  for (let q = 0; q < MI.list.length; q++) MI.list[q].instanceMatrix.needsUpdate = true;
}
function rayMob(ox, oy, oz, dx, dy, dz, maxD){
  let best = null, bt = maxD;
  for (let k = 0; k < MOBS.length; k++){ const m = MOBS[k];
    const cx = m.x - ox, cy = m.y + (m.type === 'jelly' ? .6 : m.h * .55) - oy, cz = m.z - oz, r = m.type === 'jelly' ? .8 : m.hw + .22;
    const tca = cx * dx + cy * dy + cz * dz; if (tca < 0) continue;
    const d2 = cx * cx + cy * cy + cz * cz - tca * tca; if (d2 > r * r) continue;
    const t = tca - Math.sqrt(r * r - d2); if (t < bt){ bt = t; best = m; }
  }
  MOBHIT.m = best; MOBHIT.t = bt; return best;
}
const MOBHIT = { m: null, t: 0 };
function interactMob(m){
  const S = SPEC[m.type];
  if (S.fly){ m.st = MS.FLEE; m.fleeT = 1.2; SND.voice('jelly', m); hearts(m.x, m.y + 1.2, m.z, 2); return; }
  const held = heldId();
  if (S.treat && held === S.treat && m !== companion){
    takeFromSel(1); animFeed();
    if (companion){ const old = companion; old.friend = false; const isle = islandIndexAt(old.x, old.z); old.isle = isle === 0 ? isle : old.isle; old.home.x = ISL[old.isle].x + .5; old.home.z = ISL[old.isle].z + .5; if (isle !== old.isle) teleportHome(old); mobSetState(old, MS.IDLE, 1); }
    companion = m; m.friend = true; friends.add(m.type);
    mobSetState(m, MS.PET, 1.6); m.heartT = 0; m.react = REACT.HAPPY; m.reactT = REACT_D[2]; m.sleep = false; m.act = 0;
    for (let i = 0; i < 4; i++) hearts(m.x, m.y + m.h + .2, m.z, 2); sparkle(m.x, m.y + .8, m.z, 10, 1, .9, .6);
    SND.befriend(); SND.voice(m.type, m);
    toastCard(S.name + ' joined you', S.ability + '.');
    renderJournalSoon(); saveDirty = true;
    return;
  }
  const woke = m.sleep; m.sleep = false; m.act = 0; animPlace();
  mobSetState(m, MS.PET, 1.4); m.heartT = 0; m.react = REACT.HAPPY; m.reactT = REACT_D[2]; hearts(m.x, m.y + m.h + .2, m.z, 3); SND.voice(m.type, m); SND.heart(); if (woke) toast('You woke the napping puffle. It seems pleased.');
}
function pokeMob(m){
  if (SPEC[m.type].fly){ m.st = MS.FLEE; m.fleeT = 1; }
  else { const woke = m.sleep; m.sleep = false; m.act = 0; m.react = REACT.STARTLE; m.reactT = REACT_D[1]; mobSetState(m, MS.FLEE, woke ? .8 : 1.6); }
  SND.voice(m.type, m); sparkle(m.x, m.y + m.h, m.z, 4, 1, .95, .8);
}

/* ================= ambient fliers: flocking birds + butterflies (CPU steering, GPU flap) ================= */
const BIRDS = [], BUGS = [];
let birdMesh = null, bugMesh = null;
function flierMat(color){
  return new THREE.ShaderMaterial({ uniforms: Object.assign({ uCol: { value: new THREE.Color(color[0], color[1], color[2]) }, uRate: { value: 0 } }, U), side: THREE.DoubleSide,
    vertexShader: `attribute float aPh; uniform float uTime; uniform float uRate; uniform vec3 uCol; varying vec3 vW; varying vec3 vC;
      void main(){ vec3 p = position; float ax = abs(p.x); float fl = sin(uTime * uRate + aPh * 30.0) * (uRate > 10.0 ? 1.0 : 0.6); p = vec3(sign(p.x) * ax * cos(fl), ax * sin(fl), p.z);
        vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0); vW = w.xyz; vC = uCol;
        #ifdef USE_INSTANCING_COLOR
        vC = instanceColor;
        #endif
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `${GL_COMMON} varying vec3 vW; varying vec3 vC; void main(){ vec3 c = litCol(vC, vec3(0.0, 1.0, 0.0), 1.0, 0.0) * 0.8 + vC * 0.25; c = fogIt(c, vW); gl_FragColor = vec4(grade(c), 1.0); }` });
}
function wingGeo(n){ const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, -.5, -1, 0, -.6, -1, 0, .4, 0, 0, .5, 0, 0, -.5, 1, 0, -.6, 1, 0, .4, 0, 0, .5]), 3)); g.setIndex([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]); const ph = new Float32Array(n); for (let i = 0; i < n; i++) ph[i] = rnd(); g.setAttribute('aPh', new THREE.InstancedBufferAttribute(ph, 1)); return g; }
function buildFliers(){
  const nB = 10, nU = LOW ? 10 : 18;
  for (let i = 0; i < nB; i++) BIRDS.push({ x: HOMEC.x + (rnd() - .5) * 30, y: 80 + rnd() * 4, z: HOMEC.z + (rnd() - .5) * 30, vx: rnd() - .5, vy: 0, vz: rnd() - .5 });
  for (let i = 0; i < nU; i++){ const s = BUTTERFLY_SPOTS[Math.floor(rnd() * BUTTERFLY_SPOTS.length)] || [HOMEC.x, 58, HOMEC.z]; BUGS.push({ ax: s[0], ay: s[1], az: s[2], x: s[0], y: s[1] + 1, z: s[2], vx: 0, vy: 0, vz: 0, ph: rnd() * 10, c: i % 5 }); }
  birdMesh = new THREE.InstancedMesh(wingGeo(nB), flierMat([.22, .23, .28]), nB); birdMesh.material.uniforms.uRate.value = 5; birdMesh.frustumCulled = false; scene.add(birdMesh);
  bugMesh = new THREE.InstancedMesh(wingGeo(nU), flierMat([.93, .78, .5]), nU); bugMesh.material.uniforms.uRate.value = 17; bugMesh.frustumCulled = false; scene.add(bugMesh);
  const cols = [[.93, .78, .5], [.88, .6, .58], [.72, .78, .93], [.96, .94, .88], [.8, .62, .84]];
  for (let i = 0; i < nU; i++) bugMesh.setColorAt(i, _col.setRGB(...cols[i % 5]));
}
function stepFliers(dt, t){
  // boids: cohesion, alignment, separation + a slow circuit around the Hub, terrain avoidance
  let cx = 0, cy = 0, cz = 0, ax = 0, ay = 0, az = 0; const n = BIRDS.length;
  for (const b of BIRDS){ cx += b.x; cy += b.y; cz += b.z; ax += b.vx; ay += b.vy; az += b.vz; }
  cx /= n; cy /= n; cz /= n; ax /= n; ay /= n; az /= n;
  const ang = t * .05, gx = HOMEC.x + Math.cos(ang) * 64, gz = HOMEC.z + Math.sin(ang) * 64, gy = 82;
  for (let i = 0; i < n; i++){
    const b = BIRDS[i]; let fx = (cx - b.x) * .4 + (ax - b.vx) * .8 + (gx - b.x) * .12, fy = (cy - b.y) * .4 + (gy - b.y) * .4, fz = (cz - b.z) * .4 + (az - b.vz) * .8 + (gz - b.z) * .12;
    for (let j = 0; j < n; j++){ if (j === i) continue; const o = BIRDS[j], sx = b.x - o.x, sy = b.y - o.y, sz = b.z - o.z, d2 = sx * sx + sy * sy + sz * sz; if (d2 < 9 && d2 > 1e-3){ fx += sx / d2 * 6; fy += sy / d2 * 6; fz += sz / d2 * 6; } }
    const sp = hyp3(b.vx, b.vy, b.vz) || 1;
    for (let k = 1; k <= 3; k++) if (solidAt(Math.floor(b.x + b.vx / sp * k * 2), Math.floor(b.y + b.vy / sp * k * 2), Math.floor(b.z + b.vz / sp * k * 2))){ fy += 12 / k; break; }
    b.vx += fx * dt; b.vy += fy * dt; b.vz += fz * dt;
    const s2 = hyp3(b.vx, b.vy, b.vz), want = clamp(s2, 6, 9); b.vx *= want / s2; b.vy = clamp(b.vy * want / s2, -2, 2); b.vz *= want / s2;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    _m0.makeRotationY(Math.atan2(b.vx, b.vz)); _m0.scale(_sv.set(.55, .55, .55)); _m0.setPosition(b.x, b.y, b.z); birdMesh.setMatrixAt(i, _m0);
  }
  birdMesh.instanceMatrix.needsUpdate = true;
  const day = 1 - U.uNight.value;
  for (let i = 0; i < BUGS.length; i++){
    const u = BUGS[i]; u.ph += dt;
    const tx = u.ax + Math.sin(u.ph * .7) * 2.2 + Math.sin(u.ph * .31) * 1.2, ty = u.ay + 1.1 + Math.sin(u.ph * 1.7) * .45, tz = u.az + Math.cos(u.ph * .57) * 2.2;
    let fx = (tx - u.x) * 2, fy = (ty - u.y) * 2, fz = (tz - u.z) * 2;
    if (solidAt(Math.floor(u.x + u.vx * .4), Math.floor(u.y - .2), Math.floor(u.z + u.vz * .4))) fy += 6;
    u.vx += (fx - u.vx) * Math.min(1, dt * 3); u.vy += (fy - u.vy) * Math.min(1, dt * 3); u.vz += (fz - u.vz) * Math.min(1, dt * 3);
    const nx = u.x + u.vx * dt, ny = u.y + u.vy * dt, nz = u.z + u.vz * dt;
    if (!solidAt(Math.floor(nx), Math.floor(ny), Math.floor(nz))){ u.x = nx; u.y = ny; u.z = nz; } else u.vy = 2;
    _m0.makeRotationY(Math.atan2(u.vx, u.vz)); const s = .16 * day; _m0.scale(_sv.set(s, s, s)); _m0.setPosition(u.x, u.y, u.z); bugMesh.setMatrixAt(i, _m0);
  }
  bugMesh.instanceMatrix.needsUpdate = true;
}

/* ================= updraft motes (GPU animated) ================= */
function buildUpdrafts(){ draftPoints(UPDRAFTS); }
function draftPoints(list){
  const per = LOW ? 22 : 40, N = Math.max(1, list.length * per), p = new Float32Array(N * 3), a = new Float32Array(N * 2);
  let k = 0;
  for (const u of list) for (let i = 0; i < per; i++, k++){ const r = Math.sqrt(rnd()) * u.r * .9, th = rnd() * 6.283; p[k * 3] = u.x + Math.cos(th) * r; p[k * 3 + 1] = 14; p[k * 3 + 2] = u.z + Math.sin(th) * r; a[k * 2] = rnd(); a[k * 2 + 1] = u.top; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('aA', new THREE.BufferAttribute(a, 2));
  const pts = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: Object.assign({ uScale: UScale }, U), transparent: true, depthWrite: false,
    vertexShader: `attribute vec2 aA; uniform float uTime; uniform float uScale; varying float vA;
      void main(){ float span = aA.y - 14.0; float f = fract(aA.x + uTime * 0.09); vec3 p = position; p.y = 14.0 + f * span; p.x += sin(uTime * 0.8 + aA.x * 40.0) * 0.3; p.z += cos(uTime * 0.7 + aA.x * 30.0) * 0.3;
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; vA = smoothstep(0.0, 0.15, f) * (1.0 - smoothstep(0.75, 1.0, f)); gl_PointSize = 0.16 * uScale / -mv.z; }`,
    fragmentShader: `uniform float uNight; varying float vA; void main(){ vec2 q = abs(gl_PointCoord - 0.5); if (max(q.x, q.y) > 0.5) discard; gl_FragColor = vec4(mix(vec3(1.0, 0.97, 0.88), vec3(0.75, 0.85, 1.0), uNight), vA * 0.7); }` }));
  pts.frustumCulled = false; scene.add(pts); return pts;
}

/* ================= lore shards, waystones, festival ================= */
const found = new Set(), visited = new Set(), ways = new Set(), friends = new Set();
let shardMesh = null, sailMesh = null;
function buildShards(){
  const g = new THREE.OctahedronGeometry(.32, 0); g.scale(1, 1.5, 1);
  const col = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < col.length; i += 3){ col[i] = .78; col[i + 1] = .86; col[i + 2] = 1; } g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  shardMesh = instMesh(g, litMat({ emis: .9, rim: .6 }), SHARDS.length);
}
function updateShards(t){
  let n = 0;
  for (const s of SHARDS){
    if (found.has(s.i) || (s.hidden && !RC.done)) continue;
    _m0.makeRotationY(t * 1.4 + s.i); _m0.setPosition(s.x, s.y + Math.sin(t * 2 + s.i) * .12, s.z); shardMesh.setMatrixAt(n++, _m0);
    if (state === 'play' && Math.abs(PL.x - s.x) < 1.2 && Math.abs(PL.z - s.z) < 1.2 && PL.y + 1 > s.y - 1.6 && PL.y < s.y + .8) collectShard(s);
  }
  shardMesh.count = n; shardMesh.instanceMatrix.needsUpdate = true;
  updateStandSail(t);
  if (SAIL_STAND && !SAIL_STAND.taken && state === 'play' && hyp2(PL.x - SAIL_STAND.x, PL.z - SAIL_STAND.z) < 1.4 && Math.abs(PL.y + 1 - SAIL_STAND.y) < 2.2) takeSail();
}
function takeSail(){ SAIL_STAND.taken = true; if (!hasItem(SAIL)) invAdd(SAIL, 1); hasSail = true; SND.sail(); sparkle(SAIL_STAND.x, SAIL_STAND.y, SAIL_STAND.z, 12, 1, .85, .5); toastCard('Sky sail', TOUCH ? 'Jump, then tap Jump again in mid-air to open it. Tap Jump again to close. Updrafts lift you.' : 'Jump, then press Space again in mid-air to open it. Steer with the mouse, look down to dive. Space or Shift closes it. Updrafts lift you.'); tut('sail'); saveDirty = true; }
function collectShard(s){
  found.add(s.i); SND.shard(); sparkle(s.x, s.y, s.z, 16, .8, .9, 1); PL.punch = Math.max(PL.punch, .4);
  toastCard('Sky relic ' + found.size + ' of ' + SHARDS.length, s.text, 6000);
  tut('shard'); renderJournalSoon(); saveDirty = true;
  if (found.size === SHARDS.length) startFestival();
  updateSailLevel(true);
}
// shards upgrade the sail: 3 for a longer glide, 6 for a wing-flap boost
function updateSailLevel(announce){
  const lv = found.size >= 6 ? 2 : found.size >= 3 ? 1 : 0; if (lv === sailLevel) return;
  sailLevel = lv; if (!announce) return;
  SND.reward(); if (lv === 1) toastCard('Sail upgrade: Long glide', 'Three relics stitched in. You sink slower and keep speed longer.', 7000);
  else toastCard('Sail upgrade: Boost flap', 'Six relics. Press ' + (TOUCH ? 'Jump' : 'Space') + ' mid-glide to flap upward, three times per flight.', 7000);
}
/* ================= ring course: thread six rings in order before the timer runs out ================= */
const RC = { next: 0, t: 0, done: false, flash: new Float32Array(8), best: 0, lx: 0, lz: 0 };
const RC_LIMIT = 11;
let ringMesh = null;
function buildRings(){
  const g = new THREE.TorusGeometry(1, .1, 6, 32);
  const col = new Float32Array(g.attributes.position.count * 3).fill(1); g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  ringMesh = instMesh(g, litMat({ emis: 1, rim: .4 }), RINGS.length);
}
function ringFail(msg){ RC.next = 0; RC.t = 0; SND.deny(); toast(msg); chipRing(); }
function stepRings(dt){
  if (!RINGS.length || state !== 'play') return;
  for (let i = 0; i < RINGS.length; i++) RC.flash[i] = Math.max(0, RC.flash[i] - dt * 1.6);
  if (RC.next > 0 && RC.next < RINGS.length){ RC.t += dt; const tl = Math.max(0, RC_LIMIT - RC.t).toFixed(1); if (tl !== RC.tl){ RC.tl = tl; $('#ringT').textContent = tl; } if (RC.t > RC_LIMIT) ringFail('Out of time. The first ring is waiting.'); else if (PL.onGround && RC.t > 1) ringFail('Landed. Ride the updraft and try again.'); }
  const k = RC.next >= RINGS.length ? -1 : RC.next; if (k < 0) return;
  const r = RINGS[k], dx = PL.x - r.x, dy = PL.y + .9 - r.y, dz = PL.z - r.z, along = dx * r.nx + dz * r.nz;
  const pxp = (RC.lx - r.x) * r.nx + (RC.lz - r.z) * r.nz; RC.lx = PL.x; RC.lz = PL.z;
  if (pxp < 0 && along >= 0){ const lat = -dx * r.nz + dz * r.nx; if (lat * lat + dy * dy < r.r * r.r){
    RC.flash[k] = 1; RC.next++; SND.ring(RC.next); sparkle(r.x, r.y, r.z, 10, 1, .86, .45); if (PL.gliding) glideBoost(1.5);
    if (RC.next >= RINGS.length){ const first = !RC.done; RC.done = true; RC.best = RC.best ? Math.min(RC.best, RC.t) : RC.t; SND.reward(); toastCard('Ring course clear', (first ? 'A relic has appeared on Basin Isle. ' : '') + 'Time ' + RC.t.toFixed(1) + 's, best ' + RC.best.toFixed(1) + 's.', 6000); RC.next = 0; RC.t = 0; saveDirty = true; renderJournalSoon(); }
    chipRing();
  } }
}
function chipRing(){ const el = $('#ringchip'); if (!el) return; const on = RC.next > 0 && RC.next < RINGS.length; el.hidden = !on; if (on) el.firstChild.textContent = 'Ring ' + RC.next + '/' + RINGS.length + '  '; }
function updateRings(t){
  if (!ringMesh) return;
  for (let i = 0; i < RINGS.length; i++){
    const r = RINGS[i], isNext = i === RC.next && !(RC.next === 0 && hyp2(PL.x - r.x, PL.z - r.z) > 60), passed = i < RC.next, f = RC.flash[i];
    const pulse = isNext ? 1 + Math.sin(t * 5) * .06 : 1, sc = r.r * (pulse + f * .35);
    _m0.makeRotationY(Math.atan2(r.nx, r.nz)); _m0.scale(_sv.set(sc, sc, sc)); _m0.setPosition(r.x, r.y, r.z); ringMesh.setMatrixAt(i, _m0);
    if (isNext) _col.setRGB(1.25, .95, .45); else if (passed) _col.setRGB(.45, .95, .85); else _col.setRGB(.8, .82, .9);
    if (f > 0) _col.lerp(_c1.setRGB(1.6, 1.5, 1.2), f); ringMesh.setColorAt(i, _col);
  }
  ringMesh.instanceMatrix.needsUpdate = true; ringMesh.instanceColor.needsUpdate = true;
}
const _c1 = glOK ? new THREE.Color() : null;
/* ================= Eden's context cubes: small lit blocks orbiting the tree, bobbing out of phase ================= */
let cubeMesh = null;
function buildCubes(){
  const g = new THREE.BoxGeometry(1, 1, 1); const col = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < col.length; i += 3){ const k = (i / 3) % 4 < 2 ? 1 : .8; col[i] = .7 * k; col[i + 1] = .95 * k; col[i + 2] = 1 * k; } g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  cubeMesh = instMesh(g, litMat({ emis: .75, rim: .6 }), CUBES.length);
}
function updateCubes(t){
  if (!cubeMesh || !EDEN_TREE) return;
  if (hyp2(PL.x - EDEN_TREE.x, PL.z - EDEN_TREE.z) > 90){ cubeMesh.visible = false; return; } cubeMesh.visible = true;
  for (let i = 0; i < CUBES.length; i++){ const c = CUBES[i], a = c.a + t * c.sp * (REDUCED ? .3 : 1);
    _eu.set(t * .7 + i, t * .5 + i * 2, 0); _m0.makeRotationFromEuler(_eu); _m0.scale(_sv.set(c.s, c.s, c.s));
    _m0.setPosition(EDEN_TREE.x + Math.cos(a) * c.r, c.y + Math.sin(t * 1.3 + i * 1.7) * .35, EDEN_TREE.z + Math.sin(a) * c.r); cubeMesh.setMatrixAt(i, _m0); }
  cubeMesh.instanceMatrix.needsUpdate = true;
}
/* ================= sail stand banners: two pennants that ripple in the same wind as the foliage ================= */
let bannerMesh = null, bannerGeo = null; const BAN = [], BN = 8, BH = 3;
function buildBanners(){
  if (!SAIL_STAND) return;
  const pos = [], col = [], idx = [], poles = [];
  const add = (x, z, y, ph, A, Bc, L) => {
    const base = pos.length / 3;
    for (let j = 0; j <= BH; j++) for (let i = 0; i <= BN; i++){ pos.push(0, 0, 0); const c = i === BN ? [.95, .9, .8] : (j + (i >> 1)) % 2 ? A : Bc; col.push(c[0], c[1], c[2]); }
    for (let j = 0; j < BH; j++) for (let i = 0; i < BN; i++){ const a = base + j * (BN + 1) + i; idx.push(a, a + 1, a + BN + 2, a, a + BN + 2, a + BN + 1); }
    BAN.push({ base, x, z, y, ph, L: L || 1.5 });
  };
  [[-1.3, -1.1], [1.3, -1.1]].forEach((o, b) => {
    const x = SAIL_STAND.x + o[0], z = SAIL_STAND.z + o[1], y0 = SAIL_STAND.y - 1.9;
    add(x, z, y0 + 3.3, b * 1.7, [.88, .66, .25], [.77, .38, .31]); poles.push([x, y0 + 1.75, z, .09, 3.5, .09, [.37, .25, .16]], [x, y0 + 3.55, z, .16, .16, .16, [.91, .77, .42]]);
  });
  // the Wilds threshold: long indigo-and-bone pennants on every buoy
  BUOYS.forEach((b, k) => add(b.x, b.z, b.y, k * .9, [.36, .3, .55], [.86, .82, .74], 2.6));
  bannerGeo = new THREE.BufferGeometry(); bannerGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); bannerGeo.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3)); bannerGeo.setIndex(idx); bannerGeo.computeVertexNormals();
  bannerGeo.attributes.position.setUsage(THREE.DynamicDrawUsage);
  bannerMesh = new THREE.Mesh(bannerGeo, litMat({ rim: .3, side: THREE.DoubleSide })); bannerMesh.frustumCulled = false; scene.add(bannerMesh);
  const pm = new THREE.Mesh(boxGeo(poles), litMat({ rim: .2 })); scene.add(pm);
}
function updateBanners(t){
  if (!bannerMesh) return;
  const P = bannerGeo.attributes.position.array, wx = .78, wz = .62, amp = REDUCED ? .35 : 1;
  for (const b of BAN){
    if (Math.abs(b.x - camera.position.x) > 110 || Math.abs(b.z - camera.position.z) > 110) continue;
    const gust = Math.pow(Math.max(0, Math.sin((b.x * wx + b.z * wz) * .045 - t * .33)), 6);
    for (let j = 0; j <= BH; j++) for (let i = 0; i <= BN; i++){
      const u = i / BN, v = j / BH, k = (b.base + j * (BN + 1) + i) * 3, L = u * b.L, w = (Math.sin(t * 5.2 + b.ph - u * 5 + v * .8) * .16 + Math.sin(t * 9 - u * 9) * .04) * u * amp * (1 + gust * 1.5);
      P[k] = b.x + wx * L - wz * w; P[k + 1] = b.y - v * (.62 - u * .2) - u * u * .18 * (1 - gust); P[k + 2] = b.z + wz * L + wx * w;
    }
  }
  bannerGeo.attributes.position.needsUpdate = true; bannerGeo.computeVertexNormals();
}
/* ================= regrowth: picked flowers, felled trees and stripped leaves quietly come back ================= */
const REGROW = [];
const REGROWS = new Uint8Array(NB); [LOG, LEAVES, BLOSSOM, TGRASS, ROSE, SUNF, BELL].forEach(id => REGROWS[id] = 1);
function queueRegrow(x, y, z){ const k = wi(x, y, z), b = baseAt(k); if (!b || !REGROWS[b]) return; REGROW.push({ x, y, z, id: b, t: 60 + Math.random() * 60 }); }
let regrowT = 0;
function stepRegrow(dt){
  regrowT -= dt; if (regrowT > 0 || !REGROW.length) return; regrowT = 1;
  for (let i = REGROW.length - 1; i >= 0; i--){ const g = REGROW[i]; g.t -= 1; if (g.t > 0) continue;
    if (Math.abs(PL.x - g.x - .5) < 9 && Math.abs(PL.z - g.z - .5) < 9) { g.t = 4; continue; }
    if (getB(g.x, g.y, g.z) === 0 && (B_RT[g.id] !== 3 || B_SOLID[getB(g.x, g.y - 1, g.z)])){ setBlock(g.x, g.y, g.z, g.id); popBlock(g.x, g.y, g.z, g.id, true); }
    REGROW.splice(i, 1);
  }
}
function activateWaystone(id){ lastWay = id; if (ways.has(id)) return; ways.add(id); SND.waystone(); const s = SIGNS.find(q => q.id === id); if (s) sparkle(s.x + .5, s.y + 6.5, s.z + .5, 14, 1, .85, .5); renderJournalSoon(); saveDirty = true; }
let lanterns = null; const LAN = [];
function startFestival(){
  festival = 45; goldSail = true; saveDirty = true;
  toastCard('The sky festival', 'Every shard found. The islands light lanterns for you, and your sail turns gold.', 9000);
  if (!lanterns){
    const g = boxGeo([[0, 0, 0, .5, .62, .5, [1, .72, .38]], [0, .36, 0, .32, .1, .32, [.55, .3, .2]]]);
    lanterns = instMesh(g, litMat({ emis: 1, rim: .2 }), 64);
    for (let i = 0; i < 64; i++){ const I = ISL[0], a = rnd() * 6.283, r = rnd() * I.r; LAN.push({ x: I.x + Math.cos(a) * r, y: I.top + 2 + rnd() * 4, z: I.z + Math.sin(a) * r, v: 1.2 + rnd() * 1.4, ph: rnd() * 6 }); }
  }
  LAN.forEach(l => { l.y = ISL[0].top + 1 + rnd() * 6; });
  lanterns.visible = true;
}
function updateFestival(dt, t){
  if (!lanterns || festival <= 0){ if (lanterns) lanterns.visible = false; return; }
  festival -= dt;
  for (let i = 0; i < LAN.length; i++){ const l = LAN[i]; l.y += l.v * dt; _m0.makeRotationY(t * .4 + l.ph); _m0.setPosition(l.x + Math.sin(t * .6 + l.ph) * .8, l.y, l.z + Math.cos(t * .5 + l.ph) * .8); lanterns.setMatrixAt(i, _m0); }
  lanterns.instanceMatrix.needsUpdate = true;
  if (Math.random() < dt * 1.6){ const I = ISL[0], x = I.x + (Math.random() - .5) * 40, y = 62 + Math.random() * 10, z = I.z + (Math.random() - .5) * 20; const c = [[1, .8, .45], [.75, .85, 1], [1, .6, .6], [.8, 1, .75]][Math.floor(Math.random() * 4)]; const n = LOW ? 14 : 26; for (let k = 0; k < n; k++){ const a = Math.random() * 6.283, b = Math.acos(Math.random() * 2 - 1), sp = 7 + Math.random() * 3; emit(x, y, z, Math.sin(b) * Math.cos(a) * sp, Math.cos(b) * sp, Math.sin(b) * Math.sin(a) * sp, c[0], c[1], c[2], .9, 1.4 + Math.random() * .6, 2, 3); } SND.whoosh(); }
}

/* ================= drops: physics, magnet, pickup arc ================= */
const DROPS = []; let dropMesh = null, dropTile = null;
const NDROP = 32;
function dropShader(instanced, ghost){
  return new THREE.ShaderMaterial({ uniforms: Object.assign({ uTileH: { value: 0 }, uTint: { value: new THREE.Color(1, 1, 1) } }, U), depthTest: !!(instanced || ghost), depthWrite: !!(instanced && !ghost), transparent: !instanced,
    vertexShader: `${instanced ? 'attribute float aTile;' : 'uniform float uTileH;'} varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying float vT;
      void main(){ mat4 m = modelMatrix;
        #ifdef USE_INSTANCING
        m = m * instanceMatrix;
        #endif
        vec4 w = m * vec4(position, 1.0); vW = w.xyz; vUv = uv; vN = normalize(mat3(m) * normal); vT = ${instanced ? 'aTile' : 'uTileH'}; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform sampler2D uAtlas; uniform vec3 uTint; ${GL_COMMON} ${ATLAS_FN} varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying float vT;
      void main(){ vec4 t = atlas(vT, vUv); if (t.a < 0.5) discard; vec3 c = litCol(t.rgb, normalize(vN), 1.0, 0.0); float e = 1.0 - smoothstep(0.84, 0.96, t.a); c = mix(c, t.rgb, e * 0.6); ${instanced ? 'c = fogIt(c, vW);' : ''}
        ${ghost ? 'float edge = max(abs(vUv.x - 0.5), abs(vUv.y - 0.5)); gl_FragColor = vec4(grade(c) * uTint, edge > 0.44 ? 0.85 : 0.38);' : 'gl_FragColor = vec4(grade(c), 1.0);'} }` });
}
function buildDrops(){
  const g = new THREE.BoxGeometry(.28, .28, .28);
  dropTile = new THREE.InstancedBufferAttribute(new Float32Array(NDROP), 1); dropTile.setUsage(THREE.DynamicDrawUsage); g.setAttribute('aTile', dropTile);
  dropMesh = new THREE.InstancedMesh(g, dropShader(true), NDROP); dropMesh.count = 0; dropMesh.frustumCulled = false; scene.add(dropMesh);
  for (let i = 0; i < NDROP; i++) DROPS.push({ on: false, id: 0, n: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, mag: -1, sx: 0, sy: 0, sz: 0, hw: .14, h: .28, stepOff: 0, sd: 0.5, md: 0.5 });
}
function spawnDrop(id, x, y, z, w, n){
  let d = null; for (const q of DROPS) if (!q.on){ d = q; break; }
  if (!d){ d = DROPS[0]; for (const q of DROPS) if (q.age > d.age) d = q; }
  d.on = true; d.id = id; d.n = n || 1; d.w = w || null; d.bk = null; d.x = x; d.y = y - .14; d.z = z; d.vx = (Math.random() - .5) * 2.4; d.vy = 3.5; d.vz = (Math.random() - .5) * 2.4; d.age = 0; d.mag = -1;
  return d;
}
let pickPitch = 0, pickPitchT = 0;
function stepDrops(dt, t){
  let n = 0, ng = 0; for (const k in SPRITE_DROPS) SPRITE_DROPS[k].count = 0;
  pickPitchT -= dt; if (pickPitchT <= 0) pickPitch = 0;
  for (let i = 0; i < DROPS.length; i++){
    const d = DROPS[i]; if (!d.on) continue;
    d.age += dt;
    const ex = PL.x, ey = PL.y + 1.1, ez = PL.z;
    if (d.mag >= 0){
      // pickup arc: quadratic bezier from the start point, over a raised control point, into the chest
      d.mag += dt / .22; const u = Math.min(1, d.mag), a = 1 - u;
      const cx = (d.sx + ex) / 2, cy = Math.max(d.sy, ey) + 1, cz = (d.sz + ez) / 2;
      d.x = a * a * d.sx + 2 * a * u * cx + u * u * ex; d.y = a * a * d.sy + 2 * a * u * cy + u * u * ey; d.z = a * a * d.sz + 2 * a * u * cz + u * u * ez;
      if (u >= 1){ const left = d.bk ? invAddBook(d.bk) : invAdd(d.id, d.n, d.w); if (left < d.n){ SND.pickup(pickPitch); pickPitch = Math.min(pickPitch + 1, 8); pickPitchT = .6; } if (!left){ d.on = false; continue; } d.n = left; d.mag = -1; d.vx = d.vz = 0; d.vy = 2; if (t - fullWarned > 4){ fullWarned = t; toast('Satchel full'); } }
    } else {
      d.vy -= 22 * dt; if (d.vy < -20) d.vy = -20;
      if ((d.sd = d.vy * dt, sweepAxis(d, 1))){ d.vy = d.vy < -2 ? -d.vy * .3 : 0; d.vx *= .6; d.vz *= .6; }
      if ((d.sd = d.vx * dt, sweepAxis(d, 0))) d.vx *= -.3; if ((d.sd = d.vz * dt, sweepAxis(d, 2))) d.vz *= -.3;
      const ddx = ex - d.x, ddy = ey - d.y, ddz = ez - d.z;
      if (d.age > .4 + (d.w && d.w.r >= 2 ? .5 : 0) && state === 'play' && !PL.catching && ddx * ddx + ddy * ddy + ddz * ddz < 12){ d.mag = 0; d.sx = d.x; d.sy = d.y; d.sz = d.z; }
      if (d.y < -10 || d.age > 300) d.on = false;
    }
    const s = d.mag >= 0 ? 1 - d.mag * .5 : 1, hy = d.y + .14 + (d.mag < 0 ? Math.sin(d.age * 3) * .05 + .05 : 0);
    if (d.id < 100 && B_RT[d.id] !== 3){ _m0.makeRotationY(d.age * 2.4); _m0.scale(_sv.set(s, s, s)); _m0.setPosition(d.x, hy, d.z); dropMesh.setMatrixAt(n, _m0); dropTile.array[n] = B_TILES[d.id * 6]; n++; }
    else { const m = spriteDropMesh(d.id, d.w), k = m.count; if (k < 24){ const sc = (d.w ? .62 : .46) * s; _m0.makeRotationY(d.age * 2.1); _m0.scale(_sv.set(sc, sc, sc)); _m0.setPosition(d.x, hy + .1, d.z); m.setMatrixAt(k, _m0); m.count = k + 1; } }
    if (d.w && d.w.r >= 2 && chestGlow && ng < 64){ const R = RARITY[d.w.r], L = d.w.r >= 4, hgt = L ? 10 : 1.5, wd = L ? .55 : .7; _m0.makeRotationY(Math.atan2(camera.position.x - d.x, camera.position.z - d.z)); _m0.scale(_sv.set(wd, hgt, 1)); _m0.setPosition(d.x, d.y + hgt / 2 - .1, d.z); chestGlow.setMatrixAt(ng, _m0); _col.setRGB(R.k[0], R.k[1], R.k[2]); chestGlow.setColorAt(ng, _col); ng++;
      if (L && Math.random() < .3) emit(d.x + (Math.random() - .5) * .4, d.y + .3, d.z + (Math.random() - .5) * .4, 0, 1.5 + Math.random(), 0, 1, .8, .4, .16, 1.4, 2, -.3); }
  }
  dropMesh.count = n; dropMesh.instanceMatrix.needsUpdate = true; dropTile.needsUpdate = true;
  for (const k in SPRITE_DROPS){ const m = SPRITE_DROPS[k]; m.visible = m.count > 0; if (m.count) m.instanceMatrix.needsUpdate = true; }
  if (chestGlow){ chestGlow.count = ng; chestGlow.visible = ng > 0; if (ng){ chestGlow.instanceMatrix.needsUpdate = true; chestGlow.instanceColor.needsUpdate = true; } }
}
let fullWarned = -9;

/* ================= hand, ghost preview, outline, crack, avatar, sail canopy ================= */
let hand = null, handIcon = null, handMat = null, outline = null, crack = null, crackTex = null, ghost = null, ghostMat = null, avatar = null, canopy = null, vineTip = null;
function buildHand(){
  buildHandPass(); buildSailModels(); canopy = sailRig.grp;
  vineTip = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), dropShader(false, true)); vineTip.material.uniforms.uTileH.value = T.vine; vineTip.visible = false; scene.add(vineTip);
}

let pop = null, popT = 9, popPlace = true;
function popBlock(x, y, z, id, place){ if (!pop) return; popT = 0; popPlace = place; pop.position.set(x + .5, y + .5, z + .5); pop.material.uniforms.uTileH.value = B_RT[id] === 3 ? B_TILES[id * 6 + 2] : B_TILES[id * 6]; pop.visible = B_RT[id] !== 3; }
function updatePop(dt){ if (!pop || !pop.visible) return; popT += dt; const d = popPlace ? .2 : .13; if (popT >= d){ pop.visible = false; return; } const u = popT / d; const s = popPlace ? .72 + EZ.outBack(u) * .3 : 1.01 - EZ.inQuad(u) * .8; pop.scale.setScalar(s); }
function buildOutline(){
  { const m = dropShader(false); m.depthTest = true; m.depthWrite = true; m.transparent = false; pop = new THREE.Mesh(new THREE.BoxGeometry(1.002, 1.002, 1.002), m); pop.visible = false; scene.add(pop); }
  // 12 thin bars around a unit cube: crisp 2px-feel outline that reads at any angle
  const T_ = .022, L = 1.012, h = L / 2, bars = [];
  for (const a of [-h, h]) for (const b of [-h, h]){ bars.push([0, a, b, L + T_, T_, T_, [.09, .08, .1]], [a, 0, b, T_, L + T_, T_, [.09, .08, .1]], [a, b, 0, T_, T_, L + T_, [.09, .08, .1]]); }
  outline = new THREE.Mesh(boxGeo(bars), new THREE.MeshBasicMaterial({ color: 0x17151a, transparent: true, opacity: .8, depthWrite: false })); outline.visible = false; outline.renderOrder = 7; scene.add(outline);
  const cv = D.createElement('canvas'); cv.width = 128; cv.height = 16; const g = cv.getContext('2d');
  const segs = []; let sx = 8, sy = 8; const r0 = rs; rs = 99;
  for (let i = 0; i < 40; i++){ if (i % 5 === 0){ sx = 8; sy = 8; } const nx = clamp(sx + Math.round((rnd() - .5) * 6), 0, 15), ny = clamp(sy + Math.round((rnd() - .5) * 6), 0, 15); segs.push([sx, sy, nx, ny]); sx = nx; sy = ny; }
  rs = r0;
  for (let s = 0; s < 8; s++){ g.fillStyle = 'rgba(14,13,17,.85)'; const k = Math.floor((s + 1) / 8 * segs.length); for (let i = 0; i < k; i++){ const q = segs[i]; const n = Math.max(Math.abs(q[2] - q[0]), Math.abs(q[3] - q[1])) || 1; for (let j = 0; j <= n; j++) g.fillRect(s * 16 + Math.round(q[0] + (q[2] - q[0]) * j / n), Math.round(q[1] + (q[3] - q[1]) * j / n), 1, 1); } }
  crackTex = new THREE.CanvasTexture(cv); crackTex.magFilter = THREE.NearestFilter; crackTex.minFilter = THREE.NearestFilter; crackTex.generateMipmaps = false; crackTex.repeat.set(1 / 8, 1);
  crack = new THREE.Mesh(new THREE.BoxGeometry(1.006, 1.006, 1.006), new THREE.MeshBasicMaterial({ map: crackTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  crack.visible = false; scene.add(crack);
  ghostMat = dropShader(false, true);
  ghost = new THREE.Mesh(new THREE.BoxGeometry(.96, .96, .96), ghostMat); ghost.visible = false; ghost.renderOrder = 8; scene.add(ghost);
}
let third = false;
function buildAvatar(){
  const mat = litMat({ rim: .25 });
  const skin = [.72, .53, .41], hair = [.16, .12, .11], sweater = [.38, .52, .5], scarf = [.7, .38, .32], pants = [.23, .25, .32], shoe = [.35, .24, .18];
  avatar = new THREE.Group();
  const head = new THREE.Mesh(boxGeo([[0, .25, 0, .5, .5, .5, skin], [0, .52, .02, .54, .12, .54, hair], [0, .32, .22, .54, .4, .12, hair], [-.12, .26, -.252, .08, .08, .02, [.08, .06, .06]], [.12, .26, -.252, .08, .08, .02, [.08, .06, .06]]]), mat);
  head.position.y = 1.42;
  const body = new THREE.Mesh(boxGeo([[0, 1.06, 0, .5, .7, .28, sweater], [0, 1.37, -.02, .54, .12, .34, scarf], [.1, 1.2, -.16, .12, .3, .04, scarf]]), mat);
  const limb = (c, c2, w) => boxGeo([[0, -.31, 0, w, .62, .24, c], [0, -.6, -.02, w + .02, .1, .28, c2]]);
  const armL = new THREE.Mesh(limb(sweater, skin, .2), mat), armR = new THREE.Mesh(limb(sweater, skin, .2), mat);
  armL.position.set(-.36, 1.38, 0); armR.position.set(.36, 1.38, 0);
  const legL = new THREE.Mesh(limb(pants, shoe, .23), mat), legR = new THREE.Mesh(limb(pants, shoe, .23), mat);
  legL.position.set(-.13, .7, 0); legR.position.set(.13, .7, 0);
  avatar.rotation.order = 'YXZ'; // yaw, then lean/pitch about the body's own axes
  avatar.add(head, body, armL, armR, legL, legR); avatar.userData = { head, armL, armR, legL, legR };
  avatar.visible = false; scene.add(avatar);
}
function setThird(v){ third = v; $('#vView').textContent = third ? 'Third person' : 'First person'; updateHand(); saveDirty = true; }
