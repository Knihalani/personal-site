/* apps.js: full-screen apps and small commands for the terminal (see CONTRACT.md, "Terminal extension API").
   tetris, snake, donut (full-screen) and lamp (plain command).

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
const secs = dt => (dt > 1 ? dt / 1000 : dt) || 0;          // accept seconds (or ms, defensively)
const hiGet = k => +T.store.get(k, 0) || 0, hiSet = T.store.set;   // terminal.js
const sound = (api, name) => { try { (api.sound || M.sound)?.event(name); } catch (e) {} };
const center = (scr, y, s, style) => scr.put(Math.max(0, ((scr.cols - s.length) / 2) | 0), y, s, style);
const pad = (n, w) => String(n).padStart(w, ' ');
const isQuit = k => k === 'q' || k === 'Q' || k === 'Escape';
const mq = q => typeof matchMedia === 'function' && matchMedia(q).matches;
const TOUCH = mq('(pointer: coarse)');                       // phones: tap zones instead of arrows
const REDUCED = mq('(prefers-reduced-motion: reduce)');
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
  desc: 'the falling blocks. arrows, space, c to hold',
  usage: 'tetris',
  start(api){
    const STACK = (api.cols || 72) < 47;                               // phones: the panel goes under the well
    const BH = Math.max(10, Math.min(20, (api.rows || 23) - (STACK ? 15 : 2)));   // well + floor + feet (+ panel) must fit
    const board = Array.from({ length: BH }, () => Array(BW).fill(null));
    let bag = [], queue = [], cur = null, hold = null, canHold = true;
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
    let oyDrawn = 0;                                         // where the well was last drawn (for taps)

    return {
      /* phones: the top of the screen turns, the bottom drops, the left and right thirds move */
      tap(col, row){
        help = false;
        if (over){ restart(); return true; }
        if (paused){ paused = false; return true; }
        if (!cur || flash) return true;
        const rows = api.rows || 23, cols = api.cols || 40;
        if (row < rows * 0.3) rotate(1);
        else if (row >= Math.min(rows * 0.75, oyDrawn + BH)) hardDrop();
        else if (col < cols / 3) shift(-1);
        else if (col >= cols * 2 / 3) shift(1);
        else rotate(1);
        return true;
      },
      key(e){
        const k = e.key;
        help = false;
        if (over){
          if (k === 'Enter' || k === 'r' || k === 'R') restart();
          else if (isQuit(k)) api.exit(0);
          return true;
        }
        if (isQuit(k)){ api.print(`tetris: score ${score}, ${lines} lines, level ${level}. high score ${Math.max(hi, score)}.`); if (score > hi) hiSet(TETRIS_HI, score); api.exit(0); return true; }
        if (k === 'p' || k === 'P'){ paused = !paused; return true; }
        if (paused || !cur || flash) return true;
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
      tick(dt){
        dt = Math.min(secs(dt), 0.1); t += dt;
        if (over || paused) return Math.floor(t * 2) !== Math.floor((t - dt) * 2);   // blink prompts
        if (flash){ flash.t += dt; if (flash.t > 0.36) finishClear(); return true; }
        if (!cur) return false;
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
        scr.clear(); scr.cursor(0, 0, null);
        const W = BW * 2 + 4;
        const compact = STACK || scr.cols < 64 || scr.rows < 22;      // one panel, beside the well or under it
        const ox = STACK ? Math.max(0, ((scr.cols - W) / 2) | 0) : compact ? Math.max(0, ((scr.cols - (W + 3 + 20)) / 2) | 0) : ((scr.cols - W) / 2) | 0;
        const oy = Math.max(0, ((scr.rows - BH - 2 - (STACK ? 13 : 0)) / 2) | 0); oyDrawn = oy;
        const bx = ox + 2;  // first board column
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
        if (compact){
          const rx = STACK ? ox + 2 : ox + W + 3, ry = STACK ? oy + BH + 3 : oy;
          scr.put(rx, ry, 'NEXT', 'dim'); mini(queue[0], rx, ry + 1, 'bright');
          scr.put(rx + 10, ry, 'HOLD', canHold ? 'dim' : 'faint'); mini(hold, rx + 10, ry + 1, canHold ? 'normal' : 'faint');
          [['SCORE', score, 'bright'], ['HIGH', Math.max(hi, score), score > hi ? 'bright' : 'normal'], ['LEVEL', level, 'normal'], ['LINES', lines, 'normal']]
            .forEach(([a, v, st], i) => { scr.put(rx, ry + 4 + i, a.padEnd(7), 'dim'); scr.put(rx + 7, ry + 4 + i, String(v), st); });
          const ks = [['<- ->', 'move'], ['up x', 'rotate'], ['space', 'drop'], ['c', 'hold'], ['p', 'pause'], ['q', 'quit']];
          const ky = ry + 9, two = STACK || scr.rows - ky < ks.length;
          const short = TOUCH ? [['tap', 'sides move'], ['top', 'turn'], ['low', 'drop'], ['q', 'quit']]
            : [['<->', 'move'], ['up', 'turn'], ['spc', 'drop'], ['c', 'hold'], ['p', 'pause'], ['q', 'quit']];
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
        const keys = [['<- ->', 'move'], ['up x', 'rotate'], ['z', 'rotate back'], ['down', 'soft drop'], ['space', 'hard drop'], ['c', 'hold'], ['p', 'pause'], ['q', 'quit']];
        keys.forEach(([a, b], i) => { scr.put(rx, oy + 13 + i, a.padEnd(7), 'normal'); scr.put(rx + 7, oy + 13 + i, b, 'faint'); });
        }
        // overlays
        const cardX = bx + 1, cardW = BW * 2 - 2;
        if (paused){
          box(scr, cardX, oy + 7, cardW, 5, 'dim');
          scr.put(cardX + ((cardW - 6) / 2 | 0), oy + 8, 'PAUSED', 'bright');
          const go = TOUCH ? 'tap to go on' : 'p to carry on';
          scr.put(cardX + ((cardW - go.length) / 2 | 0), oy + 10, go, 'dim');
        } else if (over){
          const top = Math.max(0, Math.min(5, BH - 10));
          box(scr, cardX, oy + top, cardW, 10, 'normal');
          const c = (y, s, st) => scr.put(cardX + ((cardW - s.length) / 2 | 0), oy + top + y - 5, s, st);
          c(6, 'GAME  OVER', 'bright');
          c(8, 'score ' + score, 'normal');
          c(9, lines + ' lines  lvl ' + level, 'dim');
          c(10, newHi ? '* new high score *' : 'best ' + hi, newHi ? 'accent' : 'dim');
          if (REDUCED || Math.floor(t * 2) % 2 === 0) c(12, TOUCH ? 'tap: again' : 'enter: again', 'normal');
          c(13, 'q: quit', 'faint');
        } else if (help && score === 0){
          scr.put(bx + 3, oy + 3, TOUCH ? ' tap to play' : 'arrows to play', 'dim');
        }
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
  desc: 'eat, grow, do not bite yourself. arrows or wasd',
  usage: 'snake',
  start(api){
    const cols = api.cols || 72, rows = api.rows || 23;
    const GW = Math.floor((cols - 2) / 2), GH = rows - 3;    // cells are 2 columns wide, so they look square
    const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const KEYMAP = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right', k: 'up', j: 'down', h: 'left', l: 'right' };
    let body, dir, queue, food, score, step, acc, paused, over, hi = hiGet(SNAKE_HI), newHi, t = 0, started, eaten;
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
    return {
      /* phones: tap on the side of the head you want to go; the snake turns that way */
      tap(col, row){
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
          else if (isQuit(k)) api.exit(0);
          return true;
        }
        if (isQuit(k)){ api.print(`snake: ${score} points, length ${body.length}. high score ${Math.max(hi, score)}.`); if (score > hi) hiSet(SNAKE_HI, score); api.exit(0); return true; }
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
        scr.clear(); scr.cursor(0, 0, null);
        const ox = ((scr.cols - GW * 2 - 2) / 2) | 0, oy = 1;
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
        const cw = 30, cx = ox + 1 + ((GW * 2 - cw) / 2 | 0), cy = oy + ((GH - 9) / 2 | 0) + 1;
        const c = (y, s, st) => scr.put(cx + ((cw - s.length) / 2 | 0), cy + y, s, st);
        if (over){
          box(scr, cx, cy, cw, 10, 'normal');
          c(1, 'G A M E   O V E R', 'bright');
          c(3, score + ' points', 'normal');
          c(4, 'length ' + n + '   apples ' + eaten, 'dim');
          c(6, newHi ? '* new high score *' : 'best ' + hi, newHi ? 'accent' : 'dim');
          if (REDUCED || Math.floor(t * 2) % 2 === 0) c(8, (TOUCH ? 'tap: again' : 'enter: again') + '    q: quit', 'normal');
          else c(8, '      again       quit', 'faint');
        } else if (paused){
          box(scr, cx, cy + 2, cw, 5, 'dim');
          c(3, 'PAUSED', 'bright'); c(5, TOUCH ? 'tap to go on' : 'p to carry on', 'dim');
        } else if (!started){
          box(scr, cx, cy + 1, cw, 7, 'dim');
          c(2, 'S N A K E', 'bright');
          c(4, TOUCH ? 'tap beside the head to turn' : 'arrows or wasd to start', 'normal');
          c(5, TOUCH ? 'tap to start   q quit' : 'p pause   q quit', 'faint');
        }
      },
    };
  },
};

/* =====================================================================================
   DONUT: a1k0n's spinning torus, luminance mapped to phosphor levels
   ===================================================================================== */
const LUM = '.,-:;=+!*#$@';      // VT323 draws ~ as a squiggle, so it is left out
const LUM_STYLE = ['faint', 'faint', 'faint', 'dim', 'dim', 'dim', 'normal', 'normal', 'normal', 'bright', 'bright', 'bright'];
T.apps.donut = {
  g: 'fun',
  desc: 'a spinning ascii donut (after a1k0n). hold the arrows to spin it',
  usage: 'donut',
  start(api){
    const IDLE_A = REDUCED ? 0 : 1.0, IDLE_B = REDUCED ? 0 : 0.5, SPIN = 3.4;   // idle drift (none with reduced motion) and held-arrow spin (rad/s)
    let A = 1, B = 0, vA = IDLE_A, vB = IDLE_B;     // angles and spin speeds (rad/s)
    let idle = 1, paused = false, t = 0, gotUp = false, note = '', noteT = 0;
    const held = { up: 0, down: 0, left: 0, right: 0 };   // time of the last keydown, 0 when released
    const DIR = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right' };
    // without keyup events, a held key is assumed released ~150 ms after its last auto-repeat
    const isHeld = d => held[d] > 0 && (gotUp || t - held[d] < 0.15);
    const say = s => { note = s; noteT = t; };
    let cols = api.cols || 72, rows = api.rows || 23;
    let chars = [], styles = [], acc = 0;
    function frame(){
      const n = cols * rows;
      const out = new Array(n).fill(' '), lv = new Array(n).fill(-1), z = new Float32Array(n);
      const cA = Math.cos(A), sA = Math.sin(A), cB = Math.cos(B), sB = Math.sin(B);
      const R1 = 1, R2 = 2, K2 = 5;
      // scale so the donut fills the grid height; character cells are ~2x taller than wide
      const h = rows - 1;                                   // bottom row holds the hint
      let K1y = h * K2 * 3 / (8 * (R1 + R2)) * 1.02;
      const K1x = Math.min(K1y * 2.05, cols * K2 * 3 / (8 * (R1 + R2)) * 1.02);
      K1y = Math.min(K1y, K1x / 2.05);                      // keep it round on tall, narrow (phone) grids
      for (let th = 0; th < 6.283; th += 0.05){
        const ct = Math.cos(th), st = Math.sin(th);
        for (let ph = 0; ph < 6.283; ph += 0.015){
          const cp = Math.cos(ph), sp = Math.sin(ph);
          const cx = R2 + R1 * ct, cy = R1 * st;
          const x = cx * (cB * cp + sA * sB * sp) - cy * cA * sB;
          const y = cx * (sB * cp - sA * cB * sp) + cy * cA * cB;
          const zz = K2 + cA * cx * sp + cy * sA;
          const ooz = 1 / zz;
          const xp = (cols / 2 + K1x * ooz * x) | 0;
          const yp = (h / 2 - K1y * ooz * y) | 0;
          if (xp < 0 || xp >= cols || yp < 0 || yp >= h) continue;
          const L = cp * ct * sB - cA * ct * sp - sA * st + cB * (cA * st - ct * sA * sp);
          const i = xp + yp * cols;
          if (ooz > z[i]){
            z[i] = ooz;
            const li = L > 0 ? Math.min(11, (L * 8) | 0) : 0;
            out[i] = LUM[li]; lv[i] = li;
          }
        }
      }
      chars = out; styles = lv;
    }
    frame();
    return {
      key(e){
        const k = e.key;
        if (DIR[k]){ held[DIR[k]] = t || 1e-6; return true; }
        if (isQuit(k)){ api.exit(0); return true; }
        if (k === ' '){ paused = !paused; say(paused ? 'paused' : ''); return true; }
        if (k === '+' || k === '='){ idle = Math.min(4, idle * 1.4); say('idle speed x' + idle.toFixed(1)); return true; }
        if (k === '-' || k === '_'){ idle = Math.max(0.15, idle / 1.4); say('idle speed x' + idle.toFixed(1)); return true; }
        if (k === 'r' || k === 'R'){ A = 1; B = 0; vA = IDLE_A; vB = IDLE_B; idle = 1; paused = false; say('reset'); frame(); return true; }
        return true;                         // everything else is ignored, not a way out
      },
      keyUp(e){
        gotUp = true;
        const d = DIR[e.key]; if (d) held[d] = 0;
        return false;
      },
      tick(dt){
        dt = Math.min(secs(dt), 0.1); t += dt;
        const ay = (isHeld('up') ? 1 : 0) - (isHeld('down') ? 1 : 0);
        const bx = (isHeld('right') ? 1 : 0) - (isHeld('left') ? 1 : 0);
        const restA = paused ? 0 : IDLE_A * idle, restB = paused ? 0 : IDLE_B * idle;
        // held: snap quickly to a firm spin; released: coast, easing back to the idle drift
        vA += ((ay ? ay * SPIN : restA) - vA) * Math.min(1, dt * (ay ? 10 : 1.1));
        vB += ((bx ? bx * SPIN : restB) - vB) * Math.min(1, dt * (bx ? 10 : 1.1));
        A += vA * dt; B += vB * dt;
        acc += dt;
        const noteDirty = note && note !== 'paused' && t - noteT > 1.6 ? (note = '', true) : false;
        if (Math.abs(vA) + Math.abs(vB) < 1e-3 && !noteDirty) return false;
        if (acc < 1 / 40 && !noteDirty) return false;     // ~40 fps is plenty for a phosphor tube
        acc = 0; frame();
        return true;
      },
      render(scr){
        if (scr.cols !== cols || scr.rows !== rows){ cols = scr.cols; rows = scr.rows; frame(); }
        scr.clear(); scr.cursor(0, 0, null);
        for (let y = 0; y < rows; y++){
          // emit runs of one brightness level
          let x = 0;
          while (x < cols){
            const i = y * cols + x, l = styles[i];
            if (l < 0){ x++; continue; }
            const st = LUM_STYLE[l];
            let s = '';
            while (x < cols && styles[y * cols + x] >= 0 && LUM_STYLE[styles[y * cols + x]] === st){ s += chars[y * cols + x]; x++; }
            scr.put(x - s.length, y, s, st);
          }
        }
        const hint = note ? note + '  \u00b7  ' + (paused ? 'space resumes' : 'q quit')
          : cols >= 46 ? '\u2190\u2191\u2193\u2192 spin \u00b7 space pause \u00b7 +/- speed \u00b7 q quit'
          : '\u2190\u2191\u2193\u2192 spin \u00b7 space \u00b7 +/- \u00b7 q';
        center(scr, rows - 1, hint, note ? 'dim' : 'faint');
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
  more: 'The lamp on the desk in the 3D room. With no argument it flips: on goes off, off goes on.',
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
      io.out('the lamp is ' + (state ? 'on' : 'off') + '.\n');
      return;
    }
    let want;
    if (['on', '1', 'yes', 'up'].includes(arg)) want = true;
    else if (['off', '0', 'no', 'down', 'out'].includes(arg)) want = false;
    else if (!arg || ['toggle', 'flip', 'switch'].includes(arg)) want = !state;
    else { io.err('lamp: try lamp on or lamp off\n'); io.exit && io.exit(2); return; }
    if (want === state){
      io.out('the lamp is already ' + (state ? 'on' : 'off') + '.\n', 'dim');
      return;
    }
    const now = w.lamp(want);
    const on = typeof now === 'boolean' ? now : want;
    io.out('lamp ' + (on ? 'on' : 'off') + '.\n', on ? 'normal' : 'dim');
  },
};
T.cmds.lamp = lamp;
/* games: what there is to play, as words to click */
T.cmds.games = { g: 'fun', hidden: true, desc: 'what you can play', usage: 'games', run(argv, io){
  const list = [['tetris', 'blocks'], ['snake', 'eat, grow'], ['typing', 'how fast you type'], ['donut', 'a spinning torus']].filter(([n]) => T.apps[n] || T.cmds[n]);
  if (!io.tty){ io.out(list.map(x => x[0]).join('\n') + '\n'); return; }
  const o = io.ui(); o.blank();
  for (const [n, d] of list) o.at(2, [n, 'b', { cmd: n }], [' '.repeat(Math.max(2, 9 - n.length)) + d, 'f']);
  o.blank().at(2, ['esc or q leaves a game', 'f']).blank(); io.rich(o);
} };
})();
