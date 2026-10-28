
/* =====================================================================
   ITEM ART: every item is authored as a 16 x 16 material map and SHADED BY RULE, so all icons, drops and
   held models share one lighting model (see the style guide in p2.js):
     - a 5-step ramp per material (shadow, mid, base, light, highlight), hue-shifted
     - light from the top-left: pixels whose top/left neighbour is outside the material are lit, whose
       bottom/right neighbour is outside are shaded; a soft diagonal gradient across each form
     - a 1 px ink outline around the silhouette (icons only; the 3D extrusion gets a rim light instead)
     - per-material thickness (blades thin, hafts and gems thicker) and an emissive flag (gems, glow trims)
   ===================================================================== */
const MAT = {
  wood: { r: ['#4a3020', '#5e3d27', '#7a5235', '#946a46', '#b08458'], d: 1.6 },
  dark: { r: ['#2e2120', '#3b2a2a', '#4f3534', '#68443f', '#80574e'], d: 1.7 },
  brass: { r: ['#6b4a1c', '#8f6626', '#b98a34', '#d8a640', '#f3d27a'], d: 1.8 },
  steel: { r: ['#4e535c', '#6b717c', '#8f949d', '#b9bec7', '#e8eaee'], d: 1 },
  stone: { r: ['#4f4a49', '#6b6562', '#8a8380', '#a8a19a', '#c9c2b8'], d: 1.4 },
  canvas: { r: ['#7a6a4c', '#a8956c', '#cdb98c', '#e2d3ae', '#f5ecd4'], d: 1.6 },
  sailred: { r: ['#6e2f26', '#8f3e31', '#b3513f', '#c96f4a', '#e09a72'], d: 1.6 },
  rope: { r: ['#5c4a33', '#7a6446', '#9c825c', '#bba077', '#d8c09a'], d: 1.4 },
  dough: { r: ['#7a4a22', '#a8703c', '#cf9a5a', '#e7c48a', '#f7e4bd'], d: 2 },
  petal: { r: ['#8d4b48', '#a85f5b', '#c97b78', '#e0a19b', '#f4cdc6'], d: 2 },
  biscuit: { r: ['#6a4022', '#8a5a30', '#b07a44', '#c8955a', '#e2b880'], d: 1.8 },
  leaf: { r: ['#3a5230', '#4f6943', '#688453', '#86a066', '#a8c07c'], d: 1.2 },
  pod: { r: ['#5a4224', '#7a5a30', '#9a7444', '#c49a5a', '#e0bf86'], d: 1.8 },
  relic: { r: ['#3b5a99', '#5f86d6', '#8fb4f0', '#c3dafc', '#f2f8ff'], d: 2, em: 1 },
  ink: { r: ['#0e0d11', '#0e0d11', '#0e0d11', '#0e0d11', '#0e0d11'], d: 1, flat: 1 }
};
const BLADE = [ // per rarity
  ['#4e535c', '#6b717c', '#9aa0aa', '#c4c9d2', '#eef0f4'], ['#3f5e3a', '#5f8a50', '#86b071', '#b2d6a0', '#e2f4d6'], ['#2f5a99', '#4f86d6', '#7aaaf0', '#a9cbff', '#e2efff'],
  ['#53358a', '#7d55c0', '#a77fe6', '#cdb0ff', '#f0e3ff'], ['#8a5a14', '#c08424', '#e8a83a', '#ffd88a', '#fff3cf']];
const GEM = [['#6b6458', '#8a8273', '#aaa192', '#cbc3b4', '#ece6da'], ['#2e6b2a', '#3f9a3a', '#5fc252', '#86d46f', '#c8f0b8'], ['#1d4f99', '#2f72cc', '#4f95f0', '#6db3ff', '#c4e0ff'], ['#5a2a99', '#7e45cc', '#a66af0', '#c98cff', '#ecd6ff'], ['#99540f', '#cc7a1a', '#f09a2a', '#ffb84d', '#ffe6b0']];
// ---- a tiny drawing language over a 16 x 16 grid of material keys
function artGrid(){ const g = new Array(256).fill(null); g.set = (x, y, m) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < 16 && y < 16) g[y * 16 + x] = m; };
  g.line = (x0, y0, x1, y1, m, w) => { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 || 1; for (let i = 0; i <= n; i++){ const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t; g.set(x, y, m); if (w > 1){ g.set(x + 1, y, m); } if (w > 2) g.set(x, y + 1, m); } };
  g.rows = (rows, map) => rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (map[r[x]]) g.set(x, y, map[r[x]]); });
  g.disc = (cx, cy, r, m) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (Math.hypot(x - cx, y - cy) <= r) g.set(x, y, m); };
  return g; }
// shade a material grid into pixels (rgba), emissive mask and depth; ramps can be passed inline as arrays
function shadeArt(g, ramps){
  const px = new Uint8ClampedArray(1024), em = new Uint8Array(256), dep = new Float32Array(256), hx = s => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
  const mat = k => (ramps && ramps[k]) || MAT[k];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++){
    const k = g[y * 16 + x]; if (!k) continue; const M = mat(k); const same = (X, Y) => X >= 0 && Y >= 0 && X < 16 && Y < 16 && g[Y * 16 + X] === k;
    let t = 2;
    if (!M.flat){ if (!same(x, y - 1)) t += 1; if (!same(x - 1, y)) t += .6; if (!same(x, y + 1)) t -= 1; if (!same(x + 1, y)) t -= .6; t += ((15 - y) + (15 - x)) / 30 * .8 - .4; if (!same(x, y - 1) && !same(x - 1, y)) t += .4; }
    if ((M.dither && (x + y) & 1)) t -= .5;
    const c = hx(M.r[clamp(Math.round(t), 0, 4)]), o = (y * 16 + x) * 4; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255; em[y * 16 + x] = M.em ? 1 : 0; dep[y * 16 + x] = M.d || 1;
  }
  return { px, em, dep };
}
function outlined(px){ const o = new Uint8ClampedArray(px); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++){ const i = y * 16 + x; if (px[i * 4 + 3]) continue; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]){ const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < 16 && Y < 16 && px[(Y * 16 + X) * 4 + 3]){ o[i * 4] = 14; o[i * 4 + 1] = 13; o[i * 4 + 2] = 17; o[i * 4 + 3] = 255; break; } } } return o; }
// ---- the item catalogue
const ART_CACHE = {};
function itemArt(id, w){
  const key = w ? 'w' + w.f + '_' + w.r : 'i' + id; if (ART_CACHE[key]) return ART_CACHE[key];
  const g = artGrid(); let ramps = null;
  if (w){ const r = w.r; ramps = { blade: { r: BLADE[r], d: 1, em: r === 4 ? 0 : 0 }, edge: { r: BLADE[r], d: .9, em: r >= 3 ? 1 : 0 }, gem: { r: GEM[r], d: 2.2, em: r >= 2 ? 1 : 0, flat: 0 }, wrap: { r: r === 0 ? MAT.dark.r : GEM[r].map((c, i) => i < 2 ? MAT.dark.r[i + 1] : c), d: 1.8 } };
    if (w.f === 0){ // sword: a fullered blade, a brass guard with a gem, a wrapped grip and pommel
      g.line(5, 10, 14, 1, 'blade', 2); g.line(6, 10, 14, 2, 'blade'); g.line(5, 9, 13, 1, 'edge'); g.set(14, 1, 'edge'); g.line(7, 8, 12, 3, 'dark');
      g.line(3, 9, 8, 14, 'brass', 2); if (r >= 3){ g.set(2, 8, 'brass'); g.set(9, 15, 'brass'); } g.line(1, 14, 4, 11, 'wrap', 2); g.set(0, 15, 'brass'); g.set(1, 15, 'brass'); g.set(5, 11, 'gem'); if (r >= 2) g.set(6, 12, 'gem'); }
    else if (w.f === 1){ // spear: an ash shaft, a leaf head with a raised rib, brass socket, a ribbon for rare and up
      g.line(1, 15, 9, 7, 'wood', 2); g.rows(['............eee.', '..........eebbbe', '.........ebbbbbe', '.........ebbbbe.', '........ebbbbe..', '.......bbbbe....', '......bbb.......'], { b: 'blade', e: 'edge' }); g.line(8, 6, 10, 8, 'brass', 2); g.set(9, 7, 'gem');
      if (r >= 2){ g.line(8, 8, 7, 11, 'wrap'); g.line(9, 8, 9, 11, 'wrap'); } }
    else if (w.f === 2){ // axe: a heavy bearded head with a back spike, a long haft with a wrap
      g.line(2, 15, 10, 4, 'wood', 2); g.line(3, 13, 4, 12, 'wrap', 2);
      g.rows(['................', '...........bb...', '..........bbbe..', '.........bbbbbe.', '........sbbbbbbe', '.......ssbbbbbbe', '........sbbbbbe.', '.........bbbbe..', '..........bbe...', '...........e....'], { b: 'blade', e: 'edge', s: 'steel' });
      g.set(7, 4, 'steel'); g.set(6, 3, 'steel'); g.set(11, 5, 'gem'); if (r >= 3) g.set(12, 6, 'gem'); }
    else { // dagger: a short wide blade, a cross guard, a stubby grip with a gem pommel
      g.line(7, 8, 13, 2, 'blade', 2); g.line(7, 7, 12, 2, 'edge'); g.set(14, 1, 'edge'); g.line(4, 7, 8, 11, 'brass', 2); g.line(2, 12, 5, 9, 'wrap', 2); g.set(1, 13, 'gem'); g.set(1, 14, 'gem'); g.set(2, 13, 'gem'); }
  } else if (id >= 131 && id < 136){ const r = id - 131; ramps = { cover: { r: GEM[r], d: 1.6 }, gem: { r: GEM[Math.min(4, r + 1)], d: 2.2, em: r >= 2 ? 1 : 0, flat: 0 } };
    g.rows(['................', '...ccccccccccc..', '..cccccccccccpp.', '..cbbbcccccccpp.', '..cbccccgccccpp.', '..cbcccgggcccpp.', '..cbccccgccccpp.', '..cbcccccccccpp.', '..cbcccccccccpp.', '..cbbbcccccccpp.', '..ccccccccccccp.', '..dddddddddddd..'], { c: 'cover', b: 'brass', g: 'gem', p: 'dough', d: 'dark' }); }
  else if (id === STICK){ g.line(3, 13, 12, 4, 'wood', 2); g.set(10, 5, 'leaf'); g.set(11, 4, 'leaf'); g.set(9, 6, 'dark'); }
  else if (id === PICK){ g.line(3, 14, 11, 6, 'wood', 2); g.line(4, 12, 5, 11, 'dark');
    g.rows(['................', '.....sssss......', '...ssssssss.....', '..ss...ssssss...', '.s.....ss.ssss..', '.......ss...sss.', '........s....ss.', '..............s.'], { s: 'stone' }); g.set(9, 4, 'brass'); g.set(10, 5, 'brass'); }
  else if (id === SAIL){ g.rows(['................', '.....cccccc.....', '...ccrrccrrcc...', '..crrccrrccrrc..', '.ccrcc....ccrcc.', '.cc..........cc.', '.p............p.', '..p..p....p..p..', '...p..p..p..p...', '....p..pp..p....', '.....p.pp.p.....', '......pbbp......', '......bbbb......', '.......bb.......'], { c: 'canvas', r: 'sailred', p: 'rope', b: 'brass' }); }
  else if (id === SEED){ g.rows(['................', '.........ll.....', '........llll....', '.......lll......', '......l.l.......', '.....l..........', '....pppp........', '...pppppp.......', '..pppppppp......', '..pppppppp......', '..pppppppp......', '...pppppp.......', '....pppp........'], { l: 'leaf', p: 'pod' }); g.set(4, 9, 'dark'); g.set(6, 8, 'dark'); }
  else if (id === BUN){ g.rows(['................', '................', '.....dddddd.....', '...dddddddddd...', '..dddddddddddd..', '.dddddddddddddd.', '.ddddddppdddddd.', '.dddddpppdddddd.', '.dddddddddddddd.', '.dddddddddddddd.', '..dddddddddddd..', '...dddddddddd...'], { d: 'dough', p: 'petal' }); g.set(4, 5, 'petal'); g.set(11, 6, 'petal'); }
  else if (id === BISCUIT){ g.disc(7.5, 7.5, 5.6, 'biscuit'); for (const [x, y] of [[7, 8], [8, 8], [7, 9], [8, 9], [5, 6], [7, 5], [10, 6]]) g.set(x, y, 'dark'); }
  else if (id === 'relic'){ g.rows(['................', '.......rr.......', '......rrrr......', '.....rrrrrr.....', '....rrrrrrrr....', '...rrrrrrrrrr...', '....rrrrrrrr....', '.....rrrrrr.....', '......rrrr......', '.......rr.......'], { r: 'relic' }); }
  else if (id === 'hook'){ g.rows(['...........s..s.', '............ss..', '..........ss.ss.', '.........sss....', '........bbs.....', '.......bbbb.....', '......bbbb......', '.....bbbb.rr....', '....bbbb.rrrr...', '...wbbb..rrrr...', '..wwbb....rr....', '.www............', '.ww.............'], { s: 'steel', b: 'brass', r: 'rope', w: 'wood' }); }
  const S = shadeArt(g, ramps); return (ART_CACHE[key] = S);
}
// icons: the shaded art with its ink outline, drawn at exactly 2x
function drawItem(g2, id){ const S = itemArt(id), o = outlined(S.px); const im = new ImageData(o, 16, 16), cv = D.createElement('canvas'); cv.width = cv.height = 16; cv.getContext('2d').putImageData(im, 0, 0); g2.imageSmoothingEnabled = false; g2.drawImage(cv, 0, 0, 32, 32); }
function drawWeapon(g2, f, r){ const S = itemArt(WEAPON, { f, r }), o = outlined(S.px); const cv = D.createElement('canvas'); cv.width = cv.height = 16; cv.getContext('2d').putImageData(new ImageData(o, 16, 16), 0, 0); g2.imageSmoothingEnabled = false; g2.drawImage(cv, 0, 0, 32, 32); }
