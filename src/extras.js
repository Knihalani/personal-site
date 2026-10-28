/* extras.js: things to do on the KN-84 (see CONTRACT.md, "Terminal extension API").
   weather, todo, clock / timer / stopwatch / pomodoro, typing, fortune, cowsay, banner, matrix.

   Plain commands print rich rows through io.ui() (the terminal's own builder) when writing to the
   screen, and plain text when piped or redirected. Full-screen apps draw solid pixels as inverse-video
   spaces, as apps.js does: VT323 has no block glyphs. */
(() => {
'use strict';
const M = window.MAC = window.MAC || {};
const T = M.TERM = M.TERM || { cmds: {}, apps: {} };
T.cmds = T.cmds || {}; T.apps = T.apps || {};

/* ---- shared ---- */
const blk = level => ({ fg: level, inverse: true });
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e){ return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e){} };
const beep = api => { try { (api.sound || M.sound).event('beep'); } catch (e){} };
const center = (scr, y, s, st) => scr.put(Math.max(0, ((scr.cols - s.length) / 2) | 0), y, s, st);
const isQuit = e => e.key === 'q' || e.key === 'Q' || e.key === 'Escape';
const two = n => String(n).padStart(2, '0');
function wrap(text, width){
  const out = []; let line = '';
  for (const w of String(text).split(/\s+/)){
    if (!w) continue;
    if (!line) line = w; else if (line.length + 1 + w.length <= width) line += ' ' + w; else { out.push(line); line = w; }
    while (line.length > width){ out.push(line.slice(0, width)); line = line.slice(width); }
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}
/* a row of keys for the bottom line of an app: [['space', 'pause'], ['q', 'quit']] trimmed to fit */
function keysLine(scr, y, keys){
  let ks = keys.slice();
  const len = a => a.reduce((n, [k, d]) => n + k.length + 1 + d.length, 0) + (a.length - 1) * 3;
  while (ks.length > 1 && len(ks) > scr.cols - 2) ks.pop();
  let x = Math.max(1, ((scr.cols - len(ks)) / 2) | 0);
  ks.forEach(([k, d], i) => {
    if (i){ scr.put(x + 1, y, '·', 'faint'); x += 3; }
    scr.put(x, y, k, 'normal'); x += k.length + 1;
    scr.put(x, y, d, 'faint'); x += d.length;
  });
}
const spaced = s => s.toUpperCase().split('').join(' ');
/* rich rows when the screen is the sink, text otherwise */
function show(io, build, text){
  if (io.tty && io.ui){ const o = io.ui(); build(o); io.rich(o); return o; }
  io.out(typeof text === 'function' ? text() : text);
  return null;
}

/* ---- bitmap fonts ---- */
const FONT5 = {
  A: '.###.|#...#|#####|#...#|#...#', B: '####.|#...#|####.|#...#|####.', C: '.####|#....|#....|#....|.####',
  D: '####.|#...#|#...#|#...#|####.', E: '#####|#....|####.|#....|#####', F: '#####|#....|####.|#....|#....',
  G: '.####|#....|#..##|#...#|.####', H: '#...#|#...#|#####|#...#|#...#', I: '###|.#.|.#.|.#.|###',
  J: '..###|...#.|...#.|#..#.|.##..', K: '#...#|#..#.|###..|#..#.|#...#', L: '#....|#....|#....|#....|#####',
  M: '#...#|##.##|#.#.#|#...#|#...#', N: '#...#|##..#|#.#.#|#..##|#...#', O: '.###.|#...#|#...#|#...#|.###.',
  P: '####.|#...#|####.|#....|#....', Q: '.###.|#...#|#.#.#|#..#.|.##.#', R: '####.|#...#|####.|#..#.|#...#',
  S: '.####|#....|.###.|....#|####.', T: '#####|..#..|..#..|..#..|..#..', U: '#...#|#...#|#...#|#...#|.###.',
  V: '#...#|#...#|#...#|.#.#.|..#..', W: '#...#|#...#|#.#.#|##.##|#...#', X: '#...#|.#.#.|..#..|.#.#.|#...#',
  Y: '#...#|.#.#.|..#..|..#..|..#..', Z: '#####|...#.|..#..|.#...|#####',
  0: '.###.|#..##|#.#.#|##..#|.###.', 1: '.#.|##.|.#.|.#.|###', 2: '####.|....#|.###.|#....|#####',
  3: '####.|....#|.###.|....#|####.', 4: '#...#|#...#|#####|....#|....#', 5: '#####|#....|####.|....#|####.',
  6: '.###.|#....|####.|#...#|.###.', 7: '#####|...#.|..#..|.#...|.#...', 8: '.###.|#...#|.###.|#...#|.###.',
  9: '.###.|#...#|.####|....#|.###.',
  ' ': '...|...|...|...|...', '!': '#|#|#|.|#', '?': '###.|...#|.##.|....|.#..', '.': '.|.|.|.|#', ',': '..|..|..|.#|#.',
  '-': '...|...|###|...|...', '+': '...|.#.|###|.#.|...', '=': '...|###|...|###|...', ':': '.|#|.|#|.', "'": '#|#|.|.|.',
  '/': '....#|...#.|..#..|.#...|#....', '#': '.#.#.|#####|.#.#.|#####|.#.#.', '&': '.##..|#..#.|.##.#|#..#.|.##.#',
  '@': '.###.|#.###|#.#.#|#.###|.##..', '(': '.#|#.|#.|#.|.#', ')': '#.|.#|.#|.#|#.', '<': '..#|.#.|#..|.#.|..#', '>': '#..|.#.|..#|.#.|#..',
  '_': '....|....|....|....|####', '*': '.....|.#.#.|..#..|.#.#.|.....', '$': '.####|#.#..|.###.|..#.#|####.', '%': '#...#|...#.|..#..|.#...|#...#',
};
const DIG3 = { 0: '###|#.#|#.#|#.#|###', 1: '.#.|##.|.#.|.#.|###', 2: '###|..#|###|#..|###', 3: '###|..#|.##|..#|###', 4: '#.#|#.#|###|..#|..#',
  5: '###|#..|###|..#|###', 6: '###|#..|###|#.#|###', 7: '###|..#|..#|.#.|.#.', 8: '###|#.#|###|#.#|###', 9: '###|#.#|###|..#|###', ':': '.|#|.|#|.', ' ': '.|.|.|.|.' };
const glyph = (font, c) => (font[c] || font[String(c).toUpperCase()] || font['?'] || font[' ']).split('|');
/* lay out a string in a bitmap font: rows of booleans */
function bitmap(font, s, gap = 1){
  const rows = [[], [], [], [], []];
  [...s].forEach((c, i) => {
    const g = glyph(font, c);
    for (let y = 0; y < 5; y++){ if (i) for (let k = 0; k < gap; k++) rows[y].push(false); for (const p of g[y]) rows[y].push(p === '#'); }
  });
  return rows;
}
const bitWidth = (font, s, gap = 1) => [...s].reduce((n, c, i) => n + glyph(font, c)[0].length + (i ? gap : 0), 0);
/* big digits on an app grid at scale sx by sy; returns the width used */
function bigText(scr, x, y, s, sx, sy, st){
  const b = bitmap(DIG3, s, 1);
  for (let r = 0; r < 5; r++) for (let c = 0; c < b[r].length; c++) if (b[r][c]) scr.fill(x + c * sx, y + r * sy, sx, sy, ' ', st);
  return b[0].length * sx;
}
/* the biggest scale that fits w x h cells, keeping pixels roughly square (a cell is about twice as tall as wide) */
function fitScale(s, w, h){
  const bw = bitWidth(DIG3, s, 1);
  for (let sy = 4; sy >= 1; sy--){
    for (let sx = Math.min(sy * 2 + 1, 8); sx >= Math.max(1, sy * 2 - 1); sx--) if (bw * sx <= w && 5 * sy <= h) return { sx, sy, w: bw * sx, h: 5 * sy };
  }
  return bw <= w && 5 <= h ? { sx: 1, sy: 1, w: bw, h: 5 } : null;
}

/* =====================================================================================
   banner: big letters, in inverse-video blocks on the screen and # in a pipe
   ===================================================================================== */
T.cmds.banner = { g: 'fun', desc: 'big letters', usage: 'banner text...', ex: ['banner hello', 'banner -c ship it', 'echo gm | banner'],
  opts: [['-c', 'centre each line']],
  more: 'Sets text in a five-line block font, breaking between words to fit the screen. Letters, digits and common punctuation; anything else becomes ?. Piped or redirected, the blocks are # characters.',
  run(argv, io){
    let a = argv.slice(1), centre = false;
    if (a[0] === '-c'){ centre = true; a = a.slice(1); }
    const text = (a.length ? a.join(' ') : String(io.stdin || '').trim()).replace(/\s+/g, ' ').trim();
    if (!text){ io.err('usage: banner text...   (try: banner hello)\n'); return 1; }
    const room = io.cols - 4;
    const lines = []; let line = '';
    for (let w of text.split(' ')){
      while (bitWidth(FONT5, w) > room){              // a word too long for one line: split it
        let k = w.length; while (k > 1 && bitWidth(FONT5, w.slice(0, k)) > room) k--;
        if (line){ lines.push(line); line = ''; }
        lines.push(w.slice(0, k)); w = w.slice(k);
      }
      if (!w) continue;
      const cand = line ? line + ' ' + w : w;
      if (bitWidth(FONT5, cand) <= room) line = cand; else { lines.push(line); line = w; }
    }
    if (line) lines.push(line);
    if (lines.length > 6){ io.err('banner: that is a lot of letters. try something shorter\n'); return 1; }
    show(io, o => {
      o.blank();
      lines.forEach((l, n) => {
        const b = bitmap(FONT5, l), ind = 2 + (centre ? Math.max(0, ((room - b[0].length) / 2) | 0) : 0);
        for (const r of b){
          const sp = []; let run = '', on = null;
          for (const p of r){ if (on !== null && p !== on){ sp.push([run, on ? 'i' : 'n']); run = ''; } on = p; run += ' '; }
          if (run && on) sp.push([run, 'i']);
          o.at(ind, ...(sp.length ? sp : [['', 'n']]));
        }
        if (n < lines.length - 1) o.blank();
      });
      o.blank();
    }, () => lines.map(l => bitmap(FONT5, l).map(r => r.map(p => p ? '#' : ' ').join('').replace(/\s+$/, '')).join('\n')).join('\n\n') + '\n');
  } };

/* =====================================================================================
   fortune and cowsay
   ===================================================================================== */
const FORTUNES = [
  ['The best way to predict the future is to invent it.', 'Alan Kay'],
  ['Simple things should be simple, complex things should be possible.', 'Alan Kay'],
  ['Make something people want.', 'Y Combinator'],
  ["Do things that don't scale.", 'Paul Graham'],
  ["If you are not embarrassed by the first version of your product, you've launched too late.", 'Reid Hoffman'],
  ['Real artists ship.', 'Steve Jobs'],
  ['Stay hungry. Stay foolish.', 'The Whole Earth Catalog'],
  ['Any sufficiently advanced technology is indistinguishable from magic.', 'Arthur C. Clarke'],
  ['Perfection is achieved, not when there is nothing more to add, but when there is nothing left to take away.', 'Antoine de Saint-Exupery'],
  ['What I cannot create, I do not understand.', 'Richard Feynman'],
  ['Simplicity is prerequisite for reliability.', 'Edsger W. Dijkstra'],
  ['Talk is cheap. Show me the code.', 'Linus Torvalds'],
  ['The coffee is still hot. Keep going.', 'the KN-84'],
  ['Small, steady keystrokes build big things.', 'the KN-84'],
  ['Ship it, then make it better.', 'the KN-84'],
  ['Every great thing was once a blinking cursor.', 'the KN-84'],
  ['The lamp is on. Somebody is building something.', 'the KN-84'],
  ['Ask for help sooner than feels comfortable.', 'the KN-84'],
];
let lastFortune = -1;
T.cmds.fortune = { g: 'fun', desc: 'a line worth reading', usage: 'fortune', ex: ['fortune', 'fortune | cowsay', 'fortune >> notes/keep.txt'],
  more: 'Prints one short line, picked at random: a few well-known lines from people who built things, and a few from this machine.',
  run(argv, io){
    let i; do { i = Math.random() * FORTUNES.length | 0; } while (i === lastFortune && FORTUNES.length > 1);
    lastFortune = i;
    const [q, who] = FORTUNES[i];
    show(io, o => { o.blank(); o.para(q, 'b', io.cols - 6); o.at(4, ['- ' + who, 'd']).blank(); }, q + '\n  - ' + who + '\n');
  } };

const COWS = {
  cow: ['        ^__^', '        (oo)\\_______', '        (__)\\       )\\/\\', '            ||----w |', '            ||     ||'],
  mac: ['     .-------.', '     | .---. |', '     | |^_^| |', "     | '---' |", '     |  ___  |', "     '-------'"],
};
T.cmds.cowsay = { g: 'fun', desc: 'a cow says it', usage: 'cowsay [-f cow|mac] text...', opts: [['-f NAME', 'who says it: cow or mac']],
  ex: ['cowsay moo', 'fortune | cowsay', 'cowsay -f mac hello'],
  more: 'Puts the text in a speech balloon over a cow, or over a small Mac. Reads its arguments, or the standard input when there are none.',
  run(argv, io){
    let a = argv.slice(1), who = 'cow';
    if (a[0] === '-f'){ who = a[1] || ''; a = a.slice(2); if (!COWS[who]){ io.err('cowsay: no such figure: ' + who + '   (try cow or mac)\n'); return 1; } }
    const text = (a.length ? a.join(' ') : String(io.stdin || '')).replace(/\s+/g, ' ').trim();
    if (!text){ io.err('usage: cowsay text...   (try: fortune | cowsay)\n'); return 1; }
    const ls = wrap(text, Math.min(36, io.cols - 8)), w = Math.max(...ls.map(l => l.length));
    const edge = (i, n) => n === 1 ? ['<', '>'] : i === 0 ? ['/', '\\'] : i === n - 1 ? ['\\', '/'] : ['|', '|'];
    const bubble = [' ' + '_'.repeat(w + 2), ...ls.map((l, i) => { const [p, q] = edge(i, ls.length); return p + ' ' + l.padEnd(w) + ' ' + q; }), ' ' + '-'.repeat(w + 2)];
    const tail = who === 'cow' ? ['        \\', '         \\'] : ['        \\'];
    const art = COWS[who];
    show(io, o => {
      o.blank();
      bubble.forEach((l, i) => o.at(2, [l, i === 0 || i === bubble.length - 1 ? 'd' : 'n']));
      tail.forEach(l => o.at(2, [l, 'd']));
      art.forEach(l => o.at(2, [l, 'b']));
      o.blank();
    }, [...bubble, ...tail, ...art].join('\n') + '\n');
  } };

/* =====================================================================================
   todo: a list kept in ~/todo.txt, one "[ ] thing" per line
   ===================================================================================== */
const TODO = '~/todo.txt';
function todoRead(fs){
  const t = fs.read(TODO); if (t == null) return [];
  return t.split('\n').filter(l => l.trim()).map(l => { const m = /^\s*\[( |x|X)\]\s?(.*)$/.exec(l); return m ? { done: m[1] !== ' ', text: m[2] } : { done: false, text: l.trim() }; });
}
const todoWrite = (fs, items) => fs.write(TODO, items.map(it => '[' + (it.done ? 'x' : ' ') + '] ' + it.text).join('\n') + (items.length ? '\n' : ''));
T.cmds.todo = { g: 'tools', desc: 'a to-do list, kept in ~/todo.txt', usage: 'todo [add text | done N | undo N | rm N | clear]',
  opts: [['add TEXT', 'add an item (todo TEXT works too)'], ['done N', 'tick off item N'], ['undo N', 'untick item N'], ['rm N', 'remove item N'], ['clear', 'remove the ticked items']],
  ex: ['todo add call jose', 'todo done 1', 'todo', 'grep -v x ~/todo.txt'],
  more: 'A short list that stays in this browser. It lives in ~/todo.txt as plain lines, so cat, grep and the rest work on it too.',
  run(argv, io){
    const fs = io.fs, sub = (argv[1] || '').toLowerCase();
    let items = todoRead(fs), note = null;
    const num = () => {
      const ns = argv.slice(2).map(x => parseInt(x, 10));
      if (!ns.length || ns.some(n => !(n >= 1 && n <= items.length))){
        io.err('todo: ' + (items.length ? 'pick a number from 1 to ' + items.length : 'the list is empty') + '\n'); return null;
      }
      return [...new Set(ns)].sort((a, b) => b - a);
    };
    if (sub === 'add' || (sub && !['done', 'undo', 'rm', 'del', 'clear', 'ls', 'list'].includes(sub))){
      const text = (sub === 'add' ? argv.slice(2) : argv.slice(1)).join(' ').trim();
      if (!text){ io.err('usage: todo add text\n'); return 1; }
      items.push({ done: false, text }); note = ['added', items.length];
    } else if (sub === 'done' || sub === 'undo'){
      const ns = num(); if (!ns) return 1;
      for (const n of ns) items[n - 1].done = sub === 'done';
      note = [sub === 'done' ? 'ticked off' : 'unticked', ns.length === 1 ? ns[0] : null];
    } else if (sub === 'rm' || sub === 'del'){
      const ns = num(); if (!ns) return 1;
      for (const n of ns) items.splice(n - 1, 1);
      note = ['removed ' + ns.length + (ns.length === 1 ? ' item' : ' items'), null];
    } else if (sub === 'clear'){
      const n = items.filter(it => it.done).length;
      items = items.filter(it => !it.done); note = ['cleared ' + n + ' done', null];
    }
    if (note && !todoWrite(fs, items)){ io.err('todo: ' + (fs.lastError || 'could not save') + '\n'); return 1; }
    const left = items.filter(it => !it.done).length;
    show(io, o => {
      o.blank().head('todo', items.length ? (items.length - left) + ' of ' + items.length + ' done' : '').blank();
      if (!items.length) o.at(2, ['nothing yet. ', 'd'], ['todo add ', 'n'], ['something', 'd']);
      const w = io.cols - 10;
      items.forEach((it, i) => {
        const ls = wrap(it.text, w), hot = note && note[1] === i + 1;
        ls.forEach((l, k) => o.at(2, [k ? '     ' : String(i + 1).padStart(2) + ' ', 'f'], [k ? '' : it.done ? '[x] ' : '[ ] ', it.done ? 'f' : 'd'],
          [(k ? '    ' : '') + l, it.done ? 'f' : hot ? 'b' : 'n']));
      });
      o.blank();
      if (note) o.at(2, [note[0] + (note[1] ? ' ' + note[1] : ''), 'd'], [left ? '   ' + left + ' to go' : items.length ? '   all done' : '', 'f']).blank();
      else if (items.length) o.at(2, ['todo done N', 'n'], ['  ticks one off   ', 'f'], ['man todo', 'n'], ['  more', 'f']).blank();
    }, items.map((it, i) => (i + 1) + ' [' + (it.done ? 'x' : ' ') + '] ' + it.text).join('\n') + (items.length ? '\n' : ''));
  } };

/* =====================================================================================
   weather: open-meteo.com, no key. The visitor's city from their time zone, or a named one.
   ===================================================================================== */
const WX_ICON = {
  sun: [['    \\   /    ', 'b'], ['     .-.     ', 'b'], ['  - (   ) -  ', 'b'], ["     `-'     ", 'b'], ['    /   \\    ', 'b']],
  moon: [['             ', 'd'], ['   *   .--.  ', 'd'], ['      (  (   ', 'b'], ["   .   `--'  ", 'd'], ['        *    ', 'd']],
  part: [['   \\  /      ', 'b'], [' _ /"".-.    ', 'b'], ['   \\_(   ).  ', 'n'], ['   /(___(__) ', 'n'], ['             ', 'n']],
  cloud: [['             ', 'n'], ['     .--.    ', 'n'], ['  .-(    ).  ', 'n'], [' (___.__)__) ', 'n'], ['             ', 'n']],
  fog: [['             ', 'd'], [' _ - _ - _ - ', 'd'], ['  _ - _ - _  ', 'd'], [' _ - _ - _ - ', 'd'], ['             ', 'd']],
  rain: [['     .-.     ', 'n'], ['    (   ).   ', 'n'], ['   (___(__)  ', 'n'], ["    ' ' ' '  ", 'b'], ["   ' ' ' '   ", 'b']],
  snow: [['     .-.     ', 'n'], ['    (   ).   ', 'n'], ['   (___(__)  ', 'n'], ['    *  *  *  ', 'b'], ['   *  *  *   ', 'b']],
  storm: [['     .-.     ', 'n'], ['    (   ).   ', 'n'], ['   (___(__)  ', 'n'], ['    /_  /_   ', 'b'], ['     /   /   ', 'b']],
};
const WMO = { 0: ['Clear', 'sun'], 1: ['Mostly clear', 'part'], 2: ['Partly cloudy', 'part'], 3: ['Overcast', 'cloud'], 45: ['Fog', 'fog'], 48: ['Freezing fog', 'fog'],
  51: ['Light drizzle', 'rain'], 53: ['Drizzle', 'rain'], 55: ['Heavy drizzle', 'rain'], 56: ['Freezing drizzle', 'rain'], 57: ['Freezing drizzle', 'rain'],
  61: ['Light rain', 'rain'], 63: ['Rain', 'rain'], 65: ['Heavy rain', 'rain'], 66: ['Freezing rain', 'rain'], 67: ['Freezing rain', 'rain'],
  71: ['Light snow', 'snow'], 73: ['Snow', 'snow'], 75: ['Heavy snow', 'snow'], 77: ['Snow grains', 'snow'], 80: ['Showers', 'rain'], 81: ['Showers', 'rain'],
  82: ['Heavy showers', 'rain'], 85: ['Snow showers', 'snow'], 86: ['Snow showers', 'snow'], 95: ['Thunderstorm', 'storm'], 96: ['Thunder and hail', 'storm'], 99: ['Thunder and hail', 'storm'] };
const DAYS3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WX_CITY = 'kaiav.weather.city';
/* ---- the network: one helper that tells "blocked" apart from "offline", CORS, timeouts and HTTP errors ---- */
class NetError extends Error { constructor(kind, msg, status){ super(msg); this.kind = kind; this.status = status; } }
const SANDBOXED = (() => { try { return /claude(usercontent)?\.(ai|com)$/i.test(location.hostname) || location.protocol === 'about:'; } catch (e){ return false; } })();
const net = {
  /* -> { status, statusText, ok, headers: [[k, v]], type, text, data, ms, bytes, url } ; throws NetError */
  async get(url, opt = {}){
    if (typeof fetch !== 'function') throw new NetError('blocked', 'this browser cannot make requests');
    let csp = false;
    const onCsp = e => { if (/^connect-src|^default-src/.test(e.violatedDirective || e.effectiveDirective || '')) csp = true; };
    try { document.addEventListener('securitypolicyviolation', onCsp); } catch (e){}
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; if (ctl) ctl.abort(); }, opt.timeout || 9000);
    const t0 = performance.now();
    try {
      let r;
      try {
        r = await fetch(url, { method: opt.method || 'GET', headers: opt.headers || {}, body: opt.body, signal: ctl ? ctl.signal : undefined, cache: 'no-store' });
      } catch (e){
        await new Promise(res => setTimeout(res, 30));          // the CSP event arrives just after the rejection
        if (timedOut) throw new NetError('timeout', 'no answer after ' + Math.round((opt.timeout || 9000) / 1000) + 's');
        if (csp) throw new NetError('blocked', "blocked by this preview's sandbox");
        if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new NetError('offline', 'offline');
        if (SANDBOXED) throw new NetError('blocked', "blocked by this preview's sandbox");
        let reach = false;                                     // reachable without CORS? then it was CORS
        try { await fetch(url, { mode: 'no-cors', cache: 'no-store' }); reach = true; } catch (e2){}
        if (csp) throw new NetError('blocked', "blocked by this preview's sandbox");
        if (reach) throw new NetError('cors', "the server doesn't allow browser requests");
        throw new NetError('unreachable', 'could not reach ' + host(url));
      }
      const text = await r.text();
      const ms = performance.now() - t0;
      const headers = []; try { r.headers.forEach((v, k) => headers.push([k, v])); } catch (e){}
      const type = (r.headers.get('content-type') || '').split(';')[0].trim();
      const res = { status: r.status, statusText: r.statusText || HTTP_TEXT[r.status] || '', ok: r.ok, headers, type, text, ms, bytes: new Blob([text]).size, url: r.url || url };
      if (opt.json || /json/.test(type)){ try { res.data = JSON.parse(text); } catch (e){ if (opt.json) throw new NetError('http', 'the answer was not JSON', r.status); } }
      if (opt.json && !r.ok) throw new NetError('http', 'HTTP ' + r.status + (res.statusText ? ' ' + res.statusText : ''), r.status);
      return res;
    } finally { clearTimeout(timer); try { document.removeEventListener('securitypolicyviolation', onCsp); } catch (e){} }
  },
  json(url, opt = {}){ return net.get(url, Object.assign({ json: true }, opt)).then(r => r.data); },
  /* an honest two-line explanation of a failure */
  fail(io, name, e){
    if (!(e instanceof NetError)){ io.err(name + ': ' + ((e && e.message) || e) + '\n'); return 1; }
    const why = {
      blocked: ["blocked by this preview's sandbox", 'network requests are switched off here. it works on the live site'],
      offline: ['offline', 'this browser has no connection right now'],
      cors: ["CORS: the server doesn't allow browser requests", 'the site answered, but will not share it with a web page'],
      timeout: ['timeout: ' + e.message, 'the server is slow or unreachable. try again'],
      unreachable: [e.message, 'the host may not exist, or the connection dropped'],
      http: [e.message, e.status === 404 ? 'nothing there' : e.status === 403 || e.status === 429 ? 'refused, or rate limited. try again later' : ''],
    }[e.kind] || [e.message, ''];
    if (io.tty && io.ui){
      const o = io.ui(); o.at(0, [name + ': ', 'd'], [why[0], 'b']); if (why[1]) o.para(why[1], 'f', io.cols - 4, 2); io.rich(o);
    } else io.err(name + ': ' + why[0] + '\n');
    return 1;
  },
};
const HTTP_TEXT = { 200: 'OK', 201: 'Created', 204: 'No Content', 301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable' };
const host = u => { try { return new URL(u).host; } catch (e){ return String(u); } };
M.net = net;
T.cmds.weather = { g: 'net', desc: 'the weather where you are, or anywhere', usage: 'weather [-c | -f] [city]',
  opts: [['-c', 'Celsius'], ['-f', 'Fahrenheit']], ex: ['weather', 'weather tokyo', 'weather -f new york'],
  more: 'Asks open-meteo.com for the weather now and the next three days. With no city it guesses yours from your time zone, then remembers the last city you named. Nothing about you leaves the browser except the city name.',
  async run(argv, io){
    let a = argv.slice(1), unit = null;
    while (a[0] === '-c' || a[0] === '-f'){ unit = a[0] === '-f' ? 'F' : 'C'; a = a.slice(1); }
    if (!unit){ let l = ''; try { l = navigator.language || ''; } catch (e){} unit = /^en-(US|LR|MM)$/i.test(l) ? 'F' : 'C'; }
    let tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e){}
    let q = a.join(' ').trim(), guessed = false;
    if (q) lsSet(WX_CITY, q);
    else q = lsGet(WX_CITY, '');
    if (!q && /^[A-Za-z]+\/[A-Za-z_\-]+/.test(tz) && !/^Etc\//.test(tz)){ q = tz.split('/').pop().replace(/_/g, ' '); guessed = true; }
    if (!q){ io.err('weather: which city? try weather london\n'); return 1; }
    if (io.tty){ io.out('asking the sky over ' + q + '...\n', 'faint'); }
    let place, wx;
    try {
      const g = await net.json('https://geocoding-api.open-meteo.com/v1/search?count=10&language=en&format=json&name=' + encodeURIComponent(q));
      const rs = (g && g.results) || [];
      place = (guessed && rs.find(r => r.timezone === tz)) || rs[0];
      if (!place){ io.err('weather: no place called ' + q + '\n'); if (!a.length) lsSet(WX_CITY, ''); return 1; }
      wx = await net.json('https://api.open-meteo.com/v1/forecast?latitude=' + place.latitude + '&longitude=' + place.longitude +
        '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day' +
        '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=4' +
        (unit === 'F' ? '&temperature_unit=fahrenheit&wind_speed_unit=mph' : ''));
    } catch (e){ return net.fail(io, 'weather', e); }
    const c = wx && wx.current, d = wx && wx.daily;
    if (!c || !d){ io.err('weather: open-meteo sent something unexpected\n'); return 1; }
    const deg = v => Math.round(v) + '°';
    const [desc, kind0] = WMO[c.weather_code] || ['Unknown', 'cloud'];
    const kind = kind0 === 'sun' && !c.is_day ? 'moon' : kind0;
    const where = [place.name, place.admin1 && place.admin1 !== place.name ? place.admin1 : '', place.country].filter(Boolean);
    const wind = Math.round(c.wind_speed_10m) + (unit === 'F' ? ' mph' : ' km/h');
    const info = [
      [where.join(', '), 'b'],
      [desc, 'n'],
      [deg(c.temperature_2m) + unit + '  feels ' + deg(c.apparent_temperature), 'b'],
      ['wind ' + wind + '  hum ' + Math.round(c.relative_humidity_2m) + '%', 'd'],
      ['', 'n'],
    ];
    const days = d.time.slice(0, 4).map((t, i) => {
      const dt = new Date(t + 'T12:00:00');
      return { day: i === 0 ? 'Today' : DAYS3[dt.getDay()], hi: deg(d.temperature_2m_max[i]), lo: deg(d.temperature_2m_min[i]),
        p: d.precipitation_probability_max && d.precipitation_probability_max[i] != null ? d.precipitation_probability_max[i] + '%' : '', desc: (WMO[d.weather_code[i]] || ['?'])[0] };
    });
    show(io, o => {
      const room = io.cols - 17;
      o.blank();
      WX_ICON[kind].forEach((ic, k) => {
        let s = info[k][0]; if (s.length > room) s = k === 0 ? place.name.slice(0, room) : s.slice(0, room);
        o.at(2, ic, ['  ', 'n'], [s, info[k][1]]);
      });
      o.blank().head('next days').blank();
      const dw = Math.max(0, io.cols - 2 - 7 - 10 - 6 - 2);
      for (const x of days) o.at(2, [x.day.padEnd(7), x.day === 'Today' ? 'b' : 'd'], [(x.hi + ' ' + x.lo).padEnd(10), 'n'], [x.p.padStart(4) + '  ', 'd'], [x.desc.slice(0, dw), 'n']);
      o.blank().at(2, ['open-meteo.com', 'f'], [io.cols >= 46 ? '   weather -' + (unit === 'F' ? 'c' : 'f') + ' for °' + (unit === 'F' ? 'C' : 'F') : '', 'f']).blank();
    }, () => where.join(', ') + '\n' + desc + ', ' + deg(c.temperature_2m) + unit + ', feels ' + deg(c.apparent_temperature) + ', wind ' + wind + '\n' +
      days.map(x => x.day.padEnd(7) + (x.hi + ' ' + x.lo).padEnd(10) + x.p.padStart(4) + '  ' + x.desc).join('\n') + '\n');
  } };

/* =====================================================================================
   clock, timer, stopwatch, pomodoro: one big-digit face, four ways to run it
   ===================================================================================== */
function parseDur(s){
  s = String(s || '').trim().toLowerCase(); if (!s) return null;
  let m;
  if ((m = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(s))) return m[3] != null ? (+m[1] * 3600 + +m[2] * 60 + +m[3]) : (+m[1] * 60 + +m[2]);
  if (/^\d*\.?\d+$/.test(s)) return parseFloat(s) * 60;            // a bare number is minutes
  let t = 0, any = false; const re = /(\d*\.?\d+)\s*(h|hr|hrs|hours?|m|min|mins|minutes?|s|sec|secs|seconds?)/g;
  let rest = s.replace(re, (x, n, u) => { any = true; t += parseFloat(n) * (u[0] === 'h' ? 3600 : u[0] === 'm' ? 60 : 1); return ''; });
  return any && !rest.trim() ? t : null;
}
const fmtHMS = (sec, tenths) => {
  sec = Math.max(0, sec); const s = Math.floor(sec), h = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = s % 60;
  return (h ? h + ':' + two(mm) : String(mm)) + ':' + two(ss) + (tenths ? '.' + Math.floor((sec - s) * 10) : '');
};
const POMO_KEY = 'kaiav.pomodoro';
function faceApp(mode){
  return { start(api, argv){
    const now = () => performance.now() / 1000;
    let dur = 0, t0 = now(), paused = false, pausedAt = 0, done = false, doneAt = 0, laps = [], running = mode !== 'stopwatch', acc = 0, lastSec = -1;
    let phase = 'focus', round = 1, focusM = 25, breakM = 5, beeps = 0, beepT = 0;
    const pomo = lsGet(POMO_KEY, { day: '', n: 0 });
    const today = new Date().toDateString(); if (pomo.day !== today){ pomo.day = today; pomo.n = 0; }
    if (mode === 'timer'){
      dur = parseDur(argv.slice(1).join(' '));
      if (!(dur > 0)){ api.print(argv[1] ? 'timer: cannot read ' + argv.slice(1).join(' ') + '. try timer 5m, timer 90s or timer 1:30' : 'usage: timer 5m   (also 90s, 1:30, 1h)'); api.exit(1); return {}; }
      if (dur > 86400){ api.print('timer: up to 24 hours'); api.exit(1); return {}; }
    }
    if (mode === 'pomodoro'){
      const f = parseFloat(argv[1]), b = parseFloat(argv[2]);
      if (argv[1] && !(f > 0 && f <= 180)){ api.print('usage: pomodoro [focus minutes [break minutes]]'); api.exit(1); return {}; }
      if (f) focusM = f; if (b > 0 && b <= 60) breakM = b;
      dur = focusM * 60;
    }
    const elapsed = () => paused ? pausedAt - t0 : (running ? now() - t0 : acc);
    function ring(n){ beeps = n; beepT = 0; }
    function nextPhase(auto){
      if (phase === 'focus'){ if (auto){ pomo.n++; lsSet(POMO_KEY, pomo); } phase = 'break'; dur = (round % 4 === 0 ? Math.max(breakM, 15) : breakM) * 60; }
      else { phase = 'focus'; round++; dur = focusM * 60; }
      t0 = now(); paused = false; ring(auto ? 3 : 0);
    }
    function finish(){
      const msg = mode === 'timer' ? 'timer: ' + fmtHMS(dur) + ' done' : mode === 'stopwatch' ? 'stopwatch: ' + fmtHMS(elapsed(), true) + (laps.length ? ', ' + laps.length + ' laps' : '')
        : mode === 'pomodoro' ? 'pomodoro: ' + pomo.n + (pomo.n === 1 ? ' focus block' : ' focus blocks') + ' today' : '';
      if (msg) api.print(msg);
      api.exit(0);
    }
    return {
      key(e){
        if (e.ctrlKey || e.metaKey) return false;
        const k = e.key;
        if (done){ finish(); return true; }
        if (isQuit(e)){ finish(); return true; }
        if (k === ' ' || k === 'p' || k === 'Enter'){
          if (mode === 'stopwatch'){ if (running){ acc = now() - t0; running = false; } else { t0 = now() - acc; running = true; } }
          else if (mode !== 'clock'){ if (paused){ t0 += now() - pausedAt; paused = false; } else { pausedAt = now(); paused = true; } }
          return true;
        }
        if (k === 'r' || k === 'R'){ t0 = now(); acc = 0; laps = []; paused = false; if (mode === 'stopwatch') running = false; return true; }
        if ((k === 'l' || k === 'L') && mode === 'stopwatch' && running){ laps.unshift(elapsed()); if (laps.length > 99) laps.pop(); return true; }
        if ((k === 'n' || k === 'N') && mode === 'pomodoro'){ nextPhase(false); return true; }
        if ((k === '+' || k === '=') && mode === 'timer'){ dur += 60; return true; }
        if (k === '-' && mode === 'timer'){ dur = Math.max(elapsed() + 1, dur - 60); return true; }
        return false;
      },
      tick(dt){
        if (beeps > 0){ beepT -= dt; if (beepT <= 0){ beep(api); beeps--; beepT = 0.32; } }
        if ((mode === 'timer' || mode === 'pomodoro') && !paused && !done && elapsed() >= dur){
          if (mode === 'timer'){ done = true; doneAt = now(); ring(4); }
          else nextPhase(true);
          return true;
        }
        if (done && now() - doneAt > 60) finish();
        const s = Math.floor(now() * (mode === 'stopwatch' && running ? 10 : 2));
        if (s !== lastSec){ lastSec = s; return true; }
        return false;
      },
      render(scr){
        scr.clear();
        const W = scr.cols, H = scr.rows;
        const d = new Date();
        let big, small = '', title, sub = '', sub2 = '', frac = -1, keys;
        if (mode === 'clock'){
          big = d.getHours() + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds()); title = 'clock';
          sub = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
          let tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e){}
          sub2 = tz.replace(/_/g, ' ');
          keys = [['q', 'quit']];
        } else if (mode === 'stopwatch'){
          const e = elapsed(); big = fmtHMS(e); small = '.' + Math.floor((e % 1) * 10); title = 'stopwatch';
          sub = running ? 'running' : e > 0 ? 'stopped' : 'ready';
          keys = [['space', running ? 'stop' : 'start'], ['l', 'lap'], ['r', 'reset'], ['q', 'quit']];
        } else {
          const left = Math.max(0, dur - elapsed());
          big = fmtHMS(Math.ceil(left - 1e-6)); frac = Math.min(1, elapsed() / dur);
          if (mode === 'timer'){ title = 'timer'; sub = done ? "time's up" : paused ? 'paused' : fmtHMS(dur) + ' timer'; keys = done ? [['any key', 'done']] : [['space', paused ? 'resume' : 'pause'], ['+/-', 'a minute'], ['r', 'restart'], ['q', 'quit']]; }
          else { title = phase === 'focus' ? 'focus' : 'break'; sub = (paused ? 'paused  ' : '') + 'round ' + round + '   ' + pomo.n + ' done today'; keys = [['space', paused ? 'resume' : 'pause'], ['n', 'skip'], ['r', 'restart'], ['q', 'quit']]; }
        }
        const avail = H - 7;
        let f = fitScale(big, W - 4, avail);
        if ((!f || f.sx < 2) && mode !== 'stopwatch' && big.split(':').length === 3){       // too small with seconds: big h:mm, small :ss
          const short = big.slice(0, big.lastIndexOf(':')), g2 = fitScale(short, W - 4, avail);
          if (g2 && (!f || g2.sx > f.sx)){ small = big.slice(big.lastIndexOf(':')); big = short; f = g2; }
        }
        const blockH = f ? f.h : 1;
        const top = Math.max(2, ((H - blockH - 5) / 2) | 0);
        center(scr, top - 2 >= 0 ? top - 2 : 0, spaced(title), 'dim');
        const flash = done && Math.floor(now() * 2) % 2 === 0;
        const st = blk(done ? (flash ? 'bright' : 'dim') : paused ? 'dim' : mode === 'pomodoro' && phase === 'break' ? 'normal' : 'bright');
        const tail = small;
        if (f){ const beside = tail && f.w + tail.length + 1 <= W - 2, x = ((W - f.w - (beside ? tail.length + 1 : 0)) / 2) | 0; bigText(scr, x, top, big, f.sx, f.sy, st); if (tail){ if (beside) scr.put(x + f.w + 1, top + f.h - 1, tail, 'dim'); else scr.put(x + f.w - tail.length, top + f.h, tail, 'dim'); } }
        else center(scr, top, big, 'bright');
        let y = top + blockH + 1;
        if (frac >= 0){
          const bw = Math.min(W - 8, f ? Math.max(f.w, 20) : 30), bx = ((W - bw) / 2) | 0, on = Math.round(bw * frac);
          scr.fill(bx, y, bw, 1, '·', 'faint'); scr.fill(bx, y, on, 1, ' ', blk(done ? 'bright' : 'dim'));
          y += 2;
        }
        center(scr, y, sub, done ? 'bright' : 'normal');
        if (sub2) center(scr, y + 1, sub2, 'faint');
        if (mode === 'stopwatch' && laps.length){
          const room = Math.max(0, H - 2 - (y + 2));
          laps.slice(0, room).forEach((l, i) => center(scr, y + 2 + i, ('lap ' + (laps.length - i)).padEnd(8) + fmtHMS(l, true).padStart(10), i ? 'faint' : 'dim'));
        }
        keysLine(scr, H - 1, keys);
      },
    };
  } };
}
T.apps.clock = Object.assign(faceApp('clock'), { g: 'tools', desc: 'a big clock', usage: 'clock', more: 'The time, large, in your time zone. q quits.' });
T.apps.timer = Object.assign(faceApp('timer'), { g: 'tools', desc: 'count down, then beep', usage: 'timer duration', ex: ['timer 5m', 'timer 90s', 'timer 1:30', 'timer 1h 15m'],
  more: 'Counts down in big digits and beeps when it reaches zero. A bare number is minutes. Space pauses, + and - add or take a minute, r starts over, q quits.' });
T.apps.stopwatch = Object.assign(faceApp('stopwatch'), { g: 'tools', desc: 'count up, with laps', usage: 'stopwatch', more: 'Space starts and stops, l records a lap, r resets, q quits and prints the time.' });
T.apps.pomodoro = Object.assign(faceApp('pomodoro'), { g: 'tools', desc: 'focus 25, break 5, repeat', usage: 'pomodoro [focus [break]]', ex: ['pomodoro', 'pomodoro 50 10'],
  more: 'Alternates focus and break blocks, in minutes (25 and 5 unless you say), with a longer break every fourth round. It beeps at each change and counts the focus blocks you finish today. Space pauses, n skips ahead, r restarts the block, q quits.' });

/* =====================================================================================
   typing: a typing test, on a keyboard with hands on it
   ===================================================================================== */
const PASSAGES = [
  'The quick brown fox jumps over the lazy dog, then naps in the sun while the rest of us keep typing.',
  'A good terminal waits patiently. It does not mind a typo; it only asks that you press enter when you mean it.',
  'Build the small version first. Show it to someone. Listen closely, change one thing, and show it again tomorrow.',
  'The lamp hums, the coffee cools, and the cursor blinks on. There is always one more line worth writing tonight.',
  'Pack my box with five dozen liquor jugs, said the sphinx of black quartz, judging my vow with quiet amusement.',
  'Most hard problems get easier once you write them down. The rest get easier after a walk and a glass of water.',
  'Keys are loud on an old machine. Each one lands with a click, and a page of clicks starts to sound like rain.',
  'Start before you feel ready. Ask for help early. Ship it on a Tuesday, fix it on a Wednesday, and keep going.',
];
const TYPE_BEST = 'kaiav.typing.best';
T.apps.typing = { g: 'fun', desc: 'a typing test: how fast are you?', usage: 'typing',
  more: 'Type the passage as it appears. The clock starts on your first key. Mistakes light up; backspace fixes them. At the end you get words per minute (five characters to a word, correct ones only) and accuracy. Tab gives a new passage, esc quits.',
  start(api){
    let best = lsGet(TYPE_BEST, 0) || 0, order = PASSAGES.map((_, i) => i).sort(() => Math.random() - 0.5), pi = 0;
    let text, typed, t0, t1, keys, errs, done, newBest, lastShow = -1;
    const now = () => performance.now() / 1000;
    function reset(){ text = PASSAGES[order[pi++ % order.length]]; typed = ''; t0 = 0; t1 = 0; keys = 0; errs = 0; done = false; newBest = false; }
    reset();
    const correct = () => { let n = 0; for (let i = 0; i < typed.length; i++) if (typed[i] === text[i]) n++; return n; };
    const secs = () => t0 ? ((done ? t1 : now()) - t0) : 0;
    const wpm = () => { const s = secs(); return s > 0.5 ? Math.round(correct() / 5 / (s / 60)) : 0; };
    const acc = () => keys ? Math.max(0, Math.round((keys - errs) / keys * 100)) : 100;
    function end(){
      done = true; t1 = now();
      const w = wpm(); if (acc() >= 80 && w > best){ best = w; newBest = true; lsSet(TYPE_BEST, best); }
      api.sound && beep(api);
    }
    return {
      key(e){
        if (e.ctrlKey || e.metaKey || e.altKey) return false;
        const k = e.key;
        if (k === 'Escape'){ api.print(done ? 'typing: ' + wpm() + ' wpm, ' + acc() + '% accurate' : 'typing: stopped'); api.exit(0); return true; }
        if (k === 'Tab' || (done && k === 'Enter')){ if (e.preventDefault) e.preventDefault(); reset(); return true; }
        if (done){ if (k === 'q' || k === 'Q'){ api.print('typing: ' + wpm() + ' wpm, ' + acc() + '% accurate' + (newBest ? ', a new best' : '')); api.exit(0); } return true; }
        if (k === 'Backspace'){ typed = typed.slice(0, -1); return true; }
        if (k.length !== 1) return false;
        if (!t0) t0 = now();
        keys++; if (k !== text[typed.length]) errs++;
        typed += k;
        if (typed.length >= text.length) end();
        return true;
      },
      tick(){ const s = t0 && !done ? Math.floor(secs() * 2) : -1; if (s !== lastShow){ lastShow = s; return true; } return false; },
      render(scr){
        scr.clear();
        const W = scr.cols, H = scr.rows, w = Math.min(W - 4, 60), x0 = ((W - w) / 2) | 0;
        scr.put(x0, 0, spaced('typing'), 'dim');
        const stats = wpm() + ' wpm  ' + acc() + '%  ' + fmtHMS(secs());
        scr.put(x0 + w - stats.length, 0, stats, t0 ? 'normal' : 'faint');
        scr.fill(x0, 1, w, 1, '·', 'faint');
        // lay the passage out word by word, keeping each character's index
        const lines = []; let line = [], len = 0;
        const words = text.split(' '); let idx = 0;
        words.forEach((wd, i) => {
          const piece = wd + (i < words.length - 1 ? ' ' : '');
          if (len && len + wd.length > w){ lines.push(line); line = []; len = 0; }
          for (const c of piece){ line.push(idx++); len++; }
        });
        if (line.length) lines.push(line);
        const ty = done ? 3 : Math.max(3, ((H - lines.length * 2) / 2) | 0) - 1;
        lines.forEach((ln, r) => ln.forEach((i, c) => {
          const ch = text[i], y = ty + r * 2, x = x0 + c;
          if (i < typed.length){
            if (typed[i] === ch) scr.put(x, y, ch, 'bright');
            else scr.put(x, y, ch === ' ' ? '_' : ch, blk('normal'));
          } else scr.put(x, y, ch, 'faint');
          if (i === typed.length && !done) scr.cursor(x, y, 'under');
        }));
        if (done){
          scr.cursor(null);
          const y = ty + lines.length * 2 + 1;
          const n = String(wpm()), f = fitScale(n, W - 20, Math.max(5, H - y - 4)) || { sx: 1, sy: 1, w: bitWidth(DIG3, n), h: 5 };
          const bx = x0, by = y;
          if (y + f.h + 2 < H){ bigText(scr, bx, by, n, f.sx, f.sy, blk('bright')); scr.put(bx + f.w + 2, by + f.h - 1, 'wpm', 'dim'); }
          const sx = bx + f.w + 8 <= x0 + w - 14 ? bx + f.w + 8 : x0, sy = sx === x0 ? by + f.h + 1 : by;
          scr.put(sx, sy, 'accuracy', 'dim'); scr.put(sx + 10, sy, acc() + '%', 'normal');
          scr.put(sx, sy + 1, 'time', 'dim'); scr.put(sx + 10, sy + 1, fmtHMS(secs()), 'normal');
          scr.put(sx, sy + 2, 'best', 'dim'); scr.put(sx + 10, sy + 2, best ? best + ' wpm' + (newBest ? '  new!' : '') : '-', newBest ? 'bright' : 'normal');
          keysLine(scr, H - 1, [['enter', 'again'], ['q', 'quit']]);
        } else {
          keysLine(scr, H - 1, t0 ? [['tab', 'new passage'], ['esc', 'quit']] : [['start typing', ''], ['tab', 'new passage'], ['esc', 'quit']]);
        }
      },
    };
  } };

/* =====================================================================================
   matrix: falling characters. any key ends it
   ===================================================================================== */
T.apps.matrix = { g: 'fun', desc: 'digital rain', usage: 'matrix', more: 'Characters fall down the tube. Any key stops it.',
  start(api){
    const W = api.cols, H = api.rows, CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789$+-*/=%"#&<>[]{}:;~^';
    const rnd = () => CH[Math.random() * CH.length | 0];
    const cells = Array.from({ length: H }, () => Array.from({ length: W }, rnd));
    const drops = Array.from({ length: W }, (_, x) => x % 2 ? null : { y: -Math.random() * H * 2, v: 6 + Math.random() * 14, len: 4 + (Math.random() * H * 0.8 | 0) });
    let acc = 0;
    return {
      key(e){ if (e.ctrlKey && e.key !== 'c') return false; api.exit(0); return true; },
      tick(dt){
        acc += dt; if (acc < 1 / 24) return false; const step = acc; acc = 0;
        drops.forEach((d, x) => { if (!d) return; d.y += d.v * step; if (d.y - d.len > H){ d.y = -Math.random() * H; d.v = 6 + Math.random() * 14; d.len = 4 + (Math.random() * H * 0.8 | 0); } });
        for (let k = 0; k < W / 3; k++) cells[Math.random() * H | 0][Math.random() * W | 0] = rnd();
        return true;
      },
      render(scr){
        scr.clear();
        drops.forEach((d, x) => {
          if (!d) return;
          const head = Math.floor(d.y);
          for (let k = 0; k < d.len; k++){
            const y = head - k; if (y < 0 || y >= H) continue;
            scr.put(x, y, cells[y][x], k === 0 ? 'bright' : k < 3 ? 'accent' : k < d.len * 0.6 ? 'dim' : 'faint');
          }
        });
      },
    };
  } };
})();
