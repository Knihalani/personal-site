
/* ================= site copy, Markdown, the Writings reader and books (x1) =================
   Copy and writings come from content/copy.md and content/writings/*.md, baked by site/build.py into
   <script type="application/json" id="kw-content">. Everything the site says outside the film reads copy(key).
   Markdown is rendered by a compact renderer below: the source is HTML-escaped first, links must be http(s) or #,
   and open in a new tab. Writings are readable without playing (#writings, #w-<slug>), and each published article
   is also a unique Book item in Wilds chests; reading it to the end in game grants a one-time reward. */
const KW_DEFAULT = { copy: { name: 'Kaiav Nihalani', tagline: 'Founder of Eden. Co-founder of J.', intro: '', 'eden.title': 'Eden', 'eden.line': 'Context for agents.', 'eden.role': 'Founder', 'eden.body': '',
  'j.title': 'J: Rising Founder', 'j.line': 'An early chance for extraordinary founders.', 'j.role': 'Co-founder, with Jose Cruz-Lopez', 'j.url': 'https://risingfounder.net',
  'j.body': 'A free, remote, three-month program for ambitious founders aged 23 and under, anywhere in the world. No fee, no equity.', 'about.title': 'About', 'about.body': '[About Kaiav — bio coming soon]',
  'contact.title': 'Say hello', 'contact.line': 'Emails are locked behind a tiny game. LinkedIn and X are open.', 'links.linkedin': 'https://www.linkedin.com/in/kaiav-nihalani-594703356/', 'links.x': 'https://x.com/KaiavRNihalani',
  'writings.title': 'Writings', 'writings.intro': 'Notes and essays will appear here.' }, writings: [] };
let KW_CONTENT = KW_DEFAULT;
try { const el = D.getElementById('kw-content'); if (el){ const j = JSON.parse(el.textContent); KW_CONTENT = { copy: Object.assign({}, KW_DEFAULT.copy, (j && j.copy) || {}), writings: Array.isArray(j && j.writings) ? j.writings.filter(w => w && w.slug && w.title) : [] }; } } catch (e){ KW_CONTENT = KW_DEFAULT; }
Wn.KW_CONTENT = KW_CONTENT;
function copy(key, fallback){ const v = KW_CONTENT.copy[key]; return typeof v === 'string' && v.trim() !== '' ? v : (fallback !== undefined ? fallback : (KW_DEFAULT.copy[key] || '')); }
const escH = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
// ---- Markdown: headings, paragraphs, emphasis, links, lists, blockquotes, code, images by URL, rules ----
function mdSafeUrl(u){ u = String(u).trim(); return /^(https?:\/\/|#)/i.test(u) ? u.replace(/"/g, '%22') : ''; }
function mdInline(s){ // s is already HTML-escaped
  const codes = []; s = s.replace(/`([^`]+)`/g, (m, c) => { codes.push('<code>' + c + '</code>'); return '\u0000' + (codes.length - 1) + '\u0000'; });
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, u) => { const url = mdSafeUrl(u.replace(/&amp;/g, '&')); return url ? '<img src="' + escH(url) + '" alt="' + alt + '" loading="lazy">' : alt; });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => { const url = mdSafeUrl(u.replace(/&amp;/g, '&')); return url ? '<a href="' + escH(url) + '"' + (url[0] === '#' ? '' : ' target="_blank" rel="noopener"') + '>' + t + '</a>' : t; });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>').replace(/(^|\W)_([^_\s][^_]*)_(?=\W|$)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => codes[+i]);
}
function md(src){
  const L = escH(String(src || '').replace(/\r/g, '')).split('\n'), out = []; let i = 0;
  while (i < L.length){ const l = L[i];
    if (/^```/.test(l)){ const buf = []; i++; while (i < L.length && !/^```/.test(L[i])) buf.push(L[i++]); i++; out.push('<pre><code>' + buf.join('\n') + '</code></pre>'); continue; }
    let m = /^(#{1,6})\s+(.*)$/.exec(l); if (m){ const n = Math.min(6, m[1].length + 1); out.push('<h' + n + '>' + mdInline(m[2]) + '</h' + n + '>'); i++; continue; }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(l)){ out.push('<hr>'); i++; continue; }
    if (/^&gt;\s?/.test(l)){ const buf = []; while (i < L.length && /^&gt;\s?/.test(L[i])) buf.push(L[i++].replace(/^&gt;\s?/, '')); out.push('<blockquote>' + md(buf.join('\n').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")) + '</blockquote>'); continue; }
    if (/^\s*([-*+]|\d+\.)\s+/.test(l)){ const ord = /^\s*\d+\./.test(l), buf = []; while (i < L.length && /^\s*([-*+]|\d+\.)\s+/.test(L[i])) buf.push('<li>' + mdInline(L[i++].replace(/^\s*([-*+]|\d+\.)\s+/, '')) + '</li>'); out.push((ord ? '<ol>' : '<ul>') + buf.join('') + (ord ? '</ol>' : '</ul>')); continue; }
    if (!l.trim()){ i++; continue; }
    const buf = []; while (i < L.length && L[i].trim() && !/^(#{1,6}\s|```|&gt;|\s*([-*+]|\d+\.)\s+)/.test(L[i])) buf.push(L[i++]); out.push('<p>' + mdInline(buf.join(' ')) + '</p>'); }
  return out.join('\n');
}
// ---- apply copy to the static page (title, index, signs) ----
function applyCopy(){
  const nm = copy('name'), parts = nm.split(' '), set = (sel, v) => { const e = D.querySelector(sel); if (e) e.textContent = v; }, html = (sel, v) => { const e = D.querySelector(sel); if (e) e.innerHTML = v; };
  const logo = $('#ttl'); if (logo){ logo.textContent = ''; logo.appendChild(D.createTextNode(parts[0].toUpperCase())); const sm = D.createElement('small'); sm.textContent = parts.slice(1).join(' ').toUpperCase(); logo.appendChild(sm); }
  for (const e of D.querySelectorAll('[data-copy]')) e.textContent = copy(e.dataset.copy);
  set('#idxTtl', nm + ', plain text'); set('#h-hub', nm);
  html('#c-intro', copy('intro') ? md(copy('intro')) : '');
  html('#c-eden', md(copy('eden.body', nm + ' is the founder of ' + copy('eden.title') + '.')));
  html('#c-j', md(copy('j.body')));
  html('#c-about', md(copy('about.body')));
  const ju = mdSafeUrl(copy('j.url')), ja = $('#c-jurl'); if (ja){ if (ju){ ja.href = ju; ja.firstChild.nodeValue = ju.replace(/^https?:\/\//, '').replace(/\/$/, ''); ja.hidden = false; } else ja.hidden = true; }
  const li = $('#c-linkedin'), xx = $('#c-x'); if (li){ const u = mdSafeUrl(copy('links.linkedin')); li.hidden = !u; if (u) li.href = u; } if (xx){ const u = mdSafeUrl(copy('links.x')); xx.hidden = !u; if (u) xx.href = u; }
  renderIndexWritings();
}
// ---- writings: list, article, reader (site style, or the in-game tome) ----
const WRITINGS = () => KW_CONTENT.writings;
const wordsOf = w => (String(w.body || '').match(/\S+/g) || []).length;
function bookRarity(w){ const n = wordsOf(w); return n < 300 ? 0 : n < 800 ? 1 : n < 1600 ? 2 : n < 3000 ? 3 : 4; }
const BOOK0 = 131; for (let r = 0; r < 5; r++) I_NAME[BOOK0 + r] = 'Book';
const isBook = id => id >= BOOK0 && id < BOOK0 + 5;
const BOOKS_FOUND = new Set(), BOOKS_READ = new Set();
const RD = { open: false, mode: 'site', slug: '', t0: 0, need: 0, back: 'title', granted: false };
function fmtDate(d){ if (!d) return ''; const t = Date.parse(d); return isNaN(t) ? escH(d) : new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }); }
function renderIndexWritings(){ const el = $('#c-writings'); if (!el) return; const W = WRITINGS();
  el.innerHTML = W.length ? '<ul class="wlistx">' + W.map(w => '<li><a href="#w-' + escH(w.slug) + '">' + escH(w.title) + '</a>' + (w.date ? '<span class="wd">' + fmtDate(w.date) + '</span>' : '') + (w.summary ? '<span class="ws">' + escH(w.summary) + '</span>' : '') + '</li>').join('') + '</ul>'
    : '<p class="wempty"><b>No writings yet.</b> ' + escH(copy('writings.intro')) + '</p>'; }
function readerList(){ const W = WRITINGS(), body = $('#rdBody');
  $('#rdTtl').textContent = copy('writings.title'); $('#rdBack').hidden = true; RD.slug = '';
  body.innerHTML = (W.length ? '<div class="rd-intro">' + md(copy('writings.intro')) + '</div>' : '') + (W.length ? '<ul class="rd-list">' + W.map(w => { const found = RD.mode !== 'tome' || BOOKS_FOUND.has(w.slug);
      return '<li><a href="#w-' + escH(w.slug) + '" data-w="' + escH(w.slug) + '"><span class="rt">' + escH(w.title) + '</span>' + (w.date ? '<span class="rdd">' + fmtDate(w.date) + '</span>' : '') + (w.summary ? '<span class="rs">' + escH(w.summary) + '</span>' : '') + (BOOKS_READ.has(w.slug) ? '<span class="rread lbl8">Read</span>' : '') + '</a></li>'; }).join('') + '</ul>'
    : '<div class="rd-empty"><span class="rd-glyph" aria-hidden="true"></span><h3>No writings yet</h3><p>' + escH(copy('writings.intro')) + '</p></div>');
  body.scrollTop = 0; }
function readerArticle(slug){ const w = WRITINGS().find(q => q.slug === slug), body = $('#rdBody'); if (!w){ readerList(); return; }
  RD.slug = slug; $('#rdTtl').textContent = RD.mode === 'tome' ? 'Book' : copy('writings.title'); $('#rdBack').hidden = false;
  const n = wordsOf(w); body.innerHTML = '<article class="rd-art"><header><h2>' + escH(w.title) + '</h2><p class="rdmeta">' + (w.date ? fmtDate(w.date) + ' · ' : '') + Math.max(1, Math.round(n / 230)) + ' min read</p></header>' + md(w.body) + '<p class="rd-end" id="rdEnd">' + (RD.mode === 'tome' && !BOOKS_READ.has(slug) ? 'Read to here to finish the book.' : 'The end.') + '</p></article>';
  body.scrollTop = 0; RD.t0 = performance.now(); RD.need = n / 230 * 60 * .6 * 1000; RD.granted = BOOKS_READ.has(slug); }
function openReader(mode, slug){
  RD.mode = mode || 'site'; const el = $('#reader'); el.classList.toggle('tome', RD.mode === 'tome');
  if (!RD.open){ RD.back = state; RD.open = true; if (SCREENS.reader !== el) SCREENS.reader = el; setState('reader'); }
  if (slug) readerArticle(slug); else readerList(); setTimeout(() => { try { $('#rdClose').focus({ preventScroll: true }); } catch (e){} }, 40);
}
function closeReader(){ if (!RD.open) return; RD.open = false; try { if (/^#(writings|w-)/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search); } catch (e){}
  const b = RD.back; if (b === 'play' || b === 'inv') resumePlay(true); else setState(b === 'reader' ? 'title' : b); }
function readerScroll(){ if (RD.mode !== 'tome' || !RD.slug || RD.granted) return; const b = $('#rdBody'); if (b.scrollTop + b.clientHeight < b.scrollHeight - 12) return;
  const left = RD.need - (performance.now() - RD.t0); if (left > 0){ const e = $('#rdEnd'); if (e) e.textContent = 'Take your time: about ' + Math.ceil(left / 1000) + ' more seconds with this one.'; clearTimeout(RD.retry); RD.retry = setTimeout(readerScroll, Math.min(left + 100, 4000)); return; }
  RD.granted = true; BOOKS_READ.add(RD.slug); saveDirty = true; const w = WRITINGS().find(q => q.slug === RD.slug), r = w ? bookRarity(w) : 0;
  let a = (OUT_SEED ^ RD.slug.length * 7919) >>> 0 || 1; const rnd = () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
  const wpn = rollWeapon(rnd, Math.max(1, r)); if (state === 'reader') setTimeout(() => { spawnDrop(WEAPON, PL.x, PL.y + 1.6, PL.z, wpn, 1); for (let i = 0; i <= r; i++) spawnDrop(BISCUIT, PL.x, PL.y + 1.6, PL.z); }, 50);
  SND.reward(); const e = $('#rdEnd'); if (e) e.textContent = 'Well read. A reward waits at your feet.'; toastCard('Well read', (w ? w.title : 'A book') + ' · ' + BOOKS_READ.size + ' read so far', 5000); renderJournalSoon(); }
// a book for a chest: unfound articles, rarer ones weighted toward deeper chests
function rollBook(rand, tier){ const W = WRITINGS(); if (!W.length) return null; const ch = [.0, .14, .28, .45][Math.min(3, tier)] || 0; if (rand() > ch) return null;
  const pool = W.filter(w => !BOOKS_FOUND.has(w.slug) && !inv.some(s => s && s.bk === w.slug)); if (!pool.length) return null;
  let tot = 0; const wts = pool.map(w => { const r = bookRarity(w), k = r <= tier + 1 ? 1 : .15; tot += k; return k; }); let x = rand() * tot; for (let i = 0; i < pool.length; i++){ x -= wts[i]; if (x <= 0) return pool[i]; } return pool[0]; }
function invAddBook(slug){ const w = WRITINGS().find(q => q.slug === slug); if (!w) return 1; for (let i = 0; i < 36; i++) if (!inv[i]){ inv[i] = { id: BOOK0 + bookRarity(w), n: 1, bk: slug }; BOOKS_FOUND.add(slug); invChanged(); bumpSlot(i); toastCard('A book', w.title + '. Use it to read.', 4500); SND.page(); saveDirty = true; renderJournalSoon(); return 0; } return 1; }
function bookTitle(s){ const w = s && s.bk && WRITINGS().find(q => q.slug === s.bk); return w ? w.title : 'Book'; }
function renderLibrary(){ const el = $('#jrLib'); if (!el) return; const W = WRITINGS();
  el.innerHTML = W.length ? '<div class="wstat"><b>' + BOOKS_READ.size + '</b><span>well read</span></div><div class="wstat"><b>' + BOOKS_FOUND.size + '/' + W.length + '</b><span>books found</span></div>'
      + W.map(w => BOOKS_FOUND.has(w.slug) ? '<div class="wrow"><span>' + escH(w.title) + (BOOKS_READ.has(w.slug) ? ' · read' : '') + '</span><a class="btn f-alt" href="#w-' + escH(w.slug) + '">Read</a></div>' : '<div class="wrow off"><span>? ? ?</span><span class="lbl8">Somewhere in a Wilds chest</span></div>').join('')
    : '<p class="jr-note">No books are out in the world yet. ' + escH(copy('writings.intro')) + '</p>'; }
function routeHash(){ const h = location.hash || ''; if (h === '#writings') openReader('site'); else if (/^#w-[a-z0-9-]+$/.test(h)) openReader(RD.open ? RD.mode : 'site', h.slice(3)); }
function initContent(){
  applyCopy();
  const el = $('#reader'); if (el) SCREENS.reader = el;
  $('#rdClose').addEventListener('click', () => closeReader()); $('#rdBack').addEventListener('click', () => { readerList(); try { history.replaceState(null, '', '#writings'); } catch (e){} });
  $('#rdBody').addEventListener('click', e => { const a = e.target.closest && e.target.closest('a[data-w]'); if (a){ e.preventDefault(); readerArticle(a.dataset.w); try { history.replaceState(null, '', '#w-' + a.dataset.w); } catch (x){} } });
  $('#rdBody').addEventListener('scroll', readerScroll, { passive: true });
  const bw = $('#bWritings'); if (bw) bw.addEventListener('click', () => openReader('site'));
  Wn.addEventListener('hashchange', routeHash);
  D.addEventListener('keydown', e => { if (RD.open && e.code === 'Escape'){ e.preventDefault(); e.stopPropagation(); closeReader(); } }, true);
}
