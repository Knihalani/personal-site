/* =====================================================================
   THE MEMORY ENGINE: a directed short film, made of voxels
   ---------------------------------------------------------------------
   Look: a miniature. Tilt-shift depth of field (separable blur weighted by depth and by distance
   from a focus band), bloom on emissives, god rays from the sun or the engine core, film grain,
   vignette, per-beat colour grade blended over ~1.2 s, 2.39:1 letterbox (capped on portrait phones).
   Post runs ONLY during the film and is disposed afterwards; half-res post on phones.
   Dioramas are instanced cubes whose build, crumble and secondary motion (leaf sway, cloth, drifting
   cloud puffs, light flowing along roots) are computed in the vertex shader, one draw call each.
   Every diorama and its extras are PREBUILT during the opening fade (one per frame, then the
   programs are compiled), so nothing is created while the camera rolls.

   NO HARD CUTS. Shots are joined by:
     oner   the camera keeps moving: the outgoing shot's motion is extrapolated and blended into the
            incoming path over 1.2 s (positions, aim and lens), so the film reads as one flight
     whip   a whip pan with directional blur hides the join
     wipe   a voxel wipe: the last frame dissolves in pixel blocks along a diagonal, with a lit edge
     bloom  light-bloom white: a highlight swells to warm white and the next shot resolves out of it
   Captions cross-fade (the outgoing plate fades while the next one types in).

   PACING: 80 bpm, one bar = 3 s. Shot lengths are whole or half bars and the score's sections are
   cued on the beat changes (s1: SCORE.st.cine), so impacts land on cuts-that-are-not-cuts.

   SHOT LIST   (n  dur  join-in  lens  move  subject  voxels  caption)
   WAKE (D minor, warm dawn)
    1  3.0  fade   FOV 30  slow push-in, low     console crystal          drone, crystal ticks
    2  3.0  oner   FOV 26  crane tilt-up         the monolith's bands     bands ignite, arpeggio
    3  3.0  oner   FOV 50  orbit reveal          crown, rings, core       core ignites, riser, swells to white
   TITLE (key change to E major, impact)
    4  6.0  bloom  FOV 62  crane up and over     ISLAND BALLET: seven islets orbit while KAIAV NIHALANI spirals in
    5  4.5  oner   FOV 30  lateral dolly         the voxel title          Founder of Eden · Co-founder of J
    6  1.5  oner   FOV 70  whip-pan north        title crumbles
   EDEN (cool teal)
    7  4.5  whip   FOV 42  top-down crane down   the floating garden      spiral build    lower third: Eden, Context for agents.
    8  3.0  oner   FOV 34  low hero push-in      the glowing tree         roots ignite    Founder
    9  4.5  oner   FOV 48  orbit                 threads to the agents    cubes ride the threads   Context for agents.
   10  4.5  oner   FOV 54  THE DIVE: down through the canopy, along the trunk, through the well, out under the island into the glowing roots
   11  3.0  oner   FOV 60  pull-out from below   the garden crumbles to the clouds, voxel wipe out
   J (gold)
   12  4.5  wipe   FOV 55  establishing rise     platform rains down      lower third: J: Rising Founder, Co-founder
   13  3.0  oner   FOV 34  low angle             two lanterns, flags      Co-founded by Kaiav Nihalani and Jose Cruz-Lopez
   14  4.5  oner   FOV 40  slow truck            three pillars rise on the beat   Month 1 / 2 / 3
   15  3.0  oner   FOV 36  tracking              founders at the ramp     For ambitious founders aged 23 and under, anywhere in the world.
   16  6.0  oner   FOV 50  THE LAUNCH CRANE: low behind the founders, up and over as they run, jump and open their sails, following them into the sky
   17  3.0  oner   FOV 26  compressed hero       pillars against the sky, crumble   Free · Remote · No fee · No equity, voxel wipe out
   ABOUT (dusk)
   18  6.0  wipe   FOV 34  slow push-in          blossom orchard, petals fall      About / [About Kaiav — bio coming soon]
   19  3.0  oner   FOV 30  drift to the lantern  its glow swells to white
   CONTACT (night)
   20  4.5  bloom  FOV 46  out of the light: the engine core at night, crane up    Say hello
   21  6.0  oner   FOV 60  final pull-back over the island and the Wilds; the end card at 3 s, then the sail gift
   ===================================================================== */

/* ---- voxel fonts and dioramas: entries are [x, y, z, r, g, b, delay, emissive, motion]
        motion: 0 none, 1 leaf sway, 2 cloud drift, 3 light flowing (roots, threads), 4.x cloth (x = amplitude) ---- */
const VFONT = { K: ['X...X', 'X..X.', 'X.X..', 'XX...', 'X.X..', 'X..X.', 'X...X'], A: ['.XXX.', 'X...X', 'X...X', 'XXXXX', 'X...X', 'X...X', 'X...X'], I: ['XXX', '.X.', '.X.', '.X.', '.X.', '.X.', 'XXX'],
  V: ['X...X', 'X...X', 'X...X', 'X...X', '.X.X.', '.X.X.', '..X..'], N: ['X...X', 'XX..X', 'X.X.X', 'X.X.X', 'X..XX', 'X...X', 'X...X'], H: ['X...X', 'X...X', 'X...X', 'XXXXX', 'X...X', 'X...X', 'X...X'], L: ['X....', 'X....', 'X....', 'X....', 'X....', 'X....', 'XXXXX'],
  J: ['..XXX', '...X.', '...X.', '...X.', 'X..X.', 'X..X.', '.XX..'] };
function voxText(lines, o){
  const out = [], S = o.s || 1;
  lines.forEach((txt, li) => {
    let w = 0; for (const ch of txt) w += ch === ' ' ? 3 : VFONT[ch][0].length + 1; w -= 1;
    let cx = -w / 2, ci = 0; const y0 = o.y - li * (o.lh || 9);
    for (const ch of txt){ if (ch === ' '){ cx += 3; continue; } const g = VFONT[ch];
      for (let r = 0; r < 7; r++) for (let c = 0; c < g[r].length; c++) if (g[r][c] === 'X') for (let d = 0; d < 2; d++){
        const edge = r === 0 || d === 0, warm = .5 + .5 * (r / 6);
        out.push([o.x + (cx + c) * S, y0 + (6 - r) * S, o.z - d * S, edge ? 1 : .93, edge ? .9 : .78 - warm * .1, edge ? .72 : .55, (li * .7) + ci * .11 + r * .02 + (h2(c, r * 7 + ci) * .14), edge && d === 0 ? .5 : .15, 0]); }
      cx += g[0].length + 1; ci++; }
  });
  return out;
}
// a floating platform: top layer, layered strata below tapering to a point, optional carve-out
function vdisc(out, cx, cy, cz, r, top, under, delayBase, skip){
  for (let z = -r; z <= r; z++) for (let x = -r; x <= r; x++){ const d = Math.hypot(x, z); if (d > r + .3 || (skip && skip(x, z))) continue;
    const t = top(x, z, d); out.push([cx + x, cy, cz + z, t[0], t[1], t[2], delayBase + d * .05, 0, 0]);
    const depth = Math.max(1, Math.round((r - d) * .95 + h2(x + cx, z) * 2.2)); for (let k = 1; k <= depth; k++){ const u = under(k, d, x, z); out.push([cx + x, cy - k, cz + z, u[0], u[1], u[2], delayBase + d * .05 + k * .03, 0, 0]); } }
}
function vclouds(out, n, R, y0, seed, delay){ for (let i = 0; i < n; i++){ const a = h2(i, seed) * 6.283, d = R * (.7 + h2(i, seed + 1) * .5), cx = Math.cos(a) * d, cz = Math.sin(a) * d, cy = y0 + (h2(i, seed + 2) - .5) * 6;
  for (let k = 0; k < 9; k++){ const ox = (h2(i * 9 + k, seed + 3) - .5) * 4, oz = (h2(i * 9 + k, seed + 4) - .5) * 2.5, oy = (h2(i * 9 + k, seed + 5) - .3) * 1.4; const w = .84 + h2(k, i) * .05; out.push([Math.round(cx + ox), Math.round(cy + oy), Math.round(cz + oz), w, w * .99, w * 1.03, delay + h2(i, k) * .6, 0, 2]); } } }
function vcanopy(out, cx, cy, cz, R, col, glowCol, delay, hole){ for (let y = -R; y <= R; y++) for (let z = -R - 1; z <= R + 1; z++) for (let x = -R - 1; x <= R + 1; x++){ const d = Math.hypot(x, y * 1.35, z); if (d > R + (h3(x + cx, y, z + cz) - .5) * .9) continue; if (hole && hole(cx + x, cy + y, cz + z)) continue;
  const glow = glowCol && h3(x + 3, y, z) > .82 && !(hole && hole(cx + x * 1.4, cy + y, cz + z * 1.4)), sh = .9 + h3(x, y + 9, z) * .18 + y * .025; out.push([cx + x, cy + y, cz + z, glow ? glowCol[0] : col[0] * sh, glow ? glowCol[1] : col[1] * sh, glow ? glowCol[2] : col[2] * sh, delay + (y + R) * .06 + d * .03, glow ? .75 : .05, 1]); } }
function dioramaEden(){
  const v = [], WELL = [3, 2];
  const well = (x, z) => Math.hypot(x - WELL[0], z - WELL[1]) < 1.7;
  vdisc(v, 0, 0, 0, 9, (x, z, d) => d > 8.2 ? [.62, .55, .4] : h2(x * 3, z) > .93 ? [.95, .82, .4] : h2(x, z * 5) > .95 ? [.95, .55, .7] : [.34 + h2(x, z) * .07, .56 + h2(z, x) * .05, .36],
    (k, d) => k < 2 ? [.48, .36, .27] : k < 4 ? [.45, .42, .46] : [.38, .36, .42], 0, well);
  // a little pond and bushes
  for (const [x, z] of [[-4, 3], [-5, 3], [-4, 4], [-5, 4], [-3, 4]]) v.push([x, 0, z, .3, .6, .78, .2, .25, 0]);
  for (const [x, z] of [[5, -4], [-6, -2], [-2, -6], [6, 3]]) for (let k = 0; k < 4; k++) v.push([x + (k & 1), 1 + (k >> 1) * 0, z + (k >> 1), .3, .55, .32, .9 + k * .05, 0, 1]);
  for (let k = 0; k < 14; k++){ const a = h2(k, 41) * 6.283, d = 2.5 + h2(k, 42) * 5.5, x = Math.round(Math.cos(a) * d), z = Math.round(Math.sin(a) * d); if (well(x, z)) continue; const c = [[1, .85, .4], [.95, .55, .75], [.7, .8, 1]][k % 3]; v.push([x, 1, z, c[0] * .9, c[1] * .9, c[2] * .9, 1 + k * .03, .08, 1]); }
  // trunk and canopy (the glowing tree); a gap in the leaves where the camera dives through
  for (let y = 1; y <= 8; y++) for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) v.push([dx, y, dz, .28, .22, .25, .9 + y * .07, 0, 0]);
  vcanopy(v, 0, 10, 0, 5, [.3, .62, .52], [.72, .98, .92], 1.3, (x, y, z) => Math.hypot(x - 2.6, z - 2.2) < 1.7 && y > 6);
  // roots: threads of light out across the disc to six agents; they continue down under the island as hanging glowing roots
  const AG = []; for (let k = 0; k < 6; k++){ const a = k / 6 * 6.283 + .4; AG.push([Math.round(Math.cos(a) * 7), Math.round(Math.sin(a) * 7)]); }
  AG.forEach(([ax, az], k) => { const n = Math.max(Math.abs(ax), Math.abs(az)); for (let s = 1; s < n; s++){ const x = Math.round(ax * s / n), z = Math.round(az * s / n); if (!well(x, z)) v.push([x, 1, z, .55, .95, 1, .5 + s * .06, 1, 3]); }
    v.push([ax, 1, az, .22, .2, .26, 2.2 + k * .1, 0, 0]); v.push([ax, 2, az, .22, .2, .26, 2.3 + k * .1, 0, 0]); v.push([ax, 3, az, .86, .78, .55, 2.4 + k * .1, .15, 0]); });
  for (let k = 0; k < 16; k++){ const a = h2(k, 51) * 6.283, d = 1 + h2(k, 52) * 5, x = Math.round(Math.cos(a) * d), z = Math.round(Math.sin(a) * d), bot = -Math.max(1, Math.round((9 - Math.hypot(x, z)) * .95)), L = 4 + Math.floor(h2(k, 53) * 6);
    for (let s = 1; s <= L; s++) v.push([x + (s > 3 && h2(k, s) > .6 ? 1 : 0), bot - s, z, .45, .9, .85, 1.6 + s * .05, s > L - 2 ? 1 : .55, 3]); }
  vclouds(v, 6, 24, -9, 7, 1.2);
  return { vox: v, agents: AG, style: 1 };
}
function dioramaJ(){
  const v = [];
  for (let z = -5; z <= 5; z++) for (let x = -11; x <= 11; x++){ const edge = Math.abs(z) === 5 || Math.abs(x) === 11, plank = (x & 1) === 0;
    v.push([x, 0, z, edge ? .55 : plank ? .76 : .7, edge ? .45 : plank ? .66 : .6, edge ? .36 : plank ? .52 : .47, Math.abs(x) * .035 + Math.abs(z) * .03, 0, 0]);
    const depth = Math.max(1, Math.round(4 - Math.abs(x) * .22 - Math.abs(z) * .35 + h2(x, z) * 1.5)); for (let k = 1; k <= depth; k++) v.push([x, -k, z, k < 2 ? .5 : .42, k < 2 ? .44 : .4, k < 2 ? .42 : .44, .3 + k * .05 + Math.abs(x) * .03, 0, 0]); }
  // three pillars: month one, two, three (heights grow), gold caps
  const P = [[-5, 4], [-1, 7], [3, 10]]; P.forEach(([px, h], m) => { for (let y = 1; y <= h; y++) for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) v.push([px + dx, y, -1 + dz, .82, .76, .62, 100 + m * 10 + y * .08, 0, 0]);
    for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [2, 1], [0, -1], [1, 2]]) v.push([px + dx, h + 1, -1 + dz, 1, .78, .32, 100 + m * 10 + h * .08 + .1, .8, 0]); });
  // launch ramp with runway lights, two lantern posts, flags, crates
  for (let k = 0; k < 5; k++) for (let z = -1; z <= 1; z++) v.push([12 + k, 1 + Math.floor(k / 2), z, .6, .44, .3, .8 + k * .06, 0, 0]);
  for (let k = 0; k < 6; k++) for (const z of [-2, 2]) v.push([4 + k * 1.6 | 0, 1, z, 1, .85, .5, 1 + k * .05, .9, 3]);
  for (const lz of [-3, 3]){ for (let y = 1; y <= 3; y++) v.push([-9, y, lz, .35, .25, .18, .9 + y * .05, 0, 0]); v.push([-9, 4, lz, 1, .82, .45, 1.1, 1, 0]); }
  for (const [fx, fz, c] of [[-11, -5, [.95, .7, .3]], [-4, -5, [.95, .45, .35]], [4, -5, [.95, .7, .3]], [11, -5, [.95, .45, .35]]]){ for (let y = 1; y <= 6; y++) v.push([fx, y, fz, .35, .3, .28, .7 + y * .05, 0, 0]);
    for (let k = 1; k <= 4; k++) for (let y = 4; y <= 6; y++) v.push([fx + (fx < 0 ? k : -k), y, fz, c[0], c[1], c[2], 1 + k * .05, .1, 4 + Math.min(.9, k * .22)]); }
  for (const [cx, cz] of [[-8, -3], [-7, -3], [-8, -2]]) v.push([cx, 1, cz, .62, .46, .3, 1.2, 0, 0]); v.push([-8, 2, -3, .62, .46, .3, 1.3, 0, 0]);
  vclouds(v, 7, 26, -9, 9, 1.4);
  return { vox: v, pillars: P, style: 2 };
}
function dioramaAbout(){
  const v = [];
  vdisc(v, 0, 0, 0, 6, (x, z, d) => Math.abs(x - z * .4) < .8 ? [.62, .55, .44] : [.4 + h2(x, z) * .05, .58, .38], (k) => k < 2 ? [.45, .36, .3] : [.44, .4, .44], 0);
  for (const [tx, tz, s] of [[-2, -2, 1], [1, -4, .8], [-4, 2, .7]]){ const H = Math.round(4 * s) + 1; for (let y = 1; y <= H; y++) v.push([tx, y, tz, .4, .3, .22, .4 + y * .08, 0, 0]);
    vcanopy(v, tx, H + 2, tz, Math.max(2, Math.round(2.6 * s)), [.95, .66, .72], [1, .86, .9], .8, null); }
  for (let x = 0; x <= 2; x++) v.push([x + 1, 1, 2, .6, .44, .3, .5, 0, 0]);
  for (let y = 1; y <= 3; y++) v.push([4, y, -1, .25, .2, .18, .6, 0, 0]); v.push([4, 4, -1, 1, .82, .45, .7, 1, 0]); v.push([4, 5, -1, .22, .18, .16, .75, 0, 0]);
  for (const [x, z] of [[-1, 4], [0, 4], [-1, 5]]) v.push([x, 0, z, .32, .55, .72, .3, .2, 0]);
  vclouds(v, 5, 20, -8, 11, 1);
  return { vox: v, lantern: [4, 4, -1], style: 0 };
}
function dioramaIsles(){ // the title ballet's seven islets, on a ring around the lettering
  const v = []; for (let i = 0; i < 7; i++){ const a = i / 7 * 6.283, cx = Math.round(Math.cos(a) * 24), cz = Math.round(Math.sin(a) * 24), cy = Math.round(Math.sin(a * 2) * 4) - 4, r = 2 + (i % 3);
    vdisc(v, cx, cy, cz, r, (x, z, d) => [.36 + h2(x + i, z) * .06, .56, .38], (k) => k < 2 ? [.48, .36, .27] : [.42, .4, .46], i * .25);
    if (i % 2 === 0){ for (let y = 1; y <= 2; y++) v.push([cx, cy + y, cz, .3, .22, .2, i * .25 + .6, 0, 0]); vcanopy(v, cx, cy + 4, cz, 1, [.32, .62, .44], null, i * .25 + .8, null); } }
  return { vox: v, style: 0 };
}

/* ---- GPU voxel assembly: one instanced draw per diorama ---- */
function voxMesh(list, style){
  const n = list.length, g = new THREE.InstancedBufferGeometry(); const bx = new THREE.BoxGeometry(1, 1, 1);
  g.index = bx.index; g.setAttribute('position', bx.attributes.position); g.setAttribute('normal', bx.attributes.normal);
  const P = new Float32Array(n * 3), C = new Float32Array(n * 3), M = new Float32Array(n * 4), Sx = new Float32Array(n);
  list.forEach((q, i) => { P[i * 3] = q[0]; P[i * 3 + 1] = q[1]; P[i * 3 + 2] = q[2]; C[i * 3] = q[3]; C[i * 3 + 1] = q[4]; C[i * 3 + 2] = q[5]; M[i * 4] = q[6]; M[i * 4 + 1] = q[7]; M[i * 4 + 2] = h2(i, 7); M[i * 4 + 3] = h2(i * 3, 11); Sx[i] = q[8] || 0; });
  g.setAttribute('aP', new THREE.InstancedBufferAttribute(P, 3)); g.setAttribute('aC', new THREE.InstancedBufferAttribute(C, 3)); g.setAttribute('aM', new THREE.InstancedBufferAttribute(M, 4)); g.setAttribute('aS', new THREE.InstancedBufferAttribute(Sx, 1));
  g.instanceCount = n;
  const mat = new THREE.ShaderMaterial({
    uniforms: Object.assign({ uB: { value: -1 }, uK: { value: -1 }, uStyle: { value: style }, uSc: { value: 1 }, uGlow: { value: 1 }, uSlow: { value: 1 }, uCtr: { value: new THREE.Vector3() }, uMo: { value: REDUCED ? .3 : 1 } }, U),
    vertexShader: `
      attribute vec3 aP; attribute vec3 aC; attribute vec4 aM; attribute float aS; uniform float uB, uK, uStyle, uSc, uSlow, uMo; uniform vec3 uCtr; uniform float uTime;
      varying vec3 vC; varying vec3 vN; varying vec3 vW; varying float vE;
      mat3 rot(vec3 a, float t){ a = normalize(a); float s = sin(t), c = cos(t), o = 1.0 - c; return mat3(o*a.x*a.x+c, o*a.x*a.y+a.z*s, o*a.z*a.x-a.y*s, o*a.x*a.y-a.z*s, o*a.y*a.y+c, o*a.y*a.z+a.x*s, o*a.z*a.x+a.y*s, o*a.y*a.z-a.x*s, o*a.z*a.z+c); }
      float outBack(float t){ float c1 = 1.9, c3 = c1 + 1.0; return 1.0 + c3 * pow(t - 1.0, 3.0) + c1 * pow(t - 1.0, 2.0); }
      void main(){
        float d = aM.x, r1 = aM.z, r2 = aM.w;
        float b = clamp((uB - d) / (0.55 * uSlow), 0.0, 1.0);
        float k = uK < 0.0 ? 0.0 : clamp((uK - (r1 * 0.9 + (1.0 - aP.y * 0.02) * 0.2)) / 1.6, 0.0, 1.0);
        float e = uSlow > 1.5 ? smoothstep(0.0, 1.0, b) : outBack(b);
        vec3 p;
        if (uStyle > 2.5){ // ballet: each cube swings in on a widening helix around the title's centre
          float ee = smoothstep(0.0, 1.0, b); vec3 rel = aP - uCtr; float ang = (1.0 - ee) * (5.0 + r1 * 4.0);
          vec3 sp = vec3(cos(r1 * 6.283) * 16.0, (r2 - 0.5) * 12.0, sin(r1 * 6.283) * 16.0) * (1.0 - ee) + rel * ee;
          float ca = cos(ang), sa = sin(ang); p = uCtr + vec3(sp.x * ca - sp.z * sa, sp.y + sin(ee * 3.14159) * 2.0, sp.x * sa + sp.z * ca);
        } else {
          vec3 start;
          if (uStyle < 0.5) start = aP + vec3((r1 - 0.5) * 1.5, -7.0 - r2 * 4.0, (r2 - 0.5) * 1.5);
          else if (uStyle < 1.5){ float a = r1 * 6.283 + aP.y * 0.4; start = aP + vec3(cos(a) * 9.0, 4.0 + r2 * 6.0, sin(a) * 9.0); }
          else start = aP + vec3((r1 - 0.5) * 2.0, 16.0 + r2 * 10.0, (r2 - 0.5) * 2.0);
          p = mix(start, aP, clamp(e, 0.0, 1.15));
        }
        // secondary motion
        float mo = floor(aS + 0.001); float t = uTime;
        if (mo == 1.0) p += vec3(sin(t * 1.6 + aP.x * 0.5 + aP.y * 0.3), 0.0, cos(t * 1.3 + aP.z * 0.5)) * 0.07 * uMo;
        else if (mo == 2.0) p += vec3(sin(t * 0.13 + r1 * 6.0) * 1.4, sin(t * 0.3 + r2 * 6.0) * 0.25, cos(t * 0.11 + r2 * 6.0) * 0.8) * uMo;
        else if (mo == 4.0) p.z += sin(t * 4.2 - aP.x * 0.9 + aP.y * 0.4) * 0.22 * fract(aS) * uMo;
        float sc = uSlow > 1.5 ? b : clamp(b * 1.6, 0.0, 1.0);
        vec3 lp = position * sc * 0.98;
        if (b < 1.0) lp = rot(vec3(r1 - 0.5, 1.0, r2 - 0.5), (1.0 - b) * 4.0 * (1.0 - step(1.5, uSlow))) * lp;
        if (k > 0.0){ lp = rot(vec3(r2 - 0.5, r1 - 0.5, 0.7), k * (6.0 + r1 * 8.0)) * lp * (1.0 - smoothstep(0.75, 1.0, k));
          p += vec3((r1 - 0.5) * 6.0, 0.0, (r2 - 0.5) * 6.0) * k + vec3(0.0, 3.0 * k - 26.0 * k * k, 0.0); }
        vec4 w = modelMatrix * vec4(p + lp * uSc, 1.0);
        vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vC = aC;
        vE = mo == 3.0 ? aM.y * (0.3 + 0.7 * pow(0.5 + 0.5 * sin(t * 3.5 - length(aP) * 0.9), 3.0)) : aM.y * (0.6 + 0.4 * sin(t * 3.0 + r1 * 20.0));
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `${GL_COMMON}
      uniform float uGlow; varying vec3 vC; varying vec3 vN; varying vec3 vW; varying float vE;
      void main(){ vec3 n = normalize(vN); vec3 c = litCol(vC, n, 0.95, 0.0); vec3 v = normalize(cameraPosition - vW); c += (uSunCol * 0.5 + uAmbSky * 0.5) * pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.3;
        c = mix(c, vC * 1.3, clamp(vE * uGlow, 0.0, 1.0)); c = fogIt(c, vW); gl_FragColor = vec4(grade(c), 1.0); }`
  });
  const m = new THREE.Mesh(g, mat); m.frustumCulled = false; return m;
}

/* ---- the post pipeline (built on entry, disposed on exit) ---- */
let POST = null;
function postBuild(){
  const half = LOW ? .5 : 1, w = renderer.domElement.width, h = renderer.domElement.height;
  const mk = (ww, hh, depth) => { const rt = new THREE.WebGLRenderTarget(Math.max(2, ww | 0), Math.max(2, hh | 0), { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }); if (depth){ rt.depthTexture = new THREE.DepthTexture(rt.width, rt.height); rt.depthTexture.type = THREE.UnsignedIntType; } return rt; };
  const scn = mk(w, h, true), a = mk(w * .5 * half, h * .5 * half), b = mk(w * .5 * half, h * .5 * half), ba = mk(w * .25 * half, h * .25 * half), bb = mk(w * .25 * half, h * .25 * half), hold = mk(w * half, h * half);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)), qs = new THREE.Scene(), qc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); qs.add(quad); quad.frustumCulled = false;
  const V = `varying vec2 vU; void main(){ vU = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
  const DEPTH = `uniform sampler2D tD; uniform float uNear, uFar; float lin(vec2 u){ float z = texture2D(tD, u).x * 2.0 - 1.0; return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear)); }`;
  const COC = `uniform float uFocus, uRange, uTilt, uBand, uMaxB; float coc(vec2 u){ float d = lin(u); float c = smoothstep(0.0, uRange, abs(d - uFocus)) * 0.85; float t = smoothstep(0.1, 0.5, abs(u.y - uBand)) * uTilt; return clamp(max(c, t), 0.0, 1.0); }`;
  // DoF blur: depth-aware (a sharp foreground never bleeds into a blurred background), so edges stay clean
  const blurMat = new THREE.ShaderMaterial({ uniforms: { tC: { value: null }, tD: { value: scn.depthTexture }, uDir: { value: new THREE.Vector2(1, 0) }, uNear: { value: .08 }, uFar: { value: 900 }, uFocus: { value: 20 }, uRange: { value: 30 }, uTilt: { value: .7 }, uBand: { value: .5 }, uMaxB: { value: 1 }, uWhip: { value: 0 } }, vertexShader: V,
    fragmentShader: `uniform sampler2D tC; uniform vec2 uDir; uniform float uWhip; varying vec2 vU; ${DEPTH} ${COC}
      void main(){ float c = coc(vU) * uMaxB; float d0 = lin(vU); vec2 st = uDir * (c * 1.5 + uWhip * 14.0); vec4 s = vec4(0.0); float wt = 0.0;
        for (int i = -4; i <= 4; i++){ float f = float(i); vec2 o = st * f; float w = exp(-f * f / 9.0); float cc = coc(vU + o); float dd = lin(vU + o); w *= mix(0.25, 1.0, cc) * (dd < d0 - 0.5 && cc < 0.2 ? 0.15 : 1.0); s += texture2D(tC, vU + o) * w; wt += w; }
        gl_FragColor = vec4(s.rgb / wt, c); }` });
  const brightMat = new THREE.ShaderMaterial({ uniforms: { tC: { value: null }, tD: { value: scn.depthTexture }, uNear: { value: .08 }, uFar: { value: 900 }, uTh: { value: .8 }, uRay: { value: new THREE.Vector3() }, uAsp: { value: 1 }, uSkyOK: { value: 0 } }, vertexShader: V,
    fragmentShader: `uniform sampler2D tC; uniform float uTh, uSkyOK; uniform vec3 uRay; uniform float uAsp; varying vec2 vU; ${DEPTH}
      void main(){ vec3 c = texture2D(tC, vU).rgb; float l = dot(c, vec3(0.299, 0.587, 0.114)); float w = smoothstep(uTh, uTh + 0.18, l);
        if (lin(vU) > 480.0){ vec2 q = (vU - uRay.xy) * vec2(uAsp, 1.0); w *= smoothstep(0.3, 0.0, length(q)) * step(0.001, uRay.z) * uSkyOK; }
        gl_FragColor = vec4(c * w, 1.0); }` });
  const gaussMat = new THREE.ShaderMaterial({ uniforms: { tC: { value: null }, uDir: { value: new THREE.Vector2(1, 0) } }, vertexShader: V,
    fragmentShader: `uniform sampler2D tC; uniform vec2 uDir; varying vec2 vU; void main(){ vec3 s = vec3(0.0); float wt = 0.0; for (int i = -5; i <= 5; i++){ float f = float(i); float w = exp(-f * f / 12.0); s += texture2D(tC, vU + uDir * f * 1.5).rgb * w; wt += w; } gl_FragColor = vec4(s / wt, 1.0); }` });
  const compMat = new THREE.ShaderMaterial({ uniforms: { tC: { value: scn.texture }, tB: { value: null }, tL: { value: null }, tH: { value: hold.texture }, tD: { value: scn.depthTexture }, uNear: { value: .08 }, uFar: { value: 900 }, uFocus: { value: 20 }, uRange: { value: 30 }, uTilt: { value: .7 }, uBand: { value: .5 }, uMaxB: { value: 1 },
      uRay: { value: new THREE.Vector3(.5, .7, 0) }, uBloom: { value: .8 }, uLift: { value: new THREE.Vector3() }, uGain: { value: new THREE.Vector3(1, 1, 1) }, uSat: { value: 1 }, uBars: { value: 0 }, uAspect: { value: 1 }, uBarMax: { value: .5 }, uGrain: { value: .045 }, uT: { value: 0 }, uFade: { value: 0 },
      uWipe: { value: -1 }, uWhite: { value: 0 }, uCells: { value: 18 } }, vertexShader: V,
    fragmentShader: `uniform sampler2D tC, tB, tL, tH; uniform vec3 uRay, uLift, uGain; uniform float uBloom, uSat, uBars, uAspect, uBarMax, uGrain, uT, uFade, uWipe, uWhite, uCells; varying vec2 vU; ${DEPTH} ${COC}
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        vec3 sharp = texture2D(tC, vU).rgb; vec4 bl = texture2D(tB, vU); float c = coc(vU) * uMaxB;
        vec3 col = mix(sharp, bl.rgb, smoothstep(0.08, 0.7, c));
        vec3 bloom = texture2D(tL, vU).rgb; col += min(bloom, vec3(0.55)) * (uBloom + uWhite * 1.5);
        if (uRay.z > 0.001){ vec2 dl = (uRay.xy - vU) / 30.0; vec2 p = vU; float dec = 1.0; vec3 acc = vec3(0.0); for (int i = 0; i < 30; i++){ p += dl; acc += texture2D(tL, p).rgb * dec; dec *= 0.955; } col += min(acc / 30.0 * uRay.z * 2.2, vec3(0.4)); }
        col = col * uGain + uLift * (1.0 - col); float l = dot(col, vec3(0.299, 0.587, 0.114)); col = mix(vec3(l), col, uSat);
        col = clamp(col, 0.0, 1.0); col = mix(col, col * col * (3.0 - 2.0 * col), 0.35);
        // light-bloom white: highlights swell first, then the whole frame
        col = mix(col, vec3(1.0, 0.97, 0.9), clamp(uWhite * (0.6 + l * 0.8), 0.0, 1.0));
        vec2 q = vU - 0.5; col *= 1.0 - dot(q, q) * 0.75 * (1.0 - uWhite);
        // voxel wipe: the held last frame dissolves block by block along a diagonal; each block shrinks to nothing with a lit rim
        if (uWipe >= 0.0){ vec2 g = vec2(vU.x * uAspect, vU.y) * uCells; vec2 cell = floor(g), f = fract(g) - 0.5; float th = dot(cell / uCells, vec2(0.55 / max(uAspect, 0.5), 0.45)) * 0.75 + hash(cell) * 0.25;
          float k = clamp((uWipe * 1.35 - th) / 0.22, 0.0, 1.0); float half_ = 0.5 * (1.0 - k); vec3 old = texture2D(tH, vU).rgb;
          float inside = step(max(abs(f.x), abs(f.y)), half_); float rim = inside * smoothstep(half_ - 0.12, half_, max(abs(f.x), abs(f.y))) * step(0.001, k) * (1.0 - k);
          col = mix(col, old, inside); col += vec3(1.0, 0.86, 0.6) * rim * 0.8; }
        col += (hash(vU * 731.0 + uT) - 0.5) * uGrain * (1.0 - uWhite);
        float target = clamp((1.0 - uAspect / 2.39) * 0.5, 0.0, uBarMax) * uBars; if (vU.y < target || vU.y > 1.0 - target) col = vec3(0.012, 0.01, 0.014);
        col = mix(col, vec3(0.055, 0.05, 0.065), uFade);
        gl_FragColor = vec4(col, 1.0); }` });
  POST = { scn, a, b, ba, bb, hold, quad, qs, qc, blurMat, brightMat, gaussMat, compMat, w, h };
}
function postDispose(){ if (!POST) return; for (const k of ['scn', 'a', 'b', 'ba', 'bb', 'hold']){ if (POST[k].depthTexture) POST[k].depthTexture.dispose(); POST[k].dispose(); } for (const k of ['blurMat', 'brightMat', 'gaussMat', 'compMat']) POST[k].dispose(); POST.quad.geometry.dispose(); POST = null; }
function postRender(){
  const P = POST, R = renderer; if (P.w !== R.domElement.width || P.h !== R.domElement.height){ postDispose(); postBuild(); }
  const pass = (mat, target) => { P.quad.material = mat; R.setRenderTarget(target); R.render(P.qs, P.qc); };
  R.setRenderTarget(P.scn); R.render(scene, camera);
  const F = CINE.f;
  for (const m of [P.blurMat, P.compMat]){ const u = m.uniforms; u.uNear.value = camera.near; u.uFar.value = camera.far; u.uFocus.value = F.focus; u.uRange.value = F.range; u.uTilt.value = F.tilt; u.uBand.value = F.band; u.uMaxB.value = REDUCED ? .4 : .8; }
  P.blurMat.uniforms.tC.value = P.scn.texture; P.blurMat.uniforms.uDir.value.set(1 / P.a.width, 0); P.blurMat.uniforms.uWhip.value = F.whip; pass(P.blurMat, P.a);
  P.blurMat.uniforms.tC.value = P.a.texture; P.blurMat.uniforms.uDir.value.set(0, 1 / P.a.height); P.blurMat.uniforms.uWhip.value = 0; pass(P.blurMat, P.b);
  { const bu = P.brightMat.uniforms; bu.tC.value = P.scn.texture; bu.uNear.value = camera.near; bu.uFar.value = camera.far; bu.uRay.value.copy(F.ray); bu.uAsp.value = innerWidth / innerHeight; bu.uSkyOK.value = SHOTS[CINE.shot] && SHOTS[CINE.shot].ray === 'sun' ? 1 : 0; bu.uTh.value = .8 - F.white * .5; } pass(P.brightMat, P.ba);
  P.gaussMat.uniforms.tC.value = P.ba.texture; P.gaussMat.uniforms.uDir.value.set(1 / P.ba.width, 0); pass(P.gaussMat, P.bb);
  P.gaussMat.uniforms.tC.value = P.bb.texture; P.gaussMat.uniforms.uDir.value.set(0, 1 / P.ba.height); pass(P.gaussMat, P.ba);
  const c = P.compMat.uniforms; c.tB.value = P.b.texture; c.tL.value = P.ba.texture; c.uT.value = tAcc % 10; c.uAspect.value = innerWidth / innerHeight; c.uBarMax.value = innerWidth < innerHeight ? .12 : .5;
  c.uBars.value = F.bars; c.uBloom.value = F.bloom; c.uFade.value = F.fade; c.uRay.value.copy(F.ray); c.uLift.value.copy(F.lift); c.uGain.value.copy(F.gain); c.uSat.value = F.sat; c.uGrain.value = REDUCED ? .02 : .045; c.uWhite.value = F.white; c.uCells.value = innerWidth < innerHeight ? 10 : 18;
  if (CINE.capHold){ c.uWipe.value = -1; c.tH.value = P.b.texture; pass(P.compMat, P.hold); }
  c.tH.value = P.hold.texture; c.uWipe.value = F.wipe;
  pass(P.compMat, null);
}

/* ---- the film ---- */
const CINE = { on: false, t: 0, shot: 0, st: 0, paused: false, saved: null, dio: {}, ending: false, blend: -1, f: null, queued: false, beatT: 0, pre: [], built: {}, capHold: false, prev: null, maxDt: 0 };
const GRADES = { // lift, gain, saturation
  wake: [[.012, .006, 0], [1.02, .97, .88], 1.04], title: [[.02, .01, 0], [1.05, .96, .84], 1.1], eden: [[0, .012, .022], [.88, 1, 1.04], 1.02],
  j: [[.022, .012, 0], [1.06, .97, .76], 1.1], about: [[.02, 0, .02], [1.02, .88, .9], .96], contact: [[.01, .016, .045], [.96, .98, 1.1], .92] };
let SHOTS = [];
function anchors(){
  const E = ENGINE, ex = E.x, ez = E.z, base = E.y, top = E.top, core = E.core;
  return { E, ex, ez, base, top, core, eden: [ex - 22, top + 3, ez - 22], j: [ex + 26, top - 1, ez - 18], about: [ex - 22, top - 4, ez + 16], title: [ex, top + 13, ez - 12] };
}
function buildShots(){
  const A = anchors(), v = (x, y, z) => new THREE.Vector3(x, y, z), ex = A.ex, ez = A.ez, cz = A.E.console.z, by = A.base;
  const ed = A.eden, jd = A.j, ab = A.about, ti = A.title;
  const S = (beat, dur, fov, pos, look, o) => Object.assign({ beat, dur, fov, pos: pos.map(p => v(...p)), look: look.map(p => v(...p)), tin: 'oner' }, o || {});
  SHOTS = [
    S('wake', 3, 30, [[ex + 2.6, by + 1.3, cz + 8.5], [ex + 1.6, by + 1.8, cz + 6.2]], [[ex + .5, by + 2.5, cz], [ex + .5, by + 3.2, cz - 1.2]], { focus: 4, range: 3, tilt: .5, ray: 'core', day: .975, dayTo: .99, tin: 'fade', easeIn: 1 }),
    S('wake', 3, 26, [[ex + 12, by + 3, ez + 20], [ex + 13, by + 13, ez + 21]], [[ex, by + 4, ez], [ex, A.top - 1, ez]], { focus: 18, range: 14, tilt: .5, ray: 'core', ev: 'bands', day: .99, dayTo: 1.005 }),
    S('wake', 3, 50, [[ex + 9, A.top + 1, ez + 6], [ex - 3, A.top + 4, ez + 11], [ex - 9, A.top + 2, ez + 2]], [[ex, A.core - 1, ez], [ex, A.core, ez]], { focus: 11, range: 10, tilt: .45, ray: 'core', ev: 'ignite', sfx: 'riser', sfxAt: 0, day: .005, dayTo: .03, tout: 'bloom' }),
    S('title', 6, 62, [[ex + 30, by + 3, ez + 46], [ex + 14, by + 24, ez + 34], [ex + 2, by + 32, ez + 22]], [[ex, by + 8, ez], [ti[0], ti[1] - 4, ti[2]], [ti[0], ti[1] - 1, ti[2]]], { focus: 40, range: 40, tilt: .4, ray: 'sun', ev: 'title', day: .035, tin: 'bloom' }),
    S('title', 4.5, 30, [[ex - 16, ti[1] - 2, ti[2] + 44], [ex + 12, ti[1] - 1, ti[2] + 44]], [[ti[0] - 4, ti[1] - 3, ti[2]], [ti[0] + 4, ti[1] - 3, ti[2]]], { focus: 44, range: 18, tilt: .55, ray: 'sun', cap: { k: 'sub', t: 'Founder of Eden · Co-founder of J' }, day: .04 }),
    S('title', 1.5, 70, [[ex + 2, ti[1] - 2, ti[2] + 30], [ex + 2, ti[1] - 2, ti[2] + 30]], [[ti[0], ti[1] - 3, ti[2]], [ed[0], ed[1], ed[2]]], { focus: 30, range: 30, tilt: .3, whip: 1, ev: 'titleOut', sfx: 'whoosh', ease: 'whip', tout: 'whip' }),
    S('eden', 4.5, 42, [[ed[0] + 4, ed[1] + 44, ed[2] + 6], [ed[0] + 10, ed[1] + 22, ed[2] + 20]], [[ed[0], ed[1], ed[2]], [ed[0], ed[1] + 5, ed[2]]], { focus: 26, range: 10, tilt: .7, ev: 'eden', cap: { k: 'lower', a: 'Eden', b: 'Context for agents.' }, day: .12, tin: 'whip' }),
    S('eden', 3, 34, [[ed[0] + 16, ed[1] + 1.5, ed[2] + 14], [ed[0] + 13, ed[1] + 2.2, ed[2] + 11]], [[ed[0], ed[1] + 8, ed[2]], [ed[0], ed[1] + 9, ed[2]]], { focus: 12, range: 7, tilt: .65, ray: 'eden', ev: 'roots', cap: { k: 'tag', t: 'Founder' } }),
    S('eden', 4.5, 48, [[ed[0] + 14, ed[1] + 6, ed[2]], [ed[0] + 9, ed[1] + 7, ed[2] + 10], [ed[0] - 1, ed[1] + 7, ed[2] + 14]], [[ed[0], ed[1] + 2, ed[2]], [ed[0], ed[1] + 2, ed[2]]], { focus: 13, range: 8, tilt: .6, ev: 'cubes', cap: { k: 'mid', t: 'Context for agents.' } }),
    // THE DIVE: over the crown, down through the gap in the leaves, along the trunk, through the well, out beneath into the roots
    S('eden', 4.5, 54, [[ed[0] + 1.6, ed[1] + 21, ed[2] + 1.2], [ed[0] + 2.5, ed[1] + 12, ed[2] + 2.1], [ed[0] + 2.7, ed[1] + 5, ed[2] + 2.2], [ed[0] + 3.1, ed[1] - 1, ed[2] + 2.1], [ed[0] + 4.5, ed[1] - 8, ed[2] + 5.5]],
      [[ed[0] + .5, ed[1] + 10, ed[2] + .2], [ed[0] + .9, ed[1] + 4, ed[2] + .8], [ed[0] + 1.6, ed[1] - 3, ed[2] + 1.4], [ed[0] + .5, ed[1] - 8, ed[2] - 1], [ed[0] - 2, ed[1] - 5, ed[2] - 3]], { focus: 4, range: 4, tilt: .35, ray: 'eden', near: .05, lin: 1 }),
    S('eden', 3, 60, [[ed[0] + 8, ed[1] - 8, ed[2] + 12], [ed[0] + 18, ed[1] + 2, ed[2] + 26]], [[ed[0], ed[1] - 2, ed[2]], [ed[0], ed[1] + 1, ed[2]]], { focus: 22, range: 16, tilt: .5, ev: 'edenOut', sfx: 'rumble', tout: 'wipe' }),
    S('j', 4.5, 55, [[jd[0] - 20, jd[1] - 6, jd[2] + 28], [jd[0] - 13, jd[1] + 6, jd[2] + 23]], [[jd[0], jd[1] - 8, jd[2]], [jd[0], jd[1] + 2, jd[2]]], { focus: 27, range: 16, tilt: .55, ray: 'sun', ev: 'j', cap: { k: 'lower', a: 'J: Rising Founder', b: 'Co-founder' }, day: .55, tin: 'wipe' }),
    S('j', 3, 34, [[jd[0] - 20, jd[1] + 2.4, jd[2] + 11], [jd[0] - 18, jd[1] + 2.8, jd[2] + 10]], [[jd[0] - 9, jd[1] + 3, jd[2] - 1], [jd[0] - 9, jd[1] + 3.2, jd[2]]], { focus: 13, range: 6, tilt: .6, ev: 'lanterns', cap: { k: 'mid', t: 'Co-founded by Kaiav Nihalani and Jose Cruz-Lopez' } }),
    S('j', 4.5, 40, [[jd[0] - 12, jd[1] + 5, jd[2] + 22], [jd[0] + 2, jd[1] + 7, jd[2] + 23]], [[jd[0] - 3, jd[1] + 4, jd[2]], [jd[0] + 1, jd[1] + 6, jd[2]]], { focus: 17, range: 10, tilt: .55, ev: 'pillars', cap: { k: 'months' } }),
    S('j', 3, 36, [[jd[0] + 1, jd[1] + 3, jd[2] + 12], [jd[0] + 5, jd[1] + 3, jd[2] + 11]], [[jd[0] + 6, jd[1] + 1.5, jd[2]], [jd[0] + 9, jd[1] + 1.5, jd[2]]], { focus: 10, range: 6, tilt: .6, cap: { k: 'mid', t: 'For ambitious founders aged 23 and under, anywhere in the world.' } }),
    // THE LAUNCH CRANE
    S('j', 6, 50, [[jd[0] + 1, jd[1] + 1.6, jd[2] + 4.5], [jd[0] + 9, jd[1] + 5, jd[2] + 8], [jd[0] + 20, jd[1] + 12, jd[2] + 12], [jd[0] + 32, jd[1] + 15, jd[2] + 13]],
      [[jd[0] + 9, jd[1] + 1.5, jd[2]], [jd[0] + 16, jd[1] + 3, jd[2]], [jd[0] + 27, jd[1] + 4, jd[2] - 2], [jd[0] + 40, jd[1] + 3, jd[2] - 5]], { focus: 14, range: 14, tilt: .45, ray: 'sun', ev: 'launch', evAt: .2, cap: { k: 'mid', t: 'An early chance for extraordinary founders.' }, sfx: 'whoosh', sfxAt: 1.2, lin: 1 }),
    S('j', 3, 26, [[jd[0] - 30, jd[1] + 1, jd[2] + 30], [jd[0] - 28, jd[1] + 2, jd[2] + 30]], [[jd[0] - 1, jd[1] + 6, jd[2]], [jd[0] - 1, jd[1] + 6.5, jd[2]]], { focus: 40, range: 12, tilt: .5, ray: 'sun', cap: { k: 'big', t: 'Free · Remote · No fee · No equity' }, ev: 'jOut', evAt: 1.6, tout: 'wipe' }),
    S('about', 6, 34, [[ab[0] + 17, ab[1] + 7, ab[2] + 15], [ab[0] + 12, ab[1] + 5.5, ab[2] + 11]], [[ab[0], ab[1] + 3, ab[2]], [ab[0] + 1.5, ab[1] + 3.4, ab[2]]], { focus: 16, range: 8, tilt: .7, ev: 'about', cap: { k: 'lower', a: 'About', b: '[About Kaiav — bio coming soon]' }, day: .64, tin: 'wipe' }),
    S('about', 3, 30, [[ab[0] + 10, ab[1] + 5, ab[2] + 5], [ab[0] + 8, ab[1] + 4.6, ab[2] + 2.5]], [[ab[0] + 4.5, ab[1] + 4.2, ab[2] - 1], [ab[0] + 4.5, ab[1] + 4.3, ab[2] - 1]], { focus: 5, range: 3, tilt: .7, ev: 'aboutOut', evAt: 2.4, tout: 'bloom' }),
    S('contact', 4.5, 46, [[ex + 2.5, A.core - 1, ez + 3.6], [ex + 6, A.core + 4, ez + 12]], [[ex, A.core, ez], [ex, A.core - 1, ez]], { focus: 4, range: 6, tilt: .5, ray: 'core', cap: { k: 'tag', t: 'Say hello' }, day: .66, dayTo: .8, tin: 'bloom' }),
    S('contact', 6, 60, [[ex - 8, A.core + 5, ez - 16], [ex - 32, A.core + 18, ez - 50], [ex - 54, A.core + 26, ez - 80]], [[ex, A.core - 3, ez], [ex + 12, by + 2, ez + 14], [ex + 70, by + 6, ez + 90]], { focus: 70, range: 80, tilt: .35, ray: 'core', ev: 'card', evAt: 3, day: .8, dayTo: .82 })
  ];
  SHOTS.forEach(s => { s.pc = new THREE.CatmullRomCurve3(s.pos.length > 1 ? s.pos : [s.pos[0], s.pos[0].clone()]); s.lc = new THREE.CatmullRomCurve3(s.look.length > 1 ? s.look : [s.look[0], s.look[0].clone()]); s.plen = s.pc.getLength(); s.llen = s.lc.getLength(); });
}
const BEATS = ['wake', 'title', 'eden', 'j', 'about', 'contact'];
function beatStart(b){ return SHOTS.findIndex(s => s.beat === b); }
function snapshotPlayer(){ const P = PL; return { x: P.x, y: P.y, z: P.z, px: P.px, py: P.py, pz: P.pz, vx: P.vx, vy: P.vy, vz: P.vz, yaw: P.yaw, pitch: P.pitch, onGround: P.onGround, wasGround: P.wasGround, air: P.air, gliding: P.gliding, sailOpen: P.sailOpen, gs: P.gs, flaps: P.flaps, stall: P.stall, glideLock: P.glideLock, coyote: P.coyote, dashCD: P.dashCD, slideT: P.slideT, dayT, sailO: HR.sailO, third, fov: camera.fov, prev: state }; }
/* prebuilding: every diorama, its extras and the motes are made during the opening fade, one a frame, then compiled */
const DIO_DEF = { title: () => ({ D: { vox: voxText(['KAIAV', 'NIHALANI'], { x: 0, y: 0, z: 0, s: 1, lh: 9 }) }, style: 3, at: anchors().title, sc: .78 }), isles: () => ({ D: dioramaIsles(), style: 0, at: anchors().title }),
  eden: () => ({ D: dioramaEden(), style: 1, at: anchors().eden }), j: () => ({ D: dioramaJ(), style: 2, at: anchors().j }), about: () => ({ D: dioramaAbout(), style: 0, at: anchors().about }) };
function prebuildOne(key){
  if (CINE.built[key]) return CINE.built[key]; const o = DIO_DEF[key](), m = voxMesh(o.D.vox, o.style); m.position.set(o.at[0], o.at[1], o.at[2]); if (o.sc) m.scale.setScalar(o.sc); m.visible = false; scene.add(m);
  if (key === 'title') m.material.uniforms.uCtr.value.set(0, -1, 0); if (REDUCED) m.material.uniforms.uSlow.value = 2;
  const d = { m, t: 0, k: -1, extra: null, key, D: o.D, n: o.D.vox.length };
  if (key === 'eden') d.extra = edenExtras(o.D, o.at); else if (key === 'j') d.extra = jExtras(o.D, o.at); else if (key === 'about') d.extra = aboutExtras(o.at);
  if (d.extra) for (const x of [d.extra.m, d.extra.m2]) if (x) x.visible = false;
  return CINE.built[key] = d;
}
function prebuildStep(){ if (!CINE.pre.length) return; const k = CINE.pre.shift(); if (k === 'compile'){ const vis = []; for (const key in CINE.built){ const d = CINE.built[key]; for (const x of [d.m, d.extra && d.extra.m, d.extra && d.extra.m2]) if (x){ vis.push([x, x.visible]); x.visible = true; } } renderer.compile(scene, camera); for (const [x, v] of vis) x.visible = v; return; } if (k === 'motes'){ buildMotes(); return; } prebuildOne(k); }
function startCine(){
  if (CINE.on || !glOK || !ENGINE || !(state === 'play' || state === 'journal' || state === 'pause')) return;
  if (PL.catching){ CINE.queued = true; return; }
  CINE.queued = false; CINE.saved = snapshotPlayer(); CINE.on = true; CINE.ending = false; CINE.blend = -1; CINE.paused = false;
  clearInput(); if (avatar) avatar.visible = false; if (sailRig) sailRig.grp.visible = false; if (hand) hand.visible = false; if (halos) halos.visible = false; ENGINE.wake = .12;
  buildShots(); postBuild();
  CINE.f = { focus: 20, range: 20, tilt: .5, band: .5, bars: 0, bloom: .8, fade: 1, whip: 0, ray: new THREE.Vector3(), lift: new THREE.Vector3(), gain: new THREE.Vector3(1, 1, 1), sat: 1, white: 0, wipe: -1 };
  CINE.dio = {}; CINE.built = {}; CINE.pre = ['title', 'isles', 'eden', 'j', 'about', 'motes', 'compile']; CINE.shot = -1; CINE.st = 0; CINE.t = 0; CINE.events = new Set(); CINE.prev = null; CINE.maxDt = 0; CINE.hintGone = false;
  setState('cine'); $('#cine').hidden = false; $('#cine').classList.add('on'); $('#cineHint').classList.remove('gone'); cineCap(null);
  SND.score('start'); goShot(0);
  storySeen = true; saveDirty = true;
}
function goShot(i, skipBlend){
  if (i >= SHOTS.length) i = SHOTS.length - 1;
  const prev = CINE.shot >= 0 ? SHOTS[CINE.shot] : null, prevBeat = prev ? prev.beat : null, s = SHOTS[i];
  // remember where the outgoing camera was going, so a oner can carry its motion into the next path
  CINE.prev = prev && !skipBlend && s.tin === 'oner' ? { s: prev, st: CINE.st, p: camera.position.clone(), l: CINE.look ? CINE.look.clone() : null, fov: camera.fov, vel: CINE.vel ? CINE.vel.clone() : new THREE.Vector3(), lvel: CINE.lvel ? CINE.lvel.clone() : new THREE.Vector3() } : null;
  CINE.shot = i; CINE.st = 0; CINE.sfxDone = false; if (!CINE.prev) CINE.noVel = 2;
  if (s.day !== undefined && (s.tin !== 'oner' || !CINE.prev)) dayT = s.day % 1;
  CINE.dayFrom = dayT;
  if (s.beat !== prevBeat){ SND.score(s.beat); if (prevBeat && !CINE.hintGone){ CINE.hintGone = true; $('#cineHint').classList.add('gone'); } }
  if (s.sfx && !s.sfxAt) SND.cineSfx(s.sfx);
  if (!s.evAt) cineEvent(s.ev);
  cineCap(s.cap || null, s);
  if (s.tin === 'wipe') CINE.f.wipe = 0;
  if (REDUCED && s.tin !== 'oner') CINE.f.fade = Math.max(CINE.f.fade, .9);
  CINE.capHold = false;
  const lbl = $('#cineBeat'); if (lbl) lbl.textContent = { wake: 'The Memory Engine', title: 'Title', eden: 'Eden', j: 'J: Rising Founder', about: 'About', contact: 'Contact' }[s.beat];
}
function cineEvent(ev){
  if (!ev || CINE.events.has(ev + CINE.shot)) return; CINE.events.add(ev + CINE.shot);
  const show = key => { if (CINE.dio[key]) return CINE.dio[key]; const d = prebuildOne(key); d.m.visible = true; d.m.material.uniforms.uB.value = 0; d.t = 0; if (d.extra) for (const x of [d.extra.m, d.extra.m2]) if (x) x.visible = true; CINE.dio[key] = d; SND.voxBuild(d.n); return d; };
  if (ev === 'bands' || ev === 'ignite'){ ENGINE.wake = Math.max(ENGINE.wake || 0, ev === 'ignite' ? 1 : .6); SND.cineSfx('arp'); }
  else if (ev === 'title'){ show('title'); show('isles'); }
  else if (ev === 'titleOut'){ crumble('title'); crumble('isles'); }
  else if (ev === 'eden') show('eden');
  else if (ev === 'roots' || ev === 'cubes'){ const d = CINE.dio.eden; if (d && d.extra) d.extra.mode = ev === 'cubes' ? 2 : 1; }
  else if (ev === 'edenOut') crumble('eden');
  else if (ev === 'j') show('j');
  else if (ev === 'lanterns'){ if (CINE.dio.j) CINE.dio.j.glowTo = 1.35; }
  else if (ev === 'pillars'){ const d = CINE.dio.j; if (d) d.pillarT = 0; }
  else if (ev === 'launch'){ const d = CINE.dio.j; if (d && d.extra) d.extra.launch = 0; }
  else if (ev === 'jOut') crumble('j');
  else if (ev === 'about') show('about');
  else if (ev === 'aboutOut') crumble('about');
  else if (ev === 'card') showEndCard();
}
function disposeDio(d){ for (const m of [d.m, d.extra && d.extra.m, d.extra && d.extra.m2]){ if (!m) continue; scene.remove(m); m.geometry.dispose(); m.material.dispose(); } }
function crumble(key){ const d = CINE.dio[key]; if (!d || d.k >= 0) return; d.k = 0; SND.voxCrumble(); }
function jPillarClock(d, st){ const m = Math.min(2, Math.floor(st / 1.5)), into = st - m * 1.5; return 100 + m * 10 + Math.min(1.5, into) * 8; }
function edenExtras(D, at){
  const n = D.agents.length * 3, g = new THREE.BoxGeometry(.32, .32, .32), col = new Float32Array(g.attributes.position.count * 3).fill(1); g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  const m = new THREE.InstancedMesh(g, litMat({ emis: 1, rim: .5 }), n); m.frustumCulled = false; scene.add(m); for (let i = 0; i < n; i++) m.setColorAt(i, _col.setRGB(.7, 1, 1.1));
  return { m, agents: D.agents, at, mode: 0, t: 0 };
}
function jExtras(D, at){
  const g = boxGeo([[-.08, .22, 0, .12, .44, .14, [.25, .24, .3]], [.08, .22, 0, .12, .44, .14, [.25, .24, .3]], [0, .66, 0, .34, .46, .22, [.92, .9, .86]], [0, 1.04, 0, .28, .28, .28, [.78, .58, .45]], [0, 1.2, 0, .3, .08, .3, [.2, .15, .13]]]);
  const m = new THREE.InstancedMesh(g, litMat({ rim: .7 }), 6); m.frustumCulled = false; scene.add(m);
  const tints = [[1, .55, .45], [.5, .75, 1], [.6, .9, .55], [1, .82, .4], [.85, .6, 1], [.45, .9, .9]]; for (let i = 0; i < 6; i++) m.setColorAt(i, _col.setRGB(...tints[i]));
  const sg = boxGeo([[0, 1.75, .05, 1.5, .08, .56, [1, .84, .42]], [-.7, 1.62, .05, .12, .2, .56, [1, .7, .3]], [.7, 1.62, .05, .12, .2, .56, [1, .7, .3]]]);
  const m2 = new THREE.InstancedMesh(sg, litMat({ rim: .6, emis: .25 }), 6); m2.frustumCulled = false; scene.add(m2);
  return { m, m2, at, launch: -1, t: 0 };
}
function aboutExtras(at){ // petals drifting down from the blossom trees
  const n = 40, g = boxGeo([[0, 0, 0, .16, .04, .12, [1, .78, .84]]]), m = new THREE.InstancedMesh(g, litMat({ rim: .4, emis: .15 }), n); m.frustumCulled = false; scene.add(m);
  const P = []; for (let i = 0; i < n; i++) P.push({ x: (h2(i, 61) - .5) * 10, y: 3 + h2(i, 62) * 6, z: (h2(i, 63) - .5) * 10, s: .5 + h2(i, 64) * .6, p: h2(i, 65) * 6 });
  return { m, at, petals: P, t: 0, petal: 1 };
}
/* foreground parallax: warm motes drifting close to the lens (the depth of field turns them into soft bokeh) */
let MOTES = null;
function buildMotes(){ if (MOTES) return; const n = LOW ? 24 : 48, g = boxGeo([[0, 0, 0, .07, .07, .07, [1, .9, .7]]]), m = new THREE.InstancedMesh(g, litMat({ emis: 1, rim: .2 }), n); m.frustumCulled = false; m.visible = false; scene.add(m);
  const P = []; for (let i = 0; i < n; i++) P.push([h2(i, 71), h2(i, 72), h2(i, 73), .3 + h2(i, 74) * .7]); MOTES = { m, P }; }
function updateMotes(t){ if (!MOTES) return; const m = MOTES.m, on = CINE.on && !REDUCED; m.visible = on; if (!on) return; const cp = camera.position, B = 9;
  MOTES.P.forEach((q, i) => { const x = ((q[0] * B * 2 + t * .25 * q[3] - cp.x) % (B * 2) + B * 2) % (B * 2) - B, y = ((q[1] * B * 2 + Math.sin(t * .4 + i) * .5 - cp.y) % (B * 2) + B * 2) % (B * 2) - B, z = ((q[2] * B * 2 - t * .18 - cp.z) % (B * 2) + B * 2) % (B * 2) - B;
    _m0.makeScale(q[3], q[3], q[3]); _m0.setPosition(cp.x + x, cp.y + y, cp.z + z); m.setMatrixAt(i, _m0); }); m.instanceMatrix.needsUpdate = true; }
function updateExtras(dt){
  const e = CINE.dio.eden && CINE.dio.eden.extra; if (e){ e.t += dt; const m = e.m; let i = 0;
    for (let a = 0; a < e.agents.length; a++) for (let k = 0; k < 3; k++, i++){ const [ax, az] = e.agents[a]; const u = e.mode >= 2 ? ((e.t * .5 + k / 3 + a * .13) % 1) : 0;
      const vis = e.mode >= 2 && CINE.dio.eden.k < 0; const x = e.at[0] + ax * u + .5, y = e.at[1] + 1.6 + Math.sin(u * Math.PI) * .6, z = e.at[2] + az * u + .5;
      _m0.makeRotationY(e.t * 2 + i); _m0.scale(_sv.set(vis ? 1 : .001, vis ? 1 : .001, vis ? 1 : .001)); _m0.setPosition(x, y, z); m.setMatrixAt(i, _m0); }
    m.instanceMatrix.needsUpdate = true; }
  const j = CINE.dio.j && CINE.dio.j.extra; if (j){ const m = j.m; if (j.launch >= 0) j.launch += dt;
    for (let i = 0; i < 6; i++){ const L = j.launch < 0 ? 0 : clamp(j.launch * .9 - i * .28, 0, 5);
      let x = j.at[0] + 4 + i * 1.1, y = j.at[1] + 1, z = j.at[2] + (i % 2 ? .8 : -.8);
      if (L > 0){ const run = Math.min(1, L * 1.4); x += run * (16 - i * 1.1); y += run * 1.8; if (L > .7){ const f = L - .7; x += f * 8; z += Math.sin(f * 1.3 + i) * 1.6 * f; y += 2.2 + Math.sin(f * 2.1 + i) * .6 + f * .9; } }
      const vis = CINE.dio.j.k < 0 && (CINE.shot >= 13 || j.launch >= 0), so = vis ? clamp((L - .6) * 4, 0, 1) : 0, bank = L > .7 ? Math.sin((L - .7) * 1.3 + i) * .25 : 0, bob = L > 0 && L < .7 ? Math.abs(Math.sin(L * 22 + i)) * .12 : 0;
      _eu.set(bank, -Math.PI / 2, 0); _m0.makeRotationFromEuler(_eu); _m0.scale(_sv.set(vis ? 1 : .001, vis ? 1 : .001, vis ? 1 : .001)); _m0.setPosition(x, y + bob, z); m.setMatrixAt(i, _m0);
      _m0.makeRotationFromEuler(_eu); _m0.scale(_sv.set(Math.max(.001, so), Math.max(.001, so), Math.max(.001, so))); _m0.setPosition(x, y + bob + (1 - so) * 1.2, z); j.m2.setMatrixAt(i, _m0); }
    m.instanceMatrix.needsUpdate = true; j.m2.instanceMatrix.needsUpdate = true; }
  const ab = CINE.dio.about && CINE.dio.about.extra; if (ab){ ab.t += dt; const vis = CINE.dio.about.k < 0 && CINE.dio.about.t > 1.2;
    ab.petals.forEach((p, i) => { const fall = (ab.t * .45 * p.s + p.p) % 1, y = ab.at[1] + p.y + 3 - fall * 9, x = ab.at[0] + p.x + Math.sin(ab.t * 1.3 + p.p) * .6, z = ab.at[2] + p.z + Math.cos(ab.t * 1.1 + p.p) * .5;
      _eu.set(ab.t * 2 + i, ab.t * 1.3, ab.t + p.p); _m0.makeRotationFromEuler(_eu); const s = vis ? 1 : .001; _m0.scale(_sv.set(s, s, s)); _m0.setPosition(x, y, z); ab.m.setMatrixAt(i, _m0); }); ab.m.instanceMatrix.needsUpdate = true; }
}
const _cp = glOK ? new THREE.Vector3() : null, _cl = glOK ? new THREE.Vector3() : null, _rp = glOK ? new THREE.Vector3() : null, _tg = glOK ? new THREE.Vector3() : null;
// easing keeps velocity through the joins: a little smoothing, never a stop (except the film's first move and the whip)
function cineEase(s, u){ if (s.ease === 'whip') return u < .5 ? 16 * u * u * u * u * u : 1 - Math.pow(-2 * u + 2, 5) / 2; if (s.lin) return u * .8 + u * u * (3 - 2 * u) * .2; if (s.easeIn) return u * u * (3 - 2 * u) * .5 + u * .5; return u * .72 + EZ.inOutSine(u) * .28; }
function shotPose(s, st, P, L){ const u = clamp(st / s.dur, 0, 1), e = cineEase(s, u); s.pc.getPoint(e, P); s.lc.getPoint(e, L); }
function stepCine(dt){
  if (!CINE.on) return;
  CINE.maxDt = Math.max(CINE.maxDt, dt);
  prebuildStep();
  if (CINE.blend >= 0){ cineBlendBack(dt); updateMotes(tAcc); return; }
  if (!CINE.paused) CINE.st += dt;
  const s = SHOTS[CINE.shot], F = CINE.f, nx = SHOTS[CINE.shot + 1];
  if (s.evAt && CINE.st >= s.evAt) cineEvent(s.ev);
  if (s.sfxAt !== undefined && !CINE.sfxDone && CINE.st >= s.sfxAt){ CINE.sfxDone = true; SND.cineSfx(s.sfx); }
  CINE.capHold = !!(nx && nx.tin === 'wipe' && CINE.st > s.dur - .15);
  if (CINE.st >= s.dur && !CINE.ending){ if (CINE.shot < SHOTS.length - 1){ goShot(CINE.shot + 1); return stepCine(0); } }
  const u = REDUCED ? .5 : clamp(CINE.st / s.dur, 0, 1);
  shotPose(s, REDUCED ? s.dur * .5 : CINE.st, _cp, _cl);
  let fov = s.fov;
  // a oner: carry the outgoing camera's motion forward and blend it into this path over 1.2 s
  const PV = CINE.prev; if (PV && !REDUCED){ const tb = 1.2, w = clamp(CINE.st / tb, 0, 1), k = w * w * w * (w * (w * 6 - 15) + 10);
    if (k < 1){ const ox = PV.p.x + PV.vel.x * CINE.st * (1 - k * .5), oy = PV.p.y + PV.vel.y * CINE.st * (1 - k * .5), oz = PV.p.z + PV.vel.z * CINE.st * (1 - k * .5); _cp.set(lerp(ox, _cp.x, k), lerp(oy, _cp.y, k), lerp(oz, _cp.z, k));
      if (PV.l){ const lx = PV.l.x + PV.lvel.x * CINE.st, ly = PV.l.y + PV.lvel.y * CINE.st, lz = PV.l.z + PV.lvel.z * CINE.st; _cl.set(lerp(lx, _cl.x, k), lerp(ly, _cl.y, k), lerp(lz, _cl.z, k)); }
      fov = lerp(PV.fov, s.fov, k); } else CINE.prev = null; }
  // handheld drift
  const hd = REDUCED ? 0 : .05; _cp.x += (noise1(tAcc * .35, 1) - .5) * hd; _cp.y += (noise1(tAcc * .3, 2) - .5) * hd; _cp.z += (noise1(tAcc * .33, 3) - .5) * hd;
  if (CINE.noVel > 0 && dt > 0){ CINE.noVel--; if (!CINE.vel) CINE.vel = new THREE.Vector3(), CINE.lvel = new THREE.Vector3(), CINE.look = new THREE.Vector3(); CINE.vel.set(0, 0, 0); CINE.lvel.set(0, 0, 0); }
  else if (dt > 0){ if (!CINE.vel) CINE.vel = new THREE.Vector3(), CINE.lvel = new THREE.Vector3(), CINE.look = new THREE.Vector3(); const a = Math.min(1, dt * 8);
    CINE.vel.x += ((_cp.x - camera.position.x) / dt - CINE.vel.x) * a; CINE.vel.y += ((_cp.y - camera.position.y) / dt - CINE.vel.y) * a; CINE.vel.z += ((_cp.z - camera.position.z) / dt - CINE.vel.z) * a;
    CINE.lvel.x += ((_cl.x - CINE.look.x) / dt - CINE.lvel.x) * a; CINE.lvel.y += ((_cl.y - CINE.look.y) / dt - CINE.lvel.y) * a; CINE.lvel.z += ((_cl.z - CINE.look.z) / dt - CINE.lvel.z) * a;
    if (CINE.vel.length() > 60) CINE.vel.setLength(60); if (CINE.lvel.length() > 80) CINE.lvel.setLength(80); }
  if (CINE.look) CINE.look.copy(_cl);
  camera.position.copy(_cp); camera.lookAt(_cl); camera.rotation.z += REDUCED ? 0 : (noise1(tAcc * .2, 4) - .5) * .006;
  const near = s.near || .08; if (camera.near !== near){ camera.near = near; camera.updateProjectionMatrix(); }
  const asp = innerWidth / innerHeight, fv = asp < 1.6 ? Math.min(105, 2 * Math.atan(Math.tan(fov * Math.PI / 360) * 1.78 / asp) * 180 / Math.PI) : fov;
  if (Math.abs(camera.fov - fv) > .01){ camera.fov = fv; camera.updateProjectionMatrix(); }
  // time of day: glide toward this shot's light instead of jumping
  if (s.dayTo !== undefined) dayT = (lerp(s.day, s.dayTo, u) + 1) % 1; else if (s.day !== undefined){ let d0 = CINE.dayFrom, d1 = s.day; if (d1 - d0 > .5) d0 += 1; else if (d0 - d1 > .5) d1 += 1; dayT = (lerp(d0, d1, sstep(0, 1.4, CINE.st)) + 1) % 1; }
  const fd = s.rack ? lerp(s.rack[0], s.rack[1], sstep(.25, .75, u)) : _cp.distanceTo(_cl);
  F.focus += (fd - F.focus) * Math.min(1, dt * 4 + (CINE.st < .05 && !CINE.prev ? 1 : 0)); F.range += (s.range - F.range) * Math.min(1, dt * 3); F.tilt += (s.tilt * (REDUCED ? .5 : 1) * (asp < 1 ? .45 : 1) - F.tilt) * Math.min(1, dt * 2); F.band = .5;
  F.whip = s.whip ? Math.sin(Math.PI * u) * (REDUCED ? 0 : 1) : (s.tin === 'whip' ? Math.max(0, 1 - CINE.st / .25) * (REDUCED ? 0 : .6) : 0);
  F.bars += ((CINE.ending ? .0 : 1) - F.bars) * Math.min(1, dt * 2.5);
  F.fade = Math.max(0, F.fade - dt * (REDUCED ? 1.6 : 1.4)); if (CINE.pre.length) F.fade = Math.max(F.fade, .999);
  // transitions: light-bloom white and voxel wipe
  let wh = 0; if (s.tout === 'bloom') wh = Math.max(wh, sstep(s.dur - .7, s.dur, CINE.st)); if (s.tin === 'bloom') wh = Math.max(wh, 1 - sstep(0, .9, CINE.st)); F.white = REDUCED ? wh * .5 : wh;
  if (F.wipe >= 0){ F.wipe += dt / (REDUCED ? .5 : .9); if (F.wipe > 1.05) F.wipe = -1; }
  // grade: blend toward this beat's look over ~1.2 s
  const G = GRADES[s.beat], k = Math.min(1, dt * 1.5); F.lift.x += (G[0][0] - F.lift.x) * k; F.lift.y += (G[0][1] - F.lift.y) * k; F.lift.z += (G[0][2] - F.lift.z) * k; F.gain.x += (G[1][0] - F.gain.x) * k; F.gain.y += (G[1][1] - F.gain.y) * k; F.gain.z += (G[1][2] - F.gain.z) * k; F.sat += (G[2] - F.sat) * k;
  F.bloom += ((s.beat === 'wake' ? .55 : s.beat === 'contact' ? .4 : .45) * (asp < 1 ? .6 : 1) - F.bloom) * Math.min(1, dt * 2);
  let rs = 0; if (s.ray){ if (s.ray === 'sun') _rp.copy(U.uSunDir.value).multiplyScalar(400).add(camera.position); else if (s.ray === 'eden') _rp.set(anchors().eden[0], anchors().eden[1] + 10, anchors().eden[2]); else _rp.set(ENGINE.x, ENGINE.core, ENGINE.z);
    _rp.project(camera); if (_rp.z < 1){ rs = (1 - sstep(.8, 1.4, Math.max(Math.abs(_rp.x), Math.abs(_rp.y)))) * (s.ray === 'sun' ? .55 : .8) * (asp < 1 ? .5 : 1); } F.ray.set(_rp.x * .5 + .5, _rp.y * .5 + .5, F.ray.z + (rs - F.ray.z) * Math.min(1, dt * 3)); } else F.ray.z = Math.max(0, F.ray.z - dt * 2);
  for (const key in CINE.dio){ const d = CINE.dio[key], uu = d.m.material.uniforms; d.t += dt;
    if (key === 'j' && d.pillarT !== undefined){ d.pillarT += dt; uu.uB.value = Math.max(uu.uB.value, jPillarClock(d, d.pillarT)); if (d.pillarT > .05 && Math.floor(d.pillarT / 1.5) !== d.lastM && d.pillarT < 4.4){ d.lastM = Math.floor(d.pillarT / 1.5); SND.cineHit(.6); monthCap(d.lastM); } }
    else if (uu.uB.value < 50) uu.uB.value = d.t;
    if (d.glowTo) uu.uGlow.value += (d.glowTo - uu.uGlow.value) * Math.min(1, dt * 2);
    if (key === 'isles'){ d.m.rotation.y += dt * (.12 + .25 * Math.max(0, 1 - d.t / 3)); }
    if (d.k >= 0){ d.k += dt; uu.uK.value = d.k; if (d.k > 3.4){ disposeDio(d); delete CINE.dio[key]; delete CINE.built[key]; } }
    else if (d.t < 3 && Math.floor(d.t * 14) !== d.tick && key !== 'isles'){ d.tick = Math.floor(d.t * 14); SND.voxClick(d.tick); } }
  updateExtras(dt); updateMotes(tAcc);
  if (ENGINE.wake) ENGINE.wake = Math.min(1, ENGINE.wake + dt * .4);
}
/* ---- captions: kinetic type on solid plates; the outgoing plate fades while the next one types in ---- */
function kinetic(el, txt){ el.textContent = ''; const words = txt.split(' '); let i = 0; words.forEach((w, wi) => { const ws = D.createElement('span'); ws.className = 'kw'; for (const ch of w){ const s = D.createElement('span'); s.className = 'kl'; s.textContent = ch; s.style.transitionDelay = (REDUCED ? 0 : 250 + i * 22) + 'ms'; ws.appendChild(s); i++; } el.appendChild(ws); if (wi < words.length - 1) el.appendChild(D.createTextNode(' ')); }); requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in'))); }
function cineCap(c){
  const box = $('#cineCap');
  if (box.classList.contains('show') && box.firstChild){ const g = box.cloneNode(true); g.removeAttribute('id'); g.removeAttribute('role'); g.removeAttribute('aria-live'); g.setAttribute('aria-hidden', 'true'); g.classList.add('ghost'); box.parentNode.insertBefore(g, box); requestAnimationFrame(() => g.classList.remove('show')); setTimeout(() => g.remove(), 900); }
  box.className = 'cinecap'; box.innerHTML = ''; if (!c) return; SND.capDuck();
  if (c.k === 'lower'){ box.classList.add('cc-lower'); box.innerHTML = '<div class="plate"><span class="ck"></span><span class="ct"></span><span class="cs"></span></div>'; box.querySelector('.ck').textContent = c.a; kinetic(box.querySelector('.ct'), c.b); }
  else if (c.k === 'months'){ box.classList.add('cc-months'); box.innerHTML = '<div class="plate"><span class="ct"></span></div>'; }
  else { box.classList.add('cc-' + c.k); box.innerHTML = '<div class="plate"><span class="ct"></span></div>'; kinetic(box.querySelector('.ct'), c.t); }
  requestAnimationFrame(() => box.classList.add('show'));
}
function monthCap(m){ const box = $('#cineCap'); if (!box.classList.contains('cc-months')) return; const ct = box.querySelector('.ct'); kinetic(ct, m < 2 ? 'Month ' + (m + 1) : 'Month 3 · Free · Remote · Three months'); }
/* ---- end card, controls, restore ---- */
function showEndCard(){ if (CINE.ending) return; CINE.ending = true; cineCap(null); SND.score('end'); setTimeout(() => { if (CINE.on && state === 'cine' && CINE.ending){ $('#cine').classList.remove('on'); openPanel('end'); } }, REDUCED ? 100 : 900); }
function cineSkip(){ if (!CINE.on || CINE.blend >= 0) return; if (CINE.ending){ return; } for (const k in CINE.dio) crumble(k); CINE.f.white = 0; goShot(SHOTS.length - 1, true); CINE.st = 2.4; CINE.f.fade = .8; SND.cineSfx('whoosh'); }
function cineNext(){ if (!CINE.on || CINE.ending || CINE.blend >= 0) return; const b = BEATS.indexOf(SHOTS[CINE.shot].beat); if (b >= BEATS.length - 1){ cineSkip(); return; } const nx = beatStart(BEATS[b + 1]); for (const k in CINE.dio) crumble(k); CINE.f.fade = Math.max(CINE.f.fade, .7); goShot(nx, true); }
function cinePause(on){ if (!CINE.on) return; CINE.paused = on === undefined ? !CINE.paused : on; $('#cinePause').textContent = CINE.paused ? 'Resume' : 'Pause'; $('#cinePause').setAttribute('aria-pressed', CINE.paused ? 'true' : 'false'); }
function endCardClosed(gesture){ if (!CINE.on) return; setState('cine'); if (gesture) requestLock(); CINE.blend = 0; CINE.from = { p: camera.position.clone(), q: camera.quaternion.clone(), fov: camera.fov }; $('#cine').classList.remove('on'); if (!GEAR.sail) SND.gift(); }
function cineBlendBack(dt){
  CINE.blend += dt / (REDUCED ? .5 : 1.6); const u = EZ.inOutSine(clamp(CINE.blend, 0, 1)), S = CINE.saved;
  const to = new THREE.Vector3(S.x, S.y + 1.62, S.z), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(S.pitch, S.yaw, 0, 'YXZ'));
  camera.position.lerpVectors(CINE.from.p, to, u); camera.quaternion.slerpQuaternions(CINE.from.q, q, u); camera.fov = lerp(CINE.from.fov, S.fov || 72, u); if (camera.near !== .08) camera.near = .08; camera.updateProjectionMatrix();
  dayT = lerp(dayT, S.dayT, Math.min(1, dt * 3));
  if (POST){ const F = CINE.f; F.bars = Math.max(0, F.bars - dt * 1.5); F.white = 0; F.wipe = -1; F.tilt *= .96; F.range += (200 - F.range) * Math.min(1, dt); }
  if (CINE.blend >= 1) endCine();
}
function endCine(){
  const S = CINE.saved; if (!S) return;
  for (const k in CINE.built){ const d = CINE.built[k]; disposeDio(d); } CINE.dio = {}; CINE.built = {}; CINE.pre = [];
  if (MOTES){ scene.remove(MOTES.m); MOTES.m.geometry.dispose(); MOTES.m.material.dispose(); MOTES = null; }
  postDispose(); CINE.on = false; CINE.blend = -1; CINE.ending = false;
  Object.assign(PL, { x: S.x, y: S.y, z: S.z, px: S.px, py: S.py, pz: S.pz, vx: S.vx, vy: S.vy, vz: S.vz, yaw: S.yaw, pitch: S.pitch, onGround: S.onGround, wasGround: S.wasGround, air: S.air, gliding: S.gliding, sailOpen: S.sailOpen, gs: S.gs, flaps: S.flaps, stall: S.stall, glideLock: S.glideLock, coyote: S.coyote, dashCD: S.dashCD, slideT: S.slideT });
  dayT = S.dayT; HR.sailO = S.sailO; camera.rotation.order = 'YXZ'; camera.fov = S.fov; camera.near = .08; camera.updateProjectionMatrix();
  $('#cine').hidden = true; cineCap(null); SND.score('stop');
  ENGINE.wake = .35; if (halos) halos.visible = true;
  setState('play'); updateHand();
  giftSail();
}
function cineRender(){ if (POST) postRender(); else renderer.render(scene, camera); }
let storySeen = false;

/* ---- the Memory Engine's moving parts: three brass rings around a floating crystal core ---- */
let engineGrp = null;
function buildEngine(){
  if (!ENGINE || !glOK) return;
  engineGrp = new THREE.Group(); engineGrp.position.set(ENGINE.x, ENGINE.core, ENGINE.z);
  const tint = (g, c) => { const a = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < a.length; i += 3){ a[i] = c[0]; a[i + 1] = c[1]; a[i + 2] = c[2]; } g.setAttribute('aCol', new THREE.BufferAttribute(a, 3)); return g; };
  const brass = litMat({ rim: .55 }), rings = [];
  [[2.4, .16, [.78, .58, .3]], [3.1, .14, [.7, .5, .26]], [3.8, .12, [.82, .64, .36]]].forEach(([r, w, c], i) => {
    const g = tint(new THREE.TorusGeometry(r, w, 4, 20 + i * 4), c); const m = new THREE.Mesh(g, brass); const piv = new THREE.Group(); piv.add(m);
    // a few studs (gems) riding each ring
    const sg = boxGeo([0, 1, 2, 3].map(k => { const a = k / 4 * Math.PI * 2 + i; return [Math.cos(a) * r, Math.sin(a) * r, 0, .34, .34, .34, [.6, .95, 1]]; })); const st = new THREE.Mesh(sg, litMat({ emis: .9, rim: .5 })); m.add(st);
    engineGrp.add(piv); rings.push({ piv, m, st });
  });
  const coreG = boxGeo([[0, 0, 0, 1.3, 1.3, 1.3, [.7, .95, 1.05]], [0, 0, 0, .7, 1.9, .7, [.85, 1, 1.1]], [0, 0, 0, 1.9, .7, .7, [.85, 1, 1.1]], [0, 0, 0, .7, .7, 1.9, [.85, 1, 1.1]]]);
  const core = new THREE.Mesh(coreG, litMat({ emis: .7, rim: .8 }));
  engineGrp.add(core); engineGrp.userData = { rings, core };
  scene.add(engineGrp); ENGINE.wake = storySeen ? .35 : .12; ENGINE.spin = 0;
}
function updateEngine(t, dt){
  if (!engineGrp) return;
  const far = hyp2(camera.position.x - ENGINE.x, camera.position.z - ENGINE.z) > 220; engineGrp.visible = !far; if (far) return;
  const w = ENGINE.wake || 0, R = engineGrp.userData.rings, k = REDUCED ? .35 : 1;
  ENGINE.spin += dt * (.18 + w * 1.1) * k;
  engineGrp.position.y = ENGINE.core + Math.sin(t * .8) * .18 * k;
  R.forEach((r, i) => { const open = .4 + w * .5; r.piv.rotation.set(i === 0 ? Math.PI / 2 : open * (i === 1 ? 1 : -1), ENGINE.spin * (i === 1 ? -1 : 1) * (1 + i * .3), 0); r.m.rotation.z = ENGINE.spin * (1.2 - i * .25); });
  const C = engineGrp.userData.core; C.rotation.set(t * .3, t * (.4 + w * .8) * k, t * .2); C.scale.setScalar(.8 + w * .4 + Math.sin(t * 2.2) * .04 * w);
  C.material.uniforms.uEmis.value = .45 + w * .55 + Math.sin(t * 1.7) * .08;
}
function cineReplay(){
  if (!CINE.on){ startCine(); return; }
  for (const k in CINE.built){ disposeDio(CINE.built[k]); } CINE.dio = {}; CINE.built = {}; CINE.pre = ['title', 'isles', 'eden', 'j', 'about', 'compile'];
  CINE.ending = false; CINE.blend = -1; CINE.paused = false; CINE.events = new Set(); CINE.shot = -1; CINE.prev = null; CINE.f.fade = 1; ENGINE.wake = .12;
  setState('cine'); $('#cine').classList.add('on'); SND.score('start'); goShot(0);
}
