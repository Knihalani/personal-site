
/* =====================================================================
   GEAR: the sky sail and the grappling hook are equipment, not hotbar items.
   - The sail is gifted by the Memory Engine when the story ends (or is skipped).
   - The grappling hook rests in the Sky Vault, the deepest guarded ruin in the Wilds; an empty rack by the
     plaza and the journal tease it.
   GRAPPLE: F (or right click with nothing placeable, or the Hook touch button) fires a rope at a solid island
   block within 28. It reels in with momentum, then hangs as a pendulum: hold Space to shorten the rope, steer
   to pump the swing, press F again to let go with a fling (open the sail straight after for a long chain).
   It never anchors to creatures, enemies, buoys or loose debris (only island terrain and buildings).
   ===================================================================== */
const GEAR = { sail: false, grapple: false };
const GR_RANGE = 28, GR_SPEED = 78;
const GR = { st: 0, ax: 0, ay: 0, az: 0, hx: 0, hy: 0, hz: 0, dx: 0, dy: 0, dz: 0, travel: 0, dist: 0, L: 0, pull: 0, valid: false, creakT: 0, slackT: 0, fireT: 9, reelT: 0, aim: { ok: false, t: 0 }, aimT: 0, hintT: 0, rope: null, head: null, kicks: 0, uses: 0, swings: 0 };
const GRHIT = { ok: false };
function grappleAnchorOK(x, y, z){
  const id = getB(x, y, z); if (!id || !B_SOLID[id] || id === WATER) return false;
  if (islandIndexAt(x + .5, z + .5) < 0) return false; // only island terrain and buildings, never buoys or drifting debris
  for (const b of BUOYS) if (Math.abs(b.x - x - .5) < 3 && Math.abs(b.z - z - .5) < 3) return false;
  return true;
}
// a creature or enemy in the way blocks the hook
function grappleBlockedByCreature(ox, oy, oz, dx, dy, dz, maxT){
  const test = (x, y, z, r) => { const px = x - ox, py = y - oy, pz = z - oz, t = px * dx + py * dy + pz * dz; if (t < 0 || t > maxT) return false; const qx = px - dx * t, qy = py - dy * t, qz = pz - dz * t; return qx * qx + qy * qy + qz * qz < r * r; };
  for (const m of MOBS) if (test(m.x, m.y + m.h * .5, m.z, Math.max(.6, m.hw + .3))) return true;
  for (const e of ENEMIES) if (e.st !== ES.DEAD && e.active && test(e.x, e.y + e.h * .5, e.z, e.hw + .35)) return true;
  return false;
}
function grappleAim(){
  const f = fwd(); const hit = raycast(EYE.x, EYE.y, EYE.z, f.x, f.y, f.z, GR_RANGE, GRHIT, true);
  GR.aim.ok = hit && grappleAnchorOK(GRHIT.x, GRHIT.y, GRHIT.z) && !grappleBlockedByCreature(EYE.x, EYE.y, EYE.z, f.x, f.y, f.z, GRHIT.t);
  GR.aim.t = hit ? GRHIT.t : GR_RANGE; GR.aim.x = GRHIT.x; GR.aim.y = GRHIT.y; GR.aim.z = GRHIT.z; GR.aim.nx = GRHIT.nx; GR.aim.ny = GRHIT.ny; GR.aim.nz = GRHIT.nz;
  return GR.aim.ok;
}
function grappleAction(){
  if (state !== 'play' || PL.catching || (typeof CINE !== 'undefined' && CINE.on) || dead) return false;
  if (!GEAR.grapple){ if (performance.now() - GR.hintT > 4000){ GR.hintT = performance.now(); toast('No grappling hook yet. The rack by the plaza is empty; it rests in a Sky Vault in the Wilds'); SND.deny(); } return false; }
  if (GR.st === 1 || GR.st === 2){ grappleRelease(true); return true; }
  if (GR.st === 3) return false;
  const f = fwd(); grappleAim(); GR.valid = GR.aim.ok;
  GR.dx = f.x; GR.dy = f.y; GR.dz = f.z; GR.travel = 0; GR.dist = GR.aim.t;
  if (GR.valid){ GR.ax = EYE.x + f.x * GR.aim.t; GR.ay = EYE.y + f.y * GR.aim.t; GR.az = EYE.z + f.z * GR.aim.t; GR.bx = GR.aim.x; GR.by = GR.aim.y; GR.bz = GR.aim.z; }
  const s = ropeStart(); GR.hx = s.x; GR.hy = s.y; GR.hz = s.z; GR.st = 1; GR.fireT = 0; GR.uses++; SND.grappleFire(); PL.punch = Math.max(PL.punch, .25); camKick = Math.max(camKick, .03);
  return true;
}
function grappleRelease(fling){
  const P = PL;
  if (GR.st === 2 && fling && !P.onGround){ const k = 1.12; P.vx *= k; P.vz *= k; P.vy = Math.max(P.vy, 0) * 1.08 + 3.2; P.air = Math.max(P.air, .2); P.airDash = true; P.punch = Math.max(P.punch, .7); SND.whoosh(); GR.swings++; }
  if (GR.st) { if (GR.st === 2) SND.grappleRelease(); GR.st = 3; SND.grappleReel(); }
}
// the rope leaves the launcher on the right hand (first person) or the avatar's hand (third person)
const _rs = { x: 0, y: 0, z: 0 };
function ropeStart(){ const sy = Math.sin(PL.yaw), cy = Math.cos(PL.yaw), f = fwd();
  if (third){ _rs.x = PL.x + cy * .35; _rs.y = PL.y + 1.25; _rs.z = PL.z - sy * .35; return _rs; }
  _rs.x = EYE.x + cy * .32 + f.x * .55; _rs.y = EYE.y - .28 + f.y * .55; _rs.z = EYE.z - sy * .32 + f.z * .55; return _rs; }
// physics: called from stepPlayer before integration (wx, wz: the move wish direction)
function grappleStep(dt, P, wx, wz, mag){
  if (!GR.st) return;
  if (GR.st === 1){ // the hook flies out along the aim, with a little arc
    GR.travel += GR_SPEED * dt; const t = Math.min(GR.travel, GR.dist), arc = Math.sin(Math.min(1, t / Math.max(1, GR.dist)) * Math.PI) * GR.dist * .025;
    GR.hx = EYE.x + GR.dx * t; GR.hy = EYE.y + GR.dy * t + arc; GR.hz = EYE.z + GR.dz * t;
    if (GR.travel >= GR.dist){
      if (GR.valid && grappleAnchorOK(GR.bx, GR.by, GR.bz)){
        GR.st = 2; GR.hx = GR.ax; GR.hy = GR.ay; GR.hz = GR.az; const cx = P.x - GR.ax, cy2 = P.y + .9 - GR.ay, cz = P.z - GR.az; GR.L = Math.hypot(cx, cy2, cz) * .98; GR.pull = .38; GR.slackT = 0;
        SND.grappleThunk(B_SND[getB(GR.bx, GR.by, GR.bz)], GR.ax, GR.ay, GR.az); sparkle(GR.ax, GR.ay, GR.az, 6, .9, .85, .7); dust(GR.ax, GR.ay - .5, GR.az, 4, 1.2); P.sailOpen = false; P.gliding = false;
      } else { GR.st = 3; SND.deny(); }
    }
    return;
  }
  if (GR.st === 3){ const s = ropeStart(), dx = s.x - GR.hx, dy = s.y - GR.hy, dz = s.z - GR.hz, d = Math.hypot(dx, dy, dz), step = 95 * dt; if (d <= step){ GR.st = 0; return; } GR.hx += dx / d * step; GR.hy += dy / d * step; GR.hz += dz / d * step; return; }
  // hooked
  if (!grappleAnchorOK(GR.bx, GR.by, GR.bz)){ grappleRelease(false); return; }
  const cx = P.x - GR.ax, cy = P.y + .9 - GR.ay, cz = P.z - GR.az, d = Math.hypot(cx, cy, cz) || 1e-3, nx = cx / d, ny = cy / d, nz = cz / d;
  if (d > 40){ grappleRelease(false); return; }
  // reel: an automatic yank on attach, then hold Space to shorten the rope
  const reel = GR.pull > 0 || (INP.jump && !P.onGround) || (INP.jump && P.onGround && d > 3);
  if (GR.pull > 0){ GR.pull -= dt; GR.L = Math.max(2.4, GR.L - 15 * dt); P.vx -= nx * 22 * dt; P.vy -= ny * 22 * dt; P.vz -= nz * 22 * dt; }
  else if (reel){ GR.L = Math.max(2.4, GR.L - 10 * dt); P.vx -= nx * 11 * dt; P.vy -= ny * 11 * dt; P.vz -= nz * 11 * dt; }
  GR.reelT = reel ? GR.reelT + dt : 0;
  if (d > GR.L){ // taut: kill outward radial speed and pull back onto the rope circle (a pendulum)
    const vr = P.vx * nx + P.vy * ny + P.vz * nz; if (vr > 0){ P.vx -= vr * nx; P.vy -= vr * ny; P.vz -= vr * nz; }
    const corr = Math.min(10, (d - GR.L) * 8); P.vx -= nx * corr * dt * 8; P.vy -= ny * corr * dt * 8; P.vz -= nz * corr * dt * 8;
    // pumping: steer to push the swing (tangential force in the wish direction)
    if (mag > 0 && !P.onGround){ const t = wx * nx + wz * nz, tx = wx - nx * t, tz = wz - nz * t; P.vx += tx * 7 * dt; P.vz += tz * 7 * dt; }
    const sp = Math.hypot(P.vx, P.vy, P.vz); GR.creakT -= dt; if (sp > 6 && GR.creakT <= 0){ GR.creakT = .55 - Math.min(.3, sp * .01); SND.grappleCreak(sp); }
  }
  const sp = Math.hypot(P.vx, P.vy, P.vz); if (sp > 28){ P.vx *= 28 / sp; P.vy *= 28 / sp; P.vz *= 28 / sp; }
  // walking away on the ground with slack: let the rope go
  if (P.onGround && d < GR.L - .5 && mag > 0){ GR.slackT += dt; if (GR.slackT > .7) grappleRelease(false); } else GR.slackT = 0;
}
// ---- rope and hook head visuals (one line, one small mesh)
function buildGrappleFX(){
  const n = 20, g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  GR.rope = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x8a6a46 })); GR.rope.frustumCulled = false; GR.rope.visible = false; scene.add(GR.rope);
  const M = [.62, .64, .68], D2 = [.32, .33, .38], B = [.7, .52, .3];
  GR.head = new THREE.Mesh(boxGeo([[0, 0, 0, .16, .16, .3, D2], [0, 0, -.2, .1, .1, .12, M], [.12, 0, -.24, .2, .05, .05, M], [-.12, 0, -.24, .2, .05, .05, M], [0, .12, -.24, .05, .2, .05, M], [.2, 0, -.18, .05, .05, .14, M], [-.2, 0, -.18, .05, .05, .14, M], [0, .2, -.18, .05, .14, .05, M], [0, 0, .2, .08, .08, .14, B]]), litMat({ rim: .5 }));
  GR.head.visible = false; scene.add(GR.head);
}
function updateGrappleFX(){
  if (!GR.rope) return; const on = GR.st > 0 && state !== 'cine'; GR.rope.visible = on; GR.head.visible = on; if (!on) return;
  const s = ropeStart(), p = GR.rope.geometry.attributes.position, n = p.count, ex = GR.hx, ey = GR.hy, ez = GR.hz;
  const d = Math.hypot(ex - s.x, ey - s.y, ez - s.z), slack = GR.st === 2 ? clamp((GR.L - d) / Math.max(1, GR.L), 0, 1) : GR.st === 1 ? .06 : .12;
  for (let i = 0; i < n; i++){ const t = i / (n - 1), sag = Math.sin(Math.PI * t) * (slack * d * .35 + .04 * d * (GR.st === 2 ? 0 : 1)); p.setXYZ(i, s.x + (ex - s.x) * t, s.y + (ey - s.y) * t - sag, s.z + (ez - s.z) * t); }
  p.needsUpdate = true;
  GR.head.position.set(ex, ey, ez); GR.head.lookAt(s.x, s.y, s.z);
}
// crosshair indicator: a hook reticle when an anchor is in range
let crossMode = '';
function updateCrosshair(dt){
  let mode = '';
  if (GEAR.grapple && state === 'play' && !PL.catching){ GR.aimT -= dt; if (GR.aimT <= 0){ GR.aimT = .06; grappleAim(); } mode = GR.st === 2 ? 'hooked' : GR.aim.ok ? 'hook' : ''; }
  if (mode !== crossMode){ crossMode = mode; const c = $('#cross'); c.classList.toggle('hook', mode === 'hook'); c.classList.toggle('hooked', mode === 'hooked'); }
}
// ---- wall-kick: Space in the air right after touching a wall pushes you off and up (twice before landing)
function tryWallKick(P){
  if (P.wallT <= 0 || GR.st === 2 || P.inWater || GR.kicks >= 2) return false;
  P.vy = Math.max(P.vy, 9.6); P.vx = P.vx * .35 + P.wallNx * 7.5; P.vz = P.vz * .35 + P.wallNz * 7.5; P.wallT = 0; GR.kicks++; P.jumpBuf = 0;
  P.punch = Math.max(P.punch, .5); SND.vault(); dust(P.x - P.wallNx * .3, P.y + .8, P.z - P.wallNz * .3, 6, 1.4); animPlace(); return true;
}

/* ---- the Memory Engine's gift: when the story ends, the sail assembles from light above the console and settles on your back ---- */
const GIFT = { on: false, t: 0, mesh: null, from: null };
function giftSail(){
  if (GEAR.sail || GIFT.on || !ENGINE) return;
  GIFT.on = true; GIFT.t = 0; GIFT.from = { x: ENGINE.x, y: ENGINE.core, z: ENGINE.z };
  if (!GIFT.mesh){ GIFT.mesh = makeSail(true); scene.add(GIFT.mesh.grp); }
  GIFT.mesh.grp.visible = true; SND.gift(); ENGINE.wake = 1;
}
function updateGift(dt){
  if (!GIFT.on) return; GIFT.t += dt; const g = GIFT.mesh.grp, u = Math.min(1, GIFT.t / 2.4), e = u * u * (3 - 2 * u);
  const tx = PL.x - Math.sin(PL.yaw) * 1.8, ty = PL.y + 1.6, tz = PL.z - Math.cos(PL.yaw) * 1.8;
  const ox = GIFT.from.x, oy = GIFT.from.y, oz = GIFT.from.z, lift = Math.sin(Math.PI * e) * 3;
  g.position.set(ox + (tx - ox) * e, oy + (ty - oy) * e + lift, oz + (tz - oz) * e); g.rotation.set(0, PL.yaw + (1 - e) * 6, 0);
  const s = .2 + .8 * Math.min(1, u * 1.6); g.scale.setScalar(s * (u > .85 ? 1 - (u - .85) / .15 * .7 : 1)); poseSail(GIFT.mesh, Math.min(1, u * 1.5), 0, tAcc, false);
  if (Math.random() < .5) sparkle(g.position.x, g.position.y, g.position.z, 1, .9, .95, 1);
  if (u >= 1){ GIFT.on = false; g.visible = false; GEAR.sail = true; hasSail = true; SND.reward(); PL.punch = 1; gearChanged();
    toastCard('The Memory Engine gifts you the sky sail', TOUCH ? 'Jump, then tap Jump again in the air to open it. Ride the shimmering updrafts out to the islets.' : 'Jump, then press Space again in the air to open it. Ride the shimmering updrafts out to the islets.', 7000);
    tut('story'); tutShow(); saveDirty = true; }
}
function grantGrapple(){
  if (GEAR.grapple) return; GEAR.grapple = true; gearChanged(); SND.legendary(); PL.punch = 1.2;
  toastCard('Grappling hook', (TOUCH ? 'Tap Hook' : 'Press F (or right click)') + ' to fire at rock within 28 blocks. Hold ' + (TOUCH ? 'Jump' : 'Space') + ' to reel in, steer to swing, fire again to let go and fling. Open the sail straight after.', 9000);
  saveDirty = true; renderJournalSoon();
}
function gearChanged(){ hasSail = GEAR.sail; if (typeof tutShow === 'function') tutShow(); const th = $('#tHook'); if (th) th.hidden = !GEAR.grapple; if (state === 'inv') renderInv(); renderGear(); updateHookRack(); }
function renderGear(){
  const box = $('#gearSlots'); if (!box) return;
  box.innerHTML = '';
  [['sail', 'Sky sail', GEAR.sail, 'After the story'], ['grapple', 'Grappling hook', GEAR.grapple, 'In a Sky Vault, deep in the Wilds']].forEach(([k, nm, on, lock]) => {
    const d = D.createElement('div'); d.className = 'gear' + (on ? ' on' : ''); d.innerHTML = '<span class="gi f-slot"></span><span class="gt"><b></b><em></em></span>';
    d.querySelector('.gi').style.backgroundImage = 'url(' + gearIconURL(k, on) + ')'; d.querySelector('b').textContent = nm; d.querySelector('em').textContent = on ? 'Equipped' : lock; box.appendChild(d); });
}
// vistas: stand on a summit to log it in the journal
const vistas = new Set(); let vistaT = 0;
function updateVistas(dt){ vistaT -= dt; if (vistaT > 0) return; vistaT = .5; VISTAS.forEach((v, i) => { if (vistas.has(i)) return; if (Math.abs(PL.x - v.x) < 3 && Math.abs(PL.z - v.z) < 3 && Math.abs(PL.y - v.y) < 3.5 && PL.onGround){ vistas.add(i); toastCard('Vista', v.name + ' · ' + vistas.size + '/' + VISTAS.length, 4500); SND.shard(); renderJournalSoon(); saveDirty = true; } }); }
// the hook rack shows the hook once you own it
let rackMesh = null;
function updateHookRack(){ if (!HOOK_RACK) return; if (!rackMesh){ rackMesh = buildHookModel(); rackMesh.position.set(HOOK_RACK.x, HOOK_RACK.y, HOOK_RACK.z); rackMesh.rotation.set(0, 0, Math.PI / 2); rackMesh.scale.setScalar(1.4); scene.add(rackMesh); } rackMesh.visible = GEAR.grapple; }
// ---- the grappling hook model: a brass launcher with a coiled rope drum and a three-pronged steel head
function hookGeo(){
  const BR = [.78, .58, .3], BRD = [.55, .38, .2], ST = [.62, .64, .7], STD = [.34, .35, .4], WD = [.42, .28, .18], RP = [.74, .6, .42], RPD = [.56, .44, .3];
  const L = [
    [0, 0, 0, .18, .2, .5, BR], [0, .11, -.05, .12, .04, .36, [.92, .74, .44]], [0, -.02, .3, .14, .16, .12, BRD], // barrel, top highlight, breech
    [0, -.2, .16, .1, .26, .12, WD], [0, -.32, .2, .12, .06, .14, [.3, .2, .13]], // grip and its butt
    [0, -.08, .02, .06, .1, .06, STD], // trigger
    [.13, .02, .1, .08, .22, .22, RP], [.13, .02, .1, .1, .14, .26, RPD], [.13, .02, .1, .1, .26, .14, RPD], // the rope drum, coiled
    [0, 0, -.3, .1, .1, .12, ST], [0, 0, -.42, .06, .06, .12, STD], // collar, shaft
    [.1, 0, -.47, .16, .04, .04, ST], [-.1, 0, -.47, .16, .04, .04, ST], [0, .1, -.47, .04, .16, .04, ST], // prongs
    [.17, 0, -.41, .04, .04, .1, ST], [-.17, 0, -.41, .04, .04, .1, ST], [0, .17, -.41, .04, .1, .04, ST] // barbs
  ];
  return boxGeo(L);
}
function buildHookModel(){ const m = new THREE.Mesh(hookGeo(), litMat({ rim: .55 })); return m; }
const gearIconCache = {};
function gearIconURL_old(k, on){
  const key = k + (on ? 1 : 0); if (gearIconCache[key]) return gearIconCache[key];
  const cv = D.createElement('canvas'); cv.width = cv.height = 16; const g = cv.getContext('2d'); const px = (x, y, c) => { g.fillStyle = c; g.fillRect(x, y, 1, 1); };
  const art = k === 'sail' ? ['................', '..##########....', '.#aabbaabbaa#...', '#aabbaabbaabb#..', '#bbaabbaabbaa#..', '.#.#..#..#..#...', '..#..#...#.#....', '...#.#..#.#.....', '....#.#.#.#.....', '.....#.##.......', '......#cc#......', '......#cc#......', '.......##.......', '................', '................', '................']
                       : ['..........###...', '.........#sss#..', '..........#s#...', '.......#s.#s#...', '......#ss#ss#...', '.....#bbb#s#....', '....#bbbbb#.....', '...#bbrrbb#.....', '..#bbrrrbb#.....', '..#bbbrbb#......', '...#wwbb#.......', '...#ww##........', '....##..........', '................', '................', '................'];
  const C = on ? { '#': '#0e0d11', a: '#e9dcc0', b: '#c96f4a', c: '#8a6a46', s: '#a9b0bc', r: '#c7a679', w: '#6b4a32' } : { '#': '#0e0d11', a: '#6e6878', b: '#57525f', c: '#4a4552', s: '#6e6878', r: '#5c5766', w: '#47424f' };
  C.b = k === 'grapple' ? (on ? '#c49a52' : '#57525f') : C.b;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++){ const ch = art[y][x]; if (ch !== '.') px(x, y, C[ch]); }
  const out = D.createElement('canvas'); out.width = out.height = 32; const o = out.getContext('2d'); o.imageSmoothingEnabled = false; o.drawImage(cv, 0, 0, 32, 32);
  return gearIconCache[key] = out.toDataURL();
}
// gear icons share the item art (folded sail with harness; the hook launcher), greyed out while locked
function gearIconURL(k, on){
  const key = k + (on ? 1 : 0); if (gearIconCache[key]) return gearIconCache[key];
  const S = itemArt(k === 'sail' ? SAIL : 'hook'), px = new Uint8ClampedArray(S.px);
  if (!on) for (let i = 0; i < 256; i++){ if (!px[i * 4 + 3]) continue; const l = (px[i * 4] * .3 + px[i * 4 + 1] * .59 + px[i * 4 + 2] * .11) * .55 + 30; px[i * 4] = l * .95; px[i * 4 + 1] = l * .92; px[i * 4 + 2] = l * 1.05; }
  const o = outlined(px), cv = D.createElement('canvas'); cv.width = cv.height = 16; cv.getContext('2d').putImageData(new ImageData(o, 16, 16), 0, 0);
  const out = D.createElement('canvas'); out.width = out.height = 32; const g = out.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(cv, 0, 0, 32, 32);
  return gearIconCache[key] = out.toDataURL();
}
