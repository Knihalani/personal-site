
/* ================= enemies of the Wilds: five silhouettes, readable telegraphs, leashed to their island ================= */
const ET = { SLIME: 0, GOBLIN: 1, SENTINEL: 2, WISP: 3, ARCHER: 4 };
const ESPEC = [
  { name: 'Bramble slime', hp: 14, hw: .42, h: .8, walk: 1.5, dmg: 2, sight: 9, tele: .55, rec: .65, reach: 1.2, flee: .2 },
  { name: 'Goblin', hp: 22, hw: .3, h: 1.35, walk: 1.8, run: 3.9, dmg: 3, sight: 11, tele: .5, rec: .55, reach: 1.9, flee: .25 },
  { name: 'Crystal sentinel', hp: 46, hw: .5, h: 1.9, walk: 1.2, run: 9.5, dmg: 5, sight: 12, tele: .9, rec: 1.3, reach: 1.3, flee: .15 },
  { name: 'Sky wisp', hp: 12, hw: .32, h: .7, walk: 2.6, run: 10, dmg: 2, sight: 14, tele: .6, rec: .85, reach: 1.1, fly: true, flee: .3 },
  { name: 'Goblin archer', hp: 16, hw: .3, h: 1.3, walk: 1.8, run: 3.2, dmg: 2.5, sight: 17, tele: .75, rec: .6, reach: 12, flee: .3 }
];
const ES = { IDLE: 0, NOTICE: 1, CHASE: 2, TELE: 3, ATK: 4, REC: 5, FLEE: 6, RETURN: 7, DEAD: 8 };
const ENEMIES = [];
const E_DT = 1 / 30; let eAcc = 0;
function spawnEnemiesFor(I, r){ r.spawns.forEach((s, j) => ENEMIES.push(mkEnemy(I, s, j))); }
function mkEnemy(I, s, j){
  const S = ESPEC[s.type], k = s.chief ? 1.45 : 1;
  return { t: s.type, I, isle: OUT_ISL0 + I.k, j, x: s.x, y: s.y + (S.fly ? 3 : 0), z: s.z, px: s.x, py: s.y, pz: s.z, vx: 0, vy: 0, vz: 0, hw: S.hw * k, h: S.h * k, onGround: false, sd: .5, md: .5, stepOff: 0,
    yaw: Math.random() * 6.28, pyaw: 0, hp: S.hp * (s.chief ? 5 : 1), maxhp: S.hp * (s.chief ? 5 : 1), st: ES.IDLE, timer: Math.random() * 2, home: { x: s.x, y: s.y, z: s.z }, guard: s.guard, chief: !!s.chief, sc: s.chief ? k : 0, mod: s.mod || '',
    path: new Int16Array(120), pathLen: 0, pathI: 0, goalErr: 0, replan: 0, stuck: 0, lastD: 0, atkX: 0, atkZ: 0, flash: 0, hitT: 0, burn: 0, burnT: 0, notice: 0, deadT: 0, hopT: 0, orbit: Math.random() * 6.28,
    A: { sq: Spr(1), lean: Spr(), arm: Spr(), glow: 0, gait: 0, blink: 1, blinkT: 1 + Math.random() * 3, mark: Spr() }, i: 0, active: false };
}
function enemyTargetOK(e){
  if (PL.catching || dead || state !== 'play') return false;
  if (inSafe(PL.x, PL.z)) return false;
  const pi = outerIsle(PL.x, PL.z); // the player must be over (or right above) this island
  const dh = Math.hypot(PL.x - e.home.x, PL.z - e.home.z);
  return (pi === e.I || dh < e.I.r * 1.25) && dh < e.I.r * 1.7 + 4;
}
function eFace(e, tx, tz, rate, dt){ const ty = Math.atan2(-(tx - e.x), -(tz - e.z)); e.yaw += clamp(angDiff(ty, e.yaw), -rate * dt, rate * dt); }
function eMoveGround(e, dt, ddx, ddz){
  const kk = 1 - Math.exp(-10 * dt);
  e.vx += (ddx - e.vx) * kk; e.vz += (ddz - e.vz) * kk;
  e.vy -= GRAV * dt; if (e.vy < -30) e.vy = -30;
  const ox = e.x, oz = e.z;
  e.onGround = false;
  if ((e.sd = e.vy * dt, sweepAxis(e, 1))){ if (e.vy < 0) e.onGround = true; e.vy = 0; }
  if ((e.md = e.vx * dt, moveHoriz(e, 0, undefined, e.onGround ? 1 : 0))) e.vx *= .2;
  if ((e.md = e.vz * dt, moveHoriz(e, 2, undefined, e.onGround ? 1 : 0))) e.vz *= .2;
  // the leash is physical: an enemy can never stand on a column that is not its own island (so never in the safe zone)
  const c = Math.floor(e.x) + Math.floor(e.z) * WX;
  if (isl[c] !== e.isle || inSafe(e.x, e.z) || (e.onGround && !supported(e.x, e.y, e.z, .05) && !groundBelow(e.x, e.y, e.z))){ e.x = ox; e.z = oz; e.vx = e.vz = 0; e.pathLen = 0; }
  if (e.y < 4){ e.x = e.px = e.home.x; e.y = e.py = e.home.y + .5; e.z = e.pz = e.home.z; e.vx = e.vy = e.vz = 0; }
}
function eSteer(e, speed){
  let ddx = 0, ddz = 0;
  if (speed > 0 && e.pathI < e.pathLen){
    const wx = e.path[e.pathI * 3] + .5, wz = e.path[e.pathI * 3 + 2] + .5; let ex = wx - e.x, ez = wz - e.z; const ed = hyp2(ex, ez);
    if (ed < .35) e.pathI++; else { ddx = ex / ed * speed; ddz = ez / ed * speed; }
  }
  return [ddx, ddz];
}
function eSet(e, st, t){ if (st === ES.TELE && e.st !== ES.TELE) SND.tele(e.t, e); e.st = st; e.timer = t; e.replan = 0; }
function tickEnemy(e, dt){
  const S = ESPEC[e.t], dx = PL.x - e.x, dz = PL.z - e.z, dist = hyp2(dx, dz) || .001, dy = PL.y - e.y;
  e.timer -= dt; e.replan -= dt; e.flash = Math.max(0, e.flash - dt * 4); e.hitT = Math.max(0, e.hitT - dt);
  if (e.burn > 0){ e.burn -= dt; e.burnT -= dt; if (e.burnT <= 0){ e.burnT = 1; damageEnemy(e, 1, false, 0, 0, true); if (e.st === ES.DEAD) return; } }
  const canSee = enemyTargetOK(e), engaged = e.st >= ES.NOTICE && e.st <= ES.REC;
  if (e.st === ES.DEAD){ e.deadT += dt; return; }
  // leash: lose interest the moment the player leaves the island or reaches the safe zone
  if (engaged && !canSee){ eSet(e, ES.RETURN, 8); e.pathLen = 0; }
  if (!engaged && e.st !== ES.FLEE && e.st !== ES.RETURN && canSee && dist < S.sight && Math.abs(dy) < 8){ eSet(e, ES.NOTICE, .55); e.notice = 1; SND.notice(e.t, e); }
  if (e.st !== ES.FLEE && engaged && e.hp < e.maxhp * S.flee && !e.fled){ e.fled = true; eSet(e, ES.FLEE, 3); }
  let speed = 0, ddx = 0, ddz = 0;
  if (S.fly){ tickWisp(e, dt, S, dx, dz, dist, dy, canSee); return; }
  switch (e.st){
    case ES.IDLE:
      if (e.timer <= 0){ e.timer = 2 + Math.random() * 4; const a = Math.random() * 6.28, r = Math.random() * e.I.r * .5; findPath(e, Math.floor(e.home.x + Math.cos(a) * r), Math.floor(e.y), Math.floor(e.home.z + Math.sin(a) * r), e.isle); }
      speed = e.pathI < e.pathLen ? S.walk * .7 : 0; break;
    case ES.NOTICE: eFace(e, PL.x, PL.z, 9, dt); if (e.timer <= 0) eSet(e, ES.CHASE, 0); break;
    case ES.CHASE: {
      if (e.t === ET.ARCHER){
        const want = dist < 5 ? -1 : dist > 11 ? 1 : 0;
        if (want === 0 && e.timer <= 0){ eSet(e, ES.TELE, S.tele); e.atkX = dx / dist; e.atkZ = dz / dist; break; }
        if (e.replan <= 0){ e.replan = .6; const tx = want < 0 ? e.x - dx / dist * 6 : PL.x, tz = want < 0 ? e.z - dz / dist * 6 : PL.z; findPath(e, Math.floor(tx), Math.floor(e.y), Math.floor(tz), e.isle); }
        speed = want ? S.run : 0; if (!speed) eFace(e, PL.x, PL.z, 8, dt); break;
      }
      const reachT = e.t === ET.SENTINEL ? 8 : e.t === ET.SLIME ? 3.4 : S.reach;
      if (dist < reachT && Math.abs(dy) < 2.2 && e.timer <= 0){ eSet(e, ES.TELE, S.tele); e.atkX = dx / dist; e.atkZ = dz / dist; break; }
      if (e.replan <= 0){ e.replan = .45; findPath(e, Math.floor(PL.x), Math.floor(PL.y + .01), Math.floor(PL.z), e.isle); }
      if (e.t === ET.SLIME){ // slimes travel in hops
        e.hopT -= dt; if (e.onGround && e.hopT <= 0){ e.hopT = .75; const [hx, hz] = eSteer(e, 3.4); if (hx || hz){ e.vy = 6; e.vx = hx; e.vz = hz; } }
        if (!e.onGround){ ddx = e.vx; ddz = e.vz; } speed = -1;
      } else speed = e.t === ET.SENTINEL ? S.walk : S.run;
      break;
    }
    case ES.TELE: // the readable wind-up: everything the player needs to see comes from here
      eFace(e, PL.x, PL.z, e.t === ET.SENTINEL ? 3 : 10, dt);
      if (e.t !== ET.SENTINEL){ e.atkX = dx / dist; e.atkZ = dz / dist; }
      if (e.timer <= 0) startAttack(e, S, dx, dz, dist); break;
    case ES.ATK:
      if (e.t === ET.SENTINEL){ ddx = e.atkX * S.run; ddz = e.atkZ * S.run; speed = -1; if (e.timer <= 0 || (Math.abs(e.vx) + Math.abs(e.vz) < 1 && e.timer < .9)) eSet(e, ES.REC, S.rec); if (dist < S.reach + .4 && Math.abs(dy) < 1.6) hurtPlayer(S.dmg, e.x, e.z, 13, e); }
      else if (e.t === ET.SLIME){ ddx = e.vx; ddz = e.vz; speed = -1; if (dist < S.reach && Math.abs(dy) < 1.4) hurtPlayer(S.dmg, e.x, e.z, 7, e); if (e.onGround && e.timer < .3){ eSet(e, ES.REC, S.rec); e.A.sq.v -= 4; } }
      else if (e.timer <= 0) eSet(e, ES.REC, S.rec);
      break;
    case ES.REC: if (e.timer <= 0) eSet(e, ES.CHASE, .4 + Math.random() * .5); break;
    case ES.FLEE:
      if (e.replan <= 0){ e.replan = .7; findPath(e, Math.floor(e.x - dx / dist * 7), Math.floor(e.y), Math.floor(e.z - dz / dist * 7), e.isle); }
      speed = (S.run || S.walk * 1.6) * 1.05; if (e.timer <= 0) eSet(e, canSee ? ES.CHASE : ES.IDLE, 1); break;
    case ES.RETURN:
      if (e.replan <= 0){ e.replan = 1; findPath(e, Math.floor(e.home.x), Math.floor(e.home.y), Math.floor(e.home.z), e.isle); }
      speed = S.walk * 1.4; e.hp = Math.min(e.maxhp, e.hp + dt * 4);
      if (hyp2(e.home.x - e.x, e.home.z - e.z) < 1.5 || e.timer <= 0){ eSet(e, ES.IDLE, 2); e.fled = false; }
      if (canSee && hyp2(e.home.x - e.x, e.home.z - e.z) < 3 && e.timer < 6 && dist < S.sight * .7) eSet(e, ES.NOTICE, .4);
      break;
  }
  if (speed > 0){ const s = eSteer(e, speed); ddx = s[0]; ddz = s[1]; }
  // knockback impulse (decays inside the velocity blend)
  if (e.kbT > 0){ e.kbT -= dt; ddx = e.vx; ddz = e.vz; }
  eMoveGround(e, dt, ddx, ddz);
  if (e.st !== ES.TELE && e.st !== ES.NOTICE && (Math.abs(e.vx) + Math.abs(e.vz) > .3) && e.kbT <= 0) e.yaw += clamp(angDiff(Math.atan2(-e.vx, -e.vz), e.yaw), -8 * dt, 8 * dt);
}
function startAttack(e, S, dx, dz, dist){
  e.st = ES.ATK;
  if (e.t === ET.SLIME){ const fl = Math.min(dist, 3.6) / .62; e.vx = e.atkX * fl; e.vz = e.atkZ * fl; e.vy = 7.5; e.timer = .9; SND.enemyAtk(0, e); }
  else if (e.t === ET.GOBLIN){ e.timer = .22; SND.enemyAtk(1, e); const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw); const ddx = PL.x - e.x, ddz = PL.z - e.z, d = hyp2(ddx, ddz) || 1;
    if (d < S.reach + .35 && (ddx * fx + ddz * fz) / d > .45 && Math.abs(PL.y - e.y) < 1.6) hurtPlayer(S.dmg, e.x, e.z, 8, e); else dodgeTell(e); }
  else if (e.t === ET.SENTINEL){ e.timer = 1.1; SND.enemyAtk(2, e); }
  else if (e.t === ET.ARCHER){ e.timer = .25; fireArrow(e); SND.enemyAtk(4, e); }
}
function dodgeTell(e){ /* a whiff: tiny dust where the club landed */ dust(e.x - Math.sin(e.yaw) * 1.2, e.y, e.z - Math.cos(e.yaw) * 1.2, 4, 1.2); }
function tickWisp(e, dt, S, dx, dz, dist, dy, canSee){
  const I = e.I; let tx = e.home.x + Math.cos(e.orbit) * I.r * .5, ty = I.top + 6 + Math.sin(e.orbit * 2) * 1.5, tz = e.home.z + Math.sin(e.orbit) * I.r * .5, sp = S.walk;
  e.orbit += dt * .35;
  if (e.st === ES.NOTICE){ if (e.timer <= 0) eSet(e, ES.CHASE, 1.5); tx = e.x; ty = e.y; tz = e.z; }
  else if (e.st === ES.CHASE){ e.orbit += dt * .8; tx = PL.x + Math.cos(e.orbit * 2.2) * 5; tz = PL.z + Math.sin(e.orbit * 2.2) * 5; ty = PL.y + 3.5; sp = 6; if (e.timer <= 0 && dist < 9){ eSet(e, ES.TELE, S.tele); } }
  else if (e.st === ES.TELE){ tx = e.x - dx / dist * .8; tz = e.z - dz / dist * .8; ty = e.y + .6; sp = 2; e.atkX = (PL.x - e.x); e.atkZ = (PL.z - e.z); e.atkY = (PL.y + 1 - e.y); if (e.timer <= 0){ e.st = ES.ATK; e.timer = .55; SND.enemyAtk(3, e); const l = hyp3(e.atkX, e.atkY, e.atkZ) || 1; e.vx = e.atkX / l * S.run; e.vy = e.atkY / l * S.run; e.vz = e.atkZ / l * S.run; } }
  else if (e.st === ES.ATK){ if (hyp3(PL.x - e.x, PL.y + 1 - e.y, PL.z - e.z) < 1.2) hurtPlayer(S.dmg, e.x, e.z, 6, e); if (e.timer <= 0) eSet(e, ES.REC, S.rec); }
  else if (e.st === ES.REC){ ty = e.y + 2; tx = e.x; tz = e.z; sp = 3; if (e.timer <= 0) eSet(e, ES.CHASE, 1.2); }
  else if (e.st === ES.FLEE){ ty = I.top + 12; tx = e.home.x; tz = e.home.z; sp = 5; if (e.timer <= 0) eSet(e, canSee ? ES.CHASE : ES.IDLE, 1); }
  else if (e.st === ES.RETURN){ sp = 4; e.hp = Math.min(e.maxhp, e.hp + dt * 4); if (hyp2(e.home.x - e.x, e.home.z - e.z) < 3 || e.timer <= 0) eSet(e, ES.IDLE, 1); }
  if (e.st !== ES.ATK){
    let ex = tx - e.x, ey = ty - e.y, ez = tz - e.z; const ed = hyp3(ex, ey, ez) || 1, k = sp * clamp(ed / 2, .2, 1);
    const kk = 1 - Math.exp(-3 * dt); e.vx += (ex / ed * k - e.vx) * kk; e.vy += (ey / ed * k - e.vy) * kk; e.vz += (ez / ed * k - e.vz) * kk;
  }
  // hard bounds: inside its island's airspace, never over the safe zone, never inside blocks
  const nx = e.x + e.vx * dt, ny = e.y + e.vy * dt, nz = e.z + e.vz * dt;
  const ok = !inSafe(nx, nz) && Math.hypot(nx - I.x, nz - I.z) < I.r * 1.5 && !solidAt(Math.floor(nx), Math.floor(ny), Math.floor(nz)) && !solidAt(Math.floor(nx), Math.floor(ny + .5), Math.floor(nz));
  if (ok){ e.x = nx; e.y = clamp(ny, 6, 62); e.z = nz; } else { e.vx *= -.4; e.vz *= -.4; e.vy = Math.abs(e.vy) * .5 + .5; if (e.st === ES.ATK) eSet(e, ES.REC, S.rec); }
  if (Math.abs(e.vx) + Math.abs(e.vz) > .2) e.yaw += clamp(angDiff(Math.atan2(-e.vx, -e.vz), e.yaw), -6 * dt, 6 * dt);
}
function stepEnemies(dt){
  eAcc += dt; if (eAcc < E_DT) return; eAcc -= E_DT; if (eAcc > E_DT * 3) eAcc = 0;
  const now = performance.now();
  for (const e of ENEMIES){
    e.px = e.x; e.py = e.y; e.pz = e.z; e.pyaw = e.yaw;
    const d = Math.abs(e.x - PL.x) + Math.abs(e.z - PL.z);
    e.active = d < 70;
    if (e.st === ES.DEAD){ if (e.deadT > 150 && d > 50){ Object.assign(e, { st: ES.IDLE, hp: e.maxhp, x: e.home.x, y: e.home.y + (ESPEC[e.t].fly ? 3 : 0), z: e.home.z, deadT: 0, fled: false, burn: 0 }); } else e.deadT += E_DT; continue; }
    if (!e.active) continue; // far enemies sleep (LOD): no ticks at all
    tickEnemy(e, E_DT);
  }
}
const eAlpha = () => clamp(eAcc / E_DT, 0, 1);

/* ---- arrows: visible, arcing, dodgeable ---- */
const ARROWS = []; let arrowMesh = null;
function fireArrow(e){
  const sx = e.x - Math.sin(e.yaw) * .4, sy = e.y + 1.05, sz = e.z - Math.cos(e.yaw) * .4;
  const tx = PL.x + PL.vx * .35, ty = PL.y + 1.1, tz = PL.z + PL.vz * .35; const dh = hyp2(tx - sx, tz - sz), V = 17, tt = dh / V;
  let a = null; for (const q of ARROWS) if (!q.on){ a = q; break; } if (!a){ if (ARROWS.length >= 24) return; a = {}; ARROWS.push(a); }
  Object.assign(a, { on: true, x: sx, y: sy, z: sz, vx: (tx - sx) / dh * V, vz: (tz - sz) / dh * V, vy: (ty - sy) / Math.max(tt, .05) + 7 * tt, stuck: 0, age: 0, dmg: ESPEC[ET.ARCHER].dmg, src: e });
}
function stepArrows(dt){
  let n = 0;
  for (const a of ARROWS){ if (!a.on) continue; a.age += dt;
    if (a.stuck > 0){ a.stuck -= dt; if (a.stuck <= 0) a.on = false; }
    else { a.vy -= 14 * dt; const nx = a.x + a.vx * dt, ny = a.y + a.vy * dt, nz = a.z + a.vz * dt;
      if (solidAt(Math.floor(nx), Math.floor(ny), Math.floor(nz))){ a.stuck = 3; dust(nx, ny - .3, nz, 3, .6); }
      else { a.x = nx; a.y = ny; a.z = nz; }
      if (inSafe(a.x, a.z) || a.y < 2 || a.age > 4) a.on = false; // never into the safe skies
      const ddx = PL.x - a.x, ddy = PL.y + 1 - a.y, ddz = PL.z - a.z; if (a.on && !a.stuck && ddx * ddx + ddz * ddz < .3 && Math.abs(ddy) < 1){ hurtPlayer(a.dmg, a.x - a.vx, a.z - a.vz, 5, a.src); a.on = false; }
    }
    if (!a.on || !arrowMesh) continue;
    const hl = hyp2(a.vx, a.vz) || 1; _eu.set(a.stuck > 0 ? a.pitch || 0 : Math.atan2(a.vy, hl), Math.atan2(-a.vx, -a.vz), 0, 'YXZ'); if (!a.stuck) a.pitch = _eu.x; _m0.makeRotationFromEuler(_eu); _m0.setPosition(a.x, a.y, a.z); arrowMesh.setMatrixAt(n++, _m0);
  }
  if (arrowMesh){ arrowMesh.count = n; arrowMesh.visible = n > 0; arrowMesh.instanceMatrix.needsUpdate = true; }
}

/* ---- player health, hits, dodges, death and the gentle respawn ---- */
const PMAXHP = 20; let php = PMAXHP, iFrames = 0, combatT = -99, regenAcc = 0, dead = false, hurtFlash = 0, hitStop = 0, lastWay = 'home';
function hurtPlayer(dmg, sx, sz, kb, src){
  if (dead || PL.catching || inSafe(PL.x, PL.z) || state !== 'play') return;
  if (iFrames > 0) return;
  if (PL.dashCD > DASH_CD - .28){ dmgNumber(PL.x, PL.y + 2.1, PL.z, 'Dodge', 'dodge'); iFrames = .2; return; } // a dash through an attack is a dodge
  php = Math.max(0, php - dmg); iFrames = .7; combatT = tAcc; hurtFlash = 1;
  const dx = PL.x - sx, dz = PL.z - sz, d = hyp2(dx, dz) || 1; PL.vx += dx / d * kb; PL.vz += dz / d * kb; PL.vy = Math.max(PL.vy, 4.5); PL.onGround = false;
  PL.punch = Math.max(PL.punch, .9); camKick = Math.max(camKick, .08); SND.hurt(); heartsChanged(true);
  if (php <= 0) die();
}
function die(){
  if (dead) return; dead = true; wildStats.deaths++; SND.die(); clearInput();
  const fade = $('#fade'); fade.style.transition = 'opacity .35s'; fade.style.background = '#17151a'; fade.style.opacity = '1';
  setTimeout(() => {
    const p = homeStand();
    PL.x = PL.px = p.x; PL.y = PL.py = p.y; PL.z = PL.pz = p.z; PL.yaw = p.yaw + Math.PI; PL.vx = PL.vy = PL.vz = 0; PL.safe = { x: p.x, y: p.y, z: p.z, yaw: PL.yaw }; PL.gliding = false; PL.sailOpen = false;
    php = PMAXHP; iFrames = 1.5; dead = false; heartsChanged(false); SND.respawn();
    for (const e of ENEMIES) if (e.st !== ES.DEAD){ e.st = ES.RETURN; e.timer = 6; e.hp = e.maxhp; }
    fade.style.transition = 'opacity .6s'; fade.style.opacity = '0';
    toastCard('You wake on Home Isle', 'Nothing was lost: your satchel came with you. Enemies heal while you are away.', 5000);
  }, 420);
}
function tickHealth(dt){
  iFrames = Math.max(0, iFrames - dt); hurtFlash = Math.max(0, hurtFlash - dt * 2.2);
  const hf = $('#hurt'); const o = (hurtFlash * .55 + (php <= 6 ? (.12 + Math.sin(tAcc * 5) * .06) : 0)).toFixed(2); if (hf._o !== o){ hf._o = o; hf.style.opacity = o; }
  if (php < PMAXHP && tAcc - combatT > 6){ regenAcc += dt; if (regenAcc > 2){ regenAcc = 0; php = Math.min(PMAXHP, php + 1); heartsChanged(false); } } else regenAcc = 0;
}
function eatFood(id){ const heal = id === BUN ? 6 : 4; if (php >= PMAXHP) return false; php = Math.min(PMAXHP, php + heal); takeFromSel(1); animFeed(); SND.eat(); dmgNumber(PL.x, PL.y + 2, PL.z, '+' + heal / 2 + ' ♥', 'heal'); heartsChanged(false); for (let i = 0; i < 6; i++) emit(EYE.x + fwd().x * .5, EYE.y - .3, EYE.z + fwd().z * .5, (Math.random() - .5), Math.random(), (Math.random() - .5), .9, .75, .5, .12, .6, 0, 9); return true; }

/* ---- the player's attack: a sweep arc that hits everything inside it ---- */
let atkCD = 0;
const PICK_W = { f: -2, r: 0, dmg: 3, spd: 1.6, reach: 3, crit: .03, ax: [], nm: 'Pickaxe' };
function heldWeapon(){ const s = inv[sel]; if (s && s.w) return s.w; if (s && s.id === PICK) return PICK_W; return FISTS; }
function enemyInSights(maxD){
  const f = fwd(); let best = null, bd = maxD;
  for (const e of ENEMIES){ if (e.st === ES.DEAD || !e.active) continue; const cx = e.x - EYE.x, cy = e.y + e.h * .5 - EYE.y, cz = e.z - EYE.z, d = hyp3(cx, cy, cz); if (d > bd + e.hw) continue; const t = cx * f.x + cy * f.y + cz * f.z; if (t < 0) continue; const px = cx - f.x * t, py = cy - f.y * t, pz = cz - f.z * t; if (px * px + py * py + pz * pz < (e.hw + .35) * (e.hw + .35) + e.h * .2){ bd = d; best = e; } }
  return best;
}
function playerAttack(){
  if (atkCD > 0 || dead) return false;
  const w0 = heldWeapon(), F = w0.f >= 0 ? FAM[w0.f] : null, ch = AS.charged && w0.f === 1; atkCD = 1 / w0.spd * (ch ? 1.3 : 1); combatT = Math.max(combatT, tAcc - 3);
  const w = ch ? Object.assign({}, w0, { dmg: w0.dmg * 1.6, reach: w0.reach + 1 }) : w0;
  animSwing(w0, ch); SND.swing(w0.f);
  const f = fwd(), fl = hyp2(f.x, f.z) || 1, fx = f.x / fl, fz = f.z / fl, arc = F ? F.arc : .7;
  let hits = 0, crits = 0;
  for (const e of ENEMIES){
    if (e.st === ES.DEAD || !e.active) continue;
    const dx = e.x - PL.x, dz = e.z - PL.z, d = hyp2(dx, dz) || .01, dy = (e.y + e.h * .5) - (PL.y + 1.4);
    if (d - e.hw > w.reach || Math.abs(dy) > w.reach * .8 + e.h * .5) continue;
    const ang = Math.acos(clamp((dx * fx + dz * fz) / d, -1, 1)); if (ang > arc + Math.atan2(e.hw, d)) continue;
    const crit = Math.random() < w.crit; let dmg = w.dmg * (crit ? 1.75 : 1); if (e.t === ET.SENTINEL && e.st === ES.REC) dmg *= 1.5;
    const kbK = (F ? F.kb : 4) * (wHas(w, 'gust') ? 1.8 : 1) * (e.t === ET.SENTINEL ? .35 : 1);
    damageEnemy(e, dmg, crit, dx / d * kbK, dz / d * kbK);
    if (wHas(w, 'ember')){ e.burn = 3; e.burnT = 1; }
    hits++; if (crit) crits++;
  }
  if (hits){ hitStop = Math.min(.09, .045 + hits * .015); camKick = Math.max(camKick, .05); if (crits) SND.crit(); else SND.hit('flesh'); animHitConfirm(); }
  return true;
}
function damageEnemy(e, dmg, crit, kx, kz, dot){
  if (e.st === ES.DEAD) return;
  e.hp -= dmg; e.flash = 1; e.hitT = .25; combatT = tAcc;
  dmgNumber(e.x, e.y + e.h + .35, e.z, (Math.round(dmg * 10) / 10).toString(), crit ? 'crit' : dot ? 'dot' : '');
  if (kx || kz){ e.vx = kx; e.vz = kz; if (!ESPEC[e.t].fly) e.vy = Math.max(e.vy, 3.2); e.kbT = .22; e.A.sq.v -= 3; }
  if (e.st === ES.IDLE || e.st === ES.RETURN){ eSet(e, ES.NOTICE, .25); e.notice = 1; }
  if (e.st === ES.TELE && e.t !== ET.SENTINEL && !dot) eSet(e, ES.REC, .35); // a clean hit interrupts most wind-ups
  const c = [[.42, .62, .3], [.45, .6, .32], [.62, .75, .95], [.7, .85, 1], [.45, .6, .32]][e.t];
  for (let i = 0; i < (crit ? 10 : 6); i++){ const a = Math.random() * 6.283; emit(e.x, e.y + e.h * .6, e.z, Math.cos(a) * 2.5 + kx * .3, 1.5 + Math.random() * 2, Math.sin(a) * 2.5 + kz * .3, c[0], c[1], c[2], .14, .5, 0, 9); }
  if (e.hp <= 0){ e.st = ES.DEAD; e.deadT = 0; wildStats.kills++; SND.enemyDie(e.t, e); sparkle(e.x, e.y + .4, e.z, 10, c[0], c[1], c[2]); for (let i = 0; i < 14; i++){ const a = Math.random() * 6.283; emit(e.x, e.y + e.h * .5, e.z, Math.cos(a) * 3, 2 + Math.random() * 3, Math.sin(a) * 3, c[0], c[1], c[2], .2, .8, 0, 9); }
    if (wHas(heldWeapon(), 'mend') && php < PMAXHP){ php = Math.min(PMAXHP, php + 1); heartsChanged(false); }
    if (Math.random() < .35) spawnDrop([STICK, COBBLE, ORE, BUN][e.t % 4], e.x, e.y + .5, e.z);
    renderJournalSoon(); saveDirty = true; }
}

/* ---- damage numbers: a tiny DOM pool, positioned by projection, on solid plates ---- */
const DMG = []; const _dv = glOK ? new THREE.Vector3() : null;
function dmgNumber(x, y, z, txt, kind){
  let d = DMG.find(q => !q.on); if (!d){ if (DMG.length >= 14) d = DMG.reduce((a, b) => a.t > b.t ? a : b); else { const el = D.createElement('div'); el.className = 'dmgnum'; $('#dmgnums').appendChild(el); d = { el }; DMG.push(d); } }
  Object.assign(d, { on: true, x, y, z, t: 0, vx: (Math.random() - .5) * .8 }); d.el.textContent = txt; d.el.className = 'dmgnum' + (kind ? ' ' + kind : ''); d.el.style.display = 'block';
}
function updateDmgNumbers(dt){
  for (const d of DMG){ if (!d.on) continue; d.t += dt; if (d.t > .85){ d.on = false; d.el.style.display = 'none'; continue; }
    _dv.set(d.x + d.vx * d.t, d.y + d.t * 1.1, d.z).project(camera); if (_dv.z > 1){ d.el.style.display = 'none'; continue; } d.el.style.display = 'block';
    const sx = Math.round((_dv.x * .5 + .5) * innerWidth), sy = Math.round((-_dv.y * .5 + .5) * innerHeight), s = d.t < .12 ? .6 + d.t / .12 * .6 : 1.2 - Math.min(.2, (d.t - .12) * .6);
    d.el.style.transform = 'translate(' + sx + 'px,' + sy + 'px) translate(-50%,-50%) scale(' + s.toFixed(2) + ')'; d.el.style.opacity = d.t > .6 ? ((.85 - d.t) / .25).toFixed(2) : '1'; }
}

/* ---- hearts HUD (only in or near the Wilds, or while hurt) ---- */
const heartEls = [];
function buildHearts(){ const box = $('#hearts'); for (let i = 0; i < PMAXHP / 2; i++){ const h = D.createElement('i'); h.className = 'heart'; box.appendChild(h); heartEls.push(h); } heartsChanged(false); }
let heartsShown = false;
function updateHeartsVis(){ const show = state === 'play' && (inWilds || wildBlend > .3 || php < PMAXHP); if (show !== heartsShown){ heartsShown = show; $('#hearts').classList.toggle('on', show); } }
function heartsChanged(hit){
  for (let i = 0; i < heartEls.length; i++){ const v = clamp(php - i * 2, 0, 2), k = v === 2 ? 'full' : v === 1 ? 'half' : 'empty'; if (heartEls[i]._k !== k){ heartEls[i]._k = k; heartEls[i].style.backgroundImage = 'url(' + ICONS['heart_' + k] + ')'; } }
  const box = $('#hearts'); box.setAttribute('aria-label', 'Health: ' + php / 2 + ' of ' + PMAXHP / 2 + ' hearts');
  if (hit && !REDUCED){ box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake'); }
  updateHeartsVis();
}

/* ---- enemy models: instanced voxel parts per species ---- */
const EM_ = {}; let markMesh = null, hpBack = null, hpFront = null;
// telegraph glow colour per enemy type (read before the strike): slime green, goblin orange, sentinel blue, wisp violet, archer amber-red
const TELE_COL = [[1.1, 1.7, .6], [1.7, 1.05, .45], [.8, 1.15, 1.8], [1.35, .9, 1.8], [1.8, .75, .45]];
function buildEnemyMeshes(){
  const mat = litMat({ rim: .4 }), glowMat = litMat({ rim: .5, emis: .85 });
  const N = 48, I = (g, m, n) => instMesh(g, m || mat, n || N);
  const G1 = [.36, .55, .27], G2 = [.27, .43, .2], THORN = [.2, .3, .14], EYE = [.96, .95, .9], INK = [.08, .07, .09];
  EM_.slime = I(boxGeo([[0, .36, 0, .9, .72, .9, G1], [0, .36, 0, .96, .56, .8, G1], [0, .36, 0, .8, .56, .96, G1], [0, .7, 0, .78, .1, .78, G2], [-.32, .78, .1, .1, .22, .1, THORN], [.25, .82, -.2, .1, .28, .1, THORN], [.05, .8, .3, .08, .2, .08, THORN], [-.1, .84, -.28, .08, .26, .08, THORN], [.3, .76, .25, .16, .06, .16, [.62, .5, .3]], [-.28, .74, -.12, .12, .05, .12, [.86, .4, .44]],
    [0, .2, -.462, .36, .1, .03, [.16, .22, .1]], [-.08, .23, -.47, .06, .06, .02, [.95, .94, .88]], [.1, .23, -.47, .05, .05, .02, [.95, .94, .88]], [0, .06, 0, .7, .08, .7, G2], [.18, .3, .1, .2, .18, .2, [.45, .66, .34]]]));
  EM_.slimeEye = I(boxGeo([[-.2, .48, -.455, .2, .2, .03, EYE], [.2, .48, -.455, .2, .2, .03, EYE], [-.18, .45, -.47, .09, .11, .02, INK], [.22, .45, -.47, .09, .11, .02, INK]]));
  const SKIN = [.5, .6, .38], TUN = [.42, .3, .2], HOOD = [.28, .36, .24], BELT = [.22, .16, .12];
  EM_.gHead = I(boxGeo([[0, 0, 0, .5, .44, .46, SKIN], [-.36, .04, .04, .26, .1, .08, SKIN], [.36, .04, .04, .26, .1, .08, SKIN], [-.12, .04, -.235, .1, .08, .02, [1, .85, .3]], [.12, .04, -.235, .1, .08, .02, [1, .85, .3]], [0, -.12, -.24, .2, .05, .02, INK], [0, -.02, -.25, .08, .1, .06, [.42, .52, .32]], [-.5, .08, .04, .08, .08, .06, [.62, .7, .48]], [.5, .08, .04, .08, .08, .06, [.62, .7, .48]], [-.06, -.16, -.245, .04, .05, .02, [.95, .92, .8]], [.07, -.16, -.245, .04, .05, .02, [.95, .92, .8]], [0, .2, 0, .44, .06, .4, [.42, .32, .22]], [-.14, .14, -.2, .12, .03, .03, [.3, .36, .22]], [.14, .14, -.2, .12, .03, .03, [.3, .36, .22]]]));
  EM_.aHead = I(boxGeo([[0, 0, 0, .5, .44, .46, SKIN], [0, .08, .02, .58, .5, .56, HOOD], [0, .3, .2, .3, .2, .3, HOOD], [-.12, .02, -.25, .1, .08, .02, [1, .85, .3]], [.12, .02, -.25, .1, .08, .02, [1, .85, .3]]]));
  EM_.gBody = I(boxGeo([[0, 0, 0, .46, .5, .3, TUN], [0, -.2, 0, .48, .08, .32, BELT], [0, .22, 0, .5, .08, .32, [.5, .36, .24]], [-.27, .22, 0, .14, .12, .34, [.55, .5, .46]], [0, -.32, -.14, .26, .18, .03, [.48, .34, .22]], [.12, -.16, -.17, .06, .06, .02, [.85, .66, .28]], [0, .05, .17, .36, .4, .05, [.3, .38, .26]], [.1, .2, .21, .1, .44, .1, [.4, .28, .18]]]), null, N * 2); // pad, loincloth, buckle, a quiver strap / cloak on the back
  EM_.gLeg = I(boxGeo([[0, -.17, 0, .16, .34, .18, [.3, .24, .18]], [0, -.32, -.03, .17, .06, .22, BELT]]), null, N * 4);
  EM_.gArm = I(boxGeo([[0, -.18, 0, .13, .36, .14, SKIN]]), null, N * 2);
  EM_.club = I(boxGeo([[0, -.18, 0, .13, .36, .14, SKIN], [0, -.42, -.12, .08, .08, .4, [.45, .3, .18]], [0, -.42, -.42, .18, .18, .26, [.5, .35, .2]], [.07, -.36, -.48, .06, .06, .06, [.75, .75, .7]]]), null, N);
  EM_.bow = I(boxGeo([[0, -.18, 0, .13, .36, .14, SKIN], [0, -.38, -.1, .06, .62, .06, [.45, .3, .18]], [0, -.08, -.08, .06, .06, .16, [.45, .3, .18]], [0, -.68, -.08, .06, .06, .16, [.45, .3, .18]], [0, -.38, .0, .015, .58, .015, [.9, .88, .8]]]), null, N);
  const ST = [.36, .36, .4], ST2 = [.28, .28, .32], CRY = [.62, .78, 1];
  EM_.sBody = I(boxGeo([[0, 0, 0, .95, .85, .6, ST], [0, .5, 0, .6, .4, .5, ST2], [0, .66, -.04, .66, .08, .56, [.22, .22, .26]], [-.52, .45, 0, .2, .38, .2, CRY], [.52, .5, .05, .18, .5, .18, CRY], [-.15, .58, -.26, .1, .06, .02, [1, .9, .6]], [.15, .58, -.26, .1, .06, .02, [1, .9, .6]],
    [-.58, .32, 0, .36, .16, .5, ST2], [.58, .32, 0, .36, .16, .5, ST2], [-.3, -.1, -.305, .04, .5, .02, [.5, .7, .95]], [.3, -.1, -.305, .04, .5, .02, [.5, .7, .95]], [0, -.38, -.3, .6, .04, .02, [.5, .7, .95]], [0, .82, 0, .12, .2, .12, CRY]]));
  EM_.sCore = I(boxGeo([[0, 0, -.31, .32, .32, .04, CRY]]), glowMat);
  EM_.sLeg = I(boxGeo([[0, -.28, 0, .3, .56, .34, ST2]]), null, N * 2);
  EM_.sArm = I(boxGeo([[0, -.3, 0, .26, .7, .3, ST], [0, -.66, -.02, .32, .2, .36, ST2]]), null, N * 2);
  EM_.wCore = I(boxGeo([[0, 0, 0, .44, .44, .44, [.82, .78, 1]], [0, 0, 0, .3, .58, .3, [.9, .88, 1]], [0, 0, 0, .58, .3, .3, [.9, .88, 1]], [0, .38, 0, .18, .22, .18, [1, .95, 1]], [-.12, .3, .06, .1, .16, .1, [.85, .8, 1]], [.12, .32, -.05, .1, .18, .1, [.85, .8, 1]]]), glowMat);
  EM_.wEye = I(boxGeo([[-.1, .04, -.23, .08, .1, .02, INK], [.1, .04, -.23, .08, .1, .02, INK]]));
  EM_.wTail = I(boxGeo([[0, 0, 0, .2, .2, .2, [.7, .85, 1]]]), glowMat, N * 3);
  markMesh = I(boxGeo([[0, .22, 0, .12, .34, .06, [1, .82, .3]], [0, -.06, 0, .12, .12, .06, [1, .82, .3]]]), glowMat, N);
  const ag = boxGeo([[0, 0, -.1, .03, .03, .8, [.55, .4, .25]], [0, 0, -.55, .07, .07, .14, [.8, .8, .82]], [0, .04, .28, .015, .08, .16, [.9, .9, .88]], [0, -.04, .28, .015, .08, .16, [.9, .9, .88]]]);
  arrowMesh = I(ag, null, 24); arrowMesh.count = 0;
  const pg = new THREE.PlaneGeometry(1, 1); const pc = new Float32Array(pg.attributes.position.count * 3).fill(1); pg.setAttribute('aCol', new THREE.BufferAttribute(pc, 3));
  hpBack = I(pg, litMat({ emis: 1, rim: 0 })); hpFront = I(pg, litMat({ emis: 1, rim: 0 }));
  for (const k in EM_) EM_[k].count = 0;
}
function renderEnemies(t, dt){
  if (!EM_.slime) return;
  const a = eAlpha(), C = {}; for (const k in EM_) C[k] = 0; let nm = 0, nh = 0;
  for (const e of ENEMIES){
    if (!e.active && e.st !== ES.DEAD) continue;
    if (Math.abs(e.x - camera.position.x) > renderDist + 8 || Math.abs(e.z - camera.position.z) > renderDist + 8) continue;
    const A = e.A, dying = e.st === ES.DEAD ? Math.min(1, e.deadT / .35) : 0; if (dying >= 1) continue;
    const x = e.px + (e.x - e.px) * a, y = e.py + (e.y - e.py) * a - e.stepOff, z = e.pz + (e.z - e.pz) * a, yaw = e.pyaw + angDiff(e.yaw, e.pyaw) * a;
    const camYaw = Math.atan2(camera.position.x - x, camera.position.z - z), crx = Math.cos(camYaw), crz = -Math.sin(camYaw);
    const tele = e.st === ES.TELE ? 1 - Math.max(0, e.timer) / ESPEC[e.t].tele : 0, rec = e.st === ES.REC ? 1 : 0, atk = e.st === ES.ATK ? 1 : 0;
    // the flash is white on a hit; the telegraph pulses hot (orange for goblins, blue-white for crystal and wisps)
    const tp = tele > 0 ? .5 + .5 * Math.sin(t * (14 + tele * 18)) : 0;
    const fl = e.flash, tc = TELE_COL[e.t] || [1.6, 1.05, .5];
    _col.setRGB(1 + fl * 1.6 + tp * tele * (tc[0] - 1), 1 + fl * 1.6 + tp * tele * (tc[1] - 1), 1 + fl * 1.6 + tp * tele * (tc[2] - 1));
    if (e.burn > 0) _col.r += .4 + Math.sin(t * 20) * .2;
    const spd = hyp2(e.x - e.px, e.z - e.pz) / E_DT; A.gait += spd * dt * 1.6;
    // idle personality: every few seconds a little action (scratch, hop, look round, check the bow)
    A.idleT = (A.idleT || (2 + e.j % 3)) - dt; if (A.idleT < 0){ A.idleT = 3 + ((e.j * 7 + Math.floor(t)) % 5); A.idleA = 1; } A.idleA = Math.max(0, (A.idleA || 0) - dt * .9); const idleK = e.st === ES.IDLE ? Math.sin(A.idleA * Math.PI) : 0;
    const sink = dying * .5, shrink = 1 - dying;
    _m0.makeRotationY(yaw); _m0.setPosition(x, y - sink, z); if (e.sc) _m0.scale(_sv.set(e.sc, e.sc, e.sc));
    const put = (k, idx, mtx) => { EM_[k].setMatrixAt(idx, mtx); EM_[k].setColorAt(idx, _col); };
    if (e.t === ET.SLIME){
      const sqT = 1 - tele * .32 + (atk && !e.onGround ? .25 : 0) - rec * .15 + Math.sin(t * 3 + e.j) * .03 + idleK * .18 - fl * .25;
      spring(A.sq, sqT, 14, dt); const sq = clamp(A.sq.x, .5, 1.5), wob = Math.sin(t * 9 + e.j) * .03 * (1 + tele * 3);
      local(0, 0, wob, (1 + (1 - sq) * .7) * shrink, sq * shrink, (1 + (1 - sq) * .7) * shrink, 0, 0, 0); _m2.multiplyMatrices(_m0, _m1);
      put('slime', C.slime++, _m2); put('slimeEye', C.slimeEye++, _m2);
    } else if (e.t === ET.GOBLIN || e.t === ET.ARCHER){
      const g = A.gait, sw = Math.sin(g) * .7 * Math.min(1, spd / 2), bob = Math.abs(Math.cos(g)) * .05 * Math.min(1, spd / 2);
      spring(A.lean, (spd > 2 ? .18 : 0) + tele * -.2 + atk * .3 + rec * .1 - fl * .5, 10, dt);
      local(A.lean.x, 0, 0, shrink, shrink, shrink, 0, .62 + bob, 0); _m2.multiplyMatrices(_m0, _m1); _m3.copy(_m2); put('gBody', C.gBody++, _m2);
      local(-.1 + tele * .15, 0, Math.sin(t * 2 + e.j) * .04, 1, 1, 1, 0, .48, -.02); _m2.multiplyMatrices(_m3, _m1); put(e.t === ET.ARCHER ? 'aHead' : 'gHead', C[e.t === ET.ARCHER ? 'aHead' : 'gHead']++, _m2);
      for (let s = 0; s < 2; s++){ local((s ? sw : -sw), 0, 0, shrink, shrink, shrink, s ? .11 : -.11, .36 + bob, 0); _m2.multiplyMatrices(_m0, _m1); put('gLeg', C.gLeg++, _m2); }
      local(sw * .6, 0, -.1, 1, 1, 1, -.32, .2, 0); _m2.multiplyMatrices(_m3, _m1); put('gArm', C.gArm++, _m2);
      let armRx; if (e.t === ET.GOBLIN) armRx = tele > 0 ? -2.6 * EZ.outCubic(Math.min(1, tele * 1.6)) : atk ? 1.1 : rec ? .5 : -sw * .6;
      else armRx = tele > 0 ? -1.55 : atk ? -1.55 : -sw * .5 - idleK * .9;
      if (e.t === ET.GOBLIN && tele <= 0 && !atk && !rec) armRx -= idleK * 2.2; // a goblin scratching its head between patrols
      spring(A.arm, armRx, e.t === ET.GOBLIN && atk ? 40 : 14, dt);
      local(A.arm.x, 0, .1, 1, 1, 1, .32, .2, 0); _m2.multiplyMatrices(_m3, _m1); put(e.t === ET.ARCHER ? 'bow' : 'club', C[e.t === ET.ARCHER ? 'bow' : 'club']++, _m2);
    } else if (e.t === ET.SENTINEL){
      const g = A.gait * .6, sw = Math.sin(g) * .45 * Math.min(1, spd / 1.2), shake = tele * Math.sin(t * 50) * .04;
      spring(A.lean, tele * -.25 + atk * .35 + rec * .4 - fl * .2, 8, dt);
      local(A.lean.x, shake, rec * .15 * Math.sin(t * 3), shrink, shrink, shrink, 0, 1.18, 0); _m2.multiplyMatrices(_m0, _m1); _m3.copy(_m2); put('sBody', C.sBody++, _m2);
      _col.setRGB(1 + fl + tele * 2.4 * tp + atk * 1.4, 1 + fl + tele * 2.6 * tp + atk * 1.6, 1 + fl + tele * 3 * tp + atk * 2); put('sCore', C.sCore++, _m3);
      _col.setRGB(1 + fl * 1.6, 1 + fl * 1.6, 1 + fl * 1.6);
      for (let s = 0; s < 2; s++){ local(s ? sw : -sw, 0, 0, shrink, shrink, shrink, s ? .26 : -.26, .62, 0); _m2.multiplyMatrices(_m0, _m1); put('sLeg', C.sLeg++, _m2); }
      for (let s = 0; s < 2; s++){ local((s ? -sw : sw) * .7 - tele * 1.2 - atk * .9, 0, s ? .2 : -.2, 1, 1, 1, s ? .62 : -.62, .3, 0); _m2.multiplyMatrices(_m3, _m1); put('sArm', C.sArm++, _m2); }
    } else {
      const bob = Math.sin(t * 3 + e.j) * .12, sc = (1 + tele * .25 * tp) * shrink;
      local(0, t * 1.5, 0, sc, sc, sc, 0, bob, 0); _m2.multiplyMatrices(_m0, _m1);
      _col.setRGB(1 + fl + tele * 1.5 * tp, 1 + fl + tele * 1.5 * tp, 1 + fl + tele * 1.2 * tp); put('wCore', C.wCore++, _m2);
      local(0, 0, 0, 1, 1, 1, 0, bob, 0); _m2.multiplyMatrices(_m0, _m1); put('wEye', C.wEye++, _m2);
      for (let s = 0; s < 3; s++){ const ph = t * 2.2 + s * 2.09; local(t, t, 0, (.7 - s * .15) * shrink, (.7 - s * .15) * shrink, (.7 - s * .15) * shrink, Math.cos(ph) * .5, bob - .1 - s * .05 + Math.sin(ph * 1.3) * .2, .35 + s * .28); _m2.multiplyMatrices(_m0, _m1); put('wTail', C.wTail++, _m2); }
    }
    // "!" when they notice you
    if (e.notice > 0){ e.notice = Math.max(0, e.notice - dt * 1.4); spring(A.mark, e.notice > .2 ? 1 : 0, 18, dt); const s = Math.max(0, A.mark.x);
      _m0.makeRotationY(camYaw); _m0.scale(_sv.set(s, s, s)); _m0.setPosition(x, y + e.h + .7 + Math.sin(t * 12) * .03, z); markMesh.setMatrixAt(nm++, _m0); }
    // health bar after the first hit
    if (e.hp < e.maxhp && e.st !== ES.DEAD){ const k = clamp(e.hp / e.maxhp, 0, 1), by = y + e.h + .32;
      _m0.makeRotationY(camYaw); _m0.scale(_sv.set(.9, .1, 1)); _m0.setPosition(x, by, z); hpBack.setMatrixAt(nh, _m0); hpBack.setColorAt(nh, _col.setRGB(.08, .07, .09));
      const ox = -.42 * (1 - k); _m0.makeRotationY(camYaw); _m0.scale(_sv.set(.84 * k, .06, 1)); _m0.setPosition(x + crx * ox + Math.sin(camYaw) * .01, by, z + crz * ox + Math.cos(camYaw) * .01); hpFront.setMatrixAt(nh, _m0); hpFront.setColorAt(nh, k > .5 ? _col.setRGB(.55, .85, .4) : k > .25 ? _col.setRGB(.95, .75, .3) : _col.setRGB(.95, .4, .35)); nh++; }
  }
  for (const k in EM_){ const m = EM_[k]; if (k === 'arrow') continue; m.count = C[k] || 0; m.visible = m.count > 0; if (m.count){ m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; } }
  markMesh.count = nm; markMesh.visible = nm > 0; markMesh.instanceMatrix.needsUpdate = true;
  hpBack.count = hpFront.count = nh; hpBack.visible = hpFront.visible = nh > 0; if (nh){ hpBack.instanceMatrix.needsUpdate = hpFront.instanceMatrix.needsUpdate = true; hpBack.instanceColor.needsUpdate = hpFront.instanceColor.needsUpdate = true; }
}

/* ---- glue: island ready, reseeding, updraft motes for the Wilds ---- */
// once an island is generated, check each updraft aimed at it against the real ground near its landing rim
// (landmarks, terraces and spires can stand taller than the shape spec) and raise the draft if needed
let draftFixT = 0;
function fixDrafts(I){ let ch = false;
  for (const u of WILD_UD){ if (u.to !== I.k) continue; const hs = []; for (let z = Math.round(u.rz) - 7; z <= u.rz + 7; z++) for (let x = Math.round(u.rx) - 7; x <= u.rx + 7; x++){ if (x < 0 || z < 0 || x >= WX || z >= WZ) continue; const c = x + z * WX; if (isl[c] === OUT_ISL0 + I.k && Math.hypot(x - u.rx, z - u.rz) <= 7) hs.push(hTop[c]); }
    if (!hs.length) continue; hs.sort((a, b) => a - b); const land = u.landY ? u.landY - 1 : hs[Math.floor(hs.length * .3)], need = Math.round(clamp(Math.max(land + u.gap / 4.5 + 9, u.base + 9), 36, WY - 6)); if (need > u.top){ u.top = need; ch = true; } }
  // and each updraft launched from it must have a clear column (bridges, overhangs and arches can roof it): slide it outward until clear
  for (const u of WILD_UD){ if (u.from !== I.k || u.ux === undefined) continue; const blocked = (x, z) => { for (let y = Math.max(1, u.base - 6); y < u.top; y++) for (const [ox, oz] of [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2]]) if (solidAt(Math.floor(x + ox), y, Math.floor(z + oz))) return true; return false; };
    let n = 0; while (n < 12 && blocked(u.x, u.z)){ u.x += u.ux; u.z += u.uz; n++; } if (n){ ch = true; u.top = Math.min(WY - 6, u.top + Math.ceil(n / 4.5)); } }
  if (I.content && I.content.length) ch = true;
  if (ch){ clearTimeout(draftFixT); draftFixT = setTimeout(() => { if (glOK) buildWildDrafts(); }, 400); } }
let wildDraftPts = null;
function buildWildDrafts(){ if (wildDraftPts){ scene.remove(wildDraftPts); wildDraftPts.geometry.dispose(); } wildDraftPts = draftPoints(WILD_UD); }
function reseedWilds(seed){
  for (const I of OUT){ if (I.gen !== 2) continue; }
  ENEMIES.length = 0; CHESTS.length = 0; for (const a of ARROWS) a.on = false; chestLooted.clear();
  // wipe the crescent (nothing of the lore lives out here)
  for (let y = 0; y < WY; y++) for (let z = 0; z < WZ; z++){ const row = WX * (z + WZ * y); for (let x = (z < SAFE ? SAFE : 0); x < WX; x++){ const i = row + x; world[i] = 0; light[i] = 0; } }
  for (let z = 0; z < WZ; z++) for (let x = (z < SAFE ? SAFE : 0); x < WX; x++){ const c = x + z * WX; if (isl[c] >= OUT_ISL0){ isl[c] = -1; hTop[c] = -1; } }
  for (const k of [...edits.keys()]){ const x = k % WX, z = ((k / WX) | 0) % WZ; if (!inSafe(x, z)){ edits.delete(k); orig.delete(k); } }
  layoutWilds(seed); buildSilhouettes(); buildWildDrafts();
  for (let cz = 0; cz < NCZ; cz++) for (let cx = 0; cx < NCX; cx++){ if (cx * 16 + 15 < SAFE && cz * 16 + 15 < SAFE) continue; const ch = chunks[ckey(cx, 0, cz)]; let n = 0; for (let y = 0; y < WY; y++) for (let z = cz * 16; z < cz * 16 + 16; z++) for (let x = cx * 16; x < cx * 16 + 16; x++) if (world[x + WX * (z + WZ * y)]) n++; ch.count = n; if (ch.mesh || ch.wmesh || n) markDirty(ckey(cx, 0, cz)); }
  if (mapStatic) buildMapStatic(); renderJournalSoon(); saveDirty = true;
}
