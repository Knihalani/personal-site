/* terminal.js: the CRT terminal, the whole interface of the site.
   MAC.createTerminal({ content, aspect }) -> { canvas, handleKey, insertText, update, run, scroll }
   Also implements MAC.TERM (cmds, apps, io, api, scr, fs): see CONTRACT.md "Terminal extension API".
   A small shell: a virtual filesystem kept in localStorage, pipes, redirection, globs, aliases, history.

   Typeface: VT323, on purpose. It is drawn from the DEC VT320's own glyph ROM, so it belongs on a
   1980s tube; its strokes are a uniform pixel weight that survives the scene's curvature, scanlines and
   bloom, where Plex Mono's thin hairlines and ink traps would smear into mush. One face only: hierarchy
   comes from brightness (faint, dim, normal, bright), inverse video, and DEC-style double-size lines.

   Everything is drawn on a fixed 72-column grid. Rules, arrows, bars and diagrams are drawn as vectors in
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
const COLS = 72;               // grid width; ~23 rows at 4:3
const WIDTH = 1280;            // canvas px
const LINE = 0.9;              // line height in em (VT323 has generous built-in leading)
const RATE = 1500;             // typing-out speed, characters per second
const BOOT_END = 1.85;         // seconds
const HIST_KEY = 'kaiav.term.history';
const T0 = performance.now();

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
  const out = []; let line = '';
  for (const w of String(text).split(/\s+/)){
    if (!w) continue;
    if (!line) line = w;
    else if (line.length + 1 + w.length <= width) line += ' ' + w;
    else { out.push(line); line = w; }
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
  const info = (name, n) => ({ name, dir: isD(n), size: isD(n) ? 0 : n.t.length, mtime: n.m || 0 });
  const badName = n => !n || n === '__proto__' || n === 'constructor' || n === 'prototype';
  function fail(m){ api.lastError = m; return false; }
  function put(abs, text, app){
    const { dir, name } = parent(abs);
    if (!name) return fail('Is a directory');
    if (badName(name)) return fail('Invalid name');
    if (!isD(dir)) return fail('No such file or directory');
    const ex = own(dir.c, name) ? dir.c[name] : null;
    if (isD(ex)) return fail('Is a directory');
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
      const { dir, name } = parent(a); delete dir.c[name]; dir.m = Date.now(); changed(); return true;
    },
    mv(a, b){
      const A = R(a); let B = R(b); const n = get(A);
      if (!n) return fail('No such file or directory');
      if (A === '/') return fail('Permission denied');
      if (isD(get(B))) B = join(B, base(A));
      if (B === A) return true;
      if (B.startsWith(A + '/')) return fail('cannot move a directory into itself');
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
      const c = clone(n); c.m = Date.now(); dir.c[name] = c; changed(); return true;
    },
    stat(p){ const a = R(p), n = get(a); return n ? Object.assign(info(base(a), n), { path: a }) : null; },
    touch(p){ const a = R(p), n = get(a); if (n){ n.m = Date.now(); changed(true); return true; } return put(a, '', false); },
    node: p => get(R(p)),
    /* seed: files = [{ path, text, doc, always }], dirs = [path]. Generated files the visitor has not
       changed are refreshed from MAC.CONTENT on every load. */
    seed(dirs, files){
      const fresh = !root.seeded;
      if (fresh) for (const d of dirs) mkdir(d, true);
      for (const f of files){
        const n = get(f.path);
        if (!n && (fresh || f.always)){
          const { dir, name } = parent(f.path);
          if (isD(dir)) dir.c[name] = { t: f.text, m: Date.now(), g: 1, doc: f.doc || undefined };
        } else if (n && n.g && !isD(n)){ n.t = f.text; n.doc = f.doc || undefined; }
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
  const aspect = opts && opts.aspect > 0.5 && opts.aspect < 3 ? opts.aspect : 4 / 3;
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
  let history = [];
  try { const h = JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); if (Array.isArray(h)) history = h.filter(s => typeof s === 'string').slice(-200); } catch (e){}
  let hIdx = history.length, hDraft = '', hPrefix = '';
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
      para(text, st = 'n', width = 62, i = 2){ for (const l of wrap(text, width)) o.at(i, [l, st]); return o; },
      viz(h, draw, live){ r.push({ k: 'viz', h, draw, live: live || null, t0: -1 }); return o; },
      link(label, url, i = 2, labelW = 0){
        const sp = []; if (label) sp.push([pad(label, labelW), 'd']);
        sp.push([url, 'n', { url }]); r.push({ k: 't', i, s: sp }); return o;
      },
    };
    return o;
  }
  const heightOf = r => r.k === 'big' ? 2 : r.k === 'viz' ? r.h : 1;
  const lenOf = r => r.k === 't' ? r.s.reduce((n, s) => n + s[0].length, 0) + (r.i || 0) : r.k === 'big' ? r.s[0][0].length : r.k === 'head' ? r.label.length * 2 : 0;
  const costOf = r => r.k === 'viz' ? 40 : r.k === 'big' ? lenOf(r) * 2 + 4 : r.k === 'head' ? 30 : Math.max(3, lenOf(r) - (r.i || 0));
  const plainOf = r => r.k === 't' || r.k === 'big' ? r.s.map(s => s[1] === 'f' ? ' ' : s[0]).join('').replace(/\s+/g, ' ').trim() : '';
  const textOf = r => r.k === 't' ? (' '.repeat(r.i || 0) + r.s.map(s => s[0]).join('')).replace(/\s+$/, '') : r.k === 'big' ? '  ' + r.s[0][0] : r.k === 'head' ? '  ' + r.label.toUpperCase() : null;

  function pushRow(r){ openRow = null; rows.push(r); dirty = true; }
  function emit(o, mirrorText){            // rich rows straight to the scrollback (outside a job)
    links = []; sel = -1;
    for (const r of o.rows){ if (r.k === 't') for (const s of r.s) if (s[2]) links.push(s[2]); pushRow(r); }
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
      for (const r of o.rows){ if (r.k === 't') for (const s of r.s) if (s[2]) links.push(s[2]); rows.push(r); }
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

  /* ---- content ---- */
  const L = C.links || {}, J = C.j || {}, E = C.eden || {}, A = C.about || {}, Wr = C.writing || {};
  const OPEN = [
    { name: 'linkedin', url: L.linkedin, label: 'LinkedIn' },
    { name: 'x', url: L.x, alias: ['twitter'], label: 'X' },
    { name: 'j', url: J.url, alias: ['risingfounder', 'rising'], kw: ['rising founder'], label: J.title },
  ].filter(o => o.url);
  const wrapT = (t, w = 68) => wrap(t, w).join('\n');
  const posts = () => (Wr.posts || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const TEXT = {
    about: () => [C.name, A.role, '', ...(A.body || []).map(p => wrapT(p))].filter(x => x != null).join('\n') + '\n',
    eden: () => [E.title || 'Eden', E.role, '', E.line].filter(x => x != null).join('\n') + '\n',
    j: () => [J.title || 'J', J.role, '', J.line, wrapT(J.body || ''), '', ...(J.facts || []).map(f => pad(f[0], 9) + f[1]), '', J.url].filter(x => x != null).join('\n') + '\n',
    links: () => [L.linkedin && pad('linkedin', 10) + L.linkedin, L.x && pad('x', 10) + L.x].filter(Boolean).join('\n') + '\n',
    writing: () => posts().length ? posts().map(p => [p.date, p.title, p.summary && wrapT(p.summary), p.url].filter(Boolean).join('\n')).join('\n\n') + '\n' : 'No posts yet.\n',
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
    '  links       LinkedIn and X',
    '  open x      open a link in a new tab',
    '  snake       a game',
    '  tetris      a game',
    '  donut       a spinning donut',
    '  lamp off    turn off the desk lamp',
    '  neofetch    about this machine', '',
    '## the shell', '',
    '  help        every command, grouped',
    '  man grep    the manual page for any command',
    '  cat README.md | grep try',
    '  echo hello > notes/hello.txt',
    '  ls -l ~/notes', '',
    'Files you make are kept in this browser.',
    'Tab completes. Up and down recall history. Ctrl+C stops a command.', '',
  ].join('\n');
  FS.seed([HOME, HOME + '/notes', HOME + '/writing', '/etc', '/tmp'], [
    { path: HOME + '/README.md', text: README },
    { path: HOME + '/about.txt', text: TEXT.about(), doc: 'about' },
    { path: HOME + '/eden.txt', text: TEXT.eden(), doc: 'eden' },
    { path: HOME + '/j.txt', text: TEXT.j(), doc: 'j' },
    { path: HOME + '/links.txt', text: TEXT.links(), doc: 'links' },
    ...posts().map(p => ({ path: HOME + '/writing/' + (p.date ? p.date + '-' : '') + String(p.title || 'post').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.txt',
      text: [p.title, p.date, '', p.summary && wrapT(p.summary), p.url].filter(x => x != null).join('\n') + '\n', always: true })),
    { path: '/etc/motd', text: 'KN-84 personal computer. KNOS 1.04.\nType help to begin, or cat README.md for a short guide.\n' },
    { path: '/etc/hostname', text: 'kn84\n' },
  ]);
  if (!FS.isDir(cwd)) cwd = '/';

  /* ---- documents ---- */
  function welcome(o){
    o.blank().big(C.name || '', 'b').line([A.role || [E.role && 'Founder of ' + E.title, J.title].filter(Boolean).join(' · '), 'n']).blank()
      .line(['type ', 'f'], ['help', 'n'], [' to begin, or try ', 'f'], ['about', 'n'], ['  ', 'f'], ['eden', 'n'], ['  ', 'f'], ['j', 'n'], ['  ', 'f'], ['writing', 'n'], ['  ', 'f'], ['links', 'n'])
      .line(['new here? ', 'f'], ['cat README.md', 'd'])
      .blank();
    return o;
  }
  const DOCS = {
    about(o){
      o.blank().head('about', 'about.txt').blank().big(C.name || '').line([A.role || '', 'n']).blank();
      for (const p of A.body || []) o.para(p, /^\[.*\]$/.test(p) ? 'd' : 'n');
      o.blank().line(['see also  ', 'f'], ['eden', 'd'], ['  ', 'f'], ['j', 'd'], ['  ', 'f'], ['links', 'd']).blank();
      return o;
    },
    eden(o){
      o.blank().head('eden', 'eden.txt').blank().big(E.title || 'Eden').line([E.role || '', 'd']).blank()
        .line([E.line || '', 'b']).blank().viz(6, drawEden, () => 30).blank();
      return o;
    },
    j(o){
      o.blank().head('j', 'j.txt').big(J.title || 'J').line([J.role || '', 'd']).blank()
        .line([J.line || '', 'b']).para(J.body || '', 'n').blank()
        .viz(5, drawBars, age => age < 1.6 ? 30 : 0).blank();
      if (J.url) o.link('', J.url).line(['tab selects the link, enter opens it', 'f']);
      o.blank();
      return o;
    },
    writing(o){
      o.blank().head('writing', 'writing/').blank();
      const ps = posts();
      if (!ps.length){ o.viz(5, drawEmpty, () => 4).blank(); return o; }
      for (const p of ps){
        o.line([pad(p.date || '', 12), 'd'], [p.title || '', 'b']);
        if (p.summary) o.para(p.summary, 'n', 58, 14);
        if (p.url) o.link('', p.url, 14);
        o.blank();
      }
      return o;
    },
    links(o){
      o.blank().head('links', 'links.txt').blank();
      if (L.linkedin) o.link('linkedin', L.linkedin, 2, 11);
      if (L.x) o.link('x', L.x, 2, 11);
      o.blank().line(['tab selects, enter opens, or type ', 'f'], ['open x', 'd']).blank();
      return o;
    },
  };
  function openUrl(url){
    try { return window.open(url, '_blank', 'noopener'); } catch (e){ return null; }
  }
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
    usage: name, run(argv, io){ if (io.tty) io.rich(DOCS[name](out())); else io.write(TEXT[name]()); } });
  for (const n of ['about', 'eden', 'j', 'writing', 'links']) def(n, doc(n));
  def('open', { g: 'read', desc: 'open a link: ' + OPEN.map(o => o.name).join(', '), usage: 'open <link>', run(argv, io){
    const q = argv.slice(1).join(' ');
    if (!q){ io.write('open what? ', 'dim'); io.write(OPEN.map(x => x.name).join('  ') + '\n'); return 1; }
    const f = fuzzy(q, OPEN);
    if (!f){ io.err('open: no link called ' + q + '. try ' + OPEN.map(x => x.name).join(', ') + '\n'); return 1; }
    const w = openUrl(f.item.url);
    if (io.tty){ const o = out(); o.at(0, ['opening ', 'd'], [f.item.label || f.item.name, 'b']).at(2, [f.item.url, 'n', { url: f.item.url }]); if (!w) o.at(2, ['if nothing opened, the address is above', 'f']); io.rich(o); }
    else io.write(f.item.url + '\n');
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
          io.write((e.dir ? 'drwxr-xr-x' : '-rw-r--r--') + '  kaiav  ', 'faint');
          io.write((e.dir ? '-' : human(e.size)).padStart(w) + '  ' + fmtDate(e.mtime) + '  ', 'dim');
          io.write(e.name + (e.dir && e.name[0] !== '.' ? '/' : '') + '\n', e.dir ? 'bright' : 'normal');
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
    if (!FS.isDir(p)){ io.err('cd: not a directory: ' + argv[1] + '\n'); return 1; }
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
    for (const d of a){ if (o.p && FS.isDir(d)) continue; if (!FS.mkdir(d, !!o.p)){ io.err('mkdir: ' + d + ': ' + FS.lastError + '\n'); io.exit(1); } }
  } });
  def('touch', { g: 'files', desc: 'make an empty file, or update its time', usage: 'touch file...', run(argv, io){
    if (argv.length < 2){ io.err('usage: touch file...\n'); return 1; }
    for (const f of argv.slice(1)) if (!FS.touch(f)){ io.err('touch: ' + f + ': ' + FS.lastError + '\n'); io.exit(1); }
  } });
  def('rm', { g: 'files', desc: 'remove files', usage: 'rm [-r] [-f] path...', opts: [['-r', 'remove directories and what is in them'], ['-f', 'no complaint if missing']], run(argv, io){
    const { o, a } = getopts(argv.slice(1)); const r = o.r || o.R;
    if (!a.length){ io.err('usage: rm [-r] [-f] path...\n'); return 1; }
    for (const p of a){
      const abs = FS.resolve(p, cwd);
      if (abs === '/' || abs === HOME){ io.err('rm: refusing to remove ' + tildify(abs) + '\n'); io.exit(1); continue; }
      if (!FS.exists(p)){ if (!o.f){ io.err('rm: ' + p + ': No such file or directory\n'); io.exit(1); } continue; }
      if (FS.isDir(p) && !r){ io.err('rm: ' + p + ': is a directory (use rm -r)\n'); io.exit(1); continue; }
      if (!FS.rm(p, true)){ io.err('rm: ' + p + ': ' + FS.lastError + '\n'); io.exit(1); }
      else if (!FS.isDir(cwd)) setCwd(HOME);
    }
  } });
  def('mv', { g: 'files', desc: 'move or rename', usage: 'mv from... to', run(argv, io){
    const a = argv.slice(1).filter(x => x[0] !== '-');
    if (a.length < 2){ io.err('usage: mv from... to\n'); return 1; }
    const to = a.pop();
    if (a.length > 1 && !FS.isDir(to)){ io.err('mv: ' + to + ': not a directory\n'); return 1; }
    for (const f of a) if (!FS.mv(f, to)){ io.err('mv: ' + f + ': ' + FS.lastError + '\n'); io.exit(1); }
    if (!FS.isDir(cwd)) setCwd(HOME);
  } });
  def('cp', { g: 'files', desc: 'copy', usage: 'cp [-r] from... to', opts: [['-r', 'copy directories']], run(argv, io){
    const { o, a } = getopts(argv.slice(1));
    if (a.length < 2){ io.err('usage: cp [-r] from... to\n'); return 1; }
    const to = a.pop();
    if (a.length > 1 && !FS.isDir(to)){ io.err('cp: ' + to + ': not a directory\n'); return 1; }
    for (const f of a){
      if (FS.isDir(f) && !(o.r || o.R)){ io.err('cp: ' + f + ' is a directory (use cp -r)\n'); io.exit(1); continue; }
      if (!FS.cp(f, to)){ io.err('cp: ' + f + ': ' + FS.lastError + '\n'); io.exit(1); }
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
  def('uniq', { g: 'text', desc: 'drop repeated adjacent lines', usage: 'uniq [-c] [file]', opts: [['-c', 'prefix each line with its count']], ex: ['sort words.txt | uniq -c'], run(argv, io){
    const { o, a } = getopts(argv.slice(1));
    const ls = sources(io, a, 'uniq').flatMap(s => linesOf(s.text)); const r = [];
    for (const l of ls){ if (r.length && r[r.length - 1][0] === l) r[r.length - 1][1]++; else r.push([l, 1]); }
    if (r.length) io.write(r.map(([l, n]) => (o.c ? String(n).padStart(7) + ' ' : '') + l).join('\n') + '\n');
  } });
  def('tr', { g: 'text', desc: 'translate or delete characters', usage: 'tr [-d] set1 [set2]', ex: ["echo hello | tr a-z A-Z", "echo hello | tr -d l"], run(argv, io){
    const { o, a } = getopts(argv.slice(1));
    if (!a.length || (!o.d && a.length < 2)){ io.err('usage: tr [-d] set1 [set2]\n'); return 1; }
    const s1 = expandSet(a[0]), s2 = o.d ? '' : expandSet(a[1]);
    let r = '';
    for (const c of io.stdin || ''){ const k = s1.indexOf(c); if (k < 0) r += c; else if (!o.d) r += s2[Math.min(k, s2.length - 1)] || ''; }
    io.write(r);
  } });
  def('cut', { g: 'text', desc: 'pick columns from each line', usage: 'cut -d X -f LIST | -c LIST [file...]', opts: [['-d X', 'field separator (tab)'], ['-f LIST', 'fields, like 1,3 or 2-'], ['-c LIST', 'characters']], ex: ['cut -d " " -f 1 links.txt'], run(argv, io){
    const { o, a } = getopts(argv.slice(1), 'dfc');
    if (!o.f && !o.c){ io.err('usage: cut -d X -f LIST | -c LIST [file...]\n'); return 1; }
    const want = fieldList(o.f || o.c), d = o.d || '\t';
    const r = sources(io, a, 'cut').flatMap(s => linesOf(s.text)).map(l => o.c ? [...l].filter((_, i) => want(i + 1)).join('') : !l.includes(d) ? l : l.split(d).filter((_, i) => want(i + 1)).join(d));
    if (r.length) io.write(r.join('\n') + '\n');
  } });
  def('sed', { g: 'text', desc: 'find and replace', usage: "sed 's/find/replace/[g][i]' [file...]", ex: ["echo hello | sed 's/l/L/g'", "sed 's/eden/Eden/i' notes/x.txt"], run(argv, io){
    const a = argv.slice(1).filter(x => x !== '-e');
    const sc = a[0] || '';
    if (sc[0] !== 's' || sc.length < 4){ io.err("sed: only s/find/replace/flags is supported\n"); return 1; }
    const dl = sc[1], parts = []; let curp = '';
    for (let i = 2; i < sc.length; i++){
      if (sc[i] === '\\' && sc[i + 1] === dl){ curp += dl; i++; continue; }
      if (sc[i] === dl){ parts.push(curp); curp = ''; continue; }
      curp += sc[i];
    }
    parts.push(curp);
    if (parts.length < 3){ io.err('sed: unterminated s command\n'); return 1; }
    const [find, rep, flags] = parts;
    let re; try { re = new RegExp(find.replace(/\\([(){}|+?])/g, '$1'), (flags.includes('g') ? 'g' : '') + (flags.includes('i') || flags.includes('I') ? 'i' : '')); }
    catch (e){ io.err('sed: bad pattern: ' + find + '\n'); return 1; }
    let r = '';
    for (let i = 0; i < rep.length; i++){
      const c = rep[i];
      if (c === '\\' && i + 1 < rep.length){ const n = rep[++i]; r += /\d/.test(n) ? '$' + n : n === 'n' ? '\n' : n === '&' ? '&' : n === '$' ? '$$' : n; }
      else if (c === '&') r += '$&';
      else if (c === '$') r += '$$';
      else r += c;
    }
    const ls = sources(io, a.slice(1), 'sed').flatMap(s => linesOf(s.text)).map(l => l.replace(re, r));
    if (ls.length) io.write(ls.join('\n') + '\n');
  } });
  def('rev', { g: 'text', desc: 'reverse each line', usage: 'rev [file...]', run(argv, io){
    const ls = sources(io, argv.slice(1), 'rev').flatMap(s => linesOf(s.text)).map(l => [...l].reverse().join(''));
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
    io.write(' '.repeat(Math.floor((20 - title.length) / 2)) + title + '\n', 'bright');
    io.write('Su Mo Tu We Th Fr Sa\n', 'dim');
    const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
    let col = first; io.write('   '.repeat(first));
    for (let d = 1; d <= days; d++){
      const today = d === t.getDate() && m === t.getMonth() && y === t.getFullYear();
      io.write(String(d).padStart(2), today && io.tty ? 'inverse' : 'normal');
      col++; io.write(col % 7 === 0 || d === days ? '\n' : ' ');
    }
  } });
  def('uptime', { g: 'system', desc: 'time since you arrived', usage: 'uptime', run(argv, io){
    io.write('up ', 'dim'); io.write(uptimeStr(), 'bright'); io.write('  since you arrived, ', 'dim'); io.write(String(ran)); io.write(ran === 1 ? ' command\n' : ' commands\n', 'dim');
  } });
  def('whoami', { g: 'system', desc: 'your user name', usage: 'whoami', run(argv, io){ io.write(ENV.USER + '\n'); } });
  def('hostname', { g: 'system', desc: "this machine's name", usage: 'hostname', run(argv, io){ io.write('kn84\n'); } });
  def('uname', { g: 'system', desc: 'about the system', usage: 'uname [-a] [-s] [-n] [-r] [-m]', opts: [['-a', 'everything']], run(argv, io){
    const { o } = getopts(argv.slice(1)); const f = { s: 'KNOS', n: 'kn84', r: '1.04', v: '#1 1984', m: 'KN-84' };
    const keys = o.a ? ['s', 'n', 'r', 'v', 'm'] : Object.keys(f).filter(k => o[k]);
    io.write((keys.length ? keys : ['s']).map(k => f[k]).join(' ') + '\n');
  } });
  def('env', { g: 'system', desc: 'the environment', usage: 'env', run(argv, io){ io.write(Object.keys(ENV).sort().map(k => k + '=' + ENV[k]).join('\n') + '\n'); } });
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
  def('help', { g: 'system', desc: 'every command, grouped', usage: 'help [command]', run(argv, io){
    if (argv[1]) return B.man.run(['man', argv[1]], io);
    const groups = [['read', 'read'], ['files', 'files'], ['text', 'text'], ['system', 'system'], ['shell', 'shell'], ['misc', 'misc']];
    const by = {};
    for (const [n, c] of Object.entries(M.TERM.cmds)){ if (!c || c.hidden || typeof c.run !== 'function') continue; const gname = c.g && groups.some(x => x[0] === c.g) ? c.g : 'more'; (by[gname] = by[gname] || []).push(n); }
    const apps = Object.keys(M.TERM.apps).filter(n => M.TERM.apps[n] && typeof M.TERM.apps[n].start === 'function');
    const o = out(); o.blank().head('help').blank();
    const line = (label, names, st) => {
      const ws = []; let l = '';
      for (const n of names){ if (l && l.length + 2 + n.length > COLS - 16){ ws.push(l); l = n; } else l = l ? l + '  ' + n : n; }
      if (l) ws.push(l);
      ws.forEach((w, k) => o.at(2, [pad(k ? '' : label, 10), 'd'], [w, st]));
    };
    for (const [gk, label] of groups) if (by[gk]) line(label, by[gk], gk === 'read' ? 'b' : 'n');
    if (apps.length) line('apps', apps, 'b');
    if (by.more) line('extras', by.more, 'n');
    o.blank().at(2, ['man <cmd>', 'n'], [' for details   ', 'f'], ['tab', 'n'], [' completes   ', 'f'], ['ctrl+c', 'n'], [' stops   ', 'f'], ['cat README.md', 'n']).blank();
    if (io.tty) io.rich(o); else io.write(o.rows.map(textOf).join('\n') + '\n');
  } });
  def('history', { g: 'shell', desc: 'commands you have run', usage: 'history [-c]', opts: [['-c', 'forget them']], ex: ['!!   run the last one again', '!3   run number 3'], run(argv, io){
    if (argv[1] === '-c'){ history = []; hIdx = 0; try { localStorage.setItem(HIST_KEY, '[]'); } catch (e){} return; }
    if (!history.length){ io.write('no history yet\n', 'dim'); return; }
    history.forEach((s, i) => { io.write(String(i + 1).padStart(5, ' ') + '  ', 'faint'); io.write(s + '\n'); });
  } });
  def('export', { g: 'shell', desc: 'set an environment variable', usage: 'export NAME=value', ex: ['export GREETING=hi', 'echo $GREETING'], run(argv, io){
    if (argv.length < 2){ for (const k of Object.keys(ENV).sort()) io.write('export ' + k + '="' + ENV[k] + '"\n'); return; }
    for (const a of argv.slice(1)){ const m = /^([A-Za-z_]\w*)(?:=(.*))?$/s.exec(a); if (!m){ io.err('export: not a valid name: ' + a + '\n'); io.exit(1); continue; } if (m[2] != null) ENV[m[1]] = m[2]; else if (!(m[1] in ENV)) ENV[m[1]] = ''; }
  } });
  def('unset', { g: 'shell', desc: 'remove an environment variable', usage: 'unset NAME...', run(argv){ for (const a of argv.slice(1)) delete ENV[a]; } });
  def('alias', { g: 'shell', desc: 'name a command line', usage: "alias [name='command']", ex: ["alias hi='echo hello'", 'alias'], run(argv, io){
    if (argv.length < 2){ for (const k of Object.keys(ALIASES).sort()) io.write('alias ' + k + "='" + ALIASES[k] + "'\n"); return; }
    for (const a of argv.slice(1)){
      const m = /^([^=\s]+)=(.*)$/s.exec(a);
      if (!m){ if (hasAlias(a)) io.write('alias ' + a + "='" + ALIASES[a] + "'\n"); else { io.err('alias: ' + a + ': not found\n'); io.exit(1); } continue; }
      ALIASES[m[1]] = m[2];
    }
    saveAliases();
  } });
  def('unalias', { g: 'shell', desc: 'remove an alias', usage: 'unalias name...', run(argv, io){
    for (const a of argv.slice(1)){ if (hasAlias(a)) delete ALIASES[a]; else { io.err('unalias: ' + a + ': not found\n'); io.exit(1); } }
    saveAliases();
  } });
  def('clear', { g: 'system', desc: 'clear the screen', usage: 'clear', run(argv, io){ if (io.tty) clearScreen(); } });
  def('reset', { g: 'system', desc: 'clear the screen and start fresh', usage: 'reset', run(argv, io){ if (!io.tty) return; clearScreen(); io.rich(welcome(out())); } });
  def('neofetch', { g: 'system', desc: 'about this machine', usage: 'neofetch', run(argv, io){
    const info = fetchInfo();
    if (!io.tty){ io.write('kaiav@kn84\n' + info.map(([k, v]) => pad(k, 10) + v).join('\n') + '\n'); return; }
    const o = out(); o.blank().viz(13, drawFetch, () => 4).blank(); io.rich(o);
    if (job) job.plain += info.map(([k, v]) => k + ' ' + v).join('. ') + ' ';
  } });

  /* misc */
  def('seq', { g: 'misc', desc: 'count', usage: 'seq [first [step]] last', ex: ['seq 5', 'seq 10 -2 0'], run(argv, io){
    const n = argv.slice(1).map(Number);
    if (!n.length || n.some(x => !isFinite(x))){ io.err('usage: seq [first [step]] last\n'); return 1; }
    const [a, s, b] = n.length === 1 ? [1, 1, n[0]] : n.length === 2 ? [n[0], 1, n[1]] : n;
    if (!s){ io.err('seq: step cannot be zero\n'); return 1; }
    const r = []; for (let x = a; s > 0 ? x <= b : x >= b; x += s){ r.push(+x.toFixed(10)); if (r.length >= 10000) break; }
    if (r.length) io.write(r.join('\n') + '\n');
  } });
  def('sleep', { g: 'misc', desc: 'wait a while (ctrl+c stops it)', usage: 'sleep seconds', run(argv, io){
    const m = /^(\d*\.?\d+)([smh]?)$/.exec(argv[1] || '');
    if (!m){ io.err('usage: sleep seconds\n'); return 1; }
    return io.sleep(parseFloat(m[1]) * ({ '': 1, s: 1, m: 60, h: 3600 })[m[2]] * 1000);
  } });
  def('bc', { g: 'misc', desc: 'a calculator', usage: 'bc [expression]', opts: [], more: 'Arithmetic with + - * / % ^ and parentheses, plus sqrt, abs, floor, ceil, round and pi. Reads the expression from its arguments, or one per line from a pipe.', ex: ['bc 2^10', "echo '(1+2)*3' | bc"], run(argv, io){
    const src = argv.length > 1 ? [argv.slice(1).join(' ')] : linesOf(io.stdin || '');
    if (!src.length){ io.err('usage: bc expression   (try: bc 2^10)\n'); return 1; }
    for (const l of src){
      if (/^\s*(scale|quit)\b/.test(l)) continue;
      try { const v = calc(l); if (v != null) io.write(v + '\n'); } catch (e){ io.err('bc: ' + (e.message || 'syntax error') + '\n'); io.exit(1); }
    }
  } });
  def('true', { g: 'misc', desc: 'do nothing, successfully', usage: 'true', run(){ return 0; } });
  def('false', { g: 'misc', desc: 'do nothing, unsuccessfully', usage: 'false', run(){ return 1; } });
  let exits = 0;
  def('exit', { g: 'misc', desc: 'leave', usage: 'exit', run(argv, io){
    const lines = ["you can't leave. the coffee's still hot.", 'not yet. the lamp is warm and the coffee is still hot.', "logout refused: there's still coffee in the mug.", 'the door is the browser tab. the coffee is right here.'];
    io.write(lines[exits++ % lines.length] + '\n', 'dim');
  } });
  const SHELL_BUILTIN = ['cd', 'export', 'unset', 'alias', 'unalias', 'history', 'exit', 'help', 'echo', 'pwd', 'true', 'false'];
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
    return [['OS', 'KNOS 1.04'], ['Host', 'KN-84 personal computer'], ['Kernel', '1.04 #1 1984'], ['Uptime', uptimeStr()], ['Shell', 'sh, ' + Object.keys(M.TERM.cmds).length + ' commands'],
      ['Terminal', 'vt320, ' + COLS + 'x' + ROWS + ', VT323'], ['CPU', 'KN-1 @ 8 MHz'], ['Memory', '640K'], ['Disk', human(d.bytes) + ' in ' + d.files + ' files'], ['Display', 'P1 green phosphor']];
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
    const j = { dead: false, plain: '', hint: '', timers: new Set() };
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
      tty.write('sh: ' + (e.message || e) + '\n', 'dim'); status = 2; finishJob(j); return;
    }
    const work = execList(list, j);
    work.catch(() => {});
    try { await Promise.race([work, j.killed]); }
    catch (e){ if (e !== INTR){ tty.write('sh: ' + ((e && e.message) || e) + '\n', 'dim'); status = 1; } }
    finishJob(j);
  }
  function record(line, noHist){
    line = line.trim(); if (!line) return;
    if (!noHist && history[history.length - 1] !== line){ history.push(line); if (history.length > 200) history.shift(); try { localStorage.setItem(HIST_KEY, JSON.stringify(history)); } catch (e){} }
    hIdx = history.length; ran++;
  }
  function finishJob(j){
    if (job !== j) return;
    for (const t of j.timers) clearTimeout(t);
    job = null; openRow = null;
    if (j.hint){ suggestion = j.hint; tty.write('did you mean ', 'dim'); tty.write(j.hint, 'bright'); tty.write('?  press enter\n', 'faint'); j.plain += ' Did you mean ' + j.hint + '?'; }
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
        if (t.length !== 1 || !t[0]){ tty.write('sh: ambiguous redirect\n', 'dim'); bad = true; break; }
        if (r.op === '<'){ inText = FS.read(t[0]); if (inText == null){ tty.write('sh: ' + t[0] + ': No such file or directory\n', 'dim'); bad = true; break; } }
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
        if (!ok){ tty.write('sh: ' + f.path + ': ' + FS.lastError + '\n', 'dim'); st = 1; }
      }
      stdin = sink === tty || sink === NULLSINK || outF ? '' : sink.text;
    }
    return st;
  }
  async function runCmd(argv, ctx, j){
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
        ctx.errSink.write(name + ': ' + ((e && e.message) || e) + '\n', 'dim');
        return 1;
      }
    }
    sfx('error');
    ctx.errSink.write(name + ': command not found\n', 'dim');
    const f = fuzzy(name, cmdItems());
    if (f){ j.hint = [f.item.name, ...argv.slice(1)].join(' '); }
    else if (ctx.errSink === tty){ tty.write('type ', 'faint'); tty.write('help'); tty.write(' for the list\n', 'faint'); }
    return 127;
  }
  function makeIo(ctx, j){
    const io = {
      stdin: ctx.stdin, fs: FS, env: ENV, cwd, cols: COLS, rows: ROWS, tty: ctx.sink.tty, code: null,
      out(t, style){ if (!j.dead && t != null) ctx.sink.write(String(t), style); },
      write(t, style){ io.out(t, style); },
      err(t){ if (!j.dead && t != null) ctx.errSink.write(String(t), 'dim'); },
      rich(o){ if (!j.dead) ctx.sink.rich(o); },
      exit(c){ io.code = (c | 0); },
      sleep: ms => j.sleep(ms),
      runApp(name, argv){
        const a = Array.isArray(argv) ? (argv[0] === name ? argv : [name, ...argv]) : [name];
        if (!M.TERM.apps[name]) return Promise.resolve(127);
        return launchApp(name, a, ctx, j);
      },
    };
    return io;
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
    if (e) st.ctx.errSink.write(st.name + ': ' + ((e && e.message) || e) + '\n', 'dim');
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
  function execute(raw, programmatic){
    rows.push({ k: 't', i: 0, s: [...promptSpans(), [raw, 'n']] }); shown = rows.length; partial = 0;
    openRow = null;
    input = ''; cur = 0; suggestion = ''; tabState = null; sel = -1;
    hIdx = history.length; hDraft = '';
    if (!raw.trim()){ toBottom(); dirty = true; return; }
    runLine(raw, programmatic);
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
    if (cname === 'open') return { kind: 'arg', q: word, from: i, items: OPEN };
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
    if (!ctx.q) return ctx.kind === 'arg' && ctx.items === OPEN ? ctx.items.map(i => i.name) : [];
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
    if (tabState && tabState.after === input){
      const s = tabState; s.i = (s.i + (back ? -1 : 1) + s.list.length) % s.list.length;
      input = s.base; cur = s.cur; accept(s.list[s.i], s.from, false); s.after = input; return;
    }
    const ctx = context(); const list = candidates(ctx);
    if (!list.length){ sfx('beep'); return; }
    if (list.length === 1){ accept(list[0], ctx.from, true); tabState = null; return; }
    if (ctx.kind === 'path'){
      const cp = commonPrefix(list);
      if (cp.length > ctx.q.length){ accept(cp, ctx.from, false); return; }
    }
    const base = input, bcur = cur;
    accept(list[0], ctx.from, false);
    tabState = { base, cur: bcur, list, i: 0, from: ctx.from, after: input };
  }

  /* ---- editing ---- */
  const isWord = c => /[\w.:/-]/.test(c);
  function wordLeft(p){ while (p > 0 && !isWord(input[p - 1])) p--; while (p > 0 && isWord(input[p - 1])) p--; return p; }
  function wordRight(p){ while (p < input.length && !isWord(input[p])) p++; while (p < input.length && isWord(input[p])) p++; return p; }
  function insert(s){
    s = s.replace(/[\r\n\t]+/g, ' ').replace(/[^\x20-\x7e -￿]/g, '');
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
    if (typing()){ revealAll(); if (k === 'Enter' || k === 'Escape' || k === ' ' && !input) return true; }
    if (job){                                   // a command is running: only ctrl+c, ctrl+l and scrolling
      if (ctrl && c === 'c'){ interrupt(); return true; }
      if (ctrl && c === 'l'){ clearScreen(); return true; }
      if (k === 'PageUp'){ scrollBy(ROWS - 2); return true; }
      if (k === 'PageDown'){ scrollBy(-(ROWS - 2)); return true; }
      return k.length === 1 || ['Enter', 'Tab', 'Backspace', 'Escape', ' '].includes(k);
    }
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
  function insertText(str){
    if (booting){ skipBoot(); }
    if (app){ for (const ch of String(str)){ const st = app; if (!st) break; if (appCall('key', { key: ch === '\n' ? 'Enter' : ch, code: '', ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, preventDefault(){} })) st.dirty = true; } return; }
    if (job) return;
    if (typing()) revealAll();
    const parts = String(str).split(/\r?\n/);
    parts.forEach((p, i) => { insert(p); if (i < parts.length - 1 && !job) execute(input); });
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
  const color = st => st === 'f' ? P.faint : st === 'd' ? P.dim : st === 'b' ? P.bright : st === 'a' ? P.accent : P.normal;
  const X = col => PADX + col * cw;
  function text(s, col, top, st, k = 1){
    g.font = font(k); g.fillStyle = color(st); g.fillText(s, X(col), top + fs * k * 0.68);
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
      g.fillText(s, X(col), top + fs * k * 0.68);
      if (link && !selected){ g.fillStyle = P.dim; g.fillRect(X(col), top + fs * k * 0.76, s.length * cw * k, 2); }
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
    return u + (promptVisible() ? 1 : 0);
  }
  const promptVisible = () => !booting && !typing() && !job && !app;

  function drawPrompt(top){
    const gh = ghost();
    const PL = promptLen();
    let off = 0; const room = COLS - PL - 1;
    if (cur > room) off = cur - room;
    const vis = input.slice(off, off + room);
    drawSpans({ i: 0, s: [...promptSpans(), [vis, 'n']] }, top, 999);
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
  function drawGrid(){
    g.font = font();
    for (let y = 0; y < ROWS; y++){
      const top = PADY + y * ch, r = grid[y];
      let x = 0;
      while (x < COLS){
        const s = r[x][1]; let x1 = x, str = '';
        while (x1 < COLS && r[x1][1] === s){ str += r[x1][0]; x1++; }
        if (s.inv){ g.fillStyle = s.fg; g.fillRect(X(x), top, (x1 - x) * cw + 0.5, ch); if (str.trim()){ g.fillStyle = P.bg; g.fillText(str, X(x), top + fs * 0.68); } }
        else if (str.trim()){ g.fillStyle = s.fg; g.fillText(str, X(x), top + fs * 0.68); }
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
      if (isPartial && partial <= 0 && r.k !== 'viz') break;
      if (u + h > first && u < first + ROWS){
        const top = PADY + (u - first) * ch;
        const lim = isPartial ? Math.floor(partial) : 1e9;
        if (r.k === 't') drawSpans(r, top, lim);
        else if (r.k === 'big') drawSpans(r, top, isPartial ? Math.floor(partial / 2) : 1e9, 2);
        else if (r.k === 'head') drawHead(r, top, isPartial ? partial / costOf(r) : 1);
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
    if (promptVisible() && u >= first && u < first + ROWS) drawPrompt(PADY + (u - first) * ch);
    g.restore();
    // scroll position: a thin rail on the right and a quiet note at the bottom
    if (scrollOff > 0){
      const railX = W - 22, railTop = PADY, railH = ROWS * ch;
      g.fillStyle = P.faint; g.fillRect(railX, railTop, 2, railH);
      const th = Math.max(24, railH * ROWS / total), ty = railTop + (railH - th) * (first / Math.max(1, total - ROWS));
      g.fillStyle = P.dim; g.fillRect(railX - 2, ty, 6, th);
      const note = ' ' + scrollOff + ' more below  pgdn ';
      const nx = COLS - note.length, top = PADY + (ROWS - 1) * ch;
      g.fillStyle = P.bg; g.fillRect(X(nx) - 8, top - 4, note.length * cw + 8, ch + 8);
      g.fillStyle = P.dim; g.fillRect(X(nx), top + 2, note.length * cw, ch - 4);
      g.font = font(); g.fillStyle = P.bg; g.fillText(note, X(nx), top + fs * 0.68);
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
    const cells = 32, filled = Math.floor(cells * mp);
    for (let i = 0; i < cells; i++){ g.fillStyle = i < filled ? P.normal : P.faint; g.fillRect(X(10 + i * 0.75), top(2) + 9, cw * 0.75 - 3, ch - 18); }
    const kb = Math.floor(640 * mp / 16) * 16;
    text(String(kb).padStart(3, ' ') + 'K', 36, top(2), mp < 1 ? 'n' : 'b');
    if (mp >= 1) text('OK', 42, top(2), 'b');
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
    text('TERM', 0, top(4), 'd'); text('vt  72 x ' + ROWS, 10, top(4), 'n');
    if (t > 1.6) text('OK', 42, top(4), 'b');
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
    const ax = x + cw * 38, aw = cw * 11, ah = ch * 1.15;
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
    const labels = ['month 1', 'month 2', 'month 3'];
    const base = y + h - ch * 1.25, maxH = h - ch * 1.6, bw = cw * 6, gap = cw * 10;
    g.fillStyle = P.faint; g.fillRect(x, base, gap * 3 - cw * 2, 2);
    labels.forEach((lab, i) => {
      const p = REDUCED ? 1 : ease((age - i * 0.18) / 0.55);
      const bh = maxH * (i + 1) / 3 * p;
      const bx = x + i * gap + cw * 0.5;
      g.fillStyle = P.normal; g.fillRect(bx, base - bh, bw, bh);
      if (p > 0){ g.fillStyle = P.bright; g.fillRect(bx - 2, base - bh - 4, bw + 4, 4); }
      g.font = font(); g.fillStyle = P.dim; g.fillText(lab, bx + (bw - cw * 7) / 2, base + 4 + fs * 0.68);
    });
    // the facts, as a table aligned to the text grid beside the bars
    const sepCol = 2 + 31, keyCol = sepCol + 2, f = J.facts || [];
    const kw = Math.max(0, ...f.map(r => r[0].length)) + 3;
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
    // an empty sheet with a folded corner and a waiting caret
    const pw = cw * 10, ph = h - ch * 0.6, px = x, py = y + ch * 0.3, fold = cw * 2;
    g.strokeStyle = P.dim; g.lineWidth = 2; g.setLineDash([8, 6]);
    g.beginPath(); g.moveTo(px, py); g.lineTo(px + pw - fold, py); g.lineTo(px + pw, py + fold); g.lineTo(px + pw, py + ph); g.lineTo(px, py + ph); g.closePath(); g.stroke();
    g.setLineDash([]); g.beginPath(); g.moveTo(px + pw - fold, py); g.lineTo(px + pw - fold, py + fold); g.lineTo(px + pw, py + fold); g.stroke();
    if (REDUCED || (t % 1.06) < 0.53){ g.fillStyle = P.normal; g.fillRect(px + cw * 1.2, py + ch * 0.9, cw, ch - 6); }
    const col = 2 + 14;
    text('No posts yet.', col, y + ch * 0.9, 'b');
    text('When there are, they will appear here,', col, y + ch * 2.0, 'd');
    text('newest first. Meanwhile:', col, y + ch * 3.0, 'd');
    text('about   eden   j   links', col, y + ch * 4.0, 'n');
  }
  function drawFetch(x, y, w, h, age, t){
    // the KN-84 itself, in outline: a compact all-in-one with its screen lit, and a keyboard
    const ap = REDUCED ? 1 : ease(age / 0.5);
    const bx = x, by = y + ch * 0.2, bw = cw * 18, bh = ch * 7.6;
    g.strokeStyle = P.normal; g.lineWidth = 2;
    g.strokeRect(bx, by, bw, bh * ap);
    if (ap >= 1){
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
      for (let r = 0; r < 3; r++) for (let c2 = 0; c2 < 11; c2++){
        const kx = bx + c2 * cw * 1.6 + (r % 2) * cw * 0.5, kyy = ky + 6 + r * kr;
        g.fillStyle = P.dim; g.fillRect(kx, kyy, cw * 1.2, kr - 5);
      }
      g.fillStyle = P.dim; g.fillRect(bx + cw * 4, ky + 6 + 3 * kr, cw * 10, kr - 5);
    }
    // the card
    const col = 24; const info = fetchInfo();
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
    const on = ((t - blinkT0) % 1.06) < 0.53;
    if (on !== blinkOn){ blinkOn = on; if (promptVisible() || (app && gridCursor)) changed = true; }
    if (!app && animFps > 0 && t - lastAnim >= 1 / animFps - 1e-3) changed = true;
    if (changed){ draw(); lastAnim = t; dirty = false; }
    return changed;
  }

  draw();
  return { canvas, handleKey, insertText, update, run, scroll };
};
})();
