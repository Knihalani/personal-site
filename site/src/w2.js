
/* ================= weapons, rarities, loot tables, chests ================= */
const WEAPON = 130;
I_NAME[WEAPON] = 'Weapon';
const RARITY = [
  { n: 'Common', c: '#cbc3b4', k: [.8, .78, .74], blade: ['#c4c8cf', '#8f949d', '#e8eaee'], glow: 0 },
  { n: 'Uncommon', c: '#86d46f', k: [.52, .83, .44], blade: ['#a9d996', '#6b9f58', '#d9f2cc'], glow: 0 },
  { n: 'Rare', c: '#6db3ff', k: [.43, .7, 1], blade: ['#9cc9ff', '#4f86d6', '#dcecff'], glow: 1 },
  { n: 'Epic', c: '#c98cff', k: [.79, .55, 1], blade: ['#d9b3ff', '#9566d6', '#f1e3ff'], glow: 1 },
  { n: 'Legendary', c: '#ffb84d', k: [1, .72, .3], blade: ['#ffd88a', '#e09a2c', '#fff1cc'], glow: 2 }
];
const FAM = [
  { id: 'sword', noun: 'Sword', dmg: 6, spd: 1.8, reach: 3.3, arc: 1.0, crit: .06, kb: 6, desc: 'Balanced sweeps' },
  { id: 'spear', noun: 'Spear', dmg: 7, spd: 1.3, reach: 4.4, arc: .34, crit: .08, kb: 5, desc: 'Long reach, narrow thrust' },
  { id: 'axe', noun: 'Axe', dmg: 11, spd: .85, reach: 3.0, arc: 1.25, crit: .05, kb: 10, desc: 'Slow, heavy, wide' },
  { id: 'dagger', noun: 'Dagger', dmg: 3.6, spd: 2.8, reach: 2.6, arc: .62, crit: .16, kb: 3, desc: 'Fast, sharp, close' }
];
const FISTS = { f: -1, r: 0, dmg: 2, spd: 2, reach: 2.6, crit: .03, ax: [], nm: 'Fists' };
const RAR_MULT = [1, 1.18, 1.42, 1.72, 2.1];
const AFFIX = [
  { id: 'gust', suf: 'of Gusts', d: 'Knockback +80%' },
  { id: 'ember', pre: 'Ember', d: 'Sets foes burning for 3 s' },
  { id: 'feather', pre: 'Featherweight', d: 'Glide 15% faster while held' },
  { id: 'keen', pre: 'Keen', d: 'Crit chance +10%' },
  { id: 'swift', pre: 'Swift', d: 'Attack speed +15%' },
  { id: 'mend', suf: 'of Mending', d: 'Heal half a heart per kill' }
];
const ADJ = ['Windcutter', 'Skyfall', 'Driftwood', 'Stormglass', 'Gale', 'Sunsteel', 'Hollowpine', 'Brass', 'Thornback', 'Cloudpiercer', 'Moonrust', 'Cinder'];
const LOOT_W = [ // rarity weights per structure tier (percent)
  null, [62, 27, 9, 1.8, .2], [40, 33, 19, 6.5, 1.5], [18, 32, 30, 15, 5]
];
function rollRarity(rand, tier){ const w = LOOT_W[tier]; let s = 0; for (const v of w) s += v; let r = rand() * s; for (let i = 0; i < w.length; i++){ r -= w[i]; if (r < 0) return i; } return 0; }
function rollWeapon(rand, r, f){
  if (f === undefined) f = Math.floor(rand() * FAM.length);
  const F = FAM[f], n = r === 0 ? 0 : r === 1 ? (rand() < .5 ? 1 : 0) : r === 2 ? 1 : r === 3 ? 1 + (rand() < .5 ? 1 : 0) : 2;
  const ax = []; while (ax.length < n){ const a = Math.floor(rand() * AFFIX.length); if (ax.indexOf(a) < 0 && !(ax.some(b => AFFIX[b].pre) && AFFIX[a].pre) && !(ax.some(b => AFFIX[b].suf) && AFFIX[a].suf)) ax.push(a); }
  const has = id => ax.some(a => AFFIX[a].id === id);
  const w = { f, r, ax,
    dmg: +(F.dmg * RAR_MULT[r] * (.9 + rand() * .2)).toFixed(1),
    spd: +(F.spd * (.95 + rand() * .1) * (has('swift') ? 1.15 : 1)).toFixed(2),
    reach: +(F.reach + (r >= 3 ? .2 : 0)).toFixed(1),
    crit: +Math.min(.6, F.crit + .02 * r + (has('keen') ? .1 : 0)).toFixed(2) };
  const pre = ax.map(a => AFFIX[a].pre).filter(Boolean), suf = ax.map(a => AFFIX[a].suf).filter(Boolean);
  w.nm = (pre.length ? pre[0] + ' ' : '') + ADJ[Math.floor(rand() * ADJ.length)] + ' ' + F.noun + (suf.length ? ' ' + suf[0] : '');
  return w;
}
const wHas = (w, id) => !!(w && w.ax && w.ax.some(a => AFFIX[a] && AFFIX[a].id === id));
function wFull(w){ return RARITY[w.r].n + ' ' + w.nm; }
function wDps(w){ return w.dmg * w.spd * (1 + w.crit * .75); }
const LOOT_MATS = [[COBBLE, 4, 9], [ORE, 1, 3], [STICK, 3, 7], [PLANKS, 4, 10], [LANTERN, 1, 2], [LOG, 2, 5]];
function rollChest(rand, tier){
  const items = [];
  const nW = rand() < [0, .75, .9, 1][tier] ? (tier === 3 && rand() < .35 ? 2 : 1) : 0;
  for (let i = 0; i < nW; i++) items.push({ id: WEAPON, n: 1, w: rollWeapon(rand, rollRarity(rand, tier)) });
  const nm = 1 + Math.floor(rand() * (tier + 1));
  for (let i = 0; i < nm; i++){ const m = LOOT_MATS[Math.floor(rand() * LOOT_MATS.length)]; items.push({ id: m[0], n: m[1] + Math.floor(rand() * (m[2] - m[1] + 1)) }); }
  items.push({ id: rand() < .55 ? BUN : BISCUIT, n: 1 + Math.floor(rand() * 2) });
  return items;
}
function seededRand(a, b, c){ return wgenInline.api.mulberry(((OUT_SEED * 31 + a) * 131 + b) * 7919 + (c || 0)); }

function weaponIconURL(w){ const key = 'w' + w.f + '_' + w.r; if (iconCache[key]) return iconCache[key]; const cv = D.createElement('canvas'); cv.width = cv.height = 32; drawWeapon(cv.getContext('2d'), w.f, w.r); return (iconCache[key] = cv.toDataURL()); }
const slotIcon = s => s.w ? weaponIconURL(s.w) : iconURL(s.id);
const slotName = s => s.w ? s.w.nm : s.bk ? bookTitle(s) : itemName(s.id);

/* ---- chests: two instanced meshes (body + hinged lid), loot rolled from the seed ---- */
const CHESTS = []; const chestLooted = new Map(); // key 'k:i' -> time opened (ms since epoch)
const CHEST_RESPAWN_MS = 30 * 60 * 1000;
let chestBody = null, chestLid = null, chestGlow = null;
function buildChestMeshes(){
  const W = [.42, .27, .16], W2 = [.5, .33, .2], IRON = [.32, .32, .36], LATCH = [.85, .66, .28];
  const body = boxGeo([[0, .3, 0, .9, .6, .62, W], [0, .3, 0, .94, .08, .66, IRON], [-.38, .3, 0, .08, .62, .66, IRON], [.38, .3, 0, .08, .62, .66, IRON], [0, .05, 0, .94, .1, .66, W2]]);
  const lid = boxGeo([[0, .12, .31, .92, .24, .64, W2], [0, .25, .31, .94, .06, .66, IRON], [-.38, .12, .31, .08, .26, .66, IRON], [.38, .12, .31, .08, .26, .66, IRON], [0, .02, .64, .14, .18, .06, LATCH]]);
  chestBody = instMesh(body, litMat({ rim: .35 }), 40); chestBody.count = 0;
  chestLid = instMesh(lid, litMat({ rim: .35 }), 40); chestLid.count = 0;
  const gg = new THREE.PlaneGeometry(1, 1); chestGlow = new THREE.InstancedMesh(gg, new THREE.ShaderMaterial({ uniforms: { uTime: U.uTime }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying vec2 vU; varying vec3 vC; void main(){ vU = uv; vC = instanceColor; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uTime; varying vec2 vU; varying vec3 vC; void main(){ float x = abs(vU.x - 0.5) * 2.0; float a = (1.0 - x * x) * smoothstep(0.0, 0.15, vU.y) * (1.0 - vU.y) * (0.7 + 0.3 * sin(uTime * 3.0 + vU.y * 9.0)); gl_FragColor = vec4(vC * a, a); }` }), 64);
  chestGlow.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(64 * 3), 3); chestGlow.count = 0; chestGlow.frustumCulled = false; scene.add(chestGlow);
}
function chestKey(c){ return c.k + ':' + c.i; }
function registerChests(I, r){
  r.chests.forEach((c, i) => {
    const key = I.k + ':' + i, t = chestLooted.get(key), looted = t !== undefined && Date.now() - t < CHEST_RESPAWN_MS;
    // the chest faces the open side (first free horizontal neighbour)
    let yaw = 0; for (const [dx, dz, a] of [[0, 1, 0], [1, 0, Math.PI / 2], [0, -1, Math.PI], [-1, 0, -Math.PI / 2]]){ if (!B_SOLID[getB(c.x + dx, c.y, c.z + dz)]){ yaw = a; break; } }
    CHESTS.push({ k: I.k, i, x: c.x, y: c.y, z: c.z, tier: c.tier, s: c.s, grapple: !!c.grapple, lock: !!c.lock, mod: c.mod || '', special: c.special || '', yaw, open: looted ? 1 : 0, lid: Spr(looted ? 1 : 0), opened: looted, shake: 0, roll: t !== undefined && !looted ? 1 : 0 });
  });
}
function nearestChest(maxD){
  let best = null, bd = maxD; const f = fwd();
  for (const c of CHESTS){ if (c.opened) continue; const dx = c.x + .5 - EYE.x, dy = c.y + .4 - EYE.y, dz = c.z + .5 - EYE.z, d = hyp3(dx, dy, dz); if (d > bd) continue; const dot = (dx * f.x + dy * f.y + dz * f.z) / d; if (dot > .82){ bd = d; best = c; } }
  return best;
}
function openChest(c){
  if (c.opened) return; if (c.lock && !MODDONE.has(c.mod)){ const M = MODRT.find(q => q.key === c.mod); toast('Sealed. ' + (M && M.hint ? M.hint + '.' : 'Solve this island\'s challenge to open it.')); SND.deny(); c.shake = .12; return; }
  c.opened = true; c.shake = .18; chestLooted.set(chestKey(c), Date.now()); wildStats.chests++; saveDirty = true;
  const rand = seededRand(c.k, c.i, c.roll), items = rollChest(rand, c.tier); { const bk = rollBook(Math.random, c.tier); if (bk) items.push({ id: BOOK0 + bookRarity(bk), n: 1, bk: bk.slug }); }
  let best = 0; for (const it of items) if (it.w) best = Math.max(best, it.w.r);
  SND.chestOpen(best, c); animPlace();
  if (c.grapple && !GEAR.grapple) setTimeout(grantGrapple, 650);
  if (c.mod) modChestOpened(c);
  setTimeout(() => {
    const R = RARITY[best], cx = c.x + .5, cy = c.y + .7, cz = c.z + .5;
    const k = R.k; for (let i = 0; i < 26; i++){ const a = Math.random() * 6.283, sp = 2 + Math.random() * 3; emit(cx, cy, cz, Math.cos(a) * sp, 3 + Math.random() * 4, Math.sin(a) * sp, k[0], k[1], k[2], .2, 1.1, 2, 9); }
    sparkle(cx, cy + .3, cz, 14, k[0], k[1], k[2]); PL.punch = Math.max(PL.punch, .5 + best * .15);
    items.forEach((it, j) => setTimeout(() => { const d = spawnDrop(it.id, cx, cy + .2, cz, it.w, it.n); if (d){ if (it.bk) d.bk = it.bk; const a = c.yaw + (j - (items.length - 1) / 2) * .5; d.vx = Math.sin(a) * 2.6; d.vz = Math.cos(a) * 2.6; d.vy = 5.5; d.age = -.3; } }, 90 * j));
    if (best >= 4) SND.legendary();
    renderJournalSoon();
  }, 190);
}
function tickChestRespawn(){
  const now = Date.now();
  for (const c of CHESTS) if (c.opened && Date.now() - (chestLooted.get(chestKey(c)) || now) > CHEST_RESPAWN_MS){ c.opened = false; c.roll++; c.lid.x = 0; c.lid.v = 0; }
}
let chestRespT = 0;
function updateChests(dt, t){
  if (!chestBody) return; let n = 0; chestRespT -= dt; if (chestRespT <= 0){ chestRespT = 10; tickChestRespawn(); }
  for (const c of CHESTS){
    if (Math.abs(c.x - PL.x) > renderDist + 10 || Math.abs(c.z - PL.z) > renderDist + 10) continue;
    spring(c.lid, c.opened ? 1 : 0, c.opened ? 9 : 14, dt); c.shake = Math.max(0, c.shake - dt);
    const sh = c.shake > 0 ? Math.sin(t * 70) * .05 * (c.shake / .18) : 0;
    _m0.makeRotationY(c.yaw + sh); _m0.setPosition(c.x + .5, c.y, c.z + .5); chestBody.setMatrixAt(n, _m0);
    _m2.makeTranslation(c.x + .5, c.y, c.z + .5); _m1.makeRotationY(c.yaw + sh); _m2.multiply(_m1); _m1.makeTranslation(0, .6, -.31); _m2.multiply(_m1); _m1.makeRotationX(-c.lid.x * 1.85); _m2.multiply(_m1); // hinge at the back edge
    chestLid.setMatrixAt(n, _m2);
    _col.setRGB(1, 1, 1); if (c.tier === 3) _col.setRGB(.88, .95, 1.15); else if (c.tier === 2) _col.setRGB(1.08, 1, .9); chestBody.setColorAt(n, _col); chestLid.setColorAt(n, _col);
    n++;
  }
  chestBody.count = chestLid.count = n; chestBody.visible = chestLid.visible = n > 0;
  chestBody.instanceMatrix.needsUpdate = chestLid.instanceMatrix.needsUpdate = true; if (n){ chestBody.instanceColor.needsUpdate = chestLid.instanceColor.needsUpdate = true; }
}
const wildStats = { chests: 0, kills: 0, deaths: 0, best: null };
