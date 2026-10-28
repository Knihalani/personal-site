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
      if (opt.json && !r.ok) throw new NetError('http', 'HTTP ' + r.status + (res.statusText ? ' ' + res.statusText : ''), r.status);
      if (opt.json || /json/.test(type)){ try { res.data = JSON.parse(text); } catch (e){ if (opt.json) throw new NetError('http', 'the answer was not JSON', r.status); } }
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

/* =====================================================================================
   shared: coloured JSON, span wrapping, little helpers
   ===================================================================================== */
const kb = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
const msStr = ms => ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(1) + ' s';
const clip = (t, n) => t.length <= n ? t : t.slice(0, Math.max(1, n - 3)).trimEnd() + '...';
const bareUrl = u => String(u || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
const argText = (io, a) => a.length ? a.join(' ') : String(io.stdin || '');
/* JSON -> lines of { ind, toks: [[text, style]] }: keys dim, strings normal, numbers bright, literals accent, punctuation faint */
function jsonLines(v){
  const lines = [];
  const scalar = x => typeof x === 'string' ? [JSON.stringify(x), 'n'] : typeof x === 'number' ? [String(x), 'b'] : [String(x), 'a'];
  (function walk(x, ind, pre, comma){
    const cm = comma ? [[',', 'f']] : [];
    if (x && typeof x === 'object'){
      const arr = Array.isArray(x), ks = arr ? x.map((_, i) => i) : Object.keys(x);
      if (!ks.length){ lines.push({ ind, toks: [...pre, [arr ? '[]' : '{}', 'f'], ...cm] }); return; }
      lines.push({ ind, toks: [...pre, [arr ? '[' : '{', 'f']] });
      ks.forEach((k, i) => walk(x[k], ind + 2, arr ? [] : [[JSON.stringify(String(k)), 'd'], [': ', 'f']], i < ks.length - 1));
      lines.push({ ind, toks: [[arr ? ']' : '}', 'f'], ...cm] });
    } else lines.push({ ind, toks: [...pre, scalar(x), ...cm] });
  })(v, 0, [], false);
  return lines;
}
/* cut a line of spans into rows no wider than width; continuation rows are indented by cont */
function wrapSpans(toks, width, cont = 2){
  const rows = []; let row = [], w = 0, room = width;
  for (let [t, st] of toks){
    while (t.length){
      if (w >= room){ rows.push(row); row = []; w = 0; room = Math.max(8, width - cont); }
      const take = t.slice(0, room - w); row.push([take, st]); w += take.length; t = t.slice(take.length);
    }
  }
  rows.push(row);
  return rows.map((r, i) => ({ cont: i > 0, toks: r }));
}
/* print a JSON value on the screen, coloured and wrapped, at most max rows; returns rows not shown */
function showJSON(o, v, cols, max = 1e9, i0 = 2){
  let n = 0, hidden = 0;
  for (const l of jsonLines(v)){
    for (const r of wrapSpans(l.toks, cols - i0 - l.ind - 1)){
      if (n >= max){ hidden++; continue; }
      o.at(i0 + l.ind + (r.cont ? 2 : 0), ...(r.toks.length ? r.toks : [['', 'n']])); n++;
    }
  }
  return hidden;
}

/* =====================================================================================
   curl: fetch a url and show what came back
   ===================================================================================== */
T.cmds.curl = { g: 'net', desc: 'fetch a url and show the answer', usage: 'curl [-i] [-s] [-X METHOD] [-H "k: v"] [-d data] url',
  opts: [['-i', 'show the response headers'], ['-s', 'just the body: no status or footer'], ['-X METHOD', 'GET, POST, PUT, DELETE...'], ['-H "k: v"', 'add a request header'], ['-d DATA', 'send a body (and POST)']],
  ex: ['curl api.github.com/zen', 'curl -i httpbin.org/get', 'curl wttr.in/?format=3', 'curl api.ipify.org > ip.txt'],
  more: 'Makes a real request from your browser. JSON comes back pretty-printed and coloured; long answers are cut short on screen but whole in a pipe or a file. A bare domain means https. The server has to allow requests from web pages (CORS), and the claude.ai preview blocks the network entirely.',
  async run(argv, io){
    const a = argv.slice(1); let inc = false, silent = false, method = null, data = null, url = null; const headers = {};
    for (let i = 0; i < a.length; i++){
      const x = a[i];
      if (x === '-i' || x === '--include') inc = true;
      else if (x === '-s' || x === '--silent') silent = true;
      else if (x === '-L' || x === '-f') {}
      else if (x === '-X' || x === '--request'){ method = String(a[++i] || '').toUpperCase(); }
      else if (x === '-H' || x === '--header'){ const h = String(a[++i] || ''), k = h.indexOf(':'); if (k > 0) headers[h.slice(0, k).trim()] = h.slice(k + 1).trim(); }
      else if (x === '-d' || x === '--data'){ data = a[++i] == null ? '' : a[i]; }
      else if (/^-/.test(x)){ io.err('curl: unknown option ' + x + '   (man curl)\n'); return 2; }
      else url = x;
    }
    if (!url){ io.err('usage: curl url   (try: curl api.github.com/zen)\n'); return 2; }
    if (!/^[a-z]+:\/\//i.test(url)) url = 'https://' + url;
    if (!/^https?:\/\//i.test(url)){ io.err('curl: only http and https\n'); return 2; }
    if (data != null && !method) method = 'POST';
    if (data != null && !Object.keys(headers).some(k => /^content-type$/i.test(k))) headers['Content-Type'] = /^\s*[[{]/.test(data) ? 'application/json' : 'application/x-www-form-urlencoded';
    let r;
    try { r = await net.get(url, { method: method || 'GET', headers, body: data == null ? undefined : data }); }
    catch (e){ return net.fail(io, 'curl', e); }
    if (!io.tty){
      if (inc) io.out('HTTP ' + r.status + ' ' + r.statusText + '\n' + r.headers.map(([k, v]) => k + ': ' + v).join('\n') + '\n\n');
      io.out(r.text + (r.text && !r.text.endsWith('\n') ? '\n' : ''));
      return r.ok ? 0 : 22;
    }
    const o = io.ui(), max = Math.max(24, io.rows * 2);
    if (!silent){
      o.at(0, ['HTTP ' + r.status, r.ok ? 'b' : 'a'], [' ' + r.statusText, 'd']);
      if (inc){
        const hs = r.headers.slice(0, 12);
        for (const [k, v] of hs){ const row = wrapSpans([[k + ': ', 'd'], [v, 'n']], io.cols - 1)[0]; o.at(0, ...row.toks); }
        if (r.headers.length > hs.length) o.at(0, ['(' + (r.headers.length - hs.length) + ' more headers)', 'f']);
      }
      o.blank();
    }
    let hidden = 0;
    if (r.data !== undefined) hidden = showJSON(o, r.data, io.cols, max, 0);
    else {
      let n = 0;
      const text = r.text.replace(/\r/g, '').replace(/\t/g, '  ').replace(/\n+$/, '');
      for (const line of text ? text.split('\n') : []){
        for (const row of wrapSpans([[line, 'n']], io.cols)){ if (n >= max){ hidden++; continue; } o.at(row.cont ? 2 : 0, ...(row.toks.length ? row.toks : [['', 'n']])); n++; }
      }
      if (!text) o.at(0, ['(empty body)', 'f']);
    }
    if (hidden) o.at(0, ['... ' + hidden + ' more lines', 'd'], ['   | less, or > file', 'f']);
    if (!silent){
      o.blank();
      const bits = [String(r.status), kb(r.bytes), msStr(r.ms), r.type].filter(Boolean);
      o.at(0, [bits.join(' · ').slice(0, io.cols), 'f']);
    }
    io.rich(o);
    return r.ok ? 0 : 22;
  } };
T.cmds.fetch = Object.assign({}, T.cmds.curl, { hidden: true, desc: 'same as curl' });

/* =====================================================================================
   hn, wiki, define, github, ip: live data, each one a small card
   ===================================================================================== */
T.cmds.hn = { g: 'net', desc: 'Hacker News, the top stories', usage: 'hn [count]', ex: ['hn', 'hn 5', 'hn 20 | grep -i ai'],
  more: 'The front page of Hacker News, from its public API. Arrows pick a story, enter opens it, 1 to 9 jump. Piped, it prints points, title and link, one story per line.',
  async run(argv, io){
    const n = Math.max(1, Math.min(30, parseInt(argv[1], 10) || (io.tty ? Math.max(5, Math.min(10, io.rows - 8)) : 10)));
    if (argv[1] && !(parseInt(argv[1], 10) > 0)){ io.err('usage: hn [count]   (1 to 30)\n'); return 2; }
    let items;
    try {
      const ids = await net.json('https://hacker-news.firebaseio.com/v0/topstories.json');
      items = (await Promise.all(ids.slice(0, n).map(id => net.json('https://hacker-news.firebaseio.com/v0/item/' + id + '.json').catch(() => null)))).filter(Boolean);
    } catch (e){ return net.fail(io, 'hn', e); }
    const link = it => it.url || 'https://news.ycombinator.com/item?id=' + it.id;
    if (!io.tty){ io.out(items.map(it => String(it.score || 0).padStart(5) + '  ' + it.title + '  ' + link(it)).join('\n') + '\n'); return; }
    const lw = Math.max(...items.map(it => String(it.score || 0).length)) + 2;
    const room = io.cols - 3 - 5 - lw - 1;
    const o = io.ui();
    o.blank().card({ title: 'HACKER NEWS', note: 'top ' + items.length, verb: 'open',
      items: items.map(it => ({ label: String(it.score || 0), value: io.cols < 46 ? clip(it.title, 64) : clip(it.title, room), full: link(it), url: link(it) })) });
    io.rich(o);
    return io.pick(o.lastCard).then(() => {});
  } };

T.cmds.wiki = { g: 'net', desc: 'the opening of a Wikipedia article', usage: 'wiki topic...', ex: ['wiki alan turing', 'wiki vt100', 'wiki pomodoro technique'],
  more: 'Looks the topic up on English Wikipedia and prints the summary at the top of the article, with a link you can open.',
  async run(argv, io){
    const q = argv.slice(1).join(' ').trim();
    if (!q){ io.err('usage: wiki topic   (try: wiki alan turing)\n'); return 2; }
    const sum = t => net.json('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(t.replace(/ /g, '_')) + '?redirect=true');
    let d;
    try {
      try { d = await sum(q); }
      catch (e){
        if (e.status !== 404) throw e;
        const s = await net.json('https://en.wikipedia.org/w/api.php?action=opensearch&limit=1&namespace=0&format=json&origin=*&search=' + encodeURIComponent(q));
        if (!s[1] || !s[1][0]){ io.err('wiki: no article for ' + q + '\n'); return 1; }
        d = await sum(s[1][0]);
      }
    } catch (e){ return net.fail(io, 'wiki', e); }
    const url = (d.content_urls && d.content_urls.desktop && d.content_urls.desktop.page) || 'https://en.wikipedia.org/wiki/' + encodeURIComponent(q);
    const extract = String(d.extract || '').trim();
    if (!io.tty){ io.out(d.title + '\n' + (d.description ? d.description + '\n' : '') + '\n' + extract + '\n\n' + url + '\n'); return; }
    const o = io.ui(), w = io.cols - 6;
    o.blank().at(2, [d.title || q, 'b']);
    if (d.description) o.para(d.description, 'd', w);
    o.blank();
    let ls = wrap(extract, w); const max = Math.max(4, io.rows - 11);
    if (ls.length > max){ ls = ls.slice(0, max); ls[max - 1] = clip(ls[max - 1] + ' ...', w); }
    for (const l of ls) o.at(2, [l, 'n']);
    if (d.type === 'disambiguation') o.blank().at(2, ['this name means several things. try something more specific', 'f']);
    o.blank().card({ title: 'WIKIPEDIA', items: [{ label: 'read', value: bareUrl(url), full: url, url, hint: 'open' }] });
    io.rich(o);
    return io.pick(o.lastCard).then(() => {});
  } };

T.cmds.define = { g: 'net', desc: 'what a word means', usage: 'define word', ex: ['define serendipity', 'define terminal'],
  more: 'English definitions from dictionaryapi.dev: the pronunciation, then up to three senses for each part of speech, with an example where there is one.',
  async run(argv, io){
    const w = argv.slice(1).join(' ').trim();
    if (!w){ io.err('usage: define word   (try: define serendipity)\n'); return 2; }
    let d;
    try { d = await net.json('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(w.toLowerCase())); }
    catch (e){ if (e.status === 404){ io.err('define: no entry for ' + w + '\n'); return 1; } return net.fail(io, 'define', e); }
    const e0 = d[0] || {}, ph = e0.phonetic || ((e0.phonetics || []).find(p => p.text) || {}).text || '';
    const means = [];
    for (const e of d) for (const m of e.meanings || []){ const ex = means.find(x => x.pos === m.partOfSpeech); if (ex) ex.defs.push(...m.definitions); else means.push({ pos: m.partOfSpeech, defs: m.definitions.slice() }); }
    if (!io.tty){ io.out(e0.word + (ph ? '  ' + ph : '') + '\n' + means.map(m => m.pos + '\n' + m.defs.slice(0, 3).map((x, i) => '  ' + (i + 1) + '. ' + x.definition).join('\n')).join('\n') + '\n'); return; }
    const o = io.ui(), W = io.cols - 8;
    o.blank().at(2, [e0.word || w, 'b'], [ph ? '   ' + ph : '', 'd']).blank();
    let budget = Math.max(8, io.rows * 2 - 6);
    for (const m of means.slice(0, 3)){
      if (budget <= 2) break;
      o.at(2, [m.pos, 'a']); budget--;
      m.defs.slice(0, 3).forEach((x, i) => {
        if (budget <= 1) return;
        wrap(x.definition, W).forEach((l, k) => { o.at(k ? 6 : 4, [k ? '' : (i + 1) + ' ', 'f'], [l, 'n']); budget--; });
        if (x.example && budget > 2) wrap('"' + x.example + '"', W - 2).forEach(l => { o.at(6, [l, 'd']); budget--; });
      });
      o.blank(); budget--;
    }
    io.rich(o);
  } };

T.cmds.github = { g: 'net', desc: 'a GitHub profile, by user name', usage: 'github [user]', ex: ['github torvalds', 'github knihalani', 'github'],
  more: 'A public GitHub profile from api.github.com: name, bio, where, repos, followers and when they joined, with the profile to open. With no name it opens the repository for this site. GitHub allows 60 lookups an hour from one address.',
  async run(argv, io){
    const u = (argv[1] || '').replace(/^@/, '');
    if (!u){ const gh = T.cmds.gh; if (gh && gh !== T.cmds.github) return gh.run(['gh'], io); io.err('usage: github user\n'); return 2; }
    if (!/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(u)){ io.err('github: that is not a GitHub user name\n'); return 2; }
    let d;
    try { d = await net.json('https://api.github.com/users/' + encodeURIComponent(u)); }
    catch (e){ if (e.status === 404){ io.err('github: no user called ' + u + '\n'); return 1; } return net.fail(io, 'github', e); }
    const joined = d.created_at ? new Date(d.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : '';
    const rows = [['repos', d.public_repos], ['followers', d.followers], ['following', d.following], ['where', d.location], ['company', d.company], ['joined', joined]]
      .filter(r => r[1] != null && r[1] !== '').map(([label, v]) => ({ label, value: clip(String(v), io.cols - 22) }));
    if (!io.tty){ io.out((d.name ? d.name + ' ' : '') + '@' + d.login + '\n' + (d.bio ? d.bio.trim() + '\n' : '') + rows.map(r => r.label.padEnd(11) + r.value).join('\n') + '\n' + d.html_url + '\n'); return; }
    const o = io.ui();
    o.blank().at(2, [d.name || d.login, 'b'], [d.name ? '  @' + d.login : '', 'd']);
    if (d.bio) o.para(d.bio.trim(), 'n', io.cols - 6);
    o.blank().card({ title: 'GITHUB', note: d.type === 'Organization' ? 'org' : '', items: [...rows, { label: 'profile', value: bareUrl(d.html_url), full: d.html_url, url: d.html_url, hint: 'open' }] });
    io.rich(o);
    return io.pick(o.lastCard).then(() => {});
  } };
T.cmds['gh-user'] = Object.assign({}, T.cmds.github, { hidden: true, usage: 'gh-user user' });

T.cmds.ip = { g: 'net', desc: 'your public IP address', usage: 'ip', ex: ['ip', 'ip > ip.txt'],
  more: 'Asks api.ipify.org which address your requests come from. Enter copies it.',
  async run(argv, io){
    let d; try { d = await net.json('https://api.ipify.org?format=json'); } catch (e){ return net.fail(io, 'ip', e); }
    if (!io.tty){ io.out(d.ip + '\n'); return; }
    const o = io.ui(); o.blank().card({ title: 'IP', note: 'api.ipify.org', items: [{ label: 'public', value: d.ip, copy: d.ip, hint: 'copy' }] });
    io.rich(o); return io.pick(o.lastCard).then(() => {});
  } };

/* =====================================================================================
   qr: a real QR encoder. byte mode, versions 1 to 10, error correction M (or L when long)
   ===================================================================================== */
const QR = (() => {
  const ECC = { L: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18], M: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26] };
  const BLOCKS = { L: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4], M: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5] };
  const FMT = { L: 1, M: 0 };
  const raw = v => { let r = (16 * v + 128) * v + 64; if (v >= 2){ const na = Math.floor(v / 7) + 2; r -= (25 * na - 10) * na - 55; if (v >= 7) r -= 36; } return r; };
  const dataCw = (v, e) => Math.floor(raw(v) / 8) - ECC[e][v - 1] * BLOCKS[e][v - 1];
  const mul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--){ z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z & 255; };
  function divisor(deg){ const r = new Array(deg).fill(0); r[deg - 1] = 1; let root = 1; for (let i = 0; i < deg; i++){ for (let j = 0; j < deg; j++){ r[j] = mul(r[j], root); if (j + 1 < deg) r[j] ^= r[j + 1]; } root = mul(root, 2); } return r; }
  function remainder(data, div){ const r = div.map(() => 0); for (const b of data){ const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= mul(c, f); }); } return r; }
  function align(v){ if (v === 1) return []; const n = Math.floor(v / 7) + 2, size = v * 4 + 17, step = Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2; const r = [6]; for (let p = size - 7; r.length < n; p -= step) r.splice(1, 0, p); return r; }
  function encode(text, prefer = 'M'){
    const bytes = Array.from(new TextEncoder().encode(text));
    let v = 0, e = prefer;
    for (const ee of prefer === 'L' ? ['L'] : ['M', 'L']){
      for (let vv = 1; vv <= 10; vv++){ if (4 + (vv < 10 ? 8 : 16) + bytes.length * 8 <= dataCw(vv, ee) * 8){ v = vv; break; } }
      if (v){ e = ee; break; }
    }
    if (!v) return null;
    // bit stream
    const bits = []; const put = (x, n) => { for (let i = n - 1; i >= 0; i--) bits.push((x >>> i) & 1); };
    put(4, 4); put(bytes.length, v < 10 ? 8 : 16); for (const b of bytes) put(b, 8);
    const cap = dataCw(v, e) * 8;
    put(0, Math.min(4, cap - bits.length)); while (bits.length % 8) bits.push(0);
    for (let pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
    const data = []; for (let i = 0; i < bits.length; i += 8){ let b = 0; for (let k = 0; k < 8; k++) b = (b << 1) | bits[i + k]; data.push(b); }
    // error correction, interleaved
    const nb = BLOCKS[e][v - 1], el = ECC[e][v - 1], rawCw = Math.floor(raw(v) / 8), nShort = nb - rawCw % nb, shortLen = Math.floor(rawCw / nb);
    const div = divisor(el), blocks = [];
    for (let i = 0, k = 0; i < nb; i++){
      const d = data.slice(k, k + shortLen - el + (i < nShort ? 0 : 1)); k += d.length;
      const ec = remainder(d, div); if (i < nShort) d.push(0); blocks.push(d.concat(ec));
    }
    const cw = []; for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - el || j >= nShort) cw.push(b[i]); });
    // modules
    const size = v * 4 + 17, mod = [], fn = [];
    for (let y = 0; y < size; y++){ mod.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
    const set = (x, y, d) => { mod[y][x] = d; fn[y][x] = true; };
    for (let i = 0; i < size; i++){ set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++){ const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy)); if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4); } };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const al = align(v), na = al.length;
    for (let i = 0; i < na; i++) for (let j = 0; j < na; j++){
      if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    const format = mask => {
      const d = FMT[e] << 3 | mask; let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      const b = ((d << 10) | r) ^ 0x5412, bit = i => ((b >>> i) & 1) === 1;
      for (let i = 0; i <= 5; i++) set(8, i, bit(i));
      set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
      set(8, size - 8, true);
    };
    format(0);
    if (v >= 7){
      let r = v; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
      const b = (v << 12) | r;
      for (let i = 0; i < 18; i++){ const d = ((b >>> i) & 1) === 1, a = size - 11 + i % 3, c = Math.floor(i / 3); set(a, c, d); set(c, a, d); }
    }
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2){
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++){
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
        if (!fn[y][x] && i < cw.length * 8){ mod[y][x] = ((cw[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
      }
    }
    const MASKS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
      (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0];
    const apply = m => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[m](x, y)) mod[y][x] = !mod[y][x]; };
    const penalty = () => {      // rules 1, 2 and 4 of the spec: enough to pick a sensible mask
      let p = 0, dark = 0;
      for (let y = 0; y < size; y++){ let run = 1, runC = 1; for (let x = 0; x < size; x++){ if (mod[y][x]) dark++;
        if (x){ if (mod[y][x] === mod[y][x - 1]){ run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1;
                if (mod[x][y] === mod[x - 1][y]){ runC++; if (runC === 5) p += 3; else if (runC > 5) p++; } else runC = 1; } } }
      for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++){ const c = mod[y][x]; if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) p += 3; }
      return p + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
    };
    let best = 0, bp = Infinity;
    for (let m = 0; m < 8; m++){ apply(m); format(m); const p = penalty(); if (p < bp){ bp = p; best = m; } apply(m); }
    apply(best); format(best);
    return { modules: mod, version: v, ecc: e, size };
  }
  return { encode };
})();
M.qr = QR;
T.cmds.qr = { g: 'tools', desc: 'a QR code for text or a link', usage: 'qr [-l] text...', opts: [['-l', 'low error correction: room for more text']],
  ex: ['qr risingfounder.net', 'qr https://github.com/knihalani/personal-site', 'echo hello | qr'],
  more: 'Draws a QR code your phone camera can read. Up to about 200 characters (270 with -l). Piped or redirected, it comes out as text blocks.',
  run(argv, io){
    let a = argv.slice(1), lo = false; if (a[0] === '-l'){ lo = true; a = a.slice(1); }
    const text = argText(io, a).replace(/\n$/, '');
    if (!text){ io.err('usage: qr text   (try: qr risingfounder.net)\n'); return 2; }
    const q = QR.encode(text, lo ? 'L' : 'M');
    if (!q){ io.err('qr: too long for this little encoder (' + new TextEncoder().encode(text).length + ' bytes; ' + (lo ? 271 : 213) + ' max' + (lo ? '' : ', or 271 with -l') + ')\n'); return 1; }
    if (!io.tty){ const qz = 2, n = q.size + qz * 2; let s = ''; for (let y = -qz; y < q.size + qz; y++){ for (let x = -qz; x < q.size + qz; x++) s += (q.modules[y] && q.modules[y][x]) ? '##' : '  '; s += '\n'; } io.out(s); return; }
    const o = io.ui();
    o.blank().bits(q.modules, 3).blank().at(2, [clip(text.replace(/\s+/g, ' '), io.cols - 14), 'd'], ['   v' + q.version + ' ' + q.ecc, 'f']).blank();
    io.rich(o);
  } };

/* =====================================================================================
   small offline tools: hash, base64, uuid, pass, json, convert, roll, countdown
   ===================================================================================== */
const ALGOS = { sha1: 'SHA-1', 'sha-1': 'SHA-1', sha256: 'SHA-256', 'sha-256': 'SHA-256', sha384: 'SHA-384', 'sha-384': 'SHA-384', sha512: 'SHA-512', 'sha-512': 'SHA-512' };
T.cmds.hash = { g: 'tools', desc: 'SHA hash of text', usage: 'hash [sha1 | sha256 | sha512] [text...]', ex: ['hash hello', 'hash sha1 hello', 'cat README.md | hash sha512'],
  more: 'Prints the hex digest of its arguments, or of the standard input (byte for byte, newline included, like sha256sum). SHA-256 unless you name another.',
  async run(argv, io){
    let a = argv.slice(1), algo = 'SHA-256';
    if (a[0] && ALGOS[a[0].toLowerCase()]){ algo = ALGOS[a[0].toLowerCase()]; a = a.slice(1); }
    else if (a[0] && /^(md5|sha\d+|-)/i.test(a[0]) && a.length > 1){ io.err('hash: no ' + a[0] + ' here. sha1, sha256, sha384 or sha512\n'); return 2; }
    if (!a.length && !io.stdin){ io.err('usage: hash [sha256] text   (or pipe something in)\n'); return 2; }
    if (!(crypto && crypto.subtle)){ io.err('hash: this page cannot reach the browser crypto (it needs https)\n'); return 1; }
    const buf = await crypto.subtle.digest(algo, new TextEncoder().encode(argText(io, a)));
    const hex = Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
    if (io.tty){ const o = io.ui(); for (let i = 0; i < hex.length; i += io.cols - 4) o.at(2, [hex.slice(i, i + io.cols - 4), 'b']); o.at(2, [algo.toLowerCase().replace('-', ''), 'f']); io.rich(o); }
    else io.out(hex + '\n');
  } };
T.cmds.base64 = { g: 'tools', desc: 'encode or decode base64', usage: 'base64 [-d] [text...]', opts: [['-d', 'decode']], ex: ['base64 hello', 'echo aGVsbG8= | base64 -d', 'cat about.txt | base64'],
  more: 'Encodes its arguments or the standard input as base64 (UTF-8), or decodes with -d.',
  run(argv, io){
    let a = argv.slice(1), dec = false; if (a[0] === '-d' || a[0] === '--decode'){ dec = true; a = a.slice(1); }
    const t = argText(io, a);
    if (!t){ io.err('usage: base64 [-d] text   (or pipe something in)\n'); return 2; }
    if (dec){
      try { const bin = atob(t.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')); io.out(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))) + (io.tty ? '\n' : '')); }
      catch (e){ io.err('base64: that is not base64\n'); return 1; }
    } else { let bin = ''; for (const b of new TextEncoder().encode(t)) bin += String.fromCharCode(b); io.out(btoa(bin) + '\n'); }
  } };
T.cmds.uuid = { g: 'tools', desc: 'random UUIDs', usage: 'uuid [count]', ex: ['uuid', 'uuid 5'], more: 'Version 4 UUIDs from the browser\'s secure random numbers.',
  run(argv, io){
    const n = Math.max(1, Math.min(100, parseInt(argv[1], 10) || 1));
    const one = () => {
      if (crypto.randomUUID) return crypto.randomUUID();
      const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = b[6] & 15 | 64; b[8] = b[8] & 63 | 128;
      const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
      return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
    };
    io.out(Array.from({ length: n }, one).join('\n') + '\n');
  } };
T.cmds.pass = { g: 'tools', desc: 'a strong random password', usage: 'pass [-n] [length]', opts: [['-n', 'letters and digits only']], ex: ['pass', 'pass 32', 'pass -n 16'],
  more: 'Made in your browser from secure random numbers; it never leaves the page. 20 characters unless you say (8 to 128). Enter copies it.',
  run(argv, io){
    let a = argv.slice(1), plain = false; if (a[0] === '-n'){ plain = true; a = a.slice(1); }
    const len = a[0] ? parseInt(a[0], 10) : 20;
    if (!(len >= 8 && len <= 128)){ io.err('pass: length from 8 to 128\n'); return 2; }
    const set = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789' + (plain ? '' : '!@#$%^&*-_=+?');
    let pw = ''; const lim = 256 - 256 % set.length;
    while (pw.length < len){ for (const b of crypto.getRandomValues(new Uint8Array(len * 2))){ if (b < lim && pw.length < len) pw += set[b % set.length]; } }
    if (!io.tty){ io.out(pw + '\n'); return; }
    const o = io.ui(); o.blank().card({ title: 'PASSWORD', items: [{ label: len + ' chars', value: pw, copy: pw, hint: 'copy' }] });
    io.rich(o); return io.pick(o.lastCard).then(() => {});
  } };
T.cmds.json = { g: 'tools', desc: 'pretty-print JSON', usage: 'json [file]', ex: ["echo '{\"a\":[1,2]}' | json", 'curl api.github.com/users/torvalds | json'],
  more: 'Reads JSON from a file or the standard input and prints it indented, in colour on the screen.',
  run(argv, io){
    let t;
    if (argv[1]){ t = io.fs.read(argv[1]); if (t == null){ io.err('json: ' + argv[1] + ': No such file\n'); return 1; } } else t = io.stdin || '';
    if (!t.trim()){ io.err('usage: json file   (or pipe JSON in)\n'); return 2; }
    let v; try { v = JSON.parse(t); } catch (e){ io.err('json: not valid JSON: ' + String(e.message || e).replace(/^JSON\.parse: /, '') + '\n'); return 1; }
    if (!io.tty){ io.out(JSON.stringify(v, null, 2) + '\n'); return; }
    const o = io.ui(); showJSON(o, v, io.cols, 1e9, 0); io.rich(o);
  } };

const UNITS = (() => {
  const u = {}, add = (kind, base, names) => { for (const n of names.split(' ')) u[n] = { kind, f: base, name: names.split(' ')[0] }; };
  [['length', 0.001, 'mm millimeter millimeters millimetre millimetres'], ['length', 0.01, 'cm centimeter centimeters centimetre centimetres'], ['length', 1, 'm meter meters metre metres'],
   ['length', 1000, 'km kilometer kilometers kilometre kilometres'], ['length', 0.0254, 'in inch inches'], ['length', 0.3048, 'ft foot feet'], ['length', 0.9144, 'yd yard yards'],
   ['length', 1609.344, 'mi mile miles'], ['length', 1852, 'nmi nauticalmile'],
   ['mass', 1e-6, 'mg milligram milligrams'], ['mass', 0.001, 'g gram grams'], ['mass', 1, 'kg kilogram kilograms kilo kilos'], ['mass', 1000, 't tonne tonnes'],
   ['mass', 0.028349523125, 'oz ounce ounces'], ['mass', 0.45359237, 'lb lbs pound pounds'], ['mass', 6.35029318, 'st stone stones'],
   ['data', 0.125, 'bit bits'], ['data', 1, 'B byte bytes'], ['data', 1e3, 'KB kb kilobyte kilobytes'], ['data', 1e6, 'MB mb megabyte megabytes'], ['data', 1e9, 'GB gb gigabyte gigabytes'],
   ['data', 1e12, 'TB tb terabyte terabytes'], ['data', 1024, 'KiB kib'], ['data', 1048576, 'MiB mib'], ['data', 1073741824, 'GiB gib'], ['data', 1099511627776, 'TiB tib'],
   ['time', 1, 's sec secs second seconds'], ['time', 60, 'min mins minute minutes'], ['time', 3600, 'h hr hrs hour hours'], ['time', 86400, 'd day days'], ['time', 604800, 'wk week weeks'],
   ['volume', 0.001, 'ml milliliter milliliters millilitre millilitres'], ['volume', 1, 'l L liter liters litre litres'], ['volume', 3.785411784, 'gal gallon gallons'], ['volume', 0.2365882365, 'cup cups'],
   ['temperature', 0, 'C c celsius degc'], ['temperature', 0, 'F f fahrenheit degf'], ['temperature', 0, 'K k kelvin']].forEach(x => add(...x));
  return u;
})();
const findUnit = s => { s = String(s || '').replace(/^°/, '').replace(/\.$/, ''); return UNITS[s] || UNITS[s.toLowerCase()] || null; };
const toK = (v, n) => n === 'C' ? v + 273.15 : n === 'F' ? (v - 32) * 5 / 9 + 273.15 : v;
const fromK = (k, n) => n === 'C' ? k - 273.15 : n === 'F' ? (k - 273.15) * 9 / 5 + 32 : k;
const fmtNum = x => { if (!isFinite(x)) return String(x); const a = Math.abs(x); if (a !== 0 && (a >= 1e12 || a < 1e-6)) return x.toExponential(4); return String(+x.toPrecision(7)); };
const UNIT_SHOW = { length: ['mm', 'cm', 'm', 'km', 'in', 'ft', 'yd', 'mi'], mass: ['g', 'kg', 'oz', 'lb', 'st'], data: ['B', 'KB', 'MB', 'GB', 'KiB', 'MiB', 'GiB'], time: ['s', 'min', 'h', 'd', 'wk'], volume: ['ml', 'l', 'cup', 'gal'], temperature: ['C', 'F', 'K'] };
T.cmds.convert = { g: 'tools', desc: 'convert units', usage: 'convert number unit [to unit]', ex: ['convert 5 km to mi', 'convert 72 f c', 'convert 3.5 GB MiB', 'convert 180 lb'],
  more: 'Length, mass, temperature, data sizes, time and volume. Leave out the second unit to see the number in all the usual ones. KB, MB and GB are powers of 1000; KiB, MiB and GiB powers of 1024.',
  run(argv, io){
    const s = argv.slice(1).join(' ').trim();
    const m = /^(-?\d*\.?\d+(?:e[+-]?\d+)?)\s*(°?[a-z]+)(?:\s+(?:to|in|as|into)?\s*(°?[a-z]+))?\s*$/i.exec(s);
    if (!m){ io.err('usage: convert 5 km to mi   (man convert for the units)\n'); return 2; }
    const v = parseFloat(m[1]), from = findUnit(m[2]), to = m[3] ? findUnit(m[3]) : null;
    if (!from){ io.err('convert: no unit called ' + m[2] + '\n'); return 1; }
    if (m[3] && !to){ io.err('convert: no unit called ' + m[3] + '\n'); return 1; }
    if (to && to.kind !== from.kind){ io.err('convert: cannot turn ' + from.kind + ' into ' + to.kind + '\n'); return 1; }
    const conv = t => from.kind === 'temperature' ? fromK(toK(v, from.name), t.name) : v * from.f / t.f;
    const targets = to ? [to] : UNIT_SHOW[from.kind].map(n => UNITS[n]).filter(t => t.name !== from.name);
    if (!io.tty){ io.out(targets.map(t => fmtNum(conv(t)) + ' ' + t.name).join('\n') + '\n'); return; }
    const o = io.ui(); o.blank();
    if (to) o.at(2, [fmtNum(v) + ' ' + from.name, 'n'], [' = ', 'f'], [fmtNum(conv(to)) + ' ' + to.name, 'b']);
    else { o.at(2, [fmtNum(v) + ' ' + from.name, 'b'], ['  ' + from.kind, 'f']).blank(); const w = Math.max(...targets.map(t => fmtNum(conv(t)).length)); for (const t of targets) o.at(4, [fmtNum(conv(t)).padStart(w), 'n'], [' ' + t.name, 'd']); }
    o.blank(); io.rich(o);
  } };
T.cmds.units = Object.assign({}, T.cmds.convert, { hidden: true });

T.cmds.roll = { g: 'tools', desc: 'roll dice', usage: 'roll [NdS[+K]]...', ex: ['roll', 'roll d20', 'roll 2d6+3', 'roll 4d6 d8'],
  more: 'Dice notation: 2d6+3 means two six-sided dice plus three. One six-sided die unless you say.',
  run(argv, io){
    const specs = argv.length > 1 ? argv.slice(1) : ['1d6'];
    let total = 0; const groups = [];
    for (const sp of specs){
      const m = /^(\d*)d(\d+)([+-]\d+)?$/i.exec(sp);
      if (!m){ io.err('roll: cannot read ' + sp + '. try 2d6+3\n'); return 2; }
      const n = m[1] ? +m[1] : 1, sides = +m[2], k = m[3] ? +m[3] : 0;
      if (!(n >= 1 && n <= 100 && sides >= 2 && sides <= 1000)){ io.err('roll: 1 to 100 dice, 2 to 1000 sides\n'); return 2; }
      const vals = Array.from(crypto.getRandomValues(new Uint32Array(n)), r => r % sides + 1);
      total += vals.reduce((x, y) => x + y, 0) + k; groups.push({ sp, vals, k });
    }
    if (!io.tty){ io.out(groups.map(g => g.vals.join(' ') + (g.k ? (g.k > 0 ? ' +' : ' ') + g.k : '')).join('  ') + ' = ' + total + '\n'); return; }
    const o = io.ui(); o.blank();
    const chips = []; groups.forEach((g, gi) => { g.vals.forEach(v => chips.push([[' ' + v + ' ', 'i']])); if (g.k) chips.push([[(g.k > 0 ? '+' : '') + g.k, 'd']]); if (gi < groups.length - 1) chips.push([['+', 'f']]); });
    o.flow(chips, ' ');
    o.blank().at(2, ['total ', 'd'], [String(total), 'b'], ['   ' + specs.join(' '), 'f']).blank();
    io.rich(o);
  } };

const NAMED_DAYS = { 'new year': '01-01', 'new years': '01-01', christmas: '12-25', xmas: '12-25', halloween: '10-31', 'valentines': '02-14' };
T.cmds.countdown = { g: 'tools', desc: 'how long until a date', usage: 'countdown date', ex: ['countdown 2027-01-01', 'countdown dec 25', 'countdown christmas', 'countdown 2026-11-03 09:00'],
  more: 'Days, hours and minutes until a date (or since it, if it has passed). A date without a year means the next one.',
  run(argv, io){
    const raw = argv.slice(1).join(' ').trim(); if (!raw){ io.err('usage: countdown date   (try: countdown dec 25)\n'); return 2; }
    const now = new Date(); let s = raw.toLowerCase(), d;
    if (NAMED_DAYS[s]) s = now.getFullYear() + '-' + NAMED_DAYS[s];
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) d = new Date(s + 'T00:00:00');
    else if (/^\d{4}-\d{2}-\d{2}[ t]\d{1,2}:\d{2}$/.test(s)) d = new Date(s.replace(' ', 'T'));
    else { d = new Date(/\b\d{4}\b/.test(s) ? s : s + ' ' + now.getFullYear()); }
    if (isNaN(d)){ io.err('countdown: cannot read ' + raw + '. try 2027-01-01 or dec 25\n'); return 2; }
    if (!/\b\d{4}\b/.test(raw) && d < now && now - d > 864e5) d.setFullYear(d.getFullYear() + 1);
    let ms = d - now; const past = ms < 0; ms = Math.abs(ms);
    const days = Math.floor(ms / 864e5), hrs = Math.floor(ms / 36e5) % 24, mins = Math.floor(ms / 6e4) % 60;
    const when = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + (d.getHours() || d.getMinutes() ? ', ' + two(d.getHours()) + ':' + two(d.getMinutes()) : '');
    const rest = hrs + (hrs === 1 ? ' hour, ' : ' hours, ') + mins + (mins === 1 ? ' minute' : ' minutes');
    if (!io.tty){ io.out(days + ' days, ' + rest + (past ? ' since ' : ' until ') + when + '\n'); return; }
    const o = io.ui(); o.blank().big(days + (days === 1 ? ' day' : ' days'), 'b').at(2, ['and ' + rest, 'n']).at(2, [(past ? 'since ' : 'until ') + when, 'd']).blank();
    io.rich(o);
  } };
})();
