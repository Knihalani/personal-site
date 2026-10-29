/* terminal.js: the CRT terminal, the whole interface of the site.
   MAC.createTerminal({ content, aspect, cols? }) -> { canvas, handleKey, handleTap, insertText, update, run, scroll, ... } (see CONTRACT.md)
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
const GLYPH_COVER = .22;      // the share of a cell a VT323 glyph lights, on average (see lum)
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
const BOOT_END = 0.75;         // seconds (first visit only; later visits go straight to the welcome)
const BOOT_KEY = 'kaiav.term.booted';
const HIST_KEY = 'kaiav.term.history';
const T0 = performance.now();
const LOCK = '\ue000';        // drawn as a vector padlock (ls -l marks built-in files with it)

/* ---- shared with apps.js, extras.js and editor.js ---- */
/* clipboard: synchronous, so it works inside the keydown or tap that asked; falls back to a hidden textarea */
function copyText(t){
  const fallback = () => {
    const prev = document.activeElement;
    try {
      const ta = document.createElement('textarea');
      ta.value = t; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      ta.value = ''; document.body.removeChild(ta);
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
M.TERM.copy = copyText;
/* JSON in localStorage (the filesystem, history, aliases, small preferences); quietly absent when storage is blocked */
const store = M.TERM.store = {
  get(k, d){ try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e){ return d; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch (e){} },
};

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

/* one rich row of spans -> rows no wider than width. Plain text spans ('f', 'd', 'n', no link) break between
   words; chips, links and other styles stay whole. A lone mark (" .") moves with the word before it. */
function fitRow(spans, width){
  if (spans.reduce((n, x) => n + x[0].length, 0) <= width) return [spans];
  const toks = [];
  for (const sp of spans){
    if (sp.length > 2 || !/^[fdn]$/.test(sp[1])){ toks.push({ sp, br: false }); continue; }
    for (const m of sp[0].match(/\s+|\S+\s*/g) || []){
      const prev = toks[toks.length - 1];
      if (prev && prev.of === sp && PUNCT.test(m.trim())) prev.sp[0] += m; else toks.push({ sp: [m, sp[1]], br: true, of: sp });
    }
  }
  const rows = []; let row = [], w = 0;
  const flush = () => { const last = row[row.length - 1]; if (last && last.br) last[0] = last[0].replace(/\s+$/, ''); rows.push(row); row = []; w = 0; };
  const put = (s, st) => { const last = row[row.length - 1]; if (last && last.br && last[1] === st) last[0] += s; else { const p = [s, st]; p.br = true; row.push(p); } w += s.length; };
  for (const t of toks){
    let s = t.sp[0];
    if (row.length && w + s.replace(/\s+$/, '').length > width) flush();
    if (!t.br){ row.push(t.sp); w += s.length; continue; }
    if (!row.length) s = s.replace(/^\s+/, '');
    while (s.length > width){ put(s.slice(0, width), t.sp[1]); flush(); s = s.slice(width); }
    if (s) put(s, t.sp[1]);
  }
  if (row.length) flush();
  return rows.length ? rows.map(r => r.map(x => x.br ? [x[0], x[1]] : x)) : [[]];
}
function wrap(text, width, cont){
  // written line breaks are kept (a blank line stays blank); "- " bullets wrap with a hanging indent.
  // cont, if given, collects one flag per line: true where a line only continues the one before
  const src = String(text), out = [];
  const add = ls => { ls.forEach((l, k) => { out.push(l); if (cont) cont.push(k > 0); }); };
  if (!/\n/.test(src)){ add(wrapLine(src, width, '')); return out; }
  for (const ln of src.split('\n')){
    if (!ln.trim()){ add(['']); continue; }
    const b = /^\s*[-*\u2022]\s+/.exec(ln);
    add(b ? wrapLine(ln.trim(), width, '  ') : wrapLine(ln, width, ''));
  }
  return out.length ? out : [''];
}
function wrapLine(text, width, hang){
  const out = []; let line = '';
  for (const w of String(text).split(/\s+/)){
    if (!w) continue;
    if (!line) line = (out.length ? hang : '') + w;
    else if (line.length + 1 + w.length <= width) line += ' ' + w;
    else {
      const at = line.lastIndexOf(' ');               // a lone mark (" .") never starts a line: the word before it comes too
      if (PUNCT.test(w) && at > (out.length ? hang.length : 0)){ out.push(line.slice(0, at)); line = hang + line.slice(at + 1) + ' ' + w; }
      else { out.push(line); line = hang + w; }
    }
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}
const PUNCT = /^[.,;:!?)\]}'"\u2019%]+$/;
const noLig = s => s.indexOf('f') < 0 ? s : s.replace(/f(?=[il])/g, 'f\u200c');     // VT323 would draw fi / fl as one glyph
const ease = x => x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.pow(1 - x, 3);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length));


/* ---- virtual filesystem: a tree of { c: {} } dirs and { t } files, saved to localStorage ---- */
const HOME = '/home/kaiav';
const FS_KEY = 'kaiav.term.fs.v1';
function createFS(getCwd, onWrite){
  let root = null;
  { const s = store.get(FS_KEY, null); if (s && s.c && typeof s.c === 'object') root = s; }
  const mk = () => ({ c: {}, m: Date.now() });
  const isD = n => !!(n && n.c);
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const badName = n => !n || n === '__proto__' || n === 'constructor' || n === 'prototype';
  if (!root) root = mk();
  (function heal(d){                            // saved data from an older or hand-edited visit: drop anything that is not a dir or a file
    if (!d.c || typeof d.c !== 'object' || Array.isArray(d.c)) d.c = {};
    for (const k of Object.keys(d.c)){
      const n = d.c[k];
      if (n && typeof n === 'object' && n.c && typeof n.c === 'object' && !Array.isArray(n.c)) heal(n);
      else if (!n || typeof n !== 'object' || typeof n.t !== 'string' || badName(k)) delete d.c[k];
    }
  })(root);
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
  const persist = () => store.set(FS_KEY, root);
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
  function fail(m){ api.lastError = m; return false; }
  function put(abs, text, app){
    const { dir, name } = parent(abs);
    if (!name) return fail('is a directory');
    if (badName(name)) return fail('invalid name');
    if (!isD(dir)) return fail('no such file or directory');
    const ex = own(dir.c, name) ? dir.c[name] : null;
    if (isD(ex)) return fail('is a directory');
    if (lockedNode(ex)) return readOnly(abs);
    const t = app && ex ? ex.t + text : text;
    if (t.length > 262144) return fail('file too large');
    dir.c[name] = { t, m: Date.now() }; dir.m = Date.now();
    changed(); return true;
  }
  function mkdir(abs, parents){
    const s = segs(abs); let n = root;
    for (let i = 0; i < s.length; i++){
      const last = i === s.length - 1;
      if (badName(s[i])) return fail('invalid name');
      if (own(n.c, s[i])){
        const x = n.c[s[i]];
        if (!isD(x)) return fail(last ? 'file exists' : 'not a directory');
        if (last && !parents) return fail('file exists');
        n = x; continue;
      }
      if (!last && !parents) return fail('no such file or directory');
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
      const a = R(p); if (a === '/') return fail('permission denied');
      const n = get(a); if (!n) return fail('no such file or directory');
      if (isD(n) && Object.keys(n.c).length && !recursive) return fail('directory not empty');
      const lk = lockedIn(a); if (lk) return readOnly(lk);
      const { dir, name } = parent(a); delete dir.c[name]; dir.m = Date.now(); changed(); return true;
    },
    mv(a, b){
      const A = R(a); let B = R(b); const n = get(A);
      if (!n) return fail('no such file or directory');
      if (A === '/') return fail('permission denied');
      if (isD(get(B))) B = join(B, base(A));
      if (B === A) return true;
      if (B.startsWith(A + '/')) return fail('cannot move a directory into itself');
      const lk = lockedIn(A) || (lockedNode(get(B)) ? B : null); if (lk) return readOnly(lk);
      const { dir, name } = parent(B);
      if (!isD(dir)) return fail('no such file or directory');
      if (badName(name)) return fail('invalid name');
      if (own(dir.c, name) && isD(dir.c[name])) return fail('is a directory');
      if (own(dir.c, name) && isD(n)) return fail('cannot overwrite a file with a directory');
      const from = parent(A); delete from.dir.c[from.name];
      delete n.g; dir.c[name] = n; dir.m = from.dir.m = Date.now(); changed(); return true;
    },
    cp(a, b){
      const A = R(a); let B = R(b); const n = get(A);
      if (!n) return fail('no such file or directory');
      if (isD(get(B))) B = join(B, base(A));
      if (B === A || B.startsWith(A + '/')) return fail('cannot copy onto itself');
      const { dir, name } = parent(B);
      if (!isD(dir)) return fail('no such file or directory');
      if (badName(name)) return fail('invalid name');
      if (own(dir.c, name) && isD(dir.c[name]) !== isD(n)) return fail(isD(n) ? 'not a directory' : 'is a directory');
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
      if (!isD(get(HOME))){ const p = get('/home'); if (p && !isD(p)) delete root.c.home; mkdir(HOME, true); }
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

M.createTerminal = function createTerminal(opts){
  const C = (opts && opts.content) || M.CONTENT || {};
  if (opts && opts.cols >= 32) COLS = opts.cols | 0;
  let aspect = opts && opts.aspect > 0.3 && opts.aspect < 3 ? opts.aspect : 4 / 3;
  const W = WIDTH; let H = Math.round(WIDTH / aspect);   // (resize() changes H, the grid and the font size)
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d', { alpha: false });
  /* VT323 has an fi/fl ligature that would eat a grid cell: switch shaping extras off where the canvas allows,
     and (see noLig) break the pair with a zero-width non-joiner everywhere else */
  const noShaping = () => { try { g.fontKerning = 'none'; g.textRendering = 'optimizeSpeed'; if ('fontVariantLigatures' in g) g.fontVariantLigatures = 'none'; } catch (e){} };
  noShaping();
  const fillT = (t, x, y) => g.fillText(noLig(t), x, y);
  /* how bright the screen is, tallied while drawing (the room's glow follows it; reading the pixels back would stall the GPU):
     each fill adds its area times its colour's luminance, text counts its cells at the share of a cell a glyph lights */
  const LUM = {}, lumOf = c => LUM[c] != null ? LUM[c] : (LUM[c] = (m => m ? (.299 * parseInt(m[1], 16) + .587 * parseInt(m[2], 16) + .114 * parseInt(m[3], 16)) / 255 : .5)(/^#(..)(..)(..)/.exec(c)));
  let lumAcc = 0;
  { const fr = g.fillRect.bind(g), ft = g.fillText.bind(g);
    g.fillRect = (x, y, w, h) => { lumAcc += Math.abs(w * h) * lumOf(g.fillStyle) * g.globalAlpha; fr(x, y, w, h); };
    g.fillText = (t, x, y) => { lumAcc += t.length * cw * ch * GLYPH_COVER * lumOf(g.fillStyle) * g.globalAlpha; ft(t, x, y); }; }
  const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const P = PALETTE;
  const sfx = name => { try { if (M.sound && M.sound.event) M.sound.event(name); } catch (e){} };
  const toast = (ok, text) => { try { if (ok && typeof M.toast === 'function') M.toast('copied', text); } catch (e){} };   // a page-level note (phones), when main.js offers one
  let lastDisk = 0;
  const diskSound = () => { const t = performance.now(); if (t - lastDisk > 400){ lastDisk = t; sfx('disk'); } };

  /* ---- grid ---- */
  const PADX = 52; let cw = (W - 2 * PADX) / COLS;
  let advance = 0.4, fs = cw / advance;                 // VT323 advance is 0.4em; re-measured once loaded
  let ch = Math.round(fs * LINE);
  let ROWS = Math.floor((H - 64) / ch);
  let PADY = Math.round((H - ROWS * ch) / 2);
  const font = (k = 1) => (fs * k).toFixed(2) + 'px ' + FONT;
  /* g.font is only assigned when it changes: the strings are built once per size (a font set is parsed every time) */
  let fontStr = {}, curFont = '';
  const setFont = (k = 1) => { const f = fontStr[k] || (fontStr[k] = font(k)); if (f !== curFont){ g.font = f; curFont = f; } };
  const measureFont = () => { g.font = '100px ' + FONT; curFont = ''; const r = g.measureText('M').width / 100; if (r > 0.2 && r < 0.8){ advance = r; fs = cw / r; fontStr = {}; } dirty = true; };
  if (document.fonts && document.fonts.load){
    document.fonts.load('40px VT323').then(() => measureFont(), () => {});
    if (document.fonts.ready) document.fonts.ready.then(() => measureFont(), () => {});
  }

  /* ---- state ---- */
  let rows = [];            // scrollback: { k:'t'|'big'|'head'|'viz', ... }
  let shown = 0, partial = 0, carry = 0;   // typing-out progress
  let input = '', cur = 0;
  let scrollOff = 0, wheelAcc = 0;
  let booting = !store.get(BOOT_KEY, 0), bootT = 0, bootLastDraw = -1;
  let now = 0, blinkT0 = 0, blinkOn = true, dirty = true;
  let animFps = 0, lastAnim = 0;
  let rate = RATE, rateRows = -1, rateShown = 0;   // the typing-out speed for what is pending (see update)
  let suggestion = '';                 // "did you mean" target, shown as ghost on an empty prompt
  let tabState = null;
  let ahead = '';           // keys typed while a command runs, waiting for the next prompt ('\n' = a queued Enter)
  let okRuns = 0;           // commands that worked this visit
  let nudgeOff = false, lastNudge = false, idleT0 = -1;   // the first-visit nudge under the prompt: after ~8s idle, until something works
  let runQueued = false;    // a whole line came in with the type-ahead: run it on the next frame
  let rs = null;            // ctrl+r search: { q, i, draft, dcur }
  let history = store.get(HIST_KEY, []);
  history = Array.isArray(history) ? history.filter(s => typeof s === 'string').slice(-200) : [];
  let hIdx = history.length, hDraft = '', hPrefix = '';
  const fresh = !history.length;     // a first-time visitor (nothing typed here before)
  let ran = 0;
  let job = null;                      // the running command line, if any
  let app = null;                      // the full-screen app, if any
  let openRow = null;                  // the output row still being written to
  let status = 0;
  /* pages: a chip (or a deep link) opens its command as a fresh page at the top of the tube, under a back
     chip; the scrollback stays above it. back re-runs the page before; '' is the welcome. */
  const PAGES_MAX = 20;
  let pages = [];           // the commands of the pages before this one, oldest first
  let page = '';            // the page on screen ('' = the welcome)
  let pageRow = null;       // the row the page starts at: laid out at the top of the tube while it fits
  let pageKeys = true;      // nothing typed since the page opened: esc / backspace on the empty prompt go back
  let pendingNav = null;    // 'back' | 'home', typed: done once the command line finishes
  let eatBlank = false;     // a page's own leading blank line gives way to the back chip
  let pinned = false;       // a page taller than the tube opens at its top, until a key or a scroll moves the view

  /* ---- shell state ---- */
  const FS = createFS(() => cwd, diskSound);
  let cwd = HOME;
  const ENV = { HOME, USER: 'kaiav', LOGNAME: 'kaiav', HOSTNAME: 'kn84', SHELL: '/bin/sh', TERM: 'vt320', PATH: '/bin:/usr/bin:/usr/games',
    PWD: HOME, LANG: 'en_US.UTF-8', COLUMNS: String(COLS), LINES: String(ROWS) };
  const ALIAS_KEY = 'kaiav.term.alias';
  let ALIASES = { ll: 'ls -l', la: 'ls -a', l: 'ls', dir: 'ls', cls: 'clear', less: 'cat', more: 'cat', quit: 'exit', logout: 'exit', '?': 'help' };
  { const a = store.get(ALIAS_KEY, null); if (a && typeof a === 'object') ALIASES = Object.assign(Object.create(null), a); }
  if (ALIASES.home === 'welcome') delete ALIASES.home;     // (an older default, saved with the aliases: home is a command now)
  const saveAliases = () => store.set(ALIAS_KEY, ALIASES);
  const hasAlias = n => Object.prototype.hasOwnProperty.call(ALIASES, n);
  function setCwd(p){ ENV.OLDPWD = cwd; cwd = p; ENV.PWD = p; }
  const tildify = p => p === HOME ? '~' : p.startsWith(HOME + '/') ? '~' + p.slice(HOME.length) : p;

  /* ---- output builder (rich rows) ---- */
  function out(){
    const r = [], o = {
      rows: r,
      line(...spans){ return o.at(2, ...spans); },
      at(i, ...spans){ fitRow(spans.map(x => typeof x === 'string' ? [x, 'n'] : x), COLS - i).forEach((s, k) => r.push(k ? { k: 't', i, s, c: 1 } : { k: 't', i, s })); return o; },
      blank(){ r.push({ k: 't', i: 0, s: [] }); return o; },
      big(text, st = 'b'){ r.push({ k: 'big', i: 2, s: [[text, st]] }); return o; },
      head(label, note){ r.push({ k: 'head', i: 2, label, note: note || '' }); return o; },
      para(text, st = 'n', width = COLS - 6, i = 2){
        const cont = [];               // a wrapped line reads on from the one before in the screen-reader log
        wrap(text, width, cont).forEach((l, k) => { o.at(i, [l, st]); if (cont[k]) r[r.length - 1].c = 1; });
        return o;
      },
      /* a square bitmap (true = dark), dark on a lit field with a quiet zone of q modules: QR codes.
         Drawn as vectors so a module is square whatever the cell shape. */
      /* a drawing h rows tall: draw(x, y, w, h, age, t); live(age) -> fps while it moves (none under reduced motion) */
      viz(h, draw, live){ r.push({ k: 'viz', h, draw, live: live || null, t0: -1 }); return o; },
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
      /* a boxed panel: title in the top border, label/value rows, rows that open or copy (click, tap, or the
         arrows then enter), and a footer line while it can still be chosen from */
      card(spec){ const c = makeCard(spec); r.push(c); o.lastCard = c; return o; },
      /* groups of spans laid out left to right with a gap, wrapping at the grid width */
      flow(groups, gap = '  ', i = 2){
        /* as few lines as the width allows, then evened out, so no word is left alone on the last one */
        const gws = groups.map(gr => gr.reduce((a, x) => a + x[0].length, 0));
        const lay = max => { const ls = []; let cur = null, w = 0; gws.forEach((gw, k) => { if (cur && w + gap.length + gw > max){ ls.push(cur); cur = null; } if (!cur){ cur = []; w = 0; } else w += gap.length; cur.push(k); w += gw; }); if (cur) ls.push(cur); return ls; };
        let best = lay(COLS - i);
        for (let max = COLS - i - 1; best.length > 1 && max > 0; max--){ const t = lay(max); if (t.length > best.length) break; best = t; }
        best.forEach((ks, l) => { o.at(i, ...ks.flatMap((k, n) => n ? [[gap, 'f'], ...groups[k]] : groups[k])); if (l) r[r.length - 1].c = 1; });
        return o;
      },
      link(label, url, i = 2, labelW = 0, shown){
        const sp = []; if (label) sp.push([pad(label, labelW), 'd']);
        sp.push([shown || url, 'n', { url }]); r.push({ k: 't', i, s: sp }); return o;
      },
    };
    return o;
  }
  const heightOf = r => r.k === 'big' ? 2 : r.k === 'card' ? r.body + (r.foot ? 3 : 2) : r.k === 'viz' ? r.h : 1;
  const lenOf = r => r.k === 't' ? r.s.reduce((n, s) => n + s[0].length, 0) + (r.i || 0) : r.k === 'big' ? r.s[0][0].length : r.k === 'head' ? r.label.length * 2 : 0;
  const costOf = r => r.k === 'viz' || r.k === 'card' ? 40 : r.k === 'big' ? lenOf(r) * 2 + 4 : r.k === 'head' ? 30 : Math.max(3, lenOf(r) - (r.i || 0));
  const plainOf = r => r.k === 't' || r.k === 'big' ? r.s.map(s => s[1] === 'f' ? ' ' : s[0]).join('').replace(/\s+/g, ' ').trim()
    : r.k === 'card' ? r.title + '. ' + r.items.map(it => (it.ai >= 0 ? (it.ai + 1) + ', ' : '') + it.label + ': ' + (it.full || it.value)).join('. ') : '';
  /* rows as sentences for the screen-reader log: a wrapped continuation reads on with a space, a new row after a period */
  const plainRows = rows => { let t = ''; for (const r of rows){ const p = plainOf(r); if (!p) continue; t += !t ? p : (r.c || /[.!?:,]$/.test(t) ? ' ' : '. ') + p; } return t; };
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
    return { k: 'card', spec, title: spec.title, note, items, acts, lw, stacked, body: y, sel: -1, verb: spec.verb || 'open', foot: null };
  }

  function pushRow(r){ openRow = null; rows.push(r); dirty = true; }
  function emit(o, mirrorText){            // rich rows straight to the scrollback (outside a job)
    for (const r of o.rows) pushRow(r);
    trim();
    mirror(mirrorText || plainRows(o.rows));
    toBottom(); dirty = true;
    if (REDUCED) revealAll();
  }
  function trim(){
    let total = 0; for (const r of rows) total += heightOf(r);
    let drop = 0; while (total > 1200 && drop < rows.length - 1){ total -= heightOf(rows[drop]); drop++; }
    if (drop){ rows.splice(0, drop); shown = Math.max(0, shown - drop); if (shown === 0) partial = 0; }
  }
  /* the screen-reader mirror (#mirror, a live log): each command and its output are appended as short
     paragraphs, long output in sentence-sized chunks, and only the last few dozen are kept */
  function mirror(text, cmd){
    const m = document.getElementById('mirror'); if (!m) return;
    const add = t => { const p = document.createElement('p'); p.className = 'mirror-out'; p.textContent = t; m.appendChild(p); };
    if (cmd) add('command: ' + cmd);
    text = String(text || '').replace(/\ue000/g, '').replace(/\s+/g, ' ').replace(/([^.\s])\.\.(?=\s|$)/g, '$1.').trim();   // ("x.." from joins; "..." and a bare ".." stay)
    while (text){
      let cut = text.length;
      if (cut > 320){ cut = text.lastIndexOf('. ', 320); if (cut < 120) cut = text.lastIndexOf(' ', 320); if (cut < 120) cut = 320; else cut++; }
      add(text.slice(0, cut).trim()); text = text.slice(cut).trim();
    }
    const old = m.querySelectorAll('.mirror-out'); for (let i = 0; i < old.length - 60; i++) old[i].remove();
  }
  const typing = () => shown < rows.length;
  function revealAll(){ const t = now; for (let i = shown; i < rows.length; i++) if (rows[i].k === 'viz' && rows[i].t0 < 0) rows[i].t0 = t - (REDUCED ? 99 : 0); shown = rows.length; partial = 0; carry = 0; dirty = true; }
  function toBottom(){ scrollOff = 0; wheelAcc = 0; pinned = false; }

  /* ---- streams: the tty writes styled spans into rows; buffers collect text for pipes and files ---- */
  const STY = { normal: 'n', dim: 'd', bright: 'b', faint: 'f', accent: 'a', inverse: 'i', n: 'n', d: 'd', b: 'b', f: 'f', a: 'a', i: 'i' };
  const clean = s => String(s == null ? '' : s).replace(/\t/g, '    ').replace(/\r/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
  const rowLen = r => r.s.reduce((n, s) => n + s[0].length, 0);
  function appendSpan(seg, st){
    let cont = 0;                              // the row this wraps onto continues the last: 1 after a dropped space, 2 exactly (for resize)
    while (seg){
      if (!openRow){ openRow = cont ? { k: 't', i: 0, s: [], c: cont } : { k: 't', i: 0, s: [] }; rows.push(openRow); }
      const room = COLS - rowLen(openRow);
      let piece = seg, rest = '';
      if (seg.length > room){
        /* word wrap: break at the last space that fits; a word that does not fit moves down whole (with the
           start of it an earlier span wrote, e.g. a grep match), and a lone "." takes the word before it */
        const used = rowLen(openRow);
        let cut = seg.lastIndexOf(' ', room);
        if (cut >= 0 && PUNCT.test(seg.slice(cut + 1).split(' ')[0]) && cut + 1 < seg.length) cut = seg.lastIndexOf(' ', cut - 1);
        if (cut > 0 || (cut === 0 && used)){ piece = seg.slice(0, cut); rest = seg.slice(cut + 1); cont = 1; }
        else {
          const word = /^\S*/.exec(seg)[0], moved = used ? pullWord(openRow) : null;
          const mw = moved ? moved.reduce((n, x) => n + x[0].length, 0) : 0;
          if (moved && mw + word.length <= COLS && (mw || used)){ openRow = { k: 't', i: 0, s: moved, c: 2 }; rows.push(openRow); continue; }
          if (moved) openRow.s.push(...moved);
          piece = seg.slice(0, Math.max(0, room)); rest = seg.slice(Math.max(0, room)); cont = 2;
        }
      }
      const last = openRow.s[openRow.s.length - 1];
      if (!piece){ /* nothing on this row from this span */ }
      else if (last && last[1] === st && !last[2]) last[0] += piece; else openRow.s.push([piece, st]);
      if (rest) openRow = null;
      seg = rest;
    }
  }
  /* take the word at the end of a row off it (spans after its last space); null if the row has no space */
  function pullWord(row){
    const moved = [];
    for (let k = row.s.length - 1; k >= 0; k--){
      const sp = row.s[k];
      if (sp[2]) break;
      const at = sp[0].lastIndexOf(' ');
      if (at < 0){ moved.unshift(row.s.pop()); continue; }
      if (at < sp[0].length - 1){ moved.unshift([sp[0].slice(at + 1), sp[1]]); sp[0] = sp[0].slice(0, at + 1); }
      return moved;
    }
    row.s.push(...moved); return null;
  }
  const tty = {
    tty: true,
    write(t, style){
      t = clean(t); if (!t) return;
      eatBlank = false;
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
      let k0 = 0;
      if (eatBlank){ eatBlank = false; const r0 = o.rows[0]; if (r0 && r0.k === 't' && !r0.s.length) k0 = 1; }
      for (let k = k0; k < o.rows.length; k++) rows.push(o.rows[k]);
      if (job) job.plain += plainRows(o.rows) + ' ';
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
  const L = C.links || {}, J = C.j || {}, E = C.eden || {}, A = C.about || {};
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
    { name: 'linkedin', url: URLS.linkedin, label: bare(URLS.linkedin), title: 'LinkedIn', short: C.name || 'profile' },
    { name: 'x', url: URLS.x, alias: ['twitter'], label: bare(URLS.x), title: 'X', short: '@' + bare(URLS.x).replace(/^(x|twitter)\.com\//, '') },
    { name: 'gh', url: URLS.gh, alias: ['github', 'repo', 'source'], label: bare(URLS.gh), title: 'GitHub', short: bare(URLS.gh).replace(/^github\.com\//, '') },
  ];
  const LINKLIST = () => OPEN.filter(o => o.name !== 'j');
  const wrapT = (t, w = 50) => wrap(t, w).join('\n');
  // reader.js owns the post list (published only, newest first) and the slugs, so both always agree
  const R = M.reader || { posts: () => [], slugOf: p => String(p.slug || p.id || '') };
  const posts = () => R.posts(), slugOf = p => R.slugOf(p);
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
    writing: () => posts().length ? posts().map(p => [p.date, p.title, p.summary && wrapT(p.summary), p.html ? 'read ' + slugOf(p) : p.url].filter(Boolean).join('\n')).join('\n\n') + '\n' : 'nothing published yet\n',
  };
  const README = [
    '# README', '',
    'welcome to the KN-84, the small computer on ' + (C.name ? C.name + "'s" : 'this') + ' desk.',
    'it runs a little shell. everything here is safe to poke at.', '',
    '## things to try', '',
    '  about       who ' + (C.name ? C.name.split(' ')[0] : 'Kaiav') + ' is',
    '  eden        ' + (E.line || E.title || 'Eden'),
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
    '  clock       the time, in big digits',
    '  edit        write a note',
    '  typing      a typing test',
    '  tetris      a game (snake too)',
    '  neofetch    about this machine', '',
    '## the shell', '',
    '  help        what you can type',
    '  man grep    the manual for grep',
    '  cat README.md | grep try',
    '  echo hello > notes/hello.txt',
    '  ls -l ~/notes', '',
    'files you make stay in this browser.',
    'tab completes, \u2191\u2193 recall history,',
    'ctrl+c stops a command.', '',
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
  /* the landing: every load opens on the demo (DEMO, below), with one line under it. The first command (typed,
     clicked or a deep link) clears it for good this visit; home and back then show the plain welcome. */
  let landing = null;
  function landingRows(){
    const o = out();
    o.viz(Math.max(4, ROWS - 2), (x, y, w, h, age, t) => DEMO.draw(x, y, w, h, age, t), DEMO.live);
    if (TAP) o.at(2, ['tap here or type help to get started', 'd', { cmd: 'help' }]);
    else o.at(2, ['type ', 'f'], chip('help', 'b'), [' and press enter to get started', 'f']);
    landing = { viz: o.rows[0], note: o.rows[1] };
    return o;
  }
  function dismissLanding(){
    if (!landing) return;
    const l = landing; landing = null;
    rows = rows.filter(r => r !== l.viz && r !== l.note); shown = Math.min(shown, rows.length); partial = 0;
    if (pageRow === l.viz) pageRow = null;
    dirty = true;
  }
  function welcome(o){
    return o.blank().big(C.name || '', 'b').line([A.role || [E.role && 'Founder of ' + E.title, J.title].filter(Boolean).join(' · '), 'n']).blank()
      .line([TAP ? 'tap a word below, or type one' : 'type a word and press enter, or click one', 'd'])
      .flow(PAGE_WORDS.map(w => [chip(w, 'b')]), '  ')
      .blank();
  }
  const PAGE_WORDS = ['about', 'j', 'eden', 'writing', 'contact', 'links'];   // the welcome's words: each opens as a page, clicked or typed
  /* a command chip: a word that, clicked or tapped, types and runs itself. A faint underline marks it. */
  const TAP = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  function chip(w, st = 'n', cmd){ return [w, st, { cmd: cmd || w }]; }
  function chips(ws, st = 'n'){ const r = []; ws.forEach((w, k) => { if (k) r.push(['  ', 'f']); r.push(chip(w, st)); }); return r; }
  const DOCS = {
    about(o){
      o.blank().head('about', 'about.txt').blank().big(C.name || '').line([A.role || '', 'n']).blank();
      for (const p of A.body || []) o.para(p, /^\[.*\]$/.test(p) ? 'd' : 'n');
      o.blank().line(['see also  ', 'f'], ...chips(['contact', 'j', 'eden', 'links'], 'n')).blank();
      return o;
    },
    eden(o){
      o.blank().big(E.title || 'Eden').line([E.role || '', 'd']).blank();
      if (E.line) o.para(E.line, 'b').blank();
      if (E.body) o.para(E.body, 'n').blank();
      return o.line(['see also  ', 'f'], ...chips(['contact', 'j', 'about'], 'n')).blank();
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
      if (!ps.length) return o.at(2, ['nothing published yet', 'n']).blank().line(['see also  ', 'f'], ...chips(['about', 'j', 'eden', 'contact'], 'n')).blank();
      /* one row per post: date, title; narrow screens stack them and add the summary. A post with html opens
         the reader; one with only a url opens the link */
      o.card({ title: 'POSTS', note: ps.length + (ps.length === 1 ? ' post' : ' posts'), verb: 'read', items: ps.map(p => ({
        label: p.date || '', value: p.title || 'Untitled', post: p.html ? slugOf(p) : null, url: p.html ? null : p.url || null,
        full: p.title || '', sub: p.summary || '', hint: p.html ? 'read' : p.url ? 'open' : '' })) }).blank()
        .line(['see also  ', 'f'], ...chips(['about', 'j', 'eden', 'contact'], 'n')).blank();
      return o;
    },
    links(o){
      o.blank().card({ title: 'LINKS', note: 'links.txt', items: LINKLIST().map(t => ({ label: t.title, value: t.short, full: t.url, url: t.url, hint: 'open' })) })
        .blank().at(2, ['also  ', 'f'], ...chips(['contact', 'j'], 'n'), ['  ', 'f'], ['open <name>', 'n']).blank();
      return o;
    },
  };
  /* must run inside the keydown that asked for it, or popup blockers step in */
  function openTarget(url){
    try {
      if (/^mailto:/i.test(url)){ const a = url.replace(/^mailto:/i, '').split('?')[0], ok = copyText(a); toast(ok, a); return ok; }
      const w = window.open(url, '_blank');
      if (w){ try { w.opener = null; } catch (e){} return true; }
    } catch (e){}
    return false;
  }
  const uptimeStr = () => {
    const s = Math.floor((performance.now() - T0) / 1000);
    const hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = s % 60;
    return (hh ? hh + 'h ' : '') + (hh || mm ? mm + 'm ' : '') + ss + 's';
  };
  const fmtDate = ms => { const d = new Date(ms || Date.now()); return MONTHS[d.getMonth()].slice(0, 3) + ' ' + String(d.getDate()).padStart(2, ' ') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const human = n => n < 1024 ? String(n) : (n / 1024).toFixed(n < 10240 ? 1 : 0) + 'K';
  /* "rm: x: No such file", or for a built-in file just "rm: read-only: ~/README.md is a built-in file" */
  const fsErr = (name, p) => name + ': ' + (/^read-only:/.test(FS.lastError) ? '' : p + ': ') + FS.lastError + '\n';
  /* read named files (or stdin) for a text utility */
  function sources(io, files, name){
    if (!files.length && !io.piped){ io.err('usage: ' + ((M.TERM.cmds[name] || {}).usage || name + ' file') + '\n'); io.exit(2); return []; }   // nothing to read: say how
    if (!files.length) return [{ name: '(standard input)', text: io.stdin || '' }];
    // "cat my notes.txt" for a file called "my notes.txt": read it, as the visitor clearly meant
    if (files.length > 1 && files.some(f => !FS.exists(f)) && FS.read(files.join(' ')) != null) files = [files.join(' ')];
    const r = [];
    for (const f of files){
      if (f === '-'){ r.push({ name: '(standard input)', text: io.stdin || '' }); continue; }
      const t = FS.read(f);
      if (t == null){ io.err(name + ': ' + f + ': ' + (FS.isDir(f) ? 'is a directory' : 'no such file or directory') + '\n'); if (!FS.exists(f)) hintPath(name, f); io.exit(1); continue; }
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
  const doc = name => ({ g: 'read', desc: name === 'about' ? 'who ' + ((C.name || 'Kaiav').split(' ')[0]) + ' is' : name === 'eden' ? 'Eden. ' + (E.line || '') : name === 'j' ? J.title || 'J' : name === 'writing' ? 'posts' : 'LinkedIn, X and GitHub',
    usage: name, run(argv, io){ if (io.tty){ const o = DOCS[name](out()); io.rich(o); if (o.lastCard && o.lastCard.acts.length) return io.pick(o.lastCard); } else io.write(TEXT[name]()); } });
  for (const n of ['about', 'j', 'eden', 'writing', 'links']) def(n, doc(n));
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
    if (!url){ io.err('open: no link called ' + q + '  (try: ' + OPEN.map(x => x.name).join(', ') + ' or a url)\n'); return 1; }
    if (!io.tty){ io.write(url + '\n'); return; }
    if (/^mailto:/i.test(url)){                         // addresses are copied, never mailto'd
      const addr = url.replace(/^mailto:/i, '').split('?')[0];
      const ok = copyText(addr); sfx('beep'); toast(ok, addr);
      io.rich(out().at(0, [ok ? 'copied ' : 'copy this: ', 'd'], [addr, 'b'])); return;
    }
    const w = openTarget(url);
    const o = out(); o.at(0, ['opening ', 'd'], [label, 'b', { url }]); if (!w) o.at(2, ['if nothing opened, click the address above', 'f']); io.rich(o);
  } });
  def('read', { g: 'read', desc: 'read a post', usage: 'read <slug | n>', ex: ['read 1', 'open post <slug>'], run(argv, io){
    const q = argv.slice(1).join(' ').trim();
    if (!q) return B.writing.run(['writing'], io);
    const p = findPost(q);
    if (!p){ io.err('read: ' + (posts().length ? 'no post called ' + q + '  (try: writing)' : 'nothing published yet') + '\n'); return 1; }
    if (!io.tty){ io.write(TEXT.writing().split('\n\n')[posts().indexOf(p)] + '\n'); return; }
    if (!p.html && p.url){
      const w = openTarget(p.url);
      const o = out(); o.at(0, ['opening ', 'd'], [p.title || bare(p.url), 'b', { url: p.url }]); if (!w) o.at(2, ['if nothing opened, click the address above', 'f']); io.rich(o); return;
    }
    const ok = !!(M.reader && M.reader.open(slugOf(p)));
    io.rich(out().at(0, [ok ? 'reading ' : 'the reader is not available: ', 'd'], [p.title || slugOf(p), 'b']).at(2, [ok ? (TAP ? 'tap \u2190 back' : 'esc comes back') : '', 'f']));
    return ok ? 0 : 1;
  } });
  /* one link, printed, then a one-key prompt to open it */
  const linkCmd = (name, desc) => ({ g: 'read', desc, usage: name, run(argv, io){
    const t = OPEN.find(x => x.name === name);
    if (!io.tty){ io.write(t.url + '\n'); return; }
    const value = name === 'gh' ? t.label : t.short;
    const o = out().blank().card({ title: t.title.toUpperCase(), items: [{ label: name === 'gh' ? 'repo' : 'profile', value, full: t.url, url: t.url, hint: 'open' }] }).blank();
    io.rich(o); return io.pick(o.lastCard);
  } });
  def('gh', linkCmd('gh', 'the source of this site, on GitHub'));
  def('linkedin', linkCmd('linkedin', 'LinkedIn'));
  def('x', linkCmd('x', 'X (Twitter)'));
  def('contact', { g: 'read', desc: 'email addresses', usage: 'contact', run(argv, io){
    if (!io.tty){ io.write(EMAILS.map(e => pad(e.label, 20) + e.email).join('\n') + '\n'); return; }
    const o = out().blank().card({ title: 'CONTACT', note: 'email', verb: 'copy', items: EMAILS.map(e => ({ label: e.label, value: e.email, copy: e.email, hint: 'copy' })) }).blank()
      .line(['see also  ', 'f'], ...chips(['about', 'links', 'j'], 'n')).blank();
    io.rich(o); return io.pick(o.lastCard);
  } });
  def('back', { g: 'read', desc: 'the page before this one', usage: 'back',
    more: 'clears the screen and shows the page you were on before, fresh. pages are what a click or a tap opens, and the words on the welcome (about, j, eden, writing, contact, links) or help, typed alone; the last 20 are kept. with nothing before, the welcome. a click on the back arrow at the top of a page does the same, and so do esc or backspace on an empty line. what scrolled away is still up above.',
    ex: ['back', 'home'], run(argv, io){ if (io.tty) pendingNav = 'back'; } });
  def('home', { g: 'read', desc: 'the welcome screen, cleanly', usage: 'home',
    more: 'clears the screen and shows the welcome, and forgets the pages behind it (back starts over from there). what scrolled away is still up above.',
    ex: ['home', 'back'], run(argv, io){ if (io.tty) pendingNav = 'home'; else io.write((C.name || '') + '\n'); } });
  def('welcome', { g: 'read', hidden: true, desc: 'the first screen', usage: 'welcome', run(argv, io){ if (io.tty) io.rich(welcome(out())); else io.write(C.name + '\n'); } });

  /* files */
  def('ls', { g: 'files', desc: 'list a directory', usage: 'ls [-l] [-a] [path...]', opts: [['-l', 'long form: type, size, date'], ['-a', 'include . and .. and hidden files']], ex: ['ls -la', 'ls ~/notes'], run(argv, io){
    const { o, a } = getopts(argv.slice(1));
    const targets = a.length ? a : ['.'];
    const files = [], dirs = [];
    for (const t of targets){ const s = FS.stat(t); if (!s){ io.err('ls: ' + t + ': no such file or directory\n'); hintPath('ls', t); io.exit(2); continue; } (s.dir ? dirs : files).push({ t, s }); }
    const show = ents => {
      if (!ents.length) return;
      if (o.l){
        const w = Math.max(...ents.map(e => human(e.size).length));
        for (const e of ents){
          io.write((e.dir ? 'drwxr-xr-x' : e.locked ? '-r--r--r--' : '-rw-r--r--') + (COLS >= 50 || !io.tty ? '  kaiav  ' : '  '), 'faint');
          io.write((e.dir ? '-' : human(e.size)).padStart(w) + '  ' + (COLS >= 50 || !io.tty ? fmtDate(e.mtime) : fmtDate(e.mtime).slice(0, 6)) + '  ', 'dim');
          io.write(lsName(e.name) + (e.dir && e.name[0] !== '.' ? '/' : ''), e.dir ? 'bright' : 'normal');
          io.write(e.locked && io.tty ? ' ' + LOCK + '\n' : '\n', 'faint');
        }
        return;
      }
      if (!io.tty){ io.write(ents.map(e => e.name).join('\n') + '\n'); return; }
      const names = ents.map(e => lsName(e.name) + (e.dir && e.name !== '.' && e.name !== '..' ? '/' : ''));
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
  const lsName = n => /[\s'"\\|&;<>$`#]/.test(n) ? "'" + n.replace(/'/g, "'\\''") + "'" : n;   // ls quotes names a shell would split, as GNU ls does
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
    if (argv.length < 2 || argv[1][0] === '-'){ io.err('usage: touch file...\n'); return 1; }
    for (const f of argv.slice(1)) if (!FS.touch(f)){ io.err(fsErr('touch', f)); io.exit(1); }
  } });
  def('rm', { g: 'files', desc: 'remove files', usage: 'rm [-r] [-f] path...', opts: [['-r', 'remove directories and what is in them'], ['-f', 'no complaint if missing']], run(argv, io){
    const { o, a } = getopts(argv.slice(1)); const r = o.r || o.R;
    if (!a.length){ io.err('usage: rm [-r] [-f] path...\n'); return 1; }
    for (const p of a){
      const abs = FS.resolve(p, cwd);
      if (abs === '/' || abs === HOME){ io.err('rm: refusing to remove ' + tildify(abs) + '\n'); io.exit(1); continue; }
      if (!FS.exists(p)){ if (!o.f){ io.err('rm: ' + p + ': no such file or directory\n'); io.exit(1); } continue; }
      if (FS.isDir(p) && !r){ io.err('rm: ' + p + ' is a directory  (try: rm -r ' + p + ')\n'); io.exit(1); continue; }
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
      if (FS.isDir(f) && !(o.r || o.R)){ io.err('cp: ' + f + ' is a directory  (try: cp -r)\n'); io.exit(1); continue; }
      if (!FS.cp(f, to)){ io.err(fsErr('cp', f)); io.exit(1); }
    }
  } });
  def('tree', { g: 'files', desc: 'draw a directory as a tree', usage: 'tree [-a] [dir]', opts: [['-a', 'include hidden files']], run(argv, io){
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
  def('wc', { g: 'text', desc: 'count lines, words and characters', usage: 'wc [-l] [-w] [-c] [file...]', opts: [['-l', 'lines only'], ['-w', 'words only'], ['-c', 'characters only']], ex: ['wc README.md', 'ls | wc -l'], run(argv, io){
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
    if (argv.length < 2){ io.err('usage: which name...  (try: which ls)\n'); return 1; }
    for (const n of argv.slice(1)){
      if (hasAlias(n)) io.write(n + ': aliased to ' + ALIASES[n] + '\n');
      else if (M.TERM.apps[n]) io.write('/usr/games/' + n + '\n');
      else if (SHELL_BUILTIN.includes(n) && M.TERM.cmds[n] === B[n]) io.write(n + ': shell built-in\n');
      else if (M.TERM.cmds[n]) io.write((M.TERM.cmds[n].g === 'read' ? '/usr/local/bin/' : '/bin/') + n + '\n');
      else { io.err('which: ' + n + ' not found\n'); miss++; }
    }
    return miss ? 1 : 0;
  } });
  def('man', { g: 'system', desc: 'the manual page for a command', usage: 'man command', ex: ['man grep'], run(argv, io){
    const n = argv[1];
    if (!n){ io.err('usage: man command  (try: man grep)\n'); return 1; }
    const name = hasAlias(n) && !M.TERM.cmds[n] && !M.TERM.apps[n] ? ALIASES[n].split(' ')[0] : n;
    const c = M.TERM.cmds[name] || M.TERM.apps[name];
    if (!c){ io.err('man: no manual entry for ' + n + '  (try: help all)\n'); return 1; }
    const isApp = !!M.TERM.apps[name] && !M.TERM.cmds[name];
    const o = out(); const h = name.toUpperCase() + '(' + (isApp && c.g !== 'files' && c.g !== 'tools' ? 6 : 1) + ')';
    o.at(0, [h, 'b'], [' '.repeat(Math.max(1, Math.floor((COLS - 12) / 2) - h.length)) + 'KN-84 manual', 'd'], [' '.repeat(Math.max(1, Math.ceil((COLS - 12) / 2) - h.length)) + h, 'b']).blank();
    o.at(0, ['NAME', 'b']).at(4, [name, 'n'], [' - ' + (c.desc || ''), 'n']).blank();
    o.at(0, ['SYNOPSIS', 'b']).at(4, [c.usage || name, 'n']).blank();
    if (c.more){ o.at(0, ['DESCRIPTION', 'b']); o.para(c.more, 'n', COLS - 6, 4); o.blank(); }
    if (c.opts && c.opts.length){ o.at(0, ['OPTIONS', 'b']); const w = Math.max(...c.opts.map(x => x[0].length)) + 3; for (const [f, d] of c.opts){ const ls = wrap(d, Math.max(12, COLS - 4 - w)); o.at(4, [pad(f, w), 'b'], [ls[0], 'n']); for (const l of ls.slice(1)) o.at(4 + w, [l, 'n']); } o.blank(); }
    /* an example that is a whole command line runs when clicked or tapped (a placeholder, a note or a !bang does not) */
    if (c.ex && c.ex.length){ o.at(0, ['EXAMPLES', 'b']); for (const x of c.ex) o.at(4, !/[<]|\s{2,}|^!/.test(x) && x.length <= COLS - 6 ? chip(x, 'd') : [x, 'd']); o.blank(); }
    if (hasAlias(n) && n !== name) o.at(0, ['(' + n + ' is an alias for ' + ALIASES[n] + ')', 'f']).blank();
    if (io.tty) io.rich(o); else io.write(o.rows.map(textOf).join('\n') + '\n');
  } });
  /* help: a short, curated page by default (everything a visitor is likely to want, fitting one screen);
     help all lists every command, grouped by its g; help <cmd> is man */
  /* plain help is for someone who has never used a terminal: what you can do, in words, with commands to click */
  const HELP_TOP = [['about ' + ((C.name || 'Kaiav').split(' ')[0]), 'who he is, what he builds', PAGE_WORDS]];
  const HELP_ALSO = ['edit', 'todo', 'tetris', 'snake', 'weather'];
  const HELP_ALL = [['read', 'about'], ['net', 'net'], ['tools', 'tools'], ['fun', 'play'], ['files', 'files'], ['text', 'text'], ['system', 'system'], ['shell', 'shell'], ['misc', 'misc']];
  def('help', { g: 'system', desc: 'what you can type here', usage: 'help [all | command]', ex: ['help', 'help all', 'help weather'], run(argv, io){
    if (argv[1] && argv[1] !== 'all' && argv[1] !== '-a'){
      const n = argv[1];
      if (M.TERM.cmds[n] || M.TERM.apps[n] || hasAlias(n)) return B.man.run(['man', n], io);
      io.err('help: nothing called ' + n + '  (try: help all)\n'); return 1;
    }
    const all = !!argv[1];
    const exists = n => (M.TERM.cmds[n] && !M.TERM.cmds[n].hidden && typeof M.TERM.cmds[n].run === 'function') || (M.TERM.apps[n] && typeof M.TERM.apps[n].start === 'function');
    if (!all){
      const groups = HELP_TOP.map(([label, what, names]) => [label, what, names.filter(exists)]).filter(x => x[2].length);
      const also = HELP_ALSO.filter(exists);
      if (!io.tty){ io.write(groups.map(([l, w, ns]) => l + ' (' + w + ')\n  ' + ns.join('  ')).join('\n') + '\nalso\n  ' + also.join('  ') + '\n\nhelp all for everything\n'); return; }
      const o = out(); o.blank().head('help').blank();
      for (const [label, what, names] of groups){
        o.line([label, 'b'], [COLS - 4 - label.length - what.length >= 2 ? '  ' + what : '', 'f']);
        o.flow(names.map(n => [chip(n, 'b')]), '  ', 4);
      }
      o.blank().line(['also', 'd']).flow(also.map(n => [chip(n, 'n')]), '  ', 4);
      o.blank().line(chip('help all', 'n'), [' for everything', 'f']).blank();
      io.rich(o); return;
    }
    const by = {};
    const add = (n, c) => { const gk = c.g && HELP_ALL.some(x => x[0] === c.g) ? c.g : 'misc'; (by[gk] = by[gk] || []).push(n); };
    for (const [n, c] of Object.entries(M.TERM.cmds)) if (c && !c.hidden && typeof c.run === 'function') add(n, c);
    for (const [n, a] of Object.entries(M.TERM.apps)) if (a && !a.hidden && typeof a.start === 'function' && !M.TERM.cmds[n]) add(n, Object.assign({ g: 'fun' }, a));
    const groups = HELP_ALL.filter(([k]) => by[k]).map(([k, label]) => [label, by[k]]);
    if (!io.tty){ io.write(groups.map(([l, ns]) => pad(l, 8) + ns.join(' ')).join('\n') + '\n'); return; }
    const LW = COLS >= 50 ? 9 : 8, room = COLS - 2 - LW;
    const o = out(); o.blank().head('every command').blank();
    for (const [label, names] of groups){
      let line = [], w = 0, first = true;
      const flush = () => { o.at(2, [pad(first ? label : '', LW), 'd'], ...line); if (!first) o.rows[o.rows.length - 1].c = 1; line = []; w = 0; first = false; };
      for (const n of names){
        if (line.length && w + 2 + n.length > room) flush();
        if (line.length){ line.push(['  ', 'f']); w += 2; }
        line.push(chip(n, label === 'about' ? 'b' : 'n', label !== 'about' && needsArg(n) ? 'man ' + n : n)); w += n.length;
      }
      if (line.length) flush();
    }
    o.blank().flow([[['man <cmd>', 'n'], [' details', 'f']], ...(TAP ? [] : [[['tab', 'n'], [' completes', 'f']], [['ctrl+c', 'n'], [' stops', 'f']]])], '   ').blank();
    io.rich(o);
  } });
  /* a command that does nothing useful bare (grep, cp, timer...): its chip in help all opens the manual
     instead, with examples, rather than a usage error. Read from the usage line: a word outside [brackets]
     after the name, or (for a plain command) an optional [file] or [text] that it then wants from a pipe */
  function needsArg(n){
    const c = M.TERM.cmds[n], isApp = !c && !!M.TERM.apps[n], d = c || M.TERM.apps[n] || {};
    let s = String(d.usage || n).replace(/^\S+\s*/, '');
    if (!isApp) s = s.replace(/\[(file|text|expression)(\.\.\.)?\]/g, 'x');
    for (let k = 0; k < 4 && /\[[^[\]]*\]/.test(s); k++) s = s.replace(/\[[^[\]]*\]/g, '');
    return /[^\s.|]/.test(s);
  }
  def('history', { g: 'shell', desc: 'commands you have run', usage: 'history [-c]', opts: [['-c', 'forget them']], ex: ['!!   run the last one again', '!3   run number 3'], run(argv, io){
    if (argv[1] === '-c'){ history = []; hIdx = 0; store.set(HIST_KEY, []); return; }
    if (!history.length){ io.write('no history yet\n', 'dim'); return; }
    history.forEach((s, i) => { io.write(String(i + 1).padStart(5, ' ') + '  ', 'faint'); io.write(s + '\n'); });
  } });
  def('alias', { g: 'shell', desc: 'name a command line', usage: "alias [name='command']", ex: ["alias hi='echo hello'", 'alias'], run(argv, io){
    if (argv.length < 2){ for (const k of Object.keys(ALIASES).sort()) io.write('alias ' + k + "='" + ALIASES[k] + "'\n"); return; }
    for (const a of argv.slice(1)){
      const m = /^([^=\s]+)=(.*)$/s.exec(a);
      if (m && !m[2]){ delete ALIASES[m[1]]; continue; }            // alias name= removes it
      if (!m){ if (hasAlias(a)) io.write('alias ' + a + "='" + ALIASES[a] + "'\n"); else { io.err('alias: ' + a + ': not found\n'); io.exit(1); } continue; }
      ALIASES[m[1]] = m[2];
    }
    saveAliases();
  } });
  def('unalias', { g: 'shell', desc: 'remove an alias', usage: 'unalias name | -a', ex: ['unalias hi'], run(argv, io){
    if (argv.length < 2){ io.err('usage: unalias name   (alias lists them)\n'); return 1; }
    for (const a of argv.slice(1)){
      if (a === '-a'){ for (const k of Object.keys(ALIASES)) delete ALIASES[k]; continue; }
      if (hasAlias(a)) delete ALIASES[a]; else { io.err('unalias: ' + a + ': not found\n'); io.exit(1); }
    }
    saveAliases();
  } });
  def('clear', { g: 'system', desc: 'clear the screen', usage: 'clear', run(argv, io){ if (io.tty) clearScreen(); } });
  def('neofetch', { g: 'system', desc: 'about this machine', usage: 'neofetch',
    more: 'a summary of the KN-84 and its owner: the system, this visit\'s uptime, the terminal size, the files in your home, and who ' + ((C.name || 'Kaiav').split(' ')[0]) + ' is. wide screens draw the machine beside it.',
    run(argv, io){
      const info = fetchInfo();
      if (!io.tty){ io.write(ENV.USER + '@' + ENV.HOSTNAME + '\n' + info.map(([k, v]) => pad(k, 10) + v).join('\n') + '\n'); return; }
      const o = out(); o.blank().viz(info.length + 3, drawFetch, age => age < 1.2 ? 30 : 4).blank()
        .line(['see also  ', 'f'], ...chips(['about', 'links', 'contact'], 'n')).blank();
      io.rich(o);
      if (job) job.plain += info.map(([k, v]) => (k || 'and') + ' ' + v).join('. ') + '. ';
    } });
  /* the neofetch rows: the KN-84 (as the site already describes it), then its owner, from content.js */
  function fetchInfo(){
    let files = 0;
    const walk = d => { for (const e of FS.list(d) || []) if (e.dir) walk(d + '/' + e.name); else files++; };
    walk(HOME);
    const shown = n => !n.hidden;
    const ncmd = Object.values(M.TERM.cmds).filter(c => c && shown(c)).length + Object.keys(M.TERM.apps).filter(n => !M.TERM.cmds[n] && shown(M.TERM.apps[n])).length;
    const roles = String(A.role || [E.role && E.title && E.role + ' of ' + E.title, J.role && 'Co-founder of J'].filter(Boolean).join(' · ')).split(/\s*·\s*/).filter(Boolean);
    return [['OS', 'KNOS 1.04'], ['Host', 'KN-84'], ['Uptime', uptimeStr()], ['Shell', 'sh, ' + ncmd + ' commands'], ['Terminal', 'vt320, ' + COLS + 'x' + ROWS],
      ['Font', 'VT323'], ['Files', files + ' in ~'], ['User', C.name || 'Kaiav'], ...roles.map((r, i) => [i ? '' : 'Role', r])];
  }
  /* ---- the landing: a demoscene intro, drawn straight onto the tube ----
     An Amiga-style intro in one phosphor. A chunky extruded "KN" (bevelled, flat-shaded facets, chrome front faces
     with bright vector edges; back faces culled, the rest painter-sorted, letter by letter) falls in from far away,
     spinning, and slams into place with a flash and a jolt; then it spins and bobs over swinging copper bars, a 3D
     starfield and a perspective grid floor that takes its shadow. A sine scroller in a C64-style bitmap font carries
     the facts from content.js across the floor, mirrored in it. Each key flashes the next copper bar and kicks the
     logo; the pointer (term.pointer) tilts it and a drag spins it. Under reduced motion it is one composed frame.
     Geometry, the shade ramp, the font strip and the stars are made once; a frame allocates nothing. */
  const DEMO = (() => {
    /* the phosphor as a 64-step ramp, bg -> faint -> dim -> normal -> bright (v 0..1), with each step's luminance */
    const rgb = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
    const STOPS = [P.bg, P.faint, P.dim, P.normal, P.bright].map(rgb), NS = 64, SH = [], SL = new Float32Array(NS);
    for (let i = 0; i < NS; i++){
      const f = i / (NS - 1) * 4, k = Math.min(3, f | 0), u = f - k, c = STOPS[k].map((a, j) => Math.round(a + (STOPS[k + 1][j] - a) * u));
      SH.push('#' + c.map(v => v.toString(16).padStart(2, '0')).join('')); SL[i] = (.299 * c[0] + .587 * c[1] + .114 * c[2]) / 255;
    }
    const si = v => v <= 0 ? 0 : v >= 1 ? NS - 1 : (v * (NS - 1) + .5) | 0;
    const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
    let seed = 11;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

    /* ---- the logo: K and N as outlines (8 units tall), slanted, bevelled at the front and extruded ---- */
    const SHEAR = .24, DZ = 1.35, BV = .38, BD = .5;       // slant; half the depth; the bevel's inset and depth
    const OUTL = [
      [[0, -4], [1.9, -4], [1.9, -1.2], [4, -4], [6.4, -4], [3.3, .3], [6.2, 4], [3.8, 4], [1.9, 1.3], [1.9, 4], [0, 4]],   // K
      [[0, -4], [1.9, -4], [1.9, .3], [4.5, -4], [6.4, -4], [6.4, 4], [4.5, 4], [4.5, -.3], [1.9, 4], [0, 4]],              // N
    ], OX = [-7, .6];
    let NV = 0;
    const LET = OUTL.map((o, li) => {
      const n = o.length, p = o.map(([x, y]) => [x + OX[li] + SHEAR * y, y]);
      const en = p.map((a, i) => { const b = p[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); return [dy / l, -dx / l]; });   // outward
      const v = new Float32Array(n * 9);            // rings: the bevel's inner edge (the front face), its outer edge, the back
      p.forEach(([x, y], i) => {
        const a = en[(i + n - 1) % n], b = en[i], d = 1 + a[0] * b[0] + a[1] * b[1];
        v.set([x - BV * (a[0] + b[0]) / d, y - BV * (a[1] + b[1]) / d, -DZ], i * 3);
        v.set([x, y, -DZ + BD], (n + i) * 3);
        v.set([x, y, DZ], (2 * n + i) * 3);
      });
      const bl = Math.hypot(BD, BV), f = [];         // quads: kind (0 side, 1 bevel), normal, four corners
      for (let i = 0; i < n; i++){
        const j = (i + 1) % n, [ex, ey] = en[i];
        f.push(0, ex, ey, 0, n + i, n + j, 2 * n + j, 2 * n + i);
        f.push(1, ex * BD / bl, ey * BD / bl, -BV / bl, j, i, n + i, n + j);
      }
      const L = { n, v, f: Float32Array.from(f), nf: 2 * n, o: NV, cx: p.reduce((s, q) => s + q[0] / n, 0) };
      NV += 3 * n; return L;
    });
    const wx = new Float32Array(NV), wy = new Float32Array(NV), wz = new Float32Array(NV), qx = new Float32Array(NV), qy = new Float32Array(NV);
    const ordF = new Int16Array(64), ordD = new Float32Array(64);
    let m00, m01, m02, m10, m11, m12, m20, m21, m22, F = 1000, cx = 640, hy = 500;
    function xform(yaw, pit, rol, px, py, pz, sc){
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit), cr = Math.cos(rol), sr = Math.sin(rol);
      const a10 = sp * sy, a11 = cp, a12 = -sp * cy;  // Rx(pit) Ry(yaw); then Rz(rol)
      m00 = cr * cy - sr * a10; m01 = -sr * a11; m02 = cr * sy - sr * a12;
      m10 = sr * cy + cr * a10; m11 = cr * a11; m12 = sr * sy + cr * a12;
      m20 = -cp * sy; m21 = sp; m22 = cp * cy;
      for (const L of LET){
        const v = L.v;
        for (let i = 0, k = L.o; i < L.n * 3; i++, k++){
          const x = v[i * 3] * sc, y = v[i * 3 + 1] * sc, z = v[i * 3 + 2] * sc;
          const X1 = m00 * x + m01 * y + m02 * z + px, Y1 = m10 * x + m11 * y + m12 * z + py, Z1 = Math.max(.5, m20 * x + m21 * y + m22 * z + pz);
          wx[k] = X1; wy[k] = Y1; wz[k] = Z1; qx[k] = cx + F * X1 / Z1; qy[k] = hy - F * Y1 / Z1;
        }
      }
    }
    const LX = -.42, LY = .62, LZ = -.66;            // toward the light: up, left, in front
    function quad(a, b, c, d){ g.beginPath(); g.moveTo(qx[a], qy[a]); g.lineTo(qx[b], qy[b]); g.lineTo(qx[c], qy[c]); g.lineTo(qx[d], qy[d]); g.closePath(); }
    const area4 = (a, b, c, d) => Math.abs((qx[a] - qx[c]) * (qy[b] - qy[d]) - (qx[b] - qx[d]) * (qy[a] - qy[c])) / 2;
    function ring(o, n){ g.beginPath(); g.moveTo(qx[o], qy[o]); for (let i = 1; i < n; i++) g.lineTo(qx[o + i], qy[o + i]); g.closePath(); }
    function ringArea(o, n){ let a = 0; for (let i = 0; i < n; i++){ const j = o + i, k = o + (i + 1) % n; a += qx[j] * qy[k] - qx[k] * qy[j]; } return Math.abs(a / 2); }
    /* the front faces' chrome: bright sky, a hard dark horizon just under the middle, a lit floor (a 1 x 64 sprite) */
    let chrome = null;
    function makeChrome(){
      chrome = document.createElement('canvas'); chrome.width = 1; chrome.height = 64;
      const c = chrome.getContext('2d');
      for (let y = 0; y < 64; y++){
        const u = y / 63, v = u < .5 ? 1 - .42 * u / .5 : u < .56 ? .34 : .5 + .42 * (u - .56) / .44;
        c.fillStyle = SH[si(v)]; c.fillRect(0, y, 1, 1);
      }
    }
    let glint = 0;
    function drawLogo(alpha, lw){
      /* letters far to near; in each, the visible sides and bevels far to near, then the cap that faces us */
      const zc0 = m20 * LET[0].cx, zc1 = m20 * LET[1].cx;
      let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
      for (const L of LET) for (let i = 0; i < L.n; i++){ const k = L.o + i; if (qx[k] < bx0) bx0 = qx[k]; if (qx[k] > bx1) bx1 = qx[k]; if (qy[k] < by0) by0 = qy[k]; if (qy[k] > by1) by1 = qy[k]; }
      g.lineJoin = 'round';
      for (let pass = 0; pass < 2; pass++){
        const L = LET[(zc0 > zc1) === (pass === 0) ? 0 : 1], f = L.f, o = L.o;
        let nv = 0;
        for (let q = 0; q < L.nf; q++){
          const b = q * 8, nx = f[b + 1], ny = f[b + 2], nz = f[b + 3], i0 = o + f[b + 4];
          const Nx = m00 * nx + m01 * ny + m02 * nz, Ny = m10 * nx + m11 * ny + m12 * nz, Nz = m20 * nx + m21 * ny + m22 * nz;
          if (Nx * wx[i0] + Ny * wy[i0] + Nz * wz[i0] >= 0) continue;   // facing away
          const i1 = o + f[b + 5], i2 = o + f[b + 6], i3 = o + f[b + 7];
          let k = nv++; const d = wz[i0] + wz[i1] + wz[i2] + wz[i3];
          while (k > 0 && ordD[k - 1] < d){ ordD[k] = ordD[k - 1]; ordF[k] = ordF[k - 1]; k--; }
          ordD[k] = d; ordF[k] = q;
        }
        for (let s = 0; s < nv; s++){
          const b = ordF[s] * 8, kind = f[b], nx = f[b + 1], ny = f[b + 2], nz = f[b + 3];
          const Nx = m00 * nx + m01 * ny + m02 * nz, Ny = m10 * nx + m11 * ny + m12 * nz, Nz = m20 * nx + m21 * ny + m22 * nz;
          const i0 = o + f[b + 4], i1 = o + f[b + 5], i2 = o + f[b + 6], i3 = o + f[b + 7];
          const dif = Math.max(0, Nx * LX + Ny * LY + Nz * LZ);
          let hx = LX - wx[i0] / wz[i0] * .7, hy2 = LY - wy[i0] / wz[i0] * .7, hz = LZ - .7; const hl = 1 / Math.hypot(hx, hy2, hz);
          const sp = Math.max(0, (Nx * hx + Ny * hy2 + Nz * hz) * hl), spec = Math.pow(sp, 18);
          const v = (kind ? .22 : .1) + (kind ? .55 : .42) * dif + .45 * spec + (kind ? glint * .35 : 0);
          const c = si(v * alpha);
          quad(i0, i1, i2, i3); g.fillStyle = SH[c]; g.fill();
          g.strokeStyle = SH[si((v + (kind ? .22 : .14)) * alpha)]; g.lineWidth = lw * .6; g.stroke();
          lumAcc += area4(i0, i1, i2, i3) * SL[c];
        }
        /* the cap: the front face in chrome, lit by how it faces the lamp; the back plain */
        const front = -(m02 * wx[o] + m12 * wy[o] + m22 * wz[o]) < 0 ? true : false;
        if (front){
          const dif = Math.max(0, -(m02 * LX + m12 * LY + m22 * LZ));
          ring(o, L.n); g.fillStyle = P.bg; g.fill();
          g.save(); g.clip(); g.globalAlpha = clamp((.42 + .45 * dif + glint * .3) * alpha, 0, 1);
          g.drawImage(chrome, 0, 0, 1, 64, bx0, by0, bx1 - bx0, by1 - by0); g.restore();
          lumAcc += ringArea(o, L.n) * .75 * (.42 + .45 * dif) * alpha;
          ring(o, L.n); g.strokeStyle = alpha > .6 ? P.bright : SH[si(alpha)]; g.lineWidth = lw; g.stroke();
        } else {
          const b = o + 2 * L.n, dif = Math.max(0, m02 * LX + m12 * LY + m22 * LZ), c = si((.18 + .4 * dif) * alpha);
          ring(b, L.n); g.fillStyle = SH[c]; g.fill(); g.strokeStyle = SH[si((.5 + .3 * dif) * alpha)]; g.lineWidth = lw * .8; g.stroke();
          lumAcc += ringArea(b, L.n) * SL[c];
        }
      }
      g.lineJoin = 'miter';
    }
    /* its shadow on the floor (y = -FY), cast by a light high behind the viewer: front and back outlines and the sides between */
    const FY = 7, SX = .18, SZ = .95;
    const sqx = new Float32Array(NV), sqy = new Float32Array(NV);
    function sring(o, n){ g.moveTo(sqx[o], sqy[o]); for (let i = 1; i < n; i++) g.lineTo(sqx[o + i], sqy[o + i]); g.closePath(); }
    function drawShadow(alpha){
      for (let k = 0; k < NV; k++){
        const t = wy[k] + FY, x = wx[k] + SX * t, z = Math.max(1, wz[k] + SZ * t);
        sqx[k] = cx + F * x / z; sqy[k] = hy + F * FY / z;
      }
      g.fillStyle = SH[si(.02 + .03 * (1 - alpha))];
      for (const L of LET){
        const o = L.o, n = L.n;
        g.beginPath(); sring(o + n, n); sring(o + 2 * n, n); g.fill();
        for (let i = 0; i < n; i++){
          const a = o + n + i, b = o + n + (i + 1) % n;
          g.beginPath(); g.moveTo(sqx[a], sqy[a]); g.lineTo(sqx[b], sqy[b]); g.lineTo(sqx[b + n], sqy[b + n]); g.lineTo(sqx[a + n], sqy[a + n]); g.closePath(); g.fill();
        }
      }
    }

    /* ---- the font: 8 x 8, C64 style, upper case; the scroll text is drawn once into a strip, with a drop shadow ---- */
    const FONT8 = {
      A: '   ##   |  ####  | ##  ## | ###### | ##  ## | ##  ## | ##  ## ', B: ' #####  | ##  ## | ##  ## | #####  | ##  ## | ##  ## | #####  ',
      C: '  ####  | ##  ## | ##     | ##     | ##     | ##  ## |  ####  ', D: ' ####   | ## ##  | ##  ## | ##  ## | ##  ## | ## ##  | ####   ',
      E: ' ###### | ##     | ##     | ####   | ##     | ##     | ###### ', F: ' ###### | ##     | ##     | ####   | ##     | ##     | ##     ',
      G: '  ####  | ##  ## | ##     | ## ### | ##  ## | ##  ## |  ####  ', H: ' ##  ## | ##  ## | ##  ## | ###### | ##  ## | ##  ## | ##  ## ',
      I: '  ####  |   ##   |   ##   |   ##   |   ##   |   ##   |  ####  ', J: '   #### |    ##  |    ##  |    ##  |    ##  | ## ##  |  ###   ',
      K: ' ##  ## | ## ##  | ####   | ###    | ####   | ## ##  | ##  ## ', L: ' ##     | ##     | ##     | ##     | ##     | ##     | ###### ',
      M: ' ##   ##| ### ###| #######| ## # ##| ##   ##| ##   ##| ##   ##', N: ' ##  ## | ### ## | ###### | ###### | ## ### | ##  ## | ##  ## ',
      O: '  ####  | ##  ## | ##  ## | ##  ## | ##  ## | ##  ## |  ####  ', P: ' #####  | ##  ## | ##  ## | #####  | ##     | ##     | ##     ',
      Q: '  ####  | ##  ## | ##  ## | ##  ## | ##  ## |  ####  |    ### ', R: ' #####  | ##  ## | ##  ## | #####  | ####   | ## ##  | ##  ## ',
      S: '  ####  | ##  ## | ##     |  ####  |     ## | ##  ## |  ####  ', T: ' ###### |   ##   |   ##   |   ##   |   ##   |   ##   |   ##   ',
      U: ' ##  ## | ##  ## | ##  ## | ##  ## | ##  ## | ##  ## |  ####  ', V: ' ##  ## | ##  ## | ##  ## | ##  ## | ##  ## |  ####  |   ##   ',
      W: ' ##   ##| ##   ##| ##   ##| ## # ##| #######| ### ###| ##   ##', X: ' ##  ## | ##  ## |  ####  |   ##   |  ####  | ##  ## | ##  ## ',
      Y: ' ##  ## | ##  ## | ##  ## |  ####  |   ##   |   ##   |   ##   ', Z: ' ###### |     ## |    ##  |   ##   |  ##    | ##     | ###### ',
      0: '  ####  | ##  ## | ## ### | ###### | ### ## | ##  ## |  ####  ', 1: '   ##   |  ###   |   ##   |   ##   |   ##   |   ##   | ###### ',
      2: '  ####  | ##  ## |     ## |    ##  |  ##    | ##     | ###### ', 3: '  ####  | ##  ## |     ## |   ###  |     ## | ##  ## |  ####  ',
      4: '     ## |    ### |   #### | ##  ## | #######|     ## |     ## ', 5: ' ###### | ##     | #####  |     ## |     ## | ##  ## |  ####  ',
      6: '  ####  | ##  ## | ##     | #####  | ##  ## | ##  ## |  ####  ', 7: ' ###### | ##  ## |    ##  |   ##   |   ##   |   ##   |   ##   ',
      8: '  ####  | ##  ## | ##  ## |  ####  | ##  ## | ##  ## |  ####  ', 9: '  ####  | ##  ## | ##  ## |  ##### |     ## | ##  ## |  ####  ',
      '.': '|||||   ##   |   ##   ', ',': '|||||   ##   |   ##   |  ##    ', "'": '   ##   |   ##   |  ##    ', '-': '|||  #### ',
      '·': '|||   ##   |   ##   ', ':': '|   ##   |   ##   ||   ##   |   ##   ', '!': '   ##   |   ##   |   ##   |   ##   ||   ##   ',
      '?': '  ####  | ##  ## |     ## |    ##  |   ##   ||   ##   ', '/': '      ##|     ## |    ##  |   ##   |  ##    | ##     |##      ',
      '+': '|   ##   |   ##   | ###### |   ##   |   ##   ', '&': '  ###   | ## ##  |  ###   | ### ## | ## ### | ##  ## |  ### ##',
      '(': '    ##  |   ##   |  ##    |  ##    |  ##    |   ##   |    ##  ', ')': '  ##    |   ##   |    ##  |    ##  |    ##  |   ##   |  ##    ',
    };
    const GW = 8, GH = 8;
    const ROWV = [1, .96, .86, .74, .6, .72, .86, .9];   // the letters' own copper: bright crown, a darker waist
    let strip = null, stripR = null, stripW = 0, text = '', nameAt = 0, title = null, sub = null;
    function scrollText(){
      const bl = String((A.body || []).join('\n')).split('\n').map(s => s.replace(/^\s*[-*\u2022]\s*/, '').trim()).filter(Boolean);
      const pick = re => bl.find(b => re.test(b));
      const parts = [C.name, A.role, J.line && (J.title ? J.title + ' - ' : '') + J.line, E.line && (E.title ? E.title + ' - ' : '') + E.line, pick(/^born/i), pick(/squash|bjj/i)];
      return '  ' + parts.filter(Boolean).join('  \u00b7\u00b7\u00b7  ') + '  \u00b7\u00b7\u00b7  ';
    }
    const fontText = t => String(t).toUpperCase().replace(/[^A-Z0-9 .,'\-\u00b7:!?/+&()]/g, ' ');
    /* a line of text in the font: its face (with a drop shadow, down and right) and, if asked, its dimmer mirror image */
    function bake(t, mirror){
      const w = t.length * GW + 1, h = GH + 1, lit = new Uint8Array(w * h);
      for (let i = 0; i < t.length; i++){
        const gl = FONT8[t[i]]; if (!gl) continue;
        gl.split('|').forEach((row, y) => { for (let x = 0; x < GW; x++) if (row[x] === '#') lit[y * w + i * GW + x] = 1; });
      }
      const mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
      const face = mk(), da = face.getContext('2d').createImageData(w, h), refl = mirror ? mk() : null, db = mirror ? refl.getContext('2d').createImageData(w, h) : null;
      const cache = {};
      const put = (d, i, v) => { const k = si(v), c = cache[k] || (cache[k] = rgb(SH[k])); d.data[i * 4] = c[0]; d.data[i * 4 + 1] = c[1]; d.data[i * 4 + 2] = c[2]; d.data[i * 4 + 3] = 255; };
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
        const i = y * w + x;
        if (lit[i]){ put(da, i, ROWV[y] || .8); if (db && y < GH) put(db, (GH - 1 - y) * w + x, (ROWV[y] || .8) * .42); }
        else if (x > 0 && y > 0 && lit[i - w - 1]) put(da, i, .12);
      }
      face.getContext('2d').putImageData(da, 0, 0); if (refl) refl.getContext('2d').putImageData(db, 0, 0);
      return { face, refl, w: w - 1 };
    }
    function makeStrip(){
      text = fontText(scrollText()); nameAt = text.search(/\S/);
      const b = bake(text, true); strip = b.face; stripR = b.refl; stripW = b.w;
      title = bake(fontText(C.name || 'KN')); sub = bake('PRESENTS');
    }
    /* the title card while the stars rush past: the name, then PRESENTS; it opens out from a line and shuts back to one */
    function titleCard(age){
      if (age < .12 || age > 1.3) return;
      if (!strip) makeStrip();
      const open = sstep(.12, .3, age) * (1 - sstep(1.08, 1.26, age)), k = Math.max(3, Math.round(s * .8)), k2 = Math.max(2, Math.round(k * .55));
      const cy = top + h * .3, tw = title.w * k, sw = sub.w * k2, th = (GH + 1) * k + k2 * 2 + (GH + 1) * k2;
      const hh = Math.max(2, Math.round(th * open)), y0 = Math.round(cy - hh / 2);
      g.save(); g.beginPath(); g.rect(0, y0, W, hh); g.clip();
      g.imageSmoothingEnabled = false;
      const yt = Math.round(cy - th / 2);
      g.drawImage(title.face, 0, 0, title.w + 1, GH + 1, Math.round(cx - tw / 2), yt, tw + k, (GH + 1) * k);
      if (age > .45){ g.globalAlpha = sstep(.45, .6, age) * .8; g.drawImage(sub.face, 0, 0, sub.w + 1, GH + 1, Math.round(cx - sw / 2), yt + (GH + 1) * k + k2 * 2, sw + k2, (GH + 1) * k2); g.globalAlpha = 1; }
      g.imageSmoothingEnabled = true; g.restore();
      if (open < .98){ g.fillStyle = SH[si(.85)]; g.fillRect(Math.round(cx - tw * (.3 + .7 * open) / 2), Math.round(cy) - 1, Math.round(tw * (.3 + .7 * open)), 2); }   // the line it opens from
      lumAcc += tw * hh * .25;
    }

    /* ---- stars: a box of them flying at the viewer ---- */
    const NST = 200, ZR = 110, stx = new Float32Array(NST), sty = new Float32Array(NST), stz = new Float32Array(NST);
    for (let i = 0; i < NST; i++){ stx[i] = (rnd() * 2 - 1) * 70; sty[i] = .5 + rnd() * 70; stz[i] = rnd() * ZR; }
    const starZ = (i, dist) => ZR + 1.5 - ((stz[i] + dist) % ZR);
    function drawStars(dist, speed, zmin, zmax, top){
      const streak = speed > 45, k = streak ? Math.min(.09, speed / 2400) : 0;
      if (streak){ g.lineWidth = 2; g.strokeStyle = SH[si(.5)]; g.beginPath(); }
      for (let i = 0; i < NST; i++){
        const z = starZ(i, dist); if (z < zmin || z >= zmax) continue;
        const x = cx + F * stx[i] / z, y = hy - F * sty[i] / z;
        if (y > hy - 3 || y < top || x < -8 || x > W + 8) continue;
        if (streak){ const z2 = z + speed * k; g.moveTo(x, y); g.lineTo(cx + F * stx[i] / z2, hy - F * sty[i] / z2); continue; }
        const n = 1 - z / ZR, sz = Math.round(clamp(2 + 4 * n * n, 2, 6));
        g.fillStyle = SH[si(.2 + .8 * n)]; g.fillRect(Math.round(x), Math.round(y), sz, sz);
      }
      if (streak){ g.stroke(); lumAcc += NST * 30 * SL[si(.5)]; }
    }

    /* ---- layout: everything sized from the drawing's own box, so a phone on its side and a tall phone both work ---- */
    let fitKey = '', top = 0, h = 0, s = 8, amp = 20, ys = 0, Z0 = 30, logoY = 4, zN = 2, gradV = null, bh = 24;
    function fit(t0, hh){
      const key = t0 + ':' + hh + ':' + W; if (key === fitKey) return; fitKey = key;
      top = t0; h = hh; cx = W / 2;
      const tall = W / h < .9;
      hy = top + Math.round(h * (tall ? .6 : .58));
      F = Math.min(.4 * h * Z0 / 8, (tall ? .74 : .62) * W * Z0 / 15.5);
      logoY = (hy - (top + h * (tall ? .33 : .3))) * Z0 / F;
      s = clamp(Math.floor(Math.min(h * .021, W / 100)), 4, 13);
      amp = Math.round(Math.min(h * .04, s * 3.2));
      ys = Math.round(Math.min(top + h * .74, top + h - (4 * s + amp + 4.6 * s + 6)));   // the scroller's middle, its reflection still on the tube
      zN = F * FY / (top + h - hy);
      bh = Math.max(16, Math.round(h * .046 / 8) * 8);
      gradV = g.createLinearGradient(0, hy, 0, top + h);
      gradV.addColorStop(0, P.bg); gradV.addColorStop(.25, SH[si(.2)]); gradV.addColorStop(1, SH[si(.5)]);
    }

    /* ---- the show ---- */
    const SLAM = 1.35, SCROLL0 = 1.05, GPS = 3.6;   // the logo lands; the scroller starts; its speed in glyphs a second
    const NB = 5, bp = new Float32Array(NB), bo = new Int8Array(NB), bY = new Float32Array(NB), bD = new Float32Array(NB);
    let lastT = -1, dist = 0, floorD = 0, kick = 0, nextBar = 0, keyN = 0;
    let oy = 0, oyv = 0, op = 0, opv = 0, spin = 0, spinV = 0, pu = -1, pv = -1, down = false, lastU = -1;
    const backOut = x => { if (x <= 0) return 0; if (x >= 1) return 1; const c = 1.7, u = x - 1; return 1 + (c + 1) * u * u * u + c * u * u; };
    function bars(T, age, still){
      const sky0 = top + 4, sky1 = hy - 6, mid = (sky0 + sky1) / 2 - bh * .5, am = (sky1 - sky0) * .36;
      for (let i = 0; i < NB; i++){
        const ph = T * 1.55 + i * .58;
        bY[i] = mid + am * Math.sin(ph); bD[i] = Math.cos(ph);
        if (!still && age < 1.2) bY[i] = sky0 - bh - 8 + (bY[i] - sky0 + bh + 8) * backOut((age - .05 - i * .09) / .55);   // they drop in, one after another
        let k = i; while (k > 0 && bD[bo[k - 1]] > bD[i]){ bo[k] = bo[k - 1]; k--; } bo[k] = i;
      }
      const nb = 8, st = bh / nb;                      // copper: eight hard steps, dark rim to a hot middle
      for (let r = 0; r < NB; r++){
        const i = bo[r], d = bD[i], peak = clamp(.28 + .15 * d + .6 * bp[i], 0, 1), y0 = Math.round(bY[i]);
        for (let k = 0; k < nb; k++){
          const e = 1 - Math.abs(2 * (k + .5) / nb - 1), v = peak * (.12 + .88 * e * e);
          const y = y0 + k * st; if (y < sky0 || y + st > sky1) continue;
          g.fillStyle = SH[si(v)]; g.fillRect(0, y, W, st);
        }
      }
    }
    function floor(age, still){
      const reveal = still ? 1 : sstep(.1, .9, age), bot = top + h, y1 = hy + (bot - hy) * reveal;
      /* the horizon glows a little, as if lit from beyond */
      for (let k = 0; k < 6; k++){ g.fillStyle = SH[si(.22 - k * .035)]; g.fillRect(0, hy - 4 - k * 4, W, 4); }
      const gs = 4, nz = 40, span = nz * gs, zf = zN + span;
      for (let k = 0; k < nz; k++){
        const z = zN + ((k * gs - floorD) % span + span) % span, y = hy + F * FY / z;
        if (y > y1 || y > bot) continue;
        const n = 1 - (z - zN) / span;
        g.fillStyle = SH[si(.05 + .4 * n * n * n)]; g.fillRect(0, Math.round(y), W, 2);
      }
      g.save(); g.beginPath(); g.rect(0, hy, W, y1 - hy); g.clip();
      g.strokeStyle = gradV; g.lineWidth = 2; g.beginPath();
      const nx = 26;
      for (let k = -nx; k <= nx; k++){
        const x = k * gs, xa = cx + F * x / zN, xb = cx + F * x / zf;
        g.moveTo(xa, bot); g.lineTo(xb, hy + F * FY / zf);
      }
      g.stroke();
      /* haze where the floor runs out toward the horizon */
      const fy = hy + F * FY / zf;
      for (let y = hy, k = 0; y < fy; y += 4, k++){ g.fillStyle = SH[si(.16 * (1 - (y - hy) / (fy - hy)))]; g.fillRect(0, y, W, 4); }
      g.restore();
      lumAcc += (bot - hy) * 2 * 30 * .25;
      g.fillStyle = SH[si(.55)]; g.fillRect(0, hy - 1, W, 2);
    }
    function scroller(age, T, still){
      if (!strip) makeStrip();
      const s0 = s; if (still) s = Math.max(3, Math.min(s, Math.floor(W * .9 / ((String(C.name || '').length + 1) * GW))));   // the still frame: the whole name
      const cols = Math.ceil(W / s) + 1;
      let pos = still ? (nameAt + String(C.name || '').length / 2) * GW - cols / 2 : (age - SCROLL0) * GPS * GW - cols;
      if (!still && pos < -cols) return;
      const ip = Math.floor(pos), fr = pos - ip, gh = (GH + 1) * s, rh = Math.round(gh * .5), y0 = ys - 4 * s;
      const wl = W * .95, ph = still ? 2.1 : T * 2.6;
      g.imageSmoothingEnabled = false;
      let n = 0;
      for (let j = 0; j < cols; j++){
        let src = ip + j; if (src < 0) continue;
        src %= stripW;
        const x = Math.round((j - fr) * s), y = Math.round(y0 + amp * Math.sin(x / wl * 6.2832 - ph));
        g.drawImage(strip, src, 0, 1, GH + 1, x, y, s, gh);
        g.drawImage(stripR, src, 0, 1, GH + 1, x, y + 8 * s + Math.round(s * .6), s, rh);
        n++;
      }
      g.imageSmoothingEnabled = true;
      lumAcc += n * s * gh * .3 * .8;
      /* the floor under the letters is water: dark lines across their reflection */
      g.fillStyle = P.bg;
      for (let y = Math.round(ys + 4 * s - amp + s * .6); y < Math.min(top + h, ys + 4 * s + amp + s * .6 + rh); y += 6) g.fillRect(0, y, W, 2);
      s = s0;
    }
    function draw(x, t0, w, hh, age, t){
      const still = REDUCED;
      if (!chrome) makeChrome();
      fit(t0, hh);
      const dt = lastT < 0 || still ? 0 : clamp(t - lastT, 0, .1); lastT = t;
      if (still) age = 30;
      const T = still ? 7.3 : age;
      /* springs and decays */
      if (dt > 0){
        const tyaw = pu < 0 ? 0 : clamp((pu - .5) * .8, -.38, .38), tpit = pv < 0 ? 0 : clamp((pv - .35) * .5, -.2, .2);
        for (let k = 0, n = Math.ceil(dt / .01), hs = dt / n; k < n; k++){
          oyv += (24 * (tyaw - oy) - 5 * oyv) * hs; oy += oyv * hs;
          opv += (24 * (tpit - op) - 5 * opv) * hs; op += opv * hs;
        }
        if (!down){ spin += spinV * dt; spinV *= Math.exp(-dt * 1.6); }
        const decay = Math.exp(-dt * 5); for (let i = 0; i < NB; i++) bp[i] *= decay;
        kick *= Math.exp(-dt * 4);
        glint *= Math.exp(-dt * 3);
      }
      /* the stars: hyperspace at first, slowing to a drift; a key gives a burst */
      const speed = still ? 0 : 9 + 260 * (1 - sstep(.2, 1.5, age)) + 40 * kick;
      dist += speed * dt; floorD += (still ? 0 : 3.2 + 14 * kick) * dt;
      /* the logo: falls in from far away, spinning, and slams in at SLAM; then spins, bobs and sways */
      let z = Z0, yaw = 0, pit = -.28, rol = 0, y = logoY, alpha = 1, flash = 0, shake = 0;
      if (!still && age < SLAM){
        const u = clamp((age - .25) / (SLAM - .25), 0, 1), e = u * u * u;
        z = 520 + (Z0 - 520) * e; yaw = -(1 - u) * (1 - u) * 9.5; pit = -.28 - (1 - u) * .9; rol = (1 - u) * .5;
        alpha = sstep(.25, .6, age);
      } else {
        const a = age - SLAM, wI = still ? 1 : sstep(0, 1.6, a);
        if (!still){ flash = Math.exp(-a * 8) * .42; shake = Math.exp(-a * 7) * Math.sin(a * 46) * h * .018; z -= Z0 * .14 * Math.exp(-a * 5.5) * Math.cos(a * 15); }
        const ts = a - 7, sp = ts > 0 && ts % 13 < 1.9 ? 6.2832 * sstep(0, 1.9, ts % 13) : 0;   // now and then a full turn
        yaw = wI * (.52 * Math.sin(T * .55) + .1 * Math.sin(T * 1.3)) + sp;
        pit = -.28 + wI * .14 * Math.sin(T * .8 + .6);
        rol = wI * .055 * Math.sin(T * .43);
        y = logoY + wI * .7 * Math.sin(T * 1.25);
        z += wI * 2.2 * Math.sin(T * .37);
        if (still){ yaw = -.42; pit = -.3; rol = .03; }
      }
      yaw += oy + spin + kick * .12 * (keyN & 1 ? 1 : -1); pit += op - kick * .05; y += kick * .25;
      if (!still && age >= SLAM && age - SLAM < .05 && glint < .5) glint = 1;
      g.save(); if (shake) g.translate(0, Math.round(shake));
      bars(still ? 3.1 : T, age, still);
      floor(age, still);
      xform(yaw, pit, rol, 0, y, z, 1);
      drawStars(dist + (still ? 37 : 0), speed, z, 1e9, top);
      if (alpha > .02) drawShadow(alpha);
      if (alpha > .02) drawLogo(alpha, clamp(F / z * .1, 1.5, 4.5));
      drawStars(dist + (still ? 37 : 0), speed, 0, z, top);
      if (still || age > SCROLL0 - 1) scroller(age, T, still);
      if (!still) titleCard(age);
      g.restore();
      if (flash > .01){ g.globalAlpha = flash; g.fillStyle = P.bright; g.fillRect(0, top, W, h); g.globalAlpha = 1; }
    }
    return {
      draw,
      live: () => (M.reader && M.reader.isOpen) ? 0 : 30,
      key(){ bp[nextBar] = 1; nextBar = (nextBar + 1) % NB; kick = Math.min(1.6, kick + .7); keyN++; oyv += (keyN & 1 ? 1 : -1) * 1.6; opv -= .6; glint = Math.max(glint, .6); },
      pointer(u, v, isDown){
        const on = u >= 0 && u <= 1 && v >= 0 && v <= 1;
        if (on && isDown && down && lastU >= 0){ const du = u - lastU; spin += du * 7; spinV = clamp(du * 7 * 30, -9, 9); }
        down = !!isDown && on; lastU = on ? u : -1;
        if (on){ pu = u; pv = v; } else { pu = pv = -1; }
      },
    };
  })();

  /* the KN-84 itself, in outline: a compact all-in-one with its screen lit, and a keyboard; the card beside it.
     Under 50 columns the drawing goes and the card starts at the margin */
  function drawFetch(x, y, w, h, age, t){
    const ap = REDUCED ? 1 : ease(age / 0.5);
    const col = COLS < 50 ? 2 : Math.max(14, COLS - 31);
    if (COLS >= 50){
      const bx = x, by = y + ch * 0.2, bw = cw * Math.min(18, col - 6), bh = ch * 7.6;
      g.strokeStyle = P.normal; g.lineWidth = 2;
      g.strokeRect(bx, by, bw, bh * ap);
      if (ap >= 1){
        const sx = bx + cw * 2, sy = by + ch * 0.7, sw = bw - cw * 4, sh = ch * 4.4;
        g.strokeStyle = P.dim; g.strokeRect(sx, sy, sw, sh);
        g.fillStyle = P.faint; g.fillRect(sx + 6, sy + 6, sw - 12, sh - 12);
        g.fillStyle = P.bg; g.fillRect(sx + 10, sy + 10, sw - 20, sh - 20);
        text('$', 5, sy + 16, 'n');
        if (REDUCED || (t % 1.06) < 0.53){ g.fillStyle = P.normal; g.fillRect(X(7), sy + 20, cw, ch - 10); }
        const fy = sy + sh + ch * 0.75;                       // floppy slot and power light
        g.fillStyle = P.dim; g.fillRect(bx + bw - cw * 8, fy, cw * 6, 4);
        g.fillStyle = P.bright; g.fillRect(bx + cw * 2, fy - 2, 8, 8);
        const ky = by + bh + ch * 0.6, kh = ch * 2.6, kr = (kh - 12) / 4, nk = Math.floor((bw / cw) / 1.6);   // keyboard
        g.strokeStyle = P.normal; g.strokeRect(bx - cw, ky, bw + cw * 2, kh);
        g.fillStyle = P.dim;
        for (let r = 0; r < 3; r++) for (let c2 = 0; c2 < nk - (r % 2); c2++) g.fillRect(bx + c2 * cw * 1.6 + (r % 2) * cw * 0.5, ky + 6 + r * kr, cw * 1.2, kr - 5);
        g.fillRect(bx + bw * 0.22, ky + 6 + 3 * kr, bw * 0.56, kr - 5);
      }
    }
    const info = fetchInfo();
    const n = REDUCED ? 99 : Math.floor((age - 0.15) * 40);
    if (n <= 0) return;
    text(ENV.USER, col, y, 'b'); text('@', col + ENV.USER.length, y, 'f'); text(ENV.HOSTNAME, col + ENV.USER.length + 1, y, 'b');
    g.fillStyle = P.faint; g.fillRect(X(col), y + ch * 1.48, cw * (ENV.USER.length + 1 + ENV.HOSTNAME.length), 2);
    info.forEach(([k, v], i) => {
      if (i + 1 > n) return;
      const top = y + (i + 2) * ch * 0.98;
      text(k, col, top, 'd'); text(v.slice(0, COLS - col - 10), col + 10, top, 'n');
    });
    if (n > info.length + 1){
      const top = y + (info.length + 2.2) * ch * 0.98;
      [P.faint, P.dim, P.normal, P.bright, P.accent].forEach((c, i) => { g.fillStyle = c; g.fillRect(X(col + i * 3), top + 6, cw * 2.6, ch - 12); });
    }
  }

  /* misc */
  def('bc', { g: 'misc', desc: 'a calculator', usage: 'bc [expression]', opts: [], more: 'arithmetic with + - * / % ^ and parentheses, plus sqrt, abs, floor, ceil, round and pi. reads the expression from its arguments, or one per line from a pipe.', ex: ['bc 2^10', "echo '(1+2)*3' | bc"], run(argv, io){
    const src = argv.length > 1 ? [argv.slice(1).join(' ')] : linesOf(io.stdin || '');
    if (!src.length){ io.err('usage: bc expression   (try: bc 2^10)\n'); return 1; }
    for (const l of src){
      if (/^\s*(scale|quit)\b/.test(l)) continue;
      try { const v = calc(l); if (v != null) io.write(v + '\n'); } catch (e){ io.err('bc: ' + (e.message || 'syntax error') + '\n'); io.exit(1); }
    }
  } });
  def('sudo', { g: 'misc', hidden: true, desc: 'not needed here', usage: 'sudo', run(argv, io){ io.write('sudo: not needed here\n', 'dim'); } });
  def('exit', { g: 'misc', desc: 'leave', usage: 'exit', run(argv, io){ io.write('to leave, close the tab\n', 'dim'); } });
  const SHELL_BUILTIN = ['cd', 'alias', 'unalias', 'history', 'exit', 'help', 'echo', 'pwd'];
  // a later terminal (the flat layout after a context loss) replaces the earlier one's built-ins, which close over its state
  for (const [n, c] of Object.entries(B)){ const had = M.TERM.cmds[n]; if (!had || had._b){ c._b = true; M.TERM.cmds[n] = c; } }
  const CONTENT_KW = { about: ['bio', 'kaiav', 'me'], eden: ['agents', 'context'], j: ['rising', 'rising founder', 'jose'], writing: ['blog', 'posts', 'essays'], links: ['linkedin', 'twitter', 'social', 'contact'] };
  /* everything you can type as a command, read fresh each time so late registrations count */
  function cmdItems(){
    const items = [];
    for (const [n, c] of Object.entries(M.TERM.cmds)) if (c && !c.hidden && typeof c.run === 'function') items.push({ name: n, kw: CONTENT_KW[n] });
    for (const [n, a] of Object.entries(M.TERM.apps)) if (a && !a.hidden && typeof a.start === 'function' && !M.TERM.cmds[n]) items.push({ name: n });
    for (const n of Object.keys(ALIASES)) if (n.length > 1 && !M.TERM.cmds[n] && !M.TERM.apps[n]) items.push({ name: n });
    return items;
  }

  /* ---- expansion ---- */
  function expandVars(s){
    return s.replace(/\$(\?|\$|[A-Za-z_]\w*|\{[A-Za-z_]\w*\})/g, (m, n) => n === '?' ? String(status) : n === '$' ? '84' : (Object.prototype.hasOwnProperty.call(ENV, n = n.replace(/[{}]/g, '')) ? ENV[n] : ''));
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
  async function runLine(raw, noHist, real){
    job = newJob();
    const j = job;
    let list;
    try {
      const line = bang(raw);
      if (line !== raw) tty.write(line + '\n', 'dim');
      record(line, noHist);
      list = parse(real ? lex(line) : applyAliases(lex(line)));
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
    if (!noHist && history[history.length - 1] !== line){ history.push(line); if (history.length > 200) history.shift(); store.set(HIST_KEY, history); }
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
    job = null; openRow = null; eatBlank = false;
    if (status === 0 && !j.dead) okRuns++;
    if (j.hint){ suggestion = j.hint; tty.rich(out().at(0, ['did you mean ', 'd'], chip(j.hint, 'b'), ['?  ' + (TAP ? 'tap it' : 'press enter'), 'f'])); j.plain += ' Did you mean ' + j.hint + '? Press Enter to run it.'; }
    if (ahead) flushAhead();
    const held = scrollOff, pin = pinned;      // someone reading back up (or a page opened at its top) keeps their place; any key or the note brings them down
    trim(); mirror(j.plain || ''); if (j.tail) mirror(j.tail); touched(); scrollOff = held; pinned = pin;
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
        if (r.op === '<'){ inText = FS.read(t[0]); if (inText == null){ errLine(tty, 'sh: ' + t[0] + ': no such file or directory\n'); bad = true; break; } }
        else if (r.op[0] === '2') errF = { path: t[0], append: r.op === '2>>', sink: buffer() };
        else outF = { path: t[0], append: r.op === '>>', sink: buffer() };
      }
      if (bad){ st = 1; stdin = ''; continue; }
      const isNull = f => f && FS.resolve(f.path, cwd) === '/dev/null';
      const sink = outF ? (isNull(outF) ? NULLSINK : outF.sink) : last ? tty : buffer();
      const errSink = errF ? (isNull(errF) ? NULLSINK : errF.sink) : tty;
      st = argv.length ? await runCmd(argv, { stdin: inText != null ? inText : stdin, piped: i > 0 || inText != null, sink, errSink }, j) : 0;
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
    if (argv[1] === '--help' && name !== 'echo' && (appDef || cmd) && M.TERM.cmds.man) return runCmd(['man', name], ctx, j);   // any command --help: its manual
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
    else if (ctx.errSink === tty) tty.rich(out().at(0, [argv.length > 2 ? 'this shell knows commands, not sentences. try ' : 'not something this machine knows. try ', 'f'], chip('help', 'n')));
    return 127;
  }
  function makeIo(ctx, j){
    const io = {
      stdin: ctx.stdin, piped: !!ctx.piped, fs: FS, ui: out, env: ENV, cwd, cols: COLS, rows: ROWS, tty: ctx.sink.tty, code: null,
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
      /* make a printed card choosable. Not modal: the prompt comes straight back, typing goes to it as
         usual, and only the arrows (or tab on an empty line) start choosing. Resolves at once. */
      pick(card){
        if (!ctx.sink.tty || j.dead || !card || !card.acts.length) return Promise.resolve(null);
        arm(card);
        return Promise.resolve(null);
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
  /* the card the arrows can choose from: the latest one printed, until the next command or keystroke */
  let armed = null;
  const verbOf = card => card.verb === 'read' || card.acts.every(a => a.post) ? 'read' : card.acts.every(a => a.copy) ? 'copy' : card.acts.every(a => !a.copy) ? 'open' : 'open';
  function arm(card){
    disarm(); armed = card; card.sel = -1; setFoot(card);
    const a = card.acts, v = verbOf(card);
    const say = TAP ? 'Tap a row to ' + v + ' it.' : 'Arrow keys choose, Enter to ' + v + (a.length > 1 ? ', or press 1 to ' + a.length : '') + '. Or click a row.';
    if (job) job.tail = say; else mirror(say);
    dirty = true;
  }
  function disarm(){
    const c = armed; armed = null; if (!c) return;
    if (!c.done){ c.sel = -1; c.foot = null; }
    dirty = true;
  }
  function setFoot(card){
    const dot = [' \u00b7 ', 'f'], v = verbOf(card), n = card.acts.length;
    if (TAP){ card.foot = [['tap to ' + v, 'f']]; return; }
    const len = f => f.reduce((a, x) => a + x[0].length, 0);
    const opts = card.sel < 0 ? [
      [['  ', 'n', null, 'arrows'], [' choose', 'f'], dot, ['enter', 'n'], [' ' + v, 'f']],
      [['  ', 'n', null, 'arrows'], dot, ['enter', 'n'], [' ' + v, 'f']],
    ] : [
      [['  ', 'n', null, 'arrows'], [' choose', 'f'], dot, ['enter', 'n'], [' ' + v, 'f']].concat(n > 1 ? [dot, ['1-' + n, 'n']] : [], [dot, ['esc', 'n'], [' done', 'f']]),
      [['  ', 'n', null, 'arrows'], [' choose', 'f'], dot, ['enter', 'n'], [' ' + v, 'f'], dot, ['esc', 'n']],
      [['  ', 'n', null, 'arrows'], dot, ['enter', 'n'], [' ' + v, 'f']],
    ];
    card.foot = opts.find(f => len(f) <= COLS - 3) || opts[opts.length - 1];
  }
  /* a key while a card is armed; returns true when the card used it, false to let the prompt have it */
  function cardKey(e){
    const card = armed, k = e.key, n = card.acts.length, choosing = card.sel >= 0;
    if (k === 'Tab' && !choosing) return false;   // tab on an empty line moves focus on (the arrows choose)
    const down = k === 'ArrowDown' || (k === 'Tab' && !e.shiftKey), up = k === 'ArrowUp' || (k === 'Tab' && e.shiftKey);
    if (!e.ctrlKey && !e.altKey && (down || up) && (choosing || !input)){
      card.sel = choosing ? (card.sel + (down ? 1 : n - 1)) % n : down ? 0 : n - 1;
      setFoot(card); const it = card.acts[card.sel];
      mirror((card.sel + 1) + ' of ' + n + ': ' + it.label + ', ' + (it.secret ? '' : it.full || it.value) + '. Enter to ' + verbOf(card) + '.');
      touched(); return true;
    }
    // a card with a single action (j's site, a lone link): a bare enter on an empty line takes it
    if (k === 'Enter' && !choosing && n === 1 && !input && !e.ctrlKey && !e.altKey){ armed = null; actOn(card, card.acts[0]); touched(); return true; }
    if (choosing && !e.ctrlKey && !e.altKey){
      let pick = -1;
      if (k === 'Enter') pick = card.sel;
      else if (/^[1-9]$/.test(k) && +k <= n) pick = +k - 1;
      if (pick >= 0){ armed = null; actOn(card, card.acts[pick]); touched(); return true; }
      if (k === 'Escape'){ disarm(); touched(); return true; }
    }
    if (k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta') return false;
    disarm();                                   // anything else: the card steps aside and the prompt takes the key
    return false;
  }
  /* copy or open one card row; synchronous, so it must run inside the key or tap that asked */
  function actOn(card, it){
    card.sel = it.ai; card.done = true; card.flash = now;
    let said;
    if (it.post){
      const ok = !!(M.reader && M.reader.open(it.post));
      card.foot = ok ? [['  ', 'b', null, 'out'], ['reading ', 'd'], [it.value, 'b']] : [['read ' + it.post, 'b'], ['  (the reader did not open)', 'f']];
      said = ok ? 'Opened ' + it.value + ' in the reader. Escape comes back.' : 'The reader is not available.';
    } else if (it.copy && !(typeof it.copy === 'function' ? it.copy() : it.copy)){   // a vault row after the vault locked
      card.foot = [['locked. run ', 'd'], ['vault', 'b'], [' again', 'd']]; said = 'The vault is locked.'; sfx('error');
    } else if (it.copy){
      const text = typeof it.copy === 'function' ? it.copy() : it.copy;
      const ok = copyText(text); sfx('beep');
      const what = it.secret ? it.label : text;               // a secret (a vault password) is never drawn or read out
      if (!it.secret) toast(ok, text);
      card.foot = ok ? [['  ', 'b', null, 'check'], ['copied ', 'd'], [what, 'b']] : it.secret ? [['could not reach the clipboard', 'd']] : [['select and copy: ', 'd'], [text, 'b']];
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
      const col = clamp(Math.floor((fx * W - PADX) / cw), 0, COLS - 1), row = clamp(Math.floor((fy * H - PADY) / ch), 0, ROWS - 1);
      const r = st.inst && typeof st.inst.tap === 'function' ? appCall('tap', col, row) : false;
      if (r){ if (app === st) st.dirty = true; return true; }
      /* the bottom row (where every app lists its keys) acts as esc when the app does not use the tap:
         phones have no esc key, so no app can keep someone in */
      if (row === ROWS - 1 && app === st && !st.done){
        const ev = { type: 'keydown', key: 'Escape', code: 'Escape', repeat: false, isComposing: false, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, synthetic: true, preventDefault(){}, stopPropagation(){} };
        if (appCall('key', ev) && app === st) st.dirty = true;
        return true;
      }
      return false;
    }
    const px = fx * W, py = fy * H;
    if (px < X(1) || px > X(COLS - 1)) return false;
    for (const r of drawnCards){
      for (const it of r.items){
        if (it.ai < 0) continue;
        const rt = r._top + ch * (it.y + 1);
        if (py < rt || py >= rt + ch * it.n) continue;
        if (armed === r) armed = null;
        actOn(r, it);
        touched();
        return true;
      }
    }
    /* a command chip types and runs its command; an inline link opens. A finger gets a little slack. */
    const slack = cw * 0.6;
    for (const h of drawnHits){
      if (px < h.x0 - slack || px > h.x1 + slack || py < h.top - 4 || py >= h.bot + 4) continue;
      if (h.link.stop){ if (job && !app) interrupt(); touched(); return true; }
      if (h.link.bottom){ toBottom(); dirty = true; return true; }
      if (h.link.cmd){
        if (app || job) return false;
        nudgeOff = true; touched();
        nav(h.link.cmd);
        sfx('beep'); return true;
      }
      const w = openTarget(h.link.url); const o = out(); o.at(0, ['opening ', 'd'], [bare(h.link.url), 'n']); if (!w) o.at(0, ['if nothing opened, the address is above', 'f']);
      if (!job) emit(o); touched(); return true;
    }
    return false;
  }
  /* is there something to click at (fx, fy)? a chip, a card row or a link: for a pointer cursor */
  /* also remembers what is under the pointer, so it can be lit (hitTest(-1, -1) when the pointer leaves) */
  function hitTest(fx, fy){
    const k = hitKey(fx, fy);
    if (k !== hoverKey){ hoverKey = k; dirty = true; }
    return !!k;
  }
  function hitKey(fx, fy){
    if (booting || app) return '';
    const px = fx * W, py = fy * H;
    if (px < X(1) || px > X(COLS - 1)) return '';
    for (const r of drawnCards) for (const it of r.items){
      if (it.ai < 0) continue;
      const rt = r._top + ch * (it.y + 1);
      if (py >= rt && py < rt + ch * it.n) return cardKeyOf(r._top, it);
    }
    for (const h of drawnHits){
      if (h.link.cmd && job) continue;
      if (px >= h.x0 && px <= h.x1 && py >= h.top && py < h.bot) return spanKeyOf(h.x0, h.top);
    }
    return '';
  }
  /* a key while io.ask is waiting */
  function askKey(e){
    const a = job.ask, k = e.key, ctl = e.ctrlKey && !e.altKey;
    if (ctl && k.toLowerCase() === 'c'){ endAsk(null); interrupt(); return true; }
    if (a.one){
      if (k.length > 1 && !['Enter', 'Escape', 'Backspace', 'Tab'].includes(k)) return true;
      const kk = k.length === 1 ? k.toLowerCase() : k, hit = a.keys.includes(kk);
      endAsk(hit ? kk : k === 'Escape' ? null : kk);
      if (!hit && k.length === 1 && !/^[ qxnQXN]$/.test(k) && !e.ctrlKey && !e.altKey) ahead += k;   // q, x, n, space dismiss and are used up
      return true;
    }
    if (k === 'Enter'){ endAsk(a.buf); return true; }
    if (k === 'Escape'){ endAsk(null); return true; }
    if (k === 'Backspace' || (ctl && k.toLowerCase() === 'u')){ a.buf = k === 'Backspace' && !e.ctrlKey && !e.altKey ? a.buf.slice(0, -1) : ''; }
    else if (k.length === 1 && !e.ctrlKey && !e.altKey && a.buf.length < 4096 && k >= ' ') a.buf += k;
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
  function interrupt(){
    if (!job) return;
    const j = job;
    if (app) closeApp(app, 130);
    j.dead = true;
    openRow = null;
    rows.push({ k: 't', i: 0, s: [['^C', 'd']] });
    j.plain += ' Stopped.';
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
    if (st && typeof st === 'object') key = 'o:' + (st.fg || 'normal') + ':' + (st.inverse ? 1 : 0) + (st.inset ? ':i' : '');
    else key = 's:' + (st || 'normal');
    let r = styleCache.get(key);
    if (!r){
      if (st && typeof st === 'object') r = { fg: LEVEL[st.fg] || (typeof st.fg === 'string' && /^(#|rgb|hsl)/.test(st.fg) ? st.fg : P.normal), inv: !!st.inverse, inset: !!st.inset };
      else r = { fg: LEVEL[st] || P.normal, inv: st === 'inverse' };
      styleCache.set(key, r);
    }
    return r;
  }
  const BLANK = cellStyle('normal');
  const grid = []; for (let y = 0; y < ROWS; y++){ grid.push(new Array(COLS)); }
  let gridCursor = null;
  const overlay = [];                  // scr.dot / scr.bar, six slots each: kind, x, y, a, b, colour (no objects per frame)
  const scr = {
    cols: COLS, rows: ROWS,
    clear(){ for (const r of grid) for (let x = 0; x < COLS; x++) r[x] = [' ', BLANK]; overlay.length = 0; },
    aspect: 2.25,                                   // a cell's height over its width (set from the font metrics)
    /* vectors over the grid at FLOAT cell coordinates, for things that move smoothly (a ball, a paddle):
       dot(x, y, r): a round dot centred at (x, y), radius r in cell widths; bar(x, y, w, h): a filled box */
    dot(x, y, r, style){ overlay.push(0, +x, +y, +r, 0, cellStyle(style).fg); },
    bar(x, y, w, h, style){ overlay.push(1, +x, +y, +w, +h, cellStyle(style).fg); },
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
  scr.clear(); scr.aspect = ch / cw;
  function launchApp(name, argv, ctx, j){
    const def = M.TERM.apps[name];
    return new Promise(resolve => {
      const st = { name, ctx, printed: [], resolve, inst: null, dirty: true, done: false };
      const api = st.api = {
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
    if (text) st.ctx.sink.write(text);            // (the tty adds it to the screen-reader log itself)
    if (e) errLine(st.ctx.errSink, st.name + ': ' + ((e && e.message) || e) + '\n');
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
    [/^(who are you|who is (this|kaiav|he)|who'?s kaiav|about (you|me|kaiav)|tell me about (yourself|kaiav)|bio|what do you do|what does (he|kaiav) do|what are you (building|working on|up to))$/, 'about'],
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
    const plain = q.replace(/(\w)['\u2019](\w)/g, '$1$2');        // what's, who's: words, not shell quotes
    if (!q || /[|;&<>$`'"]/.test(plain)) return l;
    const w = q.split(' ')[0];
    if (M.TERM.cmds[w] || M.TERM.apps[w] || hasAlias(w)) return l;   // a real command wins
    const ok = cmd => !!(M.TERM.cmds[cmd] || M.TERM.apps[cmd]);
    for (const [re, cmd] of PHRASES) if (re.test(q) && ok(cmd)) return said(cmd);
    if (plain.includes(' ')){                                          // a question in words: its first strong keyword
      const words = new Set(plain.split(/[^a-z0-9]+/).filter(Boolean));
      for (const [cmd, keys] of KEYWORDS) if (ok(cmd) && keys.some(k => k.includes(' ') ? (' ' + plain + ' ').includes(' ' + k + ' ') : words.has(k))) return said(cmd);
    }
    return l;
  }
  const KEYWORDS = [['contact', ['contact', 'email', 'reach', 'hire']], ['eden', ['eden']], ['j', ['j', 'founder', 'founders', 'rising']],
    ['writing', ['posts', 'post', 'blog', 'writing']], ['links', ['links', 'linkedin', 'twitter', 'x', 'socials', 'social']],
    ['about', ['who', 'about', 'yourself']], ['help', ['help', 'how', 'what can']]];
  /* a rewritten line says what it ran, quietly, before the output */
  /* spans hard-wrapped at the grid width, as a tty wraps a long command line */
  function ttyRows(spans){
    const out = []; let row = [], w = 0;
    for (const [s0, st] of spans){
      let t = s0;
      while (t.length){ if (w >= COLS){ out.push(row); row = []; w = 0; } const n = Math.min(COLS - w, t.length); row.push([t.slice(0, n), st]); w += n; t = t.slice(n); }
    }
    out.push(row);
    out.forEach((s, k) => rows.push(k ? { k: 't', i: 0, s, c: 2 } : { k: 't', i: 0, s }));
    shown = rows.length; partial = 0;
  }
  function said(cmd){ rows.push({ k: 't', i: 0, s: [['\u2192 ', 'f'], [cmd, 'd']] }); shown = rows.length; partial = 0; return cmd; }
  function execute(raw, programmatic){
    if (landing && raw.trim()) dismissLanding();   // the first command clears the landing, then runs on a clean screen
    ttyRows([...promptSpans(), [raw, 'n']]);
    openRow = null;
    input = ''; cur = 0; suggestion = ''; tabState = null; disarm();
    hIdx = history.length; hDraft = '';
    if (!raw.trim()){ toBottom(); dirty = true; return; }
    /* one of the welcome's words (or help), typed alone, opens the same page a click does (back, esc and backspace work
       the same way), and so does a phrase that means one ("who are you"); the line typed stays above it in the
       scrollback. An alias of the word wins. */
    const line = forgive(raw), w = line.trim().toLowerCase().replace(/\s+/g, ' '), w0 = w.split(' ')[0];
    if (!programmatic && (PAGE_WORDS.includes(w) || w === 'help' || w === 'help all') && !hasAlias(w0) && M.TERM.cmds[w0] === B[w0]){ nav(w); return; }
    pageKeys = false;
    mirror('', raw);
    runLine(line, programmatic);
  }

  /* ---- completion and typeahead ---- */
  const shEsc = n => n.replace(/[\s'"\\|&;<>$`#]/g, '\\$&');   // what the lexer reads back as one word
  const unesc = w => w.replace(/\\(.)/g, '$1');
  function context(){
    const before = input.slice(0, cur);
    // a word runs back to an unescaped separator: "my\ notes.txt" is one word
    let i = before.length; while (i > 0 && (!/[\s|;&<>]/.test(before[i - 1]) || before[i - 2] === '\\')) i--;
    const word = before.slice(i);
    const pre = before.slice(0, i).trimEnd();
    const cmdPos = !pre || /(\|\||&&|[|;&])$/.test(pre);
    if (cmdPos && !word.includes('/')) return { kind: 'cmd', q: word, from: i, items: cmdItems() };
    const segStart = Math.max(pre.lastIndexOf('|'), pre.lastIndexOf(';'), pre.lastIndexOf('&'));
    const cname = pre.slice(segStart + 1).trim().split(/\s+/)[0] || '';
    if (/^(man|which|help)$/.test(cname)) return { kind: 'arg', q: word, from: i, items: cname === 'help' ? [{ name: 'all' }, ...cmdItems()] : cmdItems() };
    if (cname === 'read' || /^open\s+post$/.test(pre.slice(segStart + 1).trim())) return { kind: 'arg', q: word, from: i, items: POSTITEMS };
    if (cname === 'open') return { kind: 'arg', q: word, from: i, items: OPEN };
    const cdef = M.TERM.cmds[cname];                                   // a command can complete its own arguments
    if (cdef && typeof cdef.complete === 'function' && !word.includes('/')){
      let l = null; try { l = cdef.complete(pre.slice(segStart + 1).trim().split(/\s+/).slice(1), word); } catch (e){}
      if (Array.isArray(l) && l.length) return { kind: 'arg', q: word, from: i, items: l.map(n => ({ name: String(n) })), all: true };
    }
    if (word.startsWith('$')) return { kind: 'path', q: word.slice(1), from: i + 1, items: Object.keys(ENV).map(k => ({ name: k })) };
    // paths: names are matched unescaped and offered escaped, so a name with spaces completes to something the shell reads
    const slash = word.lastIndexOf('/');
    const dirPart = unesc(word.slice(0, slash + 1)), q = word.slice(slash + 1), uq = unesc(q);
    const ents = FS.list(dirPart ? (dirPart === '/' ? '/' : dirPart.replace(/\/$/, '')) : '.');
    if (!ents) return { kind: 'path', q, from: i + slash + 1, items: [] };
    return { kind: 'path', q, from: i + slash + 1, items: ents.filter(e => (uq[0] === '.' || e.name[0] !== '.') && (cname !== 'cd' || e.dir)).map(e => ({ name: shEsc(e.name) + (e.dir ? '/' : '') })) };
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
    if (list.length === 1){ accept(list[0], ctx.from, true); tabState = null; mirror('Completed: ' + input); return; }   // the hidden input field never holds the line, so say it
    if (!list[0].startsWith(ctx.q)){                                    // a typo: take the best guess, as the ghost offered
      const base = input, bcur = cur; accept(list[0], ctx.from, false); mirror('Completed: ' + input + '. Tab again for others.');
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
    pageKeys = false;
    if (input.length + s.length > 4096) s = s.slice(0, 4096 - input.length);
    input = input.slice(0, cur) + s + input.slice(cur); cur += s.length;
    suggestion = ''; tabState = null;
  }
  function touched(){ blinkT0 = now; idleT0 = now; blinkOn = true; toBottom(); dirty = true; }
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
    pinned = false;
    const next = clamp(scrollOff + units, 0, max);
    if (next !== scrollOff){ scrollOff = next; dirty = true; }
  }
  function clearScreen(){ landing = null; rows = []; shown = 0; partial = 0; disarm(); openRow = null; pageRow = null; toBottom(); dirty = true; }

  /* ---- pages ---- */
  /* a fresh page: what was on screen scrolls off above (still there, scrolling up), the prompt line is reset */
  function leave(){
    revealAll(); disarm(); openRow = null; toBottom();
    input = ''; cur = 0; suggestion = ''; tabState = null; rs = null; hIdx = history.length; hDraft = '';
    pageKeys = true; nudgeOff = true; hoverKey = ''; dirty = true;
  }
  function openPage(cmd, note, noHist){
    leave();
    const r = { k: 't', i: 2, s: [['\u2190 back', 'd', { cmd: 'back' }]] };   // (the arrow is drawn: VT323 has none)
    rows.push(r); pageRow = r; shown = rows.length; partial = 0; trim(); pinned = true;
    page = cmd;
    if (note) mirror(note); else mirror('', cmd);
    eatBlank = true;
    runLine(forgive(cmd), noHist, true);   // a chip or page means the real command, whatever is aliased over it
  }
  function goHome(note){
    leave(); pages = []; page = '';
    const w = welcome(out()); if (w.rows[0]) w.rows[0].wel = true;
    pageRow = w.rows[0] || null;
    emit(w, (note ? note + ' ' : '') + (C.name || '') + '. ' + (A.role || '') + '. Type help to begin.');
  }
  function goBack(){
    if (!pages.length){ goHome(page ? 'Back to the welcome.' : ''); return; }
    const prev = pages.pop();
    if (!prev){ goHome('Back to the welcome.'); return; }
    openPage(prev, 'Back to ' + prev + '.', true);
  }
  /* a chip: back and home, a full-screen app as before (it returns to this page), anything else a new page */
  function nav(cmd, noHist){
    cmd = String(cmd || '').trim(); if (!cmd) return;
    dismissLanding();
    if (cmd === 'back') return goBack();
    if (cmd === 'home') return goHome();
    const w = cmd.split(/\s+/)[0];
    if (M.TERM.apps[w] && !M.TERM.cmds[w]){ const pk = pageKeys; revealAll(); disarm(); input = ''; cur = 0; execute(cmd, noHist); pageKeys = pk; return; }
    if (cmd !== page){ pages.push(page); if (pages.length > PAGES_MAX) pages.shift(); }
    openPage(cmd, null, noHist);
  }
  /* where the page starts, in rows from the top of the scrollback; -1 when there is none */
  function pageUnits(){
    if (!pageRow) return -1;
    let u = 0; for (const r of rows){ if (r === pageRow) return u; u += heightOf(r); }
    return -1;
  }

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
    if (k === 'Enter'){ const keep = !s.fail && s.q && s.i < history.length; rs = null; if (keep){ touched(); execute(input); return true; } return done(false); }
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
    if (booting){ skipBoot(); if (k === 'Escape' || k === 'Enter' || k === ' ') return true; }   // any other key skips the boot AND counts
    if (landing && !app) DEMO.key();              // the intro answers each key (a bar flashes, the logo jumps)
    const ctrl = e.ctrlKey, alt = e.altKey, c = k.toLowerCase();
    if (app){                                   // apps get keys first
      const st = app;
      if (ctrl && !alt && c === 'c' && !(M.TERM.apps[st.name] || {}).ctrlC){ interrupt(); return true; }   // ctrl+c stops every app but the editor
      const used = appCall('key', e);
      if (used){ if (app === st) st.dirty = true; return true; }
      if (ctrl && c === 'c' && app === st) interrupt();
      return true;
    }
    if (job && job.ask){ if (typing()) revealAll(); return askKey(e); }
    if (typing()){ revealAll(); if (!input && (k === 'Enter' || (k === 'Escape' && !(pageKeys && page && !job)) || k === ' ')) return true; }   // a key skips the typing-out; a typed line still runs (esc on a page still goes back)
    if (job){                                   // a command is running: only ctrl+c, ctrl+l and scrolling
      if (ctrl && c === 'c'){ interrupt(); return true; }
      if (ctrl && c === 'l'){ clearScreen(); return true; }
      if (k === 'PageUp'){ scrollBy(ROWS - 2); return true; }
      if (k === 'PageDown'){ scrollBy(-(ROWS - 2)); return true; }
      if (k.length === 1 && !ctrl && !alt){ if (ahead.length < 400) ahead += k; dirty = true; return true; }     // typed ahead: lands on the next prompt
      if (k === 'Enter' && !alt){ if (ahead.length < 400) ahead += '\n'; dirty = true; return true; }            // ...and Enter queues it, like a real tty
      if (k === 'Backspace'){ ahead = ahead.slice(0, -1); dirty = true; return true; }
      return ['Enter', 'Escape'].includes(k);
    }
    if (rs) return searchKey(e);
    if (armed && cardKey(e)) return true;
    if (ctrl && !alt && c === 'r'){ rs = { q: '', i: history.length, draft: input, dcur: cur, fail: false }; tabState = null; suggestion = ''; touched(); return true; }
    if (alt && !ctrl && (c === 'b' || c === 'f' || k === '\u222b' || k === '\u0192')){ cur = c === 'b' || k === '\u222b' ? wordLeft(cur) : wordRight(cur); touched(); return true; }
    if (ctrl && !alt){
      if (c === 'l'){ clearScreen(); touched(); return true; }
      if (c === 'c'){
        ttyRows([...promptSpans(), [input, 'n'], ['^C', 'd']]);
        input = ''; cur = 0; suggestion = ''; hIdx = history.length; status = 130; touched(); return true;
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
        if (!input && suggestion){ const s = suggestion; touched(); execute(s); return true; }
        touched(); execute(input); return true;   // (touched first: a page that opens stays at its top)
      }
      case 'Backspace':
        if (!input && !alt && pageKeys && page){ touched(); goBack(); return true; }   // on a page, nothing typed yet: back
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
      case 'Tab':                                  // completes a line with text; on an empty line (and shift+tab always) focus moves on
        if (e.shiftKey || !input) return false;
        tab(false); touched(); return true;
      case 'Escape':
        if (!input && pageKeys && page){ touched(); goBack(); return true; }
        suggestion = ''; tabState = null; touched(); return true;
    }
    /* space on an empty line while scrolled up reads on a screen at a time, as in a pager (shift+space goes back):
       laptops often have no page keys */
    if (k === ' ' && !input && !alt && (scrollOff > 0 || (e.shiftKey && totalUnits() > ROWS))){ scrollBy(e.shiftKey ? ROWS - 2 : -(ROWS - 2)); return true; }
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
    if (landing && !app && str) DEMO.key();
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
    if (armed && !job) disarm();                // phones: typing moves on from a card
    if (job && job.ask){ for (const ch of String(str)){ if (!job || !job.ask) break; askKey({ key: ch === '\n' || ch === '\r' ? 'Enter' : ch, ctrlKey: false, altKey: false }); } return; }
    if (job){ ahead = (ahead + String(str).replace(/\r\n?/g, '\n').replace(/\t/g, ' ')).slice(0, 4000); dirty = true; return; }
    if (rs){ for (const ch of String(str)) searchKey({ key: ch === '\n' ? 'Enter' : ch, ctrlKey: false, altKey: false }); return; }
    if (typing()) revealAll();
    const parts = String(str).replace(/\t/g, ' ').split(/\r\n?|\n/);
    insert(parts[0]); touched();
    if (parts.length > 1){ execute(input); ahead = parts.slice(1).join('\n').slice(0, 4000); if (!job) flushAhead(); }   // a pasted script: one line at a time
  }
  function run(cmd){
    cmd = String(cmd || '').trim(); if (!cmd) return;
    if (booting) skipBoot();
    if (app || job) return;
    touched(); nav(cmd, true);                    // a deep link opens as a page (back: the welcome)
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
    store.set(BOOT_KEY, 1);
    const w = landingRows();
    pageRow = null; page = ''; pages = [];
    emit(w, (C.name || '') + '. ' + (A.role || '') + '. An animated intro: the letters K N spin over copper bars while a message scrolls along the bottom. Type help and press Enter to get started.');
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
      const on = (active && it.ai === r.sel) || flashing;
      if (flashing){ g.fillStyle = P.bright; g.fillRect(X(2), rt + 3, X(COLS - 2) - X(2), ch * it.n - 6); }
      if (on && !flashing){ g.fillStyle = P.normal; g.fillRect(X(2), rt + 3, X(COLS - 2) - X(2), ch * it.n - 6); }
      else if (!flashing && it.ai >= 0 && hoverKey === cardKeyOf(top, it)){ g.strokeStyle = P.dim; g.lineWidth = 2; g.strokeRect(X(2), rt + 3, X(COLS - 2) - X(2), ch * it.n - 6); }
      const st = s => on ? 'z' : s;
      if (it.ai >= 0 && active) text(String(it.ai + 1), 3, rt, st('f'));   // numbers only while choosing: that is when digits work
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
    setFont(k); g.fillStyle = color(st);
    if (k === 1 && SPAN_VEC.test(s)){ const c0 = color(st); fillT(s.replace(SPAN_VEC_G, ' '), X(col), top + fs * 0.68); for (let q = 0; q < s.length; q++) if (SPAN_VEC.test(s[q])) vecGlyph(s[q], col + q, top, c0); return; }
    fillT(s, X(col), top + fs * k * 0.68);
  }
  function drawSpans(r, top, limit, k = 1){
    let col = r.i || 0, left = limit;
    for (const sp of r.s){
      if (left <= 0) break;
      let s = sp[0]; if (s.length > left) s = s.slice(0, left); left -= s.length;
      const link = sp[2];
      const selected = sp[1] === 'i';
      if (selected){ g.fillStyle = P.normal; g.fillRect(X(col) - 3, top + 1, s.length * cw * k + 6, ch * k - 2); }
      const hov = link && !selected && hoverKey && hoverKey === spanKeyOf(X(col), top);
      setFont(k); g.fillStyle = selected ? P.bg : hov ? P.bright : color(sp[1]);
      if (k === 1 && SPAN_VEC.test(s)){                // arrows and the lock, drawn: VT323 has neither
        fillT(s.replace(SPAN_VEC_G, ' '), X(col), top + fs * 0.68);
        for (let q = 0; q < s.length; q++) if (SPAN_VEC.test(s[q])) vecGlyph(s[q], col + q, top, selected ? P.bg : hov ? P.bright : color(sp[1]));
      } else fillT(s, X(col), top + fs * k * 0.68);
      if (link && !selected){ g.fillStyle = hov ? P.normal : link.cmd || link.stop ? P.faint : P.dim; g.fillRect(X(col), top + fs * k * 0.76, s.length * cw * k, hov ? 3 : 2); }
      if (link && (link.cmd || link.url || link.stop) && s.trim()) drawnHits.push({ x0: X(col), x1: X(col + s.length * k), top, bot: top + ch * k, link });
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
  /* a page that fits starts at the top of the tube: the view runs on to a screen below its first row */
  function totalUnits(){ const raw = rawUnits(), p = pageUnits(); return p >= 0 ? Math.max(raw, p + ROWS) : raw; }
  function rawUnits(){
    let u = 0; for (let i = 0; i < rows.length && i <= shown; i++) if (i < shown || partial > 0 || rows[i].k === 'viz') u += i < rows.length ? heightOf(rows[i]) : 0;
    return u + (promptVisible() ? 1 + belowPrompt().length : job && job.ask && !app && !typing() ? askRows().length : 0);
  }
  /* quiet rows under the prompt: the ctrl+r search line, or the tab candidates */
  function fitSpans(opts){ const len = f => f.reduce((n, x) => n + x[0].length, 0); return opts.find(f => len(f) <= COLS) || opts[opts.length - 1]; }
  function belowPrompt(){
    if (rs){
      const q = rs.q, st = rs.fail ? 'd' : 'b';
      return [fitSpans([
        [['search ', 'f'], [q, st], [rs.fail ? '  no match' : '', 'f'], ['   ctrl+r older \u00b7 enter run \u00b7 esc', 'f']],
        [['search ', 'f'], [q, st], [rs.fail ? '  no match' : '', 'f'], ['   ^R older \u00b7 esc', 'f']],
        [['search ', 'f'], [q, st]],
      ])];
    }
    const t = tabState;
    if (!t || !t.cyc || t.list.length < 2 || t.after !== input){
      if (!nudgeOn()) return [];
      if (input) return [[['press ', 'f'], ['enter', 'd'], [' to run it', 'f']]];
      return [[['try ', 'f'], chip('about', 'd'), [' or ', 'f'], chip('help', 'd')]];
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
  const nudgeOn = () => !landing && fresh && !nudgeOff && okRuns === 0 && !armed && promptVisible() && idleT0 >= 0 && now - idleT0 > 8;

  /* a one-key question wraps like any other line (nothing is typed on it); a typed answer stays on one line */
  const askRows = () => job.ask.one ? fitRow(job.ask.spans, COLS - job.ask.i) : [null];
  function drawAsk(top){                 // io.ask's line: the question, what is typed (dots when secret), a cursor
    if (job.ask.one){ const rs = askRows(); rs.forEach((s, k) => drawSpans({ i: job.ask.i, s }, top + k * ch, 999)); promptY = top + ch * rs.length; return; }
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
    if (off > 0){ const k = body.findIndex(x => x[0]); if (k >= 0){ body[k] = [body[k][0].slice(1), body[k][1]]; body.unshift(['\u2190', 'f']); } }   // more to the left
    drawSpans({ i: 0, s: [...promptSpans(), ...body] }, top, 999);
    if (input.length > off + room && PL + cur - off !== COLS - 1) text('\u2192', COLS - 1, top, 'f');   // more to the right
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
    if (blinkOn){
      g.fillStyle = P.normal; g.fillRect(cx, top + 3, cw, ch - 6);
      const under = input[cur] || (gh && gh.kind === 'prefix' ? gh.text[0] : '');
      if (under && SPAN_VEC.test(under)) vecGlyph(under, PL + cur - off, top, P.bg);
      else if (under){ setFont(); g.fillStyle = P.bg; fillT(under, cx, top + fs * 0.68); }
    }
  }
  let drawnCards = [], drawnHits = [];   // what is on screen and can be clicked or tapped
  let hoverKey = '', lastFirst = -1, lastTotal = 0;   // the clickable thing under the mouse; the view, to notice it move
  const cardKeyOf = (top, it) => 'c' + Math.round(top) + ':' + it.ai, spanKeyOf = (x0, top) => 's' + Math.round(x0) + ':' + Math.round(top);
  const VEC_RE = /[\u2190\u2191\u2192\u2193\u00b7\u2022\u25cf\ue000~]/g;
  const SPAN_VEC = /[\u2190-\u2193\u2022\u25cf\ue000~]/, SPAN_VEC_G = /[\u2190-\u2193\u2022\u25cf\ue000~]/g;
  function vecGlyph(c, col, top, colr){
    const cx = X(col) + cw / 2, cy = top + ch * 0.5, a = cw * 0.36;
    g.fillStyle = colr;
    if (c === '\u00b7'){ g.fillRect(cx - 2, cy - 2, 4, 4); return; }
    if (c === '~'){                                        // VT323's tilde reads as a raised "N": a plain wave instead
      const w = cw * 0.74, amp = ch * 0.085, y0 = top + ch * 0.47;
      g.strokeStyle = colr; g.lineWidth = Math.max(2, fs * 0.07); g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath();
      for (let k = 0; k <= 16; k++){ const t = k / 16, x = cx - w / 2 + t * w, y = y0 - Math.sin(t * Math.PI * 2) * amp; if (k) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke(); g.lineCap = 'butt'; g.lineJoin = 'miter';
      return;
    }
    if (c === '\u25cf'){ g.beginPath(); g.arc(cx, cy, cw * 0.38, 0, 6.2832); g.fill(); return; }   // a ball (breakout): round whatever the cell shape
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
    setFont();
    for (let y = 0; y < ROWS; y++){
      const top = PADY + y * ch, r = grid[y];
      let x = 0;
      while (x < COLS){
        const s = r[x][1]; let x1 = x, str = '';
        while (x1 < COLS && r[x1][1] === s){ str += r[x1][0]; x1++; }
        const plain = str.replace(VEC_RE, ' ');
        if (s.inv){ const p = s.inset ? Math.round(ch * 0.14) : 0; g.fillStyle = s.fg; g.fillRect(X(x), top + p, (x1 - x) * cw + 0.5, ch - 2 * p); if (plain.trim()){ g.fillStyle = P.bg; fillT(plain, X(x), top + fs * 0.68); } }
        else if (plain.trim()){ g.fillStyle = s.fg; fillT(plain, X(x), top + fs * 0.68); }
        if (plain !== str) for (let k = 0; k < str.length; k++) if (VEC_RE.test(str[k])){ VEC_RE.lastIndex = 0; vecGlyph(str[k], x + k, top, s.inv ? P.bg : s.fg); }
        VEC_RE.lastIndex = 0;
        x = x1;
      }
    }
    for (let i = 0; i < overlay.length; i += 6){
      const x = X(overlay[i + 1]), y = PADY + overlay[i + 2] * ch, a = overlay[i + 3], b = overlay[i + 4];
      g.fillStyle = overlay[i + 5];
      if (overlay[i] === 1){ g.fillRect(x, y, a * cw, b * ch); continue; }
      const rad = Math.max(0.5, a * cw);
      g.beginPath(); g.arc(x, y, rad, 0, 6.2832); g.fill();
      lumAcc += 3.1416 * rad * rad * lumOf(overlay[i + 5]);
    }
    const c = gridCursor;
    if (c && blinkOn && c.x >= 0 && c.x < COLS && c.y >= 0 && c.y < ROWS){
      const top = PADY + c.y * ch, cell = grid[c.y][c.x];
      g.fillStyle = P.normal;
      if (c.shape === 'bar') g.fillRect(X(c.x), top + 3, 3, ch - 6);
      else if (c.shape === 'under') g.fillRect(X(c.x), top + ch - 7, cw, 3);
      else { g.fillRect(X(c.x), top + 3, cw, ch - 6); if (SPAN_VEC.test(cell[0])) vecGlyph(cell[0], c.x, top, P.bg); else { g.fillStyle = P.bg; fillT(cell[0], X(c.x), top + fs * 0.68); } }
    }
  }

  function draw(){
    lumAcc = 0; g.fillStyle = P.bg; g.fillRect(0, 0, W, H);
    g.textBaseline = 'alphabetic';
    animFps = 0;
    if (booting){ drawBoot(); return; }
    drawnCards = []; drawnHits.length = 0;
    if (app){ drawGrid(); return; }
    // lay out units bottom-anchored
    const total = totalUnits();
    if (scrollOff > 0 && total > lastTotal) scrollOff += total - lastTotal;   // scrolled up: hold the view while output arrives
    lastTotal = total;
    scrollOff = clamp(scrollOff, 0, Math.max(0, total - ROWS));
    if (pinned){ const pu0 = pageUnits(); if (pu0 >= 0) scrollOff = Math.max(0, total - ROWS - pu0); else pinned = false; }
    const first = Math.max(0, total - ROWS - scrollOff);
    if (first !== lastFirst){ lastFirst = first; hoverKey = ''; }
    /* a short history (the welcome) sits a little below the top of the tube, not jammed against it */
    // the welcome sits a little lower on the landscape tube; a phone column starts at the top
    const raw = rawUnits(), pu = pageUnits();
    const lift = !TAP && aspect > 1 && pageRow && pageRow.wel && pu >= 0 && !scrollOff ? clamp(ROWS - (raw - pu), 0, Math.min(4, Math.round(ROWS / 6))) : 0;
    g.save(); g.beginPath(); g.rect(0, PADY - 4, W, ROWS * ch + 8); g.clip();
    let u = 0, lastEnd = 0;                     // lastEnd: how far the bottom row of the view is written (the scroll note fits after it)
    const last = Math.min(rows.length - 1, shown);
    for (let i = 0; i <= last; i++){
      const r = rows[i]; const h = heightOf(r);
      const isPartial = i === shown;
      if (isPartial && partial <= 0 && r.k !== 'viz' && r.k !== 'card') break;
      if (u + h > first && u < first + ROWS){
        const top = PADY + (u - first + lift) * ch;
        if (u + h >= first + ROWS) lastEnd = r.k === 't' ? (r.i || 0) + rowLen(r) - /\s*$/.exec(r.s.map(s => s[0]).join(''))[0].length : r.k === 'big' ? (r.i || 0) + lenOf(r) * 2 : COLS;
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
          g.restore(); curFont = '';
          if (r.live && !REDUCED) animFps = Math.max(animFps, r.live(age) || 0);
        }
      }
      u += h;
      if (isPartial) break;
    }
    if (promptVisible()){
      if (u >= first && u < first + ROWS) drawPrompt(PADY + (u - first + lift) * ch);
      belowPrompt().forEach((r, k) => { const y = u + 1 + k; if (y >= first && y < first + ROWS) drawSpans({ i: 0, s: r }, PADY + (y - first + lift) * ch, 999); });
    } else if (job && job.ask && !app && !typing()){
      if (u >= first && u < first + ROWS) drawAsk(PADY + (u - first + lift) * ch);
    } else if (job && !app && !typing() && ahead && u >= first && u < first + ROWS){
      drawSpans({ i: 0, s: [[ahead.replace(/\n/g, ' ').slice(-(COLS - 1)), 'd']] }, PADY + (u - first + lift) * ch, 999);   // typed ahead: echoed now, run at the prompt
    } else if (job && !app && !typing() && now - job.t0 > 0.9 && u >= first && u < first + ROWS){
      drawSpans({ i: 0, s: [[TAP ? 'tap here to stop' : COLS >= 46 ? 'ctrl+c to stop' : '^C stops', 'f', { stop: true }]] }, PADY + (u - first + lift) * ch, 999);
    }
    g.restore(); curFont = '';
    // scroll position: a thin rail on the right and a quiet note at the bottom
    if (scrollOff > 0){
      const railX = W - 22, railTop = PADY, railH = ROWS * ch;
      g.fillStyle = P.faint; g.fillRect(railX, railTop, 2, railH);
      const th = Math.max(24, railH * ROWS / total), ty = railTop + (railH - th) * (first / Math.max(1, total - ROWS));
      g.fillStyle = P.dim; g.fillRect(railX - 2, ty, 6, th);
      const below = raw - first - ROWS;          // (under a short page the view runs on past the end: nothing more, just back down)
      /* the longest note that fits after what the bottom row says, so it never sits over a word or a chip */
      const end = u >= first + ROWS ? lastEnd : promptVisible() && u === first + ROWS - 1 - lift ? promptLen() + input.length + 1 : 0;
      const what = below > 0 ? below + ' more below' : 'back down';
      const note = ['  ' + what + (COLS >= 46 && !TAP ? '  space ' : ' '), '  ' + what + ' ', '  ' + (below > 0 ? below + ' more' : 'down') + ' ', ' ↓ ']
        .find(s => COLS - s.length >= end + 1) || ' ↓ ';
      const nx = COLS - note.length, top = PADY + (ROWS - 1) * ch;
      g.fillStyle = P.bg; g.fillRect(X(nx) - 8, top - 4, note.length * cw + 8, ch + 8);
      text(note, nx, top, 'd');
      drawnHits = drawnHits.filter(h => h.bot <= top - 4 || h.x1 <= X(nx) - 8);                         // what the note covers is not tappable
      drawnHits.push({ x0: X(nx + 2), x1: X(COLS - 1), top, bot: top + ch, link: { bottom: true } });   // a tap on it goes back down
    }
  }
  /* ---- boot screen ---- */
  function drawBoot(){
    const t = REDUCED ? 99 : bootT * 1.85 / BOOT_END, top = r => PADY + r * ch;   // the timeline below is in 1.85s units
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
      /* long output still finishes in under a second: the rate is set from what is left to show whenever
         rows arrive (a 400-line cat types out in ~0.8 s instead of ~12 s of redraws) */
      if (rateRows !== rows.length || rateShown > shown){
        let pend = -partial; for (let i = shown; i < rows.length && i - shown < 5000; i++) pend += costOf(rows[i]);
        rate = Math.max(RATE, pend / 0.8); rateRows = rows.length; rateShown = shown;
      }
      carry += dt * rate;
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
    if (pendingNav && !job && !app){ const n = pendingNav; pendingNav = null; if (n === 'home') goHome(); else goBack(); changed = true; }
    if (runQueued && !job && !app && !rs){ runQueued = false; execute(input); if (!job) flushAhead(); changed = true; }
    if (job && !job.hinted && !app && now - job.t0 > 0.9){ job.hinted = true; changed = true; }
    const on = ((t - blinkT0) % 1.06) < 0.53;
    if (on !== blinkOn){ blinkOn = on; if (promptVisible() || (job && job.ask && !job.ask.one) || (app && gridCursor)) changed = true; }
    if (idleT0 < 0 && !booting) idleT0 = t;
    const nv = nudgeOn(); if (nv !== lastNudge){ lastNudge = nv; changed = true; }
    if (!app && animFps > 0 && t - lastAnim >= 1 / animFps - 1e-3) changed = true;
    if (!app) for (const r of drawnCards) if (r.flash != null && t - r.flash < 0.45) changed = true;   // tap / pick flash
    if (changed){ draw(); lastAnim = t; dirty = false; }
    return changed;
  }

  /* a new screen size (a phone turned, a window resized): the same machine on a new grid. History, files, the
     line being typed and a running app all stay; scrollback rows wider than the grid are wrapped again, cards
     are laid out afresh, and an app sees the new api.cols / api.rows (and scr) on its next render. */
  function resize(asp, cols){
    if (asp > 0.3 && asp < 3) aspect = asp;
    if (cols >= 32) COLS = cols | 0;
    H = Math.round(W / aspect); canvas.height = H;          // (resets the context: shaping and font are set again below)
    cw = (W - 2 * PADX) / COLS; ch = Math.round(cw / 0.4 * LINE); fs = cw / advance;
    ROWS = Math.floor((H - 64) / ch); PADY = Math.round((H - ROWS * ch) / 2);
    fontStr = {}; curFont = ''; noShaping();
    ENV.COLUMNS = String(COLS); ENV.LINES = String(ROWS);
    grid.length = 0; for (let y = 0; y < ROWS; y++) grid.push(new Array(COLS));
    scr.cols = COLS; scr.rows = ROWS; scr.aspect = ch / cw; scr.clear();
    if (app){ if (app.api){ app.api.cols = COLS; app.api.rows = ROWS; } if (gridCursor && (gridCursor.x >= COLS || gridCursor.y >= ROWS)) gridCursor = null; app.dirty = true; }
    if (landing) landing.viz.h = Math.max(4, ROWS - 2);   // the intro refits to the new tube
    const next = []; let pageAt = -1;
    for (let a = 0; a < rows.length; a++){
      const r = rows[a];
      if (r === pageRow) pageAt = next.length;
      if (r.k === 't'){                          // a line and the rows it wrapped onto: joined, then wrapped again if too wide
        let b = a + 1; while (b < rows.length && rows[b].k === 't' && rows[b].c && (rows[b].i || 0) === (r.i || 0)) b++;
        const grp = rows.slice(a, b); a = b - 1;
        if (!grp.some(x => lenOf(x) > COLS)){ next.push(...grp); continue; }
        const first = r.s.map(x => x[0]).join('');
        const hang = /^\s*[-*\u2022]\s/.test(first) ? '  ' : grp.length > 1 && grp[1].c === 1 ? /^\s*/.exec(grp[1].s.map(x => x[0]).join(''))[0].slice(0, 12) : '';   // a bullet's or a column's indent
        const spans = [];
        grp.forEach((x, k) => {
          const ss = x.s.map(y => y.slice());
          if (k && x.c !== 2){ while (ss.length && !ss[0][0].trim()) ss.shift(); if (ss.length){ ss[0][0] = ss[0][0].replace(/^\s+/, ''); spans.push([' ', 'n']); } }   // (an exact wrap joins as it was)
          spans.push(...ss);
        });
        fitRow(spans, COLS - (r.i || 0) - hang.length).forEach((s, k) => next.push(k ? { k: 't', i: r.i, s: hang ? [[hang, 'n'], ...s] : s, c: 1 } : { k: 't', i: r.i, s, c: r.c }));
        if (grp.includes(openRow)) openRow = null;
        continue;
      }
      if (r.k === 'card' && r.spec){
        const c = Object.assign(makeCard(r.spec), { sel: r.sel, done: r.done, flash: r.flash, foot: r.foot });
        if (armed === r){ armed = c; setFoot(c); }
        next.push(c); continue;
      }
      next.push(r);
    }
    if (pageAt >= 0 && next[pageAt]){ if (pageRow.wel) next[pageAt].wel = true; pageRow = next[pageAt]; }
    rows = next; revealAll(); toBottom(); hoverKey = ''; lastFirst = -1; tabState = null;
    dirty = true; draw();
  }

  if (!booting) endBoot();
  draw();
  /* the pointer over the tube (u, v: 0..1 of the canvas, -1 off it; down: a button held): the intro's logo leans toward it */
  function pointer(u, v, down){ if (landing) DEMO.pointer(u, v, down); }
  /* phones (main.js's dock): what the word being typed could become, best first (q: match q as a command instead),
     and taking one. pick() returns true when the line is then a whole command, ready to run */
  function suggest(q){
    if (booting || app || rs || (job && q == null)) return [];
    let ctx;
    if (q != null) ctx = { kind: 'cmd', q: String(q), from: 0, items: cmdItems() };
    else { if (!input.trim() || cur !== input.length) return []; ctx = context(); }
    if (!ctx.q) return [];
    const l = candidates(ctx);
    return l.filter(x => x.startsWith(ctx.q)).concat(l.filter(x => !x.startsWith(ctx.q))).slice(0, 8);
  }
  function pick(word){
    if (booting || app || job || rs || !word) return false;
    const ctx = context(); word = String(word);
    accept(word, ctx.from, true); tabState = null; suggestion = ''; touched(); mirror('Completed: ' + input);
    return ctx.kind === 'cmd' && !needsArg(word) && input.trim() === word;
  }
  return { canvas, handleKey, handleKeyUp, handleTap, hitTest, insertText, update, run, scroll, resize, pointer, suggest, pick,
    get line(){ return input; },                          // the line being typed
    get app(){ return app ? app.name : ''; },             // the full-screen app running, or ''
    get page(){ return page; },                           // the page on screen ('' = the welcome)
    get canBack(){ return !booting && !landing && !app && !job && !!(page || pages.length); },   // a page is open: back has somewhere to go
    get scrollInfo(){ return { off: scrollOff, max: Math.max(0, totalUnits() - ROWS), rowH: ch / H }; },   // off: rows up from the bottom; rowH: a row, 0..1 of the canvas
    get cursorY(){ return promptY / H; },
    get lum(){ return Math.min(1, lumAcc / (W * H)); },   // 0..1, the mean brightness of the last frame drawn
    get busy(){ return !!(app || job); } };   // a full-screen app or a running command: don't rebuild under it
};
})();
