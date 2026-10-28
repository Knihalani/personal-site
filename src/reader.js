/* reader.js: a calm, typeset reading view for posts, laid over the scene as a DOM sheet.
   MAC.reader = { open(slugOrId) -> bool, close(), isOpen, posts() }
   Posts come from MAC.CONTENT.writing.posts: { id, slug, title, subtitle, date, tags, status, summary, html, wordCount, url? }.
   Only published posts show (a post with no status counts as published), newest first. A post with a url and no
   html opens the link instead. The html is sanitised with a small allowlist before it is inserted.
   Nothing is built or fetched until the first open (styles, the DOM and the Newsreader font).
   Deep link: #post/<slug> (main.js routes it here). While open, the reader owns the keyboard. */
(() => {
'use strict';
const M = window.MAC = window.MAC || {};
const D = document;
const THEME_KEY = 'kaiav.reader.theme', SIZE_KEY = 'kaiav.reader.size';
const store = {
  get(k){ try { return localStorage.getItem(k); } catch (e){ return null; } },
  set(k, v){ try { localStorage.setItem(k, v); } catch (e){} },
};
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e){ return false; } };
const FONT = 'https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400;1,6..72,500&display=swap';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/* ---- posts ---- */
const slugify = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const slugOf = p => p.slug || slugify(p.title) || String(p.id || '');
function posts(){
  const W = (M.CONTENT && M.CONTENT.writing) || {};
  return (W.posts || []).filter(p => p && (p.status == null || p.status === 'published'))
    .slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}
function find(q){
  const ps = posts(); q = String(q == null ? '' : q).trim().replace(/^#?(post\/)?/, '');
  if (!q) return null;
  if (/^\d+$/.test(q) && +q >= 1 && +q <= ps.length && !ps.some(p => slugOf(p) === q || String(p.id) === q)) return ps[+q - 1];
  return ps.find(p => slugOf(p) === q) || ps.find(p => String(p.id) === q) || ps.find(p => slugOf(p) === slugify(q)) || null;
}
function fmtDate(s){
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? MONTHS[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1] : String(s || '');
}

/* ---- sanitiser: tags and attributes the editor makes, nothing else ---- */
const RENAME = { b: 'strong', i: 'em', strike: 's', del: 's', h1: 'h2', h4: 'h3', h5: 'h3', h6: 'h3' };
const ALLOW = {
  p: [], h2: [], h3: [], strong: [], em: [], u: [], s: [], mark: [], code: ['class'], pre: [], blockquote: [],
  ul: ['data-type'], ol: ['start'], li: ['data-checked', 'data-type'], hr: [], br: [], a: ['href', 'title'],
  img: ['src', 'alt', 'title'], figure: [], figcaption: [], div: [], span: [],
};
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'svg', 'math', 'noscript', 'link', 'meta',
  'base', 'form', 'input', 'button', 'textarea', 'select', 'option', 'video', 'audio', 'canvas', 'frame', 'frameset', 'title', 'head']);
const ALIGNABLE = new Set(['p', 'h2', 'h3', 'li', 'blockquote', 'figure', 'figcaption', 'div']);
function safeHref(v){
  v = String(v || '').trim();
  if (/^mailto:[^\s<>"]+$/i.test(v)) return v;
  try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null; } catch (e){ return null; }
}
function safeSrc(v){ try { const u = new URL(String(v || '').trim()); return u.protocol === 'https:' ? u.href : null; } catch (e){ return null; } }
function sanitize(html){
  const src = new DOMParser().parseFromString('<!doctype html><body>' + String(html || ''), 'text/html').body;
  const frag = D.createDocumentFragment();
  const walk = (from, to) => {
    for (const n of Array.from(from.childNodes)){
      if (n.nodeType === 3){ to.appendChild(D.createTextNode(n.nodeValue)); continue; }
      if (n.nodeType !== 1) continue;
      let tag = n.tagName.toLowerCase();
      if (DROP.has(tag)) continue;
      tag = RENAME[tag] || tag;
      if (!ALLOW[tag]){ walk(n, to); continue; }            // unknown wrapper: keep its text, lose the tag
      let el = D.createElement(tag);
      for (const a of ALLOW[tag]){
        const v = n.getAttribute(a); if (v == null) continue;
        if (a === 'href'){ const h = safeHref(v); if (h){ el.setAttribute('href', h); if (!/^mailto:/i.test(h)){ el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); } } }
        else if (a === 'src'){ const s = safeSrc(v); if (s) el.setAttribute('src', s); }
        else if (a === 'class'){ const m = /(?:^|\s)(language-[\w+-]{1,32})(?:\s|$)/.exec(v); if (m) el.className = m[1]; }
        else if (a === 'start'){ if (/^\d{1,6}$/.test(v)) el.setAttribute('start', v); }
        else if (a === 'data-type'){ if (/^(taskList|taskItem)$/.test(v)) el.setAttribute(a, v); }
        else if (a === 'data-checked'){ el.setAttribute(a, v === 'true' ? 'true' : 'false'); }
        else el.setAttribute(a, v.slice(0, 500));
      }
      if (tag === 'a' && !el.hasAttribute('href')){ walk(n, to); continue; }   // an unsafe link keeps its words, not its tag
      if (tag === 'img'){
        if (!el.hasAttribute('src')) continue;
        el.setAttribute('loading', 'lazy'); el.setAttribute('decoding', 'async'); if (!el.hasAttribute('alt')) el.setAttribute('alt', '');
      }
      if (ALIGNABLE.has(tag)){
        const m = /text-align\s*:\s*(left|right|center|justify)\b/i.exec(n.getAttribute('style') || '');
        if (m && m[1].toLowerCase() !== 'left') el.style.textAlign = m[1].toLowerCase();
      }
      walk(n, el);
      to.appendChild(el);
    }
  };
  walk(src, frag);
  const box = D.createElement('div'); box.appendChild(frag);
  // task lists: a read-only checkbox in front of each item, from data-checked
  for (const li of box.querySelectorAll('ul[data-type="taskList"] > li')){
    for (const c of Array.from(li.children)) if ((c.tagName === 'SPAN' || c.tagName === 'LABEL') && !c.textContent.trim()) c.remove();
    const done = li.getAttribute('data-checked') === 'true';
    const cb = D.createElement('input'); cb.type = 'checkbox'; cb.disabled = true; cb.checked = done; cb.tabIndex = -1;
    cb.setAttribute('aria-label', done ? 'done' : 'not done');
    const body = D.createElement('div'); body.className = 'rd-task-body';
    while (li.firstChild) body.appendChild(li.firstChild);
    li.append(cb, body); li.classList.add('rd-task'); if (done) li.classList.add('rd-done');
  }
  // images: full measure; a title (or an existing figcaption) becomes the caption
  for (const img of box.querySelectorAll('img')){
    if (img.closest('figure')) continue;
    const fig = D.createElement('figure'); const p = img.parentElement;
    const alone = p && p !== box && p.tagName === 'P' && p.childNodes.length === 1;
    (alone ? p : img).replaceWith(fig); fig.appendChild(img);
    const cap = img.getAttribute('title'); if (cap){ const fc = D.createElement('figcaption'); fc.textContent = cap; fig.appendChild(fc); }
  }
  // empty paragraphs the editor leaves behind
  for (const p of box.querySelectorAll('p')) if (!p.textContent.trim() && !p.querySelector('img, br')) p.remove();
  smarten(box);
  return box;
}
/* typographer's quotes in prose text (never inside code or pre). The character before a quote decides its direction,
   carried across inline tags and reset at each block. */
const BLOCKS = new Set(['P', 'H2', 'H3', 'LI', 'BLOCKQUOTE', 'FIGCAPTION', 'DIV', 'FIGURE', 'UL', 'OL', 'BR', 'HR']);
const curl = (t, prev = ' ') => String(t).replace(/['"]/g, (q, i) => {
  const before = i ? t[i - 1] : prev, opens = /[\s(\[{\u2014\u2013-]/.test(before);
  if (q === '"') return opens ? '\u201c' : '\u201d';
  if (opens && /^'\d\ds\b/.test(t.slice(i))) return '\u2019';     // '90s
  return opens ? '\u2018' : '\u2019';
});
function smarten(root){
  let prev = ' ';
  const quote = t => curl(t, prev);
  const walk = n => {
    for (let c = n.firstChild; c; c = c.nextSibling){
      if (c.nodeType === 3){ const v = c.nodeValue; if (/['"]/.test(v)) c.nodeValue = quote(v); if (v) prev = v[v.length - 1]; }
      else if (c.nodeType === 1){
        if (c.tagName === 'CODE' || c.tagName === 'PRE'){ prev = 'x'; continue; }
        if (BLOCKS.has(c.tagName)) prev = ' ';
        walk(c);
        if (BLOCKS.has(c.tagName)) prev = ' ';
      }
    }
  };
  walk(root);
}
const wordsIn = t => (String(t || '').match(/\S+/g) || []).length;

/* ---- styles (injected on first open) ---- */
const CSS = `
#reader{ --r-bg:#191613; --r-sheet:#1d1a16; --r-fg:#e8e0cf; --r-soft:#cfc6b2; --r-mute:#988f7d; --r-faint:rgba(232,224,207,.12);
  --r-accent:#e0a95f; --r-link:#ecc48b; --r-mark:rgba(224,169,95,.28); --r-code-bg:rgba(255,240,210,.055); --r-quote:#d8cfbb;
  --r-glow:rgba(150,230,160,.07); --r-serif:"Newsreader","Source Serif 4","Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
  --r-mono:"IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace; --r-fs:19px;
  position:fixed; inset:0; z-index:20; display:none; color-scheme:dark; font:400 var(--r-fs)/1.65 var(--r-serif); color:var(--r-fg);
  -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility; font-kerning:normal; font-variant-ligatures:common-ligatures; }
#reader[data-theme="light"]{ --r-bg:#efe8da; --r-sheet:#f7f2e8; --r-fg:#27221c; --r-soft:#3d362d; --r-mute:#776d5e; --r-faint:rgba(39,34,28,.12);
  --r-accent:#9a5a1a; --r-link:#8a4c12; --r-mark:rgba(240,196,92,.45); --r-code-bg:rgba(60,45,20,.06); --r-quote:#4a4237; --r-glow:rgba(150,230,160,.05); color-scheme:light; }
#reader[data-size="0"]{ --r-fs:17px } #reader[data-size="2"]{ --r-fs:21.5px }
#reader.rd-on{ display:block }
#reader *, #reader *::before, #reader *::after{ box-sizing:border-box }
.rd-backdrop{ position:absolute; inset:0; background:rgba(4,5,6,.55); -webkit-backdrop-filter:blur(10px) saturate(.8) brightness(.7); backdrop-filter:blur(10px) saturate(.8) brightness(.7);
  opacity:0; transition:opacity .35s ease }
#reader.rd-in .rd-backdrop{ opacity:1 }
.rd-sheet{ position:absolute; top:28px; bottom:28px; left:50%; width:min(calc(100vw - 48px), calc(65ch + 9rem)); transform:translate(-50%, 18px); opacity:0;
  background:var(--r-sheet); border-radius:10px; overflow:auto; overscroll-behavior:contain; outline:none; scroll-behavior:smooth;
  box-shadow:0 0 0 1px var(--r-faint), 0 30px 90px rgba(0,0,0,.55), 0 0 140px 10px var(--r-glow);
  transition:transform .45s cubic-bezier(.2,.8,.2,1), opacity .35s ease, background-color .3s ease, color .3s ease; scrollbar-width:thin; scrollbar-color:var(--r-faint) transparent }
#reader.rd-in .rd-sheet{ transform:translate(-50%, 0); opacity:1 }
.rd-progress{ position:absolute; left:0; right:0; bottom:-1px; height:1px; pointer-events:none }
.rd-progress i{ display:block; height:100%; width:100%; background:var(--r-mute); transform-origin:0 50%; transform:scaleX(0); opacity:.55 }
.rd-bar{ position:sticky; top:0; z-index:2; display:flex; align-items:center; gap:4px; padding:10px 18px 10px 12px;
  background:color-mix(in srgb, var(--r-sheet) 88%, transparent); -webkit-backdrop-filter:blur(8px); backdrop-filter:blur(8px);
  border-bottom:1px solid transparent; font:500 12px/1 var(--r-mono); letter-spacing:.02em; transition:border-color .2s }
.rd-bar.rd-scrolled{ border-bottom-color:var(--r-faint) }
.rd-bar .rd-sp{ flex:1 }
.rd-btn{ appearance:none; background:none; border:0; color:var(--r-mute); font:inherit; letter-spacing:inherit; padding:8px 10px; border-radius:6px; cursor:pointer; min-height:36px }
.rd-btn:hover{ color:var(--r-fg); background:var(--r-faint) }
.rd-btn:focus-visible, .rd-sheet a:focus-visible, .rd-nav a:focus-visible{ outline:2px solid var(--r-accent); outline-offset:2px }
.rd-btn[aria-pressed="true"]{ color:var(--r-fg) }
.rd-aa{ font-family:var(--r-serif); font-size:15px; letter-spacing:0 }
.rd-aa small{ font-size:.72em }
.rd-bar .rd-where{ color:var(--r-mute); opacity:0; transition:opacity .25s; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; font-family:var(--r-serif); font-style:italic; font-size:14px; letter-spacing:0; padding:0 8px }
.rd-bar.rd-scrolled .rd-where{ opacity:1 }
.rd-col{ max-width:65ch; margin:0 auto; padding:0 1.5rem }
.rd-head{ padding:4.2rem 0 2.2rem }
.rd-kicker{ font:500 11.5px/1.4 var(--r-mono); letter-spacing:.14em; text-transform:uppercase; color:var(--r-mute); display:flex; flex-wrap:wrap; gap:.35em .7em; align-items:center }
.rd-kicker .rd-dot{ opacity:.5 }
.rd-title{ font-family:var(--r-serif); font-size:clamp(2.05em, 1.4em + 2.6vw, 2.75em); line-height:1.08; font-weight:500; letter-spacing:-.018em; margin:.55em 0 .3em;
  font-variation-settings:"opsz" 72; text-wrap:balance; color:var(--r-fg) }
.rd-sub{ font-size:1.22em; line-height:1.4; font-style:italic; color:var(--r-soft); margin:0 0 .9em; font-variation-settings:"opsz" 24; text-wrap:pretty }
.rd-tags{ display:flex; flex-wrap:wrap; gap:6px; margin:1.3em 0 0; padding:0; list-style:none }
.rd-tags li{ font:500 11px/1 var(--r-mono); letter-spacing:.06em; color:var(--r-mute); border:1px solid var(--r-faint); border-radius:999px; padding:5px 9px 5px }
.rd-rule{ height:1px; background:var(--r-faint); border:0; margin:0 }
.rd-prose{ padding:2.2rem 0 1rem; hyphens:manual; overflow-wrap:break-word; font-variation-settings:"opsz" 16 }
.rd-prose > *{ margin:0 0 1.1em }
.rd-prose p{ text-wrap:pretty; margin:0 0 1.1em }
.rd-prose li p, .rd-prose blockquote p{ margin:0 0 .5em } .rd-prose li p:last-child, .rd-prose blockquote p:last-child{ margin-bottom:0 }
.rd-prose h2{ font-size:1.5em; line-height:1.2; font-weight:500; letter-spacing:-.01em; margin:2em 0 .6em; font-variation-settings:"opsz" 48; text-wrap:balance }
.rd-prose h3{ font-size:1.18em; line-height:1.3; font-weight:600; margin:1.7em 0 .5em; text-wrap:balance }
.rd-prose h2 + h3{ margin-top:.8em }
.rd-prose strong{ font-weight:600 } .rd-prose em{ font-style:italic }
.rd-prose u{ text-decoration-thickness:1px; text-underline-offset:.18em }
.rd-prose s{ text-decoration-thickness:1px; color:var(--r-mute) }
.rd-prose mark{ background:var(--r-mark); color:inherit; padding:.04em .16em; border-radius:2px; -webkit-box-decoration-break:clone; box-decoration-break:clone }
.rd-prose a{ color:var(--r-link); text-decoration:underline; text-decoration-color:color-mix(in srgb, var(--r-link) 40%, transparent); text-decoration-thickness:1px; text-underline-offset:.2em; transition:text-decoration-color .2s }
.rd-prose a:hover{ text-decoration-color:currentColor }
.rd-prose code{ font-family:var(--r-mono); font-size:.82em; background:var(--r-code-bg); border:1px solid var(--r-faint); border-radius:4px; padding:.08em .32em; hyphens:none }
.rd-prose pre{ font-family:var(--r-mono); font-size:.8em; line-height:1.6; background:var(--r-code-bg); border:1px solid var(--r-faint); border-radius:8px;
  padding:1em 1.15em; overflow:auto; margin:1.5em 0; tab-size:2; hyphens:none }
.rd-prose pre code{ background:none; border:0; padding:0; font-size:inherit; white-space:pre }
.rd-prose blockquote{ margin:1.8em 0; padding:.1em 0 .1em 1.3em; border-left:2px solid var(--r-accent); color:var(--r-quote); font-style:italic; font-size:1.08em; line-height:1.55 }
.rd-prose blockquote > *{ margin:0 0 .7em } .rd-prose blockquote > :last-child{ margin-bottom:0 }
.rd-prose blockquote em{ font-style:normal }
.rd-prose ul, .rd-prose ol{ padding-left:1.4em }
.rd-prose li{ margin:.3em 0; padding-left:.2em } .rd-prose li > p{ margin:0 0 .4em } .rd-prose li > :last-child{ margin-bottom:0 }
.rd-prose ul > li::marker{ color:var(--r-mute) } .rd-prose ol > li::marker{ color:var(--r-mute); font-variant-numeric:oldstyle-nums; font-size:.95em }
.rd-prose ul[data-type="taskList"]{ list-style:none; padding-left:0 }
.rd-prose li.rd-task{ display:flex; gap:.65em; align-items:flex-start; padding-left:0 }
.rd-prose li.rd-task > input{ appearance:none; -webkit-appearance:none; flex:none; width:.95em; height:.95em; margin:.36em 0 0; border:1.5px solid var(--r-mute); border-radius:3px; display:grid; place-items:center; opacity:1 }
.rd-prose li.rd-task > input:checked{ background:var(--r-accent); border-color:var(--r-accent) }
.rd-prose li.rd-task > input:checked::after{ content:""; width:.28em; height:.52em; border:solid var(--r-sheet); border-width:0 2px 2px 0; transform:translateY(-.06em) rotate(45deg) }
.rd-prose li.rd-done > .rd-task-body{ color:var(--r-mute) }
.rd-task-body{ flex:1; min-width:0 } .rd-task-body p{ margin:0 }
.rd-prose hr{ border:0; height:auto; margin:2.4em 0; text-align:center; color:var(--r-mute) }
.rd-prose hr::before{ content:"\\2022\\2003\\2022\\2003\\2022"; font-size:.8em; letter-spacing:.1em }
.rd-prose figure{ margin:2em 0 }
.rd-prose img{ display:block; width:100%; height:auto; border-radius:6px; background:var(--r-code-bg) }
.rd-prose figcaption{ font-size:.8em; line-height:1.45; color:var(--r-mute); margin-top:.7em; text-align:center; font-style:italic }
.rd-end{ padding:1.5rem 0 4rem }
.rd-fin{ text-align:center; color:var(--r-mute); font-size:.85em; margin:1em 0 2.4em; letter-spacing:.3em }
.rd-nav{ display:grid; grid-template-columns:1fr 1fr; gap:12px; margin:0 0 2rem }
.rd-nav a{ display:block; text-decoration:none; color:inherit; border:1px solid var(--r-faint); border-radius:8px; padding:14px 16px; transition:border-color .2s, background-color .2s; min-width:0 }
.rd-nav a:hover{ border-color:color-mix(in srgb, var(--r-accent) 55%, transparent); background:var(--r-code-bg) }
.rd-nav .rd-next{ text-align:right; grid-column:2 }
.rd-nav small{ display:block; font:500 10.5px/1.4 var(--r-mono); letter-spacing:.12em; text-transform:uppercase; color:var(--r-mute); margin-bottom:5px }
.rd-nav span{ display:block; font-size:.95em; line-height:1.3; overflow:hidden; text-overflow:ellipsis }
.rd-home{ display:flex; justify-content:center }
.rd-home .rd-btn{ border:1px solid var(--r-faint); padding:10px 16px; font:500 12px/1 var(--r-mono) }
@media (max-width: 720px), (pointer: coarse) and (max-width: 900px){
  .rd-backdrop{ background:var(--r-bg); -webkit-backdrop-filter:none; backdrop-filter:none }
  .rd-sheet{ inset:0; width:auto; left:0; transform:translateY(14px); border-radius:0; box-shadow:none;
    padding-bottom:env(safe-area-inset-bottom, 0px) }
  #reader.rd-in .rd-sheet{ transform:none }
  .rd-bar{ padding:max(8px, env(safe-area-inset-top, 0px)) 8px 8px 4px }
  .rd-bar .rd-where{ display:none }
  .rd-col{ padding:0 max(20px, env(safe-area-inset-left, 0px)) 0 max(20px, env(safe-area-inset-right, 0px)) }
  .rd-head{ padding:2.4rem 0 1.6rem }
  .rd-prose{ padding-top:1.6rem; hyphens:auto; -webkit-hyphens:auto }
  .rd-nav{ grid-template-columns:1fr } .rd-nav .rd-next{ grid-column:1 }
}
@media (prefers-reduced-motion: reduce){
  .rd-backdrop, .rd-sheet, .rd-bar, .rd-bar .rd-where, .rd-nav a, .rd-prose a{ transition:none !important }
  .rd-sheet{ scroll-behavior:auto; transform:translate(-50%, 0) }
}
@media (prefers-reduced-motion: reduce) and (max-width: 720px){ .rd-sheet{ transform:none } }
@media print{ .rd-bar, .rd-progress, .rd-end .rd-nav, .rd-home, .rd-backdrop{ display:none } }
`;

/* ---- the view ---- */
let root = null, sheet, bar, prog, where, col, themeBtn, sizeBtn, current = null, isOpen = false, prevFocus = null, hideT = 0;
const cache = new Map();
let theme = store.get(THEME_KEY) === 'light' ? 'light' : 'dark';
let size = (() => { const v = +store.get(SIZE_KEY); return v === 0 || v === 2 ? v : 1; })();

function el(tag, attrs, ...kids){
  const e = D.createElement(tag);
  for (const k in attrs || {}){ if (k === 'class') e.className = attrs[k]; else if (k === 'text') e.textContent = attrs[k]; else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]); else e.setAttribute(k, attrs[k]); }
  for (const c of kids) if (c != null) e.append(c);
  return e;
}
function build(){
  if (root) return;
  D.head.appendChild(el('link', { rel: 'stylesheet', href: FONT }));
  D.head.appendChild(el('style', { id: 'reader-css' }, CSS));
  prog = el('i');
  where = el('span', { class: 'rd-where', 'aria-hidden': 'true' });
  themeBtn = el('button', { class: 'rd-btn', type: 'button', onclick: () => setTheme(theme === 'dark' ? 'light' : 'dark') });
  sizeBtn = el('button', { class: 'rd-btn rd-aa', type: 'button', onclick: () => setSize((size + 1) % 3) });
  bar = el('div', { class: 'rd-bar' },
    el('button', { class: 'rd-btn', type: 'button', onclick: () => close() }, '← back to terminal'),
    where, el('span', { class: 'rd-sp' }), sizeBtn, themeBtn);
  col = el('div', { class: 'rd-col' });
  bar.appendChild(el('div', { class: 'rd-progress', 'aria-hidden': 'true' }, prog));
  sheet = el('article', { class: 'rd-sheet', tabindex: '-1' }, bar, col);
  root = el('div', { id: 'reader', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'rd-title' },
    el('div', { class: 'rd-backdrop', onclick: () => close() }), sheet);
  D.body.appendChild(root);
  sheet.addEventListener('scroll', onScroll, { passive: true });
  // the wheel over the backdrop scrolls the sheet, as if the pointer were on it
  root.addEventListener('wheel', e => {
    if (sheet.contains(e.target)) return;
    e.preventDefault();
    const k = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? sheet.clientHeight : 1;
    sheet.style.scrollBehavior = 'auto'; sheet.scrollTop += e.deltaY * k; sheet.style.scrollBehavior = '';
  }, { passive: false });
  paintPrefs();
}
function paintPrefs(){
  root.setAttribute('data-theme', theme); root.setAttribute('data-size', String(size));
  themeBtn.textContent = theme === 'dark' ? 'light' : 'dark';
  themeBtn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light paper' : 'Switch to the dark night palette');
  sizeBtn.innerHTML = size === 0 ? '<small>Aa</small>' : size === 1 ? 'Aa' : 'Aa<small>+</small>';
  sizeBtn.setAttribute('aria-label', 'Text size: ' + ['small', 'medium', 'large'][size] + '. Press to change.');
}
function setTheme(t){ theme = t; store.set(THEME_KEY, t); paintPrefs(); }
function setSize(s){
  const f = sheet.scrollTop / Math.max(1, sheet.scrollHeight - sheet.clientHeight);   // keep the reading place
  size = s; store.set(SIZE_KEY, String(s)); paintPrefs();
  sheet.style.scrollBehavior = 'auto'; sheet.scrollTop = f * (sheet.scrollHeight - sheet.clientHeight); sheet.style.scrollBehavior = '';
  onScroll();
}
function onScroll(){
  const max = sheet.scrollHeight - sheet.clientHeight;
  const f = max > 0 ? Math.min(1, Math.max(0, sheet.scrollTop / max)) : 1;
  prog.style.transform = 'scaleX(' + f.toFixed(4) + ')';
  bar.classList.toggle('rd-scrolled', sheet.scrollTop > 140);
}

function render(p){
  const ps = posts(), i = ps.indexOf(p);
  let body = cache.get(p);
  if (!body){ body = sanitize(p.html); cache.set(p, body); }
  const words = p.wordCount || wordsIn(body.textContent);
  const mins = Math.max(1, Math.round(words / 230));
  const kicker = el('div', { class: 'rd-kicker' });
  const bits = [p.date && el('time', { datetime: p.date }, fmtDate(p.date)), mins + ' min read'].filter(Boolean);
  bits.forEach((b, k) => { if (k) kicker.append(el('span', { class: 'rd-dot', 'aria-hidden': 'true' }, '·')); kicker.append(b); });
  const head = el('header', { class: 'rd-head' }, kicker,
    el('h1', { class: 'rd-title', id: 'rd-title' }, curl(p.title || 'Untitled')),
    p.subtitle ? el('p', { class: 'rd-sub' }, curl(p.subtitle)) : null,
    (p.tags && p.tags.length) ? el('ul', { class: 'rd-tags', 'aria-label': 'tags' }, ...p.tags.map(t => el('li', null, String(t)))) : null);
  const prose = el('div', { class: 'rd-prose' }); prose.append(body.cloneNode(true));
  const newer = i > 0 ? ps[i - 1] : null, older = i >= 0 && i < ps.length - 1 ? ps[i + 1] : null;
  const navLink = (q, cls, label) => {
    const a = el('a', { class: cls, href: q.html ? '#post/' + slugOf(q) : q.url || '#' }, el('small', null, label), el('span', null, q.title || 'Untitled'));
    a.addEventListener('click', e => { e.preventDefault(); open(slugOf(q)); });
    return a;
  };
  const nav = (newer || older) ? el('nav', { class: 'rd-nav', 'aria-label': 'more posts' },
    older ? navLink(older, 'rd-prev', '← older') : null, newer ? navLink(newer, 'rd-next', 'newer →') : null) : null;
  const end = el('footer', { class: 'rd-end' }, el('div', { class: 'rd-fin', 'aria-hidden': 'true' }, '• • •'), nav,
    el('div', { class: 'rd-home' }, el('button', { class: 'rd-btn', type: 'button', onclick: () => close() }, '← back to terminal')));
  col.replaceChildren(head, el('hr', { class: 'rd-rule' }), prose, end);
  where.textContent = curl(p.title || '');
  sheet.style.scrollBehavior = 'auto'; sheet.scrollTop = 0; sheet.style.scrollBehavior = '';
  onScroll();
  D.title = (p.title ? p.title + ' — ' : '') + ((M.CONTENT && M.CONTENT.name) || 'Kaiav Nihalani');
}

/* ---- keyboard: while open, every keydown is the reader's ---- */
const focusables = () => Array.from(new Set(root.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'))).filter(e => e !== sheet && e.offsetParent !== null);   // the sheet itself only holds focus on open
function onKey(e){
  if (!isOpen) return;
  e.stopImmediatePropagation();                        // the terminal and the typist's hands never see it
  if (e.key === 'Escape'){ e.preventDefault(); close(); return; }
  if (e.key === 'Tab'){
    const f = focusables(); if (!f.length){ e.preventDefault(); return; }
    const a = D.activeElement, k = f.indexOf(a);
    if (e.shiftKey && (k <= 0)){ e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && (k === -1 || k === f.length - 1)){ e.preventDefault(); f[0].focus(); }
    return;
  }
  if (!root.contains(e.target) || e.target === D.body){            // keys typed with focus lost: scroll the sheet
    sheet.focus({ preventScroll: true });
  }
}
function onFocusIn(e){ if (isOpen && !root.contains(e.target)) sheet.focus({ preventScroll: true }); }
function setInert(on){
  for (const n of Array.from(D.body.children)){
    if (n === root || n.tagName === 'SCRIPT' || n.tagName === 'STYLE') continue;
    if (on){ if (!n.inert){ n.inert = true; n.dataset.rdInert = '1'; } }
    else if (n.dataset.rdInert){ n.inert = false; delete n.dataset.rdInert; }
  }
}
const hashFor = p => '#post/' + slugOf(p);
function setHash(h){ try { history.replaceState(history.state, '', h ? h : location.pathname + location.search); } catch (e){ if (h) location.hash = h; } }

function open(q){
  const p = q && typeof q === 'object' ? q : find(q);
  if (!p) return false;
  if (!p.html){
    if (p.url){ try { const w = window.open(p.url, '_blank'); if (w) w.opener = null; } catch (e){} }
    return false;
  }
  build();
  current = p;
  render(p);
  setHash(hashFor(p));
  if (!isOpen){
    isOpen = true; clearTimeout(hideT);
    const a = D.activeElement; prevFocus = a && a !== D.body && !root.contains(a) ? a : prevFocus;
    root.classList.add('rd-on'); setInert(true);
    addEventListener('keydown', onKey, true); D.addEventListener('focusin', onFocusIn);
    if (reduced()) root.classList.add('rd-in');
    else { void root.offsetWidth; requestAnimationFrame(() => root.classList.add('rd-in')); }
    try { if (M.sound && M.sound.event) M.sound.event('disk'); } catch (e){}
  }
  // every post opens at its top: render() can't reset a sheet that was still display:none
  sheet.style.scrollBehavior = 'auto'; sheet.scrollTop = 0; sheet.style.scrollBehavior = '';
  sheet.focus({ preventScroll: true });
  return true;
}
function close(){
  if (!isOpen) return;
  isOpen = false; current = null;
  removeEventListener('keydown', onKey, true); D.removeEventListener('focusin', onFocusIn);
  root.classList.remove('rd-in'); setInert(false);
  hideT = setTimeout(() => { if (!isOpen) root.classList.remove('rd-on'); }, reduced() ? 0 : 420);
  setHash('');
  D.title = (M.CONTENT && M.CONTENT.name) || 'Kaiav Nihalani';
  const back = prevFocus && D.contains(prevFocus) ? prevFocus : D.getElementById('kbd');
  prevFocus = null;
  if (back && back.focus) try { back.focus({ preventScroll: true }); } catch (e){}
}

M.reader = {
  open, close, posts, find, slugOf, sanitize,
  get isOpen(){ return isOpen; },
  get current(){ return current ? slugOf(current) : null; },
};
})();
