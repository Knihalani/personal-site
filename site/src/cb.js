
/* ================= combat (cb): the player's side of a fight =================
   Light attack: up to three hits (A, B, then a finisher with knockback). Attacking again once the last swing is
   halfway through keeps the combo going; clicking before that queues a slow reset swing, so rhythm beats mashing.
   Hold to charge a heavy, one per family: sword wide sweep, spear lunge, axe overhead cleave (area), dagger flurry.
   Right mouse with a weapon guards (frontal, costs stamina per blow); raising it just as a blow lands parries:
   the attacker staggers and takes guaranteed crits for a moment. The dash (Q) is a dodge with i-frames.
   Attacking while falling or sailing plunges: a slam that hits everything around the landing.
   Stamina (ring round the crosshair) gates heavies, guard and dodge, and is deliberately lenient.
   Juice: hit-stop by weapon weight, camera kick, crit sparks, damage numbers, soft aim assist in a forward cone. */
const CB = { combo: 0, lastT: -9, lastInt: .5, queued: 0, queueAt: 0, down: false, downT: 0, charging: false, chargeT: 0, full: false, tired: false,
  guard: false, guardT: 0, guardOff: -9, guardBreak: 0, parryT: 9, stam: 100, stamT: 0, dodgeIF: 0, prevDash: 0, plunge: false, plungeY: 0,
  aim: 0, pend: [], tickAt: 0, ringEl: null, ringFg: null, ringK: '', movesDone: false };
const STAM_MAX = 100, ST_HEAVY = 22, ST_DODGE = 16, ST_BLOCK = 5, PARRY_WIN = .22;
const CHARGE_T = [.55, .5, .7, .4]; // seconds to a full charge: sword, spear, axe, dagger
const WEIGHT = [1, 1.35, 1.6, .55, .6]; // matches the hand rig's family weights (fists last): scales hit-stop and kick
const famIdx = w => w.f >= 0 ? w.f : 4;
const CBP = { x: Spr(), y: Spr(), z: Spr(), rx: Spr(), ry: Spr(), rz: Spr() }; // held combat poses (charge, guard, plunge), sprung

/* ---- hand-rig clips: finisher per family, heavy releases, parry flash, plunge slam ---- */
const FIN = [
  { d: .56, ry: K_([[0, 0], [.1, .75, EZ.outQuad], [.2, -1.45, EZ.inCubic], [.34, -1.55, EZ.outQuad], [.56, 0, EZ.inOutSine]]), rx: K_([[0, 0], [.1, .55, EZ.outQuad], [.2, -.7, EZ.inCubic], [.56, 0]]), x: K_([[0, 0], [.1, .08], [.2, -.3, EZ.inCubic], [.56, 0]]), y: K_([[0, 0], [.1, .08], [.2, -.06], [.56, 0]]), rz: K_([[0, 0], [.2, .6, EZ.inCubic], [.56, 0]]), sm: [.1, .26, 6] },
  { d: .5, z: K_([[0, 0], [.1, .22, EZ.outQuad], [.17, -.72, EZ.inCubic], [.3, -.62], [.5, 0, EZ.inOutSine]]), rz: K_([[0, 0], [.1, -.35], [.17, .45, EZ.inCubic], [.5, 0]]), rx: K_([[0, 0], [.17, .15], [.5, 0]]), y: K_([[0, 0], [.1, .04], [.17, -.04], [.5, 0]]), sm: [.1, .22, 1] },
  { d: .78, rx: K_([[0, 0], [.22, 1.25, EZ.outQuad], [.33, -1.6, EZ.inCubic], [.5, -1.7, EZ.outQuad], [.78, 0, EZ.inOutSine]]), y: K_([[0, 0], [.22, .12], [.33, -.12, EZ.inCubic], [.78, 0]]), z: K_([[0, 0], [.22, .1], [.33, -.25, EZ.inCubic], [.78, 0]]), sm: [.22, .38, 2] },
  { d: .36, rx: K_([[0, 0], [.06, .7, EZ.outQuad], [.12, -1, EZ.inCubic], [.2, -1.05], [.36, 0, EZ.inOutSine]]), z: K_([[0, 0], [.06, .06], [.12, -.32, EZ.inCubic], [.36, 0]]), y: K_([[0, 0], [.06, .08], [.12, -.05], [.36, 0]]), sm: [.06, .16, 2] },
  { d: .38, y: K_([[0, 0], [.06, -.08, EZ.outQuad], [.13, .16, EZ.inCubic], [.38, 0, EZ.inOutSine]]), z: K_([[0, 0], [.06, .08], [.13, -.42, EZ.inCubic], [.38, 0]]), rx: K_([[0, 0], [.13, .35], [.38, 0]]), sm: [0, 0, 0] }
];
const HEAVY = [
  { d: .66, ry: K_([[0, 0], [.06, 1.5, EZ.outQuad], [.24, -2, EZ.inCubic], [.4, -2.1, EZ.outQuad], [.66, 0, EZ.inOutSine]]), x: K_([[0, 0], [.06, .14], [.24, -.36, EZ.inCubic], [.66, 0]]), rz: K_([[0, 0], [.06, -.3], [.24, .55, EZ.inCubic], [.66, 0]]), y: K_([[0, 0], [.24, -.04], [.66, 0]]), sm: [.06, .26, 6] },
  CLIP_SPEAR_CHARGED,
  { d: .82, rx: K_([[0, 0], [.12, 1.3, EZ.outQuad], [.3, -1.75, EZ.inCubic], [.52, -1.8], [.82, 0, EZ.inOutSine]]), y: K_([[0, 0], [.12, .14], [.3, -.18, EZ.inCubic], [.6, -.15], [.82, 0]]), z: K_([[0, 0], [.3, -.3, EZ.inCubic], [.82, 0]]), sm: [.14, .32, 2] },
  { d: .52, z: K_([[0, 0], [.05, -.42, EZ.inCubic], [.1, -.05], [.15, -.44, EZ.inCubic], [.2, -.05], [.25, -.42, EZ.inCubic], [.3, -.05], [.36, -.5, EZ.inCubic], [.52, 0]]), x: K_([[0, 0], [.05, -.06], [.15, .06], [.25, -.04], [.36, .02], [.52, 0]]), ry: K_([[0, 0], [.05, .15], [.15, -.15], [.25, .12], [.36, 0], [.52, 0]]), sm: [.03, .4, 1] }
];
const CLIP_PARRY = { d: .32, z: K_([[0, 0], [.04, -.2, EZ.outQuad], [.32, 0]]), rz: K_([[0, 0], [.04, -.7, EZ.outQuad], [.32, 0]]), x: K_([[0, 0], [.04, .12], [.32, 0]]), y: K_([[0, 0], [.04, .05], [.32, 0]]), sm: [0, .1, 5] };
const CLIP_PLUNGE = { d: .5, rx: K_([[0, 0], [.06, -2.2, EZ.inCubic], [.25, -1.6], [.5, 0, EZ.inOutSine]]), y: K_([[0, 0], [.06, -.2, EZ.inCubic], [.3, -.12], [.5, 0]]), z: K_([[0, 0], [.06, -.15], [.5, 0]]), sm: [0, .1, 2] };
function animClip(S, w){
  HR.swClip = S; HR.swCharged = false; HR.swT = 0; HR.swF = famIdx(w); HR.swB = 0; HR.inspT = 9; HR.idleT = 0;
  if (smear && S.sm){ setSmearShape(S.sm[2]); const c = w.f >= 0 && RARITY[w.r] ? RARITY[w.r].k : [1, 1, 1]; smear.material.uniforms.uC.value.setRGB(.55 + c[0] * .45, .55 + c[1] * .45, .55 + c[2] * .45); }
}
// held poses, called from updateHandRig each frame; added on top of the rig's springs
function combatPose(dt){
  let x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0; const f = heldWeapon().f;
  if (CB.plunge){ y = .14; z = .04; rx = 1.1; }
  else if (CB.guard){ if (f >= 0){ x = -.2; y = .1; z = .05; rx = .1; ry = .3; rz = 1.2; } else { x = -.1; y = .1; rz = .3; } }
  else if (CB.charging && f >= 0){
    const c = Math.min(1, CB.chargeT / CHARGE_T[f]), sh = REDUCED ? 0 : Math.sin(tAcc * 40) * .004 * c * (CB.full ? 1.6 : 1);
    if (f === 0){ x = .1 * c + sh; z = .1 * c; ry = 1 * c; rz = -.25 * c; }
    else if (f === 1){ z = .18 * c; y = -.03 * c; rx = -.12 * c; x = sh; }
    else if (f === 2){ y = .16 * c + sh; z = .06 * c; rx = 1 * c; }
    else { x = -.05 * c + sh; y = -.07 * c; z = .08 * c; rz = -.5 * c; ry = .3 * c; }
  }
  const om = 16; spring(CBP.x, x, om, dt); spring(CBP.y, y, om, dt); spring(CBP.z, z, om, dt); spring(CBP.rx, rx, om, dt); spring(CBP.ry, ry, om, dt); spring(CBP.rz, rz, om, dt);
}

/* ---- input: press / release / guard (called from the input section) ---- */
function combatPress(){
  if (state !== 'play' || dead || PL.catching) return;
  const w = heldWeapon(); if (CB.guard) combatGuard(false);
  if (w.f >= 0 && tryPlunge()) return;
  CB.down = true; CB.downT = tAcc; CB.charging = false; CB.chargeT = 0; CB.full = false; CB.tired = false;
  if (w.f < 0){ CB.down = false; lightAttack(); } // fists and the pickaxe swing at once (nothing to charge)
}
function combatRelease(){
  if (!CB.down) return; CB.down = false;
  const w = heldWeapon(), ch = CB.charging, full = CB.full; CB.charging = false; CB.full = false;
  if (state !== 'play' || dead || w.f < 0) return;
  if (ch && full) heavyAttack(w); else lightAttack();
}
function combatGuard(on){
  if (!on){ if (CB.guard){ CB.guard = false; CB.guardOff = tAcc; } return false; }
  if (state !== 'play' || dead || !holdingWeapon() || CB.guardBreak > 0 || MOBHIT.m || nearChestC || nearEngine) return false;
  CB.guard = true; CB.down = false; CB.charging = false;
  CB.guardT = tAcc - CB.guardOff < .35 ? PARRY_WIN : 0; // re-raising the guard straight away does not re-open the parry window
  SND.guardUp(); return true;
}
// called by hurtPlayer: returns the share of the blow that gets through (0 = none)
function combatDefend(dmg, sx, sz, src){
  if (CB.dodgeIF > 0){ dmgNumber(PL.x, PL.y + 2.1, PL.z, 'Dodge', 'dodge'); iFrames = .2; SND.dodged(); return 0; }
  if (!CB.guard) return 1;
  const f = fwd(), fl = hyp2(f.x, f.z) || 1, dx = sx - PL.x, dz = sz - PL.z, d = hyp2(dx, dz) || 1;
  if ((dx * f.x + dz * f.z) / (d * fl) < .1) return 1; // from behind or the side: the guard does not help
  const gx = PL.x + f.x / fl * .7, gz = PL.z + f.z / fl * .7;
  if (CB.guardT < PARRY_WIN){ // parry
    CB.parryT = 0; iFrames = .45; CB.stam = Math.min(STAM_MAX, CB.stam + 15); hitStop = Math.max(hitStop, .13); camKick = Math.max(camKick, .09);
    animClip(CLIP_PARRY, heldWeapon()); SND.parry(); dmgNumber(PL.x + f.x / fl * 1.2, PL.y + 2, PL.z + f.z / fl * 1.2, 'Parry', 'parry');
    sparks(gx, PL.y + 1.3, gz, 14, 1.8, 1.5, .8);
    if (src && src.st !== undefined && src.st !== ES.DEAD && hyp2(src.x - PL.x, src.z - PL.z) < 5){ eStagger(src, src.t === ET.SENTINEL ? 1.8 : 1.4); src.critT = 2; src.flash = 1; }
    return 0;
  }
  CB.stam -= dmg * ST_BLOCK; CB.stamT = .7; iFrames = .3; camKick = Math.max(camKick, .05); PL.punch = Math.max(PL.punch, .5);
  const kx = -dx / d, kz = -dz / d; PL.vx += kx * 3; PL.vz += kz * 3; // a shove backwards, no damage
  sparks(gx, PL.y + 1.3, gz, 6, 1.2, 1.1, 1);
  if (CB.stam < 0){ CB.stam = 0; CB.guard = false; CB.guardBreak = .9; SND.guardBreak(); dmgNumber(PL.x, PL.y + 2.1, PL.z, 'Guard broken', 'dot'); return .5; }
  SND.block(); dmgNumber(PL.x + f.x / fl * 1.2, PL.y + 1.9, PL.z + f.z / fl * 1.2, 'Block', 'block'); return 0;
}

/* ---- attacks ---- */
function later(t, fn){ CB.pend.push({ t, fn }); }
function lightAttack(){
  const w = heldWeapon(), since = tAcc - CB.lastT, open = CB.lastInt * .5, close = open + .5;
  if (since < open){ if (!CB.queued){ CB.queued = 1; CB.queueAt = CB.lastT + CB.lastInt * 1.25; } return; } // mashing: waits out the swing and drops the combo
  doLight(w, since <= close && CB.combo < 3 ? CB.combo + 1 : 1);
}
function doLight(w, step){
  const fi = famIdx(w), int = 1 / w.spd, S = step === 3 ? FIN[fi] : SWING2[fi][step - 1], F = w.f >= 0 ? FAM[w.f] : null, fin = step === 3;
  CB.combo = step; CB.lastT = tAcc; CB.lastInt = int * (fin ? 1.4 : 1); atkCD = int * .5; combatT = Math.max(combatT, tAcc - 3);
  animClip(S, w); SND.swing(w.f); if (fin) SND.heavy(.5);
  const dir = aimAssist(w.reach + 1.2);
  const o = { w, dir, reach: w.reach + (fin ? .3 : 0), arc: (F ? F.arc : .7) * (fin ? 1.25 : 1), mult: [1, 1.1, 1.5][step - 1], kb: fin ? 2.4 : .7, poise: fin ? 2 : 1, stop: fin ? 1.35 : 1, fin };
  later(Math.max(.03, S.sm[0] || .06), () => strike(o));
}
function heavyAttack(w){
  const fi = w.f; CB.stam = Math.max(0, CB.stam - ST_HEAVY); CB.stamT = 1; CB.queued = 0;
  CB.combo = 0; CB.lastT = tAcc; CB.lastInt = 1 / w.spd * 1.3; atkCD = CB.lastInt; combatT = Math.max(combatT, tAcc - 3);
  const f = fwd(), l = hyp2(f.x, f.z) || 1, dir = aimAssist(w.reach + 2) || [f.x / l, f.z / l];
  const H = (o) => Object.assign({ w, dir, reach: w.reach, arc: 1, mult: 2, kb: 1.6, poise: 2.4, stop: 1.6, fin: true }, o);
  animClip(HEAVY[fi], w); SND.heavy(1);
  if (fi === 0) later(.12, () => strike(H({ reach: w.reach + .7, arc: 2.15, mult: 1.9 }))); // wide sweep
  else if (fi === 1){ const k = PL.onGround ? 9 : 5; PL.vx += dir[0] * k; PL.vz += dir[1] * k; later(.07, () => strike(H({ reach: w.reach + 1.8, arc: .32, mult: 2.2, kb: 1.5, poise: 2.6 }))); } // lunge
  else if (fi === 2) later(.3, () => { const cx = PL.x + dir[0] * 1.8, cz = PL.z + dir[1] * 1.8; shockRing(cx, PL.y, cz, 2.7, [.85, .8, .7]); dust(cx, PL.y, cz, 8, 2.5); camKick = Math.max(camKick, .1); SND.slam(.6);
    strike(H({ area: [cx, cz, 2.7], mult: 2.4, kb: 2, poise: 3, stop: 1.8 })); }); // overhead cleave: everything round the impact
  else for (let i = 0; i < 4; i++) later(.05 + i * .1, () => { if (i) SND.swing(3); strike(H({ reach: w.reach + .3, arc: .75, mult: .75, kb: i === 3 ? 1.4 : .25, poise: .8, stop: .6, fin: i === 3 })); }); // flurry
}
// soft aim assist: the nearest enemy in a forward cone pulls the swing (and nudges the view) toward it
function aimAssist(range){
  const f = fwd(), l = hyp2(f.x, f.z) || 1, fx = f.x / l, fz = f.z / l, cone = TOUCH ? .8 : .55; let best = null, bs = 1e9;
  for (const e of ENEMIES){ if (e.st === ES.DEAD || !e.active) continue; const dx = e.x - PL.x, dz = e.z - PL.z, d = hyp2(dx, dz);
    if (d > range + e.hw || d < .2 || Math.abs(e.y + e.h * .5 - PL.y - 1) > 3) continue; const a = Math.acos(clamp((dx * fx + dz * fz) / d, -1, 1)); if (a > cone) continue;
    const s = d + a * 4; if (s < bs){ bs = s; best = e; } }
  if (!best) return null;
  const dx = best.x - PL.x, dz = best.z - PL.z, d = hyp2(dx, dz) || 1;
  CB.aim = angDiff(Math.atan2(-dx, -dz), PL.yaw) * (TOUCH ? .7 : .4);
  return [dx / d, dz / d];
}
function strike(o){
  if (dead) return 0;
  const w = o.w, F = w.f >= 0 ? FAM[w.f] : null, W = WEIGHT[famIdx(w)];
  let fx, fz; if (o.dir){ fx = o.dir[0]; fz = o.dir[1]; } else { const f = fwd(), l = hyp2(f.x, f.z) || 1; fx = f.x / l; fz = f.z / l; }
  let hits = 0, crits = 0;
  for (const e of ENEMIES){
    if (e.st === ES.DEAD || !e.active) continue;
    let dx, dz, d;
    if (o.area){ dx = e.x - o.area[0]; dz = e.z - o.area[1]; d = hyp2(dx, dz) || .01; if (d - e.hw > o.area[2] || Math.abs(e.y + e.h * .5 - PL.y - .6) > 2.2 + e.h * .5) continue; }
    else { dx = e.x - PL.x; dz = e.z - PL.z; d = hyp2(dx, dz) || .01; const dy = (e.y + e.h * .5) - (PL.y + 1.4);
      if (d - e.hw > o.reach || Math.abs(dy) > o.reach * .8 + e.h * .5) continue;
      if (Math.acos(clamp((dx * fx + dz * fz) / d, -1, 1)) > o.arc + Math.atan2(e.hw, d)) continue; }
    const crit = e.critT > 0 || Math.random() < w.crit + (e.stagT > 0 ? .25 : 0);
    let dmg = w.dmg * o.mult * (crit ? 1.75 : 1); if (e.t === ET.SENTINEL && e.st === ES.REC) dmg *= 1.5;
    const kbK = (F ? F.kb : 4) * o.kb * (wHas(w, 'gust') ? 1.8 : 1) * (e.t === ET.SENTINEL ? .35 : 1) * (e.chief ? .6 : 1);
    damageEnemy(e, dmg, crit, dx / d * kbK, dz / d * kbK, false, w.dmg * o.mult * o.poise);
    if (wHas(w, 'ember')){ e.burn = 3; e.burnT = 1; }
    hits++; if (crit){ crits++; sparks(e.x - dx / d * e.hw, e.y + e.h * .6, e.z - dz / d * e.hw, 10, 1.9, 1.6, .7); }
  }
  if (hits){
    hitStop = Math.max(hitStop, Math.min(.18, (.03 + .028 * W) * o.stop + hits * .006));
    camKick = Math.max(camKick, (.035 + .025 * W) * o.stop); PL.punch = Math.max(PL.punch, .2 * o.stop);
    if (crits) SND.crit(); else SND.hit('flesh'); if (o.fin) SND.finisher(); animHitConfirm();
  }
  return hits;
}
function sparks(x, y, z, n, r, g, b){ n = LOW ? Math.ceil(n / 2) : n; for (let i = 0; i < n; i++){ const a = Math.random() * 6.283, v = 3 + Math.random() * 4; emit(x, y, z, Math.cos(a) * v, 1 + Math.random() * 3.5, Math.sin(a) * v, r, g, b, .08 + Math.random() * .05, .25 + Math.random() * .15, 0, 10); } }

/* ---- plunge: attack while falling or sailing to slam down ---- */
function groundGap(){ for (let i = 0; i < 32; i++) if (solidAt(Math.floor(PL.x), Math.floor(PL.y - i - .01), Math.floor(PL.z))) return i; return 99; }
function tryPlunge(){
  if (PL.onGround || PL.inWater || PL.catching || GR.st) return false;
  const gap = groundGap(); if (gap < (PL.gliding ? 1.5 : 2.2) || gap > 30) return false; // never over open sky
  CB.plunge = true; CB.plungeY = PL.y; PL.gliding = false; PL.sailOpen = false; PL.vy = Math.min(PL.vy, -18); PL.vx *= .35; PL.vz *= .35;
  CB.down = false; CB.charging = false; SND.heavy(.8); return true;
}
function plungeSlam(){
  const w = heldWeapon(), drop = Math.max(0, CB.plungeY - PL.y), R = 2.6 + Math.min(1.8, drop * .08);
  animClip(CLIP_PLUNGE, w); SND.slam(1); shockRing(PL.x, PL.y, PL.z, R, [.9, .85, .75]); dust(PL.x, PL.y, PL.z, 14, 3.2);
  camKick = Math.max(camKick, .16); PL.punch = Math.max(PL.punch, 1); CB.dodgeIF = Math.max(CB.dodgeIF, .2); combatT = Math.max(combatT, tAcc - 3);
  CB.lastT = tAcc; CB.lastInt = .6; CB.combo = 0;
  strike({ w, area: [PL.x, PL.z, R], mult: 1.5 + Math.min(1.5, drop * .07), kb: 1.8, poise: 2.5, stop: 1.6, fin: true });
}

/* ---- per frame (play): dodge, guard, charge, queued swings, pending strikes, plunge, aim, stamina, ring ---- */
function combatTick(dt, sdt){
  const gap = tAcc - CB.tickAt; CB.tickAt = tAcc;
  if (gap > .3){ CB.down = false; CB.charging = false; CB.guard = false; } // coming back from a pause: drop held inputs
  if (!CB.movesDone) renderCombatMoves();
  if (dead){ CB.down = CB.charging = CB.guard = CB.plunge = false; CB.pend.length = 0; CB.queued = 0; CB.stam = STAM_MAX; updateStamRing(); return; }
  // the dash is the dodge: i-frames while stamina allows, a sliver without
  if (PL.dashCD > CB.prevDash + .2){ const ok = CB.stam >= ST_DODGE * .5; CB.dodgeIF = ok ? .32 : .12; if (ok){ CB.stam = Math.max(0, CB.stam - ST_DODGE); CB.stamT = .5; } }
  CB.prevDash = PL.dashCD; CB.dodgeIF = Math.max(0, CB.dodgeIF - sdt);
  const w = heldWeapon();
  if (CB.guard){ CB.guardT += sdt; if (!holdingWeapon()) combatGuard(false); }
  CB.guardBreak = Math.max(0, CB.guardBreak - dt); CB.parryT += dt;
  if (CB.down && w.f >= 0){
    if (!CB.charging && tAcc - CB.downT > .2){ CB.charging = true; CB.chargeT = 0; }
    if (CB.charging){ CB.chargeT += sdt;
      if (!CB.full && CB.chargeT >= CHARGE_T[w.f]){ if (CB.stam >= ST_HEAVY * .5){ CB.full = true; SND.chargeFull(); } else if (!CB.tired){ CB.tired = true; dmgNumber(PL.x, PL.y + 2.1, PL.z, 'Tired', 'dot'); } } }
  } else if (CB.charging && w.f < 0){ CB.charging = false; CB.down = false; }
  if (CB.queued && tAcc >= CB.queueAt){ CB.queued = 0; doLight(heldWeapon(), 1); }
  for (let i = CB.pend.length - 1; i >= 0; i--){ const p = CB.pend[i]; p.t -= sdt; if (p.t <= 0){ CB.pend.splice(i, 1); p.fn(); } }
  if (CB.plunge){
    if (PL.inWater || PL.catching || GR.st) CB.plunge = false;
    else if (PL.onGround){ CB.plunge = false; plungeSlam(); }
    else { PL.vy = Math.min(PL.vy, -18); PL.gliding = false; PL.sailOpen = false; PL.glideLock = Math.max(PL.glideLock || 0, .1); }
  }
  if (CB.aim){ const d = CB.aim * Math.min(1, dt * 22); PL.yaw += d; CB.aim -= d; if (Math.abs(CB.aim) < .002) CB.aim = 0; }
  if (CB.stamT > 0) CB.stamT -= dt; else CB.stam = Math.min(STAM_MAX, CB.stam + (CB.guard ? 16 : 36) * dt);
  if (CB.guard || CB.charging) HR.idleT = 0;
  updateStamRing();
}
function updateStamRing(){
  const el = CB.ringEl || (CB.ringEl = $('#stam')); if (!el) return; if (!CB.ringFg) CB.ringFg = el.querySelector('.fg');
  const f = heldWeapon().f, ch = CB.charging && f >= 0 ? Math.min(1, CB.chargeT / CHARGE_T[f]) : -1;
  const k = ch >= 0 ? ch : CB.stam / STAM_MAX, show = state === 'play' && !dead && (ch >= 0 || CB.stam < STAM_MAX - .5 || CB.guard || CB.parryT < .3);
  const mode = CB.parryT < .3 ? 'parry' : ch >= 0 ? (CB.full ? 'full' : 'charge') : CB.guard ? 'guard' : CB.stam < ST_HEAVY ? 'low' : '';
  const key = (show ? 1 : 0) + mode + Math.round(k * 60);
  if (key === CB.ringK) return; CB.ringK = key;
  el.className = (show ? 'on ' : '') + mode; CB.ringFg.style.strokeDashoffset = ((1 - k) * 100.5).toFixed(1);
}

/* ---- journal: the Combat moves ---- */
function renderCombatMoves(){
  const el = $('#jrCombat'); CB.movesDone = true; if (!el) return;
  const K = s => s.split(' ').map(k => KC(k)).join(''), T = TOUCH;
  const MV = [['Attack', T ? K('Mine') : K('LMB'), 'Up to three hits; keep a rhythm, mashing is slower. The third knocks foes back'],
    ['Heavy', T ? K('Mine') + ' hold' : K('LMB') + ' hold', 'Sword sweeps wide, spear lunges, axe cleaves an area, dagger flurries. Uses stamina'],
    ['Block', T ? K('Use') : K('RMB'), 'With a weapon: stops blows from the front for stamina'],
    ['Parry', T ? K('Use') : K('RMB'), 'Raise the guard just as a blow lands: the foe staggers and takes crits'],
    ['Dodge', T ? K('Dash') : K('Q'), 'Dash through an attack untouched'],
    ['Plunge', T ? K('Mine') : K('LMB'), 'While falling or sailing: slam down and hit all around'],
    ['Stagger', '', 'Hits wear down poise; heavies and finishers break it fastest']];
  el.innerHTML = MV.map(m => '<span class="kk">' + m[1] + '</span><span class="mv"><b>' + m[0] + '</b> · ' + m[2] + '</span>').join('');
}

/* ---- sounds: guard, parry, block, charge, heavy, slam, stagger ---- */
SD('parry', { len: .7, n: 2, pri: 4, pk: db(-8), h: .25 }, (c, o, t, r) => { N(c, o, t, .02, 'bandpass', 3800, 2, 1); O(c, o, t, 'sine', 1760 + r() * 30, 1750, .55, .5); O(c, o, t, 'sine', 2637, 2630, .4, .3); O(c, o, t, 'triangle', 880, 875, .3, .25); O(c, o, t, 'sine', 140, 60, .1, .6); });
SD('block', { len: .3, n: 3, pri: 3, pk: db(-12) }, (c, o, t, r) => { N(c, o, t, .06, 'lowpass', 900 + r() * 200, .9, 1); O(c, o, t, 'triangle', 420 + r() * 40, 300, .09, .6); N(c, o, t, .03, 'bandpass', 2400, 2, .4); });
SD('guardUp', { len: .12, n: 2, pri: 2, pk: db(-21) }, (c, o, t, r) => { N(c, o, t, .03, 'bandpass', 2600 + r() * 300, 2, 1); O(c, o, t, 'sine', 1100, 1000, .05, .3); });
SD('guardBreak', { len: .5, n: 1, pri: 4, pk: db(-9) }, (c, o, t, r) => { N(c, o, t, .2, 'lowpass', 700, .8, 1); const f = BQ(c, o, 'lowpass', 900, 1); O(c, f, t, 'sawtooth', 200, 80, .3, .6); N(c, o, t, .02, 'highpass', 4000, .7, .4); });
SD('chargeFull', { len: .35, n: 1, pri: 3, pk: db(-16), h: .15 }, (c, o, t, r) => { O(c, o, t, 'sine', 880, 1320, .1, .5); O(c, o, t + .08, 'sine', 1760, 1758, .22, .6); O(c, o, t + .08, 'sine', 2640, 2636, .16, .2); });
SD('heavy', { len: .5, n: 2, pri: 3, pk: db(-10) }, (c, o, t, r) => { W(c, o, t, .4, 'bandpass', 200, 1800, 400, .9, 1, .45); O(c, o, t + .08, 'sine', 70, 40, .25, .5); });
SD('finisher', { len: .3, n: 2, pri: 3, pk: db(-10) }, (c, o, t, r) => { O(c, o, t, 'sine', 150 + r() * 20, 50, .2, 1); N(c, o, t, .1, 'lowpass', 600, .8, .6); });
SD('slam', { len: .9, n: 2, pri: 4, pk: db(-7), dk: -3, dh: .3 }, (c, o, t, r) => { O(c, o, t, 'sine', 120, 35, .5, 1); N(c, o, t, .4, 'lowpass', 300, .8, .8); N(c, o, t, .05, 'bandpass', 1500, 1.2, .4); for (let i = 0; i < 6; i++) N(c, o, t + .05 + r() * .3, .04, 'bandpass', 700 + r() * 1800, 3, .12); });
SD('stagger', { len: .45, n: 2, pri: 3, pk: db(-15) }, (c, o, t, r) => { for (let i = 0; i < 3; i++) O(c, o, t + i * .07, 'sine', 980 - i * 140, 760 - i * 140, .1, .7); });
SD('dodged', { len: .25, n: 1, pri: 3, pk: db(-17) }, (c, o, t, r) => { O(c, o, t, 'sine', 1600, 2400, .15, .6); W(c, o, t, .18, 'highpass', 2500, 5000, 3000, .7, .4, .3); });
Object.assign(SND, {
  parry(){ fire('parry'); }, block(){ fire('block'); }, guardUp(){ fire('guardUp'); }, guardBreak(){ fire('guardBreak'); }, chargeFull(){ fire('chargeFull'); },
  heavy(g){ fire('heavy', { gain: g || 1 }); }, finisher(){ fire('finisher'); }, slam(g){ fire('slam', { gain: g || 1 }); }, dodged(){ fire('dodged'); },
  stagger(e){ fire('stagger', { pos: e ? { x: e.x, y: e.y + 1, z: e.z } : null }); }
});
