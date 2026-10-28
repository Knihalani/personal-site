
/* =====================================================================
   FIRST-PERSON ANIMATION: one rig, families of clips.
   Families: empty, block, tool, food, sword, spear, axe, dagger, and the grappling hook (drawn while in use).
   Every family has: equip (raise with a flourish), idle sway + breathing, walk/sprint bob by WEIGHT class
   (light hands pump quick and high, heavy ones swing slow and low and lag), use clips with anticipation ->
   strike (with a smear) -> follow-through -> settle, a combo second swing for weapons (attack again inside
   the window), a charged thrust for the spear (hold), block-place push, eat/feed, the grapple's fire recoil,
   reel crank and retract, an idle inspect after ~8 s (a different one per family), and a hit-confirm kick.
   Reduced motion keeps the poses but drops spins, smears and most bob.
   ===================================================================== */
const FAMS = {
  empty: { w: .6, bob: 1.25, lag: 1.2, base: [0, 0, 0, 0, 0, 0] },
  block: { w: .9, bob: 1, lag: 1, base: [0, 0, 0, 0, 0, 0] },
  tool: { w: 1, bob: 1, lag: 1, base: [0, 0, 0, 0, 0, 0] },
  food: { w: .5, bob: 1.2, lag: 1.2, base: [-.02, .02, .02, .05, 0, 0] },
  sword: { w: 1, bob: 1, lag: 1, base: [0, 0, 0, 0, 0, 0] },
  dagger: { w: .55, bob: 1.35, lag: 1.25, base: [.01, .01, .03, 0, 0, -.1] },
  axe: { w: 1.6, bob: .75, lag: .7, base: [.01, -.03, .02, -.06, 0, .05] },
  spear: { w: 1.35, bob: .8, lag: .8, base: [.02, -.04, .06, -.1, .05, 0] },
  grapple: { w: 1.1, bob: .95, lag: .9, base: [-.01, -.01, -.02, 0, .1, 0] }
};
function heldFamily(){ if (GR.st || GR.fireT < .55) return 'grapple'; const s = inv[sel]; if (!s) return 'empty'; if (s.w) return ['sword', 'spear', 'axe', 'dagger'][s.w.f]; if (isBlockItem(s.id)) return 'block'; if (s.id === PICK || s.id === STICK) return 'tool'; return 'food'; }
const K_ = (k) => Clip(k);
// swings: A and B per weapon family (index: 0 sword, 1 spear, 2 axe, 3 dagger, 4 fists); smear [start, end, shape]
const SWING2 = [
  [{ d: .42, ry: K_([[0, 0], [.07, .5, EZ.outQuad], [.14, -1.2, EZ.inCubic], [.26, -1.32, EZ.outQuad], [.42, 0, EZ.inOutSine]]), x: K_([[0, 0], [.07, .1], [.14, -.3, EZ.inCubic], [.42, 0]]), rz: K_([[0, 0], [.14, .42, EZ.inCubic], [.42, 0]]), sm: [.07, .2, 0] },
   { d: .44, ry: K_([[0, 0], [.07, -.48, EZ.outQuad], [.15, 1.12, EZ.inCubic], [.27, 1.24, EZ.outQuad], [.44, 0, EZ.inOutSine]]), x: K_([[0, 0], [.07, -.12], [.15, .26, EZ.inCubic], [.44, 0]]), rz: K_([[0, 0], [.15, -.38, EZ.inCubic], [.44, 0]]), y: K_([[0, 0], [.07, .04], [.15, -.03], [.44, 0]]), sm: [.08, .21, 5] }],
  [{ d: .4, z: K_([[0, 0], [.08, .15, EZ.outQuad], [.14, -.5, EZ.inCubic], [.24, -.42], [.4, 0, EZ.inOutSine]]), rx: K_([[0, 0], [.14, .2], [.4, 0]]), sm: [.09, .2, 1] },
   { d: .32, z: K_([[0, 0], [.06, .08, EZ.outQuad], [.11, -.46, EZ.inCubic], [.2, -.38], [.32, 0]]), ry: K_([[0, 0], [.11, -.12], [.32, 0]]), x: K_([[0, 0], [.11, -.04], [.32, 0]]), sm: [.07, .17, 1] }],
  [{ d: .62, rx: K_([[0, 0], [.17, .98, EZ.outQuad], [.26, -1.28, EZ.inCubic], [.41, -1.42, EZ.outQuad], [.62, 0, EZ.inOutSine]]), z: K_([[0, 0], [.17, .08], [.26, -.18, EZ.inCubic], [.62, 0]]), y: K_([[0, 0], [.17, .07], [.26, -.06], [.62, 0]]), sm: [.17, .33, 2] },
   { d: .66, ry: K_([[0, 0], [.18, .65, EZ.outQuad], [.29, -1.45, EZ.inCubic], [.44, -1.55, EZ.outQuad], [.66, 0, EZ.inOutSine]]), rz: K_([[0, 0], [.18, -.2], [.29, .5, EZ.inCubic], [.66, 0]]), x: K_([[0, 0], [.18, .12], [.29, -.32], [.66, 0]]), sm: [.18, .34, 6] }],
  [{ d: .28, ry: K_([[0, 0], [.04, .3, EZ.outQuad], [.09, -.95, EZ.inCubic], [.17, -1, EZ.outQuad], [.28, 0, EZ.inOutSine]]), z: K_([[0, 0], [.09, -.2, EZ.inCubic], [.28, 0]]), sm: [.05, .14, 3] },
   { d: .26, z: K_([[0, 0], [.05, .12, EZ.outQuad], [.1, -.44, EZ.inCubic], [.18, -.36], [.26, 0]]), rx: K_([[0, 0], [.1, .12], [.26, 0]]), sm: [.06, .14, 1] }],
  [{ d: .3, z: K_([[0, 0], [.05, .1, EZ.outQuad], [.1, -.38, EZ.inCubic], [.3, 0, EZ.inOutSine]]), sm: [0, 0, 0] },
   { d: .3, z: K_([[0, 0], [.05, .08, EZ.outQuad], [.1, -.36, EZ.inCubic], [.3, 0, EZ.inOutSine]]), x: K_([[0, 0], [.1, -.08], [.3, 0]]), sm: [0, 0, 0] }]
];
const CLIP_SPEAR_CHARGED = { d: .55, z: K_([[0, 0], [.07, -.82, EZ.inCubic], [.22, -.74], [.55, 0, EZ.inOutSine]]), rx: K_([[0, 0], [.07, .1], [.55, 0]]), sm: [.0, .12, 1] };
// equips: a raise from below plus a flourish per family
const EQUIP = { sword: K_([[0, .9], [.16, -.25, EZ.outCubic], [.38, 0, EZ.inOutSine]]), axe: K_([[0, .4], [.22, -.1, EZ.outQuad], [.4, .05], [.5, 0]]), dagger: K_([[0, 6.283], [.35, 0, EZ.outCubic]]), spear: K_([[0, -.6], [.3, .08, EZ.outCubic], [.44, 0]]) };
// inspects: per family, ~2.6 s
const INSPECT = {
  sword: { d: 2.6, ry: K_([[0, 0], [.5, 1.15, EZ.inOutSine], [1.3, 1.25], [1.9, .2, EZ.inOutSine], [2.6, 0]]), rz: K_([[0, 0], [.5, -.3], [1.3, -.1], [2.6, 0]]), y: K_([[0, 0], [.5, .08], [2.1, .06], [2.6, 0]]), x: K_([[0, 0], [.5, -.12], [2.1, -.1], [2.6, 0]]) },
  axe: { d: 2.6, y: K_([[0, 0], [.35, .1, EZ.outQuad], [.55, .02, EZ.inQuad], [.9, .11, EZ.outQuad], [1.1, .02, EZ.inQuad], [2.2, .03], [2.6, 0]]), rx: K_([[0, 0], [1.3, .45, EZ.inOutSine], [2.1, .4], [2.6, 0]]), x: K_([[0, 0], [1.3, -.1], [2.6, 0]]) },
  spear: { d: 2.6, gz: K_([[0, 0], [.4, 0], [1.6, 6.283, EZ.inOutSine], [2.6, 6.283]]), y: K_([[0, 0], [.4, .05], [2.2, .05], [2.6, 0]]), x: K_([[0, 0], [.4, -.08], [2.2, -.08], [2.6, 0]]) },
  dagger: { d: 2.0, rz: K_([[0, 0], [.25, 0], [.75, 6.283, EZ.inOutSine], [.9, 6.283], [1.4, 12.566, EZ.inOutSine], [2.0, 12.566]]), y: K_([[0, 0], [.25, .02], [.5, .16, EZ.outQuad], [.75, .02, EZ.inQuad], [1.15, .16, EZ.outQuad], [1.4, .02, EZ.inQuad], [2, 0]]) },
  tool: { d: 2.4, rx: K_([[0, 0], [.3, .35], [.45, -.1, EZ.inCubic], [.75, .35], [.9, -.1, EZ.inCubic], [1.6, .2], [2.4, 0]]), ry: K_([[0, 0], [1.2, .5], [2.4, 0]]) },
  block: { d: 2.4, gy: K_([[0, 0], [2.0, 6.283, EZ.inOutSine], [2.4, 6.283]]), y: K_([[0, 0], [.4, .08], [2.0, .08], [2.4, 0]]), x: K_([[0, 0], [.4, -.12], [2.0, -.12], [2.4, 0]]) },
  food: { d: 2.2, y: K_([[0, 0], [.5, .14, EZ.outQuad], [1.5, .13], [2.2, 0]]), x: K_([[0, 0], [.5, -.22], [1.5, -.2], [2.2, 0]]), rz: K_([[0, 0], [.7, .12], [.9, -.12], [1.1, .1], [1.3, 0], [2.2, 0]]) },
  grapple: { d: 2.2, gz: K_([[0, 0], [1.4, 6.283 * 2, EZ.inOutSine], [2.2, 6.283 * 2]]), y: K_([[0, 0], [.4, .05], [1.8, .05], [2.2, 0]]) },
  empty: { d: 2.0, rx: K_([[0, 0], [.4, .3], [.7, -.1], [1.0, .25], [1.4, 0], [2.0, 0]]), y: K_([[0, 0], [.4, .05], [1.4, .02], [2.0, 0]]) }
};
const AS = { fam: 'empty', combo: 0, lastSwingEnd: -9, lastSwingF: -1, charging: 0, chargeT: 0, charged: false, hitT: 9, gripRZ: 0 };
const _sp = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, gy: 0, gz: 0 };
function sampleClip(S, t, out){ out.x = out.y = out.z = out.rx = out.ry = out.rz = out.gy = out.gz = 0; if (!S || t >= S.d) return out; for (const k of ['x', 'y', 'z', 'rx', 'ry', 'rz', 'gy', 'gz']) if (S[k]) out[k] = clipAt(S[k], t); return out; }
function swingPose(t, f){
  const S = HR.swCharged ? CLIP_SPEAR_CHARGED : (SWING2[f < 0 || f === undefined ? 4 : f] || SWING2[4])[HR.swB || 0];
  sampleClip(S, t, _swp);
  if (smear){ const on = S.sm[1] > 0 && t >= S.sm[0] - .02 && t < S.sm[1] + .12 && !REDUCED; smear.visible = on;
    if (on){ smear.material.uniforms.uP.value = clamp((t - S.sm[0] + .02) / (S.sm[1] - S.sm[0]), 0, 1.4); smear.material.uniforms.uA.value = t < S.sm[1] ? .9 : Math.max(0, 1 - (t - S.sm[1]) / .12) * .9; } }
  return _swp;
}
function animSwing(w, charged){
  const f = w.f >= 0 ? w.f : 4, now = tAcc;
  // combo: a second swing inside the window after the first one's strike becomes the backhand / follow-up
  HR.swB = (f === AS.lastSwingF && now - AS.lastSwingEnd < .55 && HR.swB === 0) ? 1 : 0; if (charged) HR.swB = 0;
  HR.swCharged = !!charged; HR.swT = 0; HR.swF = f; AS.lastSwingF = f;
  const S = charged ? CLIP_SPEAR_CHARGED : SWING2[f][HR.swB]; AS.lastSwingEnd = now + S.d * .6;
  if (smear){ setSmearShape(S.sm[2]); const c = w.f >= 0 && RARITY[w.r] ? RARITY[w.r].k : [1, 1, 1]; smear.material.uniforms.uC.value.setRGB(.55 + c[0] * .45, .55 + c[1] * .45, .55 + c[2] * .45); }
  HR.inspT = 9; HR.idleT = 0;
}
function animHitConfirm(){ AS.hitT = 0; }
// spear charge: hold attack with a spear to draw back; release to lunge (more damage, a step forward)
function spearChargeStart(){ if (heldFamily() !== 'spear' || atkCD > 0) return false; AS.charging = 1; AS.chargeT = 0; return true; }
function spearChargeRelease(){ if (!AS.charging) return false; const full = AS.chargeT > .45; AS.charging = 0; if (full){ AS.charged = true; playerAttack(); AS.charged = false; const f = fwd(), l = hyp2(f.x, f.z) || 1; if (PL.onGround){ PL.vx += f.x / l * 7; PL.vz += f.z / l * 7; } } else playerAttack(); return true; }
function updateHandRig(dt, hs, sliding, bobX, bobY){
  const P = PL, RM = REDUCED ? .3 : 1;
  HR.mineT += dt; HR.placeT += dt; HR.eqT += dt; HR.feedT += dt; AS.hitT += dt; GR.fireT += dt; if (AS.charging) AS.chargeT += dt;
  // equip: lower, swap at the bottom, raise with the new family's flourish
  const fam = heldFamily(), F = FAMS[fam];
  const id = heldId() * 1000 + (inv[sel] && inv[sel].w ? inv[sel].w.f * 10 + inv[sel].w.r + 1 : 0) + (fam === 'grapple' ? 999999 : 0);
  if (id !== HR.held){ if (HR.held !== -1) { HR.eqT = 0; HR.eqSwapped = false; } else { updateHand(); } HR.held = id; }
  if (!HR.eqSwapped && HR.eqT >= .12){ HR.eqSwapped = true; AS.fam = fam; updateHand(); }
  // inertia scaled by weight: heavy things lag more and settle slower
  const yawRate = angDiff(P.yaw, HR.lagYaw || P.yaw) / Math.max(dt, 1e-3), pr = (P.pitch - (HR.lagPitch === undefined ? P.pitch : HR.lagPitch)) / Math.max(dt, 1e-3); HR.lagYaw = P.yaw; HR.lagPitch = P.pitch;
  const lagK = .012 * F.lag * F.w, om = 11 / Math.sqrt(F.w);
  spring(HR.lagX, clamp(yawRate * lagK, -.11, .11), om, dt); spring(HR.lagY, clamp(-pr * .01 * F.w, -.08, .08), om, dt);
  // locomotion: bob amplitude/phase by weight; sprint carries heavy things low, light ones pump
  const sprinting = P.onGround && hs > 7, air = !P.onGround && !P.gliding, dash = P.dashCD > DASH_CD - .25;
  let tx = F.base[0], ty = F.base[1], tz = F.base[2], trx = F.base[3], trz = F.base[5];
  if (sprinting){ tx -= .03; tz += .04; trx -= .18 * F.w; ty -= .03 * (F.w - .6); }
  if (sliding){ ty -= .1; tx -= .06; trz += .35; }
  if (air){ ty += .03; trx += .08 + clamp(P.vy * -.01, -.1, .15); }
  if (dash){ tz += .14; trz -= .25; }
  if (P.gliding){ ty -= .18; trx += .4; }
  if (GR.st === 2){ ty += .05; trx += .25; tz -= .04; } // hanging on the rope: the launcher is raised toward the anchor
  if (AS.charging){ const c = Math.min(1, AS.chargeT / .45); tz += .16 * c; ty -= .03 * c; trx -= .12 * c; tx += Math.sin(tAcc * 40) * .003 * c * RM; }
  const bobK = F.bob * RM, idle = noise1(tAcc * .6, 3) * .012 * RM, breathe = Math.sin(tAcc * 1.6) * .006 * (1 + (1 - Math.min(1, hs)) * .5);
  const so = 12 / Math.sqrt(F.w);
  spring(HR.x, tx + bobX * 1.4 * bobK + idle, so, dt); spring(HR.y, ty + bobY * 1.2 * bobK - P.landKick * .7 * F.w + breathe, so, dt); spring(HR.z, tz, so, dt); spring(HR.rx, trx, so * .85, dt); spring(HR.rz, trz, so * .85, dt);
  // action clips
  const mRx = HR.mineT < CLIP_MINE_RX.d ? clipAt(CLIP_MINE_RX, HR.mineT) : 0, mZ = HR.mineT < CLIP_MINE_Z.d ? clipAt(CLIP_MINE_Z, HR.mineT) : 0;
  const pZ = HR.placeT < CLIP_PLACE_Z.d ? clipAt(CLIP_PLACE_Z, HR.placeT) : 0, eY = HR.eqT < CLIP_EQUIP_Y.d ? clipAt(CLIP_EQUIP_Y, HR.eqT) : 0, fd = HR.feedT < CLIP_FEED.d ? clipAt(CLIP_FEED, HR.feedT) : 0;
  const eqF = EQUIP[AS.fam], eqR = eqF && HR.eqT < eqF.d + .12 ? clipAt(eqF, Math.max(0, HR.eqT - .12)) * RM : 0;
  // grapple: fire recoil, reel crank vibration, retract snap
  const gt = GR.fireT, gFire = gt < .7 ? (gt < .04 ? -gt / .04 * .45 : Math.exp(-(gt - .04) * 6.5) * Math.cos((gt - .04) * 11)) * (REDUCED ? .4 : 1) : 0, reel = GR.reelT > 0 ? 1 : 0, retract = GR.st === 3 ? 1 : 0;
  const hk = AS.hitT < .16 ? Math.sin(AS.hitT / .16 * Math.PI) : 0;
  const bx = .4 + HR.x.x + HR.lagX.x - fd * .34, by = -.33 + HR.y.x + HR.lagY.x + eY + fd * .14 + gFire * .08, bz = -.7 + HR.z.x + mZ + pZ + fd * .2 + gFire * .2 + hk * .04 + retract * .05;
  HR.swT += dt; const sw = swingPose(HR.swT, HR.swF);
  // inspect idle after 8 s still, one clip per family
  HR.idleT = (hs < .1 && P.onGround && !mineHeld && !atkHeld && !GR.st && Math.abs(yawRate) < .05 && Math.abs(pr) < .05) ? HR.idleT + dt : 0;
  const IN = INSPECT[AS.fam] || INSPECT.empty;
  if (HR.idleT > 8 && HR.inspT > IN.d + 1) HR.inspT = 0; if (HR.idleT === 0 && HR.inspT < IN.d) HR.inspT = 9; HR.inspT += dt;
  const ins = sampleClip(REDUCED ? null : IN, HR.inspT, _sp);
  const shake = hk * Math.sin(tAcc * 70) * .012 * RM + reel * Math.sin(tAcc * 55) * .006 * RM;
  hand.position.set(bx - .1 + sw.x + ins.x + shake, by + .06 + sw.y + ins.y, bz + .08 + sw.z + ins.z);
  hand.rotation.set(-.08 + HR.rx.x + mRx * .9 + fd * .3 + sw.rx + ins.rx - gFire * .5 + hk * .06 + (AS.fam === 'spear' ? eqR : 0), .08 - fd * .5 + sw.ry + ins.ry, HR.rz.x + sw.rz + ins.rz + gFire * .14 + (AS.fam === 'sword' ? eqR * .4 : 0));
  if (handGrip){ AS.gripRZ += (reel ? 14 : 0) * dt; handGrip.rotation.set((AS.fam === 'dagger' ? eqR : 0) + (AS.fam === 'axe' ? -eqR * .3 : 0), ins.gy, ins.gz + (AS.fam === 'grapple' ? Math.sin(AS.gripRZ) * .05 * reel : 0)); }
}
