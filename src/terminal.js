/* terminal.js: the CRT terminal, the whole interface of the site.
   MAC.createTerminal({ content, aspect }) -> { canvas, handleKey, insertText, update, run, scroll }

   Typeface: VT323, on purpose. It is drawn from the DEC VT320's own glyph ROM, so it belongs on a
   1980s tube; its strokes are a uniform pixel weight that survives the scene's curvature, scanlines and
   bloom, where Plex Mono's thin hairlines and ink traps would smear into mush. One face only: hierarchy
   comes from brightness (faint, dim, normal, bright), inverse video, and DEC-style double-size lines.

   Everything is drawn on a fixed 72-column grid. Rules, arrows, bars and diagrams are drawn as vectors in
   the same phosphor so we never depend on box-drawing glyphs the font may not have. */
(() => {
'use strict';
const M = window.MAC = window.MAC || {};

/* ---- tunables ---- */
const PALETTE = {             // one phosphor, four intensities. Retune here to match the scene.
  bg:     '#0a0f0a',
  faint:  '#43603c',          // structure: rules, ghost text, hints
  dim:    '#6b9061',          // labels, secondary copy
  normal: '#c8f5b8',          // body copy
  bright: '#f0ffe8',          // titles, emphasis
};
const FONT = 'VT323, "IBM Plex Mono", ui-monospace, monospace';
const COLS = 72;               // grid width; ~23 rows at 4:3
const WIDTH = 1280;            // canvas px
const LINE = 0.9;              // line height in em (VT323 has generous built-in leading)
const RATE = 1500;             // typing-out speed, characters per second
const BOOT_END = 1.85;         // seconds
const HIST_KEY = 'kaiav.term.history';
const PROMPT = [['kaiav', 'd'], [' > ', 'n']];
const PROMPT_LEN = 8;
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

M.createTerminal = function createTerminal(opts){
  const C = (opts && opts.content) || M.CONTENT || {};
  const aspect = opts && opts.aspect > 0.5 && opts.aspect < 3 ? opts.aspect : 4 / 3;
  const W = WIDTH, H = Math.round(WIDTH / aspect);
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d', { alpha: false });
  const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const P = PALETTE;

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

  /* ---- output builder ---- */
  function out(){
    const r = [], o = {
      rows: r, plain: [],
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
  const lenOf = r => r.k === 't' ? r.s.reduce((n, s) => n + s[0].length, 0) : r.k === 'big' ? r.s[0][0].length : r.k === 'head' ? r.label.length * 2 : 0;
  const costOf = r => r.k === 'viz' ? 40 : r.k === 'big' ? lenOf(r) * 2 + 4 : r.k === 'head' ? 30 : Math.max(3, lenOf(r));
  const plainOf = r => r.k === 't' || r.k === 'big' ? r.s.map(s => s[1] === 'f' ? ' ' : s[0]).join('').replace(/\s+/g, ' ').trim() : '';

  function emit(o, mirrorText){
    links = []; sel = -1;
    for (const r of o.rows){ if (r.k === 't') for (const s of r.s) if (s[2]) links.push(s[2]); rows.push(r); }
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
    text = text.replace(/\s+/g, ' ').replace(/\.\./g, '.').trim();
    p.textContent = text.length > 600 ? text.slice(0, 597) + '...' : text;
  }
  const typing = () => shown < rows.length;
  function revealAll(){ const t = now; for (let i = shown; i < rows.length; i++) if (rows[i].k === 'viz' && rows[i].t0 < 0) rows[i].t0 = t - (REDUCED ? 99 : 0); shown = rows.length; partial = 0; carry = 0; dirty = true; }
  function toBottom(){ scrollOff = 0; wheelAcc = 0; }

  /* ---- content ---- */
  const L = C.links || {}, J = C.j || {}, E = C.eden || {}, A = C.about || {}, Wr = C.writing || {};
  const OPEN = [
    { name: 'linkedin', url: L.linkedin, label: 'LinkedIn' },
    { name: 'x', url: L.x, alias: ['twitter'], label: 'X' },
    { name: 'j', url: J.url, alias: ['risingfounder', 'rising'], kw: ['rising founder'], label: J.title },
  ].filter(o => o.url);
  const FILES = [
    { name: 'about.txt', cmd: 'about', alias: ['about', 'whoami'] },
    { name: 'eden.txt', cmd: 'eden', alias: ['eden'] },
    { name: 'j.txt', cmd: 'j', alias: ['j'], kw: ['rising'] },
    { name: 'links.txt', cmd: 'links', alias: ['links'] },
    { name: 'writing/', cmd: 'writing', alias: ['writing'], dir: true },
  ];

  const CMDS = [
    { name: 'help', d: 'this page', alias: ['?', 'man'] },
    { name: 'about', d: 'who Kaiav is', alias: ['whoami'], kw: ['bio', 'kaiav', 'me'] },
    { name: 'eden', d: 'Eden. ' + (E.line || ''), kw: ['agents', 'context'] },
    { name: 'j', d: J.title || 'J', kw: ['rising', 'rising founder', 'jose'] },
    { name: 'writing', d: 'posts', kw: ['blog', 'posts', 'essays'] },
    { name: 'links', d: 'LinkedIn and X', kw: ['linkedin', 'twitter', 'social', 'contact'] },
    { name: 'open', d: 'open a link: ' + OPEN.map(o => o.name).join(', '), args: () => OPEN, argName: 'link' },
    { name: 'ls', d: 'list sections as files', alias: ['dir', 'll'] },
    { name: 'cat', d: 'read one: cat j.txt', args: () => FILES, argName: 'file', alias: ['less', 'more'] },
    { name: 'history', d: 'commands you have run' },
    { name: 'date', d: 'now, in your time zone', alias: ['time'] },
    { name: 'uptime', d: 'time since you arrived' },
    { name: 'clear', d: 'clear the screen', alias: ['cls'] },
    { name: 'echo', hidden: true }, { name: 'pwd', hidden: true }, { name: 'welcome', hidden: true, alias: ['home'] },
    { name: 'exit', hidden: true, alias: ['quit', 'logout'] },
  ];
  const byName = n => CMDS.find(c => c.name === n || (c.alias || []).includes(n));

  /* ---- documents ---- */
  function welcome(o){
    o.blank().big(C.name || '', 'b').line([A.role || [E.role && 'Founder of ' + E.title, J.title].filter(Boolean).join(' · '), 'n']).blank()
      .line(['type ', 'f'], ['help', 'n'], [' to begin, or try ', 'f'], ['about', 'n'], ['  ', 'f'], ['eden', 'n'], ['  ', 'f'], ['j', 'n'], ['  ', 'f'], ['writing', 'n'], ['  ', 'f'], ['links', 'n'])
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
      const posts = (Wr.posts || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
      if (!posts.length){
        o.viz(5, drawEmpty, () => 4).blank();
        return o;
      }
      for (const p of posts){
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

  /* ---- commands ---- */
  function help(o){
    o.blank().head('help').blank();
    for (const c of CMDS){
      if (c.hidden) continue;
      const nm = c.name + (c.argName ? ' <' + c.argName + '>' : '');
      const al = c.name === 'about' ? ['whoami'] : [];
      o.line([pad(nm, 15), ['about', 'eden', 'j', 'writing', 'links'].includes(c.name) ? 'b' : 'n'], [c.d || '', 'd'], al.length ? ['  (' + al.join(', ') + ')', 'f'] : ['', 'f']);
    }
    o.blank().line(['tab', 'n'], [' complete   ', 'f'], ['up/down', 'n'], [' history   ', 'f'], ['pgup/pgdn', 'n'], [' scroll   ', 'f'], ['ctrl+l', 'n'], [' clear', 'f']).blank();
    return o;
  }
  function lsOut(o, args){
    const a = (args[0] || '').replace(/\/$/, '');
    if (a && fuzzy(a, FILES) && fuzzy(a, FILES).item.dir){ o.line(['total 0', 'f']); if ((Wr.posts || []).length) for (const p of Wr.posts) o.line([p.title || '', 'n']); else o.line(['(empty)', 'd']); return o; }
    o.line(...FILES.flatMap(f => [[pad(f.name, 13), f.dir ? 'b' : 'n']]));
    return o;
  }
  function execute(raw, programmatic){
    const line = raw.trim();
    rows.push({ k: 't', i: 0, s: [...PROMPT, [raw, 'n']] }); shown = rows.length; partial = 0;
    input = ''; cur = 0; suggestion = ''; tabState = null; sel = -1;
    if (line){
      if (!programmatic && history[history.length - 1] !== line){ history.push(line); if (history.length > 200) history.shift(); try { localStorage.setItem(HIST_KEY, JSON.stringify(history)); } catch (e){} }
      ran++;
    }
    hIdx = history.length; hDraft = '';
    if (!line){ toBottom(); dirty = true; return; }
    const [w0, ...args] = line.split(/\s+/);
    const name = w0.toLowerCase();
    const c = byName(name);
    const o = out();
    if (!c){
      const f = fuzzy(name, CMDS.filter(x => !x.hidden)) || fuzzy(line, CMDS.filter(x => !x.hidden));
      o.at(0, [w0 + ': command not found', 'd']);
      if (f){ o.at(0, ['did you mean ', 'd'], [f.item.name, 'b'], ['?  press enter', 'f']); suggestion = f.item.name; }
      else o.at(0, ['type ', 'f'], ['help', 'n'], [' for the list', 'f']);
      emit(o, w0 + ': command not found.' + (f ? ' Did you mean ' + f.item.name + '?' : ''));
      return;
    }
    switch (c.name){
      case 'help': emit(help(o), 'Commands: ' + CMDS.filter(x => !x.hidden).map(x => x.name).join(', ') + '. Tab completes, up and down recall history, page up and down scroll.'); break;
      case 'about': case 'eden': case 'j': case 'writing': case 'links':
        emit(DOCS[c.name](o), mirrorFor(c.name)); break;
      case 'welcome': emit(welcome(o)); break;
      case 'open': {
        const q = args.join(' ');
        if (!q){ o.at(0, ['open what? ', 'd'], ...OPEN.flatMap((x, i) => [[x.name, 'n'], [i < OPEN.length - 1 ? '  ' : '', 'f']])); emit(o); break; }
        const f = fuzzy(q, OPEN);
        if (!f){ o.at(0, ['open: no link called ', 'd'], [q, 'n'], ['. try ', 'd'], [OPEN.map(x => x.name).join(', '), 'n']); emit(o); break; }
        o.at(0, ['opening ', 'd'], [f.item.label || f.item.name, 'b']).at(2, [f.item.url, 'n', { url: f.item.url }]);
        const w = openUrl(f.item.url);
        if (!w) o.at(2, ['if nothing opened, the address is above', 'f']);
        emit(o); break;
      }
      case 'ls': emit(lsOut(o, args)); break;
      case 'cat': {
        const q = args[0];
        if (!q){ o.at(0, ['cat what? try ', 'd'], ['cat j.txt', 'n']); emit(o); break; }
        const f = fuzzy(q, FILES);
        if (!f){ o.at(0, ['cat: ' + q + ': no such file', 'd']); emit(o); break; }
        if (f.item.dir && !(Wr.posts || []).length){ DOCS.writing(o); emit(o, 'Writing. No posts yet.'); break; }
        emit(DOCS[f.item.cmd](o), mirrorFor(f.item.cmd)); break;
      }
      case 'history': {
        if (!history.length){ o.at(0, ['no history yet', 'd']); emit(o); break; }
        const h = history.slice(-40), base = history.length - h.length;
        h.forEach((s, i) => o.at(0, [String(base + i + 1).padStart(5, ' ') + '  ', 'f'], [s, 'n']));
        emit(o, history.length + ' commands in history.'); break;
      }
      case 'date': {
        const d = new Date();
        let tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e){}
        const day = d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' });
        o.blank().at(2, [day, 'b']).at(2, [time, 'n'], [tz && !time.includes(tz) && tz !== 'UTC' ? '   ' + tz.replace(/_/g, ' ') : '', 'd']).blank();
        emit(o); break;
      }
      case 'uptime': {
        const s = Math.floor((performance.now() - T0) / 1000);
        const hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = s % 60;
        const span = (hh ? hh + 'h ' : '') + (hh || mm ? mm + 'm ' : '') + ss + 's';
        o.at(0, ['up ', 'd'], [span, 'b'], ['  since you arrived, ', 'd'], [String(ran), 'n'], [ran === 1 ? ' command' : ' commands', 'd']);
        emit(o); break;
      }
      case 'clear': rows = []; shown = 0; partial = 0; links = []; toBottom(); dirty = true; break;
      case 'echo': o.at(0, [args.join(' '), 'n']); emit(o); break;
      case 'pwd': o.at(0, ['/home/kaiav', 'n']); emit(o); break;
      case 'exit': o.at(0, ['there is nowhere else to go. close the tab when you are done.', 'd']); emit(o); break;
    }
  }
  function mirrorFor(name){
    if (name === 'writing' && !(Wr.posts || []).length) return 'Writing. No posts yet.';
    if (name === 'j') return [J.title, J.role, J.line, J.body, ...(J.facts || []).map(f => f[0] + ': ' + f[1]), J.url].filter(Boolean).join('. ');
    if (name === 'eden') return [E.title, E.role, E.line].filter(Boolean).join('. ');
    return null;
  }
  function openUrl(url){
    try { return window.open(url, '_blank', 'noopener'); } catch (e){ return null; }
  }

  /* ---- completion and typeahead ---- */
  function context(){
    const before = input.slice(0, cur);
    const sp = before.indexOf(' ');
    if (sp < 0) return { kind: 'cmd', q: before, from: 0, items: CMDS.filter(c => !c.hidden) };
    const c = byName(before.slice(0, sp).toLowerCase());
    if (!c || !c.args) return null;
    const rest = before.slice(sp + 1);
    if (rest.includes(' ')) return null;
    return { kind: 'arg', q: rest, from: sp + 1, items: c.args() };
  }
  function candidates(ctx){
    if (!ctx) return [];
    if (!ctx.q) return ctx.kind === 'arg' ? ctx.items.map(i => i.name) : [];
    const scored = [];
    for (const it of ctx.items){
      let s = fscore(ctx.q, it.name);
      for (const a of it.alias || []) s = Math.max(s, fscore(ctx.q, a) - 5);
      for (const k of it.kw || []) s = Math.max(s, fscore(ctx.q, k) * 0.8);
      if (s >= 150) scored.push([s, it.name]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    return scored.map(x => x[1]);
  }
  function ghost(){
    if (!input && suggestion) return { text: suggestion, full: suggestion, kind: 'prefix', from: 0 };
    if (cur !== input.length || !input) return null;
    const ctx = context(); const list = candidates(ctx);
    if (!list.length) return null;
    const best = list[0];
    if (best.toLowerCase() === ctx.q.toLowerCase()) return null;
    if (best.toLowerCase().startsWith(ctx.q.toLowerCase())) return { text: best.slice(ctx.q.length), full: best, kind: 'prefix', from: ctx.from };
    return { text: best, full: best, kind: 'fuzzy', from: ctx.from };
  }
  function accept(word, from){
    const c = from === 0 ? byName(word) : null;
    input = input.slice(0, from) + word + (c && c.args ? ' ' : ''); cur = input.length;
  }
  function tab(back){
    if (!input){
      if (suggestion){ input = suggestion; cur = input.length; suggestion = ''; return; }
      if (links.length){ sel = back ? (sel <= 0 ? links.length - 1 : sel - 1) : (sel + 1) % links.length; return; }
      const o = out(); o.at(0, ...CMDS.filter(c => !c.hidden).flatMap(c => [[pad(c.name, 9), 'n']])); emit(o, 'Commands: ' + CMDS.filter(c => !c.hidden).map(c => c.name).join(', '));
      return;
    }
    if (tabState && tabState.after === input){
      const s = tabState; s.i = (s.i + (back ? -1 : 1) + s.list.length) % s.list.length;
      input = s.base; accept(s.list[s.i], s.from); s.after = input; return;
    }
    const ctx = context(); const list = candidates(ctx);
    if (!list.length) return;
    const base = input;
    accept(list[0], ctx.from);
    tabState = list.length > 1 ? { base, list, i: 0, from: ctx.from, after: input } : null;
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
  function clearScreen(){ rows = []; shown = 0; partial = 0; links = []; sel = -1; toBottom(); dirty = true; }

  function handleKey(e){
    const k = e.key;
    if (!k || k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta' || k === 'CapsLock' || k === 'Dead') return false;
    if (e.metaKey) return false;
    if (/^F\d+$/.test(k)) return false;
    if (booting){ skipBoot(); return true; }
    if (typing()){ revealAll(); if (k === 'Enter' || k === 'Escape' || k === ' ' && !input) return true; }
    const ctrl = e.ctrlKey, alt = e.altKey;
    if (ctrl && !alt){
      const c = k.toLowerCase();
      if (c === 'l'){ clearScreen(); touched(); return true; }
      if (c === 'c'){
        rows.push({ k: 't', i: 0, s: [...PROMPT, [input, 'n'], ['^C', 'd']] }); shown = rows.length; partial = 0;
        input = ''; cur = 0; suggestion = ''; sel = -1; hIdx = history.length; touched(); return true;
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
          rows.push({ k: 't', i: 0, s: [...PROMPT] }); shown = rows.length; emit(o); touched(); return true;
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
        if (cur === input.length){ const gh = ghost(); if (gh && gh.kind === 'prefix'){ accept(gh.full, gh.from); suggestion = ''; } }
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
    if (typing()) revealAll();
    const parts = String(str).split(/\r?\n/);
    parts.forEach((p, i) => { insert(p); if (i < parts.length - 1) execute(input); });
    touched();
  }
  function run(cmd){
    cmd = String(cmd || '').trim(); if (!cmd) return;
    if (booting) skipBoot();
    revealAll();
    execute(cmd, true); touched();
  }
  function scroll(delta){
    if (booting) return;
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
  const color = st => st === 'f' ? P.faint : st === 'd' ? P.dim : st === 'b' ? P.bright : P.normal;
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
      const selected = link && sel >= 0 && links[sel] === link;
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
  const promptVisible = () => !booting && !typing();

  function drawPrompt(top){
    const gh = ghost();
    let off = 0; const room = COLS - PROMPT_LEN - 1;
    if (cur > room) off = cur - room;
    const vis = input.slice(off, off + room);
    drawSpans({ i: 0, s: [...PROMPT, [vis, 'n']] }, top, 999);
    const cx = X(PROMPT_LEN + cur - off);
    if (gh){
      const gcol = PROMPT_LEN + input.length - off;
      if (gh.kind === 'prefix') text(gh.text, gcol, top, 'f');
      else {                                    // fuzzy: an arrow and the target, set apart
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

  function draw(){
    g.fillStyle = P.bg; g.fillRect(0, 0, W, H);
    g.textBaseline = 'alphabetic';
    animFps = 0;
    if (booting){ drawBoot(); return; }
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

  /* ---- frame ---- */
  function update(dt, t){
    now = t;
    let changed = dirty;
    if (booting){
      bootT += dt;
      if (bootT >= BOOT_END) endBoot(), changed = true;
      else if (bootT - bootLastDraw >= 1 / 30){ bootLastDraw = bootT; changed = true; }
    }
    if (!booting && typing()){
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
    if (on !== blinkOn){ blinkOn = on; if (promptVisible()) changed = true; }
    if (animFps > 0 && t - lastAnim >= 1 / animFps - 1e-3) changed = true;
    if (changed){ draw(); lastAnim = t; dirty = false; }
    return changed;
  }

  draw();
  return { canvas, handleKey, insertText, update, run, scroll };
};
})();
