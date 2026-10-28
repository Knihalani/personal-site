/* terminal.js: the CRT terminal, the whole interface of the site.
   MAC.createTerminal({ content, aspect }) -> { canvas, handleKey, insertText, update, run, scroll }
   Also implements MAC.TERM (cmds, apps, io, api, scr, fs): see CONTRACT.md "Terminal extension API".
   A small shell: a virtual filesystem kept in localStorage, pipes, redirection, globs, aliases, history.

   Typeface: VT323, on purpose. It is drawn from the DEC VT320's own glyph ROM, so it belongs on a
   1980s tube; its strokes are a uniform pixel weight that survives the scene's curvature, scanlines and
   bloom, where Plex Mono's thin hairlines and ink traps would smear into mush. One face only: hierarchy
   comes from brightness (faint, dim, normal, bright), inverse video, and DEC-style double-size lines.

   Everything is drawn on a fixed COLS-column grid (54 to 60; nothing assumes a width). Rules, arrows, bars and diagrams are drawn as vectors in
   the same phosphor so we never depend on box-drawing glyphs the font may not have. */
(() => {
'use strict';
const M = window.MAC = window.MAC || {};
M.TERM = M.TERM || {}; M.TERM.cmds = M.TERM.cmds || {}; M.TERM.apps = M.TERM.apps || {};

/* ---- tunables ---- */
const PALETTE = {             // one phosphor, four intensities. Retune here to match the scene.
  bg:     '#0a0f0a',
  faint:  '#43603c',          // structure: rules, ghost text, hints
  dim:    '#6b9061',          // labels, secondary copy
  normal: '#c8f5b8',          // body copy
  bright: '#f0ffe8',          // titles, emphasis
  accent: '#8dffb4',          // matches, highlights: the same phosphor, driven harder
};
const FONT = 'VT323, "IBM Plex Mono", ui-monospace, monospace';
let COLS = 54;                 // grid width (opts.cols on phones); ~18 rows at 4:3
const WIDTH = 1280;            // canvas px
const LINE = 0.9;              // line height in em (VT323 has generous built-in leading)
const RATE = 1500;             // typing-out speed, characters per second
const BOOT_END = 1.85;         // seconds
const HIST_KEY = 'kaiav.term.history';
const T0 = performance.now();
const LOCK = '\ue000';        // drawn as a vector padlock (ls -l marks built-in files with it)

/* ---- fuzzy matching: prefix > substring > subsequence > small typo ---- */
function osa(a, b){
  const d = []; for (let i = 0; i <= a.length; i++){ d[i] = [i]; }
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++){
    const c = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
function fscore(q, c){
  q = q.toLowerCase(); c = c.toLowerCase();
  if (!q) return 0;
  if (c === q) return 1000;
  if (c.startsWith(q)) return 900 - (c.length - q.length);
  const at = c.indexOf(q);
  if (at >= 0 && q.length >= 2) return 700 - at;
  if (q.length >= 3 && Math.abs(q.length - c.length) <= 1 && osa(q, c) === 1) return 520;   // one slip (lss -> ls) beats a loose subsequence (lss -> less)
  if (q.length >= 2){
    let from = 0, gaps = 0, last = -1, ok = true;
    for (const chr of q){ const j = c.indexOf(chr, from); if (j < 0){ ok = false; break; } gaps += last < 0 ? j * 2 : j - last - 1; last = j; from = j + 1; }
    if (ok) return 500 - gaps * 12;
  }
  if (q.length >= 3){ const d = osa(q, c); if (d <= (q.length >= 5 ? 2 : 1)) return 300 - d * 60; }
  return 0;
}
/* best item for query; items: { name, alias?: [], kw?: [] } */
function fuzzy(q, items){
  let best = null, bs = 0;
  for (const it of items){
    let s = fscore(q, it.name);
    for (const a of it.alias || []) s = Math.max(s, fscore(q, a) - 5);
    for (const k of it.kw || []) s = Math.max(s, fscore(q, k) * 0.8);
    if (s > bs){ bs = s; best = it; }
  }
  return best && bs >= 150 ? { item: best, score: bs } : null;
}

function wrap(text, width){
  // written line breaks are kept (a blank line stays blank); "- " bullets wrap with a hanging indent
  const src = String(text), out = [];
  if (!/\n/.test(src)) return wrapLine(src, width, '');
  for (const ln of src.split('\n')){
    if (!ln.trim()){ out.push(''); continue; }
    const b = /^\s*[-*\u2022]\s+/.exec(ln);
    out.push(...(b ? wrapLine(ln.trim(), width, '  ') : wrapLine(ln, width, '')));
  }
  return out.length ? out : [''];
}
function wrapLine(text, width, hang){
  const out = []; let line = '';
  for (const w of String(text).split(/\s+/)){
    if (!w) continue;
    if (!line) line = (out.length ? hang : '') + w;
    else if (line.length + 1 + w.length <= width) line += ' ' + w;
    else { out.push(line); line = hang + w; }
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}
const ease = x => x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.pow(1 - x, 3);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length));


/* ---- virtual filesystem: a tree of { c: {} } dirs and { t } files, saved to localStorage ---- */
const HOME = '/home/kaiav';
const FS_KEY = 'kaiav.term.fs.v1';
function createFS(getCwd, onWrite){
  let root = null;
  try { const s = JSON.parse(localStorage.getItem(FS_KEY) || 'null'); if (s && s.c && typeof s.c === 'object') root = s; } catch (e){}
  const mk = () => ({ c: {}, m: Date.now() });
  const isD = n => !!(n && n.c);
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  if (!root) root = mk();
  function resolve(path, cwd){
    path = String(path == null ? '' : path);
    if (path === '~' || path.startsWith('~/')) path = HOME + path.slice(1);
    if (!path.startsWith('/')) path = (cwd || HOME) + '/' + path;
    const out = [];
    for (const p of path.split('/')){ if (!p || p === '.') continue; if (p === '..') out.pop(); else out.push(p); }
    return '/' + out.join('/');
  }
  const segs = abs => abs.split('/').filter(Boolean);
  const base = abs => segs(abs).pop() || '/';
  const join = (d, n) => (d === '/' ? '' : d) + '/' + n;
  function get(abs){ let n = root; for (const s of segs(abs)){ if (!isD(n) || !own(n.c, s)) return null; n = n.c[s]; } return n; }
  function parent(abs){ const s = segs(abs); const name = s.pop(); return { dir: get('/' + s.join('/')), name }; }
  let tSave = 0;
  const persist = () => { try { localStorage.setItem(FS_KEY, JSON.stringify(root)); } catch (e){} };
  function changed(quiet){ clearTimeout(tSave); tSave = setTimeout(persist, 200); if (onWrite && !quiet) onWrite(); }
  const R = p => resolve(p, getCwd());
  const info = (name, n) => ({ name, dir: isD(n), size: isD(n) ? 0 : n.t.length, mtime: n.m || 0, locked: !isD(n) && n.g === 1 });
  /* built-in files (n.g) are read-only: every write path below goes through these checks */
  const lockedNode = n => !!(n && !isD(n) && n.g === 1);
  const tild = a => a === HOME ? '~' : a.startsWith(HOME + '/') ? '~' + a.slice(HOME.length) : a;
  const readOnly = abs => fail('read-only: ' + tild(abs) + ' is a built-in file');
  function lockedIn(abs){                       // the first locked file at or under abs, or null
    const n = get(abs); if (!n) return null;
    if (lockedNode(n)) return abs;
    if (isD(n)) for (const k of Object.keys(n.c)){ const r = lockedIn(join(abs, k)); if (r) return r; }
    return null;
  }
  const badName = n => !n || n === '__proto__' || n === 'constructor' || n === 'prototype';
  function fail(m){ api.lastError = m; return false; }
  function put(abs, text, app){
    const { dir, name } = parent(abs);
    if (!name) return fail('Is a directory');
    if (badName(name)) return fail('Invalid name');
    if (!isD(dir)) return fail('No such file or directory');
    const ex = own(dir.c, name) ? dir.c[name] : null;
    if (isD(ex)) return fail('Is a directory');
    if (lockedNode(ex)) return readOnly(abs);
    const t = app && ex ? ex.t + text : text;
    if (t.length > 262144) return fail('File too large');
    dir.c[name] = { t, m: Date.now() }; dir.m = Date.now();
    changed(); return true;
  }
  function mkdir(abs, parents){
    const s = segs(abs); let n = root;
    for (let i = 0; i < s.length; i++){
      const last = i === s.length - 1;
      if (badName(s[i])) return fail('Invalid name');
      if (own(n.c, s[i])){
        const x = n.c[s[i]];
        if (!isD(x)) return fail(last ? 'File exists' : 'Not a directory');
        if (last && !parents) return fail('File exists');
        n = x; continue;
      }
      if (!last && !parents) return fail('No such file or directory');
      n = n.c[s[i]] = mk();
    }
    changed(); return true;
  }
  const clone = n => { const c = JSON.parse(JSON.stringify(n)); const strip = x => { delete x.g; if (x.c) for (const k in x.c) strip(x.c[k]); }; strip(c); return c; };
  const api = {
    lastError: '',
    resolve: (p, cwd) => resolve(p, cwd == null ? getCwd() : cwd),
    exists: p => !!get(R(p)),
    isDir: p => isD(get(R(p))),
    read(p){ const n = get(R(p)); return n && !isD(n) ? n.t : null; },
    write: (p, text) => put(R(p), String(text == null ? '' : text), false),
    append: (p, text) => put(R(p), String(text == null ? '' : text), true),
    list(p){ const n = get(R(p == null ? '.' : p)); if (!isD(n)) return null; return Object.keys(n.c).sort().map(k => info(k, n.c[k])); },
    mkdir: (p, parents = true) => mkdir(R(p), parents),
    rm(p, recursive){
      const a = R(p); if (a === '/') return fail('Permission denied');
      const n = get(a); if (!n) return fail('No such file or directory');
      if (isD(n) && Object.keys(n.c).length && !recursive) return fail('Directory not empty');
      const lk = lockedIn(a); if (lk) return readOnly(lk);
      const { dir, name } = parent(a); delete dir.c[name]; dir.m = Date.now(); changed(); return true;
    },
    mv(a, b){
      const A = R(a); let B = R(b); const n = get(A);
      if (!n) return fail('No such file or directory');
      if (A === '/') return fail('Permission denied');
      if (isD(get(B))) B = join(B, base(A));
      if (B === A) return true;
      if (B.startsWith(A + '/')) return fail('cannot move a directory into itself');
      const lk = lockedIn(A) || (lockedNode(get(B)) ? B : null); if (lk) return readOnly(lk);
      const { dir, name } = parent(B);
      if (!isD(dir)) return fail('No such file or directory');
      if (badName(name)) return fail('Invalid name');
      if (own(dir.c, name) && isD(dir.c[name])) return fail('Is a directory');
      const from = parent(A); delete from.dir.c[from.name];
      delete n.g; dir.c[name] = n; dir.m = from.dir.m = Date.now(); changed(); return true;
    },
    cp(a, b){
      const A = R(a); let B = R(b); const n = get(A);
      if (!n) return fail('No such file or directory');
      if (isD(get(B))) B = join(B, base(A));
      if (B === A || B.startsWith(A + '/')) return fail('cannot copy onto itself');
      const { dir, name } = parent(B);
      if (!isD(dir)) return fail('No such file or directory');
      if (badName(name)) return fail('Invalid name');
      if (own(dir.c, name) && isD(dir.c[name]) !== isD(n)) return fail(isD(n) ? 'Not a directory' : 'Is a directory');
      if (own(dir.c, name)){ const lk = lockedIn(B); if (lk) return readOnly(lk); }
      const c = clone(n); c.m = Date.now(); dir.c[name] = c; changed(); return true;
    },
    stat(p){ const a = R(p), n = get(a); return n ? Object.assign(info(base(a), n), { path: a }) : null; },
    touch(p){ const a = R(p), n = get(a); if (n){ if (!lockedNode(n)){ n.m = Date.now(); changed(true); } return true; } return put(a, '', false); },
    isLocked: p => lockedNode(get(R(p))),
    node: p => get(R(p)),
    /* seed: files = [{ path, text, doc }], dirs = [path]. Built-in files are read-only, and on every load
       they are rewritten from MAC.CONTENT (recreated if an older visit removed them). */
    seed(dirs, files){
      if (!root.seeded) for (const d of dirs) mkdir(d, true);
      for (const f of files){
        const n = get(f.path);
        if (isD(n)) continue;
        if (!n){ const s = segs(f.path); s.pop(); if (!isD(get('/' + s.join('/')))) mkdir('/' + s.join('/'), true); }
        const { dir, name } = parent(f.path);
        if (!isD(dir)) continue;
        if (n && n.g === 1 && n.t === f.text){ n.doc = f.doc || undefined; continue; }
        dir.c[name] = { t: f.text, m: Date.now(), g: 1, doc: f.doc || undefined };
      }
      root.seeded = 1; changed(true);
    },
  };
  return api;
}

/* ---- shell syntax: words are lists of parts { s, q } with q = 'u' unquoted, 'd' double, 's' single ---- */
function lex(src){
  const toks = []; let i = 0, w = null;
  const push = (s, q) => { if (!w) w = { t: 'w', parts: [] }; w.parts.push({ s, q }); };
  const end = () => { if (w){ toks.push(w); w = null; } };
  while (i < src.length){
    const c = src[i];
    if (c === ' ' || c === '\t'){ end(); i++; continue; }
    if (c === "'"){
      const j = src.indexOf("'", i + 1); if (j < 0) throw new SyntaxError('unexpected end of line, looking for a closing \'');
      push(src.slice(i + 1, j), 's'); i = j + 1; continue;
    }
    if (c === '"'){
      let s = ''; i++; push('', 'd');
      while (i < src.length && src[i] !== '"'){
        if (src[i] === '\\' && i + 1 < src.length && '"\\$`'.includes(src[i + 1])){ push(s, 'd'); push(src[i + 1], 's'); s = ''; i += 2; }
        else s += src[i++];
      }
      if (i >= src.length) throw new SyntaxError('unexpected end of line, looking for a closing "');
      push(s, 'd'); i++; continue;
    }
    if (c === '\\'){ if (i + 1 < src.length) push(src[i + 1], 's'); i += 2; continue; }
    if (c === '2' && !w && src[i + 1] === '>'){ end(); const ap = src[i + 2] === '>'; toks.push({ t: 'op', v: ap ? '2>>' : '2>' }); i += ap ? 3 : 2; continue; }
    if ('|&;<>'.includes(c)){
      end();
      const two = src.slice(i, i + 2);
      if (two === '&&' || two === '||' || two === '>>'){ toks.push({ t: 'op', v: two }); i += 2; continue; }
      toks.push({ t: 'op', v: c === '&' ? ';' : c }); i++; continue;
    }
    if (c === '#' && !w) break;
    let j = i; while (j < src.length && !" \t'\"\\|&;<>".includes(src[j])) j++;
    push(src.slice(i, j), 'u'); i = j;
  }
  end(); return toks;
}
const REDIR = ['>', '>>', '<', '2>', '2>>'];
function parse(toks){
  const list = []; let pipe = [], cmd = { words: [], redirs: [] }, conn = null;
  const empty = () => !cmd.words.length && !cmd.redirs.length;
  const bad = v => new SyntaxError("syntax error near '" + v + "'");
  for (let k = 0; k < toks.length; k++){
    const t = toks[k];
    if (t.t === 'w'){ cmd.words.push(t); continue; }
    if (REDIR.includes(t.v)){ const nx = toks[++k]; if (!nx || nx.t !== 'w') throw bad(t.v); cmd.redirs.push({ op: t.v, w: nx }); continue; }
    if (empty()) throw bad(t.v);
    pipe.push(cmd); cmd = { words: [], redirs: [] };
    if (t.v === '|') continue;
    list.push({ conn, pipe }); pipe = []; conn = t.v;
  }
  if (!empty()){ pipe.push(cmd); list.push({ conn, pipe }); }
  else if (pipe.length || (conn && conn !== ';')) throw bad(pipe.length ? '|' : conn);
  return list;
}
const wordText = w => w.parts.map(p => p.s).join('');
const plainWord = w => w.t === 'w' && w.parts.every(p => p.q === 'u');

/* ---- safe arithmetic for bc ---- */
function calc(src){
  const s = src.replace(/\s+/g, ''); let i = 0;
  const fail = () => { throw new SyntaxError('syntax error'); };
  function atom(){
    if (s[i] === '('){ i++; const v = expr(); if (s[i] !== ')') fail(); i++; return v; }
    const f = /^(sqrt|abs|floor|ceil|round)\(/.exec(s.slice(i));
    if (f){ i += f[1].length; return Math[f[1]](atom()); }
    if (s.startsWith('pi', i)){ i += 2; return Math.PI; }
    const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i)); if (!m) fail();
    i += m[0].length; return parseFloat(m[0]);
  }
  function pow(){ const b = atom(); if (s[i] === '^'){ i++; return Math.pow(b, unary()); } return b; }
  function unary(){ if (s[i] === '-'){ i++; return -unary(); } if (s[i] === '+'){ i++; return unary(); } return pow(); }
  function term(){
    let v = unary();
    while ('*/%'.includes(s[i]) && s[i]){ const o = s[i++]; const r = unary(); if (o !== '*' && r === 0) throw new RangeError('divide by zero'); v = o === '*' ? v * r : o === '/' ? v / r : v % r; }
    return v;
  }
  function expr(){ let v = term(); while (s[i] === '+' || s[i] === '-'){ const o = s[i++]; const r = term(); v = o === '+' ? v + r : v - r; } return v; }
  if (!s) return null;
  const v = expr(); if (i < s.length) fail();
  if (!isFinite(v)) throw new RangeError('number too large');
  return Number.isInteger(v) ? String(v) : String(parseFloat(v.toFixed(10)));
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function getopts(args, valued = ''){
  const o = {}, a = [];
  for (let i = 0; i < args.length; i++){
    const x = args[i];
    if (x === '--'){ a.push(...args.slice(i + 1)); break; }
    if (/^-\d+$/.test(x) && valued.includes('n')){ o.n = x.slice(1); continue; }
    if (x.length > 1 && x[0] === '-' && !a.length){
      for (let j = 1; j < x.length; j++){ const f = x[j]; if (valued.includes(f)){ o[f] = x.slice(j + 1) || args[++i] || ''; break; } o[f] = true; }
      continue;
    }
    a.push(x);
  }
  return { o, a };
}
const linesOf = t => t ? t.replace(/\n$/, '').split('\n') : [];
function expandSet(s){
  s = s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
  let out = '';
  for (let i = 0; i < s.length; i++){
    if (s[i + 1] === '-' && i + 2 < s.length){ const a = s.charCodeAt(i), b = s.charCodeAt(i + 2); for (let c = a; c <= b && c - a < 256; c++) out += String.fromCharCode(c); i += 2; }
    else out += s[i];
  }
  return out;
}
function fieldList(spec){
  const r = [];
  for (const part of String(spec || '').split(',')){
    const m = /^(\d*)-?(\d*)$/.exec(part); if (!m || part === '') continue;
    const a = m[1] ? +m[1] : 1, b = part.includes('-') ? (m[2] ? +m[2] : 1e9) : a;
    r.push([a, b]);
  }
  return n => r.some(([a, b]) => n >= a && n <= b);
}

M.createTerminal = function createTerminal(opts){
  const C = (opts && opts.content) || M.CONTENT || {};
  if (opts && opts.cols >= 32) COLS = opts.cols | 0;
  const aspect = opts && opts.aspect > 0.3 && opts.aspect < 3 ? opts.aspect : 4 / 3;
  const W = WIDTH, H = Math.round(WIDTH / aspect);
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d', { alpha: false });
  const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const P = PALETTE;
  const sfx = name => { try { if (M.sound && M.sound.event) M.sound.event(name); } catch (e){} };
  let lastDisk = 0;
  const diskSound = () => { const t = performance.now(); if (t - lastDisk > 400){ lastDisk = t; sfx('disk'); } };

  /* ---- grid ---- */
  const PADX = 52, cw = (W - 2 * PADX) / COLS;
  let fs = cw / 0.4;                                    // VT323 advance is 0.4em; re-measured once loaded
  const ch = Math.round(fs * LINE);
  const ROWS = Math.floor((H - 64) / ch);
  const PADY = Math.round((H - ROWS * ch) / 2);
  const font = (k = 1) => (fs * k).toFixed(2) + 'px ' + FONT;
  const measureFont = () => { g.font = '100px ' + FONT; const r = g.measureText('M').width / 100; if (r > 0.2 && r < 0.8) fs = cw / r; dirty = true; };
  if (document.fonts && document.fonts.load){
    document.fonts.load('40px VT323').then(() => measureFont(), () => {});
    if (document.fonts.ready) document.fonts.ready.then(() => measureFont(), () => {});
  }

  /* ---- state ---- */
  let rows = [];            // scrollback: { k:'t'|'big'|'head'|'viz', ... }
  let shown = 0, partial = 0, carry = 0;   // typing-out progress
  let input = '', cur = 0;
  let scrollOff = 0, wheelAcc = 0;
  let booting = true, bootT = 0, bootLastDraw = -1;
  let now = 0, blinkT0 = 0, blinkOn = true, dirty = true;
  let animFps = 0, lastAnim = 0;
  let links = [], sel = -1;            // selectable link items in the latest output
  let suggestion = '';                 // "did you mean" target, shown as ghost on an empty prompt
  let tabState = null;
  let ahead = '';           // keys typed while a command runs, waiting for the next prompt ('\n' = a queued Enter)
  let okRuns = 0;           // commands that worked this visit (the first-visit hint goes after two)
  let runQueued = false;    // a whole line came in with the type-ahead: run it on the next frame
  let rs = null;            // ctrl+r search: { q, i, draft, dcur }
  let history = [];
  try { const h = JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); if (Array.isArray(h)) history = h.filter(s => typeof s === 'string').slice(-200); } catch (e){}
  let hIdx = history.length, hDraft = '', hPrefix = '';
  const fresh = !history.length;     // a first-time visitor (nothing typed here before)
  let ran = 0;
  let job = null;                      // the running command line, if any
  let app = null;                      // the full-screen app, if any
  let openRow = null;                  // the output row still being written to
  let status = 0;

  /* ---- shell state ---- */
  const FS = createFS(() => cwd, diskSound);
  let cwd = HOME;
  const ENV = { HOME, USER: 'kaiav', LOGNAME: 'kaiav', HOSTNAME: 'kn84', SHELL: '/bin/sh', TERM: 'vt320', PATH: '/bin:/usr/bin:/usr/games',
    PWD: HOME, LANG: 'en_US.UTF-8', COLUMNS: String(COLS), LINES: String(ROWS) };
  const ALIAS_KEY = 'kaiav.term.alias';
  let ALIASES = { ll: 'ls -l', la: 'ls -a', l: 'ls', dir: 'ls', cls: 'clear', less: 'cat', more: 'cat', quit: 'exit', logout: 'exit', '?': 'help', home: 'welcome' };
  try { const a = JSON.parse(localStorage.getItem(ALIAS_KEY) || 'null'); if (a && typeof a === 'object') ALIASES = Object.assign(Object.create(null), a); } catch (e){}
  const saveAliases = () => { try { localStorage.setItem(ALIAS_KEY, JSON.stringify(ALIASES)); } catch (e){} };
  const hasAlias = n => Object.prototype.hasOwnProperty.call(ALIASES, n);
  function setCwd(p){ ENV.OLDPWD = cwd; cwd = p; ENV.PWD = p; }
  const tildify = p => p === HOME ? '~' : p.startsWith(HOME + '/') ? '~' + p.slice(HOME.length) : p;

  /* ---- output builder (rich rows) ---- */
  function out(){
    const r = [], o = {
      rows: r,
      line(...spans){ const s = spans.map(x => typeof x === 'string' ? [x, 'n'] : x); r.push({ k: 't', i: 2, s }); return o; },
      at(i, ...spans){ o.line(...spans); r[r.length - 1].i = i; return o; },
      blank(){ r.push({ k: 't', i: 0, s: [] }); return o; },
      big(text, st = 'b'){ r.push({ k: 'big', i: 2, s: [[text, st]] }); return o; },
      head(label, note){ r.push({ k: 'head', i: 2, label, note: note || '' }); return o; },
      para(text, st = 'n', width = COLS - 6, i = 2){ for (const l of wrap(text, width)) o.at(i, [l, st]); return o; },
      viz(h, draw, live){ r.push({ k: 'viz', h, draw, live: live || null, t0: -1 }); return o; },
      /* a square bitmap (true = dark), dark on a lit field with a quiet zone of q modules: QR codes.
         Drawn as vectors so a module is square whatever the cell shape. */
      bits(m, q = 2){
        const n = m.length + 2 * q, availW = X(COLS - 2) - X(2), availH = (ROWS - 4) * ch;
        const sz = Math.max(2, Math.floor(Math.min(availW / n, availH / n, cw * 1.2)));
        const h = Math.ceil(n * sz / ch);
        r.push({ k: 'viz', h, live: null, t0: -1, draw(x, y){
          const x0 = Math.round(x), y0 = Math.round(y + (h * ch - n * sz) / 2);
          g.fillStyle = P.bright; g.fillRect(x0, y0, n * sz, n * sz);
          g.fillStyle = P.bg;
          for (let yy = 0; yy < m.length; yy++) for (let xx = 0; xx < m.length; xx++) if (m[yy][xx]) g.fillRect(x0 + (xx + q) * sz, y0 + (yy + q) * sz, sz, sz);
        } });
        return o;
      },
      /* a boxed panel: title in the top border, label/value rows, selectable rows (url or copy) with
         number shortcuts, and a footer line of keys while it is waiting for a choice */
      card(spec){ const c = makeCard(spec); r.push(c); o.lastCard = c; return o; },
      /* groups of spans laid out left to right with a gap, wrapping at the grid width */
      flow(groups, gap = '  ', i = 2){
        let line = [], w = 0;
        for (const gr of groups){
          const gw = gr.reduce((a, x) => a + x[0].length, 0);
          if (line.length && w + gap.length + gw > COLS - i){ o.at(i, ...line); line = []; w = 0; }
          if (line.length){ line.push([gap, 'f']); w += gap.length; }
          line.push(...gr); w += gw;
        }
        if (line.length) o.at(i, ...line);
        return o;
      },
      link(label, url, i = 2, labelW = 0, shown){
        const sp = []; if (label) sp.push([pad(label, labelW), 'd']);
        sp.push([shown || url, 'n', { url }]); r.push({ k: 't', i, s: sp }); return o;
      },
    };
    return o;
  }
  const heightOf = r => r.k === 'big' ? 2 : r.k === 'viz' || r.k === 'card' ? r.h : 1;
  const lenOf = r => r.k === 't' ? r.s.reduce((n, s) => n + s[0].length, 0) + (r.i || 0) : r.k === 'big' ? r.s[0][0].length : r.k === 'head' ? r.label.length * 2 : 0;
  const costOf = r => r.k === 'viz' || r.k === 'card' ? 40 : r.k === 'big' ? lenOf(r) * 2 + 4 : r.k === 'head' ? 30 : Math.max(3, lenOf(r) - (r.i || 0));
  const plainOf = r => r.k === 't' || r.k === 'big' ? r.s.map(s => s[1] === 'f' ? ' ' : s[0]).join('').replace(/\s+/g, ' ').trim()
    : r.k === 'card' ? r.title + '. ' + r.items.map(it => (it.ai >= 0 ? (it.ai + 1) + ', ' : '') + it.label + ': ' + (it.full || it.value)).join('. ') : '';
  const textOf = r => r.k === 't' ? (' '.repeat(r.i || 0) + r.s.map(s => s[0]).join('')).replace(/\s+$/, '') : r.k === 'big' ? '  ' + r.s[0][0] : r.k === 'head' ? '  ' + r.label.toUpperCase()
    : r.k === 'card' ? r.items.map(it => pad(it.label, r.lw) + (it.full || it.value)).join('\n') : null;
  function makeCard(spec){
    const items = spec.items.map(it => Object.assign({}, it));
    let ai = 0; for (const it of items) it.ai = it.url || it.copy || it.post ? ai++ : -1;
    const lw = Math.max(0, ...items.map(it => it.label.length)) + 2;
    const acts = items.filter(it => it.ai >= 0);
    const room = it => (COLS - 3) - (5 + lw) - (it.hint ? it.hint.length + 2 : 0);
    if (items.some(it => it.value.length > room(it))) for (const it of items) it.hint = '';   // values win over hints
    /* narrow screens: the label goes above the value, and a long value wraps at / . @ rather than being cut */
    const stacked = COLS < 46 || items.some(it => it.value.length > room(it));
    const vroom = COLS - 8;
    let y = 0;
    for (const it of items){
      it.y = y;
      if (!stacked){ it.lines = [it.value]; it.n = 1; y++; continue; }
      const parts = []; let v = it.value;
      while (v.length > vroom){ let cut = Math.max(v.lastIndexOf('/', vroom - 1), v.lastIndexOf('.', vroom - 1), v.lastIndexOf('@', vroom - 1), v.lastIndexOf(' ', vroom)); if (cut < vroom / 2) cut = vroom - 1; parts.push(v.slice(0, cut + 1).trimEnd()); v = v.slice(cut + 1).trimStart(); }
      parts.push(v); it.sub0 = parts.length;
      if (it.sub) parts.push(...wrap(it.sub, vroom).slice(0, 3));       // a post's summary, under its title
      it.lines = parts; it.n = 1 + parts.length; y += it.n;
    }
    const note = spec.note && spec.title.length + spec.note.length + 10 <= COLS ? spec.note : '';
    return { k: 'card', title: spec.title, note, items, acts, lw, stacked, body: y, sel: -1, verb: spec.verb || 'open',
      foot: null, h: y + (acts.length ? 3 : 2) };
  }

  function pushRow(r){ openRow = null; rows.push(r); dirty = true; }
  function emit(o, mirrorText){            // rich rows straight to the scrollback (outside a job)
    links = []; sel = -1;
    for (const r of o.rows){ if (r.k === 't') for (const s of r.s) if (s[2] && s[2].url) links.push(s[2]); pushRow(r); }
    trim();
    mirror(mirrorText || o.rows.map(plainOf).filter(Boolean).join('. '));
    toBottom(); dirty = true;
    if (REDUCED) revealAll();
  }
  function trim(){
    let total = 0; for (const r of rows) total += heightOf(r);
    let drop = 0; while (total > 1200 && drop < rows.length - 1){ total -= heightOf(rows[drop]); drop++; }
    if (drop){ rows.splice(0, drop); shown = Math.max(0, shown - drop); if (shown === 0) partial = 0; }
  }
  function mirror(text){
    const m = document.getElementById('mirror'); if (!m) return;
    let p = document.getElementById('mirror-out');
    if (!p){ p = document.createElement('p'); p.id = 'mirror-out'; m.appendChild(p); }
    text = String(text || '').replace(/\s+/g, ' ').replace(/\.\./g, '.').trim();
    if (!text) return;
    p.textContent = text.length > 600 ? text.slice(0, 597) + '...' : text;
  }
  const typing = () => shown < rows.length;
  function revealAll(){ const t = now; for (let i = shown; i < rows.length; i++) if (rows[i].k === 'viz' && rows[i].t0 < 0) rows[i].t0 = t - (REDUCED ? 99 : 0); shown = rows.length; partial = 0; carry = 0; dirty = true; }
  function toBottom(){ scrollOff = 0; wheelAcc = 0; }

  /* ---- streams: the tty writes styled spans into rows; buffers collect text for pipes and files ---- */
  const STY = { normal: 'n', dim: 'd', bright: 'b', faint: 'f', accent: 'a', inverse: 'i', n: 'n', d: 'd', b: 'b', f: 'f', a: 'a', i: 'i' };
  const clean = s => String(s == null ? '' : s).replace(/\t/g, '    ').replace(/\r/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
  const rowLen = r => r.s.reduce((n, s) => n + s[0].length, 0);
  function appendSpan(seg, st){
    while (seg){
      if (!openRow){ openRow = { k: 't', i: 0, s: [] }; rows.push(openRow); }
      const room = COLS - rowLen(openRow);
      if (room <= 0){ openRow = null; continue; }
      let piece = seg, rest = '';
      if (seg.length > room){
        const cut = seg.lastIndexOf(' ', room);
        if (cut > room * 0.5){ piece = seg.slice(0, cut); rest = seg.slice(cut + 1); }
        else { piece = seg.slice(0, room); rest = seg.slice(room); }
      }
      const last = openRow.s[openRow.s.length - 1];
      if (last && last[1] === st && !last[2]) last[0] += piece; else openRow.s.push([piece, st]);
      if (rest) openRow = null;
      seg = rest;
    }
  }
  const tty = {
    tty: true,
    write(t, style){
      t = clean(t); if (!t) return;
      const st = STY[style] || 'n';
      if (job) job.plain += t.replace(/\n/g, ' ');
      const segs = t.split('\n');
      segs.forEach((seg, k) => {
        if (seg) appendSpan(seg, st);
        if (k < segs.length - 1){ if (!openRow) rows.push({ k: 't', i: 0, s: [] }); openRow = null; }
      });
      if (rows.length > 4000) trim();
      dirty = true;
    },
    rich(o){
      openRow = null;
      for (const r of o.rows){ if (r.k === 't') for (const s of r.s) if (s[2] && s[2].url) links.push(s[2]); rows.push(r); }
      if (job) job.plain += o.rows.map(plainOf).filter(Boolean).join('. ') + ' ';
      dirty = true;
    },
  };
  function buffer(){
    const b = { tty: false, text: '',
      write(t){ b.text += clean(t); },
      rich(o){ b.text += o.rows.map(textOf).filter(x => x != null).join('\n') + '\n'; } };
    return b;
  }
  const NULLSINK = { tty: false, text: '', write(){}, rich(){} };
  /* error lines read the same everywhere: "name:" dim, the message normal, a trailing "(try: ...)" faint.
     Into a pipe or a file they are plain text. */
  function errLine(sink, t){
    t = String(t == null ? '' : t); if (!t) return;
    if (!sink.tty){ sink.write(t); return; }
    const ls = t.split('\n');
    ls.forEach((l, k) => {
      if (l){
        const m = /^((?:[\w.+\-!]+: )?)(.*?)((?:\s{2,}|\s(?=\())\(.*\))?$/.exec(l);
        const sty = [];                       // one style per character, then cut at spaces to fit
        for (const [part, st] of [[m[1], 'dim'], [m[2], 'normal'], [m[3] || '', 'faint']]) for (let q = 0; q < part.length; q++) sty.push(st);
        let at = 0, first = true;
        while (at < l.length){
          const room = first ? COLS : COLS - 2;
          let end = l.length;
          if (end - at > room){ end = l.lastIndexOf(' ', at + room); if (end <= at + room / 2) end = at + room; }
          if (!first) sink.write('\n  ');
          for (let q = at; q < end;){ let r = q; while (r < end && sty[r] === sty[q]) r++; sink.write(l.slice(q, r), sty[q]); q = r; }
          at = end; while (at < l.length && l[at] === ' ') at++;
          first = false;
        }
      }
      if (k < ls.length - 1) sink.write('\n');
    });
  }

  /* ---- content ---- */
  const L = C.links || {}, J = C.j || {}, E = C.eden || {}, A = C.about || {}, Wr = C.writing || {};
  const bare = u => String(u || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  const URLS = {
    linkedin: L.linkedin || 'https://www.linkedin.com/in/kaiav-nihalani-594703356/',
    x: L.x || 'https://x.com/KaiavRNihalani',
    gh: L.github || L.gh || 'https://github.com/knihalani/personal-site',
    j: J.url || 'https://risingfounder.net',
  };
  const EMAILS = (Array.isArray(C.contact) && C.contact.length) ? C.contact : (C.contact && Array.isArray(C.contact.emails) && C.contact.emails.length) ? C.contact.emails : [
    { label: 'J', email: 'kaiav@risingfounder.net' },
    { label: 'Everything else', email: 'kaiav.nihalani@gmail.com' },
  ];
  const OPEN = [
    { name: 'j', url: URLS.j, alias: ['risingfounder', 'rising'], kw: ['rising founder'], label: bare(URLS.j), title: 'J', short: bare(URLS.j) },
    { name: 'linkedin', url: URLS.linkedin, label: bare(URLS.linkedin), title: 'LinkedIn', short: bare(URLS.linkedin).replace(/^linkedin\.com\/(in\/)?/, '') },
    { name: 'x', url: URLS.x, alias: ['twitter'], label: bare(URLS.x), title: 'X', short: '@' + bare(URLS.x).replace(/^(x|twitter)\.com\//, '') },
    { name: 'gh', url: URLS.gh, alias: ['github', 'repo', 'source'], label: bare(URLS.gh), title: 'GitHub', short: bare(URLS.gh).replace(/^github\.com\//, '') },
  ];
  const LINKLIST = () => OPEN.filter(o => o.name !== 'j');
  const wrapT = (t, w = 50) => wrap(t, w).join('\n');
  const slugify = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const slugOf = p => p.slug || slugify(p.title) || String(p.id || '');
  const posts = () => (Wr.posts || []).filter(p => p && (p.status == null || p.status === 'published')).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const POSTITEMS = posts().map(p => ({ name: slugOf(p), kw: p.title ? [String(p.title).toLowerCase()] : [] }));
  /* a post by slug, id, title or list number (1 = newest) */
  const findPost = q => {
    const ps = posts(); q = String(q || '').trim(); if (!q) return null;
    const hit = ps.find(p => slugOf(p) === q || String(p.id) === q); if (hit) return hit;
    if (/^\d+$/.test(q) && +q >= 1 && +q <= ps.length) return ps[+q - 1];
    const f = fuzzy(q, POSTITEMS); return f ? ps.find(p => slugOf(p) === f.item.name) || null : null;
  };
  const TEXT = {
    about: () => [C.name, A.role, '', ...(A.body || []).map(p => wrapT(p))].filter(x => x != null).join('\n') + '\n',
    eden: () => [E.title || 'Eden', E.role, '', E.line, E.body ? '\n' + E.body : null].filter(x => x != null).join('\n') + '\n',
    j: () => [J.title || 'J', J.role, '', J.line, wrapT(J.body || ''), '', ...(J.facts || []).map(f => pad(f[0], 9) + f[1]), '', J.url].filter(x => x != null).join('\n') + '\n',
    links: () => LINKLIST().map(t => pad(t.name, 10) + t.url).join('\n') + '\n',
    writing: () => posts().length ? posts().map(p => [p.date, p.title, p.summary && wrapT(p.summary), p.html ? 'read ' + slugOf(p) : p.url].filter(Boolean).join('\n')).join('\n\n') + '\n' : 'No posts yet.\n',
  };
  const README = [
    '# README', '',
    'Welcome to the KN-84, the small computer on ' + (C.name ? C.name + "'s" : 'this') + ' desk.',
    'It runs a little shell. Everything here is safe to poke at.', '',
    '## things to try', '',
    '  about       who ' + (C.name ? C.name.split(' ')[0] : 'Kaiav') + ' is',
    '  eden        ' + [E.title || 'Eden', E.line].filter(Boolean).join('. '),
    '  j           ' + (J.title || 'J'),
    '  writing     posts',
    '  links       LinkedIn, X and GitHub',
    '  contact     email addresses',
    '  open x      open a link in a new tab', '',
    '## things to do', '',
    '  weather     the sky where you are',
    '  hn          Hacker News, top stories',
    '  wiki turing a Wikipedia summary',
    '  curl url    fetch anything',
    '  qr text     a QR code for your phone',
    '  convert 5 km to mi',
    '  todo        a to-do list',
    '  timer 5m    count down, then beep',
    '  pomodoro    focus 25, break 5',
    '  typing      a typing test',
    '  tetris      a game (snake too)',
    '  banner hi   big letters',
    '  lamp        the desk lamp', '',
    '## the shell', '',
    '  help        what you can type',
    '  man grep    the manual for grep',
    '  cat README.md | grep try',
    '  echo hello > notes/hello.txt',
    '  ls -l ~/notes', '',
    'Files you make stay in this browser.',
    'Tab completes. Up and down recall',
    'history. Ctrl+C stops a command.', '',
  ].join('\n');
  FS.seed([HOME, HOME + '/notes', HOME + '/writing', '/etc', '/tmp'], [
    { path: HOME + '/README.md', text: README },
    { path: HOME + '/about.txt', text: TEXT.about(), doc: 'about' },
    { path: HOME + '/eden.txt', text: TEXT.eden(), doc: 'eden' },
    { path: HOME + '/j.txt', text: TEXT.j(), doc: 'j' },
    { path: HOME + '/links.txt', text: TEXT.links(), doc: 'links' },
    ...posts().map(p => ({ path: HOME + '/writing/' + (p.date ? p.date + '-' : '') + (slugOf(p) || 'post') + '.txt',
      text: [p.title, p.date, '', p.summary && wrapT(p.summary), '', p.html ? 'read ' + slugOf(p) : p.url].filter(x => x != null).join('\n') + '\n' })),
    { path: '/etc/motd', text: 'KN-84 personal computer. KNOS 1.04.\nType help to begin, or cat README.md for a short guide.\n' },
    { path: '/etc/hostname', text: 'kn84\n' },
  ]);
  if (!FS.isDir(cwd)) cwd = '/';

  /* ---- documents ---- */
  function welcome(o){
    o.blank().big(C.name || '', 'b').line([A.role || [E.role && 'Founder of ' + E.title, J.title].filter(Boolean).join(' · '), 'n']).blank()
      .line(['type a word and press enter, or ' + (TAP ? 'tap' : 'click') + ' one', 'd'])
      .flow(['about', 'eden', 'j', 'contact', 'links', 'weather', 'tetris'].map(w => [chip(w, 'b')]), '  ')
      .blank();
    if (!history.length) o.line(chip('help', 'n'), [' shows everything you can do', 'f']).blank();
    else o.line(chip('help', 'n'), ['   tab completes   ', 'f'], ['\u2191', 'n'], [' recalls', 'f']).blank();
    return o;
  }
  /* a command chip: a word that, clicked or tapped, types and runs itself. A faint underline marks it. */
  const TAP = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  function chip(w, st = 'n', cmd){ return [w, st, { cmd: cmd || w }]; }
  function chips(ws, st = 'n'){ const r = []; ws.forEach((w, k) => { if (k) r.push(['  ', 'f']); r.push(chip(w, st)); }); return r; }
  const DOCS = {
    about(o){
      o.blank().head('about', 'about.txt').blank().big(C.name || '').line([A.role || '', 'n']).blank();
      for (const p of A.body || []) o.para(p, /^\[.*\]$/.test(p) ? 'd' : 'n');
      o.blank().line(['see also  ', 'f'], ...chips(['contact', 'eden', 'j', 'links'], 'n')).blank();
      return o;
    },
    eden(o){
      o.blank().big(E.title || 'Eden').blank()
        .card({ title: 'EDEN', note: 'eden.txt', items: [{ label: 'role', value: E.role || '' }, { label: 'what', value: E.line || '' }] })
        .blank();
      if (E.body) o.para(E.body, 'n').blank();
      o.viz(6, drawEden, () => 30).blank().line(['see also  ', 'f'], ...chips(['contact', 'j', 'about'], 'n')).blank();
      return o;
    },
    j(o){
      o.blank().big(J.title || 'J').line([J.role || '', 'd']).blank()
        .para(J.line || '', 'b').blank().para(J.body || '', 'n').blank()
        .card({ title: 'J', note: 'j.txt', items: [...(J.facts || []).map(f => ({ label: f[0], value: f[1] })),
          { label: 'site', value: bare(URLS.j), full: URLS.j, url: URLS.j, hint: 'open' }] }).blank()
        .line(['see also  ', 'f'], ...chips(['contact', 'eden', 'about'], 'n')).blank();
      return o;
    },
    writing(o){
      o.blank().head('writing', 'writing/').blank();
      const ps = posts();
      if (!ps.length){ o.viz(5, drawEmpty, () => 4).blank().line(['see also  ', 'f'], ...chips(['contact', 'about'], 'n')).blank(); return o; }
      /* one row per post: date, title; narrow screens stack them and add the summary. A post with html opens
         the reader; one with only a url opens the link */
      o.card({ title: 'POSTS', note: ps.length + (ps.length === 1 ? ' post' : ' posts'), verb: 'read', items: ps.map(p => ({
        label: p.date || '', value: p.title || 'Untitled', post: p.html ? slugOf(p) : null, url: p.html ? null : p.url || null,
        full: p.title || '', sub: p.summary || '', hint: p.html ? 'read' : p.url ? 'open' : '' })) }).blank();
      return o;
    },
    links(o){
      o.blank().card({ title: 'LINKS', note: 'links.txt', items: LINKLIST().map(t => ({ label: t.title, value: t.short, full: t.url, url: t.url, hint: t.name })) })
        .blank().at(2, ['also  ', 'f'], ...chips(['contact', 'j'], 'n'), ['  ', 'f'], ['open <name>', 'n']).blank();
      return o;
    },
  };
  /* clipboard: also synchronous inside the keydown; falls back to a hidden textarea */
  function copyText(t){
    const fallback = () => {
      const prev = document.activeElement;
      try {
        const ta = document.createElement('textarea');
        ta.value = t; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
        document.body.appendChild(ta); ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (prev && prev.focus) try { prev.focus({ preventScroll: true }); } catch (e){}
        return ok;
      } catch (e){ return false; }
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext !== false){
        navigator.clipboard.writeText(t).catch(fallback);
        return true;
      }
    } catch (e){}
    return fallback();
  }
  /* must run inside the keydown that asked for it, or popup blockers step in */
  function openTarget(url){
    try {
      if (/^mailto:/i.test(url)) return copyText(url.replace(/^mailto:/i, '').split('?')[0]);
      const w = window.open(url, '_blank');
      if (w){ try { w.opener = null; } catch (e){} return true; }
    } catch (e){}
    return false;
  }
  const openUrl = openTarget;
  const uptimeStr = () => {
    const s = Math.floor((performance.now() - T0) / 1000);
    const hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = s % 60;
    return (hh ? hh + 'h ' : '') + (hh || mm ? mm + 'm ' : '') + ss + 's';
  };
  const fmtDate = ms => { const d = new Date(ms || Date.now()); return MONTHS[d.getMonth()].slice(0, 3) + ' ' + String(d.getDate()).padStart(2, ' ') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const human = n => n < 1024 ? String(n) : (n / 1024).toFixed(n < 10240 ? 1 : 0) + 'K';
  function diskUse(){
    let bytes = 0, files = 0;
    const walk = p => { for (const e of FS.list(p) || []){ if (e.dir) walk((p === '/' ? '' : p) + '/' + e.name); else { bytes += e.size; files++; } } };
    walk('/'); return { bytes, files };
  }
  /* "rm: x: No such file", or for a built-in file just "rm: read-only: ~/README.md is a built-in file" */
  const fsErr = (name, p) => name + ': ' + (/^read-only:/.test(FS.lastError) ? '' : p + ': ') + FS.lastError + '\n';
  /* read named files (or stdin) for a text utility */
  function sources(io, files, name){
    if (!files.length) return [{ name: '(standard input)', text: io.stdin || '' }];
    const r = [];
    for (const f of files){
      if (f === '-'){ r.push({ name: '(standard input)', text: io.stdin || '' }); continue; }
      const t = FS.read(f);
      if (t == null){ io.err(name + ': ' + f + ': ' + (FS.isDir(f) ? 'Is a directory' : 'No such file or directory') + '\n'); if (!FS.exists(f)) hintPath(name, f); io.exit(1); continue; }
      r.push({ name: f, text: t });
    }
    return r;
  }
  /* suggest a near miss for a missing path, as a ghost the visitor can accept with enter */
  function hintPath(cmd, q){
    const slash = q.lastIndexOf('/');
    const dir = q.slice(0, slash + 1), b = q.slice(slash + 1);
    const ents = FS.list(dir || '.'); if (!ents || !b) return;
    const f = fuzzy(b, ents.map(e => ({ name: e.name + (e.dir ? '/' : '') })));
    if (f && job){ job.hint = cmd + ' ' + dir + f.item.name.replace(/\/$/, ''); }
  }

  /* ---- built-in commands. Shape matches MAC.TERM.cmds: { desc, usage, run(argv, io) } plus g (group),
         opts and ex for the manual. Registered commands with the same name win. ---- */
  const B = {};
  const def = (name, d) => { B[name] = d; };
  const doc = name => ({ g: 'read', desc: name === 'about' ? 'who ' + ((C.name || 'Kaiav').split(' ')[0]) + ' is' : name === 'eden' ? 'Eden. ' + (E.line || '') : name === 'j' ? J.title || 'J' : name === 'writing' ? 'posts' : 'LinkedIn and X',
    usage: name, run(argv, io){ if (io.tty){ const o = DOCS[name](out()); io.rich(o); if (o.lastCard && o.lastCard.acts.length) return io.pick(o.lastCard); } else io.write(TEXT[name]()); } });
  for (const n of ['about', 'eden', 'j', 'writing', 'links']) def(n, doc(n));
  def('open', { g: 'read', desc: 'open a link: a url, ' + OPEN.map(o => o.name).join(', '), usage: 'open <url | j | gh | linkedin | x>', ex: ['open j', 'open https://risingfounder.net'], run(argv, io){
    if (argv[1] === 'post') return B.read.run(['read', ...argv.slice(2)], io);
    const q = argv.slice(1).join(' ').trim();
    if (!q){
      if (!io.tty){ io.write(OPEN.map(x => pad(x.name, 10) + x.url).join('\n') + '\n'); return; }
      return io.choose(OPEN.map(x => ({ short: x.title, label: x.short, url: x.url })), 'open').then(() => {});
    }
    let url = null, label = '';
    if (/^(https?:\/\/|mailto:)\S+$/i.test(q)){ url = q; label = bare(q); }
    else if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(q)){ url = 'https://' + q; label = bare(q); }
    else { const f = fuzzy(q, OPEN); if (f){ url = f.item.url; label = f.item.label; } }
    if (!url){ io.err('open: no link called ' + q + '. try ' + OPEN.map(x => x.name).join(', ') + ' or a url\n'); return 1; }
    if (!io.tty){ io.write(url + '\n'); return; }
    if (/^mailto:/i.test(url)){                         // addresses are copied, never mailto'd
      const addr = url.replace(/^mailto:/i, '').split('?')[0];
      const ok = copyText(addr); sfx('beep');
      io.rich(out().at(0, [ok ? 'copied ' : 'copy this: ', 'd'], [addr, 'b'])); return;
    }
    const w = openTarget(url);
    const o = out(); o.at(0, ['opening ', 'd'], [label, 'b', { url }]); if (!w) o.at(2, ['if nothing opened, enter on the address opens it', 'f']); io.rich(o);
  } });
  def('read', { g: 'read', desc: 'read a post', usage: 'read <slug | n>', ex: ['read 1', 'open post <slug>'], run(argv, io){
    const q = argv.slice(1).join(' ').trim();
    if (!q) return B.writing.run(['writing'], io);
    const p = findPost(q);
    if (!p){ io.err('read: no post called ' + q + (posts().length ? '. try writing for the list' : '. no posts yet') + '\n'); return 1; }
    if (!io.tty){ io.write(TEXT.writing().split('\n\n')[posts().indexOf(p)] + '\n'); return; }
    if (!p.html && p.url){
      const w = openTarget(p.url);
      const o = out(); o.at(0, ['opening ', 'd'], [p.title || bare(p.url), 'b', { url: p.url }]); if (!w) o.at(2, ['if nothing opened, enter on the address opens it', 'f']); io.rich(o); return;
    }
    const ok = !!(M.reader && M.reader.open(slugOf(p)));
    io.rich(out().at(0, [ok ? 'reading ' : 'the reader is not available: ', 'd'], [p.title || slugOf(p), 'b']).at(2, [ok ? 'esc comes back' : '', 'f']));
    return ok ? 0 : 1;
  } });
  /* one link, printed, then a one-key prompt to open it */
  const linkCmd = (name, desc) => ({ g: 'read', desc, usage: name, run(argv, io){
    const t = OPEN.find(x => x.name === name);
    if (!io.tty){ io.write(t.url + '\n'); return; }
    const value = name === 'linkedin' ? 'in/' + t.short : name === 'gh' ? t.label : t.short;
    const o = out().blank().card({ title: t.title.toUpperCase(), items: [{ label: name === 'gh' ? 'repo' : 'profile', value, full: t.url, url: t.url, hint: 'open' }] }).blank();
    io.rich(o); return io.pick(o.lastCard);
  } });
  def('gh', linkCmd('gh', 'the source of this site, on GitHub'));
  def('linkedin', linkCmd('linkedin', 'LinkedIn'));
  def('x', linkCmd('x', 'X (Twitter)'));
  def('contact', { g: 'read', desc: 'email addresses', usage: 'contact', run(argv, io){
    if (!io.tty){ io.write(EMAILS.map(e => pad(e.label, 20) + e.email).join('\n') + '\n'); return; }
    const o = out().blank().card({ title: 'CONTACT', note: 'email', verb: 'copy', items: EMAILS.map(e => ({ label: e.label, value: e.email, copy: e.email, hint: 'copy' })) }).blank();
    io.rich(o); return io.pick(o.lastCard);
  } });
  def('welcome', { g: 'read', hidden: true, desc: 'the first screen', usage: 'welcome', run(argv, io){ if (io.tty) io.rich(welcome(out())); else io.write(C.name + '\n'); } });

  /* files */
  def('ls', { g: 'files', desc: 'list a directory', usage: 'ls [-l] [-a] [path...]', opts: [['-l', 'long form: type, size, date'], ['-a', 'include . and .. and hidden files']], ex: ['ls -la', 'ls ~/notes'], run(argv, io){
    const { o, a } = getopts(argv.slice(1));
    const targets = a.length ? a : ['.'];
    const files = [], dirs = [];
    for (const t of targets){ const s = FS.stat(t); if (!s){ io.err('ls: ' + t + ': No such file or directory\n'); hintPath('ls', t); io.exit(2); continue; } (s.dir ? dirs : files).push({ t, s }); }
    const show = ents => {
      if (!ents.length) return;
      if (o.l){
        const w = Math.max(...ents.map(e => human(e.size).length));
        for (const e of ents){
          io.write((e.dir ? 'drwxr-xr-x' : e.locked ? '-r--r--r--' : '-rw-r--r--') + (COLS >= 50 || !io.tty ? '  kaiav  ' : '  '), 'faint');
          io.write((e.dir ? '-' : human(e.size)).padStart(w) + '  ' + (COLS >= 50 || !io.tty ? fmtDate(e.mtime) : fmtDate(e.mtime).slice(0, 6)) + '  ', 'dim');
          io.write(e.name + (e.dir && e.name[0] !== '.' ? '/' : ''), e.dir ? 'bright' : 'normal');
          io.write(e.locked && io.tty ? ' ' + LOCK + '\n' : '\n', 'faint');
        }
        return;
      }
      if (!io.tty){ io.write(ents.map(e => e.name).join('\n') + '\n'); return; }
      const names = ents.map(e => e.name + (e.dir && e.name !== '.' && e.name !== '..' ? '/' : ''));
      const cw2 = Math.max(...names.map(n => n.length)) + 3, per = Math.max(1, Math.floor(COLS / cw2)), nr = Math.ceil(names.length / per);
      for (let r = 0; r < nr; r++){
        for (let c = 0; c < per; c++){ const k = c * nr + r; if (k >= names.length) break; io.write(pad(names[k], cw2), ents[k].dir ? 'bright' : 'normal'); }
        io.write('\n');
      }
    };
    show(files.map(f => Object.assign({}, f.s, { name: f.t })));
    dirs.forEach((d, k) => {
      if (targets.length > 1) io.write((k || files.length ? '\n' : '') + d.t + ':\n', 'dim');
      let ents = FS.list(d.s.path);
      if (o.a){ const st = FS.stat(d.s.path); ents = [Object.assign({}, st, { name: '.' }), Object.assign({}, FS.stat(d.s.path + '/..'), { name: '..' }), ...ents]; }
      else ents = ents.filter(e => e.name[0] !== '.');
      show(ents);
    });
  } });
  def('cd', { g: 'files', desc: 'change directory', usage: 'cd [dir | - | ~]', ex: ['cd notes', 'cd ..', 'cd -'], run(argv, io){
    let t = argv[1];
    if (!t || t === '~') t = HOME; else if (t === '-'){ t = ENV.OLDPWD || cwd; io.write(tildify(t) + '\n'); }
    const p = FS.resolve(t, cwd);
    if (!FS.exists(p)){ io.err('cd: no such directory: ' + argv[1] + '\n'); hintPath('cd', argv[1]); return 1; }
    if (!FS.isDir(p)){ io.err('cd: ' + argv[1] + ' is a file, not a folder\n'); if (job) job.hint = 'cat ' + argv[1]; return 1; }
    setCwd(p);
  } });
  def('pwd', { g: 'files', desc: 'print the working directory', usage: 'pwd', run(argv, io){ io.write(cwd + '\n'); } });
  def('cat', { g: 'files', desc: 'print files', usage: 'cat [-n] [file...]', opts: [['-n', 'number the lines']], ex: ['cat README.md', 'cat j.txt | grep founders'], run(argv, io){
    const { o, a } = getopts(argv.slice(1));
    if (a.length === 1 && io.tty && !o.n){ const n = FS.node(a[0]); if (n && n.g && n.doc && DOCS[n.doc]){ io.rich(DOCS[n.doc](out())); return; } }
    let k = 0;
    for (const s of sources(io, a, 'cat')){
      let t = s.text;
      if (o.n) t = linesOf(t).map(l => String(++k).padStart(6) + '  ' + l).join('\n') + (t ? '\n' : '');
      io.write(t && !t.endsWith('\n') ? t + '\n' : t);
    }
  } });
  def('mkdir', { g: 'files', desc: 'make directories', usage: 'mkdir [-p] dir...', opts: [['-p', 'make parents as needed; no error if it exists']], run(argv, io){
    const { o, a } = getopts(argv.slice(1));
    if (!a.length){ io.err('usage: mkdir [-p] dir...\n'); return 1; }
    for (const d of a){ if (o.p && FS.isDir(d)) continue; if (!FS.mkdir(d, !!o.p)){ io.err(fsErr('mkdir', d)); io.exit(1); } }
  } });
  def('touch', { g: 'files', desc: 'make an empty file, or update its time', usage: 'touch file...', run(argv, io){
    if (argv.length < 2){ io.err('usage: touch file...\n'); return 1; }
    for (const f of argv.slice(1)) if (!FS.touch(f)){ io.err(fsErr('touch', f)); io.exit(1); }
  } });
  def('rm', { g: 'files', desc: 'remove files', usage: 'rm [-r] [-f] path...', opts: [['-r', 'remove directories and what is in them'], ['-f', 'no complaint if missing']], run(argv, io){
    const { o, a } = getopts(argv.slice(1)); const r = o.r || o.R;
    if (!a.length){ io.err('usage: rm [-r] [-f] path...\n'); return 1; }
    for (const p of a){
      const abs = FS.resolve(p, cwd);
      if (abs === '/' || abs === HOME){ io.err('rm: refusing to remove ' + tildify(abs) + '\n'); io.exit(1); continue; }
      if (!FS.exists(p)){ if (!o.f){ io.err('rm: ' + p + ': No such file or directory\n'); io.exit(1); } continue; }
      if (FS.isDir(p) && !r){ io.err('rm: ' + p + ': is a directory (use rm -r)\n'); io.exit(1); continue; }
      if (!FS.rm(p, true)){ io.err(fsErr('rm', p)); io.exit(1); }
      else if (!FS.isDir(cwd)) setCwd(HOME);
    }
  } });
  def('mv', { g: 'files', desc: 'move or rename', usage: 'mv from... to', run(argv, io){
    const a = argv.slice(1).filter(x => x[0] !== '-');
    if (a.length < 2){ io.err('usage: mv from... to\n'); return 1; }
    const to = a.pop();
    if (a.length > 1 && !FS.isDir(to)){ io.err('mv: ' + to + ': not a directory\n'); return 1; }
    for (const f of a) if (!FS.mv(f, to)){ io.err(fsErr('mv', f)); io.exit(1); }
    if (!FS.isDir(cwd)) setCwd(HOME);
  } });
  def('cp', { g: 'files', desc: 'copy', usage: 'cp [-r] from... to', opts: [['-r', 'copy directories']], run(argv, io){
    const { o, a } = getopts(argv.slice(1));
    if (a.length < 2){ io.err('usage: cp [-r] from... to\n'); return 1; }
    const to = a.pop();
    if (a.length > 1 && !FS.isDir(to)){ io.err('cp: ' + to + ': not a directory\n'); return 1; }
    for (const f of a){
      if (FS.isDir(f) && !(o.r || o.R)){ io.err('cp: ' + f + ' is a directory (use cp -r)\n'); io.exit(1); continue; }
      if (!FS.cp(f, to)){ io.err(fsErr('cp', f)); io.exit(1); }
    }
  } });
  def('tree', { g: 'files', desc: 'draw a directory as a tree', usage: 'tree [-a] [dir]', run(argv, io){
    const { o, a } = getopts(argv.slice(1)); const top = a[0] || '.';
    if (!FS.isDir(top)){ io.err('tree: ' + top + ': not a directory\n'); return 1; }
    let nd = 0, nf = 0;
    io.write(top + '\n', 'bright');
    const walk = (p, prefix) => {
      const ents = (FS.list(p) || []).filter(e => o.a || e.name[0] !== '.');
      ents.forEach((e, k) => {
        const last = k === ents.length - 1;
        io.write(prefix + (last ? '`-- ' : '|-- '), 'faint');
        io.write(e.name + (e.dir ? '/' : '') + '\n', e.dir ? 'bright' : 'normal');
        if (e.dir){ nd++; walk((p === '/' ? '' : p) + '/' + e.name, prefix + (last ? '    ' : '|   ')); } else nf++;
      });
    };
    walk(FS.resolve(top, cwd), '');
    io.write('\n' + nd + (nd === 1 ? ' directory, ' : ' directories, ') + nf + (nf === 1 ? ' file' : ' files') + '\n', 'dim');
  } });

  /* text */
  def('echo', { g: 'text', desc: 'print its arguments', usage: 'echo [-n] [-e] text...', opts: [['-n', 'no newline at the end'], ['-e', 'understand \\n and \\t']], ex: ['echo $HOME', 'echo hi > /tmp/a'], run(argv, io){
    let a = argv.slice(1), nl = true, esc = false;
    while (a.length && /^-[ne]+$/.test(a[0])){ if (a[0].includes('n')) nl = false; if (a[0].includes('e')) esc = true; a = a.slice(1); }
    let s = a.join(' '); if (esc) s = s.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    io.write(s + (nl ? '\n' : ''));
  } });
  const headTail = tail => function (argv, io){
    const { o, a } = getopts(argv.slice(1), 'n'); const n = Math.max(0, parseInt(o.n || '10', 10) || 0);
    const src = sources(io, a, tail ? 'tail' : 'head');
    src.forEach((s, k) => {
      if (src.length > 1) io.write((k ? '\n' : '') + '==> ' + s.name + ' <==\n', 'dim');
      const ls = linesOf(s.text); const pick = tail ? ls.slice(Math.max(0, ls.length - n)) : ls.slice(0, n);
      if (pick.length) io.write(pick.join('\n') + '\n');
    });
  };
  def('head', { g: 'text', desc: 'the first lines', usage: 'head [-n N] [file...]', opts: [['-n N', 'how many lines (10)']], run: headTail(false) });
  def('tail', { g: 'text', desc: 'the last lines', usage: 'tail [-n N] [file...]', opts: [['-n N', 'how many lines (10)']], run: headTail(true) });
  def('wc', { g: 'text', desc: 'count lines, words and characters', usage: 'wc [-l] [-w] [-c] [file...]', run(argv, io){
    const { o, a } = getopts(argv.slice(1)); const all = !o.l && !o.w && !o.c;
    const tot = [0, 0, 0]; const src = sources(io, a, 'wc');
    const row = (v, name) => io.write([all || o.l ? v[0] : null, all || o.w ? v[1] : null, all || o.c ? v[2] : null].filter(x => x != null).map(x => String(x).padStart(7)).join(' ') + (name && a.length ? ' ' + name : '') + '\n');
    for (const s of src){ const v = [(s.text.match(/\n/g) || []).length, s.text.split(/\s+/).filter(Boolean).length, s.text.length]; v.forEach((x, i) => tot[i] += x); row(v, s.name); }
    if (src.length > 1) row(tot, 'total');
  } });
  def('grep', { g: 'text', desc: 'lines that match a pattern', usage: 'grep [-i] [-n] [-v] [-c] pattern [file...]',
    opts: [['-i', 'ignore case'], ['-n', 'show line numbers'], ['-v', 'lines that do not match'], ['-c', 'just count them']], ex: ['cat README.md | grep try', 'grep -in founder *.txt'], run(argv, io){
    const { o, a } = getopts(argv.slice(1));
    if (!a.length){ io.err('usage: grep [-i] [-n] [-v] [-c] pattern [file...]\n'); return 2; }
    let re; try { re = new RegExp(a[0], o.i ? 'gi' : 'g'); } catch (e){ re = new RegExp(escRe(a[0]), o.i ? 'gi' : 'g'); }
    const src = sources(io, a.slice(1), 'grep'), multi = src.length > 1; let hits = 0;
    for (const s of src){
      let count = 0;
      linesOf(s.text).forEach((ln, k) => {
        re.lastIndex = 0; const m = re.test(ln);
        if (m === !!o.v) return;
        count++; if (o.c) return;
        if (multi) io.write(s.name + ':', 'dim');
        if (o.n) io.write((k + 1) + ':', 'dim');
        if (!o.v && io.tty && a[0]){
          re.lastIndex = 0; let at = 0, mm;
          while ((mm = re.exec(ln))){ if (!mm[0]){ re.lastIndex++; continue; } io.write(ln.slice(at, mm.index)); io.write(mm[0], 'accent'); at = mm.index + mm[0].length; }
          io.write(ln.slice(at) + '\n');
        } else io.write(ln + '\n');
      });
      if (o.c) io.write((multi ? s.name + ':' : '') + count + '\n');
      hits += count;
    }
    if (!io.code) io.exit(hits ? 0 : 1);
  } });
  def('sort', { g: 'text', desc: 'sort lines', usage: 'sort [-r] [-n] [-u] [file...]', opts: [['-r', 'reverse'], ['-n', 'by number'], ['-u', 'drop repeats']], run(argv, io){
    const { o, a } = getopts(argv.slice(1));
    let ls = sources(io, a, 'sort').flatMap(s => linesOf(s.text));
    ls.sort(o.n ? (x, y) => (parseFloat(x) || 0) - (parseFloat(y) || 0) : (x, y) => x < y ? -1 : x > y ? 1 : 0);
    if (o.r) ls.reverse();
    if (o.u) ls = ls.filter((x, i) => i === 0 || x !== ls[i - 1]);
    if (ls.length) io.write(ls.join('\n') + '\n');
  } });

  /* system */
  def('date', { g: 'system', desc: 'now, in your time zone', usage: 'date', run(argv, io){
    const d = new Date();
    let tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e){}
    const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' });
    if (!io.tty){
      const two = n => String(n).padStart(2, '0'); const abbr = (time.match(/[A-Z]{2,5}[+-]?\d*$/) || [''])[0];
      io.write(DAYS[d.getDay()] + ' ' + MONTHS[d.getMonth()].slice(0, 3) + ' ' + String(d.getDate()).padStart(2) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds()) + (abbr ? ' ' + abbr : '') + ' ' + d.getFullYear() + '\n');
      return;
    }
    const day = d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const o = out(); o.blank().at(2, [day, 'b']).at(2, [time, 'n'], [tz && !time.includes(tz) && tz !== 'UTC' ? '   ' + tz.replace(/_/g, ' ') : '', 'd']).blank();
    io.rich(o);
  } });
  def('cal', { g: 'system', desc: 'a calendar for the month', usage: 'cal [month [year]]', ex: ['cal', 'cal 2 2027'], run(argv, io){
    const t = new Date(); let m = t.getMonth(), y = t.getFullYear();
    if (argv[1]){ const a = parseInt(argv[1], 10); if (!(a >= 1 && a <= 12)){ io.err('cal: month must be 1 to 12\n'); return 1; } m = a - 1; }
    if (argv[2]){ const b = parseInt(argv[2], 10); if (!(b >= 1 && b <= 9999)){ io.err('cal: year must be 1 to 9999\n'); return 1; } y = b; }
    const title = MONTHS[m] + ' ' + y;
    const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
    const weeks = []; let wk = new Array(first).fill(0);
    for (let d = 1; d <= days; d++){ wk.push(d); if (wk.length === 7){ weeks.push(wk); wk = []; } }
    if (wk.length) weeks.push(wk);
    if (!io.tty){
      io.write(' '.repeat(Math.floor((20 - title.length) / 2)) + title + '\nSu Mo Tu We Th Fr Sa\n' + weeks.map(w => w.map(d => d ? String(d).padStart(2) : '  ').join(' ').replace(/\s+$/, '')).join('\n') + '\n');
      return;
    }
    const isToday = d => d === t.getDate() && m === t.getMonth() && y === t.getFullYear();
    const o = out(); o.blank().at(2, [' '.repeat(Math.floor((26 - title.length) / 2)) + title, 'b']).blank();
    o.at(2, ...['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((n, i) => [(i ? '  ' : '') + n, i === 0 || i === 6 ? 'f' : 'd']));
    for (const w of weeks) o.at(2, ...w.flatMap((d, i) => [[i ? '  ' : '', 'n'], [d ? String(d).padStart(2) : '  ', isToday(d) ? 'i' : i === 0 || i === 6 ? 'd' : 'n']]));
    o.blank();
    if (!argv[1]) o.at(2, ['cal 2 2027', 'd'], [' another month', 'f']).blank();
    io.rich(o);
  } });
  def('uptime', { g: 'system', desc: 'time since you arrived', usage: 'uptime', run(argv, io){
    io.write('up ', 'dim'); io.write(uptimeStr(), 'bright'); io.write('  since you arrived, ', 'dim'); io.write(String(ran)); io.write(ran === 1 ? ' command\n' : ' commands\n', 'dim');
  } });
  def('whoami', { g: 'system', desc: 'your user name', usage: 'whoami', run(argv, io){ io.write(ENV.USER + '\n'); } });
  def('which', { g: 'system', desc: 'what a command is', usage: 'which name...', run(argv, io){
    let miss = 0;
    for (const n of argv.slice(1)){
      if (hasAlias(n)) io.write(n + ': aliased to ' + ALIASES[n] + '\n');
      else if (M.TERM.apps[n]) io.write('/usr/games/' + n + '\n');
      else if (SHELL_BUILTIN.includes(n) && M.TERM.cmds[n] === B[n]) io.write(n + ': shell built-in\n');
      else if (M.TERM.cmds[n]) io.write((M.TERM.cmds[n].g === 'read' ? '/usr/local/bin/' : '/bin/') + n + '\n');
      else { io.err(n + ' not found\n'); miss++; }
    }
    return miss ? 1 : 0;
  } });
  def('man', { g: 'system', desc: 'the manual page for a command', usage: 'man command', ex: ['man grep'], run(argv, io){
    const n = argv[1];
    if (!n){ io.err('what manual page do you want? try man grep\n'); return 1; }
    const name = hasAlias(n) && !M.TERM.cmds[n] && !M.TERM.apps[n] ? ALIASES[n].split(' ')[0] : n;
    const c = M.TERM.cmds[name] || M.TERM.apps[name];
    if (!c){ io.err('no manual entry for ' + n + '\n'); return 1; }
    const isApp = !!M.TERM.apps[name] && !M.TERM.cmds[name];
    const o = out(); const h = name.toUpperCase() + '(' + (isApp ? 6 : 1) + ')';
    o.at(0, [h, 'b'], [' '.repeat(Math.max(1, Math.floor((COLS - 12) / 2) - h.length)) + 'KN-84 manual', 'd'], [' '.repeat(Math.max(1, Math.ceil((COLS - 12) / 2) - h.length)) + h, 'b']).blank();
    o.at(0, ['NAME', 'b']).at(4, [name, 'n'], [' - ' + (c.desc || ''), 'n']).blank();
    o.at(0, ['SYNOPSIS', 'b']).at(4, [c.usage || name, 'n']).blank();
    if (c.more){ o.at(0, ['DESCRIPTION', 'b']); o.para(c.more, 'n', COLS - 6, 4); o.blank(); }
    if (c.opts && c.opts.length){ o.at(0, ['OPTIONS', 'b']); const w = Math.max(...c.opts.map(x => x[0].length)) + 3; for (const [f, d] of c.opts) o.at(4, [pad(f, w), 'b'], [d, 'n']); o.blank(); }
    if (c.ex && c.ex.length){ o.at(0, ['EXAMPLES', 'b']); for (const x of c.ex) o.at(4, [x, 'd']); o.blank(); }
    if (hasAlias(n) && n !== name) o.at(0, ['(' + n + ' is an alias for ' + ALIASES[n] + ')', 'f']).blank();
    if (io.tty) io.rich(o); else io.write(o.rows.map(textOf).join('\n') + '\n');
  } });
  /* help: a short, curated page by default (everything a visitor is likely to want, fitting one screen);
     help all lists every command, grouped by its g; help <cmd> is man */
  /* plain help is for someone who has never used a terminal: what you can do, in words, with commands to click */
  const HELP_TOP = [
    ['about Kaiav', 'who he is, what he builds', ['about', 'eden', 'j', 'writing', 'contact', 'links']],
    ['do something', 'small, useful tools', ['weather', 'todo', 'qr', 'pass', 'vault', 'timer']],
    ['play', 'a game for a minute', ['tetris', 'snake', 'typing', 'donut']],
    ['files', 'look around this computer', ['ls', 'cat', 'edit']],
  ];
  const HELP_ALL = [['read', 'kaiav'], ['net', 'net'], ['tools', 'tools'], ['fun', 'play'], ['files', 'files'], ['text', 'text'], ['system', 'system'], ['shell', 'shell'], ['misc', 'misc']];
  def('help', { g: 'system', desc: 'what you can type here', usage: 'help [all | command]', ex: ['help', 'help all', 'help weather'], run(argv, io){
    if (argv[1] && argv[1] !== 'all' && argv[1] !== '-a') return B.man.run(['man', argv[1]], io);
    const all = !!argv[1];
    const exists = n => (M.TERM.cmds[n] && !M.TERM.cmds[n].hidden && typeof M.TERM.cmds[n].run === 'function') || (M.TERM.apps[n] && typeof M.TERM.apps[n].start === 'function');
    if (!all){
      const groups = HELP_TOP.map(([label, what, names]) => [label, what, names.filter(exists)]).filter(x => x[2].length);
      if (!io.tty){ io.write(groups.map(([l, w, ns]) => l + ' (' + w + ')\n  ' + ns.join('  ')).join('\n') + '\n\nhelp all for everything. man <command> for details.\n'); return; }
      const o = out(); o.blank().head('help').blank()
        .line(['type a word and press enter, or ' + (TAP ? 'tap' : 'click') + ' one', 'd']).blank();
      for (const [label, what, names] of groups){
        o.line([label, 'b'], [COLS - 4 - label.length - what.length >= 2 ? '  ' + what : '', 'f']);
        o.flow(names.map(n => [chip(n, 'n')]), '  ', 4);
      }
      o.blank().flow([[chip('help all', 'n'), [' for everything', 'f']], [['man <command>', 'n'], [' for details', 'f']]], '  ·  ').blank();
      io.rich(o); return;
    }
    const by = {};
    const add = (n, c) => { const gk = c.g && HELP_ALL.some(x => x[0] === c.g) ? c.g : 'misc'; (by[gk] = by[gk] || []).push(n); };
    for (const [n, c] of Object.entries(M.TERM.cmds)) if (c && !c.hidden && typeof c.run === 'function') add(n, c);
    for (const [n, a] of Object.entries(M.TERM.apps)) if (a && typeof a.start === 'function' && !M.TERM.cmds[n]) add(n, Object.assign({ g: 'fun' }, a));
    const groups = HELP_ALL.filter(([k]) => by[k]).map(([k, label]) => [label, by[k]]);
    if (!io.tty){ io.write(groups.map(([l, ns]) => pad(l, 8) + ns.join(' ')).join('\n') + '\n'); return; }
    const LW = COLS >= 50 ? 9 : 8, room = COLS - 2 - LW;
    const o = out(); o.blank().head('every command').blank();
    for (const [label, names] of groups){
      let line = [], w = 0, first = true;
      const flush = () => { o.at(2, [pad(first ? label : '', LW), 'd'], ...line); line = []; w = 0; first = false; };
      for (const n of names){
        if (line.length && w + 2 + n.length > room) flush();
        if (line.length){ line.push(['  ', 'f']); w += 2; }
        line.push(chip(n, label === 'kaiav' ? 'b' : 'n')); w += n.length;
      }
      if (line.length) flush();
    }
    o.blank().flow([[['man <cmd>', 'n'], [' details', 'f']], [['tab', 'n'], [' completes', 'f']], [['ctrl+c', 'n'], [' stops', 'f']]], '   ').blank();
    io.rich(o);
  } });
  def('history', { g: 'shell', desc: 'commands you have run', usage: 'history [-c]', opts: [['-c', 'forget them']], ex: ['!!   run the last one again', '!3   run number 3'], run(argv, io){
    if (argv[1] === '-c'){ history = []; hIdx = 0; try { localStorage.setItem(HIST_KEY, '[]'); } catch (e){} return; }
    if (!history.length){ io.write('no history yet\n', 'dim'); return; }
    history.forEach((s, i) => { io.write(String(i + 1).padStart(5, ' ') + '  ', 'faint'); io.write(s + '\n'); });
  } });
  def('alias', { g: 'shell', desc: 'name a command line', usage: "alias [name='command']", ex: ["alias hi='echo hello'", 'alias'], run(argv, io){
    if (argv.length < 2){ for (const k of Object.keys(ALIASES).sort()) io.write('alias ' + k + "='" + ALIASES[k] + "'\n"); return; }
    for (const a of argv.slice(1)){
      const m = /^([^=\s]+)=(.*)$/s.exec(a);
      if (!m){ if (hasAlias(a)) io.write('alias ' + a + "='" + ALIASES[a] + "'\n"); else { io.err('alias: ' + a + ': not found\n'); io.exit(1); } continue; }
      ALIASES[m[1]] = m[2];
    }
    saveAliases();
  } });
  def('clear', { g: 'system', desc: 'clear the screen', usage: 'clear', run(argv, io){ if (io.tty) clearScreen(); } });
  def('neofetch', { g: 'system', desc: 'about this machine', usage: 'neofetch', run(argv, io){
    const info = fetchInfo();
    if (!io.tty){ io.write('kaiav@kn84\n' + info.map(([k, v]) => pad(k, 10) + v).join('\n') + '\n'); return; }
    const o = out(); o.blank().viz(13, drawFetch, age => age < 1.2 ? 30 : 4).blank(); io.rich(o);
    if (job) job.plain += info.map(([k, v]) => k + ' ' + v).join('. ') + ' ';
  } });

  /* misc */
  def('bc', { g: 'misc', desc: 'a calculator', usage: 'bc [expression]', opts: [], more: 'Arithmetic with + - * / % ^ and parentheses, plus sqrt, abs, floor, ceil, round and pi. Reads the expression from its arguments, or one per line from a pipe.', ex: ['bc 2^10', "echo '(1+2)*3' | bc"], run(argv, io){
    const src = argv.length > 1 ? [argv.slice(1).join(' ')] : linesOf(io.stdin || '');
    if (!src.length){ io.err('usage: bc expression   (try: bc 2^10)\n'); return 1; }
    for (const l of src){
      if (/^\s*(scale|quit)\b/.test(l)) continue;
      try { const v = calc(l); if (v != null) io.write(v + '\n'); } catch (e){ io.err('bc: ' + (e.message || 'syntax error') + '\n'); io.exit(1); }
    }
  } });
  let exits = 0;
  def('exit', { g: 'misc', desc: 'leave', usage: 'exit', run(argv, io){
    const lines = ["you can't leave. the coffee's still hot.", 'not yet. the lamp is warm and the coffee is still hot.', "logout refused: there's still coffee in the mug.", 'the door is the browser tab. the coffee is right here.'];
    io.write(lines[exits++ % lines.length] + '\n', 'dim');
  } });
  const SHELL_BUILTIN = ['cd', 'alias', 'history', 'exit', 'help', 'echo', 'pwd'];
  for (const [n, c] of Object.entries(B)) if (!M.TERM.cmds[n]) M.TERM.cmds[n] = c;
  const CONTENT_KW = { about: ['bio', 'kaiav', 'me'], eden: ['agents', 'context'], j: ['rising', 'rising founder', 'jose'], writing: ['blog', 'posts', 'essays'], links: ['linkedin', 'twitter', 'social', 'contact'] };
  /* everything you can type as a command, read fresh each time so late registrations count */
  function cmdItems(){
    const items = [];
    for (const [n, c] of Object.entries(M.TERM.cmds)) if (c && !c.hidden && typeof c.run === 'function') items.push({ name: n, kw: CONTENT_KW[n] });
    for (const [n, a] of Object.entries(M.TERM.apps)) if (a && typeof a.start === 'function' && !M.TERM.cmds[n]) items.push({ name: n });
    for (const n of Object.keys(ALIASES)) if (n.length > 1 && !M.TERM.cmds[n] && !M.TERM.apps[n]) items.push({ name: n });
    return items;
  }
  function fetchInfo(){
    const d = diskUse();
    return [['OS', 'KNOS 1.04'], ['Host', 'KN-84'], ['Kernel', '1.04 #1 1984'], ['Uptime', uptimeStr()], ['Shell', 'sh, ' + Object.keys(M.TERM.cmds).length + ' cmds'],
      ['Terminal', 'vt320 ' + COLS + 'x' + ROWS + ', VT323'], ['CPU', 'KN-1 @ 8 MHz'], ['Memory', '640K'], ['Disk', human(d.bytes) + ' in ' + d.files + ' files'], ['Display', 'P1 green phosphor']];
  }

  /* ---- expansion ---- */
  function expandVars(s){
    return s.replace(/\$(\?|\$|[A-Za-z_]\w*|\{[A-Za-z_]\w*\})/g, (m, n) => n === '?' ? String(status) : n === '$' ? '84' : (ENV[n.replace(/[{}]/g, '')] || ''));
  }
  function globMatch(pat){            // pat: literal * and ? from quotes arrive as \x01 \x02
    const abs = pat.startsWith('/');
    const parts = pat.split('/').filter((p, i) => p || i === 0);
    let set = [{ disp: abs ? '' : null, path: abs ? '/' : cwd }];
    parts.forEach((seg, k) => {
      if (abs && k === 0 && !seg) return;
      const next = [];
      const isGlob = /[*?]/.test(seg);
      for (const s of set){
        const join = n => ({ disp: s.disp == null ? n : s.disp + '/' + n, path: (s.path === '/' ? '' : s.path) + '/' + n });
        if (!isGlob){ const lit = seg.replace(/\x01/g, '*').replace(/\x02/g, '?'); const j = join(lit); if (seg === '.' || seg === '..' || FS.exists(j.path)) next.push(j); continue; }
        const re = new RegExp('^' + seg.split('').map(c => c === '*' ? '[^/]*' : c === '?' ? '[^/]' : escRe(c.replace('\x01', '*').replace('\x02', '?'))).join('') + '$');
        for (const e of FS.list(s.path) || []) if ((e.name[0] !== '.' || seg[0] === '.') && re.test(e.name)) next.push(join(e.name));
      }
      set = next;
    });
    return set.map(s => s.disp == null ? '.' : s.disp || '/').sort();
  }
  function expandWord(w){
    let s = '', gs = '', glob = false;
    w.parts.forEach((p, k) => {
      let v = p.s;
      if (p.q === 'u' && k === 0 && (v === '~' || v.startsWith('~/'))) v = HOME + v.slice(1);
      if (p.q !== 's') v = expandVars(v);
      s += v;
      if (p.q === 'u' && /[*?]/.test(v)){ glob = true; gs += v; } else gs += v.replace(/\*/g, '\x01').replace(/\?/g, '\x02');
    });
    if (!glob) return [s];
    const m = globMatch(gs);
    return m.length ? m : [s];
  }
  /* aliases: substitute at each command position, once per name */
  function applyAliases(toks){
    const r = []; let start = true;
    for (let k = 0; k < toks.length; k++){
      const t = toks[k];
      if (start && plainWord(t) && hasAlias(wordText(t))){
        const seen = new Set([wordText(t)]);
        let sub = lex(ALIASES[wordText(t)]);
        for (let d = 0; d < 8 && sub.length && plainWord(sub[0]) && hasAlias(wordText(sub[0])) && !seen.has(wordText(sub[0])); d++){ seen.add(wordText(sub[0])); sub = lex(ALIASES[wordText(sub[0])]).concat(sub.slice(1)); }
        r.push(...sub); start = false; continue;
      }
      r.push(t);
      start = t.t === 'op' && !REDIR.includes(t.v);
      if (t.t === 'op' && REDIR.includes(t.v)) { r.push(toks[++k]); start = false; }
    }
    return r;
  }
  /* !! and !N */
  function bang(line){
    if (!line.includes('!')) return line;
    let bad = null;
    const r = line.replace(/!!|!(\d+)|!([A-Za-z][\w.-]*)/g, (m, n, pfx) => {
      let v;
      if (m === '!!') v = history[history.length - 1];
      else if (n) v = history[+n - 1];
      else for (let i = history.length - 1; i >= 0; i--) if (history[i].startsWith(pfx)){ v = history[i]; break; }
      if (v == null){ bad = bad || m; return m; }
      return v;
    });
    if (bad) throw new SyntaxError(bad + ': event not found');
    return r;
  }

  /* ---- jobs ---- */
  const INTR = { interrupted: true };
  function newJob(){
    const j = { dead: false, plain: '', hint: '', timers: new Set(), t0: now };
    j.killed = new Promise(r => { j.kill = r; });
    j.sleep = ms => new Promise((res, rej) => {
      if (j.dead) return rej(INTR);
      const t = setTimeout(() => { j.timers.delete(t); j.dead ? rej(INTR) : res(); }, Math.max(0, +ms || 0));
      j.timers.add(t);
    });
    return j;
  }
  async function runLine(raw, noHist){
    job = newJob(); links = []; sel = -1;
    const j = job;
    let list;
    try {
      const line = bang(raw);
      if (line !== raw) tty.write(line + '\n', 'dim');
      record(line, noHist);
      list = parse(applyAliases(lex(line)));
    } catch (e){
      record(raw, noHist);
      errLine(tty, 'sh: ' + (e.message || e) + '\n'); status = 2; finishJob(j); return;
    }
    const work = execList(list, j);
    work.catch(() => {});
    try { await Promise.race([work, j.killed]); }
    catch (e){ if (e !== INTR){ errLine(tty, 'sh: ' + ((e && e.message) || e) + '\n'); status = 1; } }
    finishJob(j);
  }
  function record(line, noHist){
    line = line.trim(); if (!line) return;
    if (!noHist && history[history.length - 1] !== line){ history.push(line); if (history.length > 200) history.shift(); try { localStorage.setItem(HIST_KEY, JSON.stringify(history)); } catch (e){} }
    hIdx = history.length; ran++;
  }
  function flushAhead(){                 // the type-ahead lands on the prompt; a queued Enter runs it next frame
    const a = ahead; ahead = ''; const nl = a.indexOf('\n');
    insert(nl < 0 ? a : a.slice(0, nl));
    if (nl >= 0){ ahead = a.slice(nl + 1); runQueued = true; }
  }
  function finishJob(j){
    if (job !== j) return;
    for (const t of j.timers) clearTimeout(t);
    job = null; openRow = null;
    if (status === 0 && !j.dead) okRuns++;
    if (j.hint){ suggestion = j.hint; tty.rich(out().at(0, ['did you mean ', 'd'], chip(j.hint, 'b'), ['?  press enter', 'f'])); j.plain += ' Did you mean ' + j.hint + '?'; }
    if (ahead) flushAhead();
    trim(); mirror(j.plain || ''); toBottom(); dirty = true; touched();
    if (REDUCED) revealAll();
  }
  async function execList(list, j){
    for (const { conn, pipe } of list){
      if (j.dead) return;
      if (conn === '&&' && status !== 0) continue;
      if (conn === '||' && status === 0) continue;
      status = await runPipe(pipe, j);
      openRow = null;
    }
  }
  async function runPipe(pipe, j){
    let stdin = '', st = 0;
    for (let i = 0; i < pipe.length; i++){
      if (j.dead) return 130;
      const c = pipe[i], last = i === pipe.length - 1;
      let w = 0;
      while (w < c.words.length && c.words[w].parts[0].q === 'u' && /^[A-Za-z_]\w*=/.test(c.words[w].parts[0].s)){
        const v = expandWord(c.words[w])[0]; const at = v.indexOf('='); ENV[v.slice(0, at)] = v.slice(at + 1); w++;
      }
      const argv = []; for (const x of c.words.slice(w)) argv.push(...expandWord(x));
      let outF = null, errF = null, inText = null, bad = false;
      for (const r of c.redirs){
        const t = expandWord(r.w);
        if (t.length !== 1 || !t[0]){ errLine(tty, 'sh: ambiguous redirect\n'); bad = true; break; }
        if (r.op === '<'){ inText = FS.read(t[0]); if (inText == null){ errLine(tty, 'sh: ' + t[0] + ': No such file or directory\n'); bad = true; break; } }
        else if (r.op[0] === '2') errF = { path: t[0], append: r.op === '2>>', sink: buffer() };
        else outF = { path: t[0], append: r.op === '>>', sink: buffer() };
      }
      if (bad){ st = 1; stdin = ''; continue; }
      const isNull = f => f && FS.resolve(f.path, cwd) === '/dev/null';
      const sink = outF ? (isNull(outF) ? NULLSINK : outF.sink) : last ? tty : buffer();
      const errSink = errF ? (isNull(errF) ? NULLSINK : errF.sink) : tty;
      st = argv.length ? await runCmd(argv, { stdin: inText != null ? inText : stdin, sink, errSink }, j) : 0;
      if (j.dead) return 130;
      for (const f of [outF, errF]){
        if (!f || isNull(f)) continue;
        const ok = f.append ? FS.append(f.path, f.sink.text) : FS.write(f.path, f.sink.text);
        if (!ok){ errLine(tty, fsErr('sh', f.path)); st = 1; }
      }
      stdin = sink === tty || sink === NULLSINK || outF ? '' : sink.text;
    }
    return st;
  }
  async function runCmd(argv, ctx, j){
    const lc = String(argv[0]).toLowerCase();                       // LS works like ls
    if (lc !== argv[0] && !M.TERM.apps[argv[0]] && !M.TERM.cmds[argv[0]] && (M.TERM.apps[lc] || M.TERM.cmds[lc])) argv[0] = lc;
    const name = argv[0];
    const appDef = M.TERM.apps[name], cmd = M.TERM.cmds[name];
    if (appDef && typeof appDef.start === 'function') return launchApp(name, argv, ctx, j);
    if (cmd && typeof cmd.run === 'function'){
      const io = makeIo(ctx, j);
      try {
        const r = await cmd.run(argv, io);
        if (j.dead) return 130;
        return io.code != null ? io.code : typeof r === 'number' ? r : 0;
      } catch (e){
        if (e === INTR || j.dead) return 130;
        errLine(ctx.errSink, name + ': ' + ((e && e.message) || e) + '\n');
        return 1;
      }
    }
    sfx('error');
    errLine(ctx.errSink, name + ': command not found\n');
    const f = fuzzy(name, cmdItems());
    if (f){ j.hint = [f.item.name, ...argv.slice(1)].join(' '); }
    else if (ctx.errSink === tty) tty.rich(out().at(0, ['this shell knows commands, not sentences. try ', 'f'], chip('help', 'n')));
    return 127;
  }
  function makeIo(ctx, j){
    const io = {
      stdin: ctx.stdin, fs: FS, ui: out, env: ENV, cwd, cols: COLS, rows: ROWS, tty: ctx.sink.tty, code: null,
      out(t, style){ if (!j.dead && t != null) ctx.sink.write(String(t), style); },
      write(t, style){ io.out(t, style); },
      err(t){ if (!j.dead && t != null) errLine(ctx.errSink, t); },
      rich(o){ if (!j.dead) ctx.sink.rich(o); },
      exit(c){ io.code = (c | 0); },
      sleep: ms => j.sleep(ms),
      /* one-key inline prompt: items [{ label, short?, url }]; resolves with the item opened, or null */
      choose(items, title){
        if (!ctx.sink.tty || j.dead || !items || !items.length) return Promise.resolve(null);
        const o = out().card({ title: String(title || 'OPEN').toUpperCase(), items: items.map(it => ({ label: it.short || it.name || 'link', value: it.label || it.url, full: it.url, url: it.url, copy: it.copy, hint: it.copy ? 'copy' : 'open' })) });
        ctx.sink.rich(o);
        return io.pick(o.lastCard);
      },
      /* wait for one key on a card already printed; resolves with the item acted on, or null */
      pick(card){
        if (!ctx.sink.tty || j.dead || !card || !card.acts.length) return Promise.resolve(null);
        return new Promise(res => {
          card.sel = 0; setFoot(card);
          j.choice = { card, res };
          const a = card.acts;
          mirror(a.length > 1 ? 'Press 1 to ' + a.length + ', or Enter, to ' + card.verb + ': ' + a.map((it, i) => (i + 1) + ', ' + it.label + ' ' + (it.full || it.value)).join('; ') + '. Escape goes back.'
            : 'Press Enter to ' + (a[0].copy ? 'copy ' : 'open ') + (a[0].full || a[0].value) + '. Any other key goes back.');
          dirty = true;
        });
      },
      /* ask for a line (opts.secret: drawn as dots, never echoed or mirrored) or, with opts.keys, one key.
         Resolves with the text / the key (lowercased), or null on esc. A one-key ask passes other
         printable keys on to the next prompt, so nothing typed is lost. */
      ask(prompt, opts){
        opts = opts || {};
        if (!ctx.sink.tty || j.dead) return Promise.resolve(null);
        return new Promise(res => {
          openRow = null;
          j.ask = { spans: Array.isArray(prompt) ? prompt : [[String(prompt), 'd']], secret: !!opts.secret, one: Array.isArray(opts.keys), keys: opts.keys || [], buf: '', res, i: opts.i != null ? opts.i : 2 };
          if (!opts.secret) mirror(j.ask.spans.map(x => x[0]).join(''));
          blinkT0 = now; dirty = true;
        });
      },
      redraw(){ dirty = true; },
      runApp(name, argv){
        const a = Array.isArray(argv) ? (argv[0] === name ? argv : [name, ...argv]) : [name];
        if (!M.TERM.apps[name]) return Promise.resolve(127);
        return launchApp(name, a, ctx, j);
      },
    };
    return io;
  }
  function setFoot(card){
    const n = card.acts.length, dot = [' \u00b7 ', 'f'];
    const verb = card.verb === 'read' || card.acts.every(a => a.post) ? 'read' : card.acts.every(a => a.copy) ? 'copy' : card.acts.every(a => !a.copy) ? 'open' : 'open/copy';
    const len = f => f.reduce((a, x) => a + x[0].length, 0);
    const opts = n > 1 ? [
      [['  ', 'n', null, 'arrows'], [' select', 'f'], dot, ['enter', 'n'], [' ' + verb, 'f'], dot, ['1-' + n, 'n'], [' jump', 'f'], dot, ['esc', 'n'], [' back', 'f']],
      [['  ', 'n', null, 'arrows'], [' select', 'f'], dot, ['enter', 'n'], [' ' + verb, 'f'], dot, ['esc', 'n'], [' back', 'f']],
      [['  ', 'n', null, 'arrows'], dot, ['enter', 'n'], [' ' + verb, 'f'], dot, ['esc', 'n']],
    ] : [
      [['enter', 'n'], [' ' + verb, 'f'], dot, ['any other key', 'n'], [' back', 'f']],
      [['enter', 'n'], [' ' + verb, 'f'], dot, ['esc', 'n'], [' back', 'f']],
    ];
    card.foot = opts.find(f => len(f) <= COLS - 3) || opts[opts.length - 1];
  }
  /* copy or open one card row; synchronous, so it must run inside the key or tap that asked */
  function actOn(card, it){
    card.sel = it.ai; card.done = true; card.flash = now;
    let said;
    if (it.post){
      const ok = !!(M.reader && M.reader.open(it.post));
      card.foot = ok ? [['  ', 'b', null, 'out'], ['reading ', 'd'], [it.value, 'b']] : [['read ' + it.post, 'b'], ['  (the reader did not open)', 'f']];
      said = ok ? 'Opened ' + it.value + ' in the reader. Escape comes back.' : 'The reader is not available.';
    } else if (it.copy){
      const ok = copyText(it.copy); sfx('beep');
      const what = it.secret ? it.label : it.copy;            // a secret (a vault password) is never drawn or read out
      card.foot = ok ? [['  ', 'b', null, 'check'], ['copied ', 'd'], [what, 'b']] : it.secret ? [['could not reach the clipboard', 'd']] : [['select and copy: ', 'd'], [it.copy, 'b']];
      said = (ok ? 'Copied ' : 'Could not copy ') + what + '.';
    } else {
      const ok = openTarget(it.url);
      let shown = it.full ? bare(it.full) : it.value;
      if (shown.length + 12 > COLS) shown = it.value.length + 12 <= COLS ? it.value : it.label;
      card.foot = [['  ', 'b', null, 'out'], ['opening ', 'd'], [shown, 'b']].concat(ok || COLS < 50 ? [] : [['  blocked? try open ' + bare(it.url), 'f']]);
      said = 'Opening ' + (it.full || it.value) + '.';
    }
    if (job) job.plain += said + ' '; else mirror(said);
    dirty = true;
  }
  /* a tap on the canvas (x, y as 0..1 fractions): a card row acts as if chosen with enter */
  function handleTap(fx, fy){
    if (booting) return false;
    if (app){                                   // an app with tap(col, row) gets the grid cell (the editor's shortcut bar, cursor placement)
      const st = app;
      if (!st.inst || typeof st.inst.tap !== 'function') return false;
      const col = clamp(Math.floor((fx * W - PADX) / cw), 0, COLS - 1), row = clamp(Math.floor((fy * H - PADY) / ch), 0, ROWS - 1);
      const r = appCall('tap', col, row);
      if (r && app === st) st.dirty = true;
      return !!r;
    }
    const px = fx * W, py = fy * H;
    if (px < X(1) || px > X(COLS - 1)) return false;
    for (const r of drawnCards){
      for (const it of r.items){
        if (it.ai < 0) continue;
        const rt = r._top + ch * (it.y + 1);
        if (py < rt || py >= rt + ch * it.n) continue;
        if (job && job.choice && job.choice.card === r){ const ch2 = job.choice; job.choice = null; actOn(r, it); ch2.res(it); }
        else actOn(r, it);
        touched();
        return true;
      }
    }
    /* a command chip types and runs its command; an inline link opens. A finger gets a little slack. */
    const slack = cw * 0.6;
    for (const h of drawnHits){
      if (px < h.x0 - slack || px > h.x1 + slack || py < h.top - 4 || py >= h.bot + 4) continue;
      if (h.link.cmd){
        if (app || (job && !job.choice)) return false;
        if (job && job.choice){ const c2 = job.choice; job.choice = null; c2.card.sel = -1; c2.card.foot = [['back', 'f']]; c2.res(null); }
        revealAll(); const line = h.link.cmd;
        if (job) ahead = line + '\n'; else { input = ''; cur = 0; execute(line); }
        sfx('beep'); touched(); return true;
      }
      const w = openTarget(h.link.url); const o = out(); o.at(0, ['opening ', 'd'], [bare(h.link.url), 'n']); if (!w) o.at(0, ['if nothing opened, the address is above', 'f']);
      if (!job) emit(o); touched(); return true;
    }
    return false;
  }
  /* a key while io.ask is waiting */
  function askKey(e){
    const a = job.ask, k = e.key, ctl = e.ctrlKey && !e.altKey;
    if (ctl && k.toLowerCase() === 'c'){ endAsk(null); interrupt(); return true; }
    if (a.one){
      if (k.length > 1 && !['Enter', 'Escape', 'Backspace', 'Tab'].includes(k)) return true;
      const kk = k.length === 1 ? k.toLowerCase() : k, hit = a.keys.includes(kk);
      endAsk(hit ? kk : k === 'Escape' ? null : kk);
      if (!hit && k.length === 1 && k !== ' ' && !e.ctrlKey && !e.altKey) ahead += k;
      return true;
    }
    if (k === 'Enter'){ endAsk(a.buf); return true; }
    if (k === 'Escape'){ endAsk(null); return true; }
    if (k === 'Backspace' || (ctl && k.toLowerCase() === 'u')){ a.buf = k === 'Backspace' && !e.ctrlKey && !e.altKey ? a.buf.slice(0, -1) : ''; }
    else if (k.length === 1 && !e.ctrlKey && !e.altKey && a.buf.length < 256 && k >= ' ') a.buf += k;
    blinkT0 = now; blinkOn = true; dirty = true;
    return true;
  }
  function endAsk(v){
    const a = job.ask; job.ask = null;
    if (!a.one){
      const echo = a.secret ? '\u2022'.repeat(Math.min(a.buf.length, 16)) : a.buf;
      rows.push({ k: 't', i: a.i, s: [...a.spans, [echo, a.secret ? 'd' : 'n']].concat(v == null ? [['  esc', 'f']] : []) }); shown = rows.length; partial = 0;
    }
    a.buf = ''; dirty = true; toBottom();
    a.res(v);
  }
  /* a key while a choice is waiting; returns true when consumed */
  function choiceKey(e){
    const ch = job.choice, card = ch.card, k = e.key, n = card.acts.length;
    if (e.ctrlKey && k.toLowerCase() === 'c'){ card.sel = -1; card.foot = [['^C', 'd']]; interrupt(); return true; }
    if (n > 1 && (k === 'ArrowDown' || k === 'ArrowRight' || (k === 'Tab' && !e.shiftKey) || k === 'j')){ card.sel = (card.sel + 1) % n; dirty = true; return true; }
    if (n > 1 && (k === 'ArrowUp' || k === 'ArrowLeft' || (k === 'Tab' && e.shiftKey) || k === 'k')){ card.sel = (card.sel + n - 1) % n; dirty = true; return true; }
    let pick = -1;
    if (k === 'Enter' || k === 'o' || k === 'O' || (k === 'c' && card.acts[card.sel].copy)) pick = card.sel;
    else if (/^[1-9]$/.test(k) && +k <= n) pick = +k - 1;
    job.choice = null;
    let it = null;
    if (pick >= 0){ it = card.acts[pick]; actOn(card, it); }
    else { card.sel = -1; card.foot = [['back', 'f']]; if (k.length === 1 && !e.ctrlKey && !e.altKey && k !== ' ') ahead += k; }
    dirty = true;
    ch.res(it);
    return true;
  }
  function interrupt(){
    if (!job) return;
    const j = job;
    if (app) closeApp(app, 130);
    j.dead = true;
    openRow = null;
    rows.push({ k: 't', i: 0, s: [['^C', 'd']] });
    status = 130;
    for (const t of j.timers) clearTimeout(t);
    j.kill();
    dirty = true;
  }

  /* ---- full-screen apps: they own the grid until they exit ---- */
  const LEVEL = { normal: P.normal, dim: P.dim, bright: P.bright, faint: P.faint, accent: P.accent, inverse: P.normal, n: P.normal, d: P.dim, b: P.bright, f: P.faint, a: P.accent };
  const styleCache = new Map();
  function cellStyle(st){
    let key;
    if (st && typeof st === 'object') key = 'o:' + (st.fg || 'normal') + ':' + (st.inverse ? 1 : 0);
    else key = 's:' + (st || 'normal');
    let r = styleCache.get(key);
    if (!r){
      if (st && typeof st === 'object') r = { fg: LEVEL[st.fg] || (typeof st.fg === 'string' && /^(#|rgb|hsl)/.test(st.fg) ? st.fg : P.normal), inv: !!st.inverse };
      else r = { fg: LEVEL[st] || P.normal, inv: st === 'inverse' };
      styleCache.set(key, r);
    }
    return r;
  }
  const BLANK = cellStyle('normal');
  const grid = []; for (let y = 0; y < ROWS; y++){ grid.push(new Array(COLS)); }
  let gridCursor = null;
  const scr = {
    cols: COLS, rows: ROWS,
    clear(){ for (const r of grid) for (let x = 0; x < COLS; x++) r[x] = [' ', BLANK]; },
    put(x, y, text, style){
      x = Math.floor(x); y = Math.floor(y); const x0 = x; const s = cellStyle(style);
      for (const c of String(text == null ? '' : text)){
        if (c === '\n'){ y++; x = x0; continue; }
        if (y >= 0 && y < ROWS && x >= 0 && x < COLS) grid[y][x] = [c, s];
        x++;
      }
    },
    fill(x, y, w, h, c, style){
      const s = cellStyle(style); c = (String(c == null ? ' ' : c) || ' ')[0];
      for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(ROWS, Math.floor(y + h)); yy++)
        for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(COLS, Math.floor(x + w)); xx++) grid[yy][xx] = [c, s];
    },
    cursor(x, y, shape){ gridCursor = shape === null || shape === false || x == null ? null : { x: Math.floor(x), y: Math.floor(y), shape: shape || 'block' }; },
  };
  scr.clear();
  function launchApp(name, argv, ctx, j){
    const def = M.TERM.apps[name];
    return new Promise(resolve => {
      const st = { name, ctx, printed: [], resolve, inst: null, dirty: true, done: false };
      const api = {
        cols: COLS, rows: ROWS, fs: FS, env: ENV, cwd, sound: M.sound,
        exit(code){ closeApp(st, code | 0); },
        print(t){ if (t != null) st.printed.push(String(t)); },
      };
      sfx('disk');
      if (app) closeApp(app, 1);
      app = st; scr.clear(); gridCursor = null; openRow = null;
      try { const inst = def.start(api, argv); if (!st.done) st.inst = inst || {}; }
      catch (e){ closeApp(st, 1, e); }
      if (!st.done) mirror('Running ' + name + (def.desc ? ', ' + def.desc : '') + '. Full screen.');
      dirty = true;
    });
  }
  function closeApp(st, code, e){
    if (st.done) return;
    st.done = true;
    if (app === st) app = null;
    gridCursor = null;
    const text = st.printed.map(t => t.endsWith('\n') ? t : t + '\n').join('');
    if (text) st.ctx.sink.write(text);
    if (e) errLine(st.ctx.errSink, st.name + ': ' + ((e && e.message) || e) + '\n');
    if (job && text) job.plain += text;
    if (e && typeof console !== 'undefined') console.warn(e);
    toBottom(); dirty = true;
    st.resolve(e ? 1 : code | 0);
  }
  function appCall(fn, ...a){
    const st = app; if (!st || !st.inst || typeof st.inst[fn] !== 'function') return undefined;
    try { return st.inst[fn](...a); } catch (e){ closeApp(st, 1, e); return undefined; }
  }

  /* ---- the line itself ---- */
  function promptSpans(){
    let p = tildify(cwd); if (p.length > 28) p = '...' + p.slice(-25);
    return [['kaiav', 'd'], [':', 'f'], [p, 'n'], [' $ ', 'd']];
  }
  const promptLen = () => promptSpans().reduce((n, s) => n + s[0].length, 0);
  /* forgiveness for people new to shells: a copied "$ " prompt, cd.., and a few plain-English questions */
  const PHRASES = [
    [/^(hi|hello|hey|hiya|yo|sup|howdy|hola|good (morning|afternoon|evening)|gm)( there)?$/, 'hello'],
    [/^(who are you|who is (this|kaiav|he)|who'?s kaiav|about (you|me|kaiav)|tell me about (yourself|kaiav)|bio)$/, 'about'],
    [/^(what is this|what'?s this|what is this place|what can i do|what do i do|how does this work|how do i use this|commands|menu|start|instructions|h)$/, 'help'],
    [/^(contact( me)?|email|e-?mail me|get in touch|reach out|hire|hire (you|me|kaiav)|say hi)$/, 'contact'],
    [/^(games?|play|play a game|fun)$/, 'games'],
    [/^(socials?|linkedin|twitter)$/, 'links'],
    [/^(blog|posts|essays|articles)$/, 'writing'],
  ];
  function forgive(line){
    let l = line.replace(/^\s*[$%#>]\s+/, '');                 // pasted with its prompt
    if (/^\s*kaiav:\S*\s*\$\s+/.test(l)) l = l.replace(/^\s*kaiav:\S*\s*\$\s+/, '');
    l = l.replace(/^(\s*)cd(\.\.|~|\/)(?=\s|$|\/)/, '$1cd $2');     // cd.. and cd~
    const q = l.trim().toLowerCase().replace(/[?!.,]+$/, '').replace(/\s+/g, ' ');
    if (!q || /[|;&<>$`'"]/.test(q)) return l;
    const w = q.split(' ')[0];
    if (M.TERM.cmds[w] || M.TERM.apps[w] || hasAlias(w)) return l;   // a real command wins
    for (const [re, cmd] of PHRASES) if (re.test(q) && (M.TERM.cmds[cmd] || M.TERM.apps[cmd])) return cmd;
    return l;
  }
  function execute(raw, programmatic){
    rows.push({ k: 't', i: 0, s: [...promptSpans(), [raw, 'n']] }); shown = rows.length; partial = 0;
    openRow = null;
    input = ''; cur = 0; suggestion = ''; tabState = null; sel = -1;
    hIdx = history.length; hDraft = '';
    if (!raw.trim()){ toBottom(); dirty = true; return; }
    runLine(forgive(raw), programmatic);
  }

  /* ---- completion and typeahead ---- */
  function context(){
    const before = input.slice(0, cur);
    let i = before.length; while (i > 0 && !/[\s|;&<>]/.test(before[i - 1])) i--;
    const word = before.slice(i);
    const pre = before.slice(0, i).trimEnd();
    const cmdPos = !pre || /(\|\||&&|[|;&])$/.test(pre);
    if (cmdPos && !word.includes('/')) return { kind: 'cmd', q: word, from: i, items: cmdItems() };
    const segStart = Math.max(pre.lastIndexOf('|'), pre.lastIndexOf(';'), pre.lastIndexOf('&'));
    const cname = pre.slice(segStart + 1).trim().split(/\s+/)[0] || '';
    if (/^(man|which|help)$/.test(cname)) return { kind: 'arg', q: word, from: i, items: cmdItems() };
    if (cname === 'read' || /^open\s+post$/.test(pre.slice(segStart + 1).trim())) return { kind: 'arg', q: word, from: i, items: POSTITEMS };
    if (cname === 'open') return { kind: 'arg', q: word, from: i, items: OPEN };
    const cdef = M.TERM.cmds[cname];                                   // a command can complete its own arguments
    if (cdef && typeof cdef.complete === 'function' && !word.includes('/')){
      let l = null; try { l = cdef.complete(pre.slice(segStart + 1).trim().split(/\s+/).slice(1), word); } catch (e){}
      if (Array.isArray(l) && l.length) return { kind: 'arg', q: word, from: i, items: l.map(n => ({ name: String(n) })), all: true };
    }
    if (word.startsWith('$')) return { kind: 'path', q: word.slice(1), from: i + 1, items: Object.keys(ENV).map(k => ({ name: k })) };
    const slash = word.lastIndexOf('/');
    const dirPart = word.slice(0, slash + 1), q = word.slice(slash + 1);
    const ents = FS.list(dirPart ? (dirPart === '/' ? '/' : dirPart.replace(/\/$/, '')) : '.');
    if (!ents) return { kind: 'path', q, from: i + slash + 1, items: [] };
    return { kind: 'path', q, from: i + slash + 1, items: ents.filter(e => (q[0] === '.' || e.name[0] !== '.') && (cname !== 'cd' || e.dir)).map(e => ({ name: e.name + (e.dir ? '/' : '') })) };
  }
  function candidates(ctx){
    if (!ctx) return [];
    if (ctx.kind === 'path'){
      let l = ctx.items.filter(it => it.name.startsWith(ctx.q));
      if (!l.length) l = ctx.items.filter(it => it.name.toLowerCase().startsWith(ctx.q.toLowerCase()));
      return l.map(it => it.name);
    }
    if (!ctx.q) return ctx.kind === 'arg' && (ctx.all || ctx.items === OPEN || ctx.items === POSTITEMS) ? ctx.items.map(i => i.name) : [];
    const scored = [];
    for (const it of ctx.items){
      let s = fscore(ctx.q, it.name);
      for (const a of it.alias || []) s = Math.max(s, fscore(ctx.q, a) - 5);
      for (const k of it.kw || []) s = Math.max(s, fscore(ctx.q, k) * 0.8);
      if (s >= 150) scored.push([s, it.name]);
    }
    scored.sort((a, b) => b[0] - a[0] || a[1].length - b[1].length);
    return [...new Set(scored.map(x => x[1]))];
  }
  function ghost(){
    if (!input && suggestion) return { text: suggestion, full: suggestion, kind: 'prefix', from: 0 };
    if (cur !== input.length || !input) return null;
    const ctx = context(); const list = candidates(ctx);
    if (!list.length) return null;
    if (ctx.kind === 'path' && !ctx.q) return null;
    const best = list[0];
    if (best.toLowerCase() === ctx.q.toLowerCase()) return null;
    if (best.startsWith(ctx.q)) return { text: best.slice(ctx.q.length), full: best, kind: 'prefix', from: ctx.from };
    if (ctx.kind === 'path') return null;
    return { text: best, full: best, kind: 'fuzzy', from: ctx.from };
  }
  function accept(word, from, space){
    const tail = input.slice(cur);
    const add = space && !word.endsWith('/') ? ' ' : '';
    input = input.slice(0, from) + word + add + tail.replace(/^\S*/, ''); cur = from + word.length + add.length;
  }
  function commonPrefix(list){ let p = list[0] || ''; for (const s of list) while (!s.startsWith(p)) p = p.slice(0, -1); return p; }
  function tab(back){
    if (!input){
      if (suggestion){ input = suggestion; cur = input.length; suggestion = ''; return; }
      if (links.length){ sel = back ? (sel <= 0 ? links.length - 1 : sel - 1) : (sel + 1) % links.length; return; }
      const names = cmdItems().map(c => c.name).filter(n => n.length > 1).sort();
      rows.push({ k: 't', i: 0, s: [...promptSpans()] });
      for (const l of wrap(names.join('  '), COLS)) rows.push({ k: 't', i: 0, s: [[l, 'n']] });
      shown = rows.length; mirror('Commands: ' + names.join(', '));
      return;
    }
    if (tabState && tabState.after === input && tabState.cyc){          // third tab on: walk the list
      const s = tabState; s.i = (s.i + (back ? -1 : 1) + s.list.length) % s.list.length;
      input = s.base; cur = s.cur; accept(s.list[s.i], s.from, false); s.after = input; return;
    }
    if (tabState && tabState.after === input && !tabState.cyc){        // second tab: show them all, pick the first
      const s = tabState; s.cyc = true; s.i = back ? s.list.length - 1 : 0;
      accept(s.list[s.i], s.from, false); s.after = input;
      mirror(s.list.length + ' matches: ' + s.list.slice(0, 40).join(', ')); return;
    }
    const ctx = context(); let list = candidates(ctx);
    if (!list.length){ sfx('beep'); return; }
    if (list.some(x => x.startsWith(ctx.q))) list = list.filter(x => x.startsWith(ctx.q));
    if (list.length === 1){ accept(list[0], ctx.from, true); tabState = null; return; }
    if (!list[0].startsWith(ctx.q)){                                    // a typo: take the best guess, as the ghost offered
      const base = input, bcur = cur; accept(list[0], ctx.from, false);
      tabState = { base, cur: bcur, list, i: 0, from: ctx.from, after: input, cyc: true }; return;
    }
    const cp = commonPrefix(list.filter(x => x.startsWith(ctx.q)));
    if (cp.length > ctx.q.length) accept(cp, ctx.from, false); else sfx('beep');
    tabState = { base: input, cur, list, i: -1, from: ctx.from, after: input, cyc: false };
  }

  /* ---- editing ---- */
  const isWord = c => /[\w.:/-]/.test(c);
  function wordLeft(p){ while (p > 0 && !isWord(input[p - 1])) p--; while (p > 0 && isWord(input[p - 1])) p--; return p; }
  function wordRight(p){ while (p < input.length && !isWord(input[p])) p++; while (p < input.length && isWord(input[p])) p++; return p; }
  function insert(s){
    s = s.replace(/[\r\n\t]+/g, ' ').replace(/[^\x20-\x7e\u00a0-\uffff]|[\ud800-\udfff\u0300-\u036f\u200b-\u200f\ufe00-\ufe0f]/g, '');   // one cell per char: no emoji, combining marks or zero-width
    if (!s) return;
    if (input.length + s.length > 240) s = s.slice(0, 240 - input.length);
    input = input.slice(0, cur) + s + input.slice(cur); cur += s.length;
    suggestion = ''; tabState = null; sel = -1;
  }
  function touched(){ blinkT0 = now; blinkOn = true; toBottom(); dirty = true; }
  function histMove(d){
    if (hIdx === history.length && d < 0){ hDraft = input; hPrefix = input; }
    let i = hIdx;
    do { i += d; } while (i >= 0 && i < history.length && hPrefix && !history[i].startsWith(hPrefix));
    if (i < 0) return;
    if (i >= history.length){ hIdx = history.length; input = hDraft; cur = input.length; return; }
    hIdx = i; input = history[i]; cur = input.length;
  }
  function scrollBy(units){
    const max = Math.max(0, totalUnits() - ROWS);
    const next = clamp(scrollOff + units, 0, max);
    if (next !== scrollOff){ scrollOff = next; dirty = true; }
  }
  function clearScreen(){ rows = []; shown = 0; partial = 0; links = []; sel = -1; openRow = null; toBottom(); dirty = true; }

  /* ---- ctrl+r: search the history, newest first ---- */
  function searchFrom(i, q){
    if (!q) return -1;
    const lq = q.toLowerCase();
    for (let k = Math.min(i, history.length - 1); k >= 0; k--) if (history[k].toLowerCase().includes(lq)) return k;
    return -1;
  }
  function searchSet(i){
    const s = rs; s.fail = i < 0;
    if (i >= 0){ s.i = i; input = history[i]; cur = Math.max(0, input.toLowerCase().indexOf(s.q.toLowerCase())); }
    else if (!s.q){ s.i = history.length; input = s.draft; cur = s.dcur; }
  }
  function searchKey(e){
    const k = e.key, c = k.toLowerCase(), s = rs;
    const done = keep => { rs = null; if (!keep){ input = s.draft; cur = s.dcur; } else cur = input.length; hIdx = history.length; touched(); return true; };
    if (e.ctrlKey && c === 'r'){ if (s.q){ const i = searchFrom(s.i - 1, s.q); if (i >= 0) searchSet(i); else { s.fail = true; sfx('beep'); } } touched(); return true; }
    if (e.ctrlKey && (c === 'g' || c === 'c')) return done(false);
    if (k === 'Escape') return done(false);
    if (k === 'Enter'){ const keep = !s.fail && s.q && s.i < history.length; rs = null; if (keep){ execute(input); touched(); return true; } return done(false); }
    if (k === 'Backspace'){ s.q = s.q.slice(0, -1); searchSet(searchFrom(history.length - 1, s.q)); touched(); return true; }
    if (k.length === 1 && !e.ctrlKey && !e.altKey){ s.q += k; const i = searchFrom(s.i, s.q); if (i >= 0) searchSet(i); else { s.fail = true; } touched(); return true; }
    if (/^(Arrow|Home|End|Tab)/.test(k) || (e.ctrlKey && (c === 'a' || c === 'e'))){   // take the match and keep editing
      rs = null; if (s.fail && !s.q){ input = s.draft; } hIdx = history.length;
      cur = k === 'Home' || (e.ctrlKey && c === 'a') ? 0 : input.length; touched(); return true;
    }
    return true;
  }
  function handleKey(e){
    const k = e.key;
    if (!k || k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta' || k === 'CapsLock' || k === 'Dead') return false;
    if (e.metaKey) return false;
    if (/^F\d+$/.test(k)) return false;
    if (booting){ skipBoot(); return true; }
    const ctrl = e.ctrlKey, alt = e.altKey, c = k.toLowerCase();
    if (app){                                   // apps get keys first
      const st = app;
      const used = appCall('key', e);
      if (used){ if (app === st) st.dirty = true; return true; }
      if (ctrl && c === 'c' && app === st) interrupt();
      return true;
    }
    if (job && job.ask){ if (typing()) revealAll(); return askKey(e); }
    if (job && job.choice){ if (typing()) revealAll(); return choiceKey(e); }
    if (typing()){ revealAll(); if (!input && (k === 'Enter' || k === 'Escape' || k === ' ')) return true; }   // a key skips the typing-out; a typed line still runs
    if (job){                                   // a command is running: only ctrl+c, ctrl+l and scrolling
      if (ctrl && c === 'c'){ interrupt(); return true; }
      if (ctrl && c === 'l'){ clearScreen(); return true; }
      if (k === 'PageUp'){ scrollBy(ROWS - 2); return true; }
      if (k === 'PageDown'){ scrollBy(-(ROWS - 2)); return true; }
      if (k.length === 1 && !ctrl && !alt){ if (ahead.length < 400) ahead += k; return true; }     // typed ahead: lands on the next prompt
      if (k === 'Enter' && !alt){ if (ahead.length < 400) ahead += '\n'; return true; }            // ...and Enter queues it, like a real tty
      if (k === 'Backspace'){ ahead = ahead.slice(0, -1); return true; }
      return ['Enter', 'Tab', 'Escape'].includes(k);
    }
    if (rs) return searchKey(e);
    if (ctrl && !alt && c === 'r'){ rs = { q: '', i: history.length, draft: input, dcur: cur, fail: false }; tabState = null; suggestion = ''; touched(); return true; }
    if (alt && !ctrl && (c === 'b' || c === 'f' || k === '\u222b' || k === '\u0192')){ cur = c === 'b' || k === '\u222b' ? wordLeft(cur) : wordRight(cur); touched(); return true; }
    if (ctrl && !alt){
      if (c === 'l'){ clearScreen(); touched(); return true; }
      if (c === 'c'){
        rows.push({ k: 't', i: 0, s: [...promptSpans(), [input, 'n'], ['^C', 'd']] }); shown = rows.length; partial = 0;
        input = ''; cur = 0; suggestion = ''; sel = -1; hIdx = history.length; status = 130; touched(); return true;
      }
      if (c === 'a'){ cur = 0; touched(); return true; }
      if (c === 'e'){ cur = input.length; touched(); return true; }
      if (c === 'u'){ input = input.slice(cur); cur = 0; touched(); return true; }
      if (c === 'k'){ input = input.slice(0, cur); touched(); return true; }
      if (c === 'w' || k === 'Backspace'){ const p = wordLeft(cur); input = input.slice(0, p) + input.slice(cur); cur = p; touched(); return true; }
      if (k === 'Delete'){ const p = wordRight(cur); input = input.slice(0, cur) + input.slice(p); touched(); return true; }
      if (k === 'ArrowLeft'){ cur = wordLeft(cur); touched(); return true; }
      if (k === 'ArrowRight'){ cur = wordRight(cur); touched(); return true; }
      if (k === 'Home'){ scrollBy(1e6); return true; }
      if (k === 'End'){ toBottom(); dirty = true; return true; }
      return false;
    }
    switch (k){
      case 'Enter': {
        if (sel >= 0 && !input && links[sel]){
          const url = links[sel].url; const w = openUrl(url);
          const o = out(); o.at(0, ['opening ', 'd'], [url, 'n']); if (!w) o.at(0, ['if nothing opened, the address is above', 'f']);
          rows.push({ k: 't', i: 0, s: [...promptSpans()] }); shown = rows.length; emit(o); touched(); return true;
        }
        if (!input && suggestion){ const s = suggestion; execute(s); touched(); return true; }
        execute(input); touched(); return true;
      }
      case 'Backspace':
        if (alt){ const p = wordLeft(cur); input = input.slice(0, p) + input.slice(cur); cur = p; }
        else if (cur > 0){ input = input.slice(0, cur - 1) + input.slice(cur); cur--; }
        suggestion = ''; tabState = null; touched(); return true;
      case 'Delete':
        if (alt){ const p = wordRight(cur); input = input.slice(0, cur) + input.slice(p); }
        else input = input.slice(0, cur) + input.slice(cur + 1);
        tabState = null; touched(); return true;
      case 'ArrowLeft': cur = alt ? wordLeft(cur) : Math.max(0, cur - 1); touched(); return true;
      case 'ArrowRight': {
        if (cur === input.length){ const gh = ghost(); if (gh && gh.kind === 'prefix'){ if (!input && suggestion){ input = suggestion; cur = input.length; } else accept(gh.full, gh.from, false); suggestion = ''; } }
        else cur = alt ? wordRight(cur) : cur + 1;
        touched(); return true;
      }
      case 'Home': cur = 0; touched(); return true;
      case 'End': cur = input.length; touched(); return true;
      case 'ArrowUp': if (e.shiftKey){ scrollBy(1); return true; } histMove(-1); suggestion = ''; touched(); return true;
      case 'ArrowDown': if (e.shiftKey){ scrollBy(-1); return true; } histMove(1); suggestion = ''; touched(); return true;
      case 'PageUp': scrollBy(ROWS - 2); return true;
      case 'PageDown': scrollBy(-(ROWS - 2)); return true;
      case 'Tab': tab(e.shiftKey); touched(); return true;
      case 'Escape': sel = -1; suggestion = ''; tabState = null; touched(); return true;
    }
    if (k.length === 1 && !ctrl){ insert(k); touched(); return true; }
    return false;
  }
  /* key releases: only full-screen apps care (app.keyUp, optional) */
  function handleKeyUp(e){
    if (!app || !app.inst || typeof app.inst.keyUp !== 'function') return false;
    const st = app;
    if (appCall('keyUp', e) && app === st) st.dirty = true;
    return true;
  }
  function insertText(str){
    if (booting){ skipBoot(); }
    if (app){                                   /* phones and IME: an app takes the text whole (app.insertText), or as key events */
      const st = app;
      if (st.inst && typeof st.inst.insertText === 'function'){ if (appCall('insertText', String(str)) !== false && app === st) st.dirty = true; return; }
      for (const ch of String(str)){
        const cur = app; if (!cur) break;
        const key = ch === '\n' || ch === '\r' ? 'Enter' : ch === '\t' ? 'Tab' : ch === '\b' ? 'Backspace' : ch;
        const code = key.length > 1 ? key : /[a-z]/i.test(ch) ? 'Key' + ch.toUpperCase() : /\d/.test(ch) ? 'Digit' + ch : ch === ' ' ? 'Space' : '';
        const ev = { type: 'keydown', key, code, repeat: false, isComposing: false, ctrlKey: false, altKey: false, metaKey: false, shiftKey: /[A-Z]/.test(ch), synthetic: true, preventDefault(){}, stopPropagation(){} };
        if (appCall('key', ev) && app === cur) cur.dirty = true;
      }
      return;
    }
    if (job && job.ask){ for (const ch of String(str)){ if (!job || !job.ask) break; askKey({ key: ch === '\n' || ch === '\r' ? 'Enter' : ch, ctrlKey: false, altKey: false }); } return; }
    if (job && job.choice){                     // phones: a tapped key answers the card
      for (const ch of String(str)){ if (!job || !job.choice) break; choiceKey({ key: ch === '\n' ? 'Enter' : ch, ctrlKey: false, altKey: false, shiftKey: false }); }
      return;
    }
    if (job){ ahead = (ahead + String(str).replace(/\r\n?/g, '\n').replace(/\t/g, ' ')).slice(0, 4000); return; }
    if (rs){ for (const ch of String(str)) searchKey({ key: ch === '\n' ? 'Enter' : ch, ctrlKey: false, altKey: false }); return; }
    if (typing()) revealAll();
    const parts = String(str).replace(/\t/g, ' ').split(/\r\n?|\n/);
    insert(parts[0]);
    if (parts.length > 1){ execute(input); ahead = parts.slice(1).join('\n').slice(0, 4000); if (!job) flushAhead(); }   // a pasted script: one line at a time
    touched();
  }
  function run(cmd){
    cmd = String(cmd || '').trim(); if (!cmd) return;
    if (booting) skipBoot();
    if (app || job) return;
    revealAll();
    execute(cmd, true); touched();
  }
  function scroll(delta){
    if (booting || app) return;
    wheelAcc += -delta / 40;                       // ~40px of wheel per line; positive delta scrolls down
    const n = wheelAcc > 0 ? Math.floor(wheelAcc) : Math.ceil(wheelAcc);
    if (n){ wheelAcc -= n; scrollBy(n); }
  }

  /* ---- boot ---- */
  function skipBoot(){ if (!booting) return; booting = false; endBoot(); }
  function endBoot(){
    booting = false; rows = []; shown = 0; partial = 0;
    emit(welcome(out()), (C.name || '') + '. ' + (A.role || '') + '. Type help to begin.');
    blinkT0 = now; dirty = true;
  }

  /* ---- drawing primitives ---- */
  const color = st => st === 'f' ? P.faint : st === 'd' ? P.dim : st === 'b' ? P.bright : st === 'a' ? P.accent : st === 'z' ? P.bg : P.normal;
  /* a card: vector rules in the phosphor (VT323 has no box glyphs), cells on the text grid */
  function drawCard(r, top){
    const n = r.body, active = r.sel >= 0 && !r.done;
    const x0 = X(1) + cw * 0.5, x1 = X(COLS - 1) - cw * 0.5;
    const yT = top + ch * 0.48, yB = top + ch * (n + 1.48);
    g.fillStyle = active ? P.dim : P.faint;
    const tA = X(2.5), tB = X(3 + r.title.length) + cw * 0.5;
    const nA = r.note ? X(COLS - 3 - r.note.length) - cw * 0.5 : x1, nB = r.note ? X(COLS - 3) + cw * 0.5 : x1;
    g.fillRect(x0, yT, tA - x0, 2); g.fillRect(tB, yT, nA - tB, 2); if (r.note) g.fillRect(nB, yT, x1 - nB + 2, 2);
    g.fillRect(x0, yT, 2, yB - yT); g.fillRect(x1, yT, 2, yB - yT + 2); g.fillRect(x0, yB, x1 - x0 + 2, 2);
    text(r.title, 3, top, 'b');
    if (r.note) text(r.note, COLS - 3 - r.note.length, top, 'f');
    r.items.forEach(it => {
      const rt = top + ch * (it.y + 1);
      const flashing = r.done && it.ai === r.sel && r.flash != null && now - r.flash < 0.35;
      const on = (active && it.ai === r.sel) || flashing, chosen = r.done && it.ai === r.sel;
      if (flashing){ g.fillStyle = P.bright; g.fillRect(X(2), rt + 3, X(COLS - 2) - X(2), ch * it.n - 6); }
      if (on && !flashing){ g.fillStyle = P.normal; g.fillRect(X(2), rt + 3, X(COLS - 2) - X(2), ch * it.n - 6); }
      const st = s => on ? 'z' : s;
      if (it.ai >= 0) text(String(it.ai + 1), 3, rt, st(chosen ? 'b' : 'f'));
      text(it.label, 5, rt, st('d'));
      if (r.stacked) it.lines.forEach((l, k) => text(l, 5, rt + ch * (k + 1), st(it.sub0 != null && k >= it.sub0 ? 'd' : it.ai >= 0 ? 'b' : 'n')));
      else text(it.value, 5 + r.lw, rt, st(it.ai >= 0 ? 'b' : 'n'));
      if (it.hint) text(it.hint, COLS - 3 - it.hint.length, rt, st('f'));
    });
    if (r.foot){
      const ft = top + ch * (n + 2), mark = r.foot[0][3], cx = X(2), cy = ft + ch * 0.5, a = cw * 0.38;
      drawSpans({ i: 2, s: r.foot }, ft, 1e9);
      g.fillStyle = P.normal; g.strokeStyle = P.bright; g.lineWidth = 3;
      if (mark === 'arrows'){                            // up and down, drawn: VT323 has no arrow glyphs
        const up = (x, d) => { g.beginPath(); g.moveTo(x, cy - d * a * 1.1); g.lineTo(x - a, cy + d * a * 0.3); g.lineTo(x + a, cy + d * a * 0.3); g.closePath(); g.fill(); g.fillRect(x - 1.5, d > 0 ? cy : cy - a * 1.1, 3, a * 1.1); };
        up(cx + cw * 0.5, 1); up(cx + cw * 1.5, -1);
      } else if (mark === 'check'){
        g.beginPath(); g.moveTo(cx + cw * 0.15, cy); g.lineTo(cx + cw * 0.5, cy + a); g.lineTo(cx + cw * 1.2, cy - a * 1.1); g.stroke();
      } else if (mark === 'out'){
        g.beginPath(); g.moveTo(cx + cw * 0.2, cy + a); g.lineTo(cx + cw * 1.1, cy - a); g.moveTo(cx + cw * 0.45, cy - a); g.lineTo(cx + cw * 1.1, cy - a); g.lineTo(cx + cw * 1.1, cy - a * 0.1); g.stroke();
      }
    }
  }
  const X = col => PADX + col * cw;
  let promptY = 0;   // bottom of the prompt line, canvas px (phones keep it above the on-screen keyboard)
  function text(s, col, top, st, k = 1){
    g.font = font(k); g.fillStyle = color(st);
    if (k === 1 && SPAN_VEC.test(s)){ const c0 = color(st); g.fillText(s.replace(SPAN_VEC_G, ' '), X(col), top + fs * 0.68); for (let q = 0; q < s.length; q++) if (SPAN_VEC.test(s[q])) vecGlyph(s[q], col + q, top, c0); return; }
    g.fillText(s, X(col), top + fs * k * 0.68);
  }
  function drawSpans(r, top, limit, k = 1){
    let col = r.i || 0, left = limit;
    for (const sp of r.s){
      if (left <= 0) break;
      let s = sp[0]; if (s.length > left) s = s.slice(0, left); left -= s.length;
      const link = sp[2];
      const selected = (link && sel >= 0 && links[sel] === link) || sp[1] === 'i';
      if (selected){ g.fillStyle = P.normal; g.fillRect(X(col) - 3, top + 1, s.length * cw * k + 6, ch * k - 2); }
      g.font = font(k); g.fillStyle = selected ? P.bg : color(sp[1]);
      if (k === 1 && SPAN_VEC.test(s)){                // arrows and the lock, drawn: VT323 has neither
        g.fillText(s.replace(SPAN_VEC_G, ' '), X(col), top + fs * 0.68);
        for (let q = 0; q < s.length; q++) if (SPAN_VEC.test(s[q])) vecGlyph(s[q], col + q, top, selected ? P.bg : color(sp[1]));
      } else g.fillText(s, X(col), top + fs * k * 0.68);
      if (link && !selected){ g.fillStyle = link.cmd ? P.faint : P.dim; g.fillRect(X(col), top + fs * k * 0.76, s.length * cw * k, 2); }
      if (link && (link.cmd || link.url) && s.trim()) drawnHits.push({ x0: X(col), x1: X(col + s.length * k), top, bot: top + ch * k, link });
      col += s.length * k;
    }
  }
  function drawHead(r, top, frac){
    const label = r.label.toUpperCase().split('').join(' ');
    const n = Math.ceil(label.length * Math.min(1, frac * 2));
    text(label.slice(0, n), r.i, top, 'd');
    if (frac <= 0.5) return;
    const x0 = X(r.i + label.length + 2), x1 = X(COLS - (r.note ? r.note.length + 2 : 0));
    const mid = top + ch * 0.48;
    g.fillStyle = P.faint; g.fillRect(x0, mid, (x1 - x0) * ease((frac - 0.5) * 2), 2);
    if (r.note && frac >= 1) text(r.note, COLS - r.note.length, top, 'f');
  }
  function totalUnits(){
    let u = 0; for (let i = 0; i < rows.length && i <= shown; i++) if (i < shown || partial > 0 || rows[i].k === 'viz') u += i < rows.length ? heightOf(rows[i]) : 0;
    return u + (promptVisible() ? 1 + belowPrompt().length : job && job.ask && !app && !typing() ? 1 : 0);
  }
  /* quiet rows under the prompt: the ctrl+r search line, or the tab candidates */
  function fitSpans(opts){ const len = f => f.reduce((n, x) => n + x[0].length, 0); return opts.find(f => len(f) <= COLS) || opts[opts.length - 1]; }
  function belowPrompt(){
    if (rs){
      const q = rs.q, st = rs.fail ? 'a' : 'b';
      return [fitSpans([
        [['search ', 'f'], [q, st], [rs.fail ? '  no match' : '', 'f'], ['   ctrl+r older \u00b7 enter run \u00b7 esc', 'f']],
        [['search ', 'f'], [q, st], [rs.fail ? '  no match' : '', 'f'], ['   ^R older \u00b7 esc', 'f']],
        [['search ', 'f'], [q, st]],
      ])];
    }
    const t = tabState;
    if (!t || !t.cyc || t.list.length < 2 || t.after !== input){
      if (!fresh || okRuns >= 2 || sel >= 0) return [];            // first visit: a quiet nudge until a command or two has worked
      if (input) return [[['press ', 'f'], ['enter', 'd'], [' to run it', 'f']]];
      return [[['try ', 'f'], chip('about', 'd'), ['  or  ', 'f'], chip('help', 'd'), [COLS >= 46 ? '   type it, then press enter' : '', 'f']]];
    }
    const w = Math.min(COLS - 2, Math.max(...t.list.map(x => x.length)) + 2), nc = Math.max(1, Math.floor(COLS / w));
    const lines = Math.ceil(t.list.length / nc), maxL = Math.min(5, Math.max(2, ROWS - 6));
    const selL = Math.floor(Math.max(0, t.i) / nc), from = lines <= maxL ? 0 : clamp(selL - maxL + 1, 0, lines - maxL);
    const out = [];
    for (let l = from; l < Math.min(lines, from + maxL); l++){
      const row = [];
      for (let c = 0; c < nc; c++){
        const k = l * nc + c; if (k >= t.list.length) break;
        const name = t.list[k].slice(0, w - 1);
        row.push([name, k === t.i ? 'i' : 'd'], [' '.repeat(w - name.length), 'n']);
      }
      out.push(row);
    }
    const more = t.list.length - Math.min(lines, from + maxL) * nc;
    if (lines > maxL) out.push([[(t.i + 1) + ' of ' + t.list.length + (more > 0 ? '  tab for more' : ''), 'f']]);
    return out;
  }
  const promptVisible = () => !booting && !typing() && !job && !app;

  function drawAsk(top){                 // io.ask's line: the question, what is typed (dots when secret), a cursor
    const a = job.ask, room = Math.max(4, COLS - a.i - a.spans.reduce((n, x) => n + x[0].length, 0) - 1);
    let b = a.secret ? '\u2022'.repeat(a.buf.length) : a.buf; if (b.length > room) b = b.slice(-room);
    const sp = [...a.spans, [b, a.secret ? 'd' : 'n']];
    drawSpans({ i: a.i, s: sp }, top, 999);
    promptY = top + ch;
    if (!a.one && blinkOn){ const col = a.i + sp.reduce((n, x) => n + x[0].length, 0); if (col < COLS){ g.fillStyle = P.normal; g.fillRect(X(col), top + 3, cw, ch - 6); } }
  }
  function drawPrompt(top){
    const gh = rs ? null : ghost();
    const PL = promptLen();
    let off = 0; const room = COLS - PL - 1;
    if (cur > room) off = cur - room;
    const vis = input.slice(off, off + room);
    let body = [[vis, 'n']];
    if (rs && rs.q && !rs.fail){                     // the match, brighter
      const at = input.toLowerCase().indexOf(rs.q.toLowerCase()) - off;
      if (at >= 0 && at < vis.length) body = [[vis.slice(0, at), 'd'], [vis.slice(at, at + rs.q.length), 'b'], [vis.slice(at + rs.q.length), 'd']];
    }
    drawSpans({ i: 0, s: [...promptSpans(), ...body] }, top, 999);
    promptY = top + ch;
    const cx = X(PL + cur - off);
    if (gh){
      const gcol = PL + input.length - off;
      if (gh.kind === 'prefix') text(gh.text.slice(0, Math.max(0, COLS - gcol)), gcol, top, 'f');
      else if (gcol + 8 + gh.text.length <= COLS){   // fuzzy: an arrow and the target, set apart
        const ax = X(gcol + 1), ay = top + ch * 0.48;
        g.fillStyle = P.faint; g.fillRect(ax, ay - 1, cw * 1.4, 2);
        g.beginPath(); g.moveTo(ax + cw * 1.6, ay); g.lineTo(ax + cw * 1.0, ay - 6); g.lineTo(ax + cw * 1.0, ay + 6); g.closePath(); g.fill();
        text(gh.text, gcol + 3, top, 'f');
        text('tab', gcol + 4 + gh.text.length, top, 'f');
        g.strokeStyle = P.faint; g.lineWidth = 1.5; g.strokeRect(X(gcol + 4 + gh.text.length) - 4, top + 6, cw * 3 + 8, ch - 12);
      }
    }
    if (blinkOn && sel < 0){
      g.fillStyle = P.normal; g.fillRect(cx, top + 3, cw, ch - 6);
      const under = input[cur] || (gh && gh.kind === 'prefix' ? gh.text[0] : '');
      if (under){ g.font = font(); g.fillStyle = P.bg; g.fillText(under, cx, top + fs * 0.68); }
    }
  }
  let drawnCards = [], drawnHits = [];   // what is on screen and can be clicked or tapped
  const VEC_RE = /[\u2190\u2191\u2192\u2193\u00b7\u2022\ue000]/g;
  const SPAN_VEC = /[\u2190-\u2193\u2022\ue000]/, SPAN_VEC_G = /[\u2190-\u2193\u2022\ue000]/g;
  function vecGlyph(c, col, top, colr){
    const cx = X(col) + cw / 2, cy = top + ch * 0.5, a = cw * 0.36;
    g.fillStyle = colr;
    if (c === '\u00b7'){ g.fillRect(cx - 2, cy - 2, 4, 4); return; }
    if (c === '\u2022'){ g.beginPath(); g.arc(cx, cy + 1, cw * 0.19, 0, 6.2832); g.fill(); return; }   // a masked character
    if (c === LOCK){                                       // a small padlock: shackle and body
      const bw = cw * 0.72, bh = ch * 0.3, bx = cx - bw / 2, by = cy - bh * 0.2;
      g.fillRect(bx, by, bw, bh);
      g.strokeStyle = colr; g.lineWidth = 2.5; g.beginPath();
      g.moveTo(cx - bw * 0.3, by); g.lineTo(cx - bw * 0.3, by - bh * 0.45); g.arc(cx, by - bh * 0.45, bw * 0.3, Math.PI, 0); g.lineTo(cx + bw * 0.3, by); g.stroke();
      g.fillStyle = P.bg; g.fillRect(cx - 1.5, by + bh * 0.3, 3, bh * 0.4);
      return;
    }
    const d = { '\u2190': [-1, 0], '\u2192': [1, 0], '\u2191': [0, -1], '\u2193': [0, 1] }[c];
    const [dx, dy] = d, px = -dy, py = dx;                 // tip direction and its perpendicular
    g.beginPath();
    g.moveTo(cx + dx * a * 1.2, cy + dy * a * 1.2);
    g.lineTo(cx + px * a * 0.8, cy + py * a * 0.8);
    g.lineTo(cx - px * a * 0.8, cy - py * a * 0.8);
    g.closePath(); g.fill();
    g.lineWidth = 3; g.strokeStyle = colr; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx - dx * a * 1.2, cy - dy * a * 1.2); g.stroke();
  }
  function drawGrid(){
    g.font = font();
    for (let y = 0; y < ROWS; y++){
      const top = PADY + y * ch, r = grid[y];
      let x = 0;
      while (x < COLS){
        const s = r[x][1]; let x1 = x, str = '';
        while (x1 < COLS && r[x1][1] === s){ str += r[x1][0]; x1++; }
        const plain = str.replace(VEC_RE, ' ');
        if (s.inv){ g.fillStyle = s.fg; g.fillRect(X(x), top, (x1 - x) * cw + 0.5, ch); if (plain.trim()){ g.fillStyle = P.bg; g.fillText(plain, X(x), top + fs * 0.68); } }
        else if (plain.trim()){ g.fillStyle = s.fg; g.fillText(plain, X(x), top + fs * 0.68); }
        if (plain !== str) for (let k = 0; k < str.length; k++) if (VEC_RE.test(str[k])){ VEC_RE.lastIndex = 0; vecGlyph(str[k], x + k, top, s.inv ? P.bg : s.fg); }
        VEC_RE.lastIndex = 0;
        x = x1;
      }
    }
    const c = gridCursor;
    if (c && blinkOn && c.x >= 0 && c.x < COLS && c.y >= 0 && c.y < ROWS){
      const top = PADY + c.y * ch, cell = grid[c.y][c.x];
      g.fillStyle = P.normal;
      if (c.shape === 'bar') g.fillRect(X(c.x), top + 3, 3, ch - 6);
      else if (c.shape === 'under') g.fillRect(X(c.x), top + ch - 7, cw, 3);
      else { g.fillRect(X(c.x), top + 3, cw, ch - 6); g.fillStyle = P.bg; g.fillText(cell[0], X(c.x), top + fs * 0.68); }
    }
  }

  function draw(){
    g.fillStyle = P.bg; g.fillRect(0, 0, W, H);
    g.textBaseline = 'alphabetic';
    animFps = 0;
    if (booting){ drawBoot(); return; }
    drawnCards = []; drawnHits.length = 0;
    if (app){ drawGrid(); return; }
    // lay out units bottom-anchored
    const total = totalUnits();
    scrollOff = clamp(scrollOff, 0, Math.max(0, total - ROWS));
    const first = Math.max(0, total - ROWS - scrollOff);
    g.save(); g.beginPath(); g.rect(0, PADY - 4, W, ROWS * ch + 8); g.clip();
    let u = 0;
    const last = Math.min(rows.length - 1, shown);
    for (let i = 0; i <= last; i++){
      const r = rows[i]; const h = heightOf(r);
      const isPartial = i === shown;
      if (isPartial && partial <= 0 && r.k !== 'viz' && r.k !== 'card') break;
      if (u + h > first && u < first + ROWS){
        const top = PADY + (u - first) * ch;
        const lim = isPartial ? Math.floor(partial) : 1e9;
        if (r.k === 't') drawSpans(r, top, lim);
        else if (r.k === 'big') drawSpans(r, top, isPartial ? Math.floor(partial / 2) : 1e9, 2);
        else if (r.k === 'head') drawHead(r, top, isPartial ? partial / costOf(r) : 1);
        else if (r.k === 'card'){ r._top = top; drawnCards.push(r); drawCard(r, top); }
        else if (r.k === 'viz'){
          if (r.t0 < 0) r.t0 = now;
          const age = now - r.t0;
          g.save(); g.beginPath(); g.rect(0, top, W, h * ch); g.clip();
          r.draw(X(2), top, X(COLS) - X(2), h * ch, age, now);
          g.restore();
          if (r.live && !REDUCED) animFps = Math.max(animFps, r.live(age) || 0);
        }
      }
      u += h;
      if (isPartial) break;
    }
    if (promptVisible()){
      if (u >= first && u < first + ROWS) drawPrompt(PADY + (u - first) * ch);
      belowPrompt().forEach((r, k) => { const y = u + 1 + k; if (y >= first && y < first + ROWS) drawSpans({ i: 0, s: r }, PADY + (y - first) * ch, 999); });
    } else if (job && job.ask && !app && !typing()){
      if (u >= first && u < first + ROWS) drawAsk(PADY + (u - first) * ch);
    } else if (job && !job.choice && !app && !typing() && now - job.t0 > 0.9 && u >= first && u < first + ROWS){
      text(COLS >= 46 ? 'ctrl+c to stop' : '^C stops', 0, PADY + (u - first) * ch, 'f');
    }
    g.restore();
    // scroll position: a thin rail on the right and a quiet note at the bottom
    if (scrollOff > 0){
      const railX = W - 22, railTop = PADY, railH = ROWS * ch;
      g.fillStyle = P.faint; g.fillRect(railX, railTop, 2, railH);
      const th = Math.max(24, railH * ROWS / total), ty = railTop + (railH - th) * (first / Math.max(1, total - ROWS));
      g.fillStyle = P.dim; g.fillRect(railX - 2, ty, 6, th);
      const note = '  ' + scrollOff + ' more below' + (COLS >= 46 ? '  pgdn ' : ' ');
      const nx = COLS - note.length, top = PADY + (ROWS - 1) * ch;
      g.fillStyle = P.bg; g.fillRect(X(nx) - 8, top - 4, note.length * cw + 8, ch + 8);
      g.font = font(); g.fillStyle = P.dim; g.fillText(note, X(nx), top + fs * 0.68);
    }
  }
  /* ---- boot screen ---- */
  function drawBoot(){
    const t = bootT, top = r => PADY + r * ch;
    if (t < 0.12) return;
    text('KN-84', 0, top(0), 'b'); text('personal computer', 7, top(0), 'd');
    text('ROM 1.04', COLS - 8, top(0), 'f');
    g.fillStyle = P.faint; g.fillRect(X(0), top(1) + ch * 0.48, X(COLS) - X(0), 2);
    if (t < 0.28) return;
    // memory check: a bar of 32 cells filling, the count rolling up
    const mp = clamp((t - 0.28) / 0.62, 0, 1);
    text('MEMORY', 0, top(2), 'd');
    const cells = Math.max(8, Math.min(32, Math.floor((COLS - 20) / 0.75))), filled = Math.floor(cells * mp), bEnd = Math.ceil(10 + cells * 0.75);
    for (let i = 0; i < cells; i++){ g.fillStyle = i < filled ? P.normal : P.faint; g.fillRect(X(10 + i * 0.75), top(2) + 9, cw * 0.75 - 3, ch - 18); }
    const kb = Math.floor(640 * mp / 16) * 16;
    text(String(kb).padStart(3, ' ') + 'K', bEnd + 1, top(2), mp < 1 ? 'n' : 'b');
    if (mp >= 1) text('OK', bEnd + 6, top(2), 'b');
    if (t < 0.95) return;
    // disk: a platter spinning up, then ready
    const dp = clamp((t - 0.95) / 0.5, 0, 1);
    text('DISK 0', 0, top(3), 'd');
    const cx = X(10) + ch * 0.38, cy = top(3) + ch * 0.5, R = ch * 0.36;
    g.strokeStyle = P.normal; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    g.fillStyle = P.normal; g.beginPath(); g.arc(cx, cy, 3, 0, Math.PI * 2); g.fill();
    const ang = (t - 0.95) * (4 + dp * 30);
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R); g.stroke();
    text(dp < 1 ? 'spinning up' + '.'.repeat(1 + Math.floor(t * 8) % 3) : 'ready', 12, top(3), dp < 1 ? 'n' : 'b');
    if (t < 1.45) return;
    text('TERM', 0, top(4), 'd'); text('vt  ' + COLS + ' x ' + ROWS, 10, top(4), 'n');
    if (t > 1.6) text('OK', bEnd + 6, top(4), 'b');
  }

  /* ---- inline visualisations, drawn in phosphor ---- */
  function drawEden(x, y, w, h, age, t){
    const ap = REDUCED ? 1 : ease(age / 0.6);
    const bx = x, by = y + ch * 0.4, bw = cw * 16, bh = h - ch * 0.8;
    // the context: a document of lines being read
    g.strokeStyle = P.normal; g.lineWidth = 2; g.strokeRect(bx, by, bw, bh * ap);
    text('context', 0 + 2 + 1, by + 4, 'b');
    const lines = [0.82, 0.64, 0.9, 0.5, 0.74, 0.58];
    const scan = Math.floor((t * 3) % lines.length);
    lines.forEach((f, i) => {
      const ly = by + ch * 1.3 + i * (bh - ch * 1.8) / lines.length;
      if (ly > by + bh * ap - 8) return;
      g.fillStyle = !REDUCED && i === scan ? P.normal : P.faint;
      g.fillRect(bx + cw, ly, (bw - cw * 2) * f, 5);
    });
    // agents
    const ax = x + cw * (COLS - 16), aw = cw * 11, ah = ch * 1.15;
    const ays = [y + ch * 0.45, y + h / 2 - ah / 2, y + h - ch * 0.45 - ah];
    const sx = bx + bw, sy = by + bh / 2;
    ays.forEach((ay, i) => {
      const ex = ax, ey = ay + ah / 2;
      const c1x = sx + (ex - sx) * 0.5;
      const pt = s => { const u = 1 - s; return [u * u * u * sx + 3 * u * u * s * c1x + 3 * u * s * s * c1x + s * s * s * ex, u * u * u * sy + 3 * u * u * s * sy + 3 * u * s * s * ey + s * s * s * ey]; };
      // wire
      g.strokeStyle = P.faint; g.lineWidth = 2; g.beginPath(); g.moveTo(sx, sy);
      const reach = ap; for (let s = 0.02; s <= reach + 1e-6; s += 0.02){ const p = pt(s); g.lineTo(p[0], p[1]); } g.stroke();
      // packets: a bright head and a dim trail
      const period = 1.5, phase = REDUCED ? 0.55 : ((t + i * 0.5) % period) / period;
      if (ap >= 1){
        for (let k = 3; k >= 0; k--){
          const s = phase - k * 0.04; if (s < 0.05 || s > 1) continue;
          const p = pt(s); g.fillStyle = k ? P.dim : P.bright; const z = k ? 5 : 8;
          g.fillRect(p[0] - z / 2, p[1] - z / 2, z, z);
        }
      }
      // agent node: lights up as each packet lands
      const glow = REDUCED ? 0 : Math.max(0, 1 - phase / 0.25) * (ap >= 1 ? 1 : 0);
      g.fillStyle = glow > 0.5 ? P.normal : P.bg; g.fillRect(ex, ay, aw, ah);
      g.strokeStyle = glow > 0.05 ? P.bright : P.normal; g.lineWidth = 2; g.strokeRect(ex, ay, aw, ah);
      g.font = font(); g.fillStyle = glow > 0.5 ? P.bg : P.normal;
      g.fillText('agent', ex + (aw - cw * 5) / 2, ay + (ah - ch) / 2 + fs * 0.68);
    });
  }
  function drawBars(x, y, w, h, age){
    const narrow = COLS < 70;
    const labels = narrow ? ['mo 1', 'mo 2', 'mo 3'] : ['month 1', 'month 2', 'month 3'];
    const base = y + h - ch * 1.25, maxH = h - ch * 1.6, bw = cw * (narrow ? 3 : 6), gap = cw * (narrow ? 5 : 10);
    g.fillStyle = P.faint; g.fillRect(x, base, gap * 3 - cw * 2, 2);
    labels.forEach((lab, i) => {
      const p = REDUCED ? 1 : ease((age - i * 0.18) / 0.55);
      const bh = maxH * (i + 1) / 3 * p;
      const bx = x + i * gap + cw * 0.5;
      g.fillStyle = P.normal; g.fillRect(bx, base - bh, bw, bh);
      if (p > 0){ g.fillStyle = P.bright; g.fillRect(bx - 2, base - bh - 4, bw + 4, 4); }
      g.font = font(); g.fillStyle = P.dim; g.fillText(lab, bx + (bw - cw * lab.length) / 2, base + 4 + fs * 0.68);
    });
    // the facts, as a table aligned to the text grid beside the bars
    const f = J.facts || [];
    const kw = Math.max(0, ...f.map(r => r[0].length)) + (narrow ? 2 : 3);
    const vw = Math.max(0, ...f.map(r => r[1].length));
    const sepCol = Math.min(2 + (narrow ? 16 : 31), COLS - vw - kw - 3), keyCol = sepCol + 2;
    g.fillStyle = P.faint; g.fillRect(X(sepCol), y + ch * 0.2, 2, ch * 4 - ch * 0.4);
    f.slice(0, 5).forEach(([k, v], i) => {
      const n = REDUCED ? 99 : Math.floor((age - 0.25 - i * 0.12) * 90);
      if (n <= 0) return;
      const top = y + i * ch;
      text(k.slice(0, n), keyCol, top, 'd');
      text(v.slice(0, Math.max(0, n - 3)), keyCol + kw, top, i === 0 ? 'b' : 'n');
    });
  }
  function drawEmpty(x, y, w, h, age, t){
    // an empty sheet with a folded corner and a waiting caret (narrow screens: just the words)
    if (COLS < 50){
      text('No posts yet.', 2, y + ch * 0.9, 'b');
      text('New ones will appear here.', 2, y + ch * 2.0, 'd');
      text('Meanwhile:', 2, y + ch * 3.0, 'd');
      text('about   eden   j   links', 2, y + ch * 4.0, 'n');
      return;
    }
    const pw = cw * 10, ph = h - ch * 0.6, px = x, py = y + ch * 0.3, fold = cw * 2;
    g.strokeStyle = P.dim; g.lineWidth = 2; g.setLineDash([8, 6]);
    g.beginPath(); g.moveTo(px, py); g.lineTo(px + pw - fold, py); g.lineTo(px + pw, py + fold); g.lineTo(px + pw, py + ph); g.lineTo(px, py + ph); g.closePath(); g.stroke();
    g.setLineDash([]); g.beginPath(); g.moveTo(px + pw - fold, py); g.lineTo(px + pw - fold, py + fold); g.lineTo(px + pw, py + fold); g.stroke();
    if (REDUCED || (t % 1.06) < 0.53){ g.fillStyle = P.normal; g.fillRect(px + cw * 1.2, py + ch * 0.9, cw, ch - 6); }
    const col = 2 + 12;
    text('No posts yet.', col, y + ch * 0.9, 'b');
    text('When there are, they will appear here,', col, y + ch * 2.0, 'd');
    text('newest first. Meanwhile:', col, y + ch * 3.0, 'd');
    text('about   eden   j   links', col, y + ch * 4.0, 'n');
  }
  function drawFetch(x, y, w, h, age, t){
    // the KN-84 itself, in outline: a compact all-in-one with its screen lit, and a keyboard
    const ap = REDUCED ? 1 : ease(age / 0.5);
    const col = COLS < 50 ? 0 : Math.max(14, COLS - 31);
    const bx = x, by = y + ch * 0.2, bw = cw * Math.min(18, col - 6), bh = ch * 7.6;
    g.strokeStyle = P.normal; g.lineWidth = 2;
    if (col) g.strokeRect(bx, by, bw, bh * ap);
    if (col && ap >= 1){
      const sx = bx + cw * 2, sy = by + ch * 0.7, sw = bw - cw * 4, sh = ch * 4.4;
      g.strokeStyle = P.dim; g.strokeRect(sx, sy, sw, sh);
      g.fillStyle = P.faint; g.fillRect(sx + 6, sy + 6, sw - 12, sh - 12);
      g.fillStyle = P.bg; g.fillRect(sx + 10, sy + 10, sw - 20, sh - 20);
      text('$', 5, sy + 16, 'n');
      if (REDUCED || (t % 1.06) < 0.53){ g.fillStyle = P.normal; g.fillRect(X(7), sy + 20, cw, ch - 10); }
      // floppy slot and power light
      const fy = sy + sh + ch * 0.75;
      g.fillStyle = P.dim; g.fillRect(bx + bw - cw * 8, fy, cw * 6, 4);
      g.fillStyle = (t % 2) < 1.7 || REDUCED ? P.bright : P.faint; g.fillRect(bx + cw * 2, fy - 2, 8, 8);
      // keyboard
      const ky = by + bh + ch * 0.6, kh = ch * 2.6;
      g.strokeStyle = P.normal; g.strokeRect(bx - cw, ky, bw + cw * 2, kh);
      const kr = (kh - 12) / 4;
      const nk = Math.floor((bw / cw) / 1.6);
      for (let r = 0; r < 3; r++) for (let c2 = 0; c2 < nk - (r % 2); c2++){
        const kx = bx + c2 * cw * 1.6 + (r % 2) * cw * 0.5, kyy = ky + 6 + r * kr;
        g.fillStyle = P.dim; g.fillRect(kx, kyy, cw * 1.2, kr - 5);
      }
      g.fillStyle = P.dim; g.fillRect(bx + bw * 0.22, ky + 6 + 3 * kr, bw * 0.56, kr - 5);
    }
    // the card
    const info = fetchInfo();
    const n = REDUCED ? 99 : Math.floor((age - 0.15) * 40);
    if (n <= 0) return;
    text('kaiav', col, y, 'b'); text('@', col + 5, y, 'f'); text('kn84', col + 6, y, 'b');
    g.fillStyle = P.faint; g.fillRect(X(col), y + ch * 1.48, cw * 10, 2);
    info.forEach(([k, v], i) => {
      if (i + 1 > n) return;
      const top = y + (i + 2) * ch * 0.98;
      text(k, col, top, 'd'); text(v, col + 10, top, 'n');
    });
    if (n > info.length + 1){
      const top = y + (info.length + 2.4) * ch * 0.98;
      [P.faint, P.dim, P.normal, P.bright, P.accent].forEach((c, i) => { g.fillStyle = c; g.fillRect(X(col + i * 3), top + 6, cw * 2.6, ch - 12); });
    }
  }

  /* ---- frame ---- */
  function update(dt, t){
    now = t;
    let changed = dirty;
    if (booting){
      bootT += dt;
      if (bootT >= BOOT_END) endBoot(), changed = true;
      else if (bootT - bootLastDraw >= 1 / 30){ bootLastDraw = bootT; changed = true; }
    }
    if (app){
      const st = app;
      if (appCall('tick', dt) && app === st) st.dirty = true;
      if (app === st && st.dirty){ st.dirty = false; appCall('render', scr); changed = true; }
    }
    if (!booting && !app && typing()){
      carry += dt * RATE;
      while (carry > 0 && shown < rows.length){
        const r = rows[shown]; const c = costOf(r);
        if (r.k === 'viz' && r.t0 < 0) r.t0 = now;
        const need = c - partial;
        if (carry >= need){ carry -= need; shown++; partial = 0; }
        else { partial += carry; carry = 0; }
      }
      if (!typing()) carry = 0, blinkT0 = now;
      changed = true;
    }
    if (runQueued && !job && !app && !rs){ runQueued = false; execute(input); if (!job) flushAhead(); changed = true; }
    if (job && !job.hinted && !app && now - job.t0 > 0.9){ job.hinted = true; changed = true; }
    const on = ((t - blinkT0) % 1.06) < 0.53;
    if (on !== blinkOn){ blinkOn = on; if (promptVisible() || (job && job.ask && !job.ask.one) || (app && gridCursor)) changed = true; }
    if (!app && animFps > 0 && t - lastAnim >= 1 / animFps - 1e-3) changed = true;
    if (!app) for (const r of drawnCards) if (r.flash != null && t - r.flash < 0.45) changed = true;   // tap / pick flash
    if (changed){ draw(); lastAnim = t; dirty = false; }
    return changed;
  }

  draw();
  return { canvas, handleKey, handleKeyUp, handleTap, insertText, update, run, scroll, get cursorY(){ return promptY / H; } };
};
})();
