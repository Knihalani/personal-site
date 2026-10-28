<script>
(function(){
'use strict';
/* =====================================================================
   KAIAV WORLD: DESIGN DOC
   Audience: people visiting Kaiav's site for 1 to 10 minutes. Every mechanic must be
   understood in seconds and must pull the visitor toward the story.

   CORE LOOP
   Land on Home Isle -> walk to the Memory Engine and press E -> watch the film (Eden, J,
   About, Contact; skippable, replayable) -> take the sky sail -> glide on updrafts to the
   inner islets, collect sky relics, befriend a creature -> beyond the banner buoys, the
   procedurally generated Wilds: ruins, enemies, chests, weapons. The journal fills; all
   relics light the sky festival. Mining and building stay, but they serve exploration.

   MECHANICS (tuning)
   1 Falling never punishes. Last safe ground = grounded, all four footprint corners
     supported, not in water, stable for 0.5 s. Below y=12 a sky jelly scoops you up:
     1.25 s eased arc (camera pulls back to show it), set down on the safe spot facing
     the same way. If that spot was mined away: nearest supported cell within 8, else home.
   2 Sky sail. Found on the plaza stand (also craftable). Press Space in mid-air (or hold it through a jump) to
     glide: forward 7.6 m/s (+6 per radian of dive), sink 1.3 m/s, steer by looking.
     Updraft columns (r 4.5) lift at up to 14 m/s, two per gap beside every bridge,
     plus launch drafts. Shown as rising square motes.
   3 Vineseed. Use it to grow a 1-wide living vine bridge from your feet along the look
     direction (8-way), one block every 55 ms, dropping one block every 8, max 24, stops at
     any obstacle or missing headroom. Vines are mineable and drop nothing.
   4 Companions (max one). Feed a puffle a flower bun or a kit a kit biscuit:
     puffle = a bounce pad (19.5 m/s, about 6 blocks); kit = trots ahead to the nearest
     unfound shard within 34 blocks, leaving paw prints. Companions path across islands
     and catch up by teleporting with a puff when more than 22 blocks behind.
     Cut: jelly slow-fall (the sail already does it), buried chests (too fiddly).
   5 Sky relics (the old lore shards, repurposed: the story now lives in the film). 12 relics,
     small flavour lines, no facts. Every 3 upgrade the sail; all -> sky festival and a golden sail.
     Journal (J): relics, the story (replay), islands, sail, the Wilds, ring course, companions.
   6 The Memory Engine. One landmark at the heart of home; its console starts the film (c1.js).
     Signposts and waystones are gone; a small welcome marker points the way.
   7 Day/night: ambience only (6 minute cycle). Cut: night secret, rest bench.
   8 Onboarding, one prompt at a time, each dismissable, remembered:
     look+move -> activate the Memory Engine -> take the sail -> glide to an islet -> gather -> craft.
     An objective pin points at the current target.
   9 Crafting: 8 purposeful recipes, click to make, ingredients shown with icons.
   10 Feel: fixed 120 Hz physics with interpolation, Quake-style ground accel/friction,
     coyote 0.1 s, jump buffer 0.12 s, eased step-up, landing dip, FOV ease on sprint,
     glide and bounce, envelope-shaped synth sounds, particles on every interaction.
   ===================================================================== */

const D = document, Wn = window;
const $ = s => D.querySelector(s);
const mm = q => { try { return matchMedia(q).matches; } catch (e) { return false; } };
const TOUCH = mm('(pointer: coarse)') || (navigator.maxTouchPoints > 0 && mm('(hover: none)'));
const SMALL = Math.min(innerWidth, innerHeight) < 600;
const LOW = TOUCH || SMALL;
const REDUCED = mm('(prefers-reduced-motion: reduce)');
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/* ================= noise ================= */
const NSEED = 9137;
function h2(x, z){ let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + NSEED) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
function h3(x, y, z){ let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 1103515245) + Math.imul(z | 0, 668265263) + NSEED) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
function vn(x, z){ const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi; const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = h2(xi, zi), b = h2(xi + 1, zi), c = h2(xi, zi + 1), d = h2(xi + 1, zi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
function fbm(x, z){ let s = 0, a = .5, f = 1; for (let i = 0; i < 4; i++){ s += a * vn(x * f, z * f); f *= 2.03; a *= .5; } return s / .9375; }
let rs = 12345; function rnd(){ rs |= 0; rs = rs + 0x6D2B79F5 | 0; let t = Math.imul(rs ^ rs >>> 15, 1 | rs); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }

/* ================= blocks ================= */
const TN = ['grassTop','grassSide','dirt','stone','sand','logSide','logTop','leaves','planks','glass','lantern','ore','cobble','bridge','step','sign',
  'ebark','eleaf','crystal','jstone','water','tgrass','rose','sunf','bell','gravel','brick','blossom','deep','moss','lanternTop','stepSide','jstoneTop','signTop','bridgeTop','vine','vineTop',
  'snowTop','snowSide','ice','redrock','redband','ash','basalt','ember','mycelTop','mycelSide','mstem','capRed','capBlue','ruin','ruinMoss','tent','deadBush','gshroom','frostLeaf',
  'roots','hvine','birchSide','birchTop','birchLeaf','fern','mushRed','autumn','pineLeaf'];
const T = {}; TN.forEach((n, i) => T[n] = i);
/* =====================================================================
   ART STYLE GUIDE (followed by every tile, icon, model and creature)
   ---------------------------------------------------------------------
   PIXELS     16 px tiles, 16 px item art (drawn 2x as 32 px icons), 12 px UI glyphs (2x as 24 px).
   LIGHT      always from the top-left: highlight on top/left edges of every form, shadow on bottom/right;
              block faces: top 1.0, west/north .86, east/south .7; models use the same key light.
   OUTLINE    icons and UI glyphs: a 1 px ink outline (#0e0d11) around the silhouette, never inside;
              terrain tiles have no outline, only darker crevices; 3D models get a rim light instead.
   RAMPS      every material is a 4-5 step ramp (shadow, mid, base, light, highlight), hue-shifted:
              shadows lean cool/purple, highlights lean warm/yellow. No pure black, no pure white.
   PALETTES   temperate  grass #5d7746..#a8c070, soil #6c5343..#a07e5e, stone #6f6a68..#b4ada4, bark #54402f..#8a6c50
              ruins      stone #77736d..#a8a297, moss #4f6943..#9cb478
              mesa       rock #8b4330..#d88b5c, bands #d8a072 / #b86d45, copper ore #4fb59a
              frost      snow #d4dde4..#f8fbfc, ice #86b2cd..#d8eef8, azure ore #5fa8ff
              grove      mycelium #6b5d77..#a597b2, caps #a63f38 / #3f8fa6, amethyst #b07ae0
              ash        ash #5f5a57..#8e8883, basalt #2f2d33..#5a5660, embers #f08a3c..#ffd27a
              accents    ochre #e0a83f (UI accent), rarity: #cbc3b4 #86d46f #6db3ff #c98cff #ffb84d
   PROPORTION creatures are chunky and big-headed (head ~45% of height), eyes 2 px with a 1 px catchlight;
              tools: handle 1/2 of the length, heads read in silhouette at 16 px.
   VARIATION  2-4 variants per common tile picked by a position hash; exposed tops grow moss/grass lips,
              frost biomes cap side faces with snow; leaves are alpha-cut.
   ===================================================================== */
const newTile = name => { T[name] = TN.length; TN.push(name); return T[name]; };
const TVAR = new Uint8Array(256).fill(1), TV0 = new Uint16Array(256), TEXP = new Uint16Array(256), TCAP = new Uint16Array(256), TFR = new Uint16Array(64);
['oreFrost', 'oreCopper', 'oreAmethyst', 'crystalRose', 'crystalFrost'].forEach(newTile);
const AIR=0, GRASS=1, DIRT=2, STONE=3, SAND=4, LOG=5, LEAVES=6, PLANKS=7, GLASS=8, LANTERN=9, ORE=10, COBBLE=11, BRIDGE=12, STEP=13, SIGN=14,
  EBARK=15, ELEAF=16, CRYSTAL=17, JSTONE=18, WATER=19, TGRASS=20, ROSE=21, SUNF=22, BELL=23, GRAVEL=24, BRICK=25, BLOSSOM=26, DEEP=27, MOSS=28, LAMP=29, PBRICK=30, VINE=31,
  SNOW=32, ICE=33, REDROCK=34, REDBAND=35, ASH=36, BASALT=37, EMBER=38, MYCEL=39, MSTEM=40, MCAPR=41, MCAPB=42, RUIN=43, RUINM=44, TENT=45, DEADB=46, GSHROOM=47, FROSTLEAF=48, CHEST=49,
  ROOTS=50, HVINE=51, BIRCH=52, BIRCHL=53, FERN=54, MUSHR=55, AUTUMN=56, PINEL=57, OREF=58, OREC=59, OREA=60, CRYR=61, CRYF=62;
const NB = 64;
const B_NAME = [], B_TOOL = [], B_SND = [];
const B_TILES = new Uint8Array(NB * 6), B_RT = new Uint8Array(NB), B_OPQ = new Uint8Array(NB), B_SOLID = new Uint8Array(NB), B_EMIT = new Uint8Array(NB),
  B_PROT = new Uint8Array(NB), B_HARD = new Float32Array(NB), B_DROP = new Uint8Array(NB), B_SWAY = new Uint8Array(NB), B_ICON = new Uint8Array(NB);
function def(id, name, tiles, rt, o){
  o = o || {};
  B_NAME[id] = name; B_RT[id] = rt;
  const t = typeof tiles === 'number' ? [tiles, tiles, tiles] : tiles; // [top, side, bottom]
  const top = t[0], side = t[1], bot = t[2] === undefined ? t[0] : t[2];
  const f = [side, side, top, bot, side, side];
  for (let i = 0; i < 6; i++) B_TILES[id * 6 + i] = f[i];
  B_ICON[id] = rt === 3 ? top : side;
  B_OPQ[id] = rt === 1 ? 1 : 0; B_SOLID[id] = (rt === 1 || rt === 2 || rt === 5) ? 1 : 0; // rt 5: solid but drawn by an entity (chests)
  B_EMIT[id] = o.emit || 0; B_PROT[id] = o.prot ? 1 : 0; B_HARD[id] = o.hard === undefined ? 1 : o.hard;
  B_DROP[id] = o.drop === undefined ? id : o.drop; B_TOOL[id] = o.tool || ''; B_SND[id] = o.snd || 'stone'; B_SWAY[id] = o.sway ? 1 : 0;
}
def(GRASS, 'Grass', [T.grassTop, T.grassSide, T.dirt], 1, { hard: .6, drop: DIRT, tool: 'shovel', snd: 'grass' });
def(DIRT, 'Dirt', T.dirt, 1, { hard: .5, tool: 'shovel', snd: 'grass' });
def(STONE, 'Stone', T.stone, 1, { hard: 1.6, drop: COBBLE, tool: 'pick' });
def(SAND, 'Sand', T.sand, 1, { hard: .5, tool: 'shovel', snd: 'sand' });
def(LOG, 'Log', [T.logTop, T.logSide], 1, { hard: .8, tool: 'axe', snd: 'wood' });
def(LEAVES, 'Leaves', T.leaves, 2, { hard: .25, tool: 'axe', snd: 'leaf', sway: 1 });
def(PLANKS, 'Planks', T.planks, 1, { hard: 1, tool: 'axe', snd: 'wood' });
def(GLASS, 'Glass', T.glass, 2, { hard: .35, snd: 'glass' });
def(LANTERN, 'Lantern', [T.lanternTop, T.lantern], 2, { hard: .3, emit: 12, snd: 'glass' });
def(ORE, 'Sunstone', T.ore, 1, { hard: 2, tool: 'pick', emit: 4 });
def(COBBLE, 'Cobblestone', T.cobble, 1, { hard: 1.5, tool: 'pick' });
def(BRIDGE, 'Bridge plank', [T.bridgeTop, T.bridge], 1, { prot: 1, snd: 'wood' });
def(STEP, 'Stepping stone', [T.step, T.stepSide], 1, { prot: 1 });
def(SIGN, 'Signpost', [T.signTop, T.sign], 1, { prot: 1, snd: 'wood' });
def(EBARK, 'Eden bark', T.ebark, 1, { prot: 1, snd: 'wood' });
def(ELEAF, 'Eden leaves', T.eleaf, 2, { prot: 1, emit: 6, snd: 'leaf', sway: 1 });
def(CRYSTAL, 'Crystal', T.crystal, 1, { prot: 1, emit: 9, snd: 'glass' });
def(JSTONE, 'Monument stone', [T.jstoneTop, T.jstone], 1, { prot: 1 });
def(WATER, 'Water', T.water, 4, { hard: 9e9 });
def(TGRASS, 'Tall grass', T.tgrass, 3, { hard: 0, drop: 0, snd: 'grass', sway: 1 });
def(ROSE, 'Rose', T.rose, 3, { hard: 0, snd: 'grass', sway: 1 });
def(SUNF, 'Buttercup', T.sunf, 3, { hard: 0, snd: 'grass', sway: 1 });
def(BELL, 'Bluebell', T.bell, 3, { hard: 0, snd: 'grass', sway: 1 });
def(GRAVEL, 'Gravel', T.gravel, 1, { hard: .6, tool: 'shovel', snd: 'sand' });
def(BRICK, 'Rose brick', T.brick, 1, { hard: 1.5, tool: 'pick' });
def(BLOSSOM, 'Blossom', T.blossom, 2, { hard: .25, tool: 'axe', snd: 'leaf', sway: 1 });
def(DEEP, 'Deepstone', T.deep, 1, { hard: 2, drop: COBBLE, tool: 'pick' });
def(MOSS, 'Mossy stone', T.moss, 1, { hard: 1.5, tool: 'pick' });
def(LAMP, 'Lamp', [T.lanternTop, T.lantern], 2, { prot: 1, emit: 12, snd: 'glass' });
def(PBRICK, 'Tower brick', T.brick, 1, { prot: 1 });
def(VINE, 'Vine', [T.vineTop, T.vine], 1, { hard: .3, drop: 0, snd: 'leaf' });
// ---- the Wilds (outer procedural islands)
def(SNOW, 'Snow', [T.snowTop, T.snowSide, T.dirt], 1, { hard: .5, tool: 'shovel', snd: 'sand' });
def(ICE, 'Ice', T.ice, 1, { hard: .5, snd: 'glass' });
def(REDROCK, 'Red rock', T.redrock, 1, { hard: 1.2, tool: 'pick' });
def(REDBAND, 'Banded rock', [T.redrock, T.redband], 1, { hard: 1.2, tool: 'pick' });
def(ASH, 'Ash', T.ash, 1, { hard: .5, tool: 'shovel', snd: 'sand' });
def(BASALT, 'Basalt', T.basalt, 1, { hard: 1.8, tool: 'pick' });
def(EMBER, 'Ember rock', T.ember, 1, { hard: 1.5, tool: 'pick', emit: 9 });
def(MYCEL, 'Mycelium', [T.mycelTop, T.mycelSide, T.dirt], 1, { hard: .6, drop: DIRT, tool: 'shovel', snd: 'grass' });
def(MSTEM, 'Mushroom stem', T.mstem, 1, { hard: .6, tool: 'axe', snd: 'wood' });
def(MCAPR, 'Red cap', T.capRed, 1, { hard: .3, snd: 'leaf' });
def(MCAPB, 'Glowcap', T.capBlue, 1, { hard: .3, snd: 'leaf', emit: 7 });
def(RUIN, 'Ruin brick', T.ruin, 1, { hard: 1.5, tool: 'pick' });
def(RUINM, 'Mossy ruin brick', T.ruinMoss, 1, { hard: 1.5, tool: 'pick' });
def(TENT, 'Tent cloth', T.tent, 1, { hard: .3, snd: 'leaf' });
def(DEADB, 'Dead bush', T.deadBush, 3, { hard: 0, drop: 100, snd: 'grass' });
def(GSHROOM, 'Glow shroom', T.gshroom, 3, { hard: 0, snd: 'grass', emit: 5 });
def(FROSTLEAF, 'Frosted needles', T.frostLeaf, 2, { hard: .25, tool: 'axe', snd: 'leaf', drop: LEAVES, sway: 1 });
def(CHEST, 'Chest', T.planks, 5, { prot: 1, snd: 'wood' });
// ---- richer islands: hanging roots and vines, more tree species, ferns, mushrooms
def(ROOTS, 'Hanging roots', T.roots, 3, { hard: 0, drop: 0, snd: 'grass', sway: 1 });
def(HVINE, 'Hanging vine', T.hvine, 3, { hard: 0, drop: 0, snd: 'leaf', sway: 1 });
def(BIRCH, 'Birch log', [T.birchTop, T.birchSide], 1, { hard: .8, tool: 'axe', snd: 'wood', drop: LOG });
def(BIRCHL, 'Birch leaves', T.birchLeaf, 2, { hard: .25, tool: 'axe', snd: 'leaf', sway: 1, drop: LEAVES });
def(FERN, 'Fern', T.fern, 3, { hard: 0, drop: 0, snd: 'grass', sway: 1 });
def(MUSHR, 'Red mushroom', T.mushRed, 3, { hard: 0, snd: 'grass' });
def(AUTUMN, 'Autumn leaves', T.autumn, 2, { hard: .25, tool: 'axe', snd: 'leaf', sway: 1, drop: LEAVES });
def(PINEL, 'Pine needles', T.pineLeaf, 2, { hard: .25, tool: 'axe', snd: 'leaf', sway: 1, drop: LEAVES });
def(OREF, 'Azure ore', T.oreFrost, 1, { hard: 2, tool: 'pick', emit: 4 });
def(OREC, 'Verdigris ore', T.oreCopper, 1, { hard: 2, tool: 'pick', emit: 4 });
def(OREA, 'Amethyst ore', T.oreAmethyst, 1, { hard: 2, tool: 'pick', emit: 4 });
def(CRYR, 'Rose crystal', T.crystalRose, 1, { hard: 1.2, emit: 9, snd: 'glass' });
def(CRYF, 'Frost crystal', T.crystalFrost, 1, { hard: 1.2, emit: 9, snd: 'glass' });
const STICK = 100, PICK = 102, SAIL = 105, SEED = 106, BUN = 107, BISCUIT = 108;
const I_NAME = { 100: 'Stick', 102: 'Pickaxe', 105: 'Sky sail', 106: 'Vineseed', 107: 'Flower bun', 108: 'Kit biscuit' };
const itemName = id => id >= 100 ? I_NAME[id] : B_NAME[id];
const maxStack = id => (id === PICK || id === SAIL || id >= 130) ? 1 : 64;
const isBlockItem = id => id > 0 && id < 100;
const FLOWERS = [ROSE, SUNF, BELL];

/* ================= texture atlas (procedural pixels) ================= */
const ATL = 512, EM = 204; // 16 x 16 cells of 32 px (16 px tiles with an 8 px wrap border)
const atlasData = new Uint8Array(ATL * ATL * 4);
const tileBuf = [];
const rgb = h => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const PAL = a => a.map(rgb);
const pick = (p, t) => p[clamp(Math.floor(t * p.length), 0, p.length - 1)];
const pr = (x, y, s) => h2(x * 13 + s * 101, y * 7 + s * 57);
const sm = (x, y, s, f) => vn(x * f + s * 3.1, y * f - s * 7.7);
const shade = (c, k) => [clamp(c[0] * k | 0, 0, 255), clamp(c[1] * k | 0, 0, 255), clamp(c[2] * k | 0, 0, 255), c[3]];
const A = (c, a) => [c[0], c[1], c[2], a];
function paint(tile, fn){
  const buf = new Uint8Array(16 * 16 * 4);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++){
    const c = fn(x, y), o = (y * 16 + x) * 4;
    buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; buf[o + 3] = c[3] === undefined ? 255 : c[3];
  }
  tileBuf[tile] = buf;
  const cx = (tile % 16) * 32, cy = Math.floor(tile / 16) * 32;
  for (let py = 0; py < 32; py++) for (let px = 0; px < 32; px++){
    const s = (((py - 8) & 15) * 16 + ((px - 8) & 15)) * 4, d = ((cy + py) * ATL + cx + px) * 4;
    atlasData[d] = buf[s]; atlasData[d + 1] = buf[s + 1]; atlasData[d + 2] = buf[s + 2]; atlasData[d + 3] = buf[s + 3];
  }
}
const GT = PAL([0x5d7746, 0x69834e, 0x758e55, 0x81985c, 0x8da263]);
const DIRTP = PAL([0x6c5343, 0x7a5f4b, 0x876b53, 0x94785d]);
const STONEP = PAL([0x7f7a77, 0x8c8682, 0x99938d, 0xa69f97]);
const DEEPP = PAL([0x5d5662, 0x68606e, 0x736a79, 0x7f7584]);
const SANDP = PAL([0xc9b690, 0xd3c19b, 0xdccba7, 0xc0ab85]);
const BARK = PAL([0x54402f, 0x614a37, 0x6e5541, 0x7a604a]);
const LEAFP = PAL([0x4f6943, 0x5b774b, 0x688453, 0x76915c, 0x86a066]);
const BLOS = PAL([0xb98783, 0xc9958e, 0xd6a49b, 0xe2b7ab, 0xeccabc]);
const PLANK = PAL([0x96744f, 0xa37f58, 0xaf8a61, 0xba966b]);
const BRIDGEP = PAL([0x6f5239, 0x7a5c41, 0x86664a, 0x917052]);
const SIGNP = PAL([0x5e4130, 0x694a37, 0x75533e, 0x815c45]);
const BRICKP = PAL([0xa06b5c, 0xab7665, 0xb68170, 0x96604f]);
const GRAVP = PAL([0x9b8f7c, 0xa99c87, 0xb7aa94, 0x8a7e6c, 0xc4b8a2]);
const JSP = PAL([0xbca583, 0xc6af8c, 0xd0ba97, 0xb19a78]);
const WATERP = PAL([0x3d6c7a, 0x477683, 0x52818c, 0x5e8c96]);
const STEPP = PAL([0xaaa392, 0xb4ad9c, 0xbeb7a6, 0x9f9887]);
function cobbleFn(pal, mossy){
  const pts = []; for (let i = 0; i < 6; i++) pts.push([pr(i, 3, 41) * 16, pr(i, 9, 43) * 16]);
  return (x, y) => {
    let d1 = 99, d2 = 99, k = 0;
    for (let i = 0; i < pts.length; i++) for (let ox = -16; ox <= 16; ox += 16) for (let oy = -16; oy <= 16; oy += 16){
      const d = Math.hypot(x + .5 - pts[i][0] - ox, y + .5 - pts[i][1] - oy);
      if (d < d1){ d2 = d1; d1 = d; k = i; } else if (d < d2) d2 = d;
    }
    if (d2 - d1 < 1.3) return shade(pal[0], .72);
    let c = pick(pal, (pr(k, 0, 5) * .6 + pr(x, y, 6) * .4));
    c = shade(c, 1.08 - d1 * .05);
    if (mossy && (sm(x, y, 7, .35) > .5 || y < 2 + pr(x, 0, 8) * 3) && pr(x, y, 9) > .2) c = pick(LEAFP, pr(x, y, 10) * .8);
    return c;
  };
}
function plant(fn){ return (x, y) => { const c = fn(x, y); return c || [0, 0, 0, 0]; }; }
function buildAtlas(){
  paint(T.grassTop, (x, y) => { const t = sm(x, y, 1, .42) * .55 + pr(x, y, 1) * .45; if (pr(x, y, 2) > .965) return rgb(0xb4a874); return pick(GT, t); });
  paint(T.grassSide, (x, y) => { const f = 3 + Math.floor(pr(x, 0, 3) * 3.2); if (y < f) return shade(pick(GT, .25 + pr(x, y, 4) * .6), 1 - y * .035); if (y === f) return shade(DIRTP[1], .82); const t = pr(x, y, 5) * .55 + sm(x, y, 5, .5) * .45; return pick(DIRTP, t); });
  paint(T.dirt, (x, y) => { if (pr(x, y, 6) > .94) return rgb(0x9f8366); return pick(DIRTP, pr(x, y, 7) * .55 + sm(x, y, 7, .5) * .45); });
  paint(T.stone, (x, y) => { let c = pick(STONEP, pr(x, y, 8) * .45 + sm(x * .4, y * 1.4, 8, .5) * .55); const k = (y + Math.floor(sm(x, 0, 9, .3) * 3)) % 6; if (k === 0 && pr(x, y, 10) > .35) c = shade(c, .82); return c; });
  paint(T.deep, (x, y) => { let c = pick(DEEPP, pr(x, y, 11) * .45 + sm(x * .4, y * 1.4, 11, .5) * .55); if ((y + Math.floor(sm(x, 0, 12, .3) * 3)) % 5 === 0 && pr(x, y, 13) > .4) c = shade(c, .8); return c; });
  paint(T.sand, (x, y) => { if (pr(x, y, 14) > .95) return rgb(0xab9672); return pick(SANDP, pr(x, y, 15) * .6 + sm(x, y, 15, .5) * .4); });
  paint(T.gravel, (x, y) => pick(GRAVP, pr(x >> 1, y >> 1, 16) * .6 + pr(x, y, 17) * .4));
  paint(T.logSide, (x, y) => { let c = pick(BARK, sm(x * 1.1, y * .18, 18, 1) * .6 + pr(x, y >> 2, 19) * .4); if ((x + Math.floor(y / 5)) % 4 === 0) c = shade(c, .78); return c; });
  paint(T.logTop, (x, y) => { const r = Math.hypot(x - 7.5, y - 7.5); if (r > 6.6) return pick(BARK, pr(x, y, 20)); const ring = Math.floor(r * 1.15 + sm(x, y, 21, .4) * 1.2) % 2; return shade(rgb(ring ? 0xb39a74 : 0xa48a65), .95 + pr(x, y, 22) * .1); });
  paint(T.leaves, (x, y) => { const t = sm(x, y, 23, .45) * .6 + pr(x, y, 24) * .4; if (pr(x, y, 25) > .9) return rgb(0x41593a); if (pr(x, y, 26) < .05) return rgb(0x9cb478); return pick(LEAFP, t); });
  paint(T.blossom, (x, y) => { if (pr(x, y, 27) > .93) return rgb(0xf6e6dc); if (pr(x, y, 28) > .88) return rgb(0xa77470); return pick(BLOS, sm(x, y, 29, .45) * .6 + pr(x, y, 30) * .4); });
  paint(T.planks, (x, y) => { const row = y >> 2; if ((y & 3) === 3) return shade(PLANK[0], .72); const off = Math.floor(pr(row, 1, 31) * 16); if (((x + off) & 15) === 0) return shade(PLANK[0], .8); return pick(PLANK, pr(row, 2, 32) * .45 + sm(x * .25 + row * 9, y, 33, .6) * .35 + pr(x, y, 34) * .2); });
  paint(T.bridge, (x, y) => { if ((x & 3) === 3) return shade(BRIDGEP[0], .7); return pick(BRIDGEP, pr(x >> 2, 1, 35) * .5 + sm(x, y * .25, 36, .7) * .5); });
  paint(T.bridgeTop, (x, y) => { if ((y & 3) === 3) return shade(BRIDGEP[0], .7); if ((x === 1 || x === 14) && (y & 3) === 1) return rgb(0x3b2d24); return pick(BRIDGEP, pr(y >> 2, 1, 37) * .5 + sm(x * .25, y, 38, .7) * .5); });
  paint(T.sign, (x, y) => { if ((y & 3) === 3) return shade(SIGNP[0], .72); return pick(SIGNP, pr(y >> 2, 3, 39) * .5 + sm(x * .25, y, 40, .7) * .5); });
  paint(T.signTop, (x, y) => { const e = x === 0 || y === 0 || x === 15 || y === 15; if (e) return shade(SIGNP[0], .7); return pick(SIGNP, pr(x, y, 41) * .5 + sm(x, y * .25, 42, .7) * .5); });
  paint(T.glass, (x, y) => { if (x === 0 || y === 0 || x === 15 || y === 15) return rgb(0xd5e2de); if ((x === 1 || y === 1) && pr(x, y, 43) > .4) return rgb(0xbfcfcb); if ((x - y === 4 || x - y === 5) && x > 5 && x < 11) return A(rgb(0xf2f7f4), 255); if (x - y === -6 && x > 2 && x < 6) return rgb(0xf2f7f4); return [0, 0, 0, 0]; });
  paint(T.lantern, (x, y) => { if (x < 2 || x > 13 || y < 2 || y > 13) return pr(x, y, 44) > .5 ? rgb(0x3b322c) : rgb(0x473c34); if (x === 7 || x === 8 || y === 6) return rgb(0x4a3e35); const r = Math.hypot(x - 7.5, y - 8.5) / 7; return A(r < .45 ? rgb(0xffe6ad) : (r < .75 ? rgb(0xffcf86) : rgb(0xf0a861)), EM); });
  paint(T.lanternTop, (x, y) => { const r = Math.hypot(x - 7.5, y - 7.5); if (r < 2.2) return A(rgb(0xffd890), EM); if (r < 3.4) return rgb(0x2f2823); return pr(x, y, 45) > .5 ? rgb(0x3b322c) : rgb(0x4a3e35); });
  paint(T.ore, (x, y) => { const s = sm(x, y, 46, .55); if (s > .66 && pr(x, y, 47) > .15) return A(pick(PAL([0xd88f3e, 0xe7a94b, 0xf3c56b]), pr(x, y, 48)), EM); let c = pick(STONEP, pr(x, y, 49) * .5 + sm(x * .4, y * 1.4, 50, .5) * .5); return c; });
  paint(T.cobble, cobbleFn(STONEP, false));
  paint(T.moss, cobbleFn(STONEP, true));
  paint(T.brick, (x, y) => { const row = y >> 2, off = (row & 1) ? 4 : 0; if ((y & 3) === 3 || ((x + off) & 7) === 7) return rgb(0xcbb9a3); return shade(pick(BRICKP, pr((x + off) >> 3, row, 51) * .7 + pr(x, y, 52) * .3), (y & 3) === 0 ? 1.06 : 1); });
  paint(T.step, (x, y) => { if (x === 0 || y === 0 || x === 15 || y === 15) return shade(STEPP[0], .78); if (sm(x, y, 53, .4) > .68 && pr(x, y, 54) > .3) return pick(LEAFP, pr(x, y, 55)); return pick(STEPP, pr(x, y, 56) * .5 + sm(x, y, 57, .4) * .5); });
  paint(T.stepSide, (x, y) => { if (y < 2) return pick(LEAFP, pr(x, y, 58)); if (y === 2 && pr(x, 0, 59) > .5) return pick(LEAFP, .3); return pick(STEPP, pr(x, y, 60) * .5 + sm(x * .4, y * 1.3, 61, .5) * .5); });
  paint(T.jstone, (x, y) => { if (y % 8 === 7) return shade(JSP[0], .8); if (y % 8 === 0) return shade(JSP[2], 1.05); return pick(JSP, pr(x, y, 62) * .5 + sm(x * .3, y * .8, 63, .5) * .5); });
  paint(T.jstoneTop, (x, y) => { if (x === 0 || y === 0 || x === 15 || y === 15) return shade(JSP[0], .82); return pick(JSP, pr(x, y, 64) * .5 + sm(x, y, 65, .4) * .5); });
  paint(T.ebark, (x, y) => { const v = Math.abs(Math.sin(x * .85 + Math.sin(y * .45) * 2.2)); if (v < .1 && pr(x, y, 66) > .25) return A(pr(x, y, 67) > .5 ? rgb(0x6fc9ae) : rgb(0x9adcc2), EM); let c = pick(PAL([0x3e3238, 0x483a40, 0x534349, 0x5e4c51]), sm(x * 1.1, y * .2, 67, 1) * .6 + pr(x, y, 68) * .4); return c; });
  paint(T.eleaf, (x, y) => { if (pr(x, y, 69) > .82) return A(rgb(0x5f9f86), EM); return A(pick(PAL([0x6fb79a, 0x84c4a4, 0x9bcfac, 0xc9d495, 0xe2d48e]), sm(x, y, 70, .45) * .6 + pr(x, y, 71) * .4), EM); });
  paint(T.crystal, (x, y) => { const t = ((x + y) * .09 + sm(x, y, 72, .3) * .5) % 1; if ((x + y) % 7 === 0) return A(rgb(0xf4f2ff), EM); return A(pick(PAL([0x8fa6dc, 0xa8bbe9, 0xc3c4f0, 0xd9cff4]), t), EM); });
  paint(T.vine, (x, y) => { const v = Math.abs(Math.sin(x * 1.3 + y * .4)) < .3 || (x + y * 3) % 7 === 0; if (v) return pick(LEAFP, pr(x, y, 80) * .5 + .5); if ((y & 3) === 3) return shade(BRIDGEP[0], .7); return pick(PAL([0x5b6b3d, 0x667745, 0x71824c]), pr(x >> 1, y >> 2, 81)); });
  paint(T.vineTop, (x, y) => { if (sm(x, y, 82, .5) > .55) return pick(LEAFP, pr(x, y, 83)); if ((x & 3) === 3) return rgb(0x4f5c33); return pick(PAL([0x5f7040, 0x6a7b47, 0x76874f]), pr(x >> 2, y, 84)); });
  // ---- the Wilds
  const SNOWP = PAL([0xdfe6ea, 0xe8eef1, 0xf2f6f8, 0xd4dde4]), ICEP = PAL([0x93bdd6, 0xa4c9df, 0xb6d5e8, 0x86b2cd]), REDP = PAL([0x9b4c34, 0xa8563a, 0xb4613f, 0xbf6c47]);
  const ASHP = PAL([0x67625f, 0x716c69, 0x7b7672, 0x86807b]), BASP = PAL([0x37353a, 0x3f3c42, 0x48454b, 0x514d54]), MYCP = PAL([0x6b5d77, 0x786985, 0x857593, 0x92839f]);
  const RUINP = PAL([0x77736d, 0x837e77, 0x8f8a82, 0x9b958c]);
  paint(T.snowTop, (x, y) => { if (pr(x, y, 90) > .96) return rgb(0xc4d4e2); return pick(SNOWP, pr(x, y, 91) * .5 + sm(x, y, 92, .4) * .5); });
  paint(T.snowSide, (x, y) => { const f = 3 + Math.floor(pr(x, 0, 93) * 2.5); if (y < f) return pick(SNOWP, pr(x, y, 94)); if (y === f) return rgb(0xb9c6cf); return pick(STONEP, pr(x, y, 95) * .6 + sm(x, y, 96, .5) * .4); });
  paint(T.ice, (x, y) => { const c = Math.abs(Math.sin(x * .9 + y * .45 + sm(x, y, 97, .3) * 4)); if (c < .07) return rgb(0xe4f1f8); if ((x - y + 16) % 9 === 0 && pr(x, y, 98) > .3) return rgb(0xcfe5f1); return pick(ICEP, pr(x, y, 99) * .4 + sm(x, y, 100, .3) * .6); });
  paint(T.redrock, (x, y) => { let c = pick(REDP, pr(x, y, 101) * .5 + sm(x * .5, y, 102, .5) * .5); if (pr(x, y, 103) > .94) c = rgb(0xd88b5c); return c; });
  paint(T.redband, (x, y) => { const band = (y + Math.floor(sm(x, 0, 104, .2) * 2)) % 8; const base = band < 2 ? PAL([0xd8a072, 0xe0ab7d]) : band < 5 ? REDP : PAL([0xb86d45, 0xc4794f]); return pick(base, pr(x, y, 105)); });
  paint(T.ash, (x, y) => { if (pr(x, y, 106) > .95) return rgb(0x3d3a3a); if (pr(x, y, 107) > .97) return A(rgb(0xf09a55), EM); return pick(ASHP, pr(x, y, 108) * .5 + sm(x, y, 109, .5) * .5); });
  paint(T.basalt, (x, y) => { if (x % 4 === 3) return shade(BASP[0], .8); return pick(BASP, pr(x >> 2, y, 110) * .5 + sm(x, y * .3, 111, .6) * .5); });
  paint(T.ember, (x, y) => { const v = Math.abs(Math.sin(x * .7 + Math.sin(y * .6) * 2.4 + sm(x, y, 112, .3) * 3)); if (v < .16) return A(v < .07 ? rgb(0xffd27a) : rgb(0xf08a3c), EM); return pick(BASP, pr(x, y, 113)); });
  paint(T.mycelTop, (x, y) => { if (pr(x, y, 114) > .93) return rgb(0xc9bcd6); return pick(MYCP, pr(x, y, 115) * .5 + sm(x, y, 116, .45) * .5); });
  paint(T.mycelSide, (x, y) => { const f = 2 + Math.floor(pr(x, 0, 117) * 3); if (y < f) return pick(MYCP, pr(x, y, 118)); return pick(DIRTP, pr(x, y, 119) * .6 + sm(x, y, 120, .5) * .4); });
  paint(T.mstem, (x, y) => { if (x % 5 === 2 && pr(x, y, 121) > .3) return rgb(0xcdbfa8); return pick(PAL([0xdcd2c0, 0xe6ddcc, 0xefe7d8]), pr(x, y >> 2, 122)); });
  paint(T.capRed, (x, y) => { const sp = Math.hypot((x % 8) - 3.5 + (y >> 3) * 2, (y % 8) - 3.5) < 1.6; if (sp) return rgb(0xf2e6da); return pick(PAL([0xa63f38, 0xb4473f, 0xc25048, 0xcf5b51]), pr(x, y, 123) * .5 + sm(x, y, 124, .4) * .5); });
  paint(T.capBlue, (x, y) => { const sp = Math.hypot((x % 8) - 3.5 + (y >> 3) * 2, (y % 8) - 3.5) < 1.5; if (sp) return A(rgb(0xd8fbff), EM); return A(pick(PAL([0x3f8fa6, 0x4aa0b6, 0x58b2c5, 0x66c2d2]), pr(x, y, 125) * .5 + sm(x, y, 126, .4) * .5), pr(x, y, 127) > .6 ? EM : 255); });
  paint(T.ruin, (x, y) => { const row = y >> 2, off = (row & 1) ? 4 : 0; if ((y & 3) === 3 || ((x + off) & 7) === 7) return shade(RUINP[0], .7); let c = pick(RUINP, pr((x + off) >> 3, row, 128) * .6 + pr(x, y, 129) * .4); if (pr(x, y, 130) > .93) c = shade(c, .8); return c; });
  paint(T.ruinMoss, (x, y) => { const row = y >> 2, off = (row & 1) ? 4 : 0; if (sm(x, y, 131, .35) > .52 && pr(x, y, 132) > .2) return pick(LEAFP, pr(x, y, 133) * .8); if ((y & 3) === 3 || ((x + off) & 7) === 7) return shade(RUINP[0], .7); return pick(RUINP, pr((x + off) >> 3, row, 134) * .6 + pr(x, y, 135) * .4); });
  paint(T.tent, (x, y) => { const st = ((x + 2) >> 2) % 2; let c = st ? pick(PAL([0xa94a3b, 0xb35242]), pr(x, y, 136)) : pick(PAL([0xd3ad6c, 0xdcb877]), pr(x, y, 137)); if (y % 6 === 5) c = shade(c, .82); return c; });
  paint(T.deadBush, plant((x, y) => { for (let b = 0; b < 4; b++){ const bx = 3 + b * 3, lean = (pr(b, 2, 138) - .5) * 6; const xx = Math.round(bx + lean * (15 - y) / 15); if (x === xx && y > 4 + b) return shade(rgb(0x7a5a3c), .8 + pr(b, y, 139) * .3); if (y === 6 + b * 2 && Math.abs(x - xx) === 1 + (b & 1)) return rgb(0x6b4e34); } return null; }));
  paint(T.gshroom, plant((x, y) => { for (const m of [[5, 9, 2.2], [10, 11, 1.8]]) { if (Math.abs(x - m[0]) < .8 && y > m[1]) return rgb(0xd9d0c0); const r = Math.hypot(x - m[0], (y - m[1]) * 1.6); if (y <= m[1] && r < m[2] + .4) return A(r < 1 ? rgb(0xdafcff) : rgb(0x5fc0d2), EM); } return null; }));
  paint(T.frostLeaf, (x, y) => { if (pr(x, y, 140) > .78 && sm(x, y, 141, .5) > .45) return pick(SNOWP, pr(x, y, 142)); if (pr(x, y, 143) > .9) return rgb(0x2e4436); return pick(PAL([0x35503f, 0x3f5c48, 0x4a6852, 0x55745c]), pr(x, y, 144) * .6 + sm(x, y, 145, .45) * .4); });
  // ---- richer islands
  paint(T.roots, plant((x, y) => { for (let b = 0; b < 4; b++){ const bx = 2 + b * 4 + Math.floor(pr(b, 3, 150) * 2), len = 8 + Math.floor(pr(b, 4, 151) * 8), sw = (pr(b, 5, 152) - .5) * 3; const xx = Math.round(bx + sw * y / 15); if (x === xx && y < len) return shade(rgb(0x6a5038), .75 + pr(b, y, 153) * .35); if (y === len && Math.abs(x - xx) <= 1) return rgb(0x55402e); } return null; }));
  paint(T.hvine, plant((x, y) => { for (let b = 0; b < 3; b++){ const bx = 3 + b * 5, xx = Math.round(bx + Math.sin(y * .5 + b) * 1.2); if (x === xx) return shade(rgb(0x4f6b3a), .85 + pr(b, y, 154) * .3); if (Math.abs(x - xx) === 1 && (y + b) % 3 === 0) return pick(LEAFP, pr(x, y, 155) * .6 + .4); if (Math.abs(x - xx) === 2 && (y + b) % 6 === 1) return rgb(0xd8c46e); } return null; }));
  const BIRP = PAL([0xe6e1d6, 0xdcd6ca, 0xefeae0, 0xd2ccbf]);
  paint(T.birchSide, (x, y) => { if ((y * 3 + Math.floor(pr(x >> 2, y >> 1, 156) * 9)) % 11 === 0 && pr(x, y, 157) > .25) return rgb(0x3a3532); return pick(BIRP, pr(x, y, 158) * .6 + sm(x, y * .2, 159, .8) * .4); });
  paint(T.birchTop, (x, y) => { const r = Math.hypot(x - 7.5, y - 7.5); if (r > 6.6) return pick(BIRP, pr(x, y, 160)); return shade(rgb(r % 2.4 < 1.2 ? 0xd9c7a1 : 0xc8b48c), 1); });
  paint(T.birchLeaf, (x, y) => { if (pr(x, y, 161) > .9) return rgb(0x6f8a45); if (pr(x, y, 162) < .06) return rgb(0xd7e39a); return pick(PAL([0x8eab58, 0x9cb864, 0xaac46f, 0xb8cf7b]), sm(x, y, 163, .45) * .6 + pr(x, y, 164) * .4); });
  paint(T.fern, plant((x, y) => { for (let b = 0; b < 3; b++){ const a = -0.9 + b * .9; for (let t = 0; t < 14; t++){ const px = Math.round(7.5 + Math.sin(a) * t * .55), py = Math.round(15 - Math.cos(a) * t * .9 - t * t * .012); if (x === px && y === py) return shade(rgb(0x4d7a3e), .8 + t / 30); if (t > 2 && t % 2 === 0 && y === py && Math.abs(x - px) === 1 + (t > 8 ? 0 : 1)) return rgb(0x6a9a4f); } } return null; }));
  paint(T.mushRed, plant((x, y) => { for (const m of [[6, 10, 3], [11, 12, 2]]){ if (Math.abs(x - m[0]) < .8 && y > m[1]) return rgb(0xe6dccb); const r = Math.hypot(x - m[0], (y - m[1]) * 1.7); if (y <= m[1] && r < m[2] + .3) return (x + y * 3) % 5 === 0 ? rgb(0xf4ece2) : rgb(r < m[2] - 1 ? 0xc94a3f : 0xa63a32); } return null; }));
  paint(T.autumn, (x, y) => { const t = sm(x, y, 165, .45) * .6 + pr(x, y, 166) * .4; if (pr(x, y, 167) > .9) return rgb(0x8a4a2a); if (pr(x, y, 168) < .05) return rgb(0xf4cf72); return pick(PAL([0xb85a2e, 0xc9703a, 0xd98a45, 0xe4a352, 0xd47a3a]), t); });
  paint(T.pineLeaf, (x, y) => { if ((x + y * 2) % 5 === 0 && pr(x, y, 169) > .4) return rgb(0x2b4232); return pick(PAL([0x335240, 0x3c5d48, 0x456a51, 0x507659]), pr(x, y, 170) * .6 + sm(x, y, 171, .5) * .4); });
  paint(T.water, (x, y) => pick(WATERP, .5 + .5 * Math.sin((x + y * .6) * .7 + sm(x, y, 73, .4) * 3)));
  paint(T.tgrass, plant((x, y) => { for (let b = 0; b < 5; b++){ const bx = 1 + b * 3 + Math.floor(pr(b, 0, 74) * 2), hgt = 6 + Math.floor(pr(b, 1, 75) * 8), lean = (pr(b, 2, 76) - .5) * 4; const xx = Math.round(bx + lean * (15 - y) / 15); if (x === xx && y > 15 - hgt) return shade(pick(GT, pr(b, y, 77)), .8 + (15 - y) / 15 * .35); } return null; }));
  const flower = (head, ctr) => plant((x, y) => { if ((x === 7 || x === 8) && y >= 8) return x === 7 ? rgb(0x557a43) : rgb(0x47693a); if (y >= 10 && y <= 11 && (x === 5 || x === 6 || x === 9 || x === 10) && ((x < 7) === (y === 10))) return rgb(0x5f8a4a); const r = Math.hypot(x - 7.5, y - 4.5); if (r < 1.3) return rgb(ctr); if (r < 3.6) return shade(rgb(head), .85 + pr(x, y, 78) * .25); return null; });
  paint(T.rose, flower(0xc97b78, 0x8d4b48));
  paint(T.sunf, flower(0xe0c46e, 0x9a6b35));
  paint(T.bell, plant((x, y) => { if ((x === 7 || x === 8) && y >= 5) return rgb(0x557a43); if (y >= 3 && y <= 5 && x >= 4 && x <= 11 && Math.abs(x - 7.5) < 4 - Math.abs(y - 4)) return rgb(0x557a43); for (const b of [[4, 8], [11, 9], [7, 12]]) { if (Math.abs(x - b[0]) <= 1 && y >= b[1] - 1 && y <= b[1] + 1) return shade(rgb(0x8ea2d6), y === b[1] + 1 ? .8 : 1); } return null; }));
}
buildAtlas();
const vor = (x, y, s, n) => { let d1 = 99, d2 = 99, id = 0; for (let i = 0; i < n; i++){ const px = pr(i, 3, s) * 16, py = pr(i, 9, s + 1) * 16; for (let ox = -16; ox <= 16; ox += 16) for (let oy = -16; oy <= 16; oy += 16){ const d = Math.hypot(x + .5 - px - ox, y + .5 - py - oy); if (d < d1){ d2 = d1; d1 = d; id = i; } else if (d < d2) d2 = d; } } return { d1, d2, id }; };
const ramp = (hexes) => PAL(hexes);
// paint a tile and n-1 variants (the painter gets a variant seed v)
function paintVar(name, n, fn){ const base = T[name] !== undefined ? T[name] : newTile(name); paint(base, (x, y) => fn(x, y, 0)); if (n > 1){ TVAR[base] = n; TV0[base] = TN.length; for (let v = 1; v < n; v++){ const t = newTile(name + '_v' + v); paint(t, (x, y) => fn(x, y, v)); } } return base; }
function buildAtlas2(){
  const SNOWP = PAL([0xdfe6ea, 0xe8eef1, 0xf2f6f8, 0xd4dde4]), ICEP = PAL([0x93bdd6, 0xa4c9df, 0xb6d5e8, 0x86b2cd]), REDP = PAL([0x9b4c34, 0xa8563a, 0xb4613f, 0xbf6c47]);
  const ASHP = PAL([0x67625f, 0x716c69, 0x7b7672, 0x86807b]), BASP = PAL([0x37353a, 0x3f3c42, 0x48454b, 0x514d54]), MYCP = PAL([0x6b5d77, 0x786985, 0x857593, 0x92839f]);
  const GR = ramp([0x4f6a3d, 0x5d7746, 0x6b8650, 0x7a9558, 0x8aa462, 0xa8c070]), SOIL = ramp([0x5b4537, 0x6c5343, 0x7a5f4b, 0x876b53, 0x957a60, 0xa58a6c]);
  const ST = ramp([0x5f5b5c, 0x6f6a68, 0x7f7a77, 0x8c8682, 0x99938d, 0xaba49c]), MOSSR = ramp([0x45603c, 0x4f6943, 0x5b774b, 0x688453, 0x7c9a5c]);
  // grass top: clumps, blade pairs, and per-variant clover / pebbles / tiny flowers
  paintVar('grassTop', 4, (x, y, v) => { const c = sm(x, y, 1 + v, .4) * .55 + pr(x, y, 2 + v * 7) * .45; let col = pick(GR, .1 + c * .8);
    if (pr(x, y, 3 + v) > .9 && pr(x, y + 1, 3 + v) <= .9) col = GR[5]; else if (pr(x, y - 1, 3 + v) > .9) col = GR[1];
    if (v === 1 && pr(x >> 1, y >> 1, 40) > .93) col = rgb(0x9cbf6a); if (v === 2 && pr(x, y, 41) > .975) col = (x + y) & 1 ? rgb(0xe8e0c6) : rgb(0xd8c46e); if (v === 3 && vor(x, y, 42, 3).d1 < 1.1) col = rgb(0x9b9184);
    return col; });
  // grass side: a jagged grass lip with drips over soil, with pebbles and a root
  paintVar('grassSide', 3, (x, y, v) => { const lip = 3 + Math.floor(pr(x, 0, 4 + v) * 2.6) + (pr(x >> 1, 9, 5 + v) > .8 ? 2 : 0);
    if (y < lip) return pick(GR, .2 + (1 - y / lip) * .55 + pr(x, y, 6) * .2); if (y === lip) return shade(SOIL[0], .78);
    if (vor(x, y, 7 + v, 4).d1 < 1.2 && y > lip + 2) return pr(x, y, 8) > .5 ? rgb(0x9a908a) : rgb(0x7c736e);
    if (v === 2 && Math.abs(x - 6 - Math.sin(y * .6) * 1.5) < .6 && y > lip + 1 && y < 13) return rgb(0x4e3b2c);
    return pick(SOIL, .15 + sm(x, y, 9 + v, .5) * .5 + pr(x, y, 10 + v) * .3); });
  paintVar('dirt', 3, (x, y, v) => { if (vor(x, y, 11 + v, 4).d1 < 1.15) return pr(x, y, 12) > .5 ? rgb(0x9a908a) : rgb(0x7c736e); if (v === 1 && Math.abs(y - 5 - Math.sin(x * .7) * 1.2) < .5 && x > 3 && x < 13) return rgb(0x4e3b2c);
    return pick(SOIL, .1 + sm(x, y, 13 + v, .45) * .5 + pr(x, y, 14 + v) * .35); });
  // stone: plates with crevices lit from the top-left
  const stoneFn = (P, s0) => (x, y, v) => { const w = vor(x, y, s0 + v * 5, 5), edge = w.d2 - w.d1;
    if (edge < 1) return shade(P[0], .82); let c = pick(P, .25 + pr(w.id, 1, s0 + v) * .45 + pr(x, y, s0 + 3) * .15);
    if (edge < 2 && vor(x + 1, y + 1, s0 + v * 5, 5).id !== w.id) c = shade(c, 1.12); // lit lip on the top-left side of each plate
    if (v === 3 && pr(x, y, s0 + 4) > .965) c = rgb(0xc9c2b4); return c; };
  paintVar('stone', 4, stoneFn(ST, 20));
  paintVar('deep', 2, stoneFn(ramp([0x4a4450, 0x5d5662, 0x68606e, 0x736a79, 0x7f7584, 0x8c8291]), 30));
  paintVar('sand', 3, (x, y, v) => { const rip = Math.sin((x * .8 + y * .45) + sm(x, y, 50 + v, .3) * 3); if (rip > .86) return rgb(0xe6d6b3); if (rip < -.9) return rgb(0xb59f78); if (pr(x, y, 51 + v) > .95) return rgb(0xa58f6c); return pick(SANDP, pr(x, y, 52 + v) * .55 + sm(x, y, 53, .5) * .45); });
  paintVar('gravel', 2, (x, y, v) => { const w = vor(x, y, 55 + v, 9); if (w.d2 - w.d1 < .8) return rgb(0x6f655a); return shade(pick(GRAVP, pr(w.id, 0, 56 + v)), 1.08 - w.d1 * .05); });
  paintVar('cobble', 2, (x, y, v) => cobbleFn(STONEP, false)(x ^ (v * 5), y));
  paintVar('moss', 2, (x, y, v) => cobbleFn(STONEP, true)(x ^ (v * 3), y ^ (v * 7)));
  paintVar('logSide', 2, (x, y, v) => { let c = pick(BARK, sm(x * 1.2, y * .16, 18 + v, 1) * .6 + pr(x, y >> 2, 19 + v) * .4); if ((x + Math.floor(y / 5) + v) % 4 === 0) c = shade(c, .74); if ((x + v * 3) % 4 === 1) c = shade(c, 1.1); if (v === 1 && Math.hypot(x - 9, (y - 7) * .7) < 1.6) return rgb(0x3b2b20); return c; });
  // leaves: alpha-cut clusters (light top-left on every cluster), 3 variants
  const leafFn = (P, s, hole) => (x, y, v) => { const w = vor(x, y, s + v * 3, 7); if (w.d1 > 4.4 - hole && pr(x, y, s + 1 + v) > .35) return [0, 0, 0, 0];
    let c = pick(P, .2 + (1 - w.d1 / 5) * .55 + pr(x, y, s + 2) * .2); const n = vor(x - 1, y - 1, s + v * 3, 7); if (n.id !== w.id) c = shade(c, 1.15); const q = vor(x + 1, y + 1, s + v * 3, 7); if (q.id !== w.id) c = shade(c, .75); return c; };
  paintVar('leaves', 3, leafFn(ramp([0x3f5a37, 0x4f6943, 0x5b774b, 0x688453, 0x76915c, 0x8aa66a]), 60, .3));
  paintVar('birchLeaf', 2, leafFn(ramp([0x6f8a45, 0x8eab58, 0x9cb864, 0xaac46f, 0xb8cf7b, 0xcfe08e]), 64, .3));
  paintVar('autumn', 2, leafFn(ramp([0x8a4a2a, 0xb85a2e, 0xc9703a, 0xd98a45, 0xe4a352, 0xf4cf72]), 68, .3));
  paintVar('pineLeaf', 2, (x, y, v) => { if ((x + y * 2 + v) % 5 === 0 && pr(x, y, 72 + v) > .55) return [0, 0, 0, 0]; if ((x + y * 2) % 5 === 0) return rgb(0x2b4232); return pick(ramp([0x2f4a3a, 0x335240, 0x3c5d48, 0x456a51, 0x507659, 0x5f8566]), pr(x, y, 73 + v) * .6 + sm(x, y, 74, .5) * .4); });
  paintVar('blossom', 2, leafFn(ramp([0xa77470, 0xb98783, 0xc9958e, 0xd6a49b, 0xe2b7ab, 0xf6e6dc]), 76, .3));
  paintVar('frostLeaf', 2, (x, y, v) => { const c = leafFn(ramp([0x2e4436, 0x35503f, 0x3f5c48, 0x4a6852, 0x55745c, 0x6a8a70]), 80, .35)(x, y, v); if (c[3] === 0) return c; if (y < 6 + pr(x, 1, 81 + v) * 4 && pr(x, y, 82) > .3) return pick(SNOWP, pr(x, y, 83)); return c; });
  paintVar('eleaf', 2, (x, y, v) => { const c = leafFn(ramp([0x5f9f86, 0x6fb79a, 0x84c4a4, 0x9bcfac, 0xc9d495, 0xe2d48e]), 84, .25)(x, y, v); if (c[3] === 0) return c; return A(c, pr(x, y, 85 + v) > .8 ? EM : 230); });
  // snow, frost, mesa, ash, grove surfaces with variants
  paintVar('snowTop', 3, (x, y, v) => { const s = sm(x, y, 90 + v, .35); if (s > .7 && pr(x, y, 91) > .4) return rgb(0xffffff); if (pr(x, y, 92 + v) > .96) return rgb(0xbdcddb); return pick(SNOWP, .2 + s * .5 + pr(x, y, 93) * .3); });
  paintVar('snowSide', 2, (x, y, v) => { const f = 3 + Math.floor(pr(x, 0, 94 + v) * 2.5) + (pr(x >> 1, 3, 95 + v) > .75 ? 3 : 0); if (y < f) return pick(SNOWP, .3 + (1 - y / f) * .5); if (y === f) return rgb(0xb3c1cc); return stoneFn(ST, 96)(x, y, v); });
  paintVar('ice', 2, (x, y, v) => { const c = Math.abs(Math.sin(x * .9 + y * .45 + sm(x, y, 97 + v, .3) * 4)); if (c < .07) return rgb(0xe4f1f8); if ((x - y + 16 + v * 3) % 9 === 0 && pr(x, y, 98) > .3) return rgb(0xd8eef8); return pick(ICEP, .2 + pr(x, y, 99) * .3 + sm(x, y, 100, .3) * .5); });
  paintVar('redrock', 3, (x, y, v) => { const w = vor(x, y, 101 + v, 4); if (w.d2 - w.d1 < .9) return rgb(0x7a3a28); let c = pick(REDP, .25 + pr(w.id, 1, 102 + v) * .5 + pr(x, y, 103) * .2); if (y % 5 === 0 && pr(x, y, 104) > .5) c = shade(c, 1.12); return c; });
  paintVar('ash', 3, (x, y, v) => { if (pr(x, y, 106 + v) > .95) return rgb(0x3d3a3a); if (pr(x, y, 107 + v) > .985) return A(rgb(0xf09a55), EM); const s = sm(x, y, 108 + v, .4); return pick(ASHP, .15 + s * .55 + pr(x, y, 109) * .25); });
  paintVar('basalt', 2, (x, y, v) => { if ((x + v * 2) % 4 === 3) return shade(BASP[0], .78); if ((x + v * 2) % 4 === 0) return shade(pick(BASP, .6), 1.12); return pick(BASP, pr(x >> 2, y, 110 + v) * .5 + sm(x, y * .3, 111, .6) * .5); });
  paintVar('mycelTop', 3, (x, y, v) => { if (pr(x, y, 114 + v) > .93) return rgb(0xc9bcd6); if (v === 2 && pr(x, y, 115) > .975) return A(rgb(0x9fe7f2), EM); return pick(MYCP, .15 + pr(x, y, 116 + v) * .45 + sm(x, y, 117, .45) * .4); });
  paintVar('planks', 2, (x, y, v) => { const row = y >> 2; if ((y & 3) === 3) return shade(PLANK[0], .7); if ((y & 3) === 0) return shade(pick(PLANK, .7), 1.06); const off = Math.floor(pr(row, 1 + v, 31) * 16); if (((x + off) & 15) === 0) return shade(PLANK[0], .78); if (pr(x, y, 32 + v) > .95) return shade(PLANK[0], .85); return pick(PLANK, pr(x >> 2, row, 33 + v) * .5 + sm(x * .25, y, 34, .7) * .5); });
  // exposed-top variants: moss creeping over stone, grass roots over dirt, dust on red rock, ash on basalt
  const exposed = (base, name, top) => { const t = newTile(name); paint(t, (x, y) => { const lip = 2 + Math.floor(pr(x, 4, 120 + t) * 3) + (pr(x >> 1, 5, 121 + t) > .82 ? 3 : 0); if (y < lip) return top(x, y, lip); const s = (tileBuf[base].slice(((y * 16) + x) * 4, ((y * 16) + x) * 4 + 4)); return [s[0], s[1], s[2], s[3]]; }); TEXP[base] = t; return t; };
  exposed(T.stone, 'stoneMossTop', (x, y, l) => pick(MOSSR, .25 + (1 - y / l) * .55 + pr(x, y, 122) * .2));
  exposed(T.deep, 'deepMossTop', (x, y, l) => pick(MOSSR, .15 + (1 - y / l) * .45 + pr(x, y, 123) * .2));
  exposed(T.dirt, 'dirtGrassTop', (x, y, l) => pick(GR, .2 + (1 - y / l) * .55 + pr(x, y, 124) * .2));
  exposed(T.cobble, 'cobbleMossTop', (x, y, l) => pick(MOSSR, .2 + (1 - y / l) * .5 + pr(x, y, 125) * .2));
  exposed(T.redrock, 'redDustTop', (x, y, l) => pick(ramp([0xc4794f, 0xd08a5a, 0xd8a072, 0xe0ab7d]), pr(x, y, 126)));
  exposed(T.basalt, 'basaltAshTop', (x, y, l) => pick(ASHP, .3 + pr(x, y, 127) * .5));
  // snow caps on side faces under snow (frost biomes)
  for (const base of [T.stone, T.dirt, T.cobble, T.deep]){ const t = newTile('cap' + base); paint(t, (x, y) => { const l = 3 + Math.floor(pr(x, 7, 128 + base) * 3) + (pr(x >> 1, 8, 129) > .8 ? 2 : 0); if (y < l) return pick(SNOWP, .3 + (1 - y / l) * .6); if (y === l) return rgb(0xb3c1cc); const o = (y * 16 + x) * 4, s = tileBuf[base]; return [s[o], s[o + 1], s[o + 2], 255]; }); TCAP[base] = t; }
  // overhang fringes (alpha-cut blades that hang over cliff edges)
  const fringe = (name, P) => { const t = newTile(name); paint(t, (x, y) => { const len = 3 + Math.floor(pr(x, 1, 130 + t) * 5) + (x % 3 === 0 ? 2 : 0); if (y < len) return pick(P, .3 + (1 - y / len) * .6); return [0, 0, 0, 0]; }); return t; };
  TFR[GRASS] = fringe('grassFringe', GR); TFR[SNOW] = fringe('snowFringe', SNOWP); TFR[MYCEL] = fringe('mycelFringe', MYCP); TFR[MOSS] = fringe('mossFringe', MOSSR);
  // ores and crystals, one per biome
  const oreFn = (host, gem, s) => (x, y) => { const w = vor(x, y, s, 4); if (w.d1 < 1.8 && pr(w.id, 2, s) > .2){ const k = w.d1 < .8 ? 3 : w.d1 < 1.3 ? 2 : 1; return A(pick(gem, k / 3 - .01 + (x < 8 && y < 8 ? .1 : 0)), EM); } return host(x, y, 0); };
  paint(T.ore, oreFn(stoneFn(ST, 140), ramp([0xb8712e, 0xd88f3e, 0xe7a94b, 0xf3c56b, 0xffe6a0]), 141));
  paintVar('oreFrost', 1, oreFn(stoneFn(ST, 142), ramp([0x2f6fbf, 0x3f8fe6, 0x5fa8ff, 0x9cd0ff, 0xe0f2ff]), 143));
  paintVar('oreCopper', 1, oreFn((x, y) => pick(REDP, pr(x, y, 144) * .7 + .15), ramp([0x2f7d68, 0x3c9a80, 0x4fb59a, 0x7fd4ba, 0xc4f0e2]), 145));
  paintVar('oreAmethyst', 1, oreFn(stoneFn(ramp([0x4a4450, 0x5d5662, 0x68606e, 0x736a79, 0x7f7584]), 146), ramp([0x6a3f9a, 0x8a55c0, 0xb07ae0, 0xd2a8f4, 0xf0e0ff]), 147));
  const crystalFn = (P, s) => (x, y) => { const f = ((x * 1.3 + y) * .11 + sm(x, y, s, .3) * .4) % 1; if ((x + y) % 7 === 0) return A(rgb(0xf8f6ff), EM); if ((x - y + 32) % 9 === 0) return A(shade(pick(P, .3), .85), EM); return A(pick(P, f), EM); };
  paint(T.crystal, crystalFn(ramp([0x7f96cc, 0x8fa6dc, 0xa8bbe9, 0xc3c4f0, 0xd9cff4]), 148));
  paintVar('crystalRose', 1, crystalFn(ramp([0xc77aa8, 0xd88cba, 0xe6a6cb, 0xf2c4dc, 0xfde0ee]), 149));
  paintVar('crystalFrost', 1, crystalFn(ramp([0x7cc4d8, 0x95d6e6, 0xb2e6f0, 0xd2f2f8, 0xf0fcff]), 150));
}
buildAtlas2();
// AO occluders: everything opaque, plus the alpha-cut leaves (canopies still shade themselves)
const B_AOQ = new Uint8Array(NB); for (let i = 0; i < NB; i++) B_AOQ[i] = B_OPQ[i] || (B_RT[i] === 2 && B_SWAY[i]) ? 1 : 0;
function tileAvg(tile){ const b = tileBuf[tile]; let r = 0, g = 0, bl = 0, n = 0; for (let i = 0; i < 256; i++){ if (b[i * 4 + 3] < 100) continue; r += b[i * 4]; g += b[i * 4 + 1]; bl += b[i * 4 + 2]; n++; } n = n || 1; return [r / n / 255, g / n / 255, bl / n / 255]; }
const B_COL = []; for (let i = 1; i < NB; i++) if (B_NAME[i]) B_COL[i] = tileAvg(B_ICON[i]);

/* ================= world ================= */
// the lore archipelago lives in [0, 200) x [0, 200); the Wilds fill the crescent beyond it (x >= 200 or z >= 200)
const WX = 512, WY = 96, WZ = 512, CS = 16, NCX = 32, NCY = 1, NCZ = 32, LAYER = WX * WZ;
const SAFE = 320; const inSafe = (x, z) => x < SAFE && z < SAFE;
const world = new Uint8Array(WX * WY * WZ), light = new Uint8Array(WX * WY * WZ);
// the world as generated is never copied: edited cells remember their original block (sparse), which saves a whole world-sized array
const orig = new Map(); let baseReady = false;
const baseAt = k => orig.has(k) ? orig.get(k) : world[k];
const edits = new Map();
const wi = (x, y, z) => x + WX * (z + WZ * y);
function getB(x, y, z){ if (x < 0 || y < 0 || z < 0 || x >= WX || y >= WY || z >= WZ) return 0; return world[x + WX * (z + WZ * y)]; }
function solidAt(x, y, z){ return B_SOLID[getB(x, y, z)] === 1; }

// ONE home island (the spawn, the safe zone's heart, the Memory Engine) and ten inner islets, each a different
// archetype. All of them are sculpted by the shared island generator (WGEN, w1.js) in a worker at boot; the
// hand-placed landmarks below are dressed on top.
const HOMEC = { x: 160, z: 162 };
const ISL = [
  { id: 'home', name: 'Home Isle', x: 160, z: 162, r: 50, top: 56, depth: 46, b: 6, ax: 1.08, arch: 'plain', caves: 3 },
  { id: 'spire', name: 'The Spires', x: 62, z: 72, r: 14, top: 54, depth: 24, b: 5, arch: 'spires', small: 1, disc: 1 },
  { id: 'i2', name: 'Arch Rock', x: 262, z: 66, r: 15, top: 50, depth: 22, b: 5, arch: 'arch', small: 1, disc: 1 },
  { id: 'i3', name: 'Stepping Stones', x: 58, z: 262, r: 16, top: 46, depth: 14, b: 5, arch: 'archipelago', small: 1, disc: 1 },
  { id: 'basin', name: 'Basin Isle', x: 266, z: 250, r: 20, top: 60, depth: 30, b: 5, arch: 'terrace', small: 1, disc: 1, caves: 2 },
  { id: 'i5', name: 'High Table', x: 220, z: 100, r: 9, top: 72, depth: 22, b: 5, arch: 'mesa', small: 1, disc: 1 },
  { id: 'i6', name: 'Hanging Isle', x: 110, z: 282, r: 10, top: 68, depth: 18, b: 5, arch: 'plain', small: 1, disc: 1 },
  { id: 'i7', name: 'Mossy Knoll', x: 90, z: 96, r: 8, top: 50, depth: 14, b: 5, arch: 'plain', small: 1 },
  { id: 'i8', name: 'Twin Rocks', x: 236, z: 232, r: 12, top: 44, depth: 16, b: 5, arch: 'bridged', small: 1, disc: 1 },
  { id: 'pool', name: 'Falls Pool', x: 200, z: 290, r: 14, top: 40, depth: 18, b: 5, arch: 'atoll', small: 1, disc: 1 },
  { id: 'lookout', name: 'Lookout Rock', x: 160, z: 52, r: 10, top: 64, depth: 22, b: 5, arch: 'mesa', small: 1, disc: 1 }
];
const DISC = ISL.map((I, i) => i).filter(i => i === 0 || ISL[i].disc);
const COLS = WX * WZ;
const hTop = new Int16Array(COLS).fill(-1), hBot = new Int16Array(COLS), isl = new Int8Array(COLS).fill(-1), eArr = new Float32Array(COLS), cmask = new Uint8Array(COLS), wTop = new Int16Array(COLS).fill(-1);
const M_PATH = 1, M_RES = 2, M_SAND = 4, M_GRAV = 8, M_BRICK = 16;
const SHARDS = [], UPDRAFTS = [], SIGNS = [], LAMPS = [], FALLS = [], NETWORK = [], FIREFLY_SPOTS = [], BUTTERFLY_SPOTS = [], MOB_SPAWNS = [];
const RINGS = [], PLAQUES = [], TREES = [], CUBES = [], SPIRE_LEDGES = [], BUOYS = [], NOOKS = [], POIS = [], VISTAS = [], SAFE_LINKS = [];
let CAVE = null, SAIL_STAND = null, SPAWN = null, CRYSTAL_TOPS = [], EDEN_TREE = null, ENGINE = null, HOOK_RACK = null;
const GATES = [];
// block ids handed to the generator worker
const WGEN_B = () => ({ GRASS, DIRT, STONE, SAND, LOG, LEAVES, PLANKS, LANTERN, ORE, COBBLE, BRIDGE, STEP, CRYSTAL, JSTONE, WATER, TGRASS, ROSE, SUNF, BELL, DEEP, MOSS, GRAVEL, BRICK, BLOSSOM, EBARK, ELEAF,
  SNOW, ICE, REDROCK, REDBAND, ASH, BASALT, EMBER, MYCEL, MSTEM, MCAPR, MCAPB, RUIN, RUINM, TENT, DEADB, GSHROOM, FROSTLEAF, CHEST, ROOTS, HVINE, BIRCH, BIRCHL, FERN, MUSHR, AUTUMN, PINEL, OREF, OREC, OREA, CRYR, CRYF });
let wgenBoot = null;
function wgenApi(){ if (!wgenBoot){ const f = { postMessage(m){ f.last = m; } }; WGEN(f); f.onmessage({ data: { type: 'init', B: WGEN_B(), WX, WZ, WY } }); wgenBoot = f; } return wgenBoot.api; }
// generate the safe islands: in a worker when possible (the title keeps animating), inline otherwise
function genSafeIslands(specs, done){
  let w = null;
  try { const url = URL.createObjectURL(new Blob(['(' + WGEN.toString() + ')(self);'], { type: 'text/javascript' })); w = new Worker(url); } catch (e){ w = null; }
  const inline = () => { let i = 0; const step = () => { if (i >= specs.length) return; wgenApi().setSeed(4242); done(i, wgenApi().genIsland(specs[i])); i++; setTimeout(step, 0); }; step(); };
  if (!w){ inline(); return; }
  let got = 0, failed = false;
  w.onmessage = e => { const r = e.data; done(r.tag, r); if (++got === specs.length) w.terminate(); };
  w.onerror = () => { if (failed) return; failed = true; try { w.terminate(); } catch (x){} inline(); };
  w.postMessage({ type: 'init', B: WGEN_B(), WX, WZ, WY });
  specs.forEach((I, i) => w.postMessage({ type: 'gen', seed: 4242, ver: 0, tag: i, I }));
}
function homeSpec(){
  const T = 57, x = HOMEC.x, z = HOMEC.z;
  return { flats: [{ x, z, r: 12, h: T }, { x, z: z + 28, r: 5, h: T }, { x: x + 30, z: z + 30, r: 4, h: T - 1 }, { x: x - 30, z: z - 8, r: 5, h: T }, { x, z: z - 46, r: 3, h: T - 1 }, { x: x + 20, z: z + 36, r: 4, h: T }],
    res: [[x - 13, z - 13, x + 13, z + 13], [x - 3, z + 24, x + 3, z + 32], [x + 26, z + 26, x + 34, z + 34], [x - 2, z - 48, x + 2, z - 42], [x + 17, z + 33, x + 23, z + 39]],
    zones: [[x - 60, z - 70, x + 60, z - 24, 'glow'], [x - 75, z - 20, x - 24, z + 70, 'blossom'], [x + 28, z - 20, x + 80, z + 18, 'pine']],
    spring: { x: x + 8, z: z - 34 }, riverDir: [-1, .4], ponds: [{ x: x - 34, z: z + 10, r: 4.5, l: T }], hl: 12, hlBias: -.05, poi: 'tree' };
}
function islandIndexAt(x, z){ const c = Math.floor(x) + Math.floor(z) * WX; return c >= 0 && c < COLS ? isl[c] : -1; }
// the rim of island i, walking out from its centre toward (tx, tz): returns the last land cell plus `out` blocks
function rimToward(i, tx, tz, out){
  const I = ISL[i]; let dx = tx - I.x, dz = tz - I.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
  let x = I.x + .5, z = I.z + .5, lx = x, lz = z; for (let s = 0; s < 140; s++){ x += dx; z += dz; if (islandIndexAt(x, z) === i){ lx = x; lz = z; } }
  return { x: lx + dx * (out || 0), z: lz + dz * (out || 0), dx, dz, top: hTop[Math.floor(lx) + Math.floor(lz) * WX] };
}

function generate(){ generate.sync = true; const it = generateSteps(); while (!it.next().done); generate.sync = false; }
function* generateSteps(){
  world.fill(0); hTop.fill(-1); isl.fill(-1); cmask.fill(0); wTop.fill(-1);
  for (const a of [SHARDS, UPDRAFTS, SIGNS, LAMPS, FALLS, NETWORK, FIREFLY_SPOTS, BUTTERFLY_SPOTS, MOB_SPAWNS, RINGS, PLAQUES, TREES, CUBES, SPIRE_LEDGES, BUOYS, NOOKS, POIS, VISTAS, SAFE_LINKS, GATES]) a.length = 0;
  CRYSTAL_TOPS = []; CAVE = null; ENGINE = null; SAIL_STAND = null; HOOK_RACK = null;
  rs = 4242;
  // ---- sculpt every safe island (worker), then copy them in
  const specs = ISL.map((I, i) => Object.assign({ k: 100 + i, safe: 1 }, I, i === 0 ? homeSpec() : {}));
  const results = new Array(ISL.length); let pending = ISL.length;
  if (generate.sync){ wgenApi().setSeed(4242); specs.forEach((I, i) => { results[i] = wgenApi().genIsland(I); }); pending = 0; }
  else genSafeIslands(specs, (i, r) => { results[i] = r; pending--; });
  while (pending > 0) yield;
  for (let i = 0; i < ISL.length; i++){
    const r = results[i], { x0, z0, w, d, blk } = r;
    for (let y = 0; y < WY; y++) for (let z = 0; z < d; z++){ const row = w * (z + d * y), wrow = x0 + WX * ((z + z0) + WZ * y); for (let x = 0; x < w; x++){ const id = blk[row + x]; if (id) world[wrow + x] = id; } }
    for (let z = 0; z < d; z++) for (let x = 0; x < w; x++){ const k = x + z * w; if (r.top[k] < 0) continue; const c = (x + x0) + (z + z0) * WX; if (isl[c] >= 0) continue; isl[c] = i; hTop[c] = r.top[k]; hBot[c] = r.bot[k]; eArr[c] = r.ee[k]; wTop[c] = r.wat[k]; }
    r.falls.forEach(f => FALLS.push(f)); r.trees.forEach(t => TREES.push(t)); r.ff.forEach(p => FIREFLY_SPOTS.push(p)); r.bf.forEach(p => BUTTERFLY_SPOTS.push(p));
    r.nooks.forEach(n => NOOKS.push(Object.assign({ isle: i }, n))); r.pois.forEach(p => POIS.push(Object.assign({ isle: i }, p)));
    yield;
  }
  const ci = (x, z) => x + z * WX;
  const put = (x, y, z, id) => { if (x >= 0 && y >= 0 && z >= 0 && x < WX && y < WY && z < WZ) world[wi(x, y, z)] = id; };
  const res = (x0, z0, x1, z1) => { for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (x >= 0 && z >= 0 && x < WX && z < WZ) cmask[ci(x, z)] |= M_RES; };
  const gy = (x, z) => hTop[ci(x, z)];
  const lamp = (x, y, z) => { put(x, y, z, LAMP); LAMPS.push([x + .5, y + .5, z + .5]); };
  const clearAbove = (x, z, y0, n) => { for (let y = y0; y < y0 + n; y++){ const b = world[wi(x, y, z)]; if (b && B_RT[b] === 3 || b === LEAVES || b === AUTUMN || b === BIRCHL || b === PINEL || b === HVINE) put(x, y, z, 0); } };
  const HX = HOMEC.x, HZ = HOMEC.z, T = gy(HX, HZ);
  // ---- paths: a brick ring round the engine, gravel spokes out across the island
  const pave = (x, z, id) => { const c = ci(x, z); if (isl[c] !== 0 || wTop[c] >= 0) return; const h = hTop[c]; put(x, h, z, id); clearAbove(x, z, h + 1, 3); cmask[c] |= M_RES | M_PATH; };
  for (let z = HZ - 13; z <= HZ + 13; z++) for (let x = HX - 13; x <= HX + 13; x++){ const dd = Math.hypot(x - HX, z - HZ); if (dd < 6.6) pave(x, z, GRAVEL); else if (dd < 7.8) pave(x, z, BRICK); else if (dd < 12) clearAbove(x, z, gy(x, z) + 1, 2); }
  for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]){ for (let s = 8; s < 70; s++){ const x = HX + dx * s, z = HZ + dz * s; if (isl[ci(x, z)] !== 0) break; for (let k = -1; k <= 1; k++){ const X = x + (dz ? k : 0), Z = z + (dx ? k : 0); if (Math.abs(hTop[ci(X, Z)] - hTop[ci(x, z)]) <= 1) pave(X, Z, GRAVEL); } } }
  yield;
  // ---- welcome marker by the spawn lawn: a small board that points at the engine
  SPAWN = { x: HX + .5, y: gy(HX, HZ + 28) + 1, z: HZ + 28.5, yaw: 0 };
  { const x = HX + 3, z = HZ + 25, T0 = gy(x, z); put(x, T0 + 1, z, SIGN); put(x, T0 + 2, z, SIGN); res(x - 1, z - 1, x + 1, z + 1); lamp(x, T0 + 3, z);
    PLAQUES.push({ title: 'Memory Engine ▲', x: x + .5, y: T0 + 2.4, z: z + 1.03, rot: 0, w: 2.4, h: .6 }); PLAQUES.push({ title: 'Memory Engine ▲', x: x + .5, y: T0 + 2.4, z: z - .03, rot: Math.PI, w: 2.4, h: .6 }); }
  // ---- the hook rack beside the plaza: an empty, locked display that teases the grappling hook (the Sky Vault in the Wilds holds it)
  { const x = HX + 20, z = HZ + 36, T0 = gy(x, z); for (let dx = -1; dx <= 1; dx++) put(x + dx, T0 + 1, z, PBRICK); put(x - 1, T0 + 2, z, LOG); put(x + 1, T0 + 2, z, LOG); put(x - 1, T0 + 3, z, LOG); put(x + 1, T0 + 3, z, LOG); put(x, T0 + 4, z, PLANKS); put(x - 1, T0 + 4, z, PLANKS); put(x + 1, T0 + 4, z, PLANKS); lamp(x + 2, T0 + 1, z + 1);
    res(x - 2, z - 2, x + 2, z + 2); HOOK_RACK = { x: x + .5, y: T0 + 2.6, z: z + .5 }; }
  // ---- the lighthouse on the south-east point
  { const r = rimToward(0, HX + 100, HZ + 100, -6), cx = Math.round(r.x), cz = Math.round(r.z), T0 = gy(cx, cz);
    res(cx - 3, cz - 3, cx + 3, cz + 3);
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++){ put(cx + dx, T0 + 1, cz + dz, PBRICK); clearAbove(cx + dx, cz + dz, T0 + 2, 14); }
    for (let y = T0 + 2; y <= T0 + 15; y++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) put(cx + dx, y, cz + dz, ((y - T0) >> 1) % 2 ? JSTONE : PBRICK);
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) put(cx + dx, T0 + 16, cz + dz, Math.abs(dx) === 2 || Math.abs(dz) === 2 ? BRIDGE : JSTONE);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) put(cx + dx, T0 + 17, cz + dz, dx || dz ? GLASS : LAMP);
    LAMPS.push([cx + .5, T0 + 17.5, cz + .5]);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) put(cx + dx, T0 + 18, cz + dz, PBRICK);
    put(cx, T0 + 19, cz, PBRICK);
    // a spiral of steps round the tower so the gallery is a climb, not a ladder
    for (let k = 0; k < 14; k++){ const a = k * .9, x = Math.round(cx + Math.cos(a) * 2.6), z = Math.round(cz + Math.sin(a) * 2.6), y = T0 + 2 + k; if (!world[wi(x, y, z)]) put(x, y, z, STEP); }
    POIS.push({ isle: 0, x: cx, y: T0 + 19, z: cz, kind: 'lighthouse' }); VISTAS.push({ x: cx + .5, y: T0 + 17, z: cz + 2.5, name: 'Lighthouse gallery' }); }
  // lamp posts along the spokes
  for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) for (const s of [16, 30]) for (const k of [-2, 2]){ const x = HX + dx * s + (dz ? k : 0), z = HZ + dz * s + (dx ? k : 0); if (isl[ci(x, z)] !== 0) continue; const T0 = gy(x, z); put(x, T0 + 1, z, SIGN); lamp(x, T0 + 2, z); res(x, z, x, z); }
  // ---- THE MEMORY ENGINE: an octagonal plinth, a banded monolith, crystal fins, a crown platform;
  //      the brass rings and the floating core are entity meshes (they turn, glow and wake for the film)
  {
    const cx = HX, cz = HZ, T0 = gy(cx, cz);
    const oct = (r, dx, dz) => Math.abs(dx) + Math.abs(dz) <= r * 1.42 && Math.abs(dx) <= r && Math.abs(dz) <= r;
    for (let dz = -5; dz <= 5; dz++) for (let dx = -5; dx <= 5; dx++){ if (!oct(5, dx, dz)) continue; put(cx + dx, T0 + 1, cz + dz, oct(4, dx, dz) ? JSTONE : PBRICK); if (oct(3, dx, dz)) put(cx + dx, T0 + 2, cz + dz, JSTONE); }
    for (let dx = -1; dx <= 1; dx++){ put(cx + dx, T0 + 1, cz + 5, STEP); }
    const H = 15;
    for (let y = T0 + 3; y <= T0 + 2 + H; y++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++){ const band = (y - T0) % 4 === 0; put(cx + dx, y, cz + dz, band ? (dx || dz ? CRYSTAL : JSTONE) : (Math.abs(dx) + Math.abs(dz) === 2 ? PBRICK : JSTONE)); }
    for (const [fx, fz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) for (let y = T0 + 3; y <= T0 + 8; y++) if (y - T0 < 8 - (Math.abs(fx) + Math.abs(fz) > 2 ? 2 : 0)) put(cx + fx, y, cz + fz, y > T0 + 6 ? CRYSTAL : JSTONE);
    const top = T0 + 3 + H;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++){ if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue; put(cx + dx, top, cz + dz, JSTONE); }
    for (const [dx, dz] of [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [-1, 2], [1, -2], [-1, -2]]) put(cx + dx, top + 1, cz + dz, CRYSTAL);
    for (const p of [[4, 4], [-4, 4], [4, -4], [-4, -4]]) lamp(cx + p[0], T0 + 2, cz + p[1]);
    // the console in front of the stairs: a lectern topped with crystal, where [E] wakes the engine
    const kx = cx, kz = cz + 8; put(kx, T0 + 1, kz, PBRICK); put(kx, T0 + 2, kz, SIGN); put(kx, T0 + 3, kz, CRYSTAL); res(kx - 1, kz - 1, kx + 1, kz + 1);
    ENGINE = { x: cx + .5, y: T0 + 1, z: cz + .5, top: top + 1, core: top + 5.5, console: { x: kx + .5, y: T0 + 1, z: kz + .5 } };
    CRYSTAL_TOPS = [[cx + 2.5, T0 + 9, cz + .5], [cx - 1.5, T0 + 9, cz + .5], [cx + .5, T0 + 9, cz + 2.5], [cx + .5, T0 + 9, cz - 1.5]];
    // crystal pylons round the plaza, threaded together with light (the old network, now orbiting the engine)
    const nodes = [];
    for (let k = 0; k < 8; k++){ const a = k / 8 * Math.PI * 2 + .39, x = Math.round(cx + Math.cos(a) * 9.5), z = Math.round(cz + Math.sin(a) * 9.5), T1 = gy(x, z), Hh = 2 + (k % 2);
      if (Math.abs(x - cx) <= 1 || Math.abs(z - cz) <= 1) continue; for (let y = 1; y <= Hh; y++) put(x, T1 + y, z, CRYSTAL); res(x - 1, z - 1, x + 1, z + 1); nodes.push([x + .5, T1 + Hh + 1.1, z + .5]); }
    const hubP = [cx + .5, top + 1.5, cz + .5];
    for (let k = 0; k < nodes.length; k++){ NETWORK.push([nodes[k], nodes[(k + 1) % nodes.length]]); NETWORK.push([nodes[k], hubP]); }
    EDEN_TREE = { x: cx + .5, y: T0 + 1, z: cz + .5 };
    for (let k = 0; k < 12; k++) CUBES.push({ a: k / 12 * Math.PI * 2, r: 6 + (k % 3) * 1.6, y: T0 + 6 + (k % 5) * 2.2, s: .3 + (k % 3) * .1, sp: .16 + (k % 2) * .07 });
  }
  yield;
  // ---- Lookout Rock causeway: stepping pads off the home north rim (sprint-jump gaps, ascending)
  { const LK = 10, a = rimToward(0, ISL[LK].x, ISL[LK].z, 0), b = rimToward(LK, HX, HZ, 0), y0 = a.top, y1 = b.top;
    const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.floor(L / 5.5) - 1);
    for (let k = 1; k <= n; k++){ const t = k / (n + 1), x = Math.round(a.x + (b.x - a.x) * t + (k % 2 ? 1 : -1)), z = Math.round(a.z + (b.z - a.z) * t), y = Math.round(y0 + (y1 - y0) * t);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++){ put(x + dx, y, z + dz, STEP); if (Math.abs(dx) + Math.abs(dz) < 2) put(x + dx, y - 1, z + dz, DEEP); } put(x, y - 2, z, MOSS); if (k === n) lamp(x, y + 1, z); } }
  // ---- the safe islands' glide network: a tree from home outward (nearest first); an updraft off each launch rim
  { const inTree = new Set([0]), drafts = [];
    for (let n = 1; n < ISL.length; n++){ let best = null, bd = 1e9;
      for (let i = 1; i < ISL.length; i++){ if (inTree.has(i)) continue; for (const a of inTree){ const d = Math.hypot(ISL[a].x - ISL[i].x, ISL[a].z - ISL[i].z) - ISL[a].r * (a ? 1 : 1.1) - ISL[i].r; if (d < bd){ bd = d; best = [a, i]; } } }
      if (!best) break; inTree.add(best[1]); SAFE_LINKS.push(best); }
    const draft = (from, to) => { const r = rimToward(from, ISL[to].x, ISL[to].z, 3.5), gap = Math.max(0, Math.hypot(ISL[to].x - r.x, ISL[to].z - r.z) - ISL[to].r * .8);
      UPDRAFTS.push({ x: Math.floor(r.x) + .5, z: Math.floor(r.z) + .5, r: 4, top: Math.round(clamp(Math.max(ISL[to].top + gap / 5.5 + 8, r.top + 10), 40, WY - 8)), from, to }); };
    for (const [a, b] of SAFE_LINKS){ draft(a, b); draft(b, a); } }
  // gates to the Wilds: east and south rims of home, Basin's east rim, the Falls Pool's south rim
  for (const [i, tx, tz] of [[0, 999, HZ], [0, HX, 999], [4, 999, 250], [9, 200, 999]]){ const r = rimToward(i, tx, tz, 3); GATES.push({ x: Math.round(r.x), z: Math.round(r.z), top: r.top }); }
  // ---- ring course: launch from home's east-rim updraft and thread six rings out toward Basin Isle
  { const u = UPDRAFTS.find(q => q.from === 0 && (q.to === 4 || q.to === 8)) || UPDRAFTS[0], tgt = ISL[u.to];
    const dx = tgt.x - u.x, dz = tgt.z - u.z, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, px = -uz, pz = ux;
    for (let k = 0; k < 6; k++){ const s = 8 + k * 6.5, w = Math.sin(k * 1.1) * 3; RINGS.push({ x: u.x + ux * s + px * w, y: u.top - 2 - k * 1.5, z: u.z + uz * s + pz * w, nx: ux, nz: uz, r: 2.6 }); } }
  yield;
  // ---- trees list for the tutorial, mob spawns on home
  { const I = ISL[0], pts = [];
    for (let k = 0; k < 600 && pts.length < 30; k++){
      const a = rnd() * Math.PI * 2, rr = 14 + rnd() * I.r * .6; const x = Math.round(I.x + Math.cos(a) * rr), z = Math.round(I.z + Math.sin(a) * rr);
      const c = ci(x, z); if (isl[c] !== 0 || wTop[c] >= 0 || (cmask[c] & M_RES)) continue; const h = hTop[c]; const ab = world[wi(x, h + 1, z)]; if (ab && B_RT[ab] !== 3) continue; if (world[wi(x, h + 2, z)]) continue; if (!B_SOLID[world[wi(x, h, z)]]) continue;
      pts.push([x + .5, h + 1, z + .5]);
    }
    MOB_SPAWNS[0] = pts; }
  // ---- sky relics: no lore (the story lives in the Memory Engine); they stitch upgrades into the sail.
  //      Most hide in the generated nooks (cave chambers, behind waterfalls, on spire tops), so they reward curiosity.
  const standAt = (x, z) => { for (let r = 0; r <= 5; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++){ if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; const X = x + dx, Z = z + dz; const c = ci(X, Z); if (isl[c] < 0 || wTop[c] >= 0) continue; let y = hTop[c] + 2; while (y > 0 && !B_SOLID[world[wi(X, y, Z)]]) y--; if (!world[wi(X, y + 1, Z)] || B_RT[world[wi(X, y + 1, Z)]] === 3) return [X + .5, y + 1.75, Z + .5]; } return [x + .5, hTop[ci(x, z)] + 1.75, z + .5]; };
  const nook = (i, kinds) => { for (const k of kinds){ const n = NOOKS.find(q => q.isle === i && q.kind === k && !q.used); if (n){ n.used = 1; return [n.x + .5, n.y + .75, n.z + .5]; } } return null; };
  const poiTop = i => { const p = POIS.find(q => q.isle === i); return p ? [p.x + .5, p.y + 2.2, p.z + .5] : null; };
  const lh = POIS.find(p => p.kind === 'lighthouse');
  const SH = [
    ['Relic of first light. Pick up three and the sail flies further.', standAt(HX - 4, HZ + 30)],
    ['Relic of the orchard caves. Petals fall upward down here.', nook(0, ['cave']) || standAt(HX - 40, HZ + 10)],
    ['Relic of the glow grove. The trees hum when nobody listens.', nook(0, ['falls', 'cave']) || standAt(HX, HZ - 40)],
    ['Relic of the lighthouse. It never warns ships; it welcomes them.', lh ? [lh.x + .5, lh.y - 1.25, lh.z + 2.5] : standAt(HX + 30, HZ + 30)],
    ['Relic of the Spires. The wind remembers who climbs.', nook(1, ['vista', 'cave']) || poiTop(1) || standAt(ISL[1].x, ISL[1].z)],
    ['Relic of the deep chamber. Crystals keep time down here.', nook(4, ['cave']) || standAt(ISL[4].x, ISL[4].z)],
    ['Relic of the lookout. Every island, all at once.', standAt(ISL[10].x, ISL[10].z)],
    ['Relic of Arch Rock. Quiet, and very proud of its hole.', nook(2, ['cave']) || standAt(ISL[2].x, ISL[2].z)],
    ['Relic of the falls. Wet, cold, worth it.', nook(9, ['falls', 'cave']) || standAt(ISL[9].x, ISL[9].z)],
    ['Relic of the High Table. Updrafts know the way.', standAt(ISL[5].x, ISL[5].z)],
    ['Relic of the hanging isle. Look down. No, actually, don’t.', nook(6, ['cave']) || standAt(ISL[6].x, ISL[6].z)],
    ['Relic of the rings. You threaded the sky.', null, 1]
  ];
  const lastRing = RINGS[RINGS.length - 1];
  SH.forEach((s, i) => { const p = s[1] || [lastRing.x + lastRing.nx * 10, lastRing.y - 2, lastRing.z + lastRing.nz * 10]; SHARDS.push({ i, x: p[0], y: p[1], z: p[2], text: s[0], isle: islandIndexAt(p[0], p[2]), hidden: s[2] ? 1 : 0 }); });
  CAVE = NOOKS.find(n => n.kind === 'cave') || null;
  // ---- vistas: spire tops, the lighthouse, the lookout; standing on one counts toward the journal
  NOOKS.filter(n => n.kind === 'vista').forEach(n => VISTAS.push({ x: n.x + .5, y: n.y, z: n.z + .5, name: (ISL[n.isle] ? ISL[n.isle].name : 'Sky') + ' summit' }));
  VISTAS.push({ x: ISL[10].x + .5, y: hTop[ci(ISL[10].x, ISL[10].z)] + 1, z: ISL[10].z + .5, name: 'Lookout Rock' });
  // ---- the threshold of the Wilds: floating buoys with wind banners along the edge of the safe skies
  const buoy = (x, z) => { const y = 30 + Math.round(h2(x, z) * 5);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++){ put(x + dx, y, z + dz, STEP); if (!(dx && dz)) put(x + dx, y - 1, z + dz, DEEP); } put(x, y - 2, z, MOSS);
    for (let yy = y + 1; yy <= y + 5; yy++) put(x, yy, z, SIGN); lamp(x, y + 6, z); BUOYS.push({ x: x + .5, y: y + 5.4, z: z + .5 }); };
  for (let z = 16; z < SAFE; z += 34) buoy(SAFE - 5, z);
  for (let x = 16; x < SAFE - 12; x += 34) buoy(x, SAFE - 5);
  buoy(SAFE - 5, SAFE - 5);
}

/* ================= light (block light flood fill) ================= */
const LQN = 1 << 22, LQM = LQN - 1;
const lq = new Int32Array(LQN);
function floodAll(){
  light.fill(0); let qt = 0;
  for (let i = 0; i < world.length; i++){ const e = B_EMIT[world[i]]; if (e){ light[i] = e; lq[(qt++) & LQM] = i; } }
  bfs(0, qt, 0, 0, 0, WX - 1, WY - 1, WZ - 1);
}
function bfs(qh, qt, x0, y0, z0, x1, y1, z1){
  while (qh !== qt){
    const i = lq[qh & LQM]; qh++;
    const l = light[i]; if (l <= 1) continue;
    const x = i % WX, zz = (i / WX) | 0, z = zz % WZ, y = (zz / WZ) | 0, nl = l - 1;
    if (x > x0){ const j = i - 1; if (!B_OPQ[world[j]] && light[j] < nl){ light[j] = nl; lq[(qt++) & LQM] = j; } }
    if (x < x1){ const j = i + 1; if (!B_OPQ[world[j]] && light[j] < nl){ light[j] = nl; lq[(qt++) & LQM] = j; } }
    if (z > z0){ const j = i - WX; if (!B_OPQ[world[j]] && light[j] < nl){ light[j] = nl; lq[(qt++) & LQM] = j; } }
    if (z < z1){ const j = i + WX; if (!B_OPQ[world[j]] && light[j] < nl){ light[j] = nl; lq[(qt++) & LQM] = j; } }
    if (y > y0){ const j = i - LAYER; if (!B_OPQ[world[j]] && light[j] < nl){ light[j] = nl; lq[(qt++) & LQM] = j; } }
    if (y < y1){ const j = i + LAYER; if (!B_OPQ[world[j]] && light[j] < nl){ light[j] = nl; lq[(qt++) & LQM] = j; } }
  }
}
const relOld = new Uint8Array(27 * 27 * 27);
function relight(px, py, pz, out){
  const R = 12;
  const x0 = Math.max(0, px - R), y0 = Math.max(0, py - R), z0 = Math.max(0, pz - R), x1 = Math.min(WX - 1, px + R), y1 = Math.min(WY - 1, py + R), z1 = Math.min(WZ - 1, pz + R);
  let k = 0;
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++){ const i = wi(x, y, z); relOld[k++] = light[i]; light[i] = 0; }
  let qt = 0;
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++){ const i = wi(x, y, z); const e = B_EMIT[world[i]]; if (e){ light[i] = e; lq[(qt++) & LQM] = i; } }
  // shell seeds: cells just outside the box keep their light; push them so they spread inward
  const seed = (x, y, z) => { if (x < 0 || y < 0 || z < 0 || x >= WX || y >= WY || z >= WZ) return; const i = wi(x, y, z); if (light[i] > 1) lq[(qt++) & LQM] = i; };
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++){ seed(x0 - 1, y, z); seed(x1 + 1, y, z); }
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++){ seed(x, y, z0 - 1); seed(x, y, z1 + 1); }
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++){ seed(x, y0 - 1, z); seed(x, y1 + 1, z); }
  // bfs restricted: neighbours must be inside the box (shell cells only seed)
  let qh = 0;
  while (qh !== qt){
    const i = lq[qh & LQM]; qh++;
    const l = light[i]; if (l <= 1) continue;
    const x = i % WX, zz = (i / WX) | 0, z = zz % WZ, y = (zz / WZ) | 0, nl = l - 1;
    for (let f = 0; f < 6; f++){
      const nx = x + (f === 0 ? 1 : f === 1 ? -1 : 0), ny = y + (f === 2 ? 1 : f === 3 ? -1 : 0), nz = z + (f === 4 ? 1 : f === 5 ? -1 : 0);
      if (nx < x0 || nx > x1 || ny < y0 || ny > y1 || nz < z0 || nz > z1) continue;
      const j = wi(nx, ny, nz); if (!B_OPQ[world[j]] && light[j] < nl){ light[j] = nl; lq[(qt++) & LQM] = j; }
    }
  }
  let cx0 = 1e9, cy0 = 1e9, cz0 = 1e9, cx1 = -1, cy1 = -1, cz1 = -1; k = 0;
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++){ if (relOld[k++] !== light[wi(x, y, z)]){ if (x < cx0) cx0 = x; if (x > cx1) cx1 = x; if (y < cy0) cy0 = y; if (y > cy1) cy1 = y; if (z < cz0) cz0 = z; if (z > cz1) cz1 = z; } }
  if (cx1 < 0) return false;
  out[0] = cx0; out[1] = cy0; out[2] = cz0; out[3] = cx1; out[4] = cy1; out[5] = cz1; return true;
}

