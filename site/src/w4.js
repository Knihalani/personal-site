
/* ================= Wilds content (w4): themes, names, content modules, pads, trails, hazards, atlas =================
   An outer island = terrain archetype x biome x THEME x 2-4 CONTENT MODULES, all from the outer seed.
   - Themes give the island an identity, a generated name ("The Drowned Belfry", "Kiln of Ashes") and module affinities.
   - Modules are self-contained encounters: they place their own blocks at generation time (straight into the world
     before lighting and meshing), spawn their own enemies, hold a sealed reward chest, and run a tick only while the
     player is near the island.
   - Combination rules: no two islands in a seed share a theme+module set; a child island never repeats its parent's
     theme or primary module category; at most two modules of one category per island; tiers rise with link depth.
   - Reachability by construction: every link gets a flat landing pad on the target island (clear of updrafts) and a
     launch pad on the source island beside its updraft; trails (graded, max one block per step, carved through
     terrain, bridged over gaps) join the landing pad to every launch pad, every module entrance and the vault.
*/
const MODDONE = new Set(), REVEALED = new Set(), MODRT = [], STONED = new Map();
const THEMES = [
  { id: 'belfry', a: ['The Drowned', 'The Sunken', 'The Silent'], n: ['Belfry', 'Carillon', 'Bell Tower'], b: [0, 3], m: { bells: 5, sunken: 4, library: 2, braziers: 1 } },
  { id: 'kiln', a: ['Kiln of', 'Forge of', 'Hearth of'], n: ['Ashes', 'Cinders', 'Embers'], b: [4, 1], m: { camp: 3, ore: 3, braziers: 3, nest: 1 }, hz: 'vents' },
  { id: 'moonmoth', a: ['Moonmoth', 'Glimmerwing', 'Lanternfly'], n: ['Hollow', 'Glade', 'Dell'], b: [3, 0], m: { grove: 5, observatory: 2, cave: 3 } },
  { id: 'wreck', a: ['Wreck of the', 'Grave of the', 'Rest of the'], n: ['Wayfarer', 'Albatross', 'Long Gale'], b: [1, 2, 4], m: { ship: 6, crumble: 2, ambush: 3 } },
  { id: 'orrery', a: ['The Star', 'The Night', 'The Far'], n: ['Orrery', 'Lantern', 'Watch'], b: [2, 0], m: { observatory: 6, spire: 3, braziers: 2 } },
  { id: 'warband', a: ['Warband', 'Raider', 'Tusk'], n: ['Rock', 'Hold', 'Stockade'], b: [1, 4, 0], m: { camp: 6, nest: 3, arena: 2 } },
  { id: 'trials', a: ['Ring of', 'Circle of', 'Court of'], n: ['Trials', 'Echoes', 'Thorns'], b: [0, 1, 4], m: { arena: 6, plates: 3, ambush: 2 } },
  { id: 'archive', a: ['The Hushed', 'The Lost', 'The Leaning'], n: ['Archive', 'Library', 'Scriptorium'], b: [0, 3], m: { library: 6, cave: 3, plates: 2 } },
  { id: 'orchard', a: ['Giantroot', 'Elderbough', 'Sunfruit'], n: ['Orchard', 'Grove', 'Canopy'], b: [0, 3], m: { tree: 6, grove: 3, trader: 2 } },
  { id: 'delve', a: ['The Glittering', 'The Hollow', 'The Gleaming'], n: ['Delve', 'Seam', 'Deep'], b: [1, 2, 4], m: { ore: 6, cave: 3, nest: 2 } },
  { id: 'gale', a: ['Gale', 'Windward', 'Squall'], n: ['Steps', 'Spur', 'Run'], b: [2, 1], m: { motes: 4, crumble: 4, glide: 4 }, hz: 'gust' },
  { id: 'frostcrown', a: ['Frostcrown', 'Icefang', 'Rimecrown'], n: ['Peak', 'Needle', 'Spire'], b: [2], m: { spire: 5, braziers: 3, ore: 2 }, hz: 'frost' },
  { id: 'drift', a: ['Drifting', 'Weightless', 'Floating'], n: ['Motes', 'Gardens', 'Shoals'], b: [3, 0, 2], m: { motes: 4, gauntlet: 5, grove: 2 }, hz: 'lowgrav' },
  { id: 'landing', a: ["Tinker's", "Wanderer's", "Trader's"], n: ['Landing', 'Rest', 'Perch'], b: [0, 1, 3], m: { trader: 6, ship: 2, library: 2 } },
  { id: 'sanctum', a: ['The Ember', 'The Pale', 'The Waking'], n: ['Sanctum', 'Altar', 'Chapel'], b: [4, 2, 0], m: { braziers: 5, plates: 3, arena: 2 } },
  { id: 'hive', a: ['The Humming', 'The Teeming', 'The Buzzing'], n: ['Hive', 'Burrow', 'Warren'], b: [3, 4], m: { nest: 6, grove: 2, ambush: 3 } }
];
const THEME_VAULT = { id: 'vault', a: ['The Sky', 'The High', 'The Sealed'], n: ['Vault', 'Reliquary', 'Strongroom'], m: {} };
const THEME_GOLD = { id: 'gilded', a: ['The Gilded', 'The Golden', 'The Shining'], n: ['Isle', 'Crown', 'Rest'], m: {} };
const MCAT = { braziers: 'puzzle', plates: 'puzzle', bells: 'puzzle', motes: 'move', crumble: 'move', gauntlet: 'move', spire: 'move', glide: 'move', camp: 'fight', arena: 'fight', ambush: 'fight', nest: 'fight',
  cave: 'explore', sunken: 'explore', library: 'explore', ship: 'explore', observatory: 'explore', ore: 'resource', tree: 'resource', grove: 'resource', trader: 'resource', vault: 'fight' };
const MLABEL = { braziers: 'Light the braziers', plates: 'Pressure plates', bells: 'Bell chimes', motes: 'Wisp run', crumble: 'Crumbling steps', gauntlet: 'Grapple gauntlet', spire: 'Spire climb', glide: 'Gale corridor',
  camp: 'Warband chief', arena: 'Ritual arena', ambush: 'Ruin ambush', nest: 'Spore nest', cave: 'Hidden cave', sunken: 'Sunken shrine', library: 'Overgrown library', ship: 'Crashed sky-ship', observatory: 'Observatory',
  ore: 'Rare ore veins', tree: 'Giant tree', grove: 'Firefly grove', trader: 'Wandering trader', vault: 'Sky Vault' };
// modules that fit a small islet (they mostly build out over the void)
const MSMALL = { motes: 1, crumble: 1, gauntlet: 1, glide: 1, ore: 1, spire: 1, braziers: 1, bells: 1 };
const LORE = ['The first sky-sailors read the wind by the colour of the clouds: pale meant a long glide, bruised meant home.', 'Lanterns were hung on every rim so that no traveller would land in the dark. Most of them still burn.',
  'The spires grow a finger-width each century. The old maps are all slightly wrong, and slightly shorter.', 'Bells were cast to the note of each island. A ship lost in fog could find its harbour by ear.',
  'Goblins keep no calendar. They count seasons by how many times the ash has fallen.', 'The crystal vaults were sealed by people who expected to come back. Nobody knows why they did not.',
  'Moonmoths only light up for those who wait. Impatient travellers swear they are a myth.', 'An updraft is just warm air remembering where it wants to go.',
  'The archipelago drifts. Islands that were neighbours a thousand years ago now barely see each other.', 'Every library out here has a missing shelf. Nobody agrees on what was on it.'];
function themeName(T, rand){ return T.a[(rand() * T.a.length) | 0] + ' ' + T.n[(rand() * T.n.length) | 0]; }
// ---- assignment at layout time (pure data, cheap) ----
function assignContent(){
  const rand = wgenInline.api.mulberry(OUT_SEED ^ 0x51ed2701), used = new Set(), combos = new Set(), parent = new Map(), names = new Set();
  for (const [a, I] of WILD_LINKS) parent.set(I.k, a.gate ? null : a);
  const order = OUT.slice().sort((p, q) => (p.depthL || 0) - (q.depthL || 0));
  // one golden island per seed: mid-depth, not the vault
  const mid = OUT.filter(I => !I.forceVault && (I.depthL || 0) >= 3 && I.r >= 9); const gold = mid.length ? mid[(rand() * mid.length) | 0] : null;
  for (const I of order){
    const P = parent.get(I.k), tier = (I.depthL || 1) <= 2 ? 1 : (I.depthL || 1) <= 4 ? 2 : 3; I.tier = tier; I.golden = I === gold;
    let T;
    if (I.forceVault) T = THEME_VAULT; else if (I.golden) T = THEME_GOLD;
    else { let best = null, bs = -1; for (const t of THEMES){ if (P && P.theme === t.id) continue; const s = (t.b.includes(I.b) ? 3 : .6) * (used.has(t.id) ? .08 : 1) * (.5 + rand()); if (s > bs){ bs = s; best = t; } } T = best; }
    used.add(T.id); I.theme = T.id; I.hz = T.hz || '';
    let nm = themeName(T, rand), g = 0; while (names.has(nm) && g++ < 12) nm = themeName(T, rand); if (names.has(nm)) nm = nm + ' of ' + I.name; names.add(nm); I.place = I.name; I.name = nm;
    const n = I.forceVault ? 2 : I.golden ? 3 : I.r < 9 ? 2 : I.r < 16 ? 3 : 4;
    let mods = [];
    for (let tries = 0; tries < 30; tries++){
      mods = I.forceVault ? ['vault'] : I.golden ? ['plates', 'motes'] : [];
      const pool = Object.keys(MCAT).filter(m => m !== 'vault');
      while (mods.length < n){ let best = null, bs = -1;
        for (const m of pool){ if (mods.includes(m)) continue; if (I.r < 9 && !MSMALL[m]) continue; if (m === 'sunken' && I.arch === 'atoll') continue;
          const cat = MCAT[m], nc = mods.filter(x => MCAT[x] === cat).length; if (nc >= 2) continue;
          if (!mods.length && P && P.mods && MCAT[P.mods[0]] === cat) continue; // neighbours contrast: different primary activity
          const s = ((T.m[m] || 0) + .5) * (.3 + rand()); if (s > bs){ bs = s; best = m; } }
        if (!best) break; mods.push(best); }
      const key = T.id + ':' + mods.slice().sort().join(','); if (!combos.has(key)){ combos.add(key); break; }
    }
    I.mods = mods;
  }
}
// disc offsets per radius for site(), and a height histogram (hTop is -1..WY-1, stored +1)
const DISC_OFF = {}, SITE_H = new Int32Array(WY + 2);
function discOff(R){ let o = DISC_OFF[R]; if (o) return o; const a = []; for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dz * dz <= R * R + R) a.push(dx, dz); return DISC_OFF[R] = Int16Array.from(a); }
// ---- generation-time API (runs on the main thread inside applyIsland, before lighting and meshing) ----
const SURF_DEF = () => GRASS;
function contentAPI(I, r){
  const rand = wgenInline.api.mulberry((OUT_SEED ^ (I.k * 0x9e3779b1)) >>> 0), X = { x0: 1e9, z0: 1e9, x1: -1e9, z1: -1e9 }, used = [];
  const inI = (x, z) => x >= 0 && z >= 0 && x < WX && z < WZ && isl[x + z * WX] === OUT_ISL0 + I.k;
  const A = { I, r, rand, X, used,
    put(x, y, z, id){ x |= 0; y |= 0; z |= 0; if (x < 0 || y < 1 || z < 0 || x >= WX || y >= WY - 1 || z >= WZ) return; world[x + WX * (z + WZ * y)] = id; if (x < X.x0) X.x0 = x; if (x > X.x1) X.x1 = x; if (z < X.z0) X.z0 = z; if (z > X.z1) X.z1 = z; },
    get(x, y, z){ return getB(x | 0, y | 0, z | 0); }, inI,
    top(x, z){ return inI(x, z) ? hTop[x + z * WX] : -1; },
    surf(x, z){ const t = A.top(x, z); const b = t >= 0 ? getB(x, t, z) : 0; return b && b !== WATER && B_SOLID[b] ? b : SURF_DEF(); },
    clear(x, y, z, h){ for (let k = 0; k < h; k++) A.put(x, y + k, z, 0); },
    // flatten a disc to ground height gy (the standing height is gy + 1)
    flatten(cx, cz, R, gy){ for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++){ if (dx * dx + dz * dz > R * R + R) continue; const x = cx + dx, z = cz + dz; if (!inI(x, z)) continue; const s = A.surf(x, z);
      for (let y = gy + 1; y < Math.min(WY - 2, gy + 14); y++) A.put(x, y, z, 0); for (let y = gy - 3; y < gy; y++) if (!B_SOLID[getB(x, y, z)]) A.put(x, y, z, I.b === 2 ? STONE : DIRT); A.put(x, gy, z, s); hTop[x + z * WX] = gy; } },
    // pick a site: island columns within R all present, far from other sites; flattened to the median height
    site(R, opt){ opt = opt || {}; const cand = [];
      for (let z = I.bbox[1]; z <= I.bbox[3]; z += 2) for (let x = I.bbox[0]; x <= I.bbox[2]; x += 2) if (inI(x, z)) cand.push([x, z]);
      for (let pass = 0; pass < 2; pass++) for (let Rt = R; Rt >= Math.max(1, R - 3); Rt--){ let best = null, bs = -1e9; const need = pass ? .55 : (opt.cov || .86);
        const off = discOff(Rt), n = off.length >> 1, kk = OUT_ISL0 + I.k;
        for (let t = 0; t < 160 && cand.length; t++){ const [x, z] = cand[(rand() * cand.length) | 0]; let cov = 0;
          // coverage first (cheap), then spacing, and only then the height median/spread (a histogram, no sort)
          for (let o = 0; o < off.length; o += 2){ const xx = x + off[o], zz = z + off[o + 1]; if (xx >= 0 && zz >= 0 && xx < WX && zz < WZ && isl[xx + zz * WX] === kk) cov++; }
          if (cov < n * need) continue; let near = 1e9; for (const u of used) near = Math.min(near, Math.hypot(u.x - x, u.z - z) - u.R - Rt);
          if (near < 2) continue; SITE_H.fill(0); let lo = WY, hi = -1;
          for (let o = 0; o < off.length; o += 2){ const xx = x + off[o], zz = z + off[o + 1]; if (xx >= 0 && zz >= 0 && xx < WX && zz < WZ && isl[xx + zz * WX] === kk){ const h = hTop[xx + zz * WX] + 1; SITE_H[h]++; if (h < lo) lo = h; if (h > hi) hi = h; } }
          let med = lo, c = 0; const mi = cov >> 1; for (let h = lo; h <= hi; h++){ c += SITE_H[h]; if (c > mi){ med = h; break; } } med--; const spread = hi - lo;
          const sc = Math.min(near, 30) * .2 - spread * .5 - Math.hypot(x - I.x, z - I.z) * .05 + rand(); if (sc > bs){ bs = sc; best = { x, z, y: med + 1, R: Rt }; } }
        if (best){ used.push(best); if (!opt.noFlat) A.flatten(best.x, best.z, Rt, best.y - 1); return best; } }
      return null; },
    // walk from the centre outward along an angle to the last island column
    rim(ang){ let lx = Math.round(I.x), lz = Math.round(I.z); for (let s = 0; s < I.r * 2.5; s++){ const x = Math.round(I.x + Math.cos(ang) * s), z = Math.round(I.z + Math.sin(ang) * s); if (inI(x, z)){ lx = x; lz = z; } } return { x: lx, z: lz, y: A.top(lx, lz) + 1, ang }; },
    freeAngle(){ let best = 0, bs = -1; for (let t = 0; t < 24; t++){ const a = rand() * 6.283; let d = 9; for (const p of (I.padAngs || [])){ const da = Math.abs(((a - p + 9.42) % 6.283) - 3.14); d = Math.min(d, da); } if (d > bs){ bs = d; best = a; } } (I.padAngs = I.padAngs || []).push(best); return best; },
    chest(x, y, z, tier, M, opt){ opt = opt || {}; r.chests.push({ x, y, z, tier: Math.min(3, tier), s: -1, lock: opt.lock !== false, mod: M.key, special: opt.special || '' }); A.put(x, y, z, 0); A.put(x, y + 1, z, 0); M.chestAt = [x, y, z]; },
    enemy(type, x, y, z, M, extra){ const s = Object.assign({ type, x: x + .5, y, z: z + .5, guard: true, mod: M ? M.key : '' }, extra || {}); r.spawns.push(s); return s; },
    lamp(x, y, z){ A.put(x, y, z, LOG); A.put(x, y + 1, z, LAMP); },
    // graded trail between two standing points (2 wide), carved through terrain and bridged over gaps
    trail(ax, ay, az, bx, by, bz){ const n = Math.max(Math.abs(bx - ax), Math.abs(bz - az)); if (!n) return; let y = ay; const px = -(bz - az) / n, pz = (bx - ax) / n;
      for (let i = 0; i <= n; i++){ const x = Math.round(ax + (bx - ax) * i / n), z = Math.round(az + (bz - az) * i / n), left = n - i, want = by - y; if (want > 0 && (left <= want || rand() < .5)) y++; else if (want < 0 && (left <= -want || rand() < .5)) y--;
        for (const w of [0, 1]){ const xx = Math.round(x + px * w), zz = Math.round(z + pz * w); const g = getB(xx, y - 1, zz); if (!B_SOLID[g] || g === LEAVES || g === WATER) A.put(xx, y - 1, zz, inI(xx, zz) ? GRAVEL : BRIDGE); else if (inI(xx, zz) && g !== GRAVEL && rand() < .7) A.put(xx, y - 1, zz, GRAVEL);
          for (let k = 0; k < 3; k++){ const c = getB(xx, y + k, zz); if (c && c !== CHEST && c !== LAMP) A.put(xx, y + k, zz, 0); } } } }
  };
  return A;
}
// ---- the module pool: build(M, A) places blocks/entities and sets M.ex/M.ey/M.ez (the entrance a trail leads to) ----
const MOD = {};
const plateAt = (x, y, z) => Math.floor(PL.x) === x && Math.floor(PL.z) === z && Math.abs(PL.y - y) < .7 && PL.onGround;
function ring(A, cx, cz, R, n, f){ for (let i = 0; i < n; i++){ const a = i / n * 6.283 + .3; f(Math.round(cx + Math.cos(a) * R), Math.round(cz + Math.sin(a) * R), i, a); } }
// puzzles
MOD.braziers = { R: 6, build(M, A){ const s = A.site(6); if (!s) return false; const { x, y, z } = s; M.order = [0, 1, 2, 3].sort(() => A.rand() - .5); M.br = [];
    ring(A, x, z, 4, 4, (bx, bz, i, a) => { A.put(bx, y, bz, COBBLE); A.put(bx, y + 1, bz, BASALT); const px = Math.round(x + Math.cos(a) * 2.5), pz = Math.round(z + Math.sin(a) * 2.5); A.put(px, y - 1, pz, STEP);
      const rank = M.order.indexOf(i); for (let k = 0; k <= rank; k++){ const qx = Math.round(bx + Math.cos(a + 1.57) * (k - 1.5) * 1), qz = Math.round(bz + Math.sin(a + 1.57) * (k - 1.5) * 1); if (qx !== bx || qz !== bz) A.put(qx, y - 1, qz, JSTONE); }
      M.br.push({ bx, bz, px, pz }); });
    A.chest(x, y, z, A.I.tier, M); M.ex = x + 2; M.ey = y; M.ez = z; M.next = 0; M.hint = 'Light the braziers in the order the carved pips show'; return true; },
  tick(M){ if (M.done) return; M.br.forEach((b, i) => { const on = plateAt(b.px, M.y, b.pz); if (on && M.on !== i){ M.on = i;
      if (M.order[M.next] === i && !b.lit){ b.lit = true; modSet(b.bx, M.y + 1, b.bz, LANTERN); M.next++; SND.chime(M.next + 2); sparkle(b.bx + .5, M.y + 2, b.bz + .5, 8, 1, .7, .3); if (M.next === 4) modComplete(M); }
      else if (!b.lit){ M.next = 0; M.br.forEach(q => { if (q.lit){ q.lit = false; modSet(q.bx, M.y + 1, q.bz, BASALT); } }); SND.deny(); toast('The flames gutter out. Count the carved pips.'); } } else if (!on && M.on === i) M.on = -1; }); },
  solved(M){ M.br.forEach(b => modSet(b.bx, M.y + 1, b.bz, LANTERN)); } };
MOD.plates = { R: 7, build(M, A){ const s = A.site(7); if (!s) return false; const { x, y, z } = s; M.pl = []; for (let i = 0; i < 5; i++){ const a = A.rand() * 6.283, d = 3 + A.rand() * 3.5, px = Math.round(x + Math.cos(a) * d), pz = Math.round(z + Math.sin(a) * d); if (M.pl.some(p => p.x === px && p.z === pz) || (Math.abs(px - x) < 2 && Math.abs(pz - z) < 2)) { i--; continue; } A.put(px, y - 1, pz, STEP); M.pl.push({ x: px, z: pz, on: false }); }
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) for (let k = 0; k < 2; k++) A.put(x + dx, y + k, z + dz, RUIN); A.chest(x, y, z, A.I.tier + (A.I.golden ? 1 : 0), M, A.I.golden ? { special: 'gold' } : {}); M.ex = x; M.ey = y; M.ez = z + 2; M.t = -1; M.hint = 'Press all five stone plates before the time runs out'; return true; },
  tick(M, dt){ if (M.done) return; if (M.t >= 0){ M.t += dt; if (M.t > 16){ M.t = -1; M.pl.forEach(p => { if (p.on){ p.on = false; modSet(p.x, M.y - 1, p.z, STEP); } }); SND.deny(); toast('Too slow. The plates sink back.'); } }
    for (const p of M.pl) if (!p.on && plateAt(p.x, M.y, p.z)){ p.on = true; if (M.t < 0){ M.t = 0; toast('Sixteen seconds. Find the other plates!'); } modSet(p.x, M.y - 1, p.z, ORE); SND.chime(M.pl.filter(q => q.on).length + 4); if (M.pl.every(q => q.on)) modComplete(M); } },
  solved(M){ M.pl.forEach(p => modSet(p.x, M.y - 1, p.z, ORE)); } };
MOD.bells = { R: 6, build(M, A){ const s = A.site(6); if (!s) return false; const { x, y, z } = s; M.bl = []; M.seq = []; for (let i = 0; i < 5; i++) M.seq.push((A.rand() * 4) | 0);
    ring(A, x, z, 4, 4, (bx, bz, i, a) => { for (let k = 0; k < 3; k++) A.put(bx, y + k, bz, LOG); A.put(bx, y + 3, bz, CRYSTAL); const px = Math.round(x + Math.cos(a) * 2.6), pz = Math.round(z + Math.sin(a) * 2.6); A.put(px, y - 1, pz, STEP); M.bl.push({ px, pz }); });
    A.put(x, y - 1, z, JSTONE); A.chest(x + 1, y, z - 4, A.I.tier, M); M.ex = x - 2; M.ey = y; M.ez = z + 1; M.hint = 'Step on the centre stone to hear the tune, then play it back on the bells'; M.k = 0; return true; },
  tick(M, dt){ if (M.done) return; const tone = i => SND.chime([0, 2, 4, 7][i]);
    if (plateAt(M.x, M.y, M.z)){ if (!M.play){ M.play = { i: 0, t: 0 }; M.k = 0; } } if (M.play){ M.play.t -= dt; if (M.play.t <= 0){ if (M.play.i >= M.seq.length) M.play = null; else { tone(M.seq[M.play.i]); M.play.i++; M.play.t = .55; } } }
    M.bl.forEach((b, i) => { const on = plateAt(b.px, M.y, b.pz); if (on && M.on !== i){ M.on = i; tone(i); sparkle(b.px + .5, M.y + 1.5, b.pz + .5, 4, .7, .9, 1); if (M.seq[M.k] === i){ M.k++; if (M.k === M.seq.length) modComplete(M); } else M.k = M.seq[0] === i ? 1 : 0; } else if (!on && M.on === i) M.on = -1; }); } };
// movement
MOD.motes = { R: 4, build(M, A){ const s = A.site(3); if (!s) return false; const { x, y, z } = s; A.put(x, y - 1, z, JSTONE); A.lamp(x + 2, y, z + 2); M.pts = []; let a = A.rand() * 6.283;
    for (let i = 0; i < 6; i++){ a += .9 + A.rand() * .5; const d = 5 + i * 1.6; M.pts.push([x + .5 + Math.cos(a) * d, y + 1.5 + i * 1.3, z + .5 + Math.sin(a) * d]); }
    WILD_UD.push({ x: x + .5 + Math.cos(a) * 4, z: z + .5 + Math.sin(a) * 4, r: 3.5, top: y + 14, to: -2, mod: 1 });
    A.chest(x - 2, y, z, A.I.tier, M); M.ex = x + 1; M.ey = y; M.ez = z; M.hint = 'Stand on the starting stone, then catch all six wisps within 30 seconds'; M.t = -1; M.got = 0; return true; },
  tick(M, dt){ if (M.done) return; if (M.t < 0){ if (plateAt(M.x, M.y, M.z)){ M.t = 0; M.got = 0; M.pts.forEach(p => p.g = false); SND.ring(0); toast('Go! Six wisps, thirty seconds.'); } return; }
    M.t += dt; for (const p of M.pts) modFx(p[0], p[1] + Math.sin(tAcc * 3 + p[0]) * .2, p[2], p.g ? 0 : .45, 1, .9, .5);
    for (const p of M.pts) if (!p.g && Math.hypot(PL.x - p[0], PL.y + .9 - p[1], PL.z - p[2]) < 1.6){ p.g = true; M.got++; SND.ring(M.got); sparkle(p[0], p[1], p[2], 8, 1, .9, .5); if (M.got === 6){ M.t = -1; modComplete(M); } }
    if (M.t > 30 && !M.done){ M.t = -1; SND.deny(); toast('The wisps scatter. Try again from the stone.'); } } };
MOD.crumble = { R: 3, off: 1, build(M, A){ const ang = A.freeAngle(), rm = A.rim(ang), ca = Math.cos(ang), sa = Math.sin(ang); const y = rm.y; M.steps = [];
    for (let i = 1; i <= 9; i++){ const d = 2 + i * 2, sx = Math.round(rm.x + ca * d), sz = Math.round(rm.z + sa * d), sy = y + (i % 3 === 0 ? 1 : 0) + Math.floor(i / 4); A.put(sx, sy - 1, sz, BRIDGE); M.steps.push({ x: sx, y: sy, z: sz, t: -1 }); }
    const ex = Math.round(rm.x + ca * 22), ez = Math.round(rm.z + sa * 22), ey = y + 3; for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++){ A.put(ex + dx, ey - 1, ez + dz, COBBLE); if (Math.abs(dx) + Math.abs(dz) < 3) A.put(ex + dx, ey - 2, ez + dz, STONE); }
    A.lamp(ex + 2, ey, ez + 2); A.chest(ex, ey, ez, A.I.tier + 1, M, { lock: false }); M.goal = [ex, ey, ez]; M.ex = Math.round(rm.x - ca * 2); M.ey = A.top(M.ex, Math.round(rm.z - sa * 2)) + 1; M.ez = Math.round(rm.z - sa * 2); if (M.ey < 1) M.ey = y; M.x = M.ex; M.y = M.ey; M.z = M.ez; return true; },
  tick(M, dt){ for (const s of M.steps){ if (s.t < 0 && plateAt(s.x, s.y, s.z)){ s.t = 0; dust(s.x + .5, s.y, s.z + .5, 3, 1); } if (s.t >= 0){ s.t += dt; if (s.t > .55 && s.t < 9 && getB(s.x, s.y - 1, s.z)){ modSet(s.x, s.y - 1, s.z, 0); SND.brk('wood'); } if (s.t > 6){ s.t = -1; modSet(s.x, s.y - 1, s.z, BRIDGE); } } }
    if (!M.done && Math.abs(PL.x - M.goal[0] - .5) < 2.6 && Math.abs(PL.z - M.goal[2] - .5) < 2.6 && Math.abs(PL.y - M.goal[1]) < 1.2 && PL.onGround) modComplete(M); } };
MOD.gauntlet = { R: 3, off: 1, build(M, A){ const ang = A.freeAngle(), rm = A.rim(ang), ca = Math.cos(ang), sa = Math.sin(ang), y = rm.y;
    const ex = Math.round(rm.x + ca * 20), ez = Math.round(rm.z + sa * 20), ey = y + 7; for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++){ if (dx * dx + dz * dz > 6) continue; A.put(ex + dx, ey - 1, ez + dz, GRASS); A.put(ex + dx, ey - 2, ez + dz, STONE); A.put(ex + dx, ey - 3 + (Math.abs(dx) + Math.abs(dz) > 1 ? 1 : 0), ez + dz, STONE); }
    for (let i = 1; i <= 3; i++){ const d = i * 5, ax = Math.round(rm.x + ca * d), az = Math.round(rm.z + sa * d), ay = y + 12 + (i & 1); for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) A.put(ax + dx, ay, az + dz, STONE); A.put(ax, ay + 1, az, MOSS); }
    // the route without a grapple: a gentle updraft off the rim
    WILD_UD.push({ x: rm.x + .5 + ca * 3, z: rm.z + .5 + sa * 3, r: 3.2, top: ey + 7, to: -2, mod: 1 });
    A.lamp(ex + 1, ey, ez - 1); A.chest(ex, ey, ez, A.I.tier + 1, M, { lock: false }); M.goal = [ex, ey, ez]; M.ex = Math.round(rm.x - ca * 2); M.ez = Math.round(rm.z - sa * 2); M.ey = Math.max(1, A.top(M.ex, M.ez) + 1); M.x = M.ex; M.y = M.ey; M.z = M.ez; return true; },
  tick(M){ if (!M.done && Math.abs(PL.x - M.goal[0] - .5) < 2.6 && Math.abs(PL.z - M.goal[2] - .5) < 2.6 && Math.abs(PL.y - M.goal[1]) < 1.2 && PL.onGround) modComplete(M); } };
MOD.spire = { R: 4, build(M, A){ const s = A.site(4); if (!s) return false; const { x, y, z } = s, H = 14 + ((A.rand() * 5) | 0), mat = A.I.b === 2 ? ICE : A.I.b === 4 ? BASALT : PBRICK;
    for (let k = 0; k < H; k++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) A.put(x + dx, y + k, z + dz, mat);
    const P = [[2, -1], [2, 0], [2, 1], [1, 2], [0, 2], [-1, 2], [-2, 1], [-2, 0], [-2, -1], [-1, -2], [0, -2], [1, -2]]; for (let k = 0; k < H; k++){ const p = P[k % 12]; A.put(x + p[0], y + k, z + p[1], k % 4 === 3 ? LAMP : STEP); }
    A.chest(x, y + H, z, A.I.tier + 1, M, { lock: false }); A.put(x + 1, y + H, z + 1, LANTERN); M.goal = [x, y + H, z]; M.ex = x + 3; M.ey = y; M.ez = z - 1; return true; },
  tick(M){ if (!M.done && Math.abs(PL.x - M.goal[0] - .5) < 1.6 && Math.abs(PL.z - M.goal[2] - .5) < 1.6 && Math.abs(PL.y - M.goal[1]) < 1.2 && PL.onGround) modComplete(M); } };
MOD.glide = { R: 3, off: 1, build(M, A){ const ang = A.freeAngle(), rm = A.rim(ang), ca = Math.cos(ang), sa = Math.sin(ang), y = rm.y;
    for (let i = 1; i <= 3; i++){ const d = i * 12, ux = rm.x + ca * d, uz = rm.z + sa * d, top = y + 8 + i * 3; WILD_UD.push({ x: ux + .5, z: uz + .5, r: 3.5, top, to: -2, mod: 1 });
      for (let k = -2; k <= 2; k++){ A.put(Math.round(ux - sa * k), top + 3, Math.round(uz + ca * k), PBRICK); } A.put(Math.round(ux - sa * 2), top + 2, Math.round(uz + ca * 2), PBRICK); A.put(Math.round(ux + sa * 2), top + 2, Math.round(uz - ca * 2), PBRICK); }
    const ex = Math.round(rm.x + ca * 46), ez = Math.round(rm.z + sa * 46), ey = y + 6; for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++){ const dd = dx * dx + dz * dz; if (dd > 10) continue; A.put(ex + dx, ey - 1, ez + dz, GRASS); for (let k = 2; k < 2 + Math.max(1, 4 - Math.round(Math.sqrt(dd))); k++) A.put(ex + dx, ey - k, ez + dz, STONE); }
    A.lamp(ex - 2, ey, ez); A.chest(ex, ey, ez, A.I.tier + 1, M, { lock: false }); M.goal = [ex, ey, ez]; M.ex = Math.round(rm.x - ca * 2); M.ez = Math.round(rm.z - sa * 2); M.ey = Math.max(1, A.top(M.ex, M.ez) + 1); M.x = M.ex; M.y = M.ey; M.z = M.ez; return true; },
  tick(M){ if (!M.done && Math.abs(PL.x - M.goal[0] - .5) < 3.2 && Math.abs(PL.z - M.goal[2] - .5) < 3.2 && Math.abs(PL.y - M.goal[1]) < 1.2 && PL.onGround) modComplete(M); } };
// combat
MOD.camp = { R: 7, build(M, A){ const s = A.site(7); if (!s) return false; const { x, y, z } = s;
    for (const [tx, tz] of [[-4, -3], [3, -4], [-3, 4]]){ for (let k = 0; k < 3; k++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (Math.abs(dx) + Math.abs(dz) <= 2 - k) A.put(x + tx + dx, y + k, z + tz + dz, TENT); }
    A.put(x, y - 1, z, EMBER); A.put(x, y, z, LANTERN); for (let k = 0; k < 4; k++) A.put(x + 5, y + k, z + 3, LOG);
    const t = A.I.tier; A.enemy(1, x - 2, y, z + 2, M); A.enemy(4, x + 3, y, z + 1, M); if (t > 1) A.enemy(1, x + 1, y, z - 3, M); M.chief = A.enemy(1, x, y, z - 2, M, { chief: 1 });
    A.chest(x + 3, y, z + 4, t + 1, M); M.ex = x - 6; M.ey = y; M.ez = z; M.hint = 'Defeat the warband chief'; return true; },
  tick(M, dt){ const e = M.chiefE; if (!e || M.done) return; if (e.st === ES.DEAD){ modComplete(M); return; }
    // the chief's own attack: a stamping shockwave every few seconds when you are close
    M.sw = (M.sw || 3) - dt; const d = Math.hypot(PL.x - e.x, PL.z - e.z); if (M.sw <= 0 && d < 9 && e.st !== ES.IDLE){ M.sw = 4.5; M.wave = .7; SND.enemyAtk(2, e); }
    if (M.wave > 0){ M.wave -= dt; for (let i = 0; i < 6; i++){ const a = Math.random() * 6.283, rr = (1 - M.wave / .7) * 6; emit(e.x + Math.cos(a) * rr, e.y + .1, e.z + Math.sin(a) * rr, 0, 1.5, 0, 1, .6, .3, .2, .5, 0, 9); }
      if (M.wave <= 0 && d < 6 && PL.onGround){ hurtPlayer(3, e.x, e.z, 9, e); PL.vy = Math.max(PL.vy, 7); } } } };
MOD.arena = { R: 7, build(M, A){ const s = A.site(7); if (!s) return false; const { x, y, z } = s; ring(A, x, z, 6, 14, (bx, bz, i) => { A.put(bx, y, bz, i % 2 ? RUINM : RUIN); if (i % 3 === 0) A.put(bx, y + 1, bz, RUIN); }); A.put(x, y - 1, z, JSTONE);
    A.chest(x + 2, y, z, A.I.tier + 1, M); M.ex = x + 7; M.ey = y; M.ez = z + 2; M.hint = 'Step into the circle and survive three waves'; M.wave = 0; return true; },
  tick(M, dt){ if (M.done) return; const inR = Math.hypot(PL.x - M.x - .5, PL.z - M.z - .5) < 8;
    if (!M.wave && plateAt(M.x, M.y, M.z)){ M.wave = 1; M.live = arenaWave(M, 1); toast('Wave 1 of 3'); SND.notice(1); }
    else if (M.wave){ if (!inR && Math.hypot(PL.x - M.x, PL.z - M.z) > 16){ for (const e of M.live) if (e.st !== ES.DEAD){ e.st = ES.DEAD; e.deadT = 1; } M.wave = 0; toast('You left the circle. The ritual resets.'); return; }
      if (M.live.every(e => e.st === ES.DEAD)){ if (M.wave >= 3){ M.wave = 0; modComplete(M); } else { M.wave++; M.live = arenaWave(M, M.wave); toast('Wave ' + M.wave + ' of 3'); SND.notice(2); } } } } };
function arenaWave(M, w){ const T = [[0, 0, 0], [1, 1, 4], [2, 1, 4]][w - 1], out = []; T.forEach((t, i) => { const a = i / T.length * 6.283 + w, x = M.x + Math.cos(a) * 5, z = M.z + Math.sin(a) * 5; const e = mkEnemy(M.I, { type: t, x: x + .5, y: M.y + 1, z: z + .5, guard: true }, 900 + w * 10 + i); e.active = true; e.st = ES.CHASE; ENEMIES.push(e); out.push(e); sparkle(x + .5, M.y + 1, z + .5, 10, .9, .4, .3); }); return out; }
MOD.ambush = { R: 6, build(M, A){ const s = A.site(6); if (!s) return false; const { x, y, z } = s;
    for (let i = -5; i <= 5; i++) for (const sd of [-5, 5]){ const h = 1 + ((A.rand() * 3) | 0); if (A.rand() < .25) continue; for (let k = 0; k < h; k++){ A.put(x + i, y + k, z + sd, A.rand() < .5 ? RUIN : RUINM); A.put(x + sd, y + k, z + i, A.rand() < .5 ? RUIN : RUINM); } }
    for (let k = 0; k < 3; k++) A.put(x, y + k, z - 3, RUIN); A.chest(x, y, z, A.I.tier, M); M.ex = x; M.ey = y; M.ez = z + 6; for (let i = 0; i < 6; i++) A.put(x + (i % 3) - 1, y - 1, z + 6 + (i / 3 | 0), GRAVEL); M.hint = 'Something waits in the ruins'; return true; },
  tick(M){ if (M.done) return; if (!M.sprung && Math.hypot(PL.x - M.x, PL.z - M.z) < 4){ M.sprung = true; M.live = []; const T = M.I.tier > 1 ? [1, 4, 1, 0] : [0, 1, 0]; T.forEach((t, i) => { const a = i / T.length * 6.283, e = mkEnemy(M.I, { type: t, x: M.x + Math.cos(a) * 4 + .5, y: M.y + 1, z: M.z + Math.sin(a) * 4 + .5, guard: true }, 950 + i); e.active = true; e.st = ES.CHASE; ENEMIES.push(e); M.live.push(e); dust(e.x, e.y, e.z, 8, 2); }); SND.notice(3); toast('Ambush!'); }
    if (M.sprung && M.live.every(e => e.st === ES.DEAD)) modComplete(M); } };
MOD.nest = { R: 5, build(M, A){ const s = A.site(5); if (!s) return false; const { x, y, z } = s; for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++){ const d = Math.hypot(dx, dz); if (d > 3.2) continue; const h = Math.round(3 - d); for (let k = 0; k <= h; k++) A.put(x + dx, y + k - 1, z + dz, k === h ? MYCEL : MSTEM); }
    A.put(x, y + 3, z, MCAPB); M.core = [x, y + 3, z]; A.chest(x + 4, y, z + 1, A.I.tier, M); M.ex = x + 5; M.ey = y; M.ez = z - 2; M.hint = 'Break the glowing core on top of the nest'; M.t = 2; M.live = []; return true; },
  tick(M, dt){ if (M.done) return; if (getB(M.core[0], M.core[1], M.core[2]) !== MCAPB){ modComplete(M); return; } M.t -= dt; M.live = M.live.filter(e => e.st !== ES.DEAD);
    if (M.t <= 0 && M.live.length < 3 && Math.hypot(PL.x - M.x, PL.z - M.z) < 16){ M.t = 7; const a = Math.random() * 6.283, e = mkEnemy(M.I, { type: 0, x: M.x + Math.cos(a) * 3 + .5, y: M.y + 1, z: M.z + Math.sin(a) * 3 + .5, guard: true }, 980 + M.live.length); e.active = true; e.st = ES.CHASE; ENEMIES.push(e); M.live.push(e); sparkle(e.x, e.y + .5, e.z, 8, .5, .9, .4); } } };
// exploration
MOD.cave = { R: 5, build(M, A){ const s = A.site(4); if (!s) return false; const { x, y, z } = s;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) for (let k = 0; k < 3; k++) if (Math.abs(dx) + Math.abs(dz) + k < 5) A.put(x + dx, y + k, z + dz, A.I.b === 2 ? SNOW : STONE);
    for (let k = 0; k < 2; k++) A.put(x, y + k, z + 2, GRAVEL); // the cracked face: mine it
    for (let i = 0; i < 6; i++){ A.clear(x, y - i, z + 1 - i * 0, 0); A.put(x, y - i, z - i + 1, 0); A.put(x, y - i + 1, z - i + 1, 0); A.put(x, y - i + 2, z - i + 1, 0); A.put(x, y - i - 1, z - i + 1, STONE); }
    const ry = y - 6, rz = z - 6; for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++){ for (let k = 0; k < 3; k++) A.put(x + dx, ry + k, rz + dz, 0); A.put(x + dx, ry - 1, rz + dz, STONE); }
    A.put(x - 2, ry + 2, rz - 2, GSHROOM); A.put(x + 2, ry, rz - 2, LANTERN); A.chest(x, ry, rz - 1, A.I.tier + 1, M, { lock: false }); M.ex = x; M.ey = y; M.ez = z + 3; M.hint = 'A cracked rock face hides something'; M.reach = [x, ry, rz + 1]; return true; },
  tick(){} };
MOD.sunken = { R: 5, build(M, A){ const s = A.site(5); if (!s) return false; const { x, y, z } = s; M.water = [];
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++){ if (dx * dx + dz * dz > 11) continue; for (let k = 1; k <= 4; k++){ A.put(x + dx, y - k, z + dz, WATER); M.water.push([x + dx, y - k, z + dz]); } A.put(x + dx, y - 5, z + dz, RUINM); }
    for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) for (let k = 4; k >= 2; k--) A.put(x + dx, y - k, z + dz, RUIN);
    A.chest(x, y - 4, z, A.I.tier + 1, M); M.water = M.water.filter(w => !(w[0] === x && w[2] === z && w[1] >= y - 4 && w[1] <= y - 3)); M.lever = [x + 5, y, z]; A.put(x + 5, y - 1, z, JSTONE); A.lamp(x + 5, y, z + 1);
    // steps down the far side so the shrine floor can be reached once drained
    for (let k = 1; k <= 4; k++) A.put(x - 4 + k - 1 >= x - 3 ? x - 4 : x - 4, y - k, z, 0);
    M.ex = x + 6; M.ey = y; M.ez = z; M.hint = 'The stone by the pond drains it'; return true; },
  tick(M, dt){ if (M.dr !== undefined){ M.dr += dt; const n = Math.min(M.water.length, Math.floor(M.dr * 40)); for (; M.di < n; M.di++){ const w = M.water[M.water.length - 1 - M.di]; modSet(w[0], w[1], w[2], 0); } if (M.di >= M.water.length){ M.dr = undefined; modComplete(M); } return; }
    if (!M.done && plateAt(M.lever[0], M.lever[1], M.lever[2])){ M.dr = 0; M.di = 0; M.water.sort((a, b) => a[1] - b[1]); SND.whoosh(); toast('Somewhere below, stone grinds. The water drains away.'); } },
  solved(M){ for (const w of M.water) modSet(w[0], w[1], w[2], 0); } };
MOD.library = { R: 6, build(M, A){ const s = A.site(6); if (!s) return false; const { x, y, z } = s;
    for (let dz = -3; dz <= 3; dz++) for (let dx = -4; dx <= 4; dx++){ const edge = Math.abs(dx) === 4 || Math.abs(dz) === 3; for (let k = 0; k < 4; k++){ if (edge && !(dz === 3 && Math.abs(dx) <= 1 && k < 3) && !(k === 2 && dx % 2 === 0 && A.rand() < .5)) A.put(x + dx, y + k, z + dz, k === 3 ? PLANKS : A.rand() < .3 ? RUINM : RUIN); } if (A.rand() < .7) A.put(x + dx, y + 4, z + dz, A.rand() < .5 ? PLANKS : LEAVES); A.put(x + dx, y - 1, z + dz, PLANKS); }
    for (let dx = -3; dx <= 3; dx += 2) for (let k = 0; k < 3; k++) A.put(x + dx, y + k, z - 2, k === 1 ? LOG : PLANKS);
    for (let i = 0; i < 5; i++) A.put(x - 4 + ((A.rand() * 9) | 0), y + 3, z - 3, VINE);
    M.notes = [[x - 2, z], [x + 2, z], [x, z - 1]].map(([px, pz]) => { A.put(px, y - 1, pz, STEP); return { x: px, z: pz, read: false, t: LORE[(A.rand() * LORE.length) | 0] }; });
    A.put(x + 3, y + 2, z + 2, LANTERN); A.chest(x - 3, y, z + 2, A.I.tier, M); M.ex = x; M.ey = y; M.ez = z + 5; M.hint = 'Read the three open books'; return true; },
  tick(M){ if (M.done) return; for (const n of M.notes) if (!n.read && plateAt(n.x, M.y, n.z)){ n.read = true; SND.page(); toastCard('An open book', n.t, 7000); if (M.notes.every(q => q.read)) modComplete(M); } } };
MOD.ship = { R: 7, build(M, A){ const s = A.site(7); if (!s) return false; const { x, y, z } = s, ang = A.rand() < .5 ? 0 : 1;
    const P = (u, v, k, id) => ang ? A.put(x + v, y + k, z + u, id) : A.put(x + u, y + k, z + v, id);
    for (let u = -6; u <= 6; u++){ const w = u > 3 ? 6 - u : 2, tilt = u < -3 ? 1 : 0; for (let v = -w; v <= w; v++){ P(u, v, -1 + tilt, PLANKS); if (Math.abs(v) === w) for (let k = 0; k < 2; k++) if (A.rand() < .85) P(u, v, k + tilt, u % 3 ? PLANKS : LOG); } }
    for (let k = 0; k < 7; k++) P(-1, 0, k, LOG); for (let k = 3; k < 7; k++) for (let v = 1; v <= 3; v++) if (A.rand() < .8) P(-1, v - (k > 5 ? 1 : 0), k, TENT); P(5, 0, 0, LANTERN);
    const cx = ang ? x : x + 2, cz = ang ? z + 2 : z; A.chest(cx, y, cz, A.I.tier + 1, M, { lock: false }); M.ex = ang ? x + 4 : x - 8; M.ey = y; M.ez = ang ? z - 8 : z + 4;
    for (let v = -1; v <= 1; v++) P(-6, v, 0, 0), P(-6, v, 1, 0); return true; }, tick(){} };
MOD.observatory = { R: 5, build(M, A){ const s = A.site(5); if (!s) return false; const { x, y, z } = s, H = 9;
    for (let k = 0; k < H; k++) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (Math.abs(dx) === 2 || Math.abs(dz) === 2) A.put(x + dx, y + k, z + dz, PBRICK);
    const P = [[3, -2], [3, -1], [3, 0], [3, 1], [3, 2], [2, 3], [1, 3], [0, 3], [-1, 3], [-2, 3], [-3, 2], [-3, 1]]; for (let k = 0; k < H; k++){ const p = P[k % 12]; A.put(x + p[0], y + k, z + p[1], STEP); }
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++){ A.put(x + dx, y + H, z + dz, PBRICK); if (Math.abs(dx) === 2 || Math.abs(dz) === 2) if (!(dx === -2 && dz === 1)) A.put(x + dx, y + H + 2, z + dz, GLASS); }
    A.put(x, y + H, z, JSTONE); A.put(x + 1, y + H + 1, z, LOG); A.put(x + 1, y + H + 2, z, LANTERN); A.clear(x - 2, y + H + 1, z + 1, 2);
    M.top = [x, y + H + 1, z]; M.ex = x + 3; M.ey = y; M.ez = z - 3; M.hint = 'Stand at the eyepiece on the roof'; A.chest(x - 1, y, z + 4, A.I.tier, M); return true; },
  tick(M){ if (!M.done && plateAt(M.top[0], M.top[1], M.top[2])){ const near = OUT.filter(I => I !== M.I && !I.seen && !REVEALED.has(I.k)).sort((p, q) => Math.hypot(p.x - M.I.x, p.z - M.I.z) - Math.hypot(q.x - M.I.x, q.z - M.I.z)).slice(0, 3);
      near.forEach(I => REVEALED.add(I.k)); toastCard('The lens finds them', near.length ? near.map(I => I.name).join(' · ') + ' are now marked on your map' : 'Every island nearby is already known.', 7000); modComplete(M); } } };
// resources
MOD.ore = { R: 4, build(M, A){ const s = A.site(4); if (!s) return false; const { x, y, z } = s, O = [ORE, [OREF, OREC, OREA, CRYR, CRYF][A.I.b] || OREA], body = A.I.b === 4 ? BASALT : DEEP; M.ores = [];
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++){ const h = 3 - Math.round(Math.hypot(dx, dz)); for (let k = 0; k <= h; k++){ const isO = A.rand() < .32; A.put(x + dx, y + k, z + dz, isO ? O[(A.rand() * 2) | 0] : body); if (isO) M.ores.push([x + dx, y + k, z + dz]); } }
    M.ex = x + 3; M.ey = y; M.ez = z; M.hint = 'Mine four ore blocks from the vein'; return true; },
  tick(M){ if (M.done) return; M.cT = (M.cT || 0) + 1; if (M.cT % 20) return; const left = M.ores.filter(o => { const b = getB(o[0], o[1], o[2]); return b === ORE || (b >= OREF && b <= CRYF); }).length; if (M.ores.length - left >= 4) modComplete(M); } };
MOD.tree = { R: 7, build(M, A){ const s = A.site(6); if (!s) return false; const { x, y, z } = s, H = 13, leaf = A.I.b === 2 ? FROSTLEAF : A.I.b === 3 ? BLOSSOM : LEAVES;
    for (let k = 0; k < H; k++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!(k < 3 && dx === 0 && dz === 1)) A.put(x + dx, y + k, z + dz, LOG);
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, -2], [2, 2], [-2, -2]]) A.put(x + dx, y, z + dz, LOG);
    for (let dy = -3; dy <= 4; dy++) for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++){ const d = Math.hypot(dx, dy * 1.4, dz); if (d < 6 - A.rand() * .8) A.put(x + dx, y + H + dy, z + dz, A.rand() < .04 ? LANTERN : leaf); }
    A.put(x, y - 1, z + 2, STEP); A.chest(x, y, z + 1, A.I.tier, M, { lock: false }); M.shake = [x, y, z + 2]; M.ex = x; M.ey = y; M.ez = z + 4; M.hint = 'Stand at the hollow and the tree may share its fruit'; return true; },
  tick(M){ if (!M.done && plateAt(M.shake[0], M.shake[1], M.shake[2])){ for (let i = 0; i < 4; i++) spawnDrop(BUN, M.x + .5 + (Math.random() - .5) * 4, M.y + 6, M.z + .5 + (Math.random() - .5) * 4); SND.grow(4); toast('Sunfruit tumbles down from the canopy'); modComplete(M); } } };
MOD.grove = { R: 6, build(M, A){ const s = A.site(6); if (!s) return false; const { x, y, z } = s; ring(A, x, z, 5, 12, (bx, bz, i) => { A.put(bx, y, bz, i % 3 ? GSHROOM : FERN); }); ring(A, x, z, 3, 6, (bx, bz) => A.put(bx, y, bz, BELL));
    M.flies = []; for (let i = 0; i < 6; i++){ const a = i / 6 * 6.283, d = 2 + A.rand() * 3; M.flies.push([x + .5 + Math.cos(a) * d, y + 1.2 + A.rand() * 2, z + .5 + Math.sin(a) * d]); } M.ex = x + 6; M.ey = y; M.ez = z; M.hint = 'Come back at night and catch the moonmoths'; return true; },
  tick(M){ if (M.done) return; const night = U && U.uNight.value > .45; if (!night){ if (!M.told && Math.hypot(PL.x - M.x, PL.z - M.z) < 6){ M.told = true; toast('The grove is quiet. Moonmoths come out at night.'); } return; }
    for (const f of M.flies) if (!f.g){ const fx = f[0] + Math.sin(tAcc * .9 + f[1]) * 1.2, fy = f[1] + Math.sin(tAcc * 1.7 + f[0]) * .4, fz = f[2] + Math.cos(tAcc * .8 + f[1]) * 1.2; modFx(fx, fy, fz, .18, .7, 1, .6); if (Math.hypot(PL.x - fx, PL.y + 1 - fy, PL.z - fz) < 1.4){ f.g = true; SND.chirp(); sparkle(fx, fy, fz, 6, .7, 1, .6); } }
    if (M.flies.every(f => f.g)){ for (let i = 0; i < 3; i++) spawnDrop(BISCUIT, PL.x, PL.y + 1.5, PL.z); toast('Moonmoth honey: three special biscuits'); modComplete(M); } } };
MOD.trader = { R: 5, build(M, A){ const s = A.site(5); if (!s) return false; const { x, y, z } = s;
    for (let dx = -2; dx <= 2; dx++){ A.put(x + dx, y, z - 1, PLANKS); for (let dz = -2; dz <= 0; dz++) A.put(x + dx, y + 3, z + dz, TENT); } for (const dx of [-2, 2]) for (let k = 0; k < 3; k++) A.put(x + dx, y + k, z - 2, LOG); A.put(x + 1, y + 1, z - 1, LANTERN);
    // the trader: a small round-bellied figure behind the counter
    A.put(x, y, z - 2, TENT); A.put(x, y + 1, z - 2, BRICK); A.put(x, y + 2, z - 2, SAND); A.put(x - 1, y + 1, z - 3, TENT);
    A.put(x, y - 1, z + 1, STEP); M.plate = [x, y, z + 1]; M.ex = x; M.ey = y; M.ez = z + 4; M.hint = 'The trader swaps 10 blocks for a fine weapon'; M.trades = 0; return true; },
  tick(M){ const on = plateAt(M.plate[0], M.plate[1], M.plate[2]); if (on && !M.on){ M.on = true; const ids = [COBBLE, STONE, LOG, PLANKS, DIRT, SAND, DEEP, BASALT, RUIN].filter(id => countItem(id) >= 10);
      if (!ids.length){ SND.voice('kit', { x: M.x, y: M.y, z: M.z - 2 }); toast('"Ten blocks of stone, wood or ruin brick, friend, and this blade is yours."'); }
      else if (M.trades >= 3){ toast('"I have nothing left for you today."'); }
      else { takeItem(ids[0], 10); const seed = (OUT_SEED + M.I.k * 31 + M.trades) >>> 0; let a = seed || 1; const w = rollWeapon(() => { a = (a * 16807) % 2147483647; return a / 2147483647; }, Math.min(4, 1 + M.I.tier)); spawnDrop(WEAPON, M.x + .5, M.y + 1.5, M.z + 1.5, w, 1); M.trades++; SND.reward(); toast('"A fair trade!"'); if (!M.done) modComplete(M); } } else if (!on) M.on = false; } };
MOD.vault = { R: 0, build(M, A){ let st = A.r.structs.find(s => s.grapple) || A.r.structs[0], ch = A.r.chests.find(c => c.grapple);
    if (!st || !ch){ const s = A.site(5); if (!s) return false; const { x, y, z } = s; for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++){ const edge = Math.abs(dx) === 3 || Math.abs(dz) === 3; for (let k = 0; k < 4; k++) if (edge && !(dz === 3 && Math.abs(dx) <= 1 && k < 3)) A.put(x + dx, y + k, z + dz, k === 3 ? PBRICK : RUIN); A.put(x + dx, y + 4, z + dz, PBRICK); A.put(x + dx, y - 1, z + dz, JSTONE); }
      A.put(x - 2, y + 2, z - 2, LANTERN); A.put(x + 2, y + 2, z - 2, CRYSTAL); A.r.chests.push({ x, y, z: z - 1, tier: 3, s: -1, grapple: 1 }); ch = A.r.chests[A.r.chests.length - 1];
      A.enemy(4, x + 6, y, z + 6, null); A.enemy(4, x - 6, y, z + 6, null); A.enemy(1, x + 5, y, z - 5, null); A.enemy(1, x - 5, y, z - 5, null); }
    if (!ch) return false; ch.mod = M.key; M.x = ch.x; M.y = ch.y; M.z = ch.z;
    let best = null; for (const [dx, dz] of [[0, 1], [1, 0], [0, -1], [-1, 0], [0, 2], [2, 0], [0, -2], [-2, 0]]) if (!B_SOLID[getB(ch.x + dx, ch.y, ch.z + dz)]){ best = [ch.x + dx, ch.y, ch.z + dz]; break; }
    if (!best){ best = [ch.x, ch.y, ch.z + 1]; A.put(best[0], best[1], best[2], 0); A.put(best[0], best[1] + 1, best[2], 0); } M.ex = best[0]; M.ey = best[1]; M.ez = best[2]; M.hint = 'The grappling hook rests here, guarded'; return true; },
  tick(M){ if (!M.done && GEAR.grapple) modComplete(M); } };
// ---- hazards (per island, from the theme) ----
function hazardTick(I, dt){
  if (outerIsle(PL.x, PL.z) !== I || state !== 'play' || PL.catching) return;
  if (I.hz === 'gust'){ I.gT = (I.gT || 4) - dt; if (I.gT <= 0){ I.gT = 6 + Math.random() * 3; I.gL = 1.4; I.gA = Math.random() * 6.283; SND.whoosh(); } if (I.gL > 0){ I.gL -= dt; PL.vx += Math.cos(I.gA) * 7 * dt; PL.vz += Math.sin(I.gA) * 7 * dt; if (Math.random() < .3) emit(PL.x - Math.cos(I.gA) * 3, PL.y + 1 + Math.random() * 2, PL.z - Math.sin(I.gA) * 3, Math.cos(I.gA) * 9, 0, Math.sin(I.gA) * 9, .9, .95, 1, .06, .5, 0, 9); } }
  else if (I.hz === 'frost'){ if (PL.onGround){ const k = Math.min(1, 2.2 * dt); PL.vx -= PL.vx * k * .45; PL.vz -= PL.vz * k * .45; } }
  else if (I.hz === 'lowgrav'){ if (!PL.onGround && !PL.gliding) PL.vy += 11 * dt; if (Math.random() < .2) emit(PL.x + (Math.random() - .5) * 8, PL.y + Math.random() * 3, PL.z + (Math.random() - .5) * 8, 0, .6, 0, .8, .9, 1, .07, 1.2, 0, 9); }
  else if (I.hz === 'vents'){ const b = getB(Math.floor(PL.x), Math.floor(PL.y - .5), Math.floor(PL.z)); if (b === EMBER && PL.onGround){ PL.vy = 17; PL.onGround = false; SND.boing(); sparkle(PL.x, PL.y, PL.z, 10, 1, .6, .3); } }
  if (!I.hzTold && I.hz){ I.hzTold = true; toast({ gust: 'Gusts sweep this island. Brace yourself.', frost: 'Frost underfoot slows you down.', lowgrav: 'The air here is light: you fall slowly.', vents: 'Ember vents: step on one to be thrown upward.' }[I.hz]); }
}
// ---- island assembly (a generator, stepped by islandBuild in w1 under a frame budget) ----
function* buildIslandContentG(I, r){
  if (!I.mods) return null; const A = contentAPI(I, r); I.pads = { land: null, launch: {} }; I.padAngs = [];
  // landing pad (from the parent link) and launch pads (one per child link) beside their updrafts
  const pad = (tx, tz, inset) => { const ang = Math.atan2(tz - I.z, tx - I.x), rm = A.rim(ang); I.padAngs.push(ang); let px = Math.round(rm.x - Math.cos(ang) * inset), pz = Math.round(rm.z - Math.sin(ang) * inset);
    if (!A.inI(px, pz)){ px = Math.round(I.x); pz = Math.round(I.z); } const hs = []; for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) if (A.inI(px + dx, pz + dz)) hs.push(A.top(px + dx, pz + dz)); hs.sort((a, b) => a - b); const gy = hs.length ? hs[hs.length >> 1] : I.top;
    A.flatten(px, pz, 3, gy); for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (A.inI(px + dx, pz + dz)) A.put(px + dx, gy, pz + dz, (dx + dz) & 1 ? COBBLE : STEP);
    for (const [dx, dz] of [[-3, -3], [3, 3]]) if (A.inI(px + dx, pz + dz)) A.lamp(px + dx, gy + 1, pz + dz); A.used.push({ x: px, z: pz, R: 3 });
    // a jetty from the pad out past the rim at pad height: nothing to climb between the pad and the open air
    const ca = Math.cos(ang), sa = Math.sin(ang); for (let s2 = 0; s2 < inset + 4; s2++) for (const w of [-1, 0, 1]){ const x = Math.round(px + ca * s2 - sa * w), z = Math.round(pz + sa * s2 + ca * w); if (A.inI(x, z)){ A.put(x, gy, z, s2 & 1 ? COBBLE : STEP); for (let k = 1; k < 5; k++) A.put(x, gy + k, z, 0); } }
    return { x: px, y: gy + 1, z: pz, ang }; };
  for (const [a, J] of WILD_LINKS){ if (J === I){ I.pads.land = pad(a.x, a.z, 5); I.pads.land.from = a.gate ? -1 : a.k; yield; } }
  for (const [a, J] of WILD_LINKS){ if (a === I){ I.pads.launch[J.k] = pad(J.x, J.z, 4); yield; } }
  // stepping-stone causeways: every link gets a chain of floating 3x3 stones from launch pad to landing pad,
  // one sprint-jump apart (2-block gaps), climbing at most one block per stone; built when both ends exist
  const stones = (a, J) => { const key = (a.gate ? 'g' + WILD_LINKS.findIndex(l => l[1] === J) : a.k) + '>' + J.k; if (STONED.has(key)) return;
    const S = a.gate ? (J.gatePad = { x: Math.round(a.x), y: a.top + 1, z: Math.round(a.z) }) : a.pads && a.pads.launch[J.k], E = J.pads && J.pads.land; if (!S || !E) return;
    // leave along the launch jetty, arrive along the landing jetty (both at pad height)
    const own = (x, z) => x >= 0 && z >= 0 && x < WX && z < WZ && isl[x + z * WX] >= 0;
    const out = (P0, ang, kk) => { let x = P0.x, z = P0.z, lx = x, lz = z; for (let t = 0; t < 60; t++){ x += Math.cos(ang) * .5; z += Math.sin(ang) * .5; if (isl[Math.round(x) + Math.round(z) * WX] === kk){ lx = Math.round(x); lz = Math.round(z); } else if (t > 2) break; } return { x: lx, z: lz }; };
    let X0, exitY = S.y; if (a.gate){ let gx = Math.round(S.x), gz = Math.round(S.z), bd = 1e9; for (let dz = -8; dz <= 8; dz++) for (let dx = -8; dx <= 8; dx++){ const x = gx + dx, z = gz + dz; if (x < 0 || z < 0 || x >= WX || z >= WZ) continue; const v = isl[x + z * WX]; if (v >= 0 && v < OUT_ISL0){ const d = Math.hypot(x - E.x, z - E.z); if (d < bd){ bd = d; X0 = { x, z }; } } }
      if (!X0) return; exitY = hTop[X0.x + X0.z * WX] + 1; S.stand = [X0.x, exitY, X0.z]; } else X0 = out(S, S.ang, OUT_ISL0 + a.k);
    const X1 = out(E, E.ang, OUT_ISL0 + J.k), entryY = E.y;
    const dx = X1.x - X0.x, dz = X1.z - X0.z, L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L, px = -uz, pz = ux, list = [];
    const at = d => [Math.round(X0.x + ux * d), Math.round(X0.z + uz * d)], exitD = 0, entryD = L;
    const d0 = exitD + 2, d1 = entryD - 2; let n = Math.max(1, Math.ceil((d1 - d0) / 5)); const total = entryY - exitY, extra = Math.max(0, Math.ceil((total - (n + 1)) / 6) * 6), m = n >> 1; let y = exitY;
    // bow the causeway sideways around anything in the way (another island's lobe, a spire)
    let bow = 0, bc = 1e9; for (const off of [0, 6, -6, 12, -12, 18, -18]){ let c = 0; for (let i = 0; i <= n; i++){ const d = d0 + (d1 - d0) * i / n, t = i / n, q = at(d), qx = Math.round(q[0] + px * off * Math.sin(Math.PI * t)), qz = Math.round(q[1] + pz * off * Math.sin(Math.PI * t)); for (let ddz = -2; ddz <= 2; ddz++) for (let ddx = -2; ddx <= 2; ddx++) if (own(qx + ddx, qz + ddz) && i > 0 && i < n) c++; } if (c < bc){ bc = c; bow = off; } if (!c) break; }
    if (bow){ let len = 0, pq = null; for (let k = 0; k <= 60; k++){ const t = k / 60, q = at(d0 + (d1 - d0) * t), qq = [q[0] + px * bow * Math.sin(Math.PI * t), q[1] + pz * bow * Math.sin(Math.PI * t)]; if (pq) len += Math.hypot(qq[0] - pq[0], qq[1] - pq[1]); pq = qq; } n = Math.max(n, Math.ceil(len / 4.6)); }
    const atB = (d, i) => { const q = at(d), t = i / n; return [Math.round(q[0] + px * bow * Math.sin(Math.PI * t)), Math.round(q[1] + pz * bow * Math.sin(Math.PI * t))]; };
    for (let i = 0; i <= n; i++){ const d = d0 + (d1 - d0) * i / n, [cx, cz] = atB(d, i), want = exitY + Math.round((total - extra) * (i + 1) / (n + 1)) + (i > m ? extra : 0); y = Math.min(y + 1, Math.max(want, y - 3));
      { let hi = -1; for (let ddz = -1; ddz <= 1; ddz++) for (let ddx = -1; ddx <= 1; ddx++) if (own(cx + ddx, cz + ddz)) hi = Math.max(hi, hTop[cx + ddx + (cz + ddz) * WX]); if (hi >= y - 1) y = hi + 1; }
      list.push([cx, y, cz]);
      // mid-gap spiral: whole turns of six stones on a radius-5 circle, one block up each, ending back above this stone
      if (i === m && extra){ let sd = 1, bo = 1e9; for (const s2 of [1, -1]){ let o = 0; for (let k = 0; k < 6; k++){ const th = Math.atan2(-pz * s2, -px * s2) + k * 1.047; if (own(Math.round(cx + px * 5 * s2 + Math.cos(th) * 5), Math.round(cz + pz * 5 * s2 + Math.sin(th) * 5))) o++; } if (o < bo){ bo = o; sd = s2; } }
        const ccx = cx + px * 5 * sd, ccz = cz + pz * 5 * sd, th0 = Math.atan2(cz - ccz, cx - ccx); for (let k = 1; k <= extra; k++){ y++; const th = th0 + k * 1.047; list.push([Math.round(ccx + Math.cos(th) * 5), y, Math.round(ccz + Math.sin(th) * 5)]); } } }
    for (const [cx, cy, cz] of list){ for (let ddz = -1; ddz <= 1; ddz++) for (let ddx = -1; ddx <= 1; ddx++){ if (own(cx + ddx, cz + ddz) && (B_SOLID[getB(cx + ddx, cy - 1, cz + ddz)] || hTop[cx + ddx + (cz + ddz) * WX] >= cy - 2)) continue; A.put(cx + ddx, cy - 1, cz + ddz, (ddx | ddz) ? STONE : MOSS); if (!(ddx | ddz)) A.put(cx, cy - 2, cz, STONE); } for (let ddz = -2; ddz <= 2; ddz++) for (let ddx = -2; ddx <= 2; ddx++) for (let k = 0; k < 3; k++){ const X = cx + ddx, Z = cz + ddz, Y = cy + k; if (getB(X, Y, Z) && (!own(X, Z) || Y > hTop[X + Z * WX])) A.put(X, Y, Z, 0); } }
    list.forEach((p, i) => { if (i % 3 === 1) A.put(p[0] + 1, p[1], p[2] + 1, LANTERN); });
    STONED.set(key, { list, S, E, X0, X1, exitY, entryY, ok: !list.length || list[list.length - 1][1] >= entryY - 1 }); };
  for (const [a, J] of WILD_LINKS){ if (J === I && (a.gate || (a.gen === 2 && a.pads))){ stones(a, I); yield; } if (a === I && J.gen === 2 && J.pads){ stones(I, J); yield; } }
  // modules
  const rts = [];
  const FB = ['motes', 'crumble', 'glide', 'gauntlet', 'ore', 'spire'];
  for (let i = 0; i < I.mods.length; i++){ const id0 = I.mods[i]; let id = id0, M, ok = false;
    for (let f = -1; f < FB.length && !ok; f++){ if (f >= 0){ id = FB[f]; if (I.mods.includes(id) || rts.some(q => q.id === id)) continue; }
      M = { id, def: MOD[id], I, i, key: OUT_SEED + ':' + I.k + ':' + i, x: 0, y: 0, z: 0, done: false }; ok = MOD[id].build(M, A); }
    if (!ok) continue; I.mods[i] = id; const s = A.used[A.used.length - 1]; if (!M.x && s){ M.x = s.x; M.y = s.y; M.z = s.z; } rts.push(M); yield; }
  // vents for the kiln theme
  if (I.hz === 'vents') for (let i = 0; i < 6; i++){ const s = A.site(1, { noFlat: true, cov: 1 }); if (s) A.put(s.x, s.y - 1, s.z, EMBER); }
  // the golden island: gilded rims
  if (I.golden) for (let z = I.bbox[1]; z <= I.bbox[3]; z++){ if ((z & 7) === 0) yield; for (let x = I.bbox[0]; x <= I.bbox[2]; x++){ if (!A.inI(x, z)) continue; let edge = false; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!A.inI(x + dx, z + dz)) edge = true; if (edge || A.rand() < .03) A.put(x, A.top(x, z), z, ORE); } }
  // trails from the landing pad to every launch pad, module entrance and vault
  const L = I.pads.land || { x: Math.round(I.x), y: A.top(Math.round(I.x), Math.round(I.z)) + 1, z: Math.round(I.z) };
  for (const k in I.pads.launch){ const p = I.pads.launch[k]; A.trail(L.x, L.y, L.z, p.x, p.y, p.z); yield; }
  for (const M of rts) if (M.ex !== undefined){ if (M.ey < 2) M.ey = L.y; A.trail(L.x, L.y, L.z, M.ex, M.ey, M.ez); yield; }
  I.content = rts; for (const M of rts){ MODRT.push(M); if (MODDONE.has(M.key)){ M.done = true; } }
  return A.X;
}
function afterIslandContent(I){ for (const M of (I.content || [])){ if (M.def.id === 'camp' || M.id === 'camp'){ M.chiefE = ENEMIES.find(e => e.I === I && e.chief); } if (M.done && M.def.solved) M.def.solved(M); }
  // align the updrafts with the pads now that the real ground is known
  for (const u of WILD_UD){ if (u.from === I.k && I.pads && I.pads.launch[u.to]){ const p = I.pads.launch[u.to], ca = Math.cos(p.ang), sa = Math.sin(p.ang); let x = p.x + ca * 4, z = p.z + sa * 4; for (let s = 0; s < 14 && isl[Math.floor(x) + Math.floor(z) * WX] === OUT_ISL0 + I.k; s++){ x += ca; z += sa; } u.x = x + ca * 2.5; u.z = z + sa * 2.5; u.padY = p.y; u.launchPad = p; }
    if (u.to === I.k && I.pads && I.pads.land){ u.landPad = I.pads.land; u.landY = I.pads.land.y; } }
}
// ---- runtime ----
let modFxMesh = null, modFxN = 0;
function modFx(x, y, z, s, r, g, b){ if (!modFxMesh || modFxN >= 64 || s <= 0) return; _m0.makeScale(s, s, s); _m0.setPosition(x, y, z); modFxMesh.setMatrixAt(modFxN, _m0); modFxMesh.setColorAt(modFxN, _col.setRGB(r * 1.6, g * 1.6, b * 1.6)); modFxN++; }
function modSet(x, y, z, id){ if (x < 0 || y < 0 || z < 0 || x >= WX || y >= WY || z >= WZ) return; const i = wi(x, y, z), old = world[i]; if (old === id) return; world[i] = id; const ch = chunks[ckey(x >> 4, 0, z >> 4)]; ch.count += (id ? 1 : 0) - (old ? 1 : 0);
  if (B_EMIT[old] || B_EMIT[id] || B_OPQ[old] !== B_OPQ[id]){ if (relight(x, y, z, _rel)) markBox(_rel[0] - 1, _rel[1] - 1, _rel[2] - 1, _rel[3] + 1, _rel[4] + 1, _rel[5] + 1); } markBox(x - 1, y - 1, z - 1, x + 1, y + 1, z + 1); }
function modComplete(M){ if (M.done) return; M.done = true; MODDONE.add(M.key); saveDirty = true; if (M.def.solved) M.def.solved(M);
  const c = CHESTS.find(c => c.mod === M.key); if (c) sparkle(c.x + .5, c.y + 1, c.z + .5, 16, 1, .85, .4);
  SND.shard(); toastCard(MLABEL[M.id] + ' · done', c && c.lock ? 'The island unseals its reward chest.' : 'Well played.', 4500);
  const I = M.I; if (I.content.every(q => q.done)){ setTimeout(() => { SND.legendary(); toastCard(I.name + ' · cleared', 'Every challenge on this island is complete. It is starred on your map and in the Wilds Atlas.', 6500); }, 900); }
  renderJournalSoon(); }
function modChestOpened(c){ const M = MODRT.find(q => q.key === c.mod); if (c.special === 'gold' && !goldSail){ goldSail = true; saveDirty = true; toastCard('The Gilded Sail', 'Your sail now shimmers gold. Only one island in each sky holds this.', 7000); }
  if (M && !M.done && (M.id === 'cave' || M.id === 'ship')) modComplete(M); }
function islandCleared(I){ return !!(I.content && I.content.length && I.content.every(q => q.done)); }
function modsTick(dt){
  modFxN = 0; if (!modFxMesh && glOK){ modFxMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), 64); modFxMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(64 * 3), 3); modFxMesh.frustumCulled = false; scene.add(modFxMesh); }
  if (state === 'play') for (const I of OUT){ if (I.gen !== 2 || !I.content) continue; if (Math.abs(PL.x - I.x) > I.r + 50 || Math.abs(PL.z - I.z) > I.r + 50) continue; // dormant unless you are near
    for (const M of I.content) M.def.tick(M, dt); hazardTick(I, dt);
    if (PL.onGround && outerIsle(PL.x, PL.z) === I && !I.cardShown){ I.cardShown = true; showIsleCard(I); } }
  if (modFxMesh){ modFxMesh.count = modFxN; modFxMesh.visible = modFxN > 0; if (modFxN){ modFxMesh.instanceMatrix.needsUpdate = true; modFxMesh.instanceColor.needsUpdate = true; } }
}
function showIsleCard(I){ const el = $('#isleCard'); if (!el) return; el.querySelector('.ic-k').textContent = (I.golden ? 'A golden island · ' : '') + BIOMES[I.b].name + ' · Tier ' + (I.tier || 1); el.querySelector('.ic-n').textContent = I.name;
  el.querySelector('.ic-m').textContent = (I.content || []).map(M => MLABEL[M.id] + (M.done ? ' ✓' : '')).join('  ·  '); el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); SND.waystone(); }
function renderAtlas(){ const el = $('#jrAtlas'); if (!el) return; const L = OUT.slice().sort((a, b) => (a.depthL || 0) - (b.depthL || 0));
  el.innerHTML = L.map(I => { const known = I.seen || REVEALED.has(I.k), c = I.content || [], done = c.filter(q => q.done).length, cl = islandCleared(I);
    return '<div class="arow' + (known ? '' : ' off') + '"><span class="an">' + (cl ? '★ ' : '') + (known ? esc(I.name) : 'Unknown island') + '</span><span class="lbl8">Tier ' + (I.tier || 1) + (known ? ' · ' + BIOMES[I.b].name : '') + '</span>'
      + (I.seen ? '<span class="am">' + (c.length ? c.map(M => (M.done ? '✓ ' : '· ') + MLABEL[M.id]).join('<br>') : (I.gen === 2 ? 'Nothing stirs here' : 'Land here to learn more')) + '</span>' : '<span class="am dim2">' + (REVEALED.has(I.k) ? 'Seen through the observatory lens' : 'Not yet found') + '</span>')
      + (I.seen && c.length ? '<span class="lbl8">' + done + '/' + c.length + '</span>' : '') + '</div>'; }).join(''); }
