/* =====================================================================
   THE WILDS: a seeded crescent of procedural islands beyond the safe skies.
   The safe zone [0,320)^2 holds Home Isle and the inner islets. Out here: five biomes, nine island
   archetypes, structures from templates with procedural variation, enemies, loot chests, weapons,
   and one guarded Sky Vault that holds the grappling hook. Islands are voxelised lazily (in a worker)
   as the player approaches; until then a one-draw-call silhouette keeps the horizon populated.
   ===================================================================== */
const BIOMES = [
  { id: 'ruins', name: 'Mossy Ruins', top: [.42, .55, .33], rock: [.46, .44, .42], fog: [.62, .7, .62], structs: [0, 1], wild: [0, 0, 1], syl: ['Moss', 'Old', 'Fern', 'Grey', 'Hollow'], suf: ['fall', 'hold', 'stead', 'reach', 'mere'] },
  { id: 'mesa', name: 'Red-rock Mesa', top: [.66, .36, .25], rock: [.55, .3, .22], fog: [.82, .62, .5], structs: [2, 0], wild: [1, 4, 1], syl: ['Red', 'Ochre', 'Dust', 'Sun', 'Rust'], suf: ['spur', 'butte', 'table', 'crag', 'shelf'] },
  { id: 'frost', name: 'Frost Spires', top: [.88, .92, .95], rock: [.5, .55, .62], fog: [.75, .82, .9], structs: [3, 1], wild: [3, 2, 0], syl: ['Rime', 'Frost', 'Pale', 'Hail', 'White'], suf: ['spire', 'peak', 'horn', 'tooth', 'reach'] },
  { id: 'grove', name: 'Mushroom Grove', top: [.5, .42, .56], rock: [.42, .38, .45], fog: [.7, .64, .78], structs: [1, 4], wild: [0, 0, 3], syl: ['Spore', 'Gill', 'Cap', 'Glow', 'Mire'], suf: ['grove', 'hollow', 'wood', 'ring', 'bloom'] },
  { id: 'ash', name: 'Ashen Isles', top: [.42, .4, .39], rock: [.25, .24, .26], fog: [.55, .5, .5], structs: [2, 3], wild: [3, 1, 2], syl: ['Ash', 'Cinder', 'Soot', 'Ember', 'Char'], suf: ['fell', 'pyre', 'scar', 'heap', 'vale'] }
];
const STRUCT_NAMES = ['Ruined watchtower', 'Sunken shrine', 'Goblin camp', 'Crystal vault', 'Sky-wreck'], STRUCT_TIER = [1, 2, 1, 3, 2];

/* =====================================================================
   ISLAND GENERATOR (shared by Home Isle, the inner islets and the Wilds; runs in a worker)
   ---------------------------------------------------------------------
   Every island is sculpted the same way, then dressed per biome:
     1 silhouette: an organic outline (two noise octaves, optional aspect), terraced highlands
       with 5-block cliff steps, rim terraces, a tapered keel underneath (rock strata on the sides).
     2 3D carving: eroded undercuts and overhang lips near the rim, worm caves and through-tunnels
       that swell into chambers (each chamber is a hidden nook), lit by glowcaps and crystals.
     3 underside: stalactites, hanging roots, small floating debris rocks.
     4 water: a spring on the high ground feeds a river that steps down terraces as waterfalls,
       pools at the bottom of each drop, and leaves the island as a curtain waterfall off the rim.
     5 dressing: several tree species (oak, birch, pine, autumn, willow, a giant canopy tree),
       bushes, meadows of tall grass, flower drifts, ferns, mushrooms, vines on cliff faces,
       boulders, standing stones, rock spires, arches, ruins and props.
     6 landmarks: each island gets one tall point of interest that reads from far away.
   Biomes: 0 ruins, 1 mesa, 2 frost, 3 grove, 4 ash (the Wilds); 5 temperate islet; 6 Home Isle.
   ===================================================================== */
function WGEN(self){
  let B = null, SEED = 1, WXg = 512, WZg = 512, H = 96;
  function h2(x, z){ let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + SEED) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
  function h3(x, y, z){ let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 1103515245) + Math.imul(z | 0, 668265263) + SEED) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
  function vn(x, z){ const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi; const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
    const a = h2(xi, zi), b = h2(xi + 1, zi), c = h2(xi, zi + 1), d = h2(xi + 1, zi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
  function vn3(x, y, z){ const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi; const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    const a = h3(xi, yi, zi), b = h3(xi + 1, yi, zi), c = h3(xi, yi + 1, zi), d = h3(xi + 1, yi + 1, zi), e = h3(xi, yi, zi + 1), f = h3(xi + 1, yi, zi + 1), g = h3(xi, yi + 1, zi + 1), k = h3(xi + 1, yi + 1, zi + 1);
    const x1 = a + (b - a) * u, x2 = c + (d - c) * u, x3 = e + (f - e) * u, x4 = g + (k - g) * u, y1 = x1 + (x2 - x1) * v, y2 = x3 + (x4 - x3) * v; return y1 + (y2 - y1) * w; }
  function fbm(x, z){ let s = 0, a = .5, f = 1; for (let i = 0; i < 4; i++){ s += a * vn(x * f, z * f); f *= 2.03; a *= .5; } return s / .9375; }
  const ridge = (x, z) => 1 - Math.abs(fbm(x, z) * 2 - 1);
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v, sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  function mulberry(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const temperate = I => I.b >= 5;

  // archetypes: plain, mesa, atoll (ring + central lake), spires (a cluster of needles), arch (a hole through, spanned
  // by a rock arch), terrace (stepped cliffs), ruins (overgrown), bridged (lobes joined by natural rock bridges),
  // archipelago (tiny rock-hopping islets)
  function archData(I){
    if (I._ad) return I._ad; const r = mulberry(((SEED * 7) ^ Math.imul(I.k + 11, 40503)) >>> 0), A = {};
    if (I.arch === 'bridged'){ const n = I.r > 18 ? 3 : 2; A.lobes = []; A.bridges = []; const a0 = r() * 6.283;
      for (let k = 0; k < n; k++){ const a = a0 + k / n * 6.283 + (r() - .5) * .5, dist = I.r * (.62 + r() * .1); A.lobes.push({ x: I.x + Math.cos(a) * dist, z: I.z + Math.sin(a) * dist, r: I.r * (.42 + r() * .12), dh: Math.round((r() - .5) * 8) }); }
      for (let k = 0; k < n - (n === 2 ? 1 : 0); k++) A.bridges.push([A.lobes[k], A.lobes[(k + 1) % n]]); }
    else if (I.arch === 'archipelago'){ const n = 5 + Math.floor(r() * 4); A.lobes = [];
      for (let t = 0; t < 60 && A.lobes.length < n; t++){ const a = r() * 6.283, dist = Math.sqrt(r()) * I.r * .8, lr = Math.max(2.6, I.r * (.17 + r() * .12)), L = { x: I.x + Math.cos(a) * dist, z: I.z + Math.sin(a) * dist, r: lr, dh: Math.round((r() - .5) * 14) };
        if (A.lobes.some(o => Math.hypot(o.x - L.x, o.z - L.z) < (o.r + L.r) * 1.25 + 2)) continue; A.lobes.push(L); } }
    else if (I.arch === 'spires'){ A.spires = []; const n = 3 + Math.floor(r() * 4); for (let k = 0; k < n; k++){ const a = r() * 6.283, dist = (.15 + r() * .5) * I.r; A.spires.push({ x: I.x + Math.cos(a) * dist, z: I.z + Math.sin(a) * dist, r: 2.4 + r() * 2, h: 10 + r() * 16 }); } }
    else if (I.arch === 'arch'){ A.hole = { x: I.x + (r() - .5) * I.r * .2, z: I.z + (r() - .5) * I.r * .2, r: Math.max(3, I.r * .22), ang: r() * 3.14 }; }
    I._ad = A; return A;
  }
  // column shape: shared by the voxel generator and the far silhouettes, so they always agree
  function shapeE(I, x, z, out){ const s = I.k * 17.3 + 5, AD = archData(I); let base, lobe = null;
    if (AD.lobes){ base = 9; for (const L of AD.lobes){ const v = Math.hypot(x - L.x, z - L.z) / L.r; if (v < base){ base = v; lobe = L; } } }
    else { const dx = (x - I.x) / (I.ax || 1), dz = (z - I.z) / (I.az || 1); base = Math.sqrt(dx * dx + dz * dz) / I.r; }
    if (out) out.lobe = lobe;
    let e = base + (fbm(x * .045 + s, z * .045 - s) - .5) * (AD.lobes ? .45 : .62) + (fbm(x * .15 - s, z * .15 + s) - .5) * .16;
    if (AD.hole){ const hd = Math.hypot(x - AD.hole.x, z - AD.hole.z) / AD.hole.r; if (hd < 1) e = Math.max(e, 1 + (1 - hd)); }
    return e; }
  function col(I, x, z, out){
    const e = shapeE(I, x, z, out);
    if (e >= 1){ out.in = 0; return out; }
    const AD = archData(I), arch = I.arch || 'plain';
    const s = I.k * 17.3 + 5, edge = 1 - sstep(.55, 1, e), n1 = fbm(x * .035 + s * 2, z * .035 + 3);
    let h = I.top;
    if (arch === 'mesa'){ h = I.top + Math.round((n1 - .5) * 3) + (e < .82 ? 0 : -Math.round((e - .82) * 6)); }
    else if (arch === 'terrace'){ const tv = sstep(.2, .85, fbm(x * .02 + s, z * .02)) * 22 * (1 - sstep(.5, .95, e)); h += Math.floor(tv / 5) * 5 + Math.round((n1 - .5) * 3); }
    else if (temperate(I)){
      const hm = fbm(x * .016 + s * 3, z * .016 - s) + (I.hlBias || 0), tv = sstep(.45, .8, hm) * (I.hl === undefined ? 10 : I.hl) * (1 - sstep(.45, .9, e)), st = 5;
      const q = Math.floor(tv / st) * st + sstep(.72, 1, (tv / st) % 1) * st; // terraces: flat benches, 5-high cliff steps
      h += Math.round((n1 - .5) * 6 * edge + q);
    }
    else if (I.b === 0) h += Math.round((n1 - .5) * 9 * edge);
    else if (I.b === 1){ h = Math.floor((I.top + (n1 - .35) * 18 * edge) / 4) * 4; }
    else if (I.b === 2){ h += Math.round((n1 - .5) * 6 * edge); const r = ridge(x * .08 + s, z * .08 - s); if (r > .8 && e < .72) h += Math.round((r - .8) / .2 * 19 * edge); }
    else if (I.b === 3) h += Math.round(Math.sin(n1 * 3.1) * 4 * edge + (n1 - .5) * 4);
    else { const r = ridge(x * .065 + s, z * .065); h += Math.round((r - .5) * 12 * edge); }
    if (out.lobe) h += out.lobe.dh;
    if (arch === 'atoll'){ const d0 = Math.hypot(x - I.x, z - I.z) / I.r; h += Math.round(sstep(.35, .62, d0) * 4 - sstep(.7, 1, e) * 2); }
    if (AD.spires) for (const sp of AD.spires){ const dd = Math.hypot(x - sp.x, z - sp.z) / sp.r; if (dd < 1) h = Math.max(h, I.top + Math.round(Math.pow(1 - dd, .35) * sp.h)); }
    if (I.flats) for (const f of I.flats){ const d = Math.hypot(x - f.x, z - f.z); if (d < f.r + 5){ const w = 1 - sstep(f.r, f.r + 5, d); h = Math.round(h * (1 - w) + f.h * w); } }
    if (e > .88) h--; if (e > .96) h--;
    // underside profile varies with the archetype: mesas are blunt and deep, archipelago rocks are short cones, the rest taper
    const kp = arch === 'mesa' ? .22 : arch === 'archipelago' ? .8 : arch === 'atoll' ? .4 : .5;
    const dep = I.depth * (out.lobe ? out.lobe.r / I.r * 1.4 : 1) * Math.pow(1 - e, kp) * (.55 + .8 * fbm(x * .09 + 5 + s, z * .09 - s));
    const b = h - 3 - Math.round(dep);
    out.in = 1; out.e = e; out.top = Math.min(h, H - 10); out.bot = Math.max(3, Math.min(b, out.top - 2)); return out;
  }

  function genIsland(I){
    const rnd = mulberry((SEED ^ Math.imul(I.k + 1, 2654435761)) >>> 0);
    const R = Math.ceil(I.r * 1.75 * Math.max(I.ax || 1, I.az || 1)) + 6;
    const x0 = Math.max(2, I.x - R), z0 = Math.max(2, I.z - R), x1 = Math.min(WXg - 3, I.x + R), z1 = Math.min(WZg - 3, I.z + R);
    const w = x1 - x0 + 1, d = z1 - z0 + 1;
    const blk = new Uint8Array(w * d * H), top = new Int16Array(w * d).fill(-1), bot = new Int16Array(w * d), ee = new Float32Array(w * d), res = new Uint8Array(w * d), wat = new Int16Array(w * d).fill(-1);
    const ci = (x, z) => (x - x0) + (z - z0) * w, inb = (x, z) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
    const at = (x, y, z) => (x - x0) + w * ((z - z0) + d * y);
    const put = (x, y, z, id) => { if (!inb(x, z) || y < 1 || y > H - 2) return; blk[at(x, y, z)] = id; };
    const get = (x, y, z) => (!inb(x, z) || y < 0 || y > H - 1) ? 0 : blk[at(x, y, z)];
    const isIn = (x, z) => inb(x, z) && top[ci(x, z)] >= 0;
    const o = {}, safe = !!I.safe, T5 = temperate(I);
    const nooks = [], pois = [], falls = [], trees = [], ff = [], bf = [];
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++){ col(I, x, z, o); if (!o.in) continue; const c = ci(x, z); top[c] = o.top; bot[c] = o.bot; ee[c] = o.e; }
    if (I.arch === 'atoll'){ const lr = I.r * .4, lvl = I.top - 1; for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++){ const c = ci(x, z); if (top[c] < 0) continue; const d0 = Math.hypot(x - I.x, z - I.z) - (fbm(x * .1, z * .1) - .5) * 3; if (d0 < lr){ top[c] = Math.min(top[c], lvl - 1 - Math.round(sstep(lr, 0, d0) * 3)); wat[c] = lvl; res[c] = 1; } else if (d0 < lr + 1.5 && top[c] >= lvl){ top[c] = lvl; } } }
    if (I.res) for (const r of I.res) for (let z = r[1]; z <= r[3]; z++) for (let x = r[0]; x <= r[2]; x++) if (inb(x, z)) res[ci(x, z)] = 2;
    // ---- stalactites (part of the keel: computed on the column bottoms, so the fill makes them)
    const nSp = Math.round(I.r * (I.b === 2 ? 1.6 : 1.1));
    for (let k = 0; k < nSp; k++){
      const a = rnd() * 6.283, rr = Math.sqrt(rnd()) * I.r * .8, cx = Math.round(I.x + Math.cos(a) * rr), cz = Math.round(I.z + Math.sin(a) * rr); if (!isIn(cx, cz)) continue;
      const len = 3 + rnd() * (6 + 10 * (1 - ee[ci(cx, cz)])), rad = 1.2 + rnd() * 1.6;
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++){ const X = cx + dx, Z = cz + dz; if (!isIn(X, Z)) continue; const dd = Math.hypot(dx, dz) / rad; if (dd >= 1) continue; const c = ci(X, Z); bot[c] = Math.max(2, Math.min(bot[c], bot[ci(cx, cz)] - Math.round(len * (1 - dd) * (1 - dd * .3)))); }
    }
    // ---- water first, so terrain fill knows the channel: a spring on the high ground, a river stepping down to the rim
    const waterRun = (sx, sz, bias) => {
      let x = sx, z = sz, L = top[ci(x, z)], dirx = bias ? bias[0] : 0, dirz = bias ? bias[1] : 0, steps = 0, lastDrop = -9;
      const seen = new Set();
      const mark = (X, Z, lvl) => { if (!isIn(X, Z)) return; const c = ci(X, Z); if (top[c] >= lvl - 1 || wat[c] < 0){ if (top[c] > lvl - 1 || wat[c] < 0){ top[c] = lvl - 1; if (bot[c] > top[c] - 3) bot[c] = top[c] - 3; } wat[c] = Math.max(wat[c], lvl); res[c] = res[c] || 1; } };
      while (steps++ < 260){
        seen.add(x + ',' + z);
        // pool at the foot of a drop
        if (steps - lastDrop === 2){ for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (dx * dx + dz * dz <= 5 && isIn(x + dx, z + dz) && top[ci(x + dx, z + dz)] >= L - 1) mark(x + dx, z + dz, L); }
        mark(x, z, L); if (Math.abs(dirz) >= Math.abs(dirx)) { mark(x + 1, z, L); } else mark(x, z + 1, L);
        // next cell: prefer downhill, keep heading outward, a little meander
        let best = null, bs = -1e9;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]){ const X = x + dx, Z = z + dz; if (seen.has(X + ',' + Z)) continue;
          if (!isIn(X, Z)){ const sc = 50 + (dx * dirx + dz * dirz) * 4; if (sc > bs){ bs = sc; best = [X, Z, dx, dz, true]; } continue; }
          const c = ci(X, Z), hh = wat[c] >= 0 ? L - 1 : top[c];
          const sc = -(hh - L) * 2.2 + (ee[c] - ee[ci(x, z)]) * 30 + (dx * dirx + dz * dirz) * 1.6 + (h2(X * 3 + steps, Z) - .5) * 1.4 - (res[c] === 2 ? 40 : 0);
          if (sc > bs){ bs = sc; best = [X, Z, dx, dz, false]; } }
        if (!best) break;
        const [X, Z, dx, dz, out] = best; dirx = dirx * .6 + dx * .4; dirz = dirz * .6 + dz * .4;
        if (out){ falls.push({ x: x + .5 + dx * .5, y: L + .86, z: z + .5 + dz * .5, dx, dz, rim: 1 });
          for (let k = 1; k <= 5; k++) put(x + dx, L - k + 1, z + dz, 0); // the curtain falls into open air; the rim keeps a lip
          break; }
        const nh = top[ci(X, Z)];
        if (nh < L - 2){ // a terrace drop: the river falls as a waterfall to the lower level
          const nL = nh + 1; falls.push({ x: x + .5 + dx * .5, y: L + .86, z: z + .5 + dz * .5, dx, dz, h: L - nL });
          for (let y = nL; y <= L; y++) wfall.push([X, y, Z]);
          L = nL; lastDrop = steps;
        }
        x = X; z = Z;
      }
    };
    const wfall = [];
    if ((T5 || I.b === 0 || I.b === 3) && I.r >= 11 && I.river !== false){
      let sx = I.spring ? I.spring.x : -1, sz = I.spring ? I.spring.z : -1;
      if (sx < 0){ let bh = -1; for (let t = 0; t < 80; t++){ const a = rnd() * 6.283, rr = rnd() * I.r * .45, X = Math.round(I.x + Math.cos(a) * rr), Z = Math.round(I.z + Math.sin(a) * rr); if (!isIn(X, Z) || res[ci(X, Z)] === 2) continue; if (top[ci(X, Z)] > bh){ bh = top[ci(X, Z)]; sx = X; sz = Z; } } }
      if (sx >= 0) waterRun(sx, sz, I.riverDir);
    }
    if (I.ponds) for (const p of I.ponds){ for (let dz = -Math.ceil(p.r) - 2; dz <= p.r + 2; dz++) for (let dx = -Math.ceil(p.r) - 2; dx <= p.r + 2; dx++){ const X = p.x + dx, Z = p.z + dz; if (!isIn(X, Z)) continue; const dd = Math.hypot(dx, dz), c = ci(X, Z); if (dd < p.r){ top[c] = dd < p.r - 1.4 ? p.l - 3 : p.l - 1; wat[c] = p.l; res[c] = res[c] || 1; } else if (dd < p.r + 1.6){ top[c] = p.l; res[c] = res[c] || 1; } } }
    // ---- fill columns: layered rock with strata, biome surfaces, edge transitions
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++){
      const c = ci(x, z); const h = top[c]; if (h < 0) continue; const b = bot[c], e = ee[c];
      // a cliff edge: any neighbour more than 2 lower (gets moss / snow caps / exposed strata)
      let drop = 0; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]){ const X = x + dx, Z = z + dz; const nh = isIn(X, Z) ? top[ci(X, Z)] : b; drop = Math.max(drop, h - nh); }
      const so = Math.floor(fbm(x * .05, z * .05) * 4), mossy = (e > .9 && fbm(x * .2, z * .2) > .55);
      for (let y = b; y <= h; y++){
        const depth = h - y; let id;
        const strata = ((y + so) % 7);
        if (T5){
          if (depth === 0) id = wat[c] >= 0 ? (h3(x, y, z) < .5 ? B.SAND : B.GRAVEL) : ((drop > 3 && h3(x, 1, z) < .5) || mossy ? B.MOSS : B.GRASS);
          else if (depth <= 3 - (drop > 4 ? 1 : 0)) id = wat[c] >= 0 && depth <= 1 ? B.SAND : B.DIRT;
          else id = strata === 0 ? B.COBBLE : strata === 4 && depth > 6 ? B.DEEP : B.STONE;
        }
        else if (I.b === 0){ id = depth === 0 ? (h3(x, y, z) < .12 && e > .6 ? B.MOSS : B.GRASS) : depth <= 3 ? B.DIRT : (strata === 0 ? B.MOSS : B.STONE); }
        else if (I.b === 1){ id = depth === 0 ? (fbm(x * .2, z * .2) > .62 ? B.SAND : B.REDROCK) : (y % 4 === 0 ? B.REDBAND : B.REDROCK); }
        else if (I.b === 2){ id = depth === 0 ? (fbm(x * .15 + 9, z * .15) > .66 ? B.ICE : B.SNOW) : depth <= 2 ? B.SNOW : (strata === 2 ? B.ICE : B.STONE); if (depth > 0 && depth <= 4 && drop > 3) id = B.SNOW; }
        else if (I.b === 3){ id = depth === 0 ? B.MYCEL : depth <= 3 ? B.DIRT : (strata === 3 ? B.DEEP : B.STONE); }
        else { id = depth === 0 ? (h3(x, y, z) < .05 ? B.EMBER : B.ASH) : depth <= 2 ? B.ASH : (h3(x, y, z) < .05 ? B.EMBER : B.BASALT); }
        if (y < b + 3 && depth > 3) id = I.b === 4 ? B.BASALT : B.DEEP;
        else if (depth > 4 && h3(x * 3, y, z) < .022) id = I.b === 4 ? B.EMBER : I.b === 2 ? B.OREF : I.b === 1 ? B.OREC : I.b === 3 ? B.OREA : B.ORE;
        put(x, y, z, id);
      }
      if (wat[c] >= 0) for (let y = h + 1; y <= wat[c]; y++) put(x, y, z, B.WATER);
    }
    for (const [X, y, Z] of wfall) if (!get(X, y, Z)) put(X, y, Z, B.WATER);
    // ---- erosion: undercuts and overhang lips near the rim (top two layers stay, so nothing floats)
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++){
      const c = ci(x, z), h = top[c]; if (h < 0 || ee[c] < .66 || res[c] === 2 || wat[c] >= 0) continue; const thr = .7 - (ee[c] - .66) * 1.15;
      for (let y = Math.max(bot[c] + 2, h - 10); y <= h - 3; y++) if (vn3(x * .13, y * .19, z * .13) > thr) put(x, y, z, 0);
    }
    // ---- caves: worm tunnels from the cliffs inward, swelling into chambers (hidden nooks)
    const carve = (cx, cy, cz, r, ry, floor) => {
      const R = Math.ceil(r);
      for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++){
        if (dy < -ry * floor) continue; if ((dx * dx + dz * dz) / (r * r) + (dy * dy) / (ry * ry) > 1) continue;
        const X = Math.round(cx) + dx, Y = Math.round(cy) + dy, Z = Math.round(cz) + dz; if (!isIn(X, Z)) continue; const c = ci(X, Z);
        if (Y > top[c] - 3 && ee[c] < .9) continue; if (res[c] === 2 && Y > top[c] - 6) continue; const g = get(X, Y, Z); if (g === B.WATER) continue; if (g) put(X, Y, Z, 0);
      }
    };
    const nCave = I.caves !== undefined ? I.caves : (I.r >= 15 ? 2 : I.r >= 10 ? 1 : 0), cavePts = [];
    for (let k = 0; k < nCave; k++){
      const a0 = (k / Math.max(1, nCave)) * 6.283 + rnd() * 1.5; let ex = I.x + Math.cos(a0) * I.r * 1.2, ez = I.z + Math.sin(a0) * I.r * 1.2;
      for (let t = 0; t < 60 && !isIn(Math.round(ex), Math.round(ez)); t++){ ex -= Math.cos(a0) * .8; ez -= Math.sin(a0) * .8; }
      const ec = ci(Math.round(ex), Math.round(ez)); if (top[ec] < 0) continue;
      let px = ex, pz = ez, py = top[ec] - 5 - rnd() * 5, yaw = a0 + Math.PI + (rnd() - .5) * .8, pitch = 0;
      const L = I.r * (1.3 + rnd() * .7), chamberAt = L * (.45 + rnd() * .2), rad0 = 1.7 + rnd() * .5;
      let chamber = null;
      for (let s = 0; s < L; s++){
        yaw += (vn(s * .15, k * 7 + 3) - .5) * .5; pitch = (vn(s * .2 + 9, k) - .5) * .5;
        px += Math.cos(yaw); pz += Math.sin(yaw); py = clamp(py + pitch * .6, 8, H - 12);
        const X = Math.round(px), Z = Math.round(pz); if (!isIn(X, Z)){ if (s > 6) break; else continue; }
        if (py > top[ci(X, Z)] - 4) py = top[ci(X, Z)] - 4; if (py < bot[ci(X, Z)] + 3) py = bot[ci(X, Z)] + 3;
        const rr = rad0 + (vn(s * .3, k * 3) - .5) * .7;
        if (!chamber && s >= chamberAt){ const cr = I.r >= 15 ? 4.5 : 3.6; carve(px, py, pz, cr, cr * .75, .35); chamber = [Math.round(px), Math.round(py - cr * .35 * .75), Math.round(pz)]; }
        else carve(px, py, pz, rr, rr * .85, .45);
        if (s % 7 === 3) cavePts.push([Math.round(px), Math.round(py), Math.round(pz)]);
      }
      if (chamber){ let [cx, cy, cz] = chamber; while (cy > 2 && !get(cx, cy - 1, cz)) cy--; nooks.push({ x: cx, y: cy, z: cz, kind: 'cave' }); }
    }
    // cave light: glowcaps on the floor, crystals in the chambers
    for (const [px, py, pz] of cavePts){ let y = py; while (y > 2 && !get(px, y - 1, pz)) y--; if (!get(px, y, pz) && get(px, y - 1, pz) && get(px, y - 1, pz) !== B.WATER) put(px, y, pz, B.GSHROOM); }
    for (const n of nooks) if (n.kind === 'cave'){ for (const [dx, dz] of [[2, 1], [-2, 0], [1, -2], [-1, 2]]){ let y = n.y; while (y > 2 && !get(n.x + dx, y - 1, n.z + dz)) y--; if (!get(n.x + dx, y, n.z + dz) && get(n.x + dx, y - 1, n.z + dz)){ const cr = I.b === 3 ? B.CRYR : I.b === 2 ? B.CRYF : B.CRYSTAL; put(n.x + dx, y, n.z + dz, cr); if (h3(dx, n.y, dz) < .5 && !get(n.x + dx, y + 1, n.z + dz)) put(n.x + dx, y + 1, n.z + dz, cr); } } }
    // ---- a waterfall alcove: a dry nook behind the first big curtain
    for (const f of falls) if (f.h >= 4){ const bx = Math.round(f.x - .5 - f.dx * .5), bz = Math.round(f.z - .5 - f.dz * .5), y0 = Math.round(f.y - .86) - f.h + 1;
      for (let k = 1; k <= 3; k++) for (let y = y0; y <= y0 + 2; y++) for (let s2 = -1; s2 <= 1; s2++){ const X = bx - f.dx * (k - 1) + f.dz * s2, Z = bz - f.dz * (k - 1) + f.dx * s2; if (get(X, y, Z) !== B.WATER) put(X, y, Z, 0); }
      nooks.push({ x: bx - f.dx, y: y0, z: bz - f.dz, kind: 'falls' }); break; }
    const surf = (x, z) => isIn(x, z) ? top[ci(x, z)] : -1;
    // ---- shared dressing helpers
    const free = (x, z, r) => { for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++){ const X = x + dx, Z = z + dz; if (!isIn(X, Z) || res[ci(X, Z)]) return false; } return true; };
    const mark = (x, z, r) => { for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (inb(x + dx, z + dz) && !res[ci(x + dx, z + dz)]) res[ci(x + dx, z + dz)] = 1; };
    const blob = (cx, cy, cz, r, fy, id, keep) => { const R = Math.ceil(r); for (let y = -R; y <= R; y++) for (let z = -R; z <= R; z++) for (let x = -R; x <= R; x++){ if (Math.hypot(x, y * fy, z) <= r + (h3(cx + x, cy + y, cz + z) - .5) * .9 && (!keep || !get(cx + x, cy + y, cz + z))) put(cx + x, cy + y, cz + z, id); } };
    const chests = [], spawns = [], structs = [];
    const fillDown = (x, y, z, id) => { if (!isIn(x, z)) return false; let yy = y; const b = bot[ci(x, z)]; while (yy > b && !get(x, yy, z)) { put(x, yy, z, id); yy--; } return true; };
    const PLANT = id => id === B.TGRASS || id === B.ROSE || id === B.SUNF || id === B.BELL || id === B.FERN || id === B.MUSHR || id === B.GSHROOM || id === B.DEADB;
    const standable = (x, y, z) => { const a = get(x, y, z), b2 = get(x, y - 1, z), c2 = get(x, y + 1, z); return (!a || PLANT(a)) && b2 && !PLANT(b2) && b2 !== B.WATER && b2 !== B.LEAVES && (!c2 || PLANT(c2)); };
    const spawnNear = (x, z, y, type, guard, rmin) => { for (let r = rmin || 2; r <= 9; r++) for (let k = 0; k < 12; k++){ const a = k / 12 * 6.283 + rnd(), X = Math.round(x + Math.cos(a) * r), Z = Math.round(z + Math.sin(a) * r); if (!isIn(X, Z)) continue; const yy = surf(X, Z) + 1; if (standable(X, yy, Z)){ spawns.push({ x: X + .5, y: yy, z: Z + .5, type, guard }); return; } } };
    const chest = (x, y, z, tier, si) => { put(x, y, z, B.CHEST); chests.push({ x, y, z, tier, s: si }); };
    // ---- trees: oak, birch, pine, autumn, willow, blossom/glow (home), a giant canopy tree (landmark)
    const canopy = (x, cy, z, r, leaf, squash) => { const R = Math.ceil(r) + 1; for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++){ const dd = Math.hypot(dx, (dy - .3) * (squash || 1.25), dz); if (dd <= r + (h3(x + dx, cy + dy, z + dz) - .5) * 1.1 && !get(x + dx, cy + dy, z + dz)) put(x + dx, cy + dy, z + dz, leaf); } };
    const TREE = {
      oak(x, y, z, leaf, bark){ const th = 3 + Math.floor(h2(x, z) * 3); for (let i = 0; i < th; i++) put(x, y + i, z, bark || B.LOG);
        const br = h2(z, x) < .5; if (br){ const q = [[1, 0], [0, 1], [-1, 0], [0, -1]][Math.floor(h2(x + 1, z) * 4)]; put(x + q[0], y + th - 1, z + q[1], bark || B.LOG); canopy(x + q[0] * 2, y + th, z + q[1] * 2, 1.7, leaf || B.LEAVES); }
        canopy(x, y + th, z, 2.2 + h2(z, x) * .9, leaf || B.LEAVES); return y + th; },
      birch(x, y, z){ const th = 5 + Math.floor(h2(x, z) * 3); for (let i = 0; i < th; i++) put(x, y + i, z, B.BIRCH); canopy(x, y + th - 1, z, 1.7, B.BIRCHL, .8); canopy(x, y + th + 1, z, 1.2, B.BIRCHL, 1); return y + th; },
      pine(x, y, z, leaf){ const th = 7 + Math.floor(h2(x, z) * 4); for (let i = 0; i < th; i++) put(x, y + i, z, B.LOG);
        for (let k = 0; k < th - 1; k++){ const r = Math.max(0, Math.round((th - k) * .38 - (k % 2) * .6)), yy = y + 2 + k; if (k < 1) continue; for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++){ if (Math.abs(dx) + Math.abs(dz) > r + (r > 1 ? 1 : 0)) continue; if (!get(x + dx, yy, z + dz)) put(x + dx, yy, z + dz, leaf || B.PINEL); } }
        put(x, y + th, z, leaf || B.PINEL); put(x, y + th + 1, z, leaf || B.PINEL); return y + th; },
      willow(x, y, z){ const th = 4 + Math.floor(h2(x, z) * 2); for (let i = 0; i < th; i++) put(x, y + i, z, B.LOG); canopy(x, y + th, z, 2.6, B.LEAVES, 1.6);
        for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++){ const dd = Math.hypot(dx, dz); if (dd < 2.2 || dd > 3.4 || h2(x + dx, z + dz) < .35) continue; let yy = y + th; while (yy > y + 1 && get(x + dx, yy, z + dz)) yy--; const L = 2 + Math.floor(h2(x - dx, z - dz) * 3); for (let k = 0; k < L && yy - k > y; k++) if (!get(x + dx, yy - k, z + dz)) put(x + dx, yy - k, z + dz, B.HVINE); } return y + th; },
      giant(x, y, z, leaf, bark){ // the landmark tree: 2x2 trunk, flared roots, three branch arms, a layered crown
        const th = 11 + Math.floor(h2(x, z) * 5), bk = bark || B.LOG, lf = leaf || B.LEAVES;
        for (let i = -2; i < th; i++) for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) put(x + dx, y + i, z + dz, bk);
        for (const [dx, dz] of [[-1, 0], [2, 1], [0, 2], [1, -1], [-1, 1], [2, 0]]) { put(x + dx, y, z + dz, bk); if (h2(x + dx, z + dz) < .5) put(x + dx, y + 1, z + dz, bk); }
        const arms = [[1, 0], [-1, .3], [.2, -1], [-.3, 1]];
        arms.forEach((a, k) => { const L = 4 + Math.floor(h2(x + k, z) * 3), by = y + th - 4 + k % 2 * 2; for (let s = 1; s <= L; s++) put(x + Math.round(a[0] * s) + (a[0] > 0 ? 1 : 0), by + Math.floor(s / 2), z + Math.round(a[1] * s) + (a[1] > 0 ? 1 : 0), bk); canopy(x + Math.round(a[0] * L) + (a[0] > 0 ? 1 : 0), by + Math.floor(L / 2) + 1, z + Math.round(a[1] * L) + (a[1] > 0 ? 1 : 0), 3.2, lf, 1.5); });
        canopy(x, y + th + 1, z, 4.6, lf, 1.5); canopy(x + 1, y + th + 4, z + 1, 3, lf, 1.3);
        return y + th + 6; }
    };
    const plantTree = (kind, x, y, z, leaf, bark) => { trees.push([x, y, z]); const ty = TREE[kind](x, y, z, leaf, bark); if (h2(x + 3, z) < .5) ff.push([x + .5, ty, z + .5]); return ty; };
    // ---- rock formations
    const boulder = (x, z, r) => { const y = surf(x, z); if (y < 0) return; blob(x, y + Math.round(r * .4), z, r, 1.25, I.b === 4 ? B.BASALT : I.b === 1 ? B.REDROCK : h2(x, z) < .5 ? B.MOSS : B.STONE); };
    const rockSpire = (x, z, hgt, rad) => { const y0 = surf(x, z); for (let y = y0 - 2; y <= y0 + hgt; y++){ const t = (y - y0) / hgt, r = rad * (1 - t * .7) + (vn(y * .3, x) - .5) * .7; for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) if (Math.hypot(dx, dz) <= r) put(x + dx, y, z + dz, I.b === 1 ? (y % 4 === 0 ? B.REDBAND : B.REDROCK) : I.b === 4 ? B.BASALT : I.b === 2 ? (t > .8 ? B.SNOW : B.STONE) : (h3(x + dx, y, z + dz) < .25 ? B.MOSS : B.STONE)); } return y0 + hgt; };
    const standingStones = (x, z) => { const y = surf(x, z); for (let k = 0; k < 6; k++){ const a = k / 6 * 6.283, X = Math.round(x + Math.cos(a) * 4), Z = Math.round(z + Math.sin(a) * 4); if (!isIn(X, Z)) continue; const yy = surf(X, Z), hh = 2 + Math.floor(h2(X, Z) * 3); for (let i = 1; i <= hh; i++) put(X, yy + i, Z, h2(X, i) < .4 ? B.MOSS : B.COBBLE); } put(x, y + 1, z, B.JSTONE); };
    const ruinWall = (x, z, len, dir) => { const y = surf(x, z); for (let s = 0; s < len; s++){ const X = x + dir[0] * s, Z = z + dir[1] * s; if (!isIn(X, Z)) continue; const yy = surf(X, Z), hh = 1 + Math.floor(h2(X, Z) * 4 * (1 - Math.abs(s - len / 2) / len)); fillDown(X, yy, Z, B.RUIN); for (let i = 1; i <= hh; i++) put(X, yy + i, Z, h3(X, i, Z) < .45 ? B.RUINM : B.RUIN); if (h2(X, Z) < .3) put(X, yy + hh + 1, Z, B.HVINE); } };
    const column = (x, z, hh, cap) => { const y = surf(x, z); for (let i = 1; i <= hh; i++) put(x, y + i, z, i === hh && cap ? B.JSTONE : B.RUIN); };
    const campfire = (x, z) => { const y = surf(x, z); for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) put(x + dx, y + 1, z + dz, B.COBBLE); put(x, y, z, B.EMBER); for (const [dx, dz] of [[3, 0], [-3, 1], [0, -3]]) if (isIn(x + dx, z + dz)) put(x + dx, surf(x + dx, z + dz) + 1, z + dz, B.LOG); };
    const crate = (x, z) => { const y = surf(x, z); put(x, y + 1, z, B.PLANKS); if (h2(x, z) < .4) put(x, y + 2, z, B.PLANKS); };
    const naturalArch = (x, z, ang, span) => { // a rock arch over the turf
      const ux = Math.cos(ang), uz = Math.sin(ang), y0 = surf(x, z);
      for (let s = -span; s <= span; s++){ const t = s / span, yy = y0 + Math.round(Math.cos(t * Math.PI / 2) * span * .9), X = Math.round(x + ux * s), Z = Math.round(z + uz * s); if (!isIn(X, Z)) continue;
        for (let k = -1; k <= 1; k++) for (let dy = 0; dy <= 1; dy++) put(X + Math.round(-uz * k), yy + dy, Z + Math.round(ux * k), h3(X, yy, Z) < .3 ? B.MOSS : B.STONE);
        if (Math.abs(t) > .8) for (let y = surf(X, Z); y < yy; y++) for (let k = -1; k <= 1; k++) put(X + Math.round(-uz * k), y, Z + Math.round(ux * k), B.STONE); } return y0 + span; };
    // ---- the archetype's own set pieces (rock bridges, the arch over the hole, atoll lake, spire caps)
    const AD = archData(I);
    if (AD.bridges) for (let [A, Bq] of AD.bridges){ // a natural rock bridge between two lobes, sagging, two wide
      const ux0 = Bq.x - A.x, uz0 = Bq.z - A.z, L0 = Math.hypot(ux0, uz0) || 1; let ax = A.x, az = A.z, bx = Bq.x, bz = Bq.z;
      for (let t = 0; t < 80 && isIn(Math.round(ax + ux0 / L0), Math.round(az + uz0 / L0)); t++){ ax += ux0 / L0; az += uz0 / L0; }
      for (let t = 0; t < 80 && isIn(Math.round(bx - ux0 / L0), Math.round(bz - uz0 / L0)); t++){ bx -= ux0 / L0; bz -= uz0 / L0; }
      A = { x: ax, z: az }; Bq = { x: bx, z: bz };
      const n = Math.ceil(Math.hypot(Bq.x - A.x, Bq.z - A.z)); const ya = surf(Math.round(A.x), Math.round(A.z)), yb = surf(Math.round(Bq.x), Math.round(Bq.z)); if (ya < 0 || yb < 0 || n < 2) continue;
      for (let k = 0; k <= n; k++){ const t = k / n, x = A.x + (Bq.x - A.x) * t, z = A.z + (Bq.z - A.z) * t, y = Math.round(ya + (yb - ya) * t - Math.sin(Math.PI * t) * 2), ux = (Bq.z - A.z) / n, uz = -(Bq.x - A.x) / n;
        for (let s2 = -1; s2 <= 1; s2++){ const X = Math.round(x + ux * s2), Z = Math.round(z + uz * s2); if (!inb(X, Z)) continue; for (let dy = -2 - Math.round(Math.sin(Math.PI * t) * 2); dy <= 0; dy++) if (!get(X, y + dy, Z)) put(X, y + dy, Z, dy === 0 ? (I.b === 2 ? B.SNOW : T5 || I.b === 0 ? B.MOSS : I.b === 1 ? B.REDROCK : I.b === 3 ? B.MYCEL : B.ASH) : B.STONE); if (top[ci(X, Z)] < 0){ top[ci(X, Z)] = y; ee[ci(X, Z)] = .95; bot[ci(X, Z)] = y - 3; res[ci(X, Z)] = 1; } } } }
    if (AD.hole){ const hx = AD.hole.x, hz = AD.hole.z, hr = AD.hole.r; let y0 = -1; for (let a = 0; a < 6.283; a += .4){ const X = Math.round(hx + Math.cos(a) * (hr + 2)), Z = Math.round(hz + Math.sin(a) * (hr + 2)); if (isIn(X, Z)) y0 = Math.max(y0, top[ci(X, Z)]); }
      if (y0 > 0){ const ang = AD.hole.ang; for (let s = -hr - 2; s <= hr + 2; s++){ const X = Math.round(hx + Math.cos(ang) * s), Z = Math.round(hz + Math.sin(ang) * s), yy = y0 - 1 + Math.round(Math.cos(s / (hr + 2) * Math.PI / 2) * 2); for (let k = -1; k <= 1; k++) for (let dy = -2; dy <= 0; dy++){ const XX = X + Math.round(-Math.sin(ang) * k), ZZ = Z + Math.round(Math.cos(ang) * k); if (inb(XX, ZZ) && !get(XX, yy + dy, ZZ)) put(XX, yy + dy, ZZ, dy === 0 ? (T5 || I.b === 0 ? B.GRASS : B.STONE) : B.STONE); } }
        pois.push({ x: hx, y: y0, z: hz, kind: 'arch' }); } }
    // ---- structures (the Wilds only; sites well inside the island, flattened pads)
    const BS = [[0, 1], [2, 0], [3, 1], [1, 4], [2, 3]][I.b] || [];
    const sites = [];
    if (!safe){ const want = I.forceVault ? 1 : I.r > 18 ? 1 : 0;
      for (let t = 0; t < 120 && sites.length < want; t++){
        const a = rnd() * 6.283, rr = rnd() * I.r * .4, x = Math.round(I.x + Math.cos(a) * rr), z = Math.round(I.z + Math.sin(a) * rr);
        if (!isIn(x, z) || ee[ci(x, z)] > .55 || wat[ci(x, z)] >= 0 || res[ci(x, z)]) continue;
        if (sites.some(s => Math.hypot(s.x - x, s.z - z) < 15)) continue;
        const type = I.forceVault ? 3 : BS[sites.length % BS.length];
        sites.push({ x, z, type, rad: type === 2 ? 6 : type === 4 ? 6 : 5, grapple: I.forceVault ? 1 : 0 });
      } }
    for (const s of sites){
      let sum = 0, n = 0; for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++){ if (isIn(s.x + dx, s.z + dz)){ sum += top[ci(s.x + dx, s.z + dz)]; n++; } }
      s.y = Math.round(sum / Math.max(1, n));
      for (let z = s.z - s.rad - 3; z <= s.z + s.rad + 3; z++) for (let x = s.x - s.rad - 3; x <= s.x + s.rad + 3; x++){
        if (!isIn(x, z)) continue; const dd = Math.max(Math.abs(x - s.x), Math.abs(z - s.z)), wgt = 1 - sstep(s.rad, s.rad + 3, dd), c = ci(x, z), nt = Math.round(top[c] * (1 - wgt) + s.y * wgt);
        if (nt > top[c]) for (let y = top[c] + 1; y <= nt; y++) put(x, y, z, I.b === 4 ? B.ASH : I.b === 1 ? B.REDROCK : B.DIRT); else for (let y = nt + 1; y <= top[c] + 8; y++) if (get(x, y, z) !== B.WATER) put(x, y, z, 0);
        const sid = get(x, top[c], z); top[c] = nt; if (nt !== top[c] || true) put(x, nt, z, sid || get(x, nt, z) || B.DIRT); if (dd <= s.rad + 1) res[c] = 1;
      }
    }
    sites.forEach((s, si) => {
      const { x: cx, z: cz, y: Y } = s, T = s.type, tier = [1, 2, 1, 3, 2][T];
      structs.push({ type: T, x: cx, y: Y, z: cz, tier });
      const wall = I.b === 0 ? B.RUINM : I.b === 4 ? B.BASALT : B.RUIN;
      if (T === 0){ // ruined watchtower: 5x5 shell, spiral stair inside, a lookout floor with the chest
        const Ht = 9 + Math.floor(rnd() * 3), ring = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
        for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++){ fillDown(cx + dx, Y, cz + dz, wall); put(cx + dx, Y, cz + dz, B.RUIN); }
        for (let y = Y + 1; y <= Y + Ht; y++) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++){
          const shell = Math.abs(dx) === 2 || Math.abs(dz) === 2; if (!shell) continue;
          if (dz === 2 && dx === 0 && y <= Y + 2) continue; // door
          if (y > Y + Ht - Math.floor(h3(cx + dx, 7, cz + dz) * 2.99)) continue; // broken top: each column stops at its own height, so nothing is left hanging
          if ((dx === 0 || dz === 0) && y % 4 === 2 && y > Y + 3 && y < Y + Ht - 3) continue; // slit windows, never just under the broken top
          put(cx + dx, y, cz + dz, h3(cx + dx, y, cz + dz) < .3 ? B.RUINM : wall);
        }
        const steps = Ht - 2, fy = Y + steps; // one block per step around the newel; the lookout floor is level with the last step
        for (let y = Y + 1; y <= fy; y++) put(cx, y, cz, wall);
        const lastK = new Int16Array(8).fill(-1); for (let k = 0; k < steps; k++){ const j = (k + 2) % 8, r = ring[j]; put(cx + r[0], Y + 1 + k, cz + r[1], B.PLANKS); lastK[j] = k; }
        let cj = -1, cmin = 99; for (let j = 0; j < 8; j++){ if (lastK[j] <= steps - 6){ const r = ring[j]; put(cx + r[0], fy, cz + r[1], B.PLANKS); if (lastK[j] < cmin){ cmin = lastK[j]; cj = j; } } }
        if (cj >= 0) chest(cx + ring[cj][0], fy + 1, cz + ring[cj][1], tier, si);
        put(cx, fy + 1, cz, B.LANTERN);
        spawnNear(cx, cz, Y, 4, si, 4); spawnNear(cx, cz, Y, 1, si, 5);
      } else if (T === 1){ // sunken shrine: a pit with pillars, steps down, an altar and the chest
        const P = 3, F = Y - 3;
        for (let dz = -P - 1; dz <= P + 1; dz++) for (let dx = -P - 1; dx <= P + 1; dx++){
          const rim = Math.abs(dx) === P + 1 || Math.abs(dz) === P + 1;
          for (let y = F + 1; y <= Y + 3; y++) put(cx + dx, y, cz + dz, 0);
          put(cx + dx, F, cz + dz, rim ? wall : ((dx + dz) & 1 ? B.RUIN : B.STEP));
          if (rim) for (let y = F + 1; y <= Y; y++) put(cx + dx, y, cz + dz, wall);
          for (let y = F - 1; y > F - 3; y--) if (!get(cx + dx, y, cz + dz)) put(cx + dx, y, cz + dz, B.STONE);
        }
        for (let k = 0; k < 2; k++) for (let y = F + 1; y <= F + 2 - k; y++) put(cx, y, cz + P - k, B.RUIN); // two steps down from the rim
        for (let y = Y + 1; y <= Y + 3; y++) put(cx, y, cz + P + 1, 0);
        for (const p of [[-P, -P], [P, -P], [-P, P], [P, P]]){ const hgt = 3 + Math.floor(rnd() * 3); for (let y = F + 1; y <= F + hgt; y++) put(cx + p[0], y, cz + p[1], wall); put(cx + p[0], F + hgt + 1, cz + p[1], B.LANTERN); }
        put(cx - 1, F + 1, cz - 1, B.JSTONE); put(cx + 1, F + 1, cz - 1, B.JSTONE); put(cx, F + 1, cz - 2, B.JSTONE);
        chest(cx, F + 1, cz - 1, tier, si);
        spawnNear(cx, cz, Y, 0, si, 5); spawnNear(cx, cz, Y, 0, si, 6); spawnNear(cx, cz, Y, 3, si, 4);
      } else if (T === 2){ // goblin camp: tents, a fire pit, a ragged palisade, the chest by the big tent
        for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++){ if (Math.max(Math.abs(dx), Math.abs(dz)) === 6 && !(dz === 6 && Math.abs(dx) <= 1) && h3(cx + dx, 1, cz + dz) < .75 && (dx + dz) % 2 === 0 && isIn(cx + dx, cz + dz) && ee[ci(cx + dx, cz + dz)] < .9){ fillDown(cx + dx, Y, cz + dz, B.DIRT); put(cx + dx, Y + 1, cz + dz, B.LOG); put(cx + dx, Y + 2, cz + dz, B.LOG); } }
        const tent = (tx, tz, big) => { const L = big ? 2 : 1; for (let dz = -L; dz <= L; dz++){ for (const sgn of [-1, 1]){ put(tx + sgn * 2, Y + 1, tz + dz, B.TENT); put(tx + sgn * 2, Y + 2, tz + dz, B.TENT); } for (let dx = -2; dx <= 2; dx++) put(tx + dx, Y + 3, tz + dz, B.TENT); for (let dx = -1; dx <= 1; dx++) put(tx + dx, Y + 4, tz + dz, B.TENT); put(tx, Y + 5, tz + dz, B.TENT); } }; // stepped canvas roof: every piece touches the next
        tent(cx - 3, cz - 2, true); tent(cx + 3, cz - 1, false);
        for (const p of [[-1, 0], [1, 0], [0, -1], [0, 1]]) put(cx + p[0], Y + 1, cz + 2 + p[1], B.COBBLE); put(cx, Y, cz + 2, B.EMBER);
        chest(cx - 3, Y + 1, cz - 2, tier, si);
        spawnNear(cx, cz + 2, Y, 1, si, 2); spawnNear(cx, cz + 2, Y, 1, si, 3); spawnNear(cx, cz, Y, 4, si, 4);
      } else if (T === 3){ // crystal vault: a heavy building, crystal ribs, a pedestal chest, a sentinel at the door
        for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++){ fillDown(cx + dx, Y, cz + dz, B.BASALT); put(cx + dx, Y, cz + dz, B.RUIN);
          const shell = Math.abs(dx) === 3 || Math.abs(dz) === 3;
          for (let y = Y + 1; y <= Y + 5; y++){ if (!shell) { if (y === Y + 5) put(cx + dx, y, cz + dz, B.BASALT); continue; } if (dz === 3 && Math.abs(dx) <= 1 && y <= Y + 3) continue; put(cx + dx, y, cz + dz, (Math.abs(dx) === 3 && Math.abs(dz) === 3) || (dx === 0 && Math.abs(dz) === 3 && y === Y + 4) ? B.CRYSTAL : B.BASALT); }
        }
        put(cx, Y + 1, cz - 1, B.JSTONE); chest(cx, Y + 2, cz - 1, tier, si); put(cx - 2, Y + 4, cz - 2, B.LANTERN); put(cx + 2, Y + 4, cz - 2, B.LANTERN);
        spawnNear(cx, cz + 5, Y, 2, si, 1); spawnNear(cx, cz, Y, 3, si, 5);
      } else { // sky-wreck: a hull run aground, keel bedded into the turf, a snapped mast and torn sail
        const L = 5, hullY = Y;
        for (let dx = -L; dx <= L; dx++){ const half = dx === -L || dx === L ? 1 : 2;
          for (let dz = -half; dz <= half; dz++){ fillDown(cx + dx, hullY, cz + dz, B.DIRT); put(cx + dx, hullY, cz + dz, B.BRIDGE); if (Math.abs(dz) === half) { put(cx + dx, hullY + 1, cz + dz, B.PLANKS); if (h3(cx + dx, 3, cz + dz) > .35) put(cx + dx, hullY + 2, cz + dz, B.BRIDGE); } }
        }
        put(cx - L, hullY + 1, cz, B.PLANKS); put(cx - L, hullY + 2, cz, B.PLANKS); put(cx - L - 1, hullY + 2, cz, B.PLANKS);
        for (let y = hullY + 1; y <= hullY + 6; y++) put(cx - 1, y, cz, B.LOG); for (let dz = -2; dz <= 1; dz++) for (let y = hullY + 3; y <= hullY + 5; y++) if (h3(cx, y, cz + dz) > .25) put(cx - 1 + 1, y, cz + dz, B.TENT);
        for (let dx = 1; dx <= 2; dx++) for (let y = hullY + 1; y <= hullY + 2; y++) put(cx + dx, y, cz + 2, 0); // a breach in the hull to climb in
        chest(cx + 2, hullY + 1, cz, tier, si); put(cx + 4, hullY + 1, cz - 1, B.LANTERN);
        spawnNear(cx, cz, Y, 1, si, 5); spawnNear(cx, cz, Y, 4, si, 6); spawnNear(cx, cz, Y, 0, si, 6);
      }
      mark(cx, cz, s.rad + 1); if (s.grapple) structs[structs.length - 1].grapple = 1;
    });
    // the Sky Vault: its chest holds the grappling hook, and it is properly guarded
    if (I.forceVault && sites[0]){ chests.forEach(c => { if (c.s === 0) c.grapple = 1; }); const v = sites[0]; spawnNear(v.x, v.z + 7, v.y, 4, 0, 3); spawnNear(v.x, v.z - 7, v.y, 4, 0, 3); spawnNear(v.x + 7, v.z, v.y, 1, 0, 3); spawnNear(v.x - 7, v.z, v.y, 1, 0, 3); }
    // ---- vegetation and ground cover (per biome, varied by forest density and height)
    const cx0 = I.x, cz0 = I.z, s0 = I.k * 7.7;
    const zoneAt = (x, z) => { if (I.zones) for (const zn of I.zones) if (x >= zn[0] && x <= zn[2] && z >= zn[1] && z <= zn[3]) return zn[4]; return ''; };
    const waterNear = (x, z, r) => { for (let dz = -r; dz <= r; dz += 2) for (let dx = -r; dx <= r; dx += 2) if (isIn(x + dx, z + dz) && wat[ci(x + dx, z + dz)] >= 0) return true; return false; };
    // the landmark first, so it gets the best spot
    { let best = null, bs = -1e9; for (let t = 0; t < 70; t++){ const a = rnd() * 6.283, rr = (.2 + rnd() * .45) * I.r, x = Math.round(I.x + Math.cos(a) * rr), z = Math.round(I.z + Math.sin(a) * rr); if (!isIn(x, z) || !free(x, z, 3) || wat[ci(x, z)] >= 0) continue; const sc = top[ci(x, z)] + rnd() * 4; if (sc > bs){ bs = sc; best = [x, z]; } }
      if (best && I.r >= 9 && !I.noPoi){ const [x, z] = best, y = surf(x, z) + 1; let ty = y, kind = 'tree';
        if (T5){ if (I.poi === 'spire' || (I.poi !== 'tree' && h2(x, z) < .35)){ ty = rockSpire(x, z, 12 + Math.floor(rnd() * 8), 2.6); kind = 'spire'; put(x, ty + 1, z, B.LANTERN); nooks.push({ x, y: ty + 2, z, kind: 'vista' }); } else ty = plantTree('giant', x, y, z, zoneAt(x, z) === 'glow' ? B.ELEAF : zoneAt(x, z) === 'blossom' ? B.BLOSSOM : h2(z, x) < .3 ? B.AUTUMN : B.LEAVES, zoneAt(x, z) === 'glow' ? B.EBARK : B.LOG); }
        else if (I.b === 0) ty = plantTree('giant', x, y, z, B.LEAVES);
        else if (I.b === 1){ ty = rockSpire(x, z, 14 + Math.floor(rnd() * 8), 3.2); kind = 'hoodoo'; put(x, ty + 1, z, B.LANTERN); }
        else if (I.b === 2){ ty = rockSpire(x, z, 16 + Math.floor(rnd() * 8), 2.8); kind = 'icespire'; for (let k = 0; k < 4; k++) put(x, ty - k, z, B.ICE); put(x, ty + 1, z, B.LANTERN); }
        else if (I.b === 3){ const th = 12 + Math.floor(rnd() * 5); for (let i = 0; i < th; i++) for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) put(x + dx, y + i, z + dz, B.MSTEM); for (let dz = -6; dz <= 7; dz++) for (let dx = -6; dx <= 7; dx++){ const dd = Math.hypot(dx - .5, dz - .5); if (dd > 6.5) continue; put(x + dx, y + th, z + dz, B.MCAPB); if (dd < 5) put(x + dx, y + th + 1, z + dz, B.MCAPB); if (dd < 3) put(x + dx, y + th + 2, z + dz, B.MCAPB); if (dd > 5.6) put(x + dx, y + th - 1, z + dz, B.MCAPB); } ty = y + th + 2; kind = 'bigcap'; }
        else { ty = rockSpire(x, z, 14 + Math.floor(rnd() * 6), 3); kind = 'ashspire'; for (let k = 0; k < 3; k++) put(x, ty - k, z, B.EMBER); }
        mark(x, z, 4); pois.push({ x, y: ty, z, kind }); } }
    if (AD.spires) for (const sp of AD.spires){ const x = Math.round(sp.x), z = Math.round(sp.z); if (!isIn(x, z)) continue; const ty = surf(x, z); put(x, ty + 1, z, h2(x, z) < .5 ? B.LANTERN : B.TGRASS); }
    // set pieces scattered over the island: boulders, stones, arches, ruins, props
    const nSet = Math.round(I.r / 5) * (I.arch === 'ruins' ? 2 : 1);
    for (let k = 0; k < nSet; k++){ const a = rnd() * 6.283, rr = Math.sqrt(rnd()) * I.r * .75, x = Math.round(I.x + Math.cos(a) * rr), z = Math.round(I.z + Math.sin(a) * rr);
      if (!isIn(x, z) || !free(x, z, 2) || wat[ci(x, z)] >= 0) continue; const r = rnd();
      if (r < .3) boulder(x, z, 1.4 + rnd() * 1.4);
      else if (r < .42 && T5 && I.r > 12) standingStones(x, z);
      else if (r < .52 && ee[ci(x, z)] > .5) naturalArch(x, z, rnd() * 3.14, 3 + Math.floor(rnd() * 2));
      else if (r < .72 && (T5 || I.b === 0 || I.arch === 'ruins')){ ruinWall(x, z, 4 + Math.floor(rnd() * 5), [[1, 0], [0, 1]][k % 2]); if (rnd() < .6) column(x + 2, z + 2, 2 + Math.floor(rnd() * 3), rnd() < .5); }
      else if (r < .82) campfire(x, z);
      else crate(x, z);
      mark(x, z, 3); }
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++){
      const c = ci(x, z), h = top[c]; if (h < 0 || res[c] || ee[c] > .9 || get(x, h + 1, z)) continue;
      const g = get(x, h, z); if (!g || g === B.WATER || g === B.SAND && T5) continue;
      const r = h2(x * 7 + 3 + I.k, z * 11 + 5), f = h2(x * 3 + 1, z * 5 + 2 + I.k), forest = fbm(x * .04 + s0, z * .04 - s0), zn = zoneAt(x, z), high = h > I.top + 6;
      if (T5){
        const dens = zn ? .05 : forest > .56 ? .085 : forest > .46 ? .03 : .008;
        if (r < dens && free(x, z, 2) && g !== B.GRAVEL && g !== B.BRICK){ mark(x, z, 2);
          if (zn === 'glow') plantTree('oak', x, h + 1, z, B.ELEAF, B.EBARK);
          else if (zn === 'blossom') plantTree('oak', x, h + 1, z, B.BLOSSOM);
          else if (zn === 'pine' || high && h2(x, z) < .7) plantTree(h2(z, x) < .7 ? 'pine' : 'birch', x, h + 1, z);
          else if (waterNear(x, z, 4) && h2(x + 5, z) < .6) plantTree('willow', x, h + 1, z);
          else { const q = h2(x + 9, z + 3); if (q < .45) plantTree('oak', x, h + 1, z); else if (q < .7) plantTree('birch', x, h + 1, z); else if (q < .85) plantTree('oak', x, h + 1, z, B.AUTUMN); else plantTree('pine', x, h + 1, z); }
          continue; }
        if (r < dens + .02 && free(x, z, 1)){ const lf = zn === 'blossom' ? B.BLOSSOM : h2(x, z) < .25 ? B.AUTUMN : B.LEAVES; put(x, h + 1, z, lf); if (h2(z, x) < .5) put(x + 1, h + 1, z, lf); if (h2(x, z + 1) < .4) put(x, h + 2, z, lf); continue; } // bushes
        const meadow = fbm(x * .07 + 40 + s0, z * .07 + 40), drift = fbm(x * .11 - s0, z * .11 + 9);
        if (forest > .55 && f < .16) put(x, h + 1, z, f < .05 ? B.MUSHR : B.FERN);
        else if (f < (meadow > .55 ? .5 : .14)){ let id = B.TGRASS; if (f < .1 && drift > .58) id = drift > .66 ? B.ROSE : B.SUNF; else if (f < .06 && drift < .38) id = B.BELL; if (zn === 'blossom' && f < .12) id = B.ROSE; put(x, h + 1, z, id); if (id !== B.TGRASS && h2(x, z + 77) < .2) bf.push([x + .5, h + 1, z + .5]); if (h2(x + 9, z) < .03) ff.push([x + .5, h + 1.5, z + .5]); }
      } else if (I.b === 0){
        if (r < .045 * (forest > .5 ? 1.6 : .7) && free(x, z, 2)){ mark(x, z, 2); plantTree(h2(x, z) < .6 ? 'oak' : 'birch', x, h + 1, z); }
        else if (r < .06 && free(x, z, 1)){ const hh = 1 + Math.floor(h2(z, x) * 3); for (let i = 1; i <= hh; i++) put(x, h + i, z, h3(x, i, z) < .5 ? B.RUINM : B.RUIN); if (h2(x, z) < .5) put(x, h + hh + 1, z, B.HVINE); }
        else if (f < .22) put(x, h + 1, z, f < .03 ? B.ROSE : f < .07 ? B.FERN : B.TGRASS);
      } else if (I.b === 1){
        if (r < .025 && free(x, z, 1)){ const hh = 2 + Math.floor(h2(z, x) * 5); for (let i = 1; i <= hh; i++) put(x, h + i, z, i % 2 ? B.REDBAND : B.REDROCK); }
        else if (f < .08 && g !== B.SAND) put(x, h + 1, z, B.DEADB);
      } else if (I.b === 2){
        if (r < .04 && free(x, z, 2) && g === B.SNOW){ mark(x, z, 2); plantTree('pine', x, h + 1, z, B.FROSTLEAF); }
        else if (r < .06 && free(x, z, 1)){ const hh = 2 + Math.floor(h2(z, x) * 5); for (let i = 1; i <= hh; i++) put(x, h + i, z, B.ICE); }
      } else if (I.b === 3){
        if (r < .06 && free(x, z, 2)){ mark(x, z, 2); const th = 4 + Math.floor(h2(x, z) * 5), cap = h2(z, x) < .45 ? B.MCAPB : B.MCAPR, cr = 2 + (th > 6 ? 1 : 0);
          for (let i = 1; i <= th; i++) put(x, h + i, z, B.MSTEM);
          for (let dz = -cr; dz <= cr; dz++) for (let dx = -cr; dx <= cr; dx++){ const dd = Math.hypot(dx, dz); if (dd > cr + .4) continue; put(x + dx, h + th + 1, z + dz, cap); if (dd < cr - .6) put(x + dx, h + th + 2, z + dz, cap); if (Math.abs(dd - cr) < .7) put(x + dx, h + th, z + dz, cap); } }
        else if (f < .14) put(x, h + 1, z, f < .05 ? B.GSHROOM : f < .08 ? B.MUSHR : B.TGRASS);
      } else {
        if (r < .025 && free(x, z, 2)){ mark(x, z, 2); const th = 3 + Math.floor(h2(x, z) * 3); for (let i = 1; i <= th; i++) put(x, h + i, z, B.LOG); const q = [[1, 0], [0, 1], [-1, 0], [0, -1]][Math.floor(h2(z, x) * 4)]; put(x + q[0], h + th, z + q[1], B.LOG); put(x - q[0], h + th - 1, z - q[1], B.LOG); }
        else if (r < .045 && free(x, z, 1)){ const hh = 2 + Math.floor(h2(z, x) * 3); for (let i = 1; i <= hh; i++) put(x, h + i, z, B.BASALT); }
        else if (f < .05) put(x, h + 1, z, B.DEADB);
      }
    }
    // ---- vines down cliff faces, hanging roots under the rim, ivy on ruins
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++){
      const c = ci(x, z), h = top[c]; if (h < 0) continue;
      if (I.b !== 1 && I.b !== 4 && I.b !== 2) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]){ const X = x + dx, Z = z + dz; const nh = isIn(X, Z) ? top[ci(X, Z)] : -99; if (nh > h - 4) continue; if (h2(x * 5 + dx, z * 3 + dz) > .28) continue;
        const L = 2 + Math.floor(h2(z, x * 3) * (Math.min(9, h - nh - 1))); for (let k = 0; k < L; k++){ const y = h - k; if (get(X, y, Z)) break; put(X, y, Z, B.HVINE); } }
      // under the island: roots dangle from the keel near the rim
      const b = bot[c]; if (ee[c] > .5 && h2(x * 9, z * 7) < (I.b === 3 ? .22 : .16) && I.b !== 4 && I.b !== 1){ const L = 1 + Math.floor(h2(x, z * 9) * 5); for (let k = 1; k <= L; k++){ if (get(x, b - k, z)) break; put(x, b - k, z, I.b === 2 ? B.ICE : B.ROOTS); if (I.b === 2) break; } }
    }
    // ---- floating debris: a few small rocks drifting just off the rim (deliberate; tagged so bots don't flag them)
    const debris = [];
    for (let k = 0; k < Math.round(I.r / 6); k++){ const a = rnd() * 6.283, rr = I.r * (1.15 + rnd() * .35), x = Math.round(I.x + Math.cos(a) * rr), z = Math.round(I.z + Math.sin(a) * rr); if (!inb(x, z) || isIn(x, z)) continue;
      const y = I.top - 6 - Math.floor(rnd() * 14), r = .9 + rnd() * 1.1; blob(x, y, z, r, 1.4, I.b === 4 ? B.BASALT : I.b === 1 ? B.REDROCK : B.STONE, true); if (T5 || I.b === 0) put(x, y + Math.ceil(r), z, B.MOSS); debris.push([x, y, z, Math.ceil(r) + 1]); }
    // nooks in the Wilds hold chests (tier 2); on the safe islands they hold relics (placed by the main thread)
    if (!safe) nooks.forEach((n, i) => { if (n.kind === 'cave' && !get(n.x, n.y, n.z)){ chest(n.x, n.y, n.z, 2, -1); spawnNear(n.x, n.z, n.y, 0, -1, 3); } });
    // ---- wandering enemies away from the structures
    if (!safe){ const wild = [[0, 0, 1], [1, 4, 1], [3, 2, 0], [0, 0, 3], [3, 1, 2]][I.b], nw = 1 + Math.round(I.r / 9);
      for (let k = 0; k < nw; k++){ const a = rnd() * 6.283, rr = I.r * (.35 + rnd() * .3); spawnNear(Math.round(I.x + Math.cos(a) * rr), Math.round(I.z + Math.sin(a) * rr), 0, wild[k % wild.length], -1, 0); } }
    return { k: I.k, x0, z0, w, d, blk, top, bot, ee, wat, chests, spawns, structs, nooks, pois, falls, trees, ff, bf, debris, arch: I.arch };
  }
  self.api = { col, genIsland, archData, setSeed: s => { SEED = s | 0; }, mulberry };
  self.onmessage = e => {
    const m = e.data;
    if (m.type === 'init'){ B = m.B; WXg = m.WX; WZg = m.WZ; H = m.WY || 96; return; }
    if (m.type === 'gen'){ SEED = m.seed | 0; const r = genIsland(m.I); r.ver = m.ver; r.tag = m.tag; self.postMessage(r, [r.blk.buffer, r.top.buffer, r.bot.buffer, r.ee.buffer, r.wat.buffer]); }
  };
}

/* ---- seeded layout of the crescent: island specs, links, updrafts (main thread, cheap) ---- */
const OUT = [], WILD_UD = [], WILD_LINKS = [], WILD_BRIDGES = [];
let OUT_SEED = 0, outVer = 0, wgen = null, wgenInline = null, wgenBusy = false;
const OUT_ISL0 = 20; // isl[] values for outer islands start here
const ARCH_BY_BIOME = [['ruins', 'terrace', 'bridged', 'atoll', 'plain'], ['mesa', 'spires', 'arch', 'archipelago', 'mesa'], ['spires', 'terrace', 'arch', 'plain', 'spires'], ['atoll', 'bridged', 'plain', 'archipelago', 'ruins'], ['mesa', 'spires', 'archipelago', 'arch', 'terrace']];
const SIZE_PLAN = [28, 24, 19, 18, 16, 16, 14, 14, 12, 11, 10, 10, 9, 8, 6, 6, 5, 5];
function wildNamer(rand, b){ const B = BIOMES[b]; return B.syl[Math.floor(rand() * B.syl.length)] + B.suf[Math.floor(rand() * B.suf.length)]; }
// the land's edge of an island spec, walking out from its centre toward (tx, tz) through the shared column shape
function specRim(I, tx, tz, out){ const o = {}; let dx = tx - I.x, dz = tz - I.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L; let lx = I.x, lz = I.z, top = I.top;
  for (let s = 0; s < I.r * 2.2; s++){ const x = Math.round(I.x + dx * s), z = Math.round(I.z + dz * s); wgenInline.api.col(I, x, z, o); if (o.in){ lx = x; lz = z; top = o.top; } }
  return { x: lx + dx * (out || 0), z: lz + dz * (out || 0), top }; }
function layoutWilds(seed){
  OUT_SEED = seed >>> 0; OUT.length = 0; WILD_UD.length = 0; STONED.clear(); MODRT.length = 0; BUILDQ.length = 0; buildCur = null; WILD_LINKS.length = 0; WILD_BRIDGES.length = 0;
  wgenInline.api.setSeed(OUT_SEED);
  const rand = wgenInline.api.mulberry(OUT_SEED ^ 0x9e3779b9), names = new Set();
  for (const r0 of SIZE_PLAN){
    for (let t = 0; t < 400; t++){
      const r = r0 * (.9 + rand() * .2), side = rand(), m = r * 1.45 + 8;
      let x, z; if (side < .55){ x = SAFE + m + rand() * (WX - SAFE - 2 * m); z = m + rand() * (WZ - 2 * m); } else { x = m + rand() * (SAFE - m); z = SAFE + m + rand() * (WZ - SAFE - 2 * m); }
      x = Math.round(x); z = Math.round(z);
      if (x - m < 4 || z - m < 4 || x + m > WX - 4 || z + m > WZ - 4) continue;
      if (x - m < SAFE && z - m < SAFE) continue; // never overlaps the safe square
      if (OUT.some(o => Math.hypot(o.x - x, o.z - z) < (o.r + r) * 1.35 + 12)) continue;
      const b = Math.floor(rand() * 5); let nm = wildNamer(rand, b), g = 0; while (names.has(nm) && g++ < 8) nm = wildNamer(rand, b); names.add(nm);
      const arch = r <= 7 ? (rand() < .5 ? 'plain' : 'spires') : ARCH_BY_BIOME[b][Math.floor(rand() * 5)];
      OUT.push({ k: OUT.length, x, z, r: Math.round(r * 10) / 10, top: Math.round(40 + rand() * 24), depth: Math.round(14 + r * .9), b, arch, name: nm, gen: 0, data: null, seen: false, meshed: false });
      break;
    }
  }
  // links: a tree grown outward from the rim gates, nearest-first (Prim), so every island is reachable
  const inTree = new Uint8Array(OUT.length), nodes = GATES.map(g => ({ x: g.x, z: g.z, top: g.top, r: 2, gate: true, depth: 0 }));
  for (let n = 0; n < OUT.length; n++){
    let best = null, bd = 1e9;
    for (let i = 0; i < OUT.length; i++){ if (inTree[i]) continue; const I = OUT[i]; for (const a of nodes){ const d = Math.hypot(a.x - I.x, a.z - I.z) - (a.r + I.r); if (d < bd){ bd = d; best = [a, I]; } } }
    if (!best) break; const [a, I] = best; inTree[I.k] = 1; I.depthL = (a.depthL || 0) + 1; nodes.push(I); WILD_LINKS.push([a, I, bd]);
  }
  // the Sky Vault (holds the grappling hook): the deepest well-sized island in the tree, so it is a real expedition
  { let best = null; for (const I of OUT) if (I.r >= 12 && I.arch !== 'archipelago' && (!best || I.depthL > best.depthL || (I.depthL === best.depthL && I.r > best.r))) best = I; if (best){ best.forceVault = true; best.arch = best.arch === 'spires' || best.arch === 'atoll' ? 'plain' : best.arch; } }
  // an updraft off the launch edge of each link, both ways, high enough to clear the gap with a plain sail
  const draft = (from, to) => {
    const rim = from.gate ? { x: from.x, z: from.z, top: from.top } : specRim(from, to.x, to.z, 0), dx = to.x - rim.x, dz = to.z - rim.z, L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
    const x = Math.round(rim.x + ux * (from.gate ? 0 : 3.5)), z = Math.round(rim.z + uz * (from.gate ? 0 : 3.5)), toRim = specRim(to, rim.x, rim.z, 0), gap = Math.max(0, Math.hypot(toRim.x - x, toRim.z - z));
    WILD_UD.push({ x: x + .5, z: z + .5, r: 4.5, top: Math.round(clamp(Math.max(toRim.top + gap / 4.5 + 9, rim.top + 9), 36, WY - 6)), to: to.gate ? -1 : to.k, from: from.gate ? -1 : from.k, ux, uz, gap, rx: toRim.x, rz: toRim.z, base: rim.top });
  };
  assignContent();
  for (const [a, I, d] of WILD_LINKS){ draft(a, I); if (!a.gate) draft(I, a); if (!a.gate && d < 15 && Math.abs(a.top - I.top) <= 5) WILD_BRIDGES.push({ a: a.k, b: I.k, built: false }); }
  outVer++;
}
function islandSpecAt(x, z){ for (const I of OUT) if (Math.hypot(x - I.x, z - I.z) < I.r * 1.7) return I; return null; }
function outerIsle(x, z){ const fx = Math.floor(x), fz = Math.floor(z); if (fx < 0 || fz < 0 || fx >= WX || fz >= WZ) return null; const v = isl[fx + fz * WX]; return v >= OUT_ISL0 ? OUT[v - OUT_ISL0] || null : null; }

/* ---- streaming: voxelise islands as the player approaches; one job in flight ---- */
const wgenQueue = [];
function startWildGen(){
  const init = { type: 'init', B: WGEN_B(), WX, WZ, WY };
  const fake = { postMessage(m){ fake.last = m; } }; WGEN(fake); fake.onmessage({ data: init }); wgenInline = fake;
  try {
    const url = URL.createObjectURL(new Blob(['(' + WGEN.toString() + ')(self);'], { type: 'text/javascript' }));
    wgen = new Worker(url); wgen.onmessage = e => { wgenBusy = false; applyIsland(e.data); }; wgen.onerror = () => { wgen = null; wgenBusy = false; }; wgen.postMessage(init);
  } catch (e){ wgen = null; }
}
function requestIsland(I){
  if (I.gen) return; I.gen = 1;
  const msg = { type: 'gen', seed: OUT_SEED, ver: outVer, I: { k: I.k, x: I.x, z: I.z, r: I.r, top: I.top, depth: I.depth, b: I.b, arch: I.arch, forceVault: !!I.forceVault } };
  if (wgen){ wgenBusy = true; wgen.postMessage(msg); }
  else { wgenInline.api.setSeed(OUT_SEED); const r = wgenInline.api.genIsland(msg.I); r.ver = outVer; applyIsland(r); }
}
function pumpWildGen(){
  if (wgenBusy || !OUT.length) return;
  let best = null, bd = 1e9; const px = PL.x, pz = PL.z, R = renderDist + 120; // wide, so the budgeted build finishes before arrival
  for (const I of OUT){ if (I.gen) continue; const d = Math.hypot(I.x - px, I.z - pz) - I.r; if (d < R && d < bd){ bd = d; best = I; } }
  if (best) requestIsland(best);
}
let wildDirtyMap = false;
/* Island assembly is spread across frames: a generator per island, pumped with a ~4 ms budget.
   Stages: terrain blocks, content blocks and props, light, chunk counts, entities, logic. The island stays
   dormant (unmeshed, no entities, gen 1) until the last stage, so nothing half-built is ever seen. */
const BUILDQ = []; let buildCur = null;
function applyIsland(r){
  if (r.ver !== outVer) return; // a stale job from before a reseed
  const I = OUT[r.k]; if (!I) return; BUILDQ.push({ I, r, g: islandBuild(I, r) });
}
function pumpBuilds(budget){
  const t0 = performance.now();
  // the player is standing where a pending island goes (a save loaded out here): finish that one now, no budget
  const under = j => PL.x >= j.r.x0 - 2 && PL.z >= j.r.z0 - 2 && PL.x < j.r.x0 + j.r.w + 2 && PL.z < j.r.z0 + j.r.d + 2;
  if (state === 'play' && ((buildCur && under(buildCur)) || BUILDQ.some(under))) budget = 1e9;
  for (;;){ if (!buildCur){ if (!BUILDQ.length) return false; buildCur = BUILDQ.shift(); }
    if (buildCur.g.next().done) buildCur = null; if (performance.now() - t0 >= budget) return !!(buildCur || BUILDQ.length); }
}
function* islandBuild(I, r){
  const stale = () => r.ver !== outVer || OUT[r.k] !== I;
  const { x0, z0, w, d, blk, top } = r, H = WY;
  for (let y = 0; y < H; y++){ for (let z = 0; z < d; z++){ const row = w * (z + d * y), wrow = x0 + WX * ((z + z0) + WZ * y);
    for (let x = 0; x < w; x++){ const id = blk[row + x]; if (id) world[wrow + x] = id; } }
    if ((y & 3) === 3){ yield; if (stale()) return; } }
  for (let z = 0; z < d; z++) for (let x = 0; x < w; x++){ const k = x + z * w, t = top[k]; if (t < 0) continue; const c = (x + x0) + (z + z0) * WX; isl[c] = OUT_ISL0 + I.k; hTop[c] = t; hBot[c] = r.bot[k]; eArr[c] = r.ee[k]; wTop[c] = r.wat[k]; }
  I.bbox = [x0, z0, x0 + w - 1, z0 + d - 1]; yield; if (stale()) return;
  // content modules, pads and trails write straight into the world here, before lighting and meshing
  const MX = yield* buildIslandContentG(I, r); if (stale()) return;
  let fx0 = x0, fz0 = z0, fx1 = x0 + w - 1, fz1 = z0 + d - 1; if (MX && MX.x1 >= MX.x0){ fx0 = Math.max(0, Math.min(fx0, MX.x0)); fz0 = Math.max(0, Math.min(fz0, MX.z0)); fx1 = Math.min(WX - 1, Math.max(fx1, MX.x1)); fz1 = Math.min(WZ - 1, Math.max(fz1, MX.z1)); }
  // edits the player made out here earlier, loaded with the save
  edits.forEach((v, k) => { const x = k % WX, zz = (k / WX) | 0, z = zz % WZ; if (x >= x0 && x < x0 + w && z >= z0 && z < z0 + d){ if (!orig.has(k)) orig.set(k, world[k]); world[k] = v; } });
  yield; if (stale()) return;
  yield* floodBoxG(fx0 - 2, 0, fz0 - 2, fx1 + 2, WY - 1, fz1 + 2); if (stale()) return;
  const keys = [];
  for (let cz = fz0 >> 4; cz <= (fz1 + 1) >> 4; cz++) for (let cx = fx0 >> 4; cx <= (fx1 + 1) >> 4; cx++){ if (cx >= NCX || cz >= NCZ) continue; const ch = chunks[ckey(cx, 0, cz)]; let n = 0; for (let y = 0; y < WY; y++) for (let z = cz * 16; z < cz * 16 + 16; z++){ let i = cx * 16 + WX * (z + WZ * y); for (let x = 0; x < 16; x++, i++) if (world[i]) n++; } ch.count = n; keys.push(ckey(cx, 0, cz)); yield; if (stale()) return; }
  for (const k of keys) markDirty(k);
  // entities, then logic; only now does the island wake up
  I.data = r; registerChests(I, r); yield; if (stale()) return;
  spawnEnemiesFor(I, r); yield; if (stale()) return;
  I.gen = 2; afterIslandContent(I); fixDrafts(I);
  for (const br of WILD_BRIDGES) if (!br.built && OUT[br.a].gen === 2 && OUT[br.b].gen === 2){ yield; buildBridge(br); }
  if (mapStatic) for (let z = z0; z < z0 + d; z++){ for (let x = x0; x < x0 + w; x++) mapColumn(x, z); if ((z & 7) === 7) yield; }
}
/* a light flood restricted to a box (its edge is dark sky out here), resumable: its own queue, so relights between frames cannot disturb it */
let fbq = null; const FBQM = (1 << 20) - 1;
function* floodBoxG(x0, y0, z0, x1, y1, z1){
  x0 = Math.max(0, x0); z0 = Math.max(0, z0); x1 = Math.min(WX - 1, x1); z1 = Math.min(WZ - 1, z1); y0 = Math.max(0, y0); y1 = Math.min(WY - 1, y1);
  const q = fbq || (fbq = new Int32Array(FBQM + 1)); let qh = 0, qt = 0;
  for (let y = y0; y <= y1; y++){ for (let z = z0; z <= z1; z++){ let i = x0 + WX * (z + WZ * y); for (let x = x0; x <= x1; x++, i++){ const e = B_EMIT[world[i]]; light[i] = e; if (e) q[(qt++) & FBQM] = i; } } if ((y & 3) === 3) yield; }
  let n = 0;
  while (qh !== qt){
    const i = q[qh & FBQM]; qh++; if (++n === 8000){ n = 0; yield; }
    const l = light[i]; if (l <= 1) continue;
    const x = i % WX, zz = (i / WX) | 0, z = zz % WZ, y = (zz / WZ) | 0, nl = l - 1;
    if (x > x0){ const j = i - 1; if (!B_OPQ[world[j]] && light[j] < nl){ light[j] = nl; q[(qt++) & FBQM] = j; } }
    if (x < x1){ const j = i + 1; if (!B_OPQ[world[j]] && light[j] < nl){ light[j] = nl; q[(qt++) & FBQM] = j; } }
    if (z > z0){ const j = i - WX; if (!B_OPQ[world[j]] && light[j] < nl){ light[j] = nl; q[(qt++) & FBQM] = j; } }
    if (z < z1){ const j = i + WX; if (!B_OPQ[world[j]] && light[j] < nl){ light[j] = nl; q[(qt++) & FBQM] = j; } }
    if (y > y0){ const j = i - LAYER; if (!B_OPQ[world[j]] && light[j] < nl){ light[j] = nl; q[(qt++) & FBQM] = j; } }
    if (y < y1){ const j = i + LAYER; if (!B_OPQ[world[j]] && light[j] < nl){ light[j] = nl; q[(qt++) & FBQM] = j; } }
  }
}
/* procedural rope bridges between close islands of similar height */
function buildBridge(br){
  br.built = true; const A = OUT[br.a], Bi = OUT[br.b];
  const dx = Bi.x - A.x, dz = Bi.z - A.z, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
  const edgeOf = (I, sx, sz, ex, ez) => { let x = sx, z = sz; for (let k = 0; k < 40; k++){ const nx = x + ex, nz = z + ez; if (isl[Math.floor(nx) + Math.floor(nz) * WX] !== OUT_ISL0 + I.k) break; x = nx; z = nz; } return [x, z]; };
  const [ax, az] = edgeOf(A, A.x + .5, A.z + .5, ux, uz), [bx, bz] = edgeOf(Bi, Bi.x + .5, Bi.z + .5, -ux, -uz);
  const ya = hTop[Math.floor(ax) + Math.floor(az) * WX], yb = hTop[Math.floor(bx) + Math.floor(bz) * WX]; if (ya < 0 || yb < 0) return;
  const n = Math.ceil(Math.hypot(bx - ax, bz - az)) + 2; let lo = 1e9, hi = -1, lx = 1e9, hx = -1, lz = 1e9, hz = -1;
  for (let k = -1; k <= n; k++){
    const t = clamp(k / n, 0, 1), x = ax + (bx - ax) * t, z = az + (bz - az) * t, y = Math.round(ya + (yb - ya) * t - 1.4 * Math.sin(Math.PI * t));
    for (let s = -1; s <= 1; s++){ const X = Math.floor(x - uz * s), Z = Math.floor(z + ux * s); const i = wi(X, y, Z); if (!world[i] || world[i] === TGRASS){ world[i] = BRIDGE; } for (let yy = y + 1; yy <= y + 3; yy++){ const j = wi(X, yy, Z); if (B_SOLID[world[j]] && isl[X + Z * WX] < 0){ world[j] = 0; } }
      lo = Math.min(lo, y); hi = Math.max(hi, y + 3); lx = Math.min(lx, X); hx = Math.max(hx, X); lz = Math.min(lz, Z); hz = Math.max(hz, Z); }
    if (k % 4 === 0) for (const s of [-2, 2]){ const X = Math.floor(x - uz * s), Z = Math.floor(z + ux * s); if (!world[wi(X, y, Z)]){ world[wi(X, y, Z)] = BRIDGE; world[wi(X, y + 1, Z)] = LOG; } }
  }
  for (let cz = lz >> 4; cz <= hz >> 4; cz++) for (let cx = lx >> 4; cx <= hx >> 4; cx++){ const ch = chunks[ckey(cx, 0, cz)]; let c = 0; for (let y = 0; y < WY; y++) for (let z = cz * 16; z < cz * 16 + 16; z++) for (let x = cx * 16; x < cx * 16 + 16; x++) if (world[x + WX * (z + WZ * y)]) c++; ch.count = c; markDirty(ckey(cx, 0, cz)); }
}

/* ---- far silhouettes: one merged mesh, faded per island by a uniform array ---- */
let silMesh = null; const silVis = new Float32Array(32); // 0..19 the Wilds, 20..30 the safe islands
function buildSilhouettes(){
  if (silMesh){ scene.remove(silMesh); silMesh.geometry.dispose(); silMesh = null; }
  const pos = [], col = [], idx = [], isw = [], o = {}, S = 3;
  const box = (x0, y0, z0, x1, y1, z1, ct, cs, k) => { const b = pos.length / 3; const P = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
    for (const p of P){ pos.push(p[0], p[1], p[2]); const c = p[1] === y1 ? ct : cs; col.push(c[0], c[1], c[2]); isw.push(k); }
    idx.push(b + 4, b + 6, b + 5, b + 4, b + 7, b + 6, b, b + 1, b + 5, b, b + 5, b + 4, b + 1, b + 2, b + 6, b + 1, b + 6, b + 5, b + 2, b + 3, b + 7, b + 2, b + 7, b + 6, b + 3, b, b + 4, b + 3, b + 4, b + 7); };
  wgenInline.api.setSeed(OUT_SEED);
  for (const I of OUT){ const Bm = BIOMES[I.b], R = Math.ceil(I.r * 1.9);
    for (let z = I.z - R; z <= I.z + R; z += S) for (let x = I.x - R; x <= I.x + R; x += S){ wgenInline.api.col(I, x + 1, z + 1, o); if (!o.in) continue; const sh = .85 + h2(x, z) * .3;
      box(x, o.bot, z, x + S, o.top + 1, z + S, [Bm.top[0] * sh, Bm.top[1] * sh, Bm.top[2] * sh], [Bm.rock[0] * sh, Bm.rock[1] * sh, Bm.rock[2] * sh], I.k); } }
  // the safe islands too (from the real column data), so the far horizon is never empty
  ISL.forEach((I, i) => { const R = Math.ceil(I.r * 1.9 * (I.ax || 1));
    for (let z = I.z - R; z <= I.z + R; z += S) for (let x = I.x - R; x <= I.x + R; x += S){ const c = (x + 1) + (z + 1) * WX; if (x < 0 || z < 0 || x >= WX - 2 || z >= WZ - 2 || isl[c] !== i) continue; const sh = .85 + h2(x, z) * .3;
      box(x, hBot[c], z, x + S, hTop[c] + 1, z + S, [.42 * sh, .56 * sh, .34 * sh], [.5 * sh, .48 * sh, .46 * sh], 20 + i); } });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aK', new THREE.Float32BufferAttribute(isw, 1)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.ShaderMaterial({ uniforms: Object.assign({ uVis: { value: silVis } }, U),
    vertexShader: `attribute vec3 aCol; attribute float aK; uniform float uVis[32]; varying vec3 vC; varying vec3 vW; varying float vV;
      void main(){ float v = 0.0; for (int i = 0; i < 32; i++){ if (abs(float(i) - aK) < 0.5) v = uVis[i]; } vV = v; vC = aCol; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = v < 0.01 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `${GL_COMMON} varying vec3 vC; varying vec3 vW; varying float vV;
      void main(){ vec3 n = normalize(cross(dFdx(vW), dFdy(vW))); vec3 c = litCol(vC, n, 0.9, 0.0); float d = length(vW - cameraPosition); float f = smoothstep(60.0, 520.0, d) * 0.85; vec3 hz = skyCol(normalize(vW - cameraPosition)); c = mix(c, hz, f); c = mix(hz, c, vV); gl_FragColor = vec4(grade(c), 1.0); }`,
    extensions: { derivatives: true } });
  silMesh = new THREE.Mesh(g, m); silMesh.frustumCulled = false; scene.add(silMesh);
}
function updateSilhouettes(dt){
  if (!silMesh) return;
  const px = camera.position.x, pz = camera.position.z, near = renderDist * .95, far = renderDist * 1.25;
  for (const I of OUT){ if (I.gen === 2 && !I.meshed){ const b = I.bbox; let ok = true; for (let cz = b[1] >> 4; cz <= b[3] >> 4 && ok; cz++) for (let cx = b[0] >> 4; cx <= b[2] >> 4; cx++){ const c = chunks[ckey(cx, 0, cz)]; if (c.dirty || (c.count && c.sent !== c.ver)){ ok = false; break; } } I.meshed = ok; }
    const d = Math.hypot(I.x - px, I.z - pz) - I.r; const real = I.gen === 2 && I.meshed; const want = real ? sstep(near, far, d) : 1; silVis[I.k] += (want - silVis[I.k]) * Math.min(1, dt * 3); }
  ISL.forEach((I, i) => { const d = Math.hypot(I.x - px, I.z - pz) - I.r * 1.2, want = sstep(near, far, d); silVis[20 + i] += (want - silVis[20 + i]) * Math.min(1, dt * 3); });
}

/* ---- the threshold: wind banners on floating buoys, a colour shift, a "Wilds" label ---- */
let wildBlend = 0, inWilds = false, wildToastT = 0;
function updateWildsAmbience(dt){
  const x = PL.x, z = PL.z, dEdge = Math.min(x < SAFE ? SAFE - x : 0, z < SAFE ? SAFE - z : 0), out = !inSafe(x, z);
  const target = out ? 1 : clamp(1 - dEdge / 18, 0, 1) * .35;
  wildBlend += (target - wildBlend) * Math.min(1, dt * 1.5);
  U.uWild.value = wildBlend;
  if (out !== inWilds){ inWilds = out; if (state === 'play' && performance.now() > wildToastT){ wildToastT = performance.now() + 8000; if (out) toastCard('The Wilds', 'Outer islands: monsters, ruins and loot. Fall in battle and you wake on Home Isle.', 6000); else toast('Back in the safe skies'); } updateHeartsVis(); }
}
