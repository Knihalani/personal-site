/* editor.js: a small modeless text editor for the terminal, nano-style (see CONTRACT.md, "Terminal extension API").
   edit [file]   (also nano, vi, vim: the same editor)

   Layout, top to bottom: an inverse title bar, the text (soft-wrapped at word boundaries, optional line-number
   gutter), a message / prompt line, and two lines of shortcuts. Plain ASCII only: VT323 has no box glyphs.
   Built-in (locked) files open read-only; ^S then saves a copy somewhere else.
   Phones have no Ctrl key: ":w", ":q", ":wq", ":x" or ":q!" typed alone on a line and followed by Enter work too. */
(() => {
'use strict';
const M = window.MAC = window.MAC || {};
const T = M.TERM = M.TERM || { cmds: {}, apps: {} };
T.cmds = T.cmds || {}; T.apps = T.apps || {};

const GUTTER_KEY = 'kaiav.edit.gutter';
const prefGet = () => { const v = T.store.get(GUTTER_KEY, null); return v == null ? null : !!v; };   // terminal.js
const prefSet = on => T.store.set(GUTTER_KEY, on ? 1 : 0);
const isHi = c => c >= 0xD800 && c <= 0xDBFF;
const isLo = c => c >= 0xDC00 && c <= 0xDFFF;
const isWord = ch => !!ch && /[\wÀ-￿]/.test(ch);
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const VIM_CMDS = { ':w': 'w', ':q': 'q', ':wq': 'wq', ':x': 'wq', ':q!': 'q!', ':wq!': 'wq' };

function start(api, argv, flavor){
  const fs = api.fs, cwd = api.cwd || '/', HOME = (api.env && api.env.HOME) || '/home/kaiav';
  let COLS = api.cols || 54, ROWS = api.rows || 18;

  /* ---- buffer ---- */
  let lines = [''], cy = 0, cx = 0, goal = -1, anchor = null;
  let path = null, readOnly = false, isNew = false, finalNL = true, savedText = '';
  let top = { l: 0, s: 0 };
  let undo = [], redo = [], lastKind = null, lastT = 0, curId = 0, nextId = 1, savedId = 0;
  let clip = '', lastCopied = null, cutChain = false;
  let mode = null;                         // { type, label, input, cur, fresh, ... } while a prompt is open
  let msg = null;                          // { text, style, until }
  let gutterPref = prefGet(), gutter = gutterPref == null ? COLS >= 46 : gutterPref;
  let find = { q: '', on: false, cache: null, origin: null };
  let saves = 0, wake = false, done = false, modCache = { id: -1, v: false };

  const disp = abs => {
    if (!abs) return 'untitled';
    if (cwd !== '/' && abs.startsWith(cwd + '/')) return abs.slice(cwd.length + 1);
    if (abs === HOME) return '~';
    if (abs.startsWith(HOME + '/')) return '~/' + abs.slice(HOME.length + 1);
    return abs;
  };
  const say = (text, style, secs) => { msg = { text, style: style || 'dim', until: now() + (secs || 4) * 1000 }; };
  const joined = () => lines.join('\n');
  const fileText = () => (lines.length === 1 && lines[0] === '') ? '' : joined() + (finalNL ? '\n' : '');
  const modified = () => {
    if (curId === savedId) return false;
    if (modCache.id !== curId){ modCache = { id: curId, v: joined() !== savedText }; }
    return modCache.v;
  };
  function lockedAt(abs){
    try {
      if (typeof fs.isLocked === 'function' && fs.isLocked(abs)) return true;
      const s = typeof fs.stat === 'function' ? fs.stat(abs) : null;
      if (s && s.locked) return true;
    } catch (e){}
    return false;
  }
  function load(text){
    text = String(text == null ? '' : text).replace(/\r\n?/g, '\n').replace(/\t/g, '  ');
    finalNL = text === '' || text.endsWith('\n');
    if (text.endsWith('\n')) text = text.slice(0, -1);
    lines = text.split('\n'); savedText = joined();
    cy = cx = 0; top = { l: 0, s: 0 }; anchor = null; goal = -1;
  }

  /* ---- open ---- */
  const args = (argv || []).slice(1), dd = args.indexOf('--');
  const arg = args.find(a => a && a !== '--');
  if (arg && arg[0] === '-' && (dd < 0 || args.indexOf(arg) < dd)){ api.print('usage: ' + flavor + ' [file]  (try: ' + flavor + ' notes/today.txt)'); api.exit(2); return {}; }
  if (arg){
    path = fs.resolve(arg, cwd);
    if (fs.isDir && fs.isDir(path)){ api.print(flavor + ': ' + arg + ': is a directory'); api.exit(1); return {}; }
    const text = fs.read(path);
    if (text == null){ isNew = true; load(''); }
    else { load(text); readOnly = lockedAt(path); }
  }
  if (readOnly && (flavor === 'vi' || flavor === 'vim')) say(COLS < 54 ? 'nano-style ' + flavor + '. read-only: :w copies' : 'nano-style ' + flavor + ', read-only file. ^S saves a copy', 'dim', 7);
  else if (readOnly) say(COLS < 54 ? 'built-in file. :w saves a copy, :q quits' : 'built-in file, read-only. ^S saves a copy', 'dim', 7);
  else if (flavor === 'vi' || flavor === 'vim') say(COLS < 54 ? 'nano-style ' + flavor + '. :w saves, :q quits' : 'a nano-style ' + flavor + ': just type. :w saves, :q quits', 'dim', 7);
  else if (COLS < 54) say('tip: :wq on its own line saves', 'dim', 7);
  else if (isNew) say('new file', 'dim');

  /* ---- soft wrap: each line splits into segments; a segment never ends exactly at the right edge,
     so the cursor always has a cell to sit in ---- */
  let wrapW = 0, wrapCache = new Map();
  const gutW = () => gutter ? Math.max(3, String(lines.length).length) + 1 : 0;
  const textW = () => Math.max(8, COLS - gutW());
  function segs(l){
    const line = lines[l] || '', w = textW();
    if (w !== wrapW || wrapCache.size > 4000){ wrapW = w; wrapCache = new Map(); }
    let st = wrapCache.get(line);
    if (st) return st;
    st = [0];
    let s = 0;
    while (line.length - s >= w){
      let e = s + w;
      const sp = line.lastIndexOf(' ', s + w - 1);
      if (sp > s && sp - s >= (w >> 2)) e = sp + 1;
      else if (isLo(line.charCodeAt(e)) && e - 1 > s) e--;
      st.push(e); s = e;
    }
    wrapCache.set(line, st);
    return st;
  }
  function vpos(l, c){ const st = segs(l); let i = st.length - 1; while (i > 0 && st[i] > c) i--; return { l, s: i, x: c - st[i] }; }
  const cmpV = (a, b) => a.l - b.l || a.s - b.s;
  function stepV(p, n){                      // move a visual position by n rows, clamped to the document
    let { l, s } = p;
    while (n > 0){ if (s < segs(l).length - 1) s++; else if (l < lines.length - 1){ l++; s = 0; } else break; n--; }
    while (n < 0){ if (s > 0) s--; else if (l > 0){ l--; s = segs(l).length - 1; } else break; n++; }
    return { l, s };
  }
  function distV(a, b, cap){                 // rows from a down to b (a <= b), stops counting at cap
    if (a.l === b.l) return b.s - a.s;
    let d = segs(a.l).length - a.s;
    for (let l = a.l + 1; l < b.l && d < cap; l++) d += segs(l).length;
    return d + b.s;
  }
  const textRows = () => Math.max(1, ROWS - 4);
  function ensureVisible(){
    if (top.l >= lines.length) top = { l: lines.length - 1, s: 0 };
    if (top.s >= segs(top.l).length) top.s = 0;
    const p = vpos(cy, cx), n = textRows();
    if (cmpV(p, top) < 0) top = { l: p.l, s: p.s };
    else if (distV(top, p, n) >= n) top = stepV(p, -(n - 1));
  }

  /* ---- selection ---- */
  const before = (a, b) => a.l < b.l || (a.l === b.l && a.c < b.c);
  function selRange(){
    if (!anchor || (anchor.l === cy && anchor.c === cx)) return null;
    const c = { l: cy, c: cx };
    return before(anchor, c) ? [anchor, c] : [c, anchor];
  }
  function textOf(a, b){
    if (a.l === b.l) return lines[a.l].slice(a.c, b.c);
    const out = [lines[a.l].slice(a.c)];
    for (let l = a.l + 1; l < b.l; l++) out.push(lines[l]);
    out.push(lines[b.l].slice(0, b.c));
    return out.join('\n');
  }
  function removeRange(a, b){
    lines.splice(a.l, b.l - a.l + 1, lines[a.l].slice(0, a.c) + lines[b.l].slice(b.c));
    cy = a.l; cx = a.c; anchor = null;
  }
  function insertAt(str){
    const parts = str.split('\n'), line = lines[cy], head = line.slice(0, cx), tail = line.slice(cx);
    if (parts.length === 1){ lines[cy] = head + str + tail; cx += str.length; return; }
    const mid = parts.slice(1, -1), last = parts[parts.length - 1];
    lines.splice(cy, 1, head + parts[0], ...mid, last + tail);
    cy += parts.length - 1; cx = last.length;
  }

  /* ---- undo: snapshots of the line array (strings are shared), grouped by kind of edit ---- */
  const snap = () => ({ lines: lines.slice(), cy, cx, id: curId });
  function restore(s){ lines = s.lines; cy = s.cy; cx = s.cx; curId = s.id; anchor = null; goal = -1; }
  function edit(kind, fn, brk){
    if (readOnly){ say(COLS < 54 ? 'read-only. :w saves a copy, :q quits' : 'read-only: ^S saves a copy you can edit', 'bright'); return false; }
    const t = now();
    if (kind !== lastKind || kind === 'other' || brk || t - lastT > 1500){
      undo.push(snap()); if (undo.length > 400) undo.shift();
    }
    redo = []; lastKind = kind; lastT = t;
    fn();
    curId = nextId++; goal = -1; find.cache = null;
    return true;
  }
  const breakGroup = () => { lastKind = null; };

  /* ---- edits ---- */
  function typeText(str, kind){
    return edit(kind || 'type', () => { const r = selRange(); if (r) removeRange(r[0], r[1]); insertAt(str); },
      kind === 'type' && str !== ' ' && cx > 0 && lines[cy][cx - 1] === ' ');
  }
  function newline(){
    if (readOnly) return edit('other');
    const ind = (/^ */.exec(lines[cy].slice(0, cx)) || [''])[0];
    edit('other', () => { const r = selRange(); if (r) removeRange(r[0], r[1]); insertAt('\n' + ind); });
  }
  function backspace(word){
    edit('del', () => {
      const r = selRange(); if (r) return removeRange(r[0], r[1]);
      if (cx === 0){ if (cy > 0){ const c = lines[cy - 1].length; lines.splice(cy - 1, 2, lines[cy - 1] + lines[cy]); cy--; cx = c; } return; }
      let to = cx - 1;
      if (word){ to = wordLeft(cy, cx); }
      else if (isLo(lines[cy].charCodeAt(to)) && to > 0) to--;
      else if (/^ +$/.test(lines[cy].slice(0, cx)) && cx % 2 === 0) to = cx - 2;   // soft tab
      lines[cy] = lines[cy].slice(0, to) + lines[cy].slice(cx); cx = to;
    });
  }
  function del(word){
    edit('del2', () => {
      const r = selRange(); if (r) return removeRange(r[0], r[1]);
      const line = lines[cy];
      if (cx >= line.length){ if (cy < lines.length - 1) lines.splice(cy, 2, line + lines[cy + 1]); return; }
      let to = word ? wordRight(cy, cx) : cx + (isHi(line.charCodeAt(cx)) ? 2 : 1);
      lines[cy] = line.slice(0, cx) + line.slice(to);
    });
  }
  function indent(out){
    const r = selRange(); const a = r ? r[0].l : cy, b = r ? (r[1].c === 0 && r[1].l > r[0].l ? r[1].l - 1 : r[1].l) : cy;
    edit('other', () => {
      for (let l = a; l <= b; l++){
        if (out){ const n = Math.min(2, (/^ */.exec(lines[l]) || [''])[0].length); lines[l] = lines[l].slice(n); if (l === cy) cx = Math.max(0, cx - n); if (anchor && anchor.l === l) anchor.c = Math.max(0, anchor.c - n); }
        else { lines[l] = '  ' + lines[l]; if (l === cy) cx += 2; if (anchor && anchor.l === l) anchor.c += 2; }
      }
    });
  }

  /* ---- clipboard: internal, mirrored to the system clipboard when the browser allows ---- */
  function sysWrite(t){ lastCopied = t; T.copy(t); }   // terminal.js: the clipboard API, or a hidden-textarea fallback
  function copy(){
    const r = selRange();
    clip = r ? textOf(r[0], r[1]) : lines[cy] + '\n';
    sysWrite(clip); cutChain = false;
    say(r ? 'copied ' + plural(clip.length, 'character') : 'copied line ' + (cy + 1));
  }
  function cutLine(){
    if (readOnly) return edit('other');
    const chain = cutChain;
    edit('cut', () => {
      const t = lines[cy] + '\n';
      clip = chain ? clip + t : t;
      if (lines.length > 1) lines.splice(cy, 1); else lines[0] = '';
      if (cy >= lines.length){ cy = lines.length - 1; }
      cx = 0; anchor = null;
    }, !chain);
    sysWrite(clip); cutChain = true;
    const n = clip.split('\n').length - 1;
    say(n > 1 ? 'cut ' + n + ' lines' : 'cut line');
  }
  function cut(){
    const r = selRange();
    if (!r) return cutLine();
    if (readOnly) return edit('other');
    const t = textOf(r[0], r[1]);
    if (edit('other', () => removeRange(r[0], r[1]))){ clip = t; sysWrite(t); say('cut ' + plural(t.length, 'character')); }
  }
  function paste(){
    if (readOnly) return edit('other');
    const put = t => {
      if (!t){ say('nothing to paste'); wake = true; return; }
      typeText(t, 'other'); breakGroup(); wake = true;
    };
    let rd = null;
    try { rd = navigator.clipboard && navigator.clipboard.readText ? navigator.clipboard.readText() : null; } catch (e){ rd = null; }
    if (!rd || typeof rd.then !== 'function') return put(clip);
    let settled = false;
    const fin = t => {
      if (settled || done) return; settled = true;
      if (typeof t === 'string' && t && t !== lastCopied) put(t.replace(/\r\n?/g, '\n').replace(/\t/g, '  '));
      else put(clip);
    };
    rd.then(fin, () => fin(null));
    if (clip) setTimeout(() => fin(null), 700);   // a permission prompt must not hold the paste forever
  }

  /* ---- movement ---- */
  function wordLeft(l, c){ const s = lines[l]; let i = c; while (i > 0 && !isWord(s[i - 1])) i--; while (i > 0 && isWord(s[i - 1])) i--; return i; }
  function wordRight(l, c){ const s = lines[l]; let i = c; while (i < s.length && isWord(s[i])) i++; while (i < s.length && !isWord(s[i])) i++; return i; }
  function vert(n){
    const p = vpos(cy, cx); if (goal < 0) goal = p.x;
    const q = stepV(p, n);
    if (q.l === p.l && q.s === p.s){ cx = n < 0 ? 0 : lines[cy].length; return; }
    const st = segs(q.l), end = q.s < st.length - 1 ? st[q.s + 1] - 1 : lines[q.l].length;
    cy = q.l; cx = Math.min(st[q.s] + goal, end);
    if (isLo(lines[cy].charCodeAt(cx))) cx--;
  }
  function move(k, shift, word, ctrl){
    const r = selRange();
    if (shift){ if (!anchor) anchor = { l: cy, c: cx }; }
    else if (r && (k === 'ArrowLeft' || k === 'ArrowRight')){
      const p = k === 'ArrowLeft' ? r[0] : r[1]; cy = p.l; cx = p.c; anchor = null; goal = -1; return;
    } else anchor = null;
    const line = lines[cy];
    if (k !== 'ArrowUp' && k !== 'ArrowDown' && k !== 'PageUp' && k !== 'PageDown') goal = -1;
    switch (k){
      case 'ArrowLeft':
        if (cx === 0){ if (cy > 0){ cy--; cx = lines[cy].length; } }
        else if (word) cx = wordLeft(cy, cx);
        else { cx--; if (isLo(line.charCodeAt(cx)) && cx > 0) cx--; }
        break;
      case 'ArrowRight':
        if (cx >= line.length){ if (cy < lines.length - 1){ cy++; cx = 0; } }
        else if (word) cx = wordRight(cy, cx);
        else cx += isHi(line.charCodeAt(cx)) ? 2 : 1;
        break;
      case 'ArrowUp': if (word){ while (cy > 0 && lines[cy - 1].trim()) cy--; if (cy > 0 && cx === 0) cy--; cx = 0; } else vert(-1); break;
      case 'ArrowDown': if (word){ while (cy < lines.length - 1 && lines[cy + 1].trim()) cy++; if (cy < lines.length - 1) cy++; cx = 0; } else vert(1); break;
      case 'Home':
        if (ctrl){ cy = 0; cx = 0; break; }
        { const ind = (/^ */.exec(line) || [''])[0].length; cx = cx === ind ? 0 : ind; }
        break;
      case 'End': if (ctrl) cy = lines.length - 1; cx = lines[cy].length; break;
      case 'PageUp': top = stepV(top, -(textRows() - 1)); vert(-(textRows() - 1)); break;
      case 'PageDown': top = stepV(top, textRows() - 1); vert(textRows() - 1); break;
    }
    cutChain = false; breakGroup();
  }

  /* ---- find ---- */
  function matches(){
    const q = find.q; if (!q) return [];
    if (find.cache && find.cache.q === q) return find.cache.list;
    const fold = q === q.toLowerCase(), needle = fold ? q.toLowerCase() : q, list = [];
    for (let l = 0; l < lines.length; l++){
      const s = fold ? lines[l].toLowerCase() : lines[l];
      for (let i = s.indexOf(needle); i >= 0 && list.length < 5000; i = s.indexOf(needle, i + Math.max(1, needle.length))) list.push({ l, c: i });
    }
    find.cache = { q, list };
    return list;
  }
  function findGo(dir, from, inclusive){
    const list = matches(), q = find.q;
    if (!q){ return; }
    if (!list.length){ say('"' + q + '" not found', 'bright'); return; }
    const at = from || { l: cy, c: cx };
    let i;
    if (dir > 0){
      i = list.findIndex(m => inclusive ? !before(m, at) : before(at, m));
      if (i < 0){ i = 0; say('search wrapped'); }
    } else {
      i = -1; for (let j = list.length - 1; j >= 0; j--) if (before(list[j], at)){ i = j; break; }
      if (i < 0){ i = list.length - 1; say('search wrapped'); }
    }
    cy = list[i].l; cx = list[i].c; anchor = null; goal = -1;
    find.idx = i;
  }
  const curMatch = () => { const list = matches(); const i = list.findIndex(m => m.l === cy && m.c === cx); return i; };

  /* ---- save / quit ---- */
  function copyName(abs){
    const segsA = abs.split('/'), base = segsA.pop() || 'file', dot = base.lastIndexOf('.');
    const name = dot > 0 ? base.slice(0, dot) + '-copy' + base.slice(dot) : base + '-copy';
    let dir = segsA.join('/') || '/';
    if (lockedAt(dir) || dir.startsWith('/etc') || dir === '/') dir = HOME;
    return disp((dir === '/' ? '' : dir) + '/' + name);
  }
  function writeTo(abs){
    if (lockedAt(abs)) return { ok: false, err: 'built-in file, read-only' };
    let ok, err = '';
    try { ok = fs.write(abs, fileText()); } catch (e){ ok = false; err = (e && e.message) || String(e); }
    if (ok === false) return { ok: false, err: err || fs.lastError || 'write failed' };
    return { ok: true };
  }
  function save(abs, then){
    const res = writeTo(abs);
    if (!res.ok){
      if (abs === path && !readOnly){ readOnly = true; }
      openPrompt('saveas', (abs === path ? 'read-only. ' : "can't write there. ") + 'save as: ', abs === path ? copyName(abs) : disp(abs), then);
      say(res.err, 'bright', 6);
      return false;
    }
    const was = path; path = abs; readOnly = false; isNew = false;
    savedText = joined(); savedId = curId; modCache = { id: curId, v: false }; saves++; breakGroup();
    try { (api.sound || M.sound)?.event('disk'); } catch (e){}
    say((was && was !== abs ? 'saved a copy: ' : 'wrote ') + plural(lines.length, 'line') + (was !== abs ? ' to ' + disp(abs) : ''));
    if (then) then();
    return true;
  }
  function saveCmd(then){
    if (!path) return openPrompt('saveas', 'file name: ', '', then);
    if (readOnly) return openPrompt('saveas', 'save a copy as: ', copyName(path), then);
    return save(path, then);
  }
  function finish(how){
    done = true;
    const name = disp(path), n = plural(lines.length, 'line');
    if (how === 'discard') api.print(saves ? 'saved ' + name + ' · later changes not kept' : (path ? 'discarded changes to ' + name : 'discarded untitled buffer') + ' · nothing written');
    else if (saves) api.print('saved ' + name + ' · ' + n);
    else if (path) api.print('closed ' + name + ' · ' + n + (readOnly ? ' · read-only' : ' · no changes'));
    api.exit(0);
  }
  function quit(force){
    if (force || !modified()) return finish(force && modified() ? 'discard' : 'close');
    const long = 'save changes to ' + disp(path) + '? (y/n/esc) ';
    openPrompt('quit', long.length < COLS ? long : 'save changes? (y/n/esc) ', null);
  }

  /* ---- prompts on the message line ---- */
  function openPrompt(type, label, input, then){
    mode = { type, label, input: input == null ? null : String(input), cur: input == null ? 0 : String(input).length, fresh: !!input, then };
    msg = null;
  }
  function submitPrompt(){
    const m = mode;
    if (m.type === 'saveas'){
      const v = m.input.trim();
      if (!v){ mode = null; say('not saved'); return; }
      const abs = fs.resolve(v, cwd);
      if (fs.isDir && fs.isDir(abs)){ say(v + ' is a directory', 'bright'); return; }
      if (abs !== path && fs.exists && fs.exists(abs) && !m.confirmed){
        if (lockedAt(abs)){ say(disp(abs) + ' is a built-in file; pick another name', 'bright'); return; }
        mode = { type: 'overwrite', label: disp(abs) + ' exists. overwrite? (y/n) ', input: null, abs, then: m.then }; return;
      }
      mode = null; save(abs, m.then);
    } else if (m.type === 'goto'){
      const mm = /^\s*(-?\d+)?\s*(?:[:,]\s*(\d+))?\s*$/.exec(m.input);
      mode = null;
      if (!mm || (!mm[1] && !mm[2])){ if (m.input.trim()) say('not a line number', 'bright'); return; }
      let n = mm[1] ? +mm[1] : cy + 1; if (n < 0) n = lines.length + 1 + n;
      cy = Math.max(0, Math.min(lines.length - 1, n - 1));
      cx = mm[2] ? Math.max(0, Math.min(lines[cy].length, +mm[2] - 1)) : 0; anchor = null; goal = -1; breakGroup();
    } else if (m.type === 'find'){
      if (!m.input){ mode = null; find.on = false; return; }
      find.q = m.input; findGo(1, null, false);
    } else if (m.type === 'ex'){
      mode = null;
      const cmd = VIM_CMDS[':' + m.input.trim()];
      if (cmd) runVim(cmd); else if (m.input.trim()) say('try :w (' + (readOnly ? 'save a copy' : 'save') + ') or :q (quit)', 'bright');
    }
  }
  function promptKey(e){
    const k = e.key, m = mode, ctrl = e.ctrlKey && !e.altKey;
    if (m.type === 'quit' || m.type === 'overwrite'){
      const c = k.toLowerCase();
      if (m.type === 'quit'){
        if (c === 'y'){ mode = null; saveCmd(() => finish('saved')); return true; }
        if (c === 'n'){ mode = null; finish('discard'); return true; }
      } else {
        if (c === 'y'){ mode = null; save(m.abs, m.then); return true; }
        if (c === 'n'){ mode = { type: 'saveas', label: 'save as: ', input: disp(m.abs), cur: disp(m.abs).length, fresh: false, then: m.then }; return true; }
      }
      if (k === 'Escape' || (ctrl && (c === 'c' || c === 'q'))){ mode = null; say('cancelled'); }
      return true;
    }
    if (k === 'Escape' || (ctrl && k.toLowerCase() === 'c') || (ctrl && k.toLowerCase() === 'q')){
      if (m.type === 'find'){ find.on = false; if (m.origin && !e.shiftKey && k !== 'Escape'){ cy = m.origin.l; cx = m.origin.c; } }
      mode = null; return true;
    }
    if (m.type === 'find'){
      if ((k === 'Enter' && m.input) || k === 'ArrowDown' || (ctrl && (k.toLowerCase() === 'f' || k.toLowerCase() === 'g'))){
        if (k === 'Enter' && e.shiftKey) findGo(-1); else findGo(1); m.fresh = false; return true;
      }
      if (k === 'ArrowUp' || (ctrl && k.toLowerCase() === 'r')){ findGo(-1); m.fresh = false; return true; }
    }
    if (k === 'Enter'){ submitPrompt(); return true; }
    if (k === 'Backspace'){ if (m.fresh){ m.input = ''; m.cur = 0; } else if (m.cur > 0){ m.input = m.input.slice(0, m.cur - 1) + m.input.slice(m.cur); m.cur--; } m.fresh = false; afterPromptEdit(); return true; }
    if (k === 'Delete'){ m.input = m.input.slice(0, m.cur) + m.input.slice(m.cur + 1); m.fresh = false; afterPromptEdit(); return true; }
    if (k === 'ArrowLeft'){ m.cur = Math.max(0, m.cur - 1); m.fresh = false; return true; }
    if (k === 'ArrowRight'){ m.cur = Math.min(m.input.length, m.cur + 1); m.fresh = false; return true; }
    if (k === 'Home' || (ctrl && k.toLowerCase() === 'a')){ m.cur = 0; m.fresh = false; return true; }
    if (k === 'End' || (ctrl && k.toLowerCase() === 'e')){ m.cur = m.input.length; m.fresh = false; return true; }
    if (ctrl && k.toLowerCase() === 'u'){ m.input = ''; m.cur = 0; afterPromptEdit(); return true; }
    if ([...k].length === 1 && !(e.ctrlKey && !e.altKey) && k !== '\n' && k !== '\t'){
      if (m.type === 'goto' && !/[\d:,\- ]/.test(k)) return true;
      if (m.fresh){ m.input = ''; m.cur = 0; m.fresh = false; }
      m.input = m.input.slice(0, m.cur) + k + m.input.slice(m.cur); m.cur += k.length; afterPromptEdit(); return true;
    }
    return true;
  }
  function afterPromptEdit(){
    if (mode.type !== 'find') return;
    find.q = mode.input; find.cache = null; msg = null;
    if (find.q){
      const list = matches();
      if (list.length) findGo(1, mode.origin, true);
      else { cy = mode.origin.l; cx = mode.origin.c; }
    } else { cy = mode.origin.l; cx = mode.origin.c; }
  }

  /* ---- vim-ish commands typed on their own line (also the phone way out: no ctrl key there) ---- */
  function lineCommand(){
    /* ":wq" alone on a line, or at the end of one after a space ("done for today :wq") */
    const m = /(^|\s)(:wq!?|:x|:q!?|:w)\s*$/.exec(lines[cy]), cmd = m && VIM_CMDS[m[2]];
    if (!cmd || selRange() || cx !== lines[cy].length) return false;
    const keep = lines[cy].slice(0, m.index).replace(/\s+$/, '');
    if (readOnly){ /* nothing was typed into the buffer; nothing to remove */ }
    else edit('other', () => {
      if (keep){ lines[cy] = keep; cx = keep.length; }
      else if (lines.length > 1){ lines.splice(cy, 1); if (cy > 0){ cy--; cx = lines[cy].length; } else cx = 0; }
      else { lines[0] = ''; cx = 0; }
    });
    runVim(cmd);
    return true;
  }
  function runVim(cmd){
    if (cmd === 'q!') return quit(true);
    if (cmd === 'q') return quit(false);
    if (cmd === 'w') return saveCmd();
    saveCmd(() => finish('saved'));
  }

  /* ---- keys ---- */
  function key(e){
    if (done) return false;
    const k = e.key; if (!k || k === 'Unidentified' || k === 'Process' || k === 'Dead') return false;
    if (mode) return promptKey(e);
    if (k === 'Escape' && !e.ctrlKey && !e.altKey){ quit(false); return true; }   // esc leaves, like everywhere else (asks first if unsaved)
    const ctrl = e.ctrlKey && !e.altKey, alt = e.altKey && !e.ctrlKey, shift = e.shiftKey;
    if (ctrl || (e.ctrlKey && e.altKey && k.length > 1)){
      const c = k.toLowerCase();
      if (k.startsWith('Arrow') || k === 'Home' || k === 'End'){ move(k, shift, true, true); return true; }
      if (k === 'Backspace'){ backspace(true); return true; }
      if (k === 'Delete'){ del(true); return true; }
      switch (c){
        case 's': if (shift) openPrompt('saveas', 'save as: ', path ? disp(path) : '', null); else saveCmd(); return true;
        case 'o': openPrompt('saveas', 'save as: ', path ? disp(path) : '', null); return true;
        case 'q': quit(false); return true;
        case 'x': cut(); return true;
        case 'k': cutLine(); return true;
        case 'c': copy(); return true;
        case 'v': paste(); return true;
        case 'z': if (shift) doRedo(); else doUndo(); return true;
        case 'y': doRedo(); return true;
        case 'f': { const origin = { l: cy, c: cx }; find.on = true; openPrompt('find', 'find: ', find.q, null); mode.origin = origin; return true; }
        case 'g': openPrompt('goto', 'go to line: ', '', null); return true;
        case 'l': gutter = !gutter; prefSet(gutter); say('line numbers ' + (gutter ? 'on' : 'off')); return true;
        case 'a': anchor = { l: 0, c: 0 }; cy = lines.length - 1; cx = lines[cy].length; return true;
        case 'e': move('End', false, false, false); return true;
      }
      return true;                                         // swallow the rest (reload, print...) while editing
    }
    switch (k){
      case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown':
      case 'Home': case 'End': case 'PageUp': case 'PageDown':
        move(k, shift, alt, false); return true;
      case 'Escape':
        if (selRange()){ anchor = null; return true; }
        if (find.on){ find.on = false; return true; }
        quit(false); return true;
      case 'Enter': case '\n': case '\r':
        cutChain = false;
        if (lineCommand()) return true;
        newline(); return true;
      case 'Backspace': cutChain = false; backspace(alt); return true;
      case 'Delete': cutChain = false; del(alt); return true;
      case 'Tab': case '\t':
        cutChain = false;
        if (selRange() || shift) indent(shift);
        else typeText('  ', 'other');
        return true;
    }
    if ([...k].length === 1 && !e.metaKey){
      if (k === ':' && (readOnly || ((flavor === 'vi' || flavor === 'vim') && cx === 0 && !selRange()))){ openPrompt('ex', ':', '', null); return true; }
      cutChain = false; typeText(k, 'type'); return true;
    }
    return false;
  }
  function doUndo(){
    if (!undo.length){ say('nothing to undo'); return; }
    redo.push(snap()); restore(undo.pop()); breakGroup(); find.cache = null; say('undone');
  }
  function doRedo(){
    if (!redo.length){ say('nothing to redo'); return; }
    undo.push(snap()); restore(redo.pop()); breakGroup(); find.cache = null; say('redone');
  }

  /* ---- taps (if the terminal routes them: grid cell coordinates) ---- */
  let barHits = [];
  function tap(x, y){
    if (done) return false;
    for (const h of barHits) if (y === h.y && x >= h.x && x < h.x + h.w){ key(h.ev); return true; }
    if (mode) return false;
    if (y >= 1 && y <= textRows()){
      const p = stepV(top, y - 1), st = segs(p.l), gw = gutW();
      const end = p.s < st.length - 1 ? st[p.s + 1] - 1 : lines[p.l].length;
      cy = p.l; cx = Math.max(st[p.s], Math.min(end, st[p.s] + x - gw)); anchor = null; goal = -1; breakGroup();
      return true;
    }
    return false;
  }

  /* ---- drawing ---- */
  const ev = (k, ctrl) => ({ key: k, ctrlKey: !!ctrl, altKey: false, shiftKey: false, metaKey: false, preventDefault(){} });
  const SHORTCUTS = [
    [['esc', 'quit', ev('Escape')], ['^S', 'save', ev('s', 1)], ['^F', 'find', ev('f', 1)], ['^G', 'go to', ev('g', 1)], ['^L', 'lines', ev('l', 1)]],   // ^Q works too, but it closes Firefox on Linux
    [['^X', 'cut', ev('x', 1)], ['^C', 'copy', ev('c', 1)], ['^V', 'paste', ev('v', 1)], ['^Z', 'undo', ev('z', 1)], ['^Y', 'redo', ev('y', 1)]],
  ];
  function barFor(){
    if (!mode) return SHORTCUTS;
    const esc = ['esc', 'cancel', ev('Escape')];
    switch (mode.type){
      case 'find': return [[['enter', 'next', ev('Enter')], ['\u2191', 'previous', ev('ArrowUp')]], [['esc', 'done', ev('Escape')], ['^C', 'back to start', ev('c', 1)]]];
      case 'goto': return [[['enter', 'go', ev('Enter')], ['12:4', 'line:col', null]], [esc]];
      case 'saveas': return [[['enter', 'save', ev('Enter')]], [esc]];
      case 'quit': return [[['y', 'save', ev('y')], ['n', "don't save", ev('n')]], [esc]];
      case 'ex': return [[['w', readOnly ? 'save a copy' : 'save', null], ['q', 'quit', null], ['wq', 'both', null]], [['enter', 'run', ev('Enter')], esc]];
      case 'overwrite': return [[['y', 'overwrite', ev('y')], ['n', 'new name', ev('n')]], [esc]];
    }
    return SHORTCUTS;
  }
  function drawBar(scr){
    barHits = [];
    const rows = barFor(), y0 = ROWS - 2;
    const fixed = !mode;
    const n = fixed ? Math.max(1, Math.min(5, Math.floor((COLS - 1) / 9))) : 0;
    rows.forEach((row, ri) => {
      const y = y0 + ri; if (y < 1) return;
      let x = 1;
      row.forEach((it, i) => {
        if (fixed){ if (i >= n) return; x = 1 + Math.floor(i * (COLS - 1) / n); }
        const w = it[0].length + 1 + it[1].length;
        if (x + w > COLS) return;
        scr.put(x, y, it[0], 'bright'); scr.put(x + it[0].length + 1, y, it[1], 'dim');
        if (it[2]) barHits.push({ x, y, w, ev: it[2] });
        if (!fixed) x += w + 3;
      });
    });
  }
  function drawTitle(scr){
    scr.fill(0, 0, COLS, 1, ' ', 'inverse');
    const r = selRange();
    let right = COLS >= 50 ? 'ln ' + (cy + 1) + ', col ' + (cx + 1) : (cy + 1) + ':' + (cx + 1);
    if (r && COLS >= 50){ const n = textOf(r[0], r[1]).length; right = n + ' sel  ' + right; }
    const left = flavor === 'edit' ? 'edit' : flavor;
    let name = disp(path) + (modified() ? ' \u2022' : '');
    const tag = readOnly ? ' [read-only]' : isNew && !modified() ? ' [new]' : '';
    const avail = COLS - 2 - right.length - 2 - (left.length + 2);
    if ((name + tag).length > avail){
      const room = Math.max(4, avail - tag.length);
      if (name.length > room) name = '...' + name.slice(name.length - room + 3);
    }
    const mid = name + tag;
    let mx = Math.floor((COLS - mid.length) / 2);
    const minX = left.length + 3, maxX = COLS - right.length - 2 - mid.length;
    mx = Math.max(minX, Math.min(mx, maxX));
    scr.put(1, 0, left, 'inverse');
    scr.put(mx, 0, name, 'inverse');
    if (tag) scr.put(mx + name.length, 0, tag, 'inverse');
    scr.put(COLS - 1 - right.length, 0, right, 'inverse');
  }
  function drawText(scr){
    const gw = gutW(), n = textRows(), r = selRange();
    const showFind = (find.on || (mode && mode.type === 'find')) && find.q;
    const list = showFind ? matches() : [];
    const byLine = new Map();
    for (const m of list){ if (!byLine.has(m.l)) byLine.set(m.l, []); byLine.get(m.l).push(m.c); }
    const qlen = find.q.length, cur = showFind ? curMatch() : -1, curM = cur >= 0 ? list[cur] : null;
    let p = { l: top.l, s: top.s };
    for (let row = 0; row < n; row++){
      const y = 1 + row;
      if (p.l >= lines.length) break;
      const line = lines[p.l], st = segs(p.l), a = st[p.s], b = p.s < st.length - 1 ? st[p.s + 1] : line.length;
      if (gw){
        if (p.s === 0){ const num = String(p.l + 1).padStart(gw - 1, ' '); scr.put(0, y, num, p.l === cy ? 'dim' : 'faint'); }
        else scr.put(gw - 2, y, '.', 'faint');
      }
      const hits = byLine.get(p.l);
      for (let i = a, x = gw; i < b; i++, x++){
        let ch = line[i];
        if (isHi(line.charCodeAt(i)) && i + 1 < b){ ch = line.slice(i, i + 2); }
        let style = 'normal';
        if (r && !before({ l: p.l, c: i }, r[0]) && before({ l: p.l, c: i }, r[1])) style = 'inverse';
        else if (hits){
          for (const c of hits) if (i >= c && i < c + qlen){ style = curM && curM.l === p.l && curM.c === c ? 'inverse' : 'accent'; break; }
        }
        scr.put(x, y, ch, style);
        if (ch.length === 2){ i++; x++; }
      }
      if (r && p.s === st.length - 1 && p.l >= r[0].l && p.l < r[1].l) scr.put(gw + (b - a), y, ' ', 'inverse');   // selected newline
      const q = stepV(p, 1);
      if (q.l === p.l && q.s === p.s) break;
      p = q;
    }
  }
  function drawMsg(scr){
    const y = ROWS - 3; if (y < 1) return;
    if (mode){
      const label = mode.label;
      if (mode.input == null){ scr.put(0, y, label.slice(0, COLS - 1), 'bright'); scr.cursor(Math.min(COLS - 1, label.length), y, 'block'); return; }
      let extra = '';
      if (mode.type === 'find' && find.q){ const list = matches(), i = curMatch(); extra = list.length ? (i >= 0 ? (i + 1) + '/' : '') + list.length : 'no match'; }
      const room = COLS - label.length - (extra ? extra.length + 2 : 0) - 1;
      let inp = mode.input, off = 0;
      if (inp.length >= room){ off = Math.max(0, mode.cur - room + 1); inp = inp.slice(off, off + room); }
      scr.put(0, y, label, 'bright');
      scr.put(label.length, y, inp, mode.fresh ? 'dim' : 'normal');
      if (extra) scr.put(COLS - extra.length - 1, y, extra, extra === 'no match' ? 'faint' : 'dim');
      scr.cursor(label.length + mode.cur - off, y, 'block');
      return;
    }
    if (msg){
      let t = '[ ' + msg.text + ' ]';
      if (t.length > COLS) t = msg.text.length > COLS ? msg.text.slice(0, COLS - 3) + '...' : msg.text;
      scr.put(Math.max(0, Math.floor((COLS - t.length) / 2)), y, t, msg.style);
    }
  }
  function render(scr){
    COLS = scr.cols || COLS; ROWS = scr.rows || ROWS;
    if (cy >= lines.length) cy = lines.length - 1;
    if (cx > lines[cy].length) cx = lines[cy].length;
    ensureVisible();
    scr.clear();
    drawTitle(scr);
    drawText(scr);
    drawBar(scr);
    scr.cursor(null);
    if (!mode){
      const p = vpos(cy, cx), d = distV(top, p, textRows());
      scr.cursor(gutW() + p.x, 1 + d, 'block');
    }
    drawMsg(scr);
  }
  function tick(){
    let d = false;
    if (wake){ wake = false; d = true; }
    if (msg && now() > msg.until){ msg = null; d = true; }
    return d;
  }

  /* phones / IME: the terminal hands whole strings here. Newlines go through the Enter path (auto-indent,
     the :wq line commands), so a pasted or dictated chunk behaves like typing it. */
  const synth = k => ({ key: k, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, synthetic: true, preventDefault(){} });
  function insertText(str){
    if (done) return false;
    str = String(str == null ? '' : str).replace(/\r\n?/g, '\n');
    if (!str) return false;
    if (mode || readOnly || str.length === 1 || /[\b\t]/.test(str)){
      for (const ch of str){ if (done) break; key(synth(ch === '\n' ? 'Enter' : ch === '\t' ? 'Tab' : ch === '\b' ? 'Backspace' : ch)); }
      return true;
    }
    const parts = str.split('\n');
    parts.forEach((part, i) => {
      if (done) return;
      if (part){ cutChain = false; if (mode) for (const ch of part) promptKey(synth(ch)); else typeText(part, 'other'); }
      if (i < parts.length - 1 && !done) key(synth('Enter'));
    });
    return true;
  }

  return { key, tick, render, tap, insertText };
}

/* one editor; nano, vi and vim are quiet aliases (they work, but help lists edit once) */
const MORE = 'a small nano-style editor. just type. esc quits (asking first if there are changes), ^S saves, ^F finds, ^G goes to a line, ^Z undoes. the two bottom lines list the rest. built-in files open read-only; ^S then saves a copy. on a phone, type :w, :q or :wq at the end of a line and press enter. in vi and vim, : at the start of a line opens the command line.';
const def = (name, desc, hidden) => ({ g: 'files', hidden: !!hidden, desc, usage: name + ' [file]', more: MORE, ex: ['edit notes/today.txt', 'edit README.md'], start(api, argv){ return start(api, argv, name); } });
T.apps.edit = def('edit', 'edit a text file (nano-style)');
T.apps.nano = def('nano', 'edit a text file (same as edit)', true);
T.apps.vi = def('vi', 'edit a text file (nano-style, same as edit)', true);
T.apps.vim = def('vim', 'edit a text file (nano-style, same as edit)', true);
})();
