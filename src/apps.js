/* apps.js: full-screen apps and small commands for the terminal (see CONTRACT.md, "Terminal extension API").
   tetris, snake, breakout (full-screen) and lamp (plain command).

   Drawing: VT323 has no block-element glyphs, so solid cells are drawn the way a real VT did it: inverse
   video spaces. A block's brightness comes from { fg: level, inverse: true } where level is one of the
   phosphor intensities 'faint' | 'dim' | 'normal' | 'bright'. Everything else is plain ASCII. */
(() => {
'use strict';
const M = window.MAC = window.MAC || {};
const T = M.TERM = M.TERM || { cmds: {}, apps: {} };
T.cmds = T.cmds || {}; T.apps = T.apps || {};

/* ---- shared helpers ---- */
const blk = level => ({ fg: level, inverse: true });
const brick = level => ({ fg: level, inverse: true, inset: true });   // a gap above and below, so rows of bricks stay apart
const secs = dt => (dt > 1 ? dt / 1000 : dt) || 0;          // accept seconds (or ms, defensively)
const hiGet = k => +T.store.get(k, 0) || 0, hiSet = T.store.set;   // terminal.js
const sound = (api, name) => { try { (api.sound || M.sound)?.event(name); } catch (e) {} };
const center = (scr, y, s, style) => scr.put(Math.max(0, ((scr.cols - s.length) / 2) | 0), y, s, style);
const pad = (n, w) => String(n).padStart(w, ' ');
const isQuit = k => k === 'q' || k === 'Q' || k === 'Escape';
const mq = q => typeof matchMedia === 'function' && matchMedia(q).matches;
const TOUCH = mq('(pointer: coarse)');                       // phones: tap zones instead of arrows
const REDUCED = mq('(prefers-reduced-motion: reduce)');
/* the game on screen pauses when the tab is hidden (a phone locked, an app switched to): the one running sets this */
let pauseNow = null;
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.hidden && pauseNow) try { pauseNow(); } catch (e) {} });
/* the phone's keyboard (main.js) marks its keys touchKey: they come with a keyup on release and never repeat on their
   own, so a game times held keys itself (desktops keep the system's key repeat) */
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
function box(scr, x, y, w, h, style){                       // ASCII frame, fill inside with spaces
  scr.fill(x, y, w, h, ' ', 'normal');
  scr.put(x, y, '+' + '-'.repeat(w - 2) + '+', style);
  for (let i = 1; i < h - 1; i++){ scr.put(x, y + i, '|', style); scr.put(x + w - 1, y + i, '|', style); }
  scr.put(x, y + h - 1, '+' + '-'.repeat(w - 2) + '+', style);
}

/* =====================================================================================
   TETRIS: SRS rotation + wall kicks, 7-bag, ghost, hold, next queue, lock delay
   ===================================================================================== */
const BW = 10;              // the well height adapts to the grid (BH, inside start)
const SHAPES = {            // spawn state (0) in an n x n box, SRS orientation
  I: ['....', '####', '....', '....'],
  O: ['##', '##'],
  T: ['.#.', '###', '...'],
  S: ['.##', '##.', '...'],
  Z: ['##.', '.##', '...'],
  J: ['#..', '###', '...'],
  L: ['..#', '###', '...'],
};
const LEVEL = { I: 'bright', O: 'normal', T: 'bright', S: 'dim', Z: 'dim', J: 'normal', L: 'normal' };
const STATES = {};          // STATES[p][r] = [[x,y]...] cells in the box
for (const p in SHAPES){
  const rows = SHAPES[p], n = rows.length;
  let cells = [];
  rows.forEach((row, y) => [...row].forEach((c, x) => { if (c === '#') cells.push([x, y]); }));
  STATES[p] = [];
  for (let r = 0; r < 4; r++){ STATES[p].push(cells); cells = cells.map(([x, y]) => [n - 1 - y, x]); }
  if (p === 'O') STATES[p] = [cells, cells, cells, cells];
}
// SRS kick data, y-up as published; applied with y negated (our y grows downward)
const K_JLSTZ = {
  '0>1': [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]], '1>0': [[0,0],[1,0],[1,-1],[0,2],[1,2]],
  '1>2': [[0,0],[1,0],[1,-1],[0,2],[1,2]],     '2>1': [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
  '2>3': [[0,0],[1,0],[1,1],[0,-2],[1,-2]],    '3>2': [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
  '3>0': [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],  '0>3': [[0,0],[1,0],[1,1],[0,-2],[1,-2]],
};
const K_I = {
  '0>1': [[0,0],[-2,0],[1,0],[-2,-1],[1,2]],   '1>0': [[0,0],[2,0],[-1,0],[2,1],[-1,-2]],
  '1>2': [[0,0],[-1,0],[2,0],[-1,2],[2,-1]],   '2>1': [[0,0],[1,0],[-2,0],[1,-2],[-2,1]],
  '2>3': [[0,0],[2,0],[-1,0],[2,1],[-1,-2]],   '3>2': [[0,0],[-2,0],[1,0],[-2,-1],[1,2]],
  '3>0': [[0,0],[1,0],[-2,0],[1,-2],[-2,1]],   '0>3': [[0,0],[-1,0],[2,0],[-1,2],[2,-1]],
};
const LINE_PTS = [0, 100, 300, 500, 800];
const gravity = lvl => Math.pow(Math.max(0.05, 0.8 - (lvl - 1) * 0.007), lvl - 1);   // seconds per row
const TETRIS_HI = 'kaiav.tetris.hi';

T.apps.tetris = {
  g: 'fun',
  desc: 'the falling blocks',
  usage: 'tetris',
  more: 'arrows move, \u2191 or x turns, z turns back, \u2193 drops a row, space drops all the way, c holds, p pauses, q quits. on a phone, the pad under the screen has the arrows, space and pause (hold an arrow to slide or soft-drop), or swipe the piece sideways, flick down to drop, and tap beside it to move or on it to turn.',
  start(api){
    /* the layout follows the grid, which can change under a running game (a phone turned on its side):
       SIDE is a slim panel beside a full-height well (phones), STACK puts the panel under the well (narrower still) */
    let SIDE, STACK, BH, gridC = 0, gridR = 0, board = [];
    function layout(cols, rows){
      if (cols === gridC && rows === gridR) return;
      gridC = cols; gridR = rows;
      SIDE = cols < 47 && cols >= 39; STACK = cols < 39;
      const h = Math.max(Math.max(4, Math.min(10, rows - 3)), Math.min(20, rows - (STACK ? 15 : TOUCH ? 3 : 2)));   // well + floor + feet (+ panel, + room to tap below) must fit; a short grid (a phone on its side) gets a shorter well
      if (h === BH) return;
      // a new well height keeps the bottom of the stack; the falling piece keeps its height above the floor
      const d = h - (BH || h);
      board = board.length ? (d >= 0 ? Array.from({ length: d }, () => Array(BW).fill(null)).concat(board) : board.slice(-d)) : Array.from({ length: h }, () => Array(BW).fill(null));
      BH = h;
      if (cur){ cur.y += d; while (!fits(cur.p, cur.r, cur.x, cur.y) && cur.y > -4) cur.y--; }
    }
    let bag = [], queue = [], cur = null, hold = null, canHold = true;
    layout(api.cols || 72, api.rows || 23);
    let score = 0, lines = 0, level = 1, hi = hiGet(TETRIS_HI), newHi = false;
    let fall = 0, lockT = 0, lockMoves = 0, paused = false, over = false, flash = null, t = 0, help = true;

    const draw = () => { if (!bag.length){ bag = Object.keys(SHAPES); for (let i = bag.length - 1; i > 0; i--){ const j = Math.random() * (i + 1) | 0; [bag[i], bag[j]] = [bag[j], bag[i]]; } } return bag.pop(); };
    const fill = () => { while (queue.length < 4) queue.push(draw()); };
    const cells = (p, r, x, y) => STATES[p][r].map(([cx, cy]) => [x + cx, y + cy]);
    const fits = (p, r, x, y) => cells(p, r, x, y).every(([cx, cy]) => cx >= 0 && cx < BW && cy < BH && (cy < 0 || !board[cy][cx]));
    function spawn(p){
      const n = SHAPES[p].length;
      cur = { p, r: 0, x: ((BW - n) / 2) | 0, y: p === 'I' ? -1 : 0 };
      fall = 0; lockT = 0; lockMoves = 0;
      if (!fits(cur.p, cur.r, cur.x, cur.y)){ cur.y--; if (!fits(cur.p, cur.r, cur.x, cur.y)) gameOver(); }
    }
    function next(){ fill(); spawn(queue.shift()); fill(); canHold = true; }
    const summary = () => api.print(`tetris: ${score} points, ${lines} lines, ` + (newHi ? 'a new best' : 'best ' + Math.max(hi, score)));
    function gameOver(){
      over = true;
      if (score > hi){ hi = score; newHi = true; hiSet(TETRIS_HI, hi); }
      sound(api, 'error');
    }
    const grounded = () => !fits(cur.p, cur.r, cur.x, cur.y + 1);
    function moved(){ if (grounded() && lockMoves < 15){ lockT = 0; lockMoves++; } }
    function shift(dx){ if (fits(cur.p, cur.r, cur.x + dx, cur.y)){ cur.x += dx; moved(); return true; } return false; }
    function rotate(dir){
      const to = (cur.r + dir + 4) % 4;
      if (cur.p === 'O'){ cur.r = to; return; }
      const kicks = (cur.p === 'I' ? K_I : K_JLSTZ)[cur.r + '>' + to];
      for (const [kx, ky] of kicks){
        if (fits(cur.p, to, cur.x + kx, cur.y - ky)){ cur.x += kx; cur.y -= ky; cur.r = to; moved(); return; }
      }
    }
    function ghostY(){ let y = cur.y; while (fits(cur.p, cur.r, cur.x, y + 1)) y++; return y; }
    function lock(){
      let above = true;
      for (const [x, y] of cells(cur.p, cur.r, cur.x, cur.y)){ if (y >= 0){ board[y][x] = cur.p; above = false; } }
      cur = null;
      if (above){ gameOver(); return; }
      const full = [];
      for (let y = 0; y < BH; y++) if (board[y].every(Boolean)) full.push(y);
      if (full.length){
        score += LINE_PTS[full.length] * level;
        flash = { rows: full, t: 0 };
        sound(api, 'beep');
      } else next();
    }
    function finishClear(){
      for (const y of flash.rows){ board.splice(y, 1); board.unshift(Array(BW).fill(null)); }
      lines += flash.rows.length;
      level = 1 + Math.floor(lines / 10);
      flash = null;
      next();
    }
    function hardDrop(){ const g = ghostY(); score += (g - cur.y) * 2; cur.y = g; lock(); }
    function doHold(){
      if (!canHold) return;
      const p = cur.p;
      if (hold){ spawn(hold); } else next();
      hold = p; canHold = false;
    }
    function restart(){
      for (const row of board) row.fill(null);
      bag = []; queue = []; hold = null; score = 0; lines = 0; level = 1; over = false; newHi = false; paused = false; flash = null;
      next();
    }
    next();
    let oyDrawn = 0, bxDrawn = 0;                            // where the well was last drawn (for taps)
    /* held keys on a phone: left / right auto-shift (a first move, then after 170 ms one every 50 ms), down soft-drops a
       row every 50 ms; a swipe moves a column per two grid columns, a row per row, and a quick flick down drops */
    let das = null, soft = null, sw = null;
    const softStep = () => { if (cur && fits(cur.p, cur.r, cur.x, cur.y + 1)){ cur.y++; score += 1; fall = 0; return true; } return false; };
    pauseNow = () => { if (!over) paused = true; das = soft = null; };

    return {
      /* taps: beside the falling piece moves it that way, on it turns it, below the well drops it */
      tap(col, row){
        help = false;
        /* the bottom row is the way out on a phone: the first tap pauses, the next one quits (the terminal
           treats a tap an app does not use, on that row, as esc) */
        if (TOUCH && row >= gridR - 1){ if (over || paused) return false; paused = true; return true; }
        if (over){ restart(); return true; }
        if (paused){ paused = false; return true; }
        if (!cur || flash) return true;
        if (row >= oyDrawn + BH){ hardDrop(); return true; }
        const xs = cells(cur.p, cur.r, cur.x, cur.y).map(([x]) => bxDrawn + x * 2);
        if (col < Math.min(...xs)) shift(-1);
        else if (col > Math.max(...xs) + 1) shift(1);
        else rotate(1);
        return true;
      },
      key(e){
        const k = e.key;
        help = false;
        if (over){
          if (k === 'Enter' || k === 'r' || k === 'R') restart();
          else if (isQuit(k)){ summary(); api.exit(0); }
          return true;
        }
        if (isQuit(k)){ if (score > hi){ hi = score; newHi = true; hiSet(TETRIS_HI, score); } summary(); api.exit(0); return true; }
        if (k === 'p' || k === 'P'){ paused = !paused; return true; }
        if (paused || !cur || flash) return true;
        if (e.touchKey && !e.repeat){
          if (k === 'ArrowLeft' || k === 'ArrowRight'){ const d = k === 'ArrowLeft' ? -1 : 1; shift(d); das = { d, k, t: 0, next: 0.17 }; return true; }
          if (k === 'ArrowDown'){ softStep(); soft = { t: 0, next: 0.1 }; return true; }
        }
        switch (k){
          case 'ArrowLeft': shift(-1); break;
          case 'ArrowRight': shift(1); break;
          case 'ArrowDown': if (fits(cur.p, cur.r, cur.x, cur.y + 1)){ cur.y++; score += 1; fall = 0; } break;
          case 'ArrowUp': case 'x': case 'X': rotate(1); break;
          case 'z': case 'Z': case 'Control': rotate(-1); break;
          case ' ': hardDrop(); break;
          case 'c': case 'C': case 'Shift': doHold(); break;
          default: return true;
        }
        return true;
      },
      keyUp(e){
        if (das && e.key === das.k) das = null;
        if (e.key === 'ArrowDown') soft = null;
        return false;
      },
      drag(col, row, phase){
        if (phase === 'start'){ sw = { c: col, r: row, r0: row, t0: now(), used: false }; return false; }
        if (!sw) return false;
        const g = sw;
        if (phase === 'end') sw = null;
        if (over || paused || !cur || flash) return g.used;
        help = false;
        while (col - g.c >= 2){ shift(1); g.c += 2; g.used = true; }
        while (g.c - col >= 2){ shift(-1); g.c -= 2; g.used = true; }
        while (row - g.r >= 1){ softStep(); g.r += 1; g.used = true; }
        if (g.r - row > 1) g.r = row + 1;                    // a finger going back up does not bank rows
        if (phase === 'end' && row - g.r0 > 2 && (row - g.r0) / Math.max(0.01, now() - g.t0) > 18 && cur){ hardDrop(); g.used = true; }   // a flick down
        return g.used;
      },
      tick(dt){
        dt = Math.min(secs(dt), 0.1); t += dt;
        if (over || paused) return Math.floor(t * 2) !== Math.floor((t - dt) * 2);   // blink prompts
        if (flash){ flash.t += dt; if (flash.t > 0.36) finishClear(); return true; }
        if (!cur) return false;
        let held = false;
        if (das){ das.t += dt; while (das && das.t >= das.next){ das.next += 0.05; if (!shift(das.d)) break; held = true; } }
        if (soft){ soft.t += dt; while (soft && soft.t >= soft.next && cur){ soft.next += 0.05; if (!softStep()) break; held = true; } }
        if (held) return true;
        if (grounded()){
          lockT += dt;
          if (lockT >= 0.5) lock();
          return true;
        }
        fall += dt;
        const g = gravity(level);
        let dirty = false;
        while (fall >= g && cur && !grounded()){ fall -= g; cur.y++; lockT = 0; dirty = true; }
        return dirty;
      },
      render(scr){
        layout(scr.cols, scr.rows);
        scr.clear(); scr.cursor(0, 0, null);
        const W = BW * 2 + 4;
        const compact = STACK || SIDE || scr.cols < 64 || scr.rows < 22;      // one panel, beside the well or under it
        const ox = STACK ? Math.max(0, ((scr.cols - W) / 2) | 0) : SIDE ? Math.max(0, ((scr.cols - W - 15) / 2) | 0) : compact ? Math.max(0, ((scr.cols - (W + 3 + 20)) / 2) | 0) : ((scr.cols - W) / 2) | 0;
        const oy = TOUCH && !STACK ? Math.max(0, Math.min(2, scr.rows - BH - 7)) : Math.max(0, ((scr.rows - BH - 2 - (STACK ? 13 : 0)) / 2) | 0); oyDrawn = oy;
        const bx = ox + 2; bxDrawn = bx;  // first board column
        // well: classic "<!" ... "!>" sides
        for (let y = 0; y < BH; y++){
          scr.put(ox, oy + y, '<!', 'faint'); scr.put(bx + BW * 2, oy + y, '!>', 'faint');
          scr.put(bx, oy + y, ' .'.repeat(BW), 'faint');
        }
        scr.put(ox, oy + BH, '<!' + '='.repeat(BW * 2) + '!>', 'faint');
        scr.put(bx, oy + BH + 1, '\\/'.repeat(BW), 'faint');
        // settled blocks (flashing rows alternate bright / blank)
        const flashOn = flash && Math.floor(flash.t / 0.06) % 2 === 0;
        for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++){
          const c = board[y][x]; if (!c) continue;
          if (flash && flash.rows.includes(y)){ if (flashOn) scr.put(bx + x * 2, oy + y, '  ', blk('bright')); else scr.put(bx + x * 2, oy + y, '  ', 'normal'); continue; }
          scr.put(bx + x * 2, oy + y, '  ', blk(LEVEL[c] === 'bright' ? 'normal' : LEVEL[c]));
        }
        if (cur){
          const gy = ghostY();
          if (gy !== cur.y) for (const [x, y] of cells(cur.p, cur.r, cur.x, gy)) if (y >= 0) scr.put(bx + x * 2, oy + y, '[]', 'faint');
          for (const [x, y] of cells(cur.p, cur.r, cur.x, cur.y)) if (y >= 0) scr.put(bx + x * 2, oy + y, '  ', blk('bright'));
        }
        // mini piece preview
        const mini = (p, x, y, level) => { if (!p) return; const n = SHAPES[p].length; const off = n === 4 ? 0 : 1;
          for (const [cx, cy] of STATES[p][0]) scr.put(x + (cx + off) * 2, y + cy - (p === 'I' ? 1 : 0), '  ', blk(level)); };
        if (SIDE){
          // a slim column: next, hold, the numbers, then how to play
          const rx = ox + W + 1, ry = oy;
          scr.put(rx, ry, 'NEXT', 'dim'); mini(queue[0], rx, ry + 1, 'bright');
          const ny = TOUCH ? ry + 4 : ry + 8;                           // a phone has no hold key, so no hold box
          if (!TOUCH){ scr.put(rx, ry + 4, 'HOLD', canHold ? 'dim' : 'faint'); mini(hold, rx, ry + 5, canHold ? 'normal' : 'faint'); }
          [['SCORE', score, 'bright'], ['HIGH', Math.max(hi, score), score > hi ? 'bright' : 'normal'], ['LEVEL', level, 'normal'], ['LINES', lines, 'normal']]
            .forEach(([a, v, st], i) => { scr.put(rx, ny + i, a.padEnd(6), 'dim'); scr.put(rx + 6, ny + i, String(v), st); });
          const ks = TOUCH ? [['\u2190\u2192', 'move'], ['\u2191', 'turn'], ['\u2193', 'soft'], ['spc', 'drop'], ['swipe', 'move'], ['flick', 'drop']]
            : [['\u2190\u2192', 'move'], ['\u2191', 'turn'], ['spc', 'drop'], ['c', 'hold'], ['p', 'pause'], ['q', 'quit']];
          ks.forEach(([a, b], i) => { const y = ny + 5 + i; if (y >= scr.rows - 1) return; scr.put(rx, y, a.padEnd(7), b ? 'normal' : 'faint'); scr.put(rx + 7, y, b, 'faint'); });
        } else if (compact){
          const rx = STACK ? ox + 2 : ox + W + 3, ry = STACK ? oy + BH + 3 : oy;
          scr.put(rx, ry, 'NEXT', 'dim'); mini(queue[0], rx, ry + 1, 'bright');
          scr.put(rx + 10, ry, 'HOLD', canHold ? 'dim' : 'faint'); mini(hold, rx + 10, ry + 1, canHold ? 'normal' : 'faint');
          [['SCORE', score, 'bright'], ['HIGH', Math.max(hi, score), score > hi ? 'bright' : 'normal'], ['LEVEL', level, 'normal'], ['LINES', lines, 'normal']]
            .forEach(([a, v, st], i) => { scr.put(rx, ry + 4 + i, a.padEnd(7), 'dim'); scr.put(rx + 7, ry + 4 + i, String(v), st); });
          const ks = [['\u2190\u2192', 'move'], ['\u2191 x', 'turn'], ['space', 'drop'], ['c', 'hold'], ['p', 'pause'], ['q', 'quit']];
          const ky = ry + 9, two = STACK || scr.rows - ky < ks.length;
          const short = TOUCH ? [['\u2190\u2192', 'move'], ['\u2191', 'turn'], ['spc', 'drop'], ['swp', 'move']]
            : [['\u2190\u2192', 'move'], ['\u2191', 'turn'], ['spc', 'drop'], ['c', 'hold'], ['p', 'pause'], ['q', 'quit']];
          (two ? short : ks).forEach(([a, b], i) => {
            const x = rx + (two ? (i % 2) * (TOUCH ? 15 : 11) : 0), y = ky + (two ? i >> 1 : i);
            if (y >= scr.rows) return;
            scr.put(x, y, two ? a.padEnd(4) : a.padEnd(7), 'normal'); scr.put(x + (two ? 4 : 7), y, b, 'faint');
          });
        } else {
        // left panel: hold + score
        const lx = ox - 16;
        scr.put(lx, oy, 'HOLD', 'dim'); scr.put(lx + 5, oy, canHold ? '' : '(used)', 'faint');
        mini(hold, lx, oy + 2, canHold ? 'normal' : 'faint');
        scr.put(lx, oy + 6, 'SCORE', 'dim'); scr.put(lx, oy + 7, pad(score, 8), 'bright');
        scr.put(lx, oy + 9, 'HIGH', 'dim'); scr.put(lx, oy + 10, pad(Math.max(hi, score), 8), score > hi ? 'bright' : 'normal');
        scr.put(lx, oy + 12, 'LEVEL', 'dim'); scr.put(lx, oy + 13, pad(level, 8), 'normal');
        scr.put(lx, oy + 15, 'LINES', 'dim'); scr.put(lx, oy + 16, pad(lines, 8), 'normal');
        // right panel: next queue + keys
        const rx = ox + W + 4;
        scr.put(rx, oy, 'NEXT', 'dim');
        mini(queue[0], rx, oy + 2, 'bright');
        mini(queue[1], rx, oy + 6, 'dim');
        mini(queue[2], rx, oy + 9, 'faint');
        const keys = [['\u2190\u2192', 'move'], ['\u2191 x', 'turn'], ['z', 'turn back'], ['\u2193', 'soft drop'], ['space', 'hard drop'], ['c', 'hold'], ['p', 'pause'], ['q', 'quit']];
        keys.forEach(([a, b], i) => { scr.put(rx, oy + 13 + i, a.padEnd(7), 'normal'); scr.put(rx + 7, oy + 13 + i, b, 'faint'); });
        }
        // overlays
        const cardX = bx + 1, cardW = BW * 2 - 2;
        if (paused){
          box(scr, cardX, oy + 7, cardW, 5, 'dim');
          scr.put(cardX + ((cardW - 6) / 2 | 0), oy + 8, 'PAUSED', 'bright');
          const go = TOUCH ? 'tap to resume' : 'p to resume';
          scr.put(cardX + ((cardW - go.length) / 2 | 0), oy + 10, go, 'dim');
        } else if (over){
          const top = Math.max(0, Math.min(5, BH - 10));
          box(scr, cardX, oy + top, cardW, 10, 'normal');
          const c = (y, s, st) => scr.put(cardX + ((cardW - s.length) / 2 | 0), oy + top + y - 5, s, st);
          c(6, 'GAME  OVER', 'bright');
          c(8, 'score ' + score, 'normal');
          c(9, lines + ' lines  lvl ' + level, 'dim');
          c(10, newHi ? 'new high score' : 'best ' + hi, newHi ? 'accent' : 'dim');
          if (REDUCED || Math.floor(t * 2) % 2 === 0) c(12, TOUCH ? 'tap again' : 'enter again', 'normal');
          if (!TOUCH) c(13, 'q quit', 'faint');
        } else if (help && score === 0){
          scr.put(bx + 3, oy + 3, TOUCH ? 'arrows or swipe' : 'arrows to play', 'dim');
        }
        if (TOUCH) center(scr, scr.rows - 1, paused || over ? 'tap here to quit' : 'tap here to pause', 'faint');
      },
    };
  },
};

/* =====================================================================================
   SNAKE: buffered turns, speed-up, high score, pause, game-over card
   ===================================================================================== */
const SNAKE_HI = 'kaiav.snake.hi';
T.apps.snake = {
  g: 'fun',
  desc: 'the snake game',
  usage: 'snake',
  more: 'eat, grow, and stay off the walls and your own tail. arrows or wasd turn, p pauses, q quits. on a phone, use the pad\'s arrows, swipe the way to go, or tap beside the head.',
  start(api){
    let cols = api.cols || 72, rows = api.rows || 23;
    let GW = Math.floor((cols - 2) / 2), GH = rows - 3;      // cells are 2 columns wide, so they look square
    const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const KEYMAP = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right', k: 'up', j: 'down', h: 'left', l: 'right' };
    let body, dir, queue, food, score, step, acc, paused, over, hi = hiGet(SNAKE_HI), newHi, t = 0, started, eaten;
    const summary = () => api.print(`snake: ${score} points, length ${body.length}, ` + (newHi ? 'a new best' : 'best ' + Math.max(hi, score)));
    function placeFood(){
      const taken = new Set(body.map(([x, y]) => x + ',' + y));
      if (taken.size >= GW * GH) return null;
      let p; do { p = [Math.random() * GW | 0, Math.random() * GH | 0]; } while (taken.has(p[0] + ',' + p[1]));
      return p;
    }
    function reset(){
      const cx = GW / 2 | 0, cy = GH / 2 | 0;
      body = [[cx, cy], [cx - 1, cy], [cx - 2, cy], [cx - 3, cy]];
      dir = 'right'; queue = []; score = 0; eaten = 0; step = 0.13; acc = 0; paused = false; over = false; newHi = false; started = false;
      food = placeFood();
    }
    reset();
    const opposite = (a, b) => DIRS[a][0] === -DIRS[b][0] && DIRS[a][1] === -DIRS[b][1];
    function advance(){
      // take the next buffered turn that is a real change; skip ones made illegal by the queue itself
      while (queue.length){ const d = queue.shift(); if (d !== dir && !opposite(d, dir)){ dir = d; break; } }
      const [dx, dy] = DIRS[dir];
      const head = [body[0][0] + dx, body[0][1] + dy];
      const willEat = food && head[0] === food[0] && head[1] === food[1];
      const tailIdx = willEat ? body.length : body.length - 1;   // the tail moves away this step unless we grow
      const hit = head[0] < 0 || head[1] < 0 || head[0] >= GW || head[1] >= GH ||
        body.some(([x, y], i) => i < tailIdx && x === head[0] && y === head[1]);
      if (hit){
        over = true;
        if (score > hi){ hi = score; newHi = true; hiSet(SNAKE_HI, hi); }
        sound(api, 'error');
        return;
      }
      body.unshift(head);
      if (willEat){
        eaten++; score += 10 + Math.floor(eaten / 5) * 5;
        step = Math.max(0.05, step * 0.965);
        food = placeFood();
        sound(api, 'beep');
      } else body.pop();
    }
    let headAt = [0, 0];                                     // the head's screen cell, from the last render
    function turn(d){
      const last = queue.length ? queue[queue.length - 1] : dir;
      if (d !== last && !opposite(d, last) && queue.length < 3) queue.push(d);
    }
    pauseNow = () => { if (started && !over) paused = true; };
    let sw = null;                                           // a swipe on the field: each stretch of a cell or so is a turn
    return {
      drag(col, row, phase){
        if (phase === 'start'){ sw = { c: col, r: row, used: false }; return false; }
        if (!sw) return false;
        const g = sw; if (phase === 'end') sw = null;
        if (over || paused) return g.used;
        const dx = (col - g.c) / 2, dy = row - g.r;
        if (Math.max(Math.abs(dx), Math.abs(dy)) >= 1){
          started = true; turn(Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down'));
          g.c = col; g.r = row; g.used = true;
        }
        return g.used;
      },
      /* phones: tap on the side of the head you want to go; the snake turns that way */
      tap(col, row){
        if (TOUCH && row >= rows - 1){ if (over || paused || !started) return false; paused = true; return true; }   // the bottom edge: pause, then quit
        if (over){ reset(); return true; }
        if (paused){ paused = false; return true; }
        started = true;
        const last = queue.length ? queue[queue.length - 1] : dir;
        const dx = (col - headAt[0]) / 2, dy = row - headAt[1];
        if (last === 'left' || last === 'right'){ if (dy) turn(dy < 0 ? 'up' : 'down'); }
        else if (dx) turn(dx < 0 ? 'left' : 'right');
        return true;
      },
      key(e){
        const k = e.key;
        if (over){
          if (k === 'Enter' || k === 'r' || k === 'R') reset();
          else if (isQuit(k)){ summary(); api.exit(0); }
          return true;
        }
        if (isQuit(k)){ if (score > hi){ hi = score; newHi = true; hiSet(SNAKE_HI, score); } if (started) summary(); api.exit(0); return true; }
        if (k === 'p' || k === 'P' || (k === ' ' && started)){ paused = !paused; return true; }
        const d = KEYMAP[k];
        if (d && !paused){ started = true; turn(d); }
        else if (!started && (k === ' ' || k === 'Enter')) started = true;
        return true;
      },
      tick(dt){
        dt = Math.min(secs(dt), 0.1); t += dt;
        if (over || paused || !started) return Math.floor(t * 2) !== Math.floor((t - dt) * 2);
        acc += dt;
        let dirty = false;
        while (acc >= step && !over){ acc -= step; advance(); dirty = true; }
        return dirty;
      },
      render(scr){
        if (scr.cols !== cols || scr.rows !== rows){            // the grid changed (a phone turned): a new field when the snake fits in it
          cols = scr.cols; rows = scr.rows;
          const w = Math.floor((cols - 2) / 2), h = rows - 3;
          if (!started || over){ GW = w; GH = h; reset(); }
          else {
            // slide the snake in if it is small enough for the new field, and pause so the player can find it again
            const xs = body.map(p => p[0]), ys = body.map(p => p[1]);
            const dx = Math.min(0, w - 1 - Math.max(...xs)), dy = Math.min(0, h - 1 - Math.max(...ys));
            if (Math.max(...xs) - Math.min(...xs) < w && Math.max(...ys) - Math.min(...ys) < h){
              if (dx || dy){ body = body.map(([x, y]) => [x + dx, y + dy]); paused = true; }
              GW = w; GH = h; if (!food || food[0] >= w || food[1] >= h) food = placeFood();
            } else paused = true;                               // too long to fit: keep the old field until it fits again
          }
        }
        scr.clear(); scr.cursor(0, 0, null);
        const ox = Math.max(0, ((scr.cols - GW * 2 - 2) / 2) | 0), oy = 1;
        // status line
        scr.put(ox, 0, 'SNAKE', 'bright');
        scr.put(ox + 8, 0, 'score ' + score, 'normal');
        scr.put(ox + 22, 0, 'length ' + body.length, 'dim');
        const hs = 'best ' + Math.max(hi, score);
        scr.put(ox + GW * 2 + 2 - hs.length, 0, hs, score > hi && hi > 0 ? 'bright' : 'dim');
        // walls
        scr.put(ox, oy, '+' + '-'.repeat(GW * 2) + '+', 'faint');
        for (let y = 0; y < GH; y++){ scr.put(ox, oy + 1 + y, '|', 'faint'); scr.put(ox + GW * 2 + 1, oy + 1 + y, '|', 'faint'); }
        scr.put(ox, oy + GH + 1, '+' + '-'.repeat(GW * 2) + '+', 'faint');
        const at = (x, y, s, st) => scr.put(ox + 1 + x * 2, oy + 1 + y, s, st);
        // food blinks gently
        if (food) at(food[0], food[1], '<>', REDUCED || Math.floor(t * 3) % 3 ? 'bright' : 'normal');
        // body: tail fades through the phosphor levels
        const n = body.length;
        for (let i = n - 1; i >= 1; i--){
          const f = i / n;
          at(body[i][0], body[i][1], '  ', blk(f < 0.5 ? 'normal' : f < 0.85 ? 'dim' : 'faint'));
        }
        const [hx, hy] = body[0];
        headAt = [ox + 1 + hx * 2, oy + 1 + hy];
        at(hx, hy, over ? 'xx' : '  ', blk('bright'));
        // the cards sit in the middle; the one before the start sits higher, so the snake shows under it
        const cw = Math.min(GW * 2 - 2, 34), cx = ox + 1 + ((GW * 2 - cw) / 2 | 0), cy = started || over ? oy + ((GH - 9) / 2 | 0) + 1 : oy + 1;
        const c = (y, s, st) => scr.put(cx + ((cw - s.length) / 2 | 0), cy + y, s, st);
        if (over && GH < 12){
          const m = ' game over \u00b7 ' + score + ' points \u00b7 ' + (TOUCH ? 'tap' : 'enter') + ' again ';
          scr.put(ox + 1 + Math.max(0, (GW * 2 - m.length) / 2 | 0), oy, m.slice(0, GW * 2), 'bright');
        } else if (over){
          box(scr, cx, cy, cw, 10, 'normal');
          c(1, 'G A M E   O V E R', 'bright');
          c(3, score + ' points', 'normal');
          c(4, 'length ' + n + '   apples ' + eaten, 'dim');
          c(6, newHi ? 'new high score' : 'best ' + hi, newHi ? 'accent' : 'dim');
          c(8, TOUCH ? 'tap again' : 'enter again  \u00b7  q quit', REDUCED || Math.floor(t * 2) % 2 === 0 ? 'normal' : 'dim');
        } else if (paused && GH < 12){                          // a short field: say it on the wall, not over the snake
          const m = ' paused \u00b7 ' + (TOUCH ? 'tap' : 'p') + ' to resume ';
          scr.put(ox + 1 + ((GW * 2 - m.length) / 2 | 0), oy, m, 'bright');
        } else if (paused){
          box(scr, cx, cy + 2, cw, 5, 'dim');
          c(3, 'PAUSED', 'bright'); c(5, TOUCH ? 'tap to resume' : 'p to resume', 'dim');
        } else if (!started){
          box(scr, cx, cy + 1, cw, 7, 'dim');
          c(2, 'S N A K E', 'bright');
          c(4, TOUCH ? 'arrows or a swipe to turn' : 'arrows or wasd to start', 'normal');
          c(5, TOUCH ? 'an arrow starts it' : 'p pause  \u00b7  q quit', 'faint');
        }
        if (TOUCH) center(scr, scr.rows - 1, paused || over || !started ? ' tap here to quit ' : ' tap here to pause ', 'faint');
      },
    };
  },
};

/* =====================================================================================
   BREAKOUT: a wall of bricks, a paddle and a ball. Where the ball meets the paddle sets its angle.
   The ball and the paddle are drawn as vectors at float positions (scr.dot, scr.bar), so they glide rather
   than hop from cell to cell. Physics runs at a fixed 240 Hz in square units (a cell's width; heights are
   rows times the cell aspect), so 45 degrees looks like 45 degrees and the speed is the same in every
   direction. The ball is a circle against the bricks' and walls' boxes: it cannot pass through a brick, and
   it takes at most one per step.
   ===================================================================================== */
const BREAKOUT_HI = 'kaiav.breakout.hi';
T.apps.breakout = {
  g: 'fun',
  desc: 'knock out the bricks',
  usage: 'breakout',
  more: 'keep the ball in play with the paddle and clear the wall. where the ball lands on the paddle sets its angle. arrows (or a and d) move, space serves and pauses, q quits. three balls; each wall cleared brings a faster one. on a phone, hold the pad\'s arrows, drag anywhere on the screen, or tap where the paddle should go; space serves.',
  start(api){
    const PTS = [7, 5, 3, 2, 1], LV = ['bright', 'normal', 'normal', 'dim', 'dim'];
    const SH = r => (r % 2) * 2;                          // odd rows sit half a brick over, so the wall reads as bricks, not columns
    let cols = 0, rows = 0, IW, FH, PR, PW, BT, NR, NB, OFF, bricks = [], left = 0, full = 0;
    let px = 0, bx = 0, by = 0, vx = 0, vy = 0, speed = 0, target = null, A = 2.25, acc = 0;   // bx, by: the ball's centre in cells; vx, vy in square units per second
    const RB = 0.34, STEP = 1 / 240;                      // the ball's radius in cell widths; the physics step
    const GLOW = [null, { fg: 'rgba(200, 245, 184, 0.42)' }, { fg: 'rgba(200, 245, 184, 0.24)' }, { fg: 'rgba(200, 245, 184, 0.12)' }];   // translucent, so a ghost over a brick does not cut it
    const trail = new Float32Array(8); let tn = 0, pbx = 0, pby = 0;       // the last four drawn positions: the phosphor's afterglow
    let state = 'serve', paused = false, score = 0, balls = 3, level = 1, hi = hiGet(BREAKOUT_HI), newHi = false, t = 0, last = '';
    const held = { l: 0, r: 0 }; let gotUp = false;
    const isHeld = d => held[d] > 0 && (gotUp || t - held[d] < 0.15);
    const base = () => 24 * Math.min(1.5, 1 + (level - 1) * 0.1);
    const padTop = () => (PR + 0.2) * A;                  // the paddle's top edge, square units
    function wall(){
      bricks = []; left = 0;
      for (let r = 0; r < NR; r++){ const row = new Array(NB).fill(false); for (let c = 0; c < NB && OFF + SH(r) + c * 4 + 3 <= IW; c++){ row[c] = true; left++; } bricks.push(row); }
      full = left;
    }
    function layout(c, r){
      cols = c; rows = r;
      IW = Math.min(c - 2, 62); FH = r - 3;               // inner field: rows 2..r-2; the bottom row lists the keys
      PW = IW < 44 ? 6 : 8;
      PR = FH - (TOUCH ? 3 : 2);                          // phones keep the paddle clear of the tap-to-quit row
      NR = FH >= 16 ? 5 : 4; BT = FH >= 26 ? 3 : 1;
      NB = Math.floor((IW - 1) / 4); OFF = Math.max(0, Math.floor((IW - NB * 4 - 1) / 2));   // (the half-brick stagger takes 2 more columns)
      px = Math.max(0, Math.min(IW - PW, px || (IW - PW) / 2));
    }
    function serve(){ state = 'serve'; vx = vy = 0; target = null; tn = 0; }
    const aim = a => { vx = speed * Math.sin(a); vy = -speed * Math.cos(a); };   // a: radians from straight up
    function launch(){ state = 'play'; speed = base(); acc = 0; tn = 0; pbx = bx; pby = by; aim((Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.25)); }
    function restart(){ score = 0; balls = 3; level = 1; newHi = false; paused = false; wall(); serve(); }
    function hit([r, c]){
      bricks[r][c] = false; left--; score += PTS[r] * level;
      sound(api, 'beep');
      if (!left){ level++; wall(); serve(); }
    }
    function lose(){
      balls--; sound(api, 'error');
      if (balls > 0){ serve(); return; }
      state = 'over';
      if (score > hi){ hi = score; newHi = true; hiSet(BREAKOUT_HI, hi); }
    }
    function step(h){
      let x = bx + vx * h, Y = by * A + vy * h;
      if (x < RB){ x = RB; vx = Math.abs(vx); }
      if (x > IW - RB){ x = IW - RB; vx = -Math.abs(vx); }
      if (Y < RB){ Y = RB; vy = Math.abs(vy); }
      /* bricks: the first one the ball's circle overlaps, pushed out along the shallower side */
      const r0 = Math.max(0, Math.floor((Y - RB) / A) - BT), r1 = Math.min(NR - 1, Math.floor((Y + RB) / A) - BT);
      for (let r = r0; r <= r1; r++){
        const sx = OFF + SH(r), c0 = Math.max(0, Math.floor((x - RB - sx) / 4)), c1 = Math.min(NB - 1, Math.floor((x + RB - sx) / 4));
        for (let c = c0; c <= c1; c++){
          if (!bricks[r][c]) continue;
          const L = sx + c * 4, T0 = (BT + r) * A, cx = Math.max(L, Math.min(L + 3, x)), cy = Math.max(T0, Math.min(T0 + A, Y));
          const dx = x - cx, dy = Y - cy;
          if (dx * dx + dy * dy >= RB * RB) continue;
          if (Math.abs(dx) > Math.abs(dy)){ if (dx * vx < 0 || !dx) vx = -vx; x = cx + (dx < 0 ? -RB : RB); }
          else { if (dy * vy < 0 || !dy) vy = -vy; Y = cy + (dy < 0 || (!dy && vy < 0) ? -RB : RB); }
          bx = x; by = Y / A; hit([r, c]);
          return;
        }
      }
      /* the paddle: the farther from its middle, the steeper the way back out (up to 60 degrees) */
      const pt = padTop();
      if (vy > 0 && Y + RB >= pt && by * A + RB <= pt + 0.5 && x >= px - RB && x <= px + PW + RB){
        const off = Math.max(-1, Math.min(1, (x - (px + PW / 2)) / (PW / 2 + RB)));
        speed = Math.min(base() * 1.25, speed * 1.01);
        aim(off * 1.05); Y = pt - RB;
      }
      bx = x; by = Y / A;
      if (Y - RB > FH * A) lose();
    }
    const summary = () => api.print('breakout: ' + score + ' points, level ' + level + ', ' + (newHi ? 'a new best' : 'best ' + Math.max(hi, score)));
    function quit(){ if (score > hi){ hi = score; newHi = true; hiSet(BREAKOUT_HI, score); } if (score) summary(); api.exit(0); }
    layout(api.cols || 54, api.rows || 18); wall(); serve();
    pauseNow = () => { if (state !== 'over') paused = true; };
    let sw = null;                                        // a finger on the field steers: the paddle's middle follows it
    return {
      drag(col, row, phase){
        if (phase === 'start'){ sw = { c: col, used: false }; return false; }
        if (!sw) return false;
        const g = sw; if (phase === 'end') sw = null;
        if (state === 'over' || paused) return g.used;
        if (!g.used && Math.abs(col - g.c) < 0.6) return false;   // not yet a drag: maybe a tap (serve)
        g.used = true; held.l = held.r = 0;
        const x = col - 1 - Math.floor((cols - 2 - IW) / 2) - PW / 2;
        px = Math.max(0, Math.min(IW - PW, x)); target = null;
        return true;
      },
      tap(col, row){
        if (TOUCH && row >= rows - 1){ if (state === 'over' || paused) return false; paused = true; return true; }   // the bottom edge: pause, then quit
        if (state === 'over'){ restart(); return true; }
        if (paused){ paused = false; return true; }
        if (state === 'serve'){ launch(); return true; }
        target = col - 1 - Math.floor((cols - 2 - IW) / 2) - PW / 2;   // glide the paddle's middle to the tap
        return true;
      },
      key(e){
        const k = e.key;
        if (state === 'over'){
          if (k === 'Enter' || k === ' ' || k === 'r' || k === 'R') restart();
          else if (isQuit(k)){ summary(); api.exit(0); }
          return true;
        }
        if (isQuit(k)){ quit(); return true; }
        const d = k === 'ArrowLeft' || k === 'a' || k === 'A' || k === 'h' ? 'l' : k === 'ArrowRight' || k === 'd' || k === 'D' || k === 'l' ? 'r' : '';
        if (e.touchKey) gotUp = true;                     // a phone's key always comes back up (keyUp)
        if (d){ held[d] = t || 1e-6; target = null; return true; }
        if (k === ' ' || k === 'ArrowUp' || k === 'Enter'){ if (state === 'serve' && !paused) launch(); else if (k === ' ') paused = !paused; return true; }
        if (k === 'p' || k === 'P'){ paused = !paused; return true; }
        return true;
      },
      keyUp(e){
        gotUp = true;
        const k = e.key;
        if (k === 'ArrowLeft' || k === 'a' || k === 'A' || k === 'h') held.l = 0;
        if (k === 'ArrowRight' || k === 'd' || k === 'D' || k === 'l') held.r = 0;
        return false;
      },
      tick(dt){
        dt = Math.min(secs(dt), 0.1); t += dt;
        if (state !== 'over' && !paused){
          const dir = (isHeld('r') ? 1 : 0) - (isHeld('l') ? 1 : 0);
          if (dir) px += dir * 42 * dt;
          else if (target != null){ const d = target - px, s = 60 * dt; px += Math.abs(d) <= s ? d : Math.sign(d) * s; if (Math.abs(d) <= s) target = null; }
          px = Math.max(0, Math.min(IW - PW, px));
          if (state === 'serve'){ bx = px + PW / 2; by = (padTop() - RB) / A; }
          else {
            for (acc += dt; acc >= STEP && state === 'play'; acc -= STEP){ pbx = bx; pby = by; step(STEP); }
            /* drawn between the last two physics states, so frames that fall between steps still move evenly */
            const f = state === 'play' ? acc / STEP : 1;
            trail.copyWithin(2, 0, 6); trail[0] = pbx + (bx - pbx) * f; trail[1] = pby + (by - pby) * f; tn = Math.min(4, tn + 1);
          }
        }
        if (state === 'play' && !paused) return true;             // the ball moves every frame
        const blink = REDUCED ? 0 : Math.floor(t * 2) % 2;
        const key = [Math.round(px * 20), left, score, balls, level, state, paused, blink].join();
        if (key === last) return false;
        last = key; return true;
      },
      render(scr){
        if (scr.cols !== cols || scr.rows !== rows){            // the grid changed (a phone turned): the same game on a new field
          const fx = IW ? (px + PW / 2) / IW : 0.5, kept = left === full;
          layout(scr.cols, scr.rows); px = Math.max(0, Math.min(IW - PW, fx * IW - PW / 2));
          if (kept || bricks.length !== NR || bricks[0].length !== NB) wall();
          if (state === 'play'){ serve(); paused = true; }
        }
        if (scr.aspect > 0) A = scr.aspect;                       // (by is in rows, so a new aspect needs nothing else)
        scr.clear(); scr.cursor(0, 0, null);
        const ox = Math.max(0, ((scr.cols - IW - 2) / 2) | 0), x0 = ox + 1, top = 2;
        scr.put(ox, 0, 'BREAKOUT', 'bright');
        scr.put(ox + 10, 0, 'score ' + score, 'normal');
        if (IW >= 40) scr.put(ox + 22, 0, 'level ' + level, 'dim');
        const bs = 'best ' + Math.max(hi, score), lv = 'o '.repeat(Math.max(0, balls - (state === 'serve' ? 1 : 0))).trim();
        scr.put(ox + IW + 2 - bs.length, 0, bs, score > hi && hi > 0 ? 'bright' : 'dim');
        if (lv) scr.put(ox + IW + 2 - bs.length - lv.length - 3, 0, lv, 'dim');
        scr.put(ox, 1, '+' + '-'.repeat(IW) + '+', 'faint');
        for (let y = 0; y < FH; y++){ scr.put(ox, top + y, '|', 'faint'); scr.put(ox + IW + 1, top + y, '|', 'faint'); }
        for (let r = 0; r < NR; r++) for (let c = 0; c < NB; c++) if (bricks[r][c]) scr.put(x0 + OFF + SH(r) + c * 4, top + BT + r, '   ', brick(LV[r]));
        scr.bar(x0 + px, top + PR + 0.2, PW, 0.62, 'normal');
        if (state === 'play') for (let i = tn - 1; i >= 1; i--) scr.dot(x0 + trail[i * 2], top + trail[i * 2 + 1], RB * (1 - i * 0.12), GLOW[i]);   // afterglow
        if (state !== 'over'){
          const dx = x0 + (state === 'play' && tn ? trail[0] : bx), dy = top + (state === 'play' && tn ? trail[1] : by);
          scr.dot(dx, dy, RB * 1.8, { fg: 'rgba(200, 245, 184, 0.2)' }); scr.dot(dx, dy, RB, 'bright');   // a soft bloom under the ball, as phosphor spreads
        }
        const cw = Math.min(IW - 2, 30), cx = x0 + ((IW - cw) / 2 | 0), cy = top + BT + NR + Math.max(1, ((PR - BT - NR - 8) / 2) | 0);
        const c = (y, s, st) => scr.put(cx + ((cw - s.length) / 2 | 0), cy + y, s, st);
        const on = REDUCED || Math.floor(t * 2) % 2 === 0;
        if (state === 'over'){
          box(scr, cx, cy, cw, 8, 'normal');
          c(1, 'G A M E   O V E R', 'bright');
          c(3, score + ' points  ·  level ' + level, 'normal');
          c(4, newHi ? 'new high score' : 'best ' + hi, newHi ? 'accent' : 'dim');
          c(6, TOUCH ? 'tap again' : 'enter again  ·  q quit', on ? 'normal' : 'dim');
        } else if (paused){
          box(scr, cx, cy, cw, 5, 'dim');
          c(1, 'PAUSED', 'bright'); c(3, TOUCH ? 'tap to resume' : 'space to resume', 'dim');
        } else if (state === 'serve'){
          const head = level > 1 && left === full ? 'L E V E L   ' + level : score ? balls + (balls === 1 ? ' ball left' : ' balls left') : 'B R E A K O U T';
          c(1, head, 'bright');
          c(3, TOUCH ? 'space or tap to serve' : 'space to serve', on ? 'normal' : 'dim');
          if (!score && level === 1) c(4, TOUCH ? 'then hold ← → or drag' : '← → move the paddle', 'faint');
        }
        if (TOUCH) center(scr, scr.rows - 1, state === 'over' || paused ? ' tap here to quit ' : ' tap here to pause ', 'faint');
        else if (state !== 'over'){
          const ks = cols >= 46 ? '←→ move  ·  space ' + (state === 'serve' ? 'serve' : 'pause') + '  ·  q quit' : '←→  ·  space  ·  q quit';
          center(scr, scr.rows - 1, ks, 'faint');
        }
      },
    };
  },
};

/* =====================================================================================
   LAMP: the real desk lamp in the 3D room
   ===================================================================================== */
const lamp = {
  g: 'fun',
  desc: 'switch the desk lamp in the room',
  usage: 'lamp [on | off | status]',
  ex: ['lamp', 'lamp off', 'lamp status'],
  more: 'the lamp on the desk in the 3D room. with no argument it flips: on goes off, off goes on.',
  complete: args => args.length ? null : ['on', 'off', 'status'],
  get hidden(){ return !(M.world && typeof M.world.lamp === 'function'); },   // no room (phones, the flat layout): not listed, still answers
  run(argv, io){
    const w = M.world;
    const arg = (argv[1] || '').toLowerCase();
    if (!w || typeof w.lamp !== 'function'){
      io.err('lamp: there is no lamp on this screen\n');
      io.exit && io.exit(1);
      return;
    }
    const state = !!w.lampOn;
    if (arg === 'status'){
      io.out('the lamp is ' + (state ? 'on' : 'off') + '\n');
      return;
    }
    let want;
    if (['on', '1', 'yes', 'up'].includes(arg)) want = true;
    else if (['off', '0', 'no', 'down', 'out'].includes(arg)) want = false;
    else if (!arg || ['toggle', 'flip', 'switch'].includes(arg)) want = !state;
    else { io.err('lamp: no ' + arg + ' setting  (try: lamp on, lamp off)\n'); io.exit && io.exit(2); return; }
    if (want === state){
      io.out('the lamp is already ' + (state ? 'on' : 'off') + '\n', 'dim');
      return;
    }
    const now = w.lamp(want);
    const on = typeof now === 'boolean' ? now : want;
    io.out('lamp ' + (on ? 'on' : 'off') + '\n', on ? 'normal' : 'dim');
  },
};
T.cmds.lamp = lamp;
/* games: what there is to play, as words to click */
T.cmds.games = { g: 'fun', hidden: true, desc: 'what you can play', usage: 'games', run(argv, io){
  const list = [['tetris', 'the falling blocks'], ['snake', 'eat and grow'], ['breakout', 'clear the wall'], ['typing', 'how fast you type']].filter(([n]) => T.apps[n] || T.cmds[n]);
  if (!io.tty){ io.out(list.map(x => x[0]).join('\n') + '\n'); return; }
  const o = io.ui(); o.blank();
  for (const [n, d] of list) o.at(2, [n, 'b', { cmd: n }], [' '.repeat(Math.max(2, 9 - n.length)) + d, 'f']);
  o.blank().at(2, ['esc or q leaves a game', 'f']).blank(); io.rich(o);
} };
})();
