
/* ================= pixel UI kit: frames + icons drawn at native pixel scale ================= */
const ICONS = {};
const ICON_ART = {
  sound: ['............', '.....#......', '....##...#..', '..####.#..#.', '.#####..#.#.', '.#####..#.#.', '.#####..#.#.', '.#####..#.#.', '..####.#..#.', '....##...#..', '.....#......', '............'],
  mute: ['............', '.....#......', '....##......', '..####......', '.#####.#...#', '.#####..#.#.', '.#####...#..', '.#####..#.#.', '..####.#...#', '....##......', '.....#......', '............'],
  pause: ['............', '............', '..###..###..', '..###..###..', '..###..###..', '..###..###..', '..###..###..', '..###..###..', '..###..###..', '..###..###..', '............', '............'],
  close: ['............', '............', '..##....##..', '..###..###..', '...######...', '....####....', '....####....', '...######...', '..###..###..', '..##....##..', '............', '............'],
  play: ['............', '..#.........', '..##........', '..###.......', '..####......', '..#####.....', '..#####.....', '..####......', '..###.......', '..##........', '..#.........', '............'],
  book: ['............', '.####..####.', '.#..#..#..#.', '.#.##..##.#.', '.#..#..#..#.', '.#.##..##.#.', '.#..#..#..#.', '.#.##..##.#.', '.#..#..#..#.', '.####..####.', '.....##.....', '............'],
  pin: ['....####....', '...######...', '..########..', '..###..###..', '..###..###..', '..########..', '...######...', '....####....', '.....##.....', '.....##.....', '............', '............'],
  up: ['............', '.....##.....', '....####....', '...######...', '..###..###..', '.###....###.', '.##.....###.', '.....##.....', '....####....', '...######...', '..###..###..', '.##......##.'],
  pick: ['............', '...######...', '..##....##..', '.##..##..##.', '.#...##...#.', '.....##.....', '.....##.....', '.....##.....', '.....##.....', '.....##.....', '.....##.....', '............'],
  hand: ['............', '....#.#.#...', '....#.#.#.#.', '....#.#.#.#.', '..#.#######.', '..#.#######.', '..##.######.', '...########.', '....######..', '....######..', '....######..', '............'],
  bag: ['............', '....####....', '...#....#...', '...#....#...', '.##########.', '.#........#.', '.#..####..#.', '.#........#.', '.#........#.', '.#........#.', '.##########.', '............'],
  ext: ['............', '......#####.', '.......####.', '......#####.', '.....###.##.', '....###...#.', '...###......', '..###.......', '.###........', '.##.........', '............', '............'],
  check: ['............', '............', '..........##', '.........##.', '........##..', '.##....##...', '..##..##....', '...####.....', '....##......', '............', '............', '............'],
  dash: ['............', '............', '......##....', '.......##...', '##.##...##..', '.........##.', '##.##...##..', '.......##...', '......##....', '............', '............', '............'],
  hook: ['.......###..', '......#...#.', '...........#', '.......#...#', '......###.#.', '.....#.#.#..', '....#..#....', '...#........', '..#.........', '.##.........', '##..........', '............'],
  arrow: ['............', '............', '.....#......', '.....##.....', '.....###....', '.#########..', '.##########.', '.#########..', '.....###....', '.....##.....', '.....#......', '............']
};
// UI glyphs follow the icon style: a light fill lit from the top-left, a shaded bottom-right edge and a 1 px ink outline
// (the ink-coloured variants for ochre buttons stay flat: they sit on a lit surface already)
function iconData(name, color){
  const art = ICON_ART[name], cv = D.createElement('canvas'); cv.width = cv.height = 24; const g = cv.getContext('2d');
  const on = (x, y) => x >= 0 && y >= 0 && x < 12 && y < 12 && art[y][x] === '#', flat = color === '#0e0d11';
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++){
    let c = null;
    if (on(x, y)){ c = color; if (!flat){ if (!on(x, y - 1) || !on(x - 1, y)) c = '#fffaf0'; else if (!on(x, y + 1) || !on(x + 1, y)) c = '#c7bba3'; } }
    else if (!flat && (on(x + 1, y) || on(x - 1, y) || on(x, y + 1) || on(x, y - 1))) c = '#0e0d11';
    if (c){ g.fillStyle = c; g.fillRect(x * 2, y * 2, 2, 2); }
  }
  return cv.toDataURL();
}
function frameData(fill, out, hi, lo, n){
  // 9px source (slice 3) with 1px notched corners and a 1px bevel; displayed at exactly 2x
  n = n || 9; const cv = D.createElement('canvas'); cv.width = cv.height = n; const g = cv.getContext('2d'), e = n - 1;
  const px = (x, y, c) => { g.fillStyle = c; g.fillRect(x, y, 1, 1); };
  g.fillStyle = fill; g.fillRect(1, 1, n - 2, n - 2);
  for (let i = 1; i < e; i++){ px(i, 0, out); px(i, e, out); px(0, i, out); px(e, i, out); }
  if (hi) for (let i = 1; i < e; i++){ px(i, 1, hi); px(1, i, hi); }
  if (lo) for (let i = 1; i < e; i++){ px(i, e - 1, lo); px(e - 1, i, lo); }
  if (hi && lo){ px(e - 1, 1, fill); px(1, e - 1, fill); }
  return cv.toDataURL();
}
function makeUIKit(){
  const R = D.documentElement.style;
  R.setProperty('--fr-panel', 'url(' + frameData('#24212a', '#0e0d11', '#3a3541', '#17151a') + ')');
  R.setProperty('--fr-card', 'url(' + frameData('#ece4d2', '#0e0d11', '#fffaf0', '#cfc4ad') + ')');
  R.setProperty('--fr-btn', 'url(' + frameData('#e0a83f', '#0e0d11', '#f6cd78', '#9c6b23') + ')');
  R.setProperty('--fr-alt', 'url(' + frameData('#3a3541', '#0e0d11', '#4f4957', '#24212a') + ')');
  R.setProperty('--fr-slot', 'url(' + frameData('#17151a', '#0e0d11', '#0b0a0d', '#2c2832') + ')');
  R.setProperty('--fr-sel', 'url(' + frameData('#17151a', '#e0a83f', '#9c6b23', '#9c6b23') + ')');
  R.setProperty('--fr-ring', 'url(' + frameData('rgba(0,0,0,0)', '#e0a83f', '#f6cd78', '#e0a83f') + ')');
  R.setProperty('--fr-key', 'url(' + frameData('#ece4d2', '#0e0d11', null, '#a99c80', 5) + ')');
  D.documentElement.classList.add('has-frames');
  for (const k in ICON_ART){ ICONS[k] = iconData(k, '#ece4d2'); ICONS[k + '_ink'] = iconData(k, '#0e0d11'); }
  // hearts: 12px art, ink outline, rose fill with a highlight; half = left half filled
  const HEART = ['............', '..##....##..', '.#oo#..#oo#.', '#oxxo##oxxo#', '#oxxxxxxxxo#', '#oxxxxxxxxo#', '.#oxxxxxxo#.', '..#oxxxxo#..', '...#oxxo#...', '....#oo#....', '.....##.....', '............'];
  for (const k of ['full', 'half', 'empty']){ const cv = D.createElement('canvas'); cv.width = cv.height = 24; const g = cv.getContext('2d');
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++){ const ch = HEART[y][x]; if (ch === '.') continue; let c = '#0e0d11'; if (ch !== '#'){ const filled = k === 'full' || (k === 'half' && x < 6); c = filled ? (ch === 'o' && y < 5 ? '#f3a6a0' : '#d94c4c') : '#3a3541'; } g.fillStyle = c; g.fillRect(x * 2, y * 2, 2, 2); }
    ICONS['heart_' + k] = cv.toDataURL(); }
  D.querySelectorAll('.ico[data-ico]').forEach(el => { el.style.backgroundImage = 'url(' + ICONS[el.dataset.ico + (el.dataset.ink ? '_ink' : '')] + ')'; });
}
makeUIKit();

/* ================= UI: hotbar, satchel, recipes ================= */
const hotbarEl = $('#hotbar');
const hudSlots = [], invSlots = [];
function mkSlot(i, parent, key){
  const b = D.createElement(key ? 'button' : 'div'); b.className = 'slot f-slot'; b.dataset.s = i;
  if (key){ b.type = 'button'; const k = D.createElement('span'); k.className = 'k'; k.textContent = key; b.appendChild(k); }
  const ic = D.createElement('span'); ic.className = 'ic'; const n = D.createElement('b'); b.appendChild(ic); b.appendChild(n);
  parent.appendChild(b); return b;
}
for (let i = 0; i < 9; i++){ const b = mkSlot(i, hotbarEl, String(i + 1)); hudSlots.push(b); b.addEventListener('click', () => { selectSlot(i); SND.ui(); }); }
{ const main = $('#igMain'), hot = $('#igHot'); for (let i = 9; i < 36; i++) invSlots[i] = mkSlot(i, main); for (let i = 0; i < 9; i++) invSlots[i] = mkSlot(i, hot); }
function paintSlot(el, s){
  const ic = el.querySelector('.ic'), n = el.querySelector('b');
  const want = s ? slotIcon(s) : '';
  const rc = s && s.w ? 'r' + s.w.r : ''; if (el._rc !== rc){ if (el._rc) el.classList.remove(el._rc); if (rc) el.classList.add(rc); el._rc = rc; }
  if (el._ic !== want){ ic.style.backgroundImage = want ? 'url(' + want + ')' : 'none'; el._ic = want; }
  const nt = s && s.n > 1 ? String(s.n) : ''; if (n.textContent !== nt){ const up = (+nt || (s ? 1 : 0)) > (+n.textContent || (el._had ? 1 : 0)); n.textContent = nt; if (up && nt && !REDUCED){ n.classList.remove('tick'); void n.offsetWidth; n.classList.add('tick'); } }
  el._had = !!s;
  const lbl = s ? (s.w ? wFull(s.w) : itemName(s.id)) + (s.n > 1 ? ', ' + s.n : '') : 'Empty slot';
  if (el._lbl !== lbl){ el.setAttribute('aria-label', lbl); el._lbl = lbl; }
}
function bumpSlot(i){ const els = [hudSlots[i], invSlots[i]]; for (const el of els){ if (!el) continue; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); } }
let lastSel = -1, lastHeld = -1, nameT = 0;
// the selection frame slides between slots (one element, CSS spring), instead of swapping frames
const hotsel = D.createElement('i'); hotsel.id = 'hotsel'; hotsel.className = 'f-ring'; hotsel.setAttribute('aria-hidden', 'true'); hotbarEl.appendChild(hotsel);
function placeHotsel(){ const el = hudSlots[sel]; if (!el) return; hotsel.style.width = el.offsetWidth + 'px'; hotsel.style.height = el.offsetHeight + 'px'; hotsel.style.transform = 'translate(' + el.offsetLeft + 'px,' + el.offsetTop + 'px)'; }
function selectSlot(i){ sel = i; invChanged(); }
function heldId(){ const s = inv[sel]; return s ? s.id : 0; }
const holdingWeapon = () => { const s = inv[sel]; return !!(s && s.w); };
function takeFromSel(n){ const s = inv[sel]; if (!s) return; s.n -= n; if (s.n <= 0) inv[sel] = null; invChanged(); }
function invChanged(){
  for (let i = 0; i < 9; i++){ paintSlot(hudSlots[i], inv[i]); const on = i === sel; if (hudSlots[i]._sel !== on){ hudSlots[i]._sel = on; hudSlots[i].classList.toggle('on', on); if (on){ hudSlots[i].classList.remove('pop'); void hudSlots[i].offsetWidth; hudSlots[i].classList.add('pop'); placeHotsel(); } } }
  if (state === 'inv') renderInv();
  const h = heldId();
  if (sel !== lastSel || h !== lastHeld){
    const el = $('#itemname'), hs = inv[sel]; el.textContent = hs ? slotName(hs) : ''; el.style.color = hs && hs.w ? RARITY[hs.w.r].c : ''; el.classList.toggle('on', !!h); clearTimeout(nameT); nameT = setTimeout(() => el.classList.remove('on'), 1400);
    lastSel = sel; lastHeld = h; updateHand();
  }
  hasSail = GEAR.sail;
  saveDirty = true;
}
function renderInv(){
  renderGear();
  for (let i = 0; i < 36; i++) paintSlot(invSlots[i], inv[i]);
  const ce = $('#carry'); if (carried){ ce.hidden = false; ce.querySelector('.ic').style.backgroundImage = 'url(' + slotIcon(carried) + ')'; ce.querySelector('b').textContent = carried.n > 1 ? carried.n : ''; } else ce.hidden = true;
  renderRecipes();
}
const recipeEls = [];
{
  const box = $('#recipeList');
  RECIPES.forEach((r, k) => {
    const row = D.createElement('div'); row.className = 'rec';
    row.innerHTML = '<span class="out"></span><div><div class="nm"></div><div class="ing"></div>' + (r.hint ? '<div class="hint"></div>' : '') + '</div><button class="btn f-btn" type="button">Make</button>';
    row.querySelector('.out').style.backgroundImage = 'url(' + iconURL(r.out[0]) + ')';
    row.querySelector('.nm').textContent = itemName(r.out[0]) + (r.out[1] > 1 ? ' ×' + r.out[1] : '');
    if (r.hint) row.querySelector('.hint').textContent = r.hint;
    const b = row.querySelector('button'); b.setAttribute('aria-label', 'Make ' + itemName(r.out[0]));
    b.addEventListener('click', () => { if (craft(r)) renderInv(); });
    box.appendChild(row); recipeEls.push(row);
  });
}
function renderRecipes(){
  RECIPES.forEach((r, k) => {
    const row = recipeEls[k], ing = row.querySelector('.ing');
    const html = r.ing.map(g => { const have = countItem(g[0]); const id = g[0] === -1 ? ROSE : g[0]; const name = g[0] === -1 ? 'Any flower' : itemName(id), ok = have >= g[1];
      return '<span class="' + (ok ? 'ok' : 'no') + '" title="' + name + ': have ' + have + ', need ' + g[1] + '"><i style="background-image:url(' + iconURL(id) + ')"></i><b>' + Math.min(have, 99) + '</b>/' + g[1] + (ok ? '<i class="ck" style="background-image:url(' + ICONS.check + ')"></i>' : '') + '</span>'; }).join('');
    if (row._h !== html){ ing.innerHTML = html; row._h = html; }
    const can = canCraft(r), bt = row.querySelector('button'); bt.disabled = !can; bt.classList.toggle('f-btn', can); bt.classList.toggle('f-alt', !can); row.classList.toggle('ready', can);
  });
}
const slotGet = i => inv[i], slotSet = (i, s) => { inv[i] = s; };
function quickMove(i){
  const s = inv[i]; if (!s) return;
  const range = i < 9 ? [9, 36] : [0, 9], mx = maxStack(s.id);
  for (let j = range[0]; j < range[1] && s.n; j++){ const t = inv[j]; if (t && t.id === s.id && t.n < mx){ const k = Math.min(s.n, mx - t.n); t.n += k; s.n -= k; } }
  if (s.w){ for (let j = range[0]; j < range[1]; j++) if (!inv[j]){ inv[j] = s; inv[i] = null; return; } return; }
  for (let j = range[0]; j < range[1] && s.n; j++){ if (!inv[j]){ inv[j] = { id: s.id, n: s.n }; s.n = 0; } }
  if (!s.n) inv[i] = null;
}
function clickSlot(i, right, shift){
  const s = slotGet(i);
  if (shift && !carried){ quickMove(i); invChanged(); return; }
  if (carried && carried.w) right = false;
  if (!carried){
    if (!s) return;
    if (right && s.n > 1){ const h = Math.ceil(s.n / 2); carried = { id: s.id, n: h }; s.n -= h; } else { carried = s; slotSet(i, null); }
  } else {
    if (!s){ if (right){ slotSet(i, { id: carried.id, n: 1 }); carried.n--; } else { slotSet(i, carried); carried = null; } }
    else if (s.id === carried.id && !s.w){ const mx = maxStack(s.id), k = right ? Math.min(1, mx - s.n) : Math.min(carried.n, mx - s.n); s.n += k; carried.n -= k; }
    else if (!right){ slotSet(i, carried); carried = s; }
    if (carried && carried.n <= 0) carried = null;
  }
  SND.ui(); invChanged();
}
let dragFrom = -1, dragMoved = false, dragX = 0, dragY = 0;
const invEl = $('#inv');
invEl.addEventListener('contextmenu', e => e.preventDefault());
// tooltip card: weapon stats with a comparison to what you are holding
const tipEl = $('#tip');
function equippedWeapon(){ const s = inv[sel]; if (s && s.w) return s.w; let b = null; for (let i = 0; i < 9; i++){ const q = inv[i]; if (q && q.w && (!b || wDps(q.w) > wDps(b))) b = q.w; } return b; }
function showTip(el){
  const s = inv[+el.dataset.s]; if (!s){ tipEl.hidden = true; return; }
  let h;
  if (s.w){ const w = s.w, R = RARITY[w.r], F = FAM[w.f], eq = equippedWeapon(), cmp = eq && eq !== w ? eq : null;
    const row = (lbl, v, ev, fmt, inv2) => { let d = ''; if (cmp){ const diff = v - ev; if (Math.abs(diff) > 1e-3){ const up = inv2 ? diff < 0 : diff > 0; d = '<em class="' + (up ? 'up' : 'dn') + '">' + (up ? '\u25b2' : '\u25bc') + ' ' + fmt(Math.abs(diff)) + '</em>'; } } return '<div class="tr"><span>' + lbl + '</span><b>' + fmt(v) + '</b>' + d + '</div>'; };
    h = '<div class="tt" style="color:' + R.c + '">' + esc(w.nm) + '</div><div class="ts">' + R.n + ' ' + F.noun.toLowerCase() + ' &middot; ' + F.desc + '</div>'
      + row('Damage', w.dmg, cmp && cmp.dmg, v => v.toFixed(1)) + row('Speed', w.spd, cmp && cmp.spd, v => v.toFixed(2) + '/s') + row('Reach', w.reach, cmp && cmp.reach, v => v.toFixed(1) + 'm') + row('Crit', w.crit * 100, cmp && cmp.crit * 100, v => Math.round(v) + '%') + row('DPS', wDps(w), cmp && wDps(cmp), v => v.toFixed(1))
      + w.ax.map(a => '<div class="ta">' + (AFFIX[a].pre || AFFIX[a].suf) + ': ' + AFFIX[a].d + '</div>').join('')
      + (cmp ? '<div class="tc">Compared with ' + esc(cmp.nm) + '</div>' : eq === w ? '<div class="tc">Equipped</div>' : ''); }
  else h = '<div class="tt">' + esc(itemName(s.id)) + (s.n > 1 ? ' &times;' + s.n : '') + '</div>' + ((s.id === BUN || s.id === BISCUIT) ? '<div class="ts">Food: restores ' + (s.id === BUN ? 3 : 2) + ' hearts. Creatures love it too.</div>' : '');
  tipEl.innerHTML = h; tipEl.hidden = false;
  const r = el.getBoundingClientRect(), tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
  let x = r.right + 8, y = r.top; if (x + tw > innerWidth - 8) x = r.left - tw - 8; if (x < 8) x = 8; if (y + th > innerHeight - 8) y = innerHeight - th - 8;
  tipEl.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
}
invEl.addEventListener('pointerover', e => { const sl = e.target.closest && e.target.closest('#inv .slot'); if (sl) showTip(sl); else tipEl.hidden = true; });
invEl.addEventListener('focusin', e => { const sl = e.target.closest && e.target.closest('#inv .slot'); if (sl) showTip(sl); });
invEl.addEventListener('pointerleave', () => { tipEl.hidden = true; });
invEl.addEventListener('pointerdown', e => {
  const sl = e.target.closest && e.target.closest('.slot'); if (!sl) return;
  e.preventDefault();
  const i = +sl.dataset.s; dragFrom = i; dragMoved = false; dragX = e.clientX; dragY = e.clientY;
  clickSlot(i, e.button === 2, e.shiftKey); moveCarry(e);
});
function moveCarry(e){ $('#carry').style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)'; }
Wn.addEventListener('pointermove', e => { if (state !== 'inv') return; moveCarry(e); if (Math.abs(e.clientX - dragX) + Math.abs(e.clientY - dragY) > 6) dragMoved = true; });
Wn.addEventListener('pointerup', e => {
  if (state !== 'inv' || dragFrom < 0) return;
  const el = D.elementFromPoint(e.clientX, e.clientY), sl = el && el.closest ? el.closest('#inv .slot') : null;
  if (dragMoved && carried && sl && +sl.dataset.s !== dragFrom) clickSlot(+sl.dataset.s, false, false);
  dragFrom = -1;
});

/* ================= toasts (small, quiet, max 3) ================= */
const toastBox = $('#toasts');
// toasts slide in, stack, and collapse out of the stack when they leave (no jumps)
function dropToast(el){ if (el._gone) return; el._gone = true; el.classList.add('gone'); setTimeout(() => el.remove(), 220); }
function pushToast(el, ms){
  SND.toast();
  const live = [...toastBox.children].filter(c => !c._gone); for (let i = 0; i < live.length - 2; i++) dropToast(live[i]);
  toastBox.appendChild(el);
  setTimeout(() => dropToast(el), ms);
}
function toast(msg, ms){ const el = D.createElement('div'); el.className = 'toast'; el.textContent = msg; pushToast(el, ms || 2200); }
function toastCard(title, text, ms){ const el = D.createElement('div'); el.className = 'toast card f-panel'; const l = D.createElement('span'); l.className = 'lbl'; l.textContent = title; const p = D.createElement('p'); p.textContent = text; el.appendChild(l); el.appendChild(p); pushToast(el, ms || 5000); }

/* ================= states, screens, pointer lock ================= */
let state = 'title', locked = false, lookMode = TOUCH ? 'touch' : 'lock', prevState = 'play', lockTries = 0;
const keys = Object.create(null);
let mineHeld = false, useHeld = false, useCD = 0;
const SCREENS = { title: $('#title'), pause: $('#pause'), inv: invEl, panel: $('#panel'), journal: $('#journal') };
const hudEl = $('#hud'), touchEl = $('#touch'), resumeEl = $('#resume');
function clearInput(){ for (const k in keys) keys[k] = false; mineHeld = false; useHeld = false; INP.jump = false; INP.jumpEdge = false; joy.on = false; joy.x = joy.y = 0; $('#stick').classList.remove('on'); }
function showScreen(el, on){
  if (on){ if (el.hidden){ el.hidden = false; el.classList.remove('out'); el.classList.remove('in'); void el.offsetWidth; el.classList.add('in'); } }
  else if (!el.hidden && !el.classList.contains('out')){ el.classList.remove('in'); el.classList.add('out'); setTimeout(() => { if (el.classList.contains('out')){ el.hidden = true; el.classList.remove('out'); } }, 130); }
}
function setState(s){
  state = s; clearInput(); if (U) setFog();
  for (const k in SCREENS) showScreen(SCREENS[k], k === s);
  hudEl.hidden = s === 'title' || s === 'cine' || CINE.on || !glOK; if (!hudEl.hidden) placeHotsel();
  $('#skip').hidden = !(s === 'play' || s === 'title');
  touchEl.hidden = !(TOUCH && s === 'play');
  updateResume();
  if (s !== 'play' && D.pointerLockElement){ try { D.exitPointerLock(); } catch (e){} }
  if (s !== 'inv') $('#carry').hidden = true;
  updateHand();
}
function updateResume(){ resumeEl.hidden = !(state === 'play' && lookMode === 'lock' && !locked); }
function requestLock(){
  if (lookMode !== 'lock' || !glOK) return;
  const fail = () => { lockTries++; if (lockTries >= 1 && !locked){ lookMode = 'drag'; updateResume(); toast('Drag with the mouse to look around'); } };
  try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => { if (!locked && !recentlyUnlocked()) fail(); }); } catch (e){ fail(); }
}
let unlockAt = 0; const recentlyUnlocked = () => performance.now() - unlockAt < 1500;
D.addEventListener('pointerlockchange', () => {
  locked = D.pointerLockElement === canvas;
  if (!locked){ unlockAt = performance.now(); if (state === 'play' && lookMode === 'lock') setState('pause'); }
  updateResume();
});
D.addEventListener('pointerlockerror', () => { if (!recentlyUnlocked()){ lookMode = 'drag'; updateResume(); toast('Drag with the mouse to look around'); } });
function startPlay(){ audioStart(); setState('play'); requestLock(); try { canvas.focus({ preventScroll: true }); } catch (e){} tutShow(); }
function resumePlay(gesture){ setState('play'); if (gesture) requestLock(); }
function gateOpen(){ const ov = D.querySelector('.kcg-overlay'); return !!(ov && !ov.classList.contains('kcg-hide')); }
const SIGN_LABEL = { hub: 'The Hub', eden: copy('eden.title'), j: copy('j.title'), about: copy('about.title'), contact: copy('contact.title') };
const panelEl = SCREENS.panel;
function openPanel(mode, id){
  if (state !== 'panel') prevState = state;
  setState('panel');
  panelEl.classList.toggle('panel-sign', mode === 'sign'); panelEl.classList.toggle('panel-end', mode === 'end');
  D.querySelectorAll('#book section').forEach(s => { s.hidden = mode === 'sign' && s.dataset.sign !== id; });
  panelEl.setAttribute('aria-label', mode === 'sign' ? 'Sign: ' + SIGN_LABEL[id] : mode === 'end' ? 'Say hello' : 'Plain text version');
  $('#panelKick').textContent = mode === 'sign' ? 'Waystone · ' + SIGN_LABEL[id] : mode === 'end' ? 'The end' : 'Plain text version';
  const newly = mode === 'sign' && !ways.has(id);
  $('#footTravel').textContent = newly ? ' · Waystone lit. Travel here any time from your journal.' : '';
  if (mode === 'index' || mode === 'end' || id === 'contact'){ const g = D.querySelector('[data-contact-gate]'); try { if (Wn.KaiavContact && g) Wn.KaiavContact.mount(g); } catch (e){} }
  $('#parch').scrollTop = 0;
  setTimeout(() => { try { $('#panelClose').focus({ preventScroll: true }); } catch (e){} }, 30);
  if (mode === 'sign'){ SND.page(); activateWaystone(id); if (id === 'hub') tut('sign'); }
}
function closePanel(gesture){ if (CINE.on){ endCardClosed(gesture); return; } const back = prevState; if (back === 'title') setState('title'); else if (back === 'pause') setState('pause'); else resumePlay(gesture); }
function openIndex(){ openPanel('index'); }
function openInv(){ if (state !== 'play') return; setState('inv'); renderInv(); SND.panel(); }
function closeInv(gesture){
  tipEl.hidden = true;
  if (carried){ const l = invAdd(carried.id, carried.n); if (l) spawnDrop(carried.id, PL.x, PL.y + 1.4, PL.z); carried = null; }
  resumePlay(gesture); invChanged();
}
function openJournal(){ if (state !== 'play' && state !== 'pause') return; if (state !== 'journal') prevState = state; renderJournal(); setState('journal'); SND.page(); SND.panel(); setTimeout(() => { try { $('#jrClose').focus({ preventScroll: true }); } catch (e){} }, 30); }
function closeJournal(gesture){ if (prevState === 'pause') setState('pause'); else resumePlay(gesture); }
function homeStand(){ return { x: SPAWN.x, y: SPAWN.y, z: SPAWN.z, yaw: Math.PI }; } // respawns and reseeds land you on the spawn lawn, facing the engine
function signStand(s){
  const I = ISL[0];
  let dx = 0, dz = 0; if (s.axis === 'x') dz = Math.sign(I.z - s.z) || 1; else dx = Math.sign(I.x - s.x) || 1;
  if (s.id === 'hub') dz = 1;
  return { x: s.x + .5 + dx * 2.5, y: s.y, z: s.z + .5 + dz * 2.5, yaw: Math.atan2(dx, dz) };
}
function nearestSign(px, py, pz, r){ let best = null, bd = r; for (const s of SIGNS){ const d = hyp2(px - s.x - .5, pz - s.z - .5); if (d < bd && Math.abs(py - s.y) < 4){ bd = d; best = s; } } return best; }
$('#bPlay').addEventListener('click', startPlay);
$('#bResume').addEventListener('click', () => { SND.ui(); resumePlay(true); });
$('#pauseClose').addEventListener('click', () => { SND.ui(); resumePlay(true); });
$('#bControls').addEventListener('click', () => { const c = $('#ctlPause'); c.hidden = !c.hidden; $('#bControls').setAttribute('aria-expanded', c.hidden ? 'false' : 'true'); });
$('#bSound').addEventListener('click', () => { audioStart(); setMuted(!AU.muted); });
$('#bMute').addEventListener('click', e => { audioStart(); setMuted(!AU.muted); e.currentTarget.blur(); });
$('#bPause').addEventListener('click', () => { if (state === 'play') setState('pause'); else if (state === 'pause') resumePlay(true); });
$('#bJournal').addEventListener('click', () => openJournal());
$('#bJournal2').addEventListener('click', () => openJournal());
$('#jrClose').addEventListener('click', () => closeJournal(true));
$('#bView').addEventListener('click', () => setThird(!third));
let headBob = !REDUCED, tipsOn = true, autoJump = TOUCH;
$('#bAuto').addEventListener('click', () => { autoJump = !autoJump; $('#vAuto').textContent = autoJump ? 'On' : 'Off'; saveDirty = true; });
$('#bBob').addEventListener('click', () => { headBob = !headBob; $('#vBob').textContent = headBob ? 'On' : 'Off'; saveDirty = true; });
$('#bTips').addEventListener('click', () => { tipsOn = !tipsOn; $('#vTips').textContent = tipsOn ? 'On' : 'Off'; tutShow(); saveDirty = true; });
let sens = 1;
$('#sens').addEventListener('input', e => { sens = +e.target.value; saveDirty = true; });
$('#bMix').addEventListener('click', e => { const m = $('#mixPause'), open = m.hidden; m.hidden = !open; e.currentTarget.setAttribute('aria-expanded', open ? 'true' : 'false'); SND.ui(); });
for (const el of D.querySelectorAll('#mixPause input')) el.addEventListener('input', e => { audioStart(); setVol(e.target.dataset.bus, +e.target.value); });
function syncMix(){ for (const el of D.querySelectorAll('#mixPause input')) el.value = AU.vol[el.dataset.bus]; }
let seedArm = 0;
$('#bSeed').addEventListener('click', () => {
  if (Date.now() - seedArm > 4000){ seedArm = Date.now(); $('#vSeed').textContent = 'Click again'; setTimeout(() => { $('#vSeed').textContent = '#' + (OUT_SEED % 100000); }, 4000); return; }
  seedArm = 0; if (!inSafe(PL.x, PL.z)){ const p = homeStand(); PL.x = PL.px = p.x; PL.y = PL.py = p.y; PL.z = PL.pz = p.z; PL.vx = PL.vy = PL.vz = 0; }
  reseedWilds((Math.random() * 4294967295) >>> 0); $('#vSeed').textContent = '#' + (OUT_SEED % 100000); toast('New outer islands drift into view'); resumePlay(true);
});
let resetArm = 0;
$('#bReset').addEventListener('click', () => {
  if (Date.now() - resetArm > 4000){ resetArm = Date.now(); $('#vReset').textContent = 'Click again'; setTimeout(() => { $('#vReset').textContent = ''; }, 4000); return; }
  resetArm = 0; $('#vReset').textContent = ''; resetWorld(); toast('The world is fresh again'); resumePlay(true);
});
['#skip', '#bSkipTitle', '#bSkipPause'].forEach(s => $(s).addEventListener('click', () => { if (state === 'panel') return; openIndex(); }));
$('#panelClose').addEventListener('click', () => closePanel(true));
$('#bEndBack').addEventListener('click', () => closePanel(true));
$('#bEndReplay').addEventListener('click', () => { if (CINE.on) cineReplay(); });
$('#bReplay').addEventListener('click', () => { if (ENGINE) startCine(); });
$('#cineSkip').addEventListener('click', e => { e.currentTarget.blur(); cineSkip(); });
$('#cinePause').addEventListener('click', e => { e.currentTarget.blur(); cinePause(); });
$('#invClose').addEventListener('click', () => closeInv(true));
for (const k of ['panel', 'inv', 'journal', 'pause']) SCREENS[k].addEventListener('click', e => { if (e.target !== SCREENS[k]) return; if (k === 'panel') closePanel(true); else if (k === 'inv') closeInv(true); else if (k === 'journal') closeJournal(true); else resumePlay(true); });
panelEl.addEventListener('click', e => { const a = e.target.closest && e.target.closest('.idx-head nav a'); if (a){ e.preventDefault(); const t = D.querySelector(a.getAttribute('href')); if (t) t.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' }); } });
const KC = k => '<span class="kc f-key">' + k + '</span>';
const CTL_DESK = [['Move', KC('W') + KC('A') + KC('S') + KC('D')], ['Look', KC('Mouse')], ['Jump; in the air, open or close the sail', KC('Space')], ['Sprint', KC('Shift')], ['Sneak, slide when sprinting', KC('C')], ['Dash', KC('Q')], ['Interact', KC('E')], ['Mine (hold)', KC('LMB')], ['Use / place', KC('RMB')], ['Satchel', KC('I')], ['Journal', KC('J')], ['Camera', KC('V')], ['Pause', KC('Esc')]];
const CTL_TOUCH = [['Move', 'left thumb'], ['Look', 'drag right side'], ['Jump / sail', 'tap Jump in the air'], ['Dash', 'Dash'], ['Read, pet', 'tap'], ['Mine', 'hold Mine'], ['Use / place', 'Use']];
const ctlHTML = (TOUCH ? CTL_TOUCH.map(k => '<span>' + KC(k[1]) + '</span><span>' + k[0] + '</span>') : CTL_DESK.map(k => '<span>' + k[1] + '</span><span>' + k[0] + '</span>')).join('');
['#ctlTitle', '#ctlPause', '#ctlSign'].forEach(s => { $(s).innerHTML = ctlHTML; });

/* ================= journal ================= */
let journalDirty = true;
function renderJournalSoon(){ journalDirty = true; if (state === 'journal') renderJournal(); }
function explorePct(){ const tot = SHARDS.length + DISC.length + 2 + 1 + 1; const have = found.size + visited.size + friends.size + (RC.done ? 1 : 0) + (storySeen ? 1 : 0); return Math.round(have / tot * 100); }
function renderJournal(){
  journalDirty = false;
  const pct = explorePct(); $('#jrPct').textContent = pct + '%'; $('#jrBar').style.width = pct + '%';
  $('#jrShards').innerHTML = SHARDS.map(s => found.has(s.i) ? '<li><span class="n">' + String(s.i + 1).padStart(2, '0') + '</span><span>' + esc(s.text) + '</span></li>' : '<li class="lock"><span class="n">' + String(s.i + 1).padStart(2, '0') + '</span><span>' + (s.hidden && !RC.done ? 'Reward for threading the ring course' : 'Somewhere ' + (ISL[s.isle] && (!ISL[s.isle].small || ISL[s.isle].disc) ? (s.isle === 4 && s.y < ISL[4].top - 2 ? 'under ' : 'on ') + ISL[s.isle].name : 'on a small islet')) + '</span></li>').join('');
  const here = nearestSign(PL.x, PL.y, PL.z, 14);
  if ($('#jrWays')) $('#jrWays').innerHTML = SIGNS.map(s => ways.has(s.id) ? '<div class="wrow"><span>' + SIGN_LABEL[s.id] + '</span>' + (here === s ? '<span class="lbl8 here">You are here</span>' : '<button class="btn f-btn" type="button" data-go="' + s.id + '">Travel</button>') + '</div>' : '<div class="wrow off"><span>' + SIGN_LABEL[s.id] + '</span><span class="lbl8">Unlit</span></div>').join('');
  { const vault = OUT.find(I => I.forceVault);
    $('#jrGear').innerHTML = '<div class="gearbox">' + [['sail', 'Sky sail', GEAR.sail, storySeen ? 'Gifted by the Memory Engine' : 'Wake the Memory Engine to receive it'], ['grapple', 'Grappling hook', GEAR.grapple, 'Locked. It rests in the Sky Vault' + (vault ? ' on ' + vault.name + (vault.seen ? ' (found)' : ', far out in the Wilds') : ', deep in the Wilds') + '. Guarded.']].map(([k, nm, on, lock]) => '<div class="gear' + (on ? ' on' : '') + '"><span class="gi f-slot" style="background-image:url(' + gearIconURL(k, on) + ')"></span><span class="gt"><b>' + nm + '</b><em>' + (on ? 'Equipped' : esc(lock)) + '</em></span></div>').join('') + '</div>';
    const K = s => s.split(' ').map(k => KC(k)).join(''), T = TOUCH;
    const MV = [['Sprint', T ? K('Push') + ' stick far' : K('Shift') + ' or ' + K('W') + K('W') + ' hold', 'Faster, wider FOV'], ['Sprint jump', T ? K('Jump') : K('Space'), 'Carries sprint speed'], ['Slide', T ? '' : K('C'), 'Crouch while sprinting'], ['Slide jump', T ? K('Jump') : K('Space'), 'Jump out of a slide; keeps its speed'], ['Dash', T ? K('Dash') : K('Q') + ' or ' + K('A') + K('A'), 'Once in the air too'], ['Mantle', T ? K('Jump') : K('Space'), 'Jump at a ledge and you pull up'], ['Wall kick', T ? K('Jump') : K('Space'), 'In the air against a wall, twice'], ['Sail', T ? K('Jump') : K('Space'), 'In the air: open or close'], ['Flap', T ? K('Jump') : K('Space'), 'While gliding, after 6 relics'], ['Grapple', T ? K('Hook') : K('F') + ' or ' + K('RMB'), GEAR.grapple ? 'Fire at rock; again to let go' : 'Needs the grappling hook'], ['Reel', T ? K('Jump') : K('Space') + ' hold', 'Shorten the rope'], ['Fling to sail', T ? K('Hook') + K('Jump') : K('F') + ' ' + K('Space'), 'Release at the top, open the sail']];
    $('#jrMoves').innerHTML = MV.map(m => '<span class="kk">' + (m[1] || '') + '</span><span class="mv"><b>' + m[0] + '</b> · ' + m[2] + '</span>').join(''); }
  $('#jrIsles').innerHTML = DISC.map(i => '<span class="' + (visited.has(i) ? 'on' : '') + '">' + (visited.has(i) || i === 0 ? ISL[i].name : '? ? ?') + '</span>').join('');
  $('#jrSail').innerHTML = ['Glide', 'Long glide', 'Boost flap'].map((n, i) => '<span class="' + (i <= sailLevel && hasSail ? 'on' : '') + '">' + n + (i ? ' <em>' + (i * 3) + ' shards</em>' : '') + '</span>').join('');
  { const seen = OUT.filter(I => I.seen).length, b = wildStats.best;
    $('#jrWilds').innerHTML = '<div class="wstat"><b>' + seen + '/' + OUT.length + '</b><span>islands found</span></div><div class="wstat"><b>' + wildStats.chests + '</b><span>chests opened</span></div><div class="wstat"><b>' + wildStats.kills + '</b><span>foes defeated</span></div>'
      + '<p class="jr-note">' + (b ? 'Best find: <b style="color:' + RARITY[b.r].c + '">' + esc(wFull(b)) + '</b> (' + wDps(b).toFixed(1) + ' damage per second)' : 'No weapons yet. Chests in the ruins and camps hold them.') + '</p>'
      + '<p class="jr-note dim2">Outer seed #' + (OUT_SEED % 100000) + '. The safe skies end at the banner buoys.</p>'; }
  renderAtlas(); renderLibrary();
  $('#jrRings').textContent = RC.done ? 'Cleared. Best ' + RC.best.toFixed(1) + 's' : 'Not cleared yet. It starts at the east rim\'s updraft.';
  $('#jrFriends').innerHTML = ['puffle', 'kit'].map(k => '<span class="' + (friends.has(k) ? 'on' : '') + '">' + SPEC[k].name + '</span>').join('') ;
  $('#jrFest').innerHTML = found.size === SHARDS.length ? '<button class="btn f-btn" type="button" id="bFest">Light the lanterns again</button>' : '<p class="dim" style="margin:0;font:400 14px/20px var(--tx)">Find every shard to light the sky festival.</p>';
  const bf = $('#bFest'); if (bf) bf.addEventListener('click', () => { startFestival(); closeJournal(true); });
  D.querySelectorAll('#jrWays [data-go]').forEach(b => b.addEventListener('click', () => travelTo(b.dataset.go)));
}
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/* fast travel: a short sky-streak */
const streakCv = $('#streak'), streakG = streakCv.getContext('2d');
let travel = null;
function travelTo(id){
  lastWay = id;
  const s = SIGNS.find(q => q.id === id); if (!s) return;
  resumePlay(true); travel = { t: 0, to: signStand(s), done: false }; SND.whoosh(); PL.punch = 1.4;
  streakCv.width = Math.ceil(innerWidth / 4); streakCv.height = Math.ceil(innerHeight / 4); streakCv.style.width = '100%'; streakCv.style.height = '100%';
}
function stepTravel(dt){
  if (!travel) return;
  travel.t += dt; const u = travel.t / .55;
  const a = u < .5 ? u * 2 : 2 - u * 2;
  streakCv.style.opacity = clamp(a, 0, 1).toFixed(2);
  const w = streakCv.width, h = streakCv.height; streakG.clearRect(0, 0, w, h);
  streakG.fillStyle = 'rgba(236,228,210,.9)'; for (let i = 0; i < 40; i++){ const y = (i * 37 + Math.floor(travel.t * 400) * (i % 3 + 1)) % h, x = (i * 53 + Math.floor(travel.t * 900)) % w; streakG.fillRect(x, y, 8 + (i % 5) * 6, 1); }
  streakG.fillStyle = 'rgba(236,228,210,' + (a * .5).toFixed(2) + ')'; streakG.fillRect(0, 0, w, h);
  if (u >= .5 && !travel.done){ travel.done = true; const p = travel.to; PL.x = PL.px = p.x; PL.y = PL.py = p.y; PL.z = PL.pz = p.z; PL.yaw = p.yaw + Math.PI; PL.vx = PL.vy = PL.vz = 0; PL.safe = { x: p.x, y: p.y, z: p.z, yaw: PL.yaw }; }
  if (u >= 1){ travel = null; streakCv.style.opacity = 0; }
}

/* ================= tutorial (one thing at a time, dismissable, remembered) ================= */
const TUT = [
  { k: 'move', d: () => (TOUCH ? 'Drag on the right to look. Use the left thumb to walk.' : 'Look with the mouse and walk with ' + KC('W') + KC('A') + KC('S') + KC('D') + '.'), at: null },
  { k: 'story', d: () => 'Walk to the Memory Engine at the heart of the island and ' + (TOUCH ? 'tap ' + KC('Tap') : 'press ' + KC('E')) + ' at its console to watch the story.', at: () => ENGINE && [ENGINE.console.x, ENGINE.console.y + 2.6, ENGINE.console.z] },
  { k: 'glide', d: () => 'Step into the shimmering updraft off the east rim, then press ' + (TOUCH ? KC('Jump') : KC('Space')) + ' in the air to open the sail and ride it to an islet.', at: () => UPDRAFTS[0] && [UPDRAFTS[0].x, UPDRAFTS[0].top - 11, UPDRAFTS[0].z] },
  { k: 'gather', d: () => 'Your satchel is empty. ' + (TOUCH ? 'Hold ' + KC('Mine') : 'Hold ' + KC('LMB')) + ' on a tree to chop a log, or on leaves.', at: () => { const t = nearestTree(); return t && [t[0] + .5, t[1] + 2.5, t[2] + .5]; } },
  { k: 'craft', d: () => 'Open the satchel with ' + (TOUCH ? KC('Bag') : KC('I')) + ' and craft Vineseed from 2 leaves and a flower.', at: null }
];
function nearestTree(){ let b = null, bd = 1e9; for (const t of TREES){ if (getB(t[0], t[1], t[2]) !== LOG) continue; const d = hyp2(t[0] - PL.x, t[2] - PL.z); if (d < bd){ bd = d; b = t; } } return b; }
let tutStep = 0, tutMoved = 0;
function tut(k){
  const i = TUT.findIndex(t => t.k === k); if (i < 0 || i !== tutStep) return;
  tutStep++; while (tutStep < TUT.length && tutDone(TUT[tutStep].k)) tutStep++;
  if (tutStep >= TUT.length) toastCard('The sky is yours', 'Sky relics upgrade your sail. Find them all, thread the ring course, explore the Wilds beyond the buoys, and make a friend or two. Your journal is on ' + (TOUCH ? 'the book button.' : KC('J').replace(/<[^>]+>/g, '') + '.'), 7000);
  saveDirty = true; tutShow();
}
function tutDone(k){ if (k === 'story') return storySeen && GEAR.sail; if (k === 'glide') return [...visited].some(i => i > 0); if (k === 'gather') return countItem(LOG) + countItem(LEAVES) + countItem(PLANKS) > 0; if (k === 'craft') return countItem(SEED) > 0; return false; }
function tutShow(){
  while (tutStep < TUT.length && tutDone(TUT[tutStep].k)) tutStep++;
  const el = $('#tut'), on = tipsOn && tutStep < TUT.length && state === 'play';
  el.hidden = !on; if (!on) { $('#objective').hidden = true; return; }
  $('#tutStep').textContent = (tutStep + 1) + '/' + TUT.length; $('#tutText').innerHTML = TUT[tutStep].d();
}
$('#tutClose').addEventListener('click', () => { tutStep++; while (tutStep < TUT.length && tutDone(TUT[tutStep].k)) tutStep++; saveDirty = true; tutShow(); SND.ui(); });
const _ov = glOK ? new THREE.Vector3() : null;
let objLast = '';
function updateObjective(){
  const el = $('#objective');
  if (!tipsOn || tutStep >= TUT.length || state !== 'play' || !TUT[tutStep].at){ if (!el.hidden) el.hidden = true; return; }
  const p = TUT[tutStep].at(); if (!p){ if (!el.hidden) el.hidden = true; return; }
  _ov.set(p[0], p[1], p[2]).project(camera);
  let x = _ov.x, y = _ov.y; const behind = _ov.z > 1;
  if (behind){ x = -x; y = -y; }
  const m = Math.max(Math.abs(x), Math.abs(y));
  if (behind || m > .9){ x = x / Math.max(m, 1e-3) * .9; y = y / Math.max(m, 1e-3) * .82; }
  const top = $('#tut').hidden ? 40 : (innerWidth < 760 ? 230 : 110);
  const sx = Math.round((x * .5 + .5) * innerWidth / 2) * 2, sy = Math.max(top, Math.round((-y * .5 + .5) * innerHeight / 2) * 2);
  if (el.hidden) el.hidden = false;
  el.style.transform = 'translate(' + sx + 'px,' + sy + 'px)';
  const d = Math.round(hyp2(p[0] - PL.x, p[2] - PL.z)) + 'm'; if (d !== objLast){ objLast = d; $('#objDist').textContent = d; }
}

/* ================= input ================= */
let nearSign = null;
Wn.addEventListener('keydown', e => {
  if (gateOpen()) return;
  const tg = e.target; if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable)) return;
  const c = e.code;
  if (c === 'KeyM' && state !== 'title'){ audioStart(); setMuted(!AU.muted); return; }
  if (state === 'cine'){
    if (c === 'Escape'){ e.preventDefault(); cineSkip(); }
    else if ((c === 'Space' || c === 'Enter' || c === 'ArrowRight') && !e.repeat && !(tg && tg.tagName === 'BUTTON' && c !== 'ArrowRight')){ e.preventDefault(); cineNext(); }
    else if (c === 'KeyP'){ cinePause(); }
    return;
  }
  if (state === 'play'){
    if (c === 'F5' || c === 'KeyV'){ e.preventDefault(); setThird(!third); return; }
    if (c === 'Space'){ e.preventDefault(); if (!e.repeat) INP.jumpEdge = true; INP.jump = true; }
    if (!e.repeat){
      const nowT = performance.now(), last = tapT[c] || 0; tapT[c] = nowT;
      if (c === 'KeyW' && nowT - last < 250) sprintLatch = true; // double-tap W and hold to sprint
      if (c === 'KeyF') grappleAction();
      if ((c === 'KeyA' || c === 'KeyD' || c === 'KeyS') && nowT - last < 240) dashDir(c === 'KeyA' ? -1 : c === 'KeyD' ? 1 : 0, c === 'KeyS' ? -1 : 0);
      if (c === 'KeyQ') dashDir(null);
      if (c === 'KeyC' || c === 'ControlLeft') INP.sneakEdge = true;
    }
    if (c.startsWith('Arrow') || c === 'ControlLeft') e.preventDefault();
    keys[c] = true;
    if (c === 'KeyE'){ if (nearEngine) startCine(); else if (nearSign) openPanel('sign', nearSign.id); else if (nearChestC) openChest(nearChestC); else openInv(); }
    else if (c === 'KeyI') openInv();
    else if (c === 'KeyJ') openJournal();
    else if (c.startsWith('Digit')){ const d = +c.slice(5); if (d >= 1 && d <= 9) selectSlot(d - 1); }
    else if (c === 'Escape' && !locked) setState('pause');
  } else if (state === 'inv'){ if (c === 'KeyE' || c === 'KeyI' || c === 'Escape'){ e.preventDefault(); closeInv(c !== 'Escape'); } }
  else if (state === 'journal'){ if (c === 'KeyJ' || c === 'Escape'){ e.preventDefault(); closeJournal(c !== 'Escape'); } }
  else if (state === 'panel'){ if (c === 'Escape' || (c === 'KeyE' && prevState === 'play')){ e.preventDefault(); closePanel(c !== 'Escape'); } }
  else if (state === 'pause'){ if (c === 'Escape'){ e.preventDefault(); resumePlay(false); } else if (c === 'KeyJ') openJournal(); }
  else if (state === 'title'){ if (c === 'Enter' && tg === D.body){ startPlay(); } }
}, true);
Wn.addEventListener('keyup', e => { keys[e.code] = false; if (e.code === 'Space') INP.jump = false; if (e.code === 'KeyW') sprintLatch = false; });
const tapT = Object.create(null); let sprintLatch = false;
function dashDir(x, z){ if (x === null){ const l = hyp2(INP.x, INP.z); INP.dashX = l > .1 ? INP.x : 0; INP.dashZ = l > .1 ? INP.z : 1; } else { INP.dashX = x; INP.dashZ = z; } INP.dashEdge = true; }
Wn.addEventListener('blur', () => { clearInput(); });
D.addEventListener('mousemove', e => {
  if (state !== 'play') return;
  if (locked){ const dx = e.movementX, dy = e.movementY; if (Math.abs(dx) > 400 || Math.abs(dy) > 400) return; look(dx, dy, .003); }
  else if (lookMode === 'drag' && drag.on){ const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 5) drag.moved = true; if (drag.moved){ look(dx, dy, .0055); mineHeld = false; } }
});
function look(dx, dy, k){ PL.yaw -= dx * k * sens; PL.pitch = clamp(PL.pitch - dy * k * sens, -1.55, 1.55); }
const drag = { on: false, x: 0, y: 0, sx: 0, sy: 0, moved: false, t0: 0 };
const joy = { on: false, id: -1, cx: 0, cy: 0, x: 0, y: 0 };
const lookPtr = { id: -1, x: 0, y: 0, sx: 0, sy: 0, t0: 0, ax: 0, ay: 0 };
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointerdown', e => { if (state === 'cine' && (e.pointerType === 'touch' || e.button === 0)){ audioStart(); cineNext(); } });
canvas.addEventListener('pointerdown', e => {
  if (state !== 'play') return;
  if (e.pointerType === 'touch'){
    if (e.clientX < innerWidth * .42 && !joy.on){ joy.on = true; joy.id = e.pointerId; joy.cx = e.clientX; joy.cy = e.clientY; joy.x = joy.y = 0; const st = $('#stick'); st.style.left = e.clientX + 'px'; st.style.top = e.clientY + 'px'; st.classList.add('on'); $('#stickHint').hidden = true; }
    else if (lookPtr.id < 0){ lookPtr.id = e.pointerId; lookPtr.x = lookPtr.sx = e.clientX; lookPtr.y = lookPtr.sy = e.clientY; lookPtr.t0 = performance.now(); }
    try { canvas.setPointerCapture(e.pointerId); } catch (x){}
    return;
  }
  audioStart();
  if (lookMode === 'lock' && !locked){ requestLock(); return; }
  if (e.button === 0){
    if (MOBHIT.m){ pokeMob(MOBHIT.m); animMine(); return; }
    if (holdingWeapon() || enemyInSights(3)){ if (spearChargeStart()) return; atkHeld = true; playerAttack(); return; }
    if (lookMode === 'lock') mineHeld = true;
    else { drag.on = true; drag.x = drag.sx = e.clientX; drag.y = drag.sy = e.clientY; drag.moved = false; drag.t0 = performance.now(); }
  } else if (e.button === 2){ useHeld = true; useAction(true); }
});
canvas.addEventListener('pointermove', e => {
  if (e.pointerType !== 'touch' || state !== 'play') return;
  if (e.pointerId === joy.id){ let dx = e.clientX - joy.cx, dy = e.clientY - joy.cy; const d = hyp2(dx, dy), R = 48; if (d > R){ dx *= R / d; dy *= R / d; } joy.x = dx / R; joy.y = dy / R; $('#knob').style.transform = 'translate(' + Math.round(dx / 2) * 2 + 'px,' + Math.round(dy / 2) * 2 + 'px)'; }
  else if (e.pointerId === lookPtr.id){ lookPtr.ax += e.clientX - lookPtr.x; lookPtr.ay += e.clientY - lookPtr.y; lookPtr.x = e.clientX; lookPtr.y = e.clientY; }
});
function endPtr(e){
  if (e.pointerType === 'touch'){
    if (e.pointerId === joy.id){ joy.on = false; joy.id = -1; joy.x = joy.y = 0; $('#stick').classList.remove('on'); $('#knob').style.transform = ''; }
    if (e.pointerId === lookPtr.id){ lookPtr.id = -1; if (performance.now() - lookPtr.t0 < 260 && hyp2(e.clientX - lookPtr.sx, e.clientY - lookPtr.sy) < 12) tapAction(); }
    return;
  }
  if (e.button === 0){ mineHeld = false; drag.on = false; atkHeld = false; spearChargeRelease(); }
  if (e.button === 2) useHeld = false;
}
canvas.addEventListener('pointerup', endPtr); canvas.addEventListener('pointercancel', endPtr);
Wn.addEventListener('pointerup', e => { if (e.pointerType !== 'touch'){ if (e.button === 0){ mineHeld = false; drag.on = false; atkHeld = false; if (state === 'play') spearChargeRelease(); } if (e.button === 2) useHeld = false; } });
canvas.addEventListener('wheel', e => { if (state !== 'play') return; e.preventDefault(); selectSlot((sel + (e.deltaY > 0 ? 1 : 8)) % 9); }, { passive: false });
const holdBtn = (q, on, off) => { const b = $(q); b.addEventListener('pointerdown', e => { e.preventDefault(); audioStart(); b.classList.add('on'); on(); try { b.setPointerCapture(e.pointerId); } catch (x){} }); const up = () => { b.classList.remove('on'); off && off(); }; b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('contextmenu', e => e.preventDefault()); };
holdBtn('#tMine', () => { if (MOBHIT.m){ pokeMob(MOBHIT.m); return; } if (holdingWeapon() || enemyInSights(3)){ if (spearChargeStart()) return; atkHeld = true; playerAttack(); return; } mineHeld = true; }, () => { mineHeld = false; atkHeld = false; spearChargeRelease(); });
holdBtn('#tJump', () => { INP.jumpEdge = true; INP.jump = true; }, () => { INP.jump = false; });
holdBtn('#tPlace', () => { useHeld = true; useAction(true); }, () => { useHeld = false; });
holdBtn('#tBag', () => { openInv(); }, null);
holdBtn('#tDash', () => { dashDir(null); }, null);
holdBtn('#tHook', () => { grappleAction(); }, null);
let atkHeld = false, nearChestC = null, nearEngine = false;
function tapAction(){ if (nearEngine){ startCine(); return; } if (nearSign){ openPanel('sign', nearSign.id); return; } if (nearChestC){ openChest(nearChestC); return; } if (MOBHIT.m){ interactMob(MOBHIT.m); } }
function sampleInput(dt){
  let ix = 0, iz = 0;
  if (keys.KeyW || keys.ArrowUp) iz += 1; if (keys.KeyS || keys.ArrowDown) iz -= 1; if (keys.KeyA || keys.ArrowLeft) ix -= 1; if (keys.KeyD || keys.ArrowRight) ix += 1;
  if (joy.on){ const m = hyp2(joy.x, joy.y); if (m > .15){ const k = Math.min(1, (m - .15) / .85) / m; ix += joy.x * k; iz -= joy.y * k; } }
  const l = hyp2(ix, iz); if (l > 1){ ix /= l; iz /= l; }
  INP.x = ix; INP.z = iz;
  if (INP.sprintBreak){ INP.sprintBreak = false; sprintLatch = false; }
  INP.sprint = !!(keys.ShiftLeft || keys.ShiftRight) || sprintLatch || (joy.on && hyp2(joy.x, joy.y) > .9);
  INP.sneak = !!(keys.KeyC || keys.ControlLeft);
  // smoothed touch look
  if (lookPtr.ax || lookPtr.ay){ const k = 1 - Math.exp(-34 * dt); const dx = lookPtr.ax * k, dy = lookPtr.ay * k; lookPtr.ax -= dx; lookPtr.ay -= dy; look(dx, dy, .0095); if (Math.abs(lookPtr.ax) < .05) lookPtr.ax = 0; if (Math.abs(lookPtr.ay) < .05) lookPtr.ay = 0; }
}
const _fw = { x: 0, y: 0, z: 0 };
function fwd(){ const cp = Math.cos(PL.pitch); _fw.x = -Math.sin(PL.yaw) * cp; _fw.y = Math.sin(PL.pitch); _fw.z = -Math.cos(PL.yaw) * cp; return _fw; }
const EYE = { x: 0, y: 0, z: 0 };
function useAction(first){
  if (state !== 'play' || PL.catching) return;
  if (MOBHIT.m){ if (first) interactMob(MOBHIT.m); return; }
  if (nearEngine && first){ startCine(); return; }
  if (nearChestC && first){ openChest(nearChestC); return; }
  if ((heldId() === BUN || heldId() === BISCUIT) && first){ if (eatFood(heldId())) return; }
  if (HIT.ok && HIT.id === SIGN){ const s = nearestSign(HIT.x + .5, PL.y, HIT.z + .5, 7); if (s && first){ openPanel('sign', s.id); return; } }
  const id = heldId();
  if (id === SEED){ if (first) startVine(); return; }
  if (isBook(id)){ if (first) openReader('tome', inv[sel].bk); return; }
  if (first && !isBlockItem(id) && GEAR.grapple){ grappleAction(); return; }
  if (useCD > 0 && first) return;
  placeBlock(); useCD = .2;
}
const PLACE = { ok: false, x: 0, y: 0, z: 0, valid: false };
function computePlace(){
  PLACE.ok = false; const s = inv[sel]; if (!HIT.ok || !s || !isBlockItem(s.id)) return;
  let x = HIT.x + HIT.nx, y = HIT.y + HIT.ny, z = HIT.z + HIT.nz;
  if (B_RT[HIT.id] === 3){ x = HIT.x; y = HIT.y; z = HIT.z; }
  if (x < 0 || y < 0 || z < 0 || x >= WX || y >= WY || z >= WZ) return;
  const cur = getB(x, y, z); if (cur && cur !== WATER && B_RT[cur] !== 3) return;
  PLACE.ok = true; PLACE.x = x; PLACE.y = y; PLACE.z = z; PLACE.valid = true;
  if (B_RT[s.id] === 3){ const b = getB(x, y - 1, z); if (!(b === GRASS || b === DIRT || b === MOSS || b === SAND)) PLACE.valid = false; }
  if (B_SOLID[s.id]){
    const ov = e => x < e.x + e.hw && x + 1 > e.x - e.hw && y < e.y + e.h && y + 1 > e.y && z < e.z + e.hw && z + 1 > e.z - e.hw;
    if (ov(PL)) PLACE.valid = false; else for (let i = 0; i < MOBS.length; i++) if (ov(MOBS[i])){ PLACE.valid = false; break; }
  }
}
function placeBlock(){
  computePlace(); const s = inv[sel];
  if (!PLACE.ok) return; if (!PLACE.valid){ SND.deny(); return; }
  setBlock(PLACE.x, PLACE.y, PLACE.z, s.id); s.n--; if (!s.n) inv[sel] = null; invChanged(); SND.place(); animPlace(); popBlock(PLACE.x, PLACE.y, PLACE.z, s.id, true); camKick = .03;
  burst(PLACE.x, PLACE.y, PLACE.z, s.id, 4);
}
const MINE = { x: -1, y: -1, z: -1, t: 0, need: 1, tick: 0, denied: -9 };
let hitPending = 0;
function breakTime(id){ const h = B_HARD[id]; if (h <= 0) return .06; let m = 1; if (hasItem(PICK)) m = B_TOOL[id] === 'pick' ? 4 : 2.5; return h * 1.4 / m; }
function breakBlock(x, y, z){
  const id = getB(x, y, z); if (!id || B_PROT[id]) return;
  setBlock(x, y, z, 0); queueRegrow(x, y, z); burst(x, y, z, id, 16); SND.brk(B_SND[id]); camKick = .05; popBlock(x, y, z, id, false); animMine();
  if (B_DROP[id]) spawnDrop(B_DROP[id], x + .5, y + .5, z + .5);
  if ((id === LEAVES || id === BLOSSOM) && Math.random() < .25) spawnDrop(LEAVES, x + .5, y + .5, z + .5);
  if ((id === LEAVES || id === BLOSSOM) && Math.random() < .25) spawnDrop(STICK, x + .5, y + .5, z + .5);
  const up = getB(x, y + 1, z); if (B_RT[up] === 3){ setBlock(x, y + 1, z, 0); queueRegrow(x, y + 1, z); if (B_DROP[up]) spawnDrop(B_DROP[up], x + .5, y + 1.3, z + .5); }
}
function updateMining(dt, t){
  if (!(mineHeld && HIT.ok && state === 'play' && !PL.catching && !holdingWeapon())){ MINE.t = 0; MINE.x = -1; crack.visible = false; return; }
  if (HIT.id === CRYSTAL){ crack.visible = false; if (t - MINE.denied > .32){ MINE.denied = t; const k = ((HIT.x * 7 + HIT.y * 3 + HIT.z * 5) % 10 + 10) % 10; SND.chime(k); animMine(); sparkle(HIT.x + .5, HIT.y + .6, HIT.z + .5, 6, .7, .95, 1); popBlock(HIT.x, HIT.y, HIT.z, CRYSTAL, true); } return; }
  if (B_PROT[HIT.id]){ crack.visible = false; if (t - MINE.denied > 3){ MINE.denied = t; SND.deny(); toast('Signs, bridges and landmarks stay put'); } return; }
  if (HIT.x !== MINE.x || HIT.y !== MINE.y || HIT.z !== MINE.z){ MINE.x = HIT.x; MINE.y = HIT.y; MINE.z = HIT.z; MINE.t = 0; MINE.need = breakTime(HIT.id); MINE.tick = 0; MINE.cs = 0; }
  MINE.t += dt; MINE.tick -= dt;
  if (MINE.tick <= 0){ MINE.tick = .26; animMine(); hitPending = .12; }
  if (hitPending > 0){ hitPending -= dt; if (hitPending <= 0){ SND.hit(B_SND[HIT.id]); burst(HIT.x, HIT.y, HIT.z, HIT.id, 3); camKick = Math.max(camKick, .015); } }
  const p = MINE.t / MINE.need, cst = Math.min(7, Math.floor(p * 8)); if (cst !== MINE.cs){ if (cst > (MINE.cs || 0)) SND.crack(cst); MINE.cs = cst; }
  crack.visible = MINE.need > .1; crack.position.set(HIT.x + .5, HIT.y + .5, HIT.z + .5); crackTex.offset.x = Math.min(7, Math.floor(p * 8)) / 8;
  if (p >= 1){ breakBlock(HIT.x, HIT.y, HIT.z); MINE.t = 0; MINE.x = -1; MINE.tick = .1; hitPending = 0; }
}

/* ================= prompts (context chips) ================= */
const chipsEl = $('#chips'); let chipKey = '';
function updatePrompts(){
  let key = '', html = '';
  const k1 = TOUCH ? 'Tap' : 'E', kU = TOUCH ? 'Use' : 'RMB';
  if (state === 'play' && !PL.catching){
    if (nearEngine){ key = 'eng'; html = '<button class="chip f-panel" type="button" id="chipEngine">' + KC(k1) + (storySeen ? 'Replay the story' : 'Activate the Memory Engine') + '</button>'; }
    else if (nearChestC && !nearSign){ key = 'ch' + nearChestC.k + ':' + nearChestC.i; html = '<button class="chip f-panel" type="button" id="chipChest">' + KC(k1) + 'Open ' + ['', 'chest', 'brass chest', 'crystal chest'][nearChestC.tier] + '</button>'; }
    else if (nearSign){ key = 's' + nearSign.id; html = '<button class="chip f-panel" type="button" id="chipRead">' + KC(k1) + 'Read · ' + SIGN_LABEL[nearSign.id] + '</button>'; }
    else if (MOBHIT.m && MOBHIT.t < 5){
      const m = MOBHIT.m, S = SPEC[m.type], held = heldId();
      if (S.fly){ key = 'j'; html = '<div class="chip f-panel">' + KC(TOUCH ? 'Tap' : kU) + 'Boop the sky jelly</div>'; }
      else if (m === companion){ key = 'c' + m.type; html = '<div class="chip f-panel">' + KC(TOUCH ? 'Tap' : kU) + 'Pet ' + S.name + '</div><div class="chip sub">Your companion. ' + S.ability + '.</div>'; }
      else if (held === S.treat){ key = 'f' + m.type; html = '<div class="chip f-panel">' + KC(TOUCH ? 'Tap' : kU) + 'Feed ' + S.treatName + '</div>'; }
      else { key = 'w' + m.type; html = '<div class="chip f-panel">' + KC(TOUCH ? 'Tap' : kU) + 'Pet ' + S.name + '</div><div class="chip sub">Hold a ' + S.treatName.toLowerCase() + ' to befriend it.</div>'; }
    }
  }
  if (key !== chipKey){ chipKey = key; chipsEl.innerHTML = html; const b = $('#chipRead'); if (b) b.addEventListener('click', () => { if (nearSign) openPanel('sign', nearSign.id); }); const be = $('#chipEngine'); if (be) be.addEventListener('click', () => { if (nearEngine) startCine(); }); const bc = $('#chipChest'); if (bc) bc.addEventListener('click', () => { if (nearChestC) openChest(nearChestC); }); }
}

/* ================= camera ================= */
/* first-person rig: springs for every channel, layered poses, keyframed action clips */
const HR = { x: Spr(), y: Spr(), z: Spr(), rx: Spr(), rz: Spr(), lagX: Spr(), lagY: Spr(), roll: Spr(), lead: Spr(), mantleT: 9, eye: Spr(), fov: Spr(72), canopy: Spr(), lastYaw: 0, lastPitch: 0,
  mineT: 9, placeT: 9, eqT: 9, eqSwapped: true, feedT: 9, dashT: 9, held: -1, swT: 9, swF: 4, idleT: 0, inspT: 9, sailO: 0 };
const CLIP_MINE_RX = Clip([[0, 0], [.07, .4, EZ.outQuad], [.12, -1.05, EZ.inCubic], [.22, -.15, EZ.outQuad], [.34, 0, EZ.inOutSine]]);
const CLIP_MINE_Z = Clip([[0, 0], [.07, .05, EZ.outQuad], [.12, -.1, EZ.inCubic], [.3, 0, EZ.outBack]]);
const CLIP_PLACE_Z = Clip([[0, 0], [.05, -.14, EZ.outQuad], [.18, 0, EZ.outBack]]);
const CLIP_EQUIP_Y = Clip([[0, 0], [.12, -.5, EZ.inQuad], [.32, 0, EZ.outBack]]);
const CLIP_MANTLE = Clip([[0, 0], [.07, -.16, EZ.outQuad], [.2, .05, EZ.outCubic], [.36, 0, EZ.inOutSine]]);
const CLIP_FEED = Clip([[0, 0], [.18, 1, EZ.outCubic], [.62, 1], [.85, 0, EZ.inOutSine]]);
function animMine(){ HR.mineT = 0; }
const _swp = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
function animPlace(){ HR.placeT = 0; }
function animFeed(){ HR.feedT = 0; }
let fovCur = 72, camKick = 0, catchBlend = 0, renderAlpha = 0;
const CAMHIT = { ok: false };
function updateCamera(dt){
  const P = PL, a = renderAlpha, RM = REDUCED ? 0 : 1;
  const ix = P.px + (P.x - P.px) * a, iy = P.py + (P.y - P.py) * a, iz = P.pz + (P.z - P.pz) * a;
  P.stepOff *= Math.exp(-13 * dt); P.landKick *= Math.exp(-8 * dt); P.punch *= Math.exp(-3.5 * dt); camKick *= Math.exp(-20 * dt);
  const hs = hyp2(P.vx, P.vz), sliding = P.slideT > 0;
  // head bob: tiny, speed-scaled, optional
  const bobOn = headBob && P.onGround && hs > .6 && !sliding ? Math.min(1, hs / 6) : 0;
  const ph = P.stepPh * 6.2832, bobY = -Math.cos(ph) * .03 * bobOn, bobX = Math.sin(ph * .5) * .02 * bobOn; // trough on each footfall
  spring(HR.eye, sliding ? -.62 : 0, 14, dt);
  EYE.x = ix; EYE.y = iy + 1.62 + HR.eye.x - P.stepOff - P.landKick + bobY; EYE.z = iz;
  catchBlend += ((P.catching ? 1 : 0) - catchBlend) * Math.min(1, dt * (P.catching ? 5 : 3));
  const f = fwd();
  const dist = Math.max(third ? 4.2 : 0, catchBlend * 6);
  if (dist > .05){
    let bx = -f.x, by = -f.y + catchBlend * .35, bz = -f.z; const bl = hyp3(bx, by, bz); bx /= bl; by /= bl; bz /= bl;
    let d = dist; if (raycast(EYE.x, EYE.y, EYE.z, bx, by, bz, dist, CAMHIT, true)) d = Math.max(.6, CAMHIT.t - .25);
    camera.position.set(EYE.x + bx * d, EYE.y + by * d + .15, EYE.z + bz * d);
  } else camera.position.set(EYE.x + Math.cos(P.yaw) * bobX, EYE.y, EYE.z - Math.sin(P.yaw) * bobX);
  // roll: lean into strafes, bank on glider turns, tilt during slides
  const yawRate = angDiff(P.yaw, HR.lastYaw) / Math.max(dt, 1e-3), pitchRate = (P.pitch - HR.lastPitch) / Math.max(dt, 1e-3); HR.lastYaw = P.yaw; HR.lastPitch = P.pitch;
  const rollT = RM * (P.gliding ? clamp(-yawRate * .09, -.32, .32) : (-INP.x * .03 * Math.min(1, hs / 5) + (sliding ? .07 : 0) - (P.dashCD > DASH_CD - .2 ? INP.dashX * .06 : 0)));
  spring(HR.roll, rollT, 8, dt);
  const vaultDip = Math.sin(Math.PI * P.vault) * .14 * RM;
  // the camera leads a touch into turns while moving; mantles dip then lift
  spring(HR.lead, RM * clamp(yawRate * .012, -.045, .045) * Math.min(1, hs / 4), 6, dt);
  HR.mantleT += dt; if (P.vault > .95 && HR.mantleT > .3) HR.mantleT = 0;
  const mant = HR.mantleT < CLIP_MANTLE.d ? clipAt(CLIP_MANTLE, HR.mantleT) * RM : 0;
  camera.position.y += mant;
  camera.rotation.set(P.pitch - catchBlend * .25 - vaultDip * .5 + mant * .6 + Math.sin(tAcc * 60) * camKick * .02 + (P.stall > .2 ? Math.sin(tAcc * 31) * .004 * P.stall : 0), P.yaw + HR.lead.x, HR.roll.x);
  // FOV responds to speed: sprint, slide, dash, glider speed, punches
  const gs = P.gliding ? P.gs : 0;
  const ft = 72 + RM * (clamp((hs - 6) * 1.3, 0, 9) + clamp((gs - 9) * 1.1, 0, 15)) + P.punch * 9 * RM;
  spring(HR.fov, ft, 7, dt);
  if (Math.abs(camera.fov - HR.fov.x) > .02){ camera.fov = HR.fov.x; camera.updateProjectionMatrix(); }
  // speed lines + wind
  speedLines(dt, P.gliding ? clamp((gs - 12) / 10, 0, 1) : clamp((hs - 9) / 6, 0, 1));
  if (AU.glideG){ const sp = P.gliding ? gs : (P.onGround ? 0 : hs); const g = clamp((sp - 5) / 18, 0, 1) * .13; if (Math.abs(g - (AU._g || 0)) > .004){ AU._g = g; AU.glideG.gain.setTargetAtTime(g, AU.ctx.currentTime, .1); AU.glideF.frequency.setTargetAtTime(400 + sp * 60, AU.ctx.currentTime, .1); } }
  // avatar (third person / catch)
  if (avatar){
    const show = third || catchBlend > .1; avatar.visible = show;
    if (show){ avatar.position.set(ix, iy + HR.eye.x * .5, iz); avatar.rotation.set(sliding ? -.5 : 0, P.yaw, 0); const u = avatar.userData, sw = Math.sin(P.walk * 2.4) * .8 * Math.min(1, hs / 5), up = P.catching ? -2.6 : (P.gliding ? -2.9 : 0);
      u.legL.rotation.x = P.onGround ? sw : -.6; u.legR.rotation.x = P.onGround ? -sw : .3; u.armL.rotation.x = up || -sw * .8; u.armR.rotation.x = up || (sw * .8 - (HR.mineT < .34 ? -clipAt(CLIP_MINE_RX, HR.mineT) * 1.4 : 0)); u.head.rotation.x = P.pitch * .5; }
  }
  // glider: opens with an overshooting spring, flexes with speed and banks with turns
  if (sailRig){
    // unfurl: the span spreads, then cells inflate from the centre outward; folding runs it backwards, faster
    const want = P.gliding ? 1 : 0; HR.sailO = clamp((HR.sailO || 0) + (want ? dt * 2.1 : -dt * 3.4), 0, 1);
    const o = HR.sailO; sailRig.grp.visible = o > .01;
    if (o > .01){ const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw), flex = clamp((gs - 9) / 14, -.3, 1), ease = want ? EZ.outCubic(o) : EZ.inOutSine(o);
      poseSail(sailRig, ease, flex, tAcc, !third);
      const fwdD = third ? .1 : .75, up = third ? 3.62 : 1.06 + 1.62;
      sailRig.grp.position.set(ix - sy * fwdD, iy + up - (1 - ease) * .5, iz - cy * fwdD);
      sailRig.grp.rotation.set(third ? -P.pitch * .15 : -P.pitch * .35 - .08, P.yaw, HR.roll.x * 1.4 + Math.sin(tAcc * 2.3) * .025);
      const sc = .3 + .7 * Math.min(1, ease * 1.6); sailRig.grp.scale.setScalar(sc); if (sailRig.bar) sailRig.bar.visible = third; }
  }
  if (hand) updateHandRig(dt, hs, sliding, bobX, bobY);
}
/* speed lines: drawn at quarter resolution only when fast */
let slOn = 0;
function speedLines(dt, k){
  slOn += (k - slOn) * (1 - Math.exp(-6 * dt));
  if (slOn < .02 || REDUCED){ if (streakCv.style.opacity !== '0' && !travel){ streakCv.style.opacity = '0'; } return; }
  if (travel) return;
  if (streakCv.width !== Math.ceil(innerWidth / 4)){ streakCv.width = Math.ceil(innerWidth / 4); streakCv.height = Math.ceil(innerHeight / 4); }
  const w = streakCv.width, h = streakCv.height, g = streakG; g.clearRect(0, 0, w, h); g.fillStyle = 'rgba(236,228,210,.55)';
  const cx = w / 2, cy = h / 2;
  for (let i = 0; i < 36; i++){ const a = i * 2.39996 + tAcc * .7, r0 = (Math.min(w, h) * .32) + ((i * 37 + tAcc * 260) % (w * .5)), len = 4 + (i % 4) * 3; const ca = Math.cos(a), sa = Math.sin(a); for (let q = 0; q < len; q++) g.fillRect(Math.round(cx + ca * (r0 + q)), Math.round(cy + sa * (r0 + q) * .7), 1, 1); }
  streakCv.style.opacity = (slOn * .7).toFixed(2);
}
/* ================= minimap (pixel, north up) ================= */
const mapCv = $('#map'), mapG = mapCv.getContext('2d');
let mapStatic = null, mapCtx = null, mapImg = null, mapImgDirty = false;
function mapColumn(x, z){
  let y = WY - 1, id = 0; for (; y >= 0; y--){ id = world[x + WX * (z + WZ * y)]; if (id && B_RT[id] !== 3) break; }
  const o = (z * WX + x) * 4, d = mapImg.data;
  if (y < 0){ d[o] = 36; d[o + 1] = 33; d[o + 2] = 42; d[o + 3] = 0; mapImgDirty = true; return; }
  const col = id === WATER ? WATER_MAP : (B_COL[id] || GREY_MAP), k = .62 + (y - 22) / 44;
  d[o] = clamp(col[0] * 255 * k, 0, 255); d[o + 1] = clamp(col[1] * 255 * k, 0, 255); d[o + 2] = clamp(col[2] * 255 * k, 0, 255); d[o + 3] = 255; mapImgDirty = true;
}
const WATER_MAP = [.36, .52, .58], GREY_MAP = [.5, .5, .5];
function buildMapStatic(){
  if (!mapStatic){ mapStatic = D.createElement('canvas'); mapStatic.width = WX; mapStatic.height = WZ; mapCtx = mapStatic.getContext('2d'); mapImg = mapCtx.createImageData(WX, WZ); }
  for (let z = 0; z < WZ; z++) for (let x = 0; x < WX; x++) if (isl[x + z * WX] >= 0 || (x < SAFE + 4 && z < SAFE + 4)) mapColumn(x, z); else { const o = (z * WX + x) * 4, d = mapImg.data; d[o] = 36; d[o + 1] = 33; d[o + 2] = 42; d[o + 3] = 0; }
  mapCtx.putImageData(mapImg, 0, 0); mapImgDirty = false;
}
function drawMap(){
  const g = mapG; g.imageSmoothingEnabled = false;
  if (mapImgDirty){ mapCtx.putImageData(mapImg, 0, 0); mapImgDirty = false; }
  const ox = clamp(Math.floor(PL.x) - 96, 0, WX - 192), oz = clamp(Math.floor(PL.z) - 96, 0, WZ - 192);
  g.fillStyle = '#24212a'; g.fillRect(0, 0, 192, 192);
  for (const I of OUT) if (I.gen !== 2){ const c = BIOMES[I.b].top; g.fillStyle = 'rgb(' + (c[0] * 170 | 0) + ',' + (c[1] * 170 | 0) + ',' + (c[2] * 170 | 0) + ')'; g.beginPath(); g.arc(I.x - ox, I.z - oz, I.r * .9, 0, 6.283); g.fill(); }
  g.drawImage(mapStatic, ox, oz, 192, 192, 0, 0, 192, 192);
  if (ox + 192 > SAFE || oz + 192 > SAFE){ g.fillStyle = '#5c4f8a'; for (let k = 0; k < 192; k += 4){ if (SAFE - ox >= 0 && SAFE - ox < 192 && k + oz < SAFE) g.fillRect(SAFE - ox, k, 1, 2); if (SAFE - oz >= 0 && SAFE - oz < 192 && k + ox < SAFE) g.fillRect(k, SAFE - oz, 2, 1); } }
  g.save(); g.translate(-ox, -oz);
  for (const s of SIGNS){ g.fillStyle = '#0e0d11'; g.fillRect(Math.floor(s.x) - 2, Math.floor(s.z) - 2, 5, 5); g.fillStyle = ways.has(s.id) ? '#e0a83f' : '#8c8378'; g.fillRect(Math.floor(s.x) - 1, Math.floor(s.z) - 1, 3, 3); }
  for (const I of OUT){ const cx = Math.floor(I.x), cz = Math.floor(I.z); if (islandCleared(I)){ g.fillStyle = '#0e0d11'; g.fillRect(cx - 3, cz - 1, 7, 3); g.fillRect(cx - 1, cz - 3, 3, 7); g.fillStyle = '#e0a83f'; g.fillRect(cx - 2, cz, 5, 1); g.fillRect(cx, cz - 2, 1, 5); g.fillRect(cx - 1, cz - 1, 3, 3); } else if (REVEALED.has(I.k) && !I.seen){ g.fillStyle = '#9ad1e6'; g.fillRect(cx - 1, cz - 1, 3, 3); g.fillStyle = '#0e0d11'; g.fillRect(cx, cz, 1, 1); } }
  if (companion){ g.fillStyle = '#7d9a62'; g.fillRect(Math.floor(companion.x) - 1, Math.floor(companion.z) - 1, 3, 3); }
  // player: pixel arrow rotated to 8 directions
  const a = Math.round(Math.atan2(-Math.sin(PL.yaw), -Math.cos(PL.yaw)) / (Math.PI / 4)) & 7, px = Math.floor(PL.x), pz = Math.floor(PL.z);
  const AR = [[0, -3], [1, -2], [-1, -2], [0, -2], [0, -1], [-1, -1], [1, -1], [0, 0], [-2, 0], [2, 0], [-1, 0], [1, 0]];
  const ang = a * Math.PI / 4 + Math.PI / 2, cs = Math.cos(ang), sn = Math.sin(ang);
  g.fillStyle = '#0e0d11'; for (const p of AR){ const x = Math.round(p[0] * cs - p[1] * sn), y = Math.round(p[0] * sn + p[1] * cs); g.fillRect(px + x - 1, pz + y - 1, 3, 3); }
  g.fillStyle = '#ece4d2'; for (const p of AR){ const x = Math.round(p[0] * cs - p[1] * sn), y = Math.round(p[0] * sn + p[1] * cs); g.fillRect(px + x, pz + y, 1, 1); }
  g.restore();
  g.fillStyle = '#e0a83f'; g.font = "700 8px 'Silkscreen', monospace"; g.textAlign = 'center'; g.textBaseline = 'top'; g.fillText('N', 96, 2);
}
function islandAt(x, z){ let best = -1, bd = 1e9; for (let k = 0; k < DISC.length; k++){ const I = ISL[DISC[k]], d = hyp2(x - I.x, z - I.z) - I.r; if (d < bd){ bd = d; best = DISC[k]; } } return bd < (best === 0 ? 4 : 2) ? best : -1; }

/* ================= day / night ================= */
const DAYLEN = 360;
let dayT = .3;
const PAL_D = { z: [.34, .5, .68], h: [.86, .82, .74], s: [.95, .87, .74], as: [.46, .52, .6], ag: [.38, .33, .3], ab: [.62, .66, .72] };
const PAL_G = { z: [.32, .38, .58], h: [.98, .7, .5], s: [1.05, .7, .44], as: [.5, .46, .54], ag: [.42, .31, .29], ab: [.7, .56, .56] };
const PAL_N = { z: [.05, .07, .16], h: [.16, .19, .31], s: [.3, .36, .55], as: [.22, .26, .4], ag: [.1, .1, .16], ab: [.1, .12, .2] };
const _c3 = [0, 0, 0];
function mix3(key, g, n){ const a = PAL_D[key], b = PAL_G[key], c = PAL_N[key]; for (let i = 0; i < 3; i++){ const v = a[i] + (b[i] - a[i]) * g; _c3[i] = v + (c[i] - v) * n; } return _c3; }
function updateSky(){
  // sunEl is continuous through the whole cycle (negative at night), so nothing jumps at sunset or sunrise.
  const p = dayT; let el, az, sunEl;
  if (p < .68){ const u = p / .68; sunEl = Math.sin(Math.PI * u); el = sunEl; az = Math.PI * u; }
  else { const u = (p - .68) / .32; sunEl = -Math.sin(Math.PI * u); el = Math.max(-sunEl, .05); az = Math.PI * (1 - u); }
  const nightAmt = 1 - sstep(-.16, .14, sunEl);
  const golden = 1 - sstep(.08, .5, Math.max(sunEl, 0));
  U.uSunDir.value.set(Math.cos(az) * .82, Math.max(el, .04), .52).normalize();
  U.uNight.value = nightAmt;
  const sunK = Math.max(sstep(-.05, .25, sunEl), sstep(.05, .35, -sunEl)), gg = golden * (1 - nightAmt * .5);
  const set = (col, key, mul) => { const c = mix3(key, gg, nightAmt); col.setRGB(c[0] * mul, c[1] * mul, c[2] * mul); };
  set(U.uZenith.value, 'z', 1); set(U.uHorizon.value, 'h', 1); set(U.uSunCol.value, 's', .25 + .75 * sunK); set(U.uAmbSky.value, 'as', 1); set(U.uAmbGround.value, 'ag', 1); set(U.uAbyss.value, 'ab', 1);
  renderer.setClearColor(U.uHorizon.value);
}

/* ================= save / load / reset (localStorage may be blocked: always wrapped) ================= */
const SKEY = 'kaiav-world-v5';
function saveGame(){
  if (!baseReady) return;
  try {
    const e = []; edits.forEach((v, k) => { e.push(k, v); });
    const s = PL.safe || PL;
    localStorage.setItem(SKEY, JSON.stringify({ v: 5, e, inv: inv.map(s => s ? (s.w ? [s.id, s.n, s.w] : s.bk ? [s.id, s.n, 0, s.bk] : [s.id, s.n]) : 0), w: { seed: OUT_SEED, ch: [...chestLooted], st: { c: wildStats.chests, k: wildStats.kills, d: wildStats.deaths, b: wildStats.best }, seen: OUT.filter(I => I.seen).map(I => I.k), hp: php, lw: lastWay }, p: [+s.x.toFixed(2), +s.y.toFixed(2), +s.z.toFixed(2), +PL.yaw.toFixed(3), +PL.pitch.toFixed(3)], t: +dayT.toFixed(4), sel,
      o: { sens, mute: AU.muted, vol: AU.vol, tp: third, bob: headBob, tips: tipsOn, aj: autoJump }, g: { found: [...found], visited: [...visited], ways: [...ways], friends: [...friends], comp: companion ? MOBS.indexOf(companion) : -1, tut: tutStep, sail: SAIL_STAND ? SAIL_STAND.taken : false, gold: goldSail, story: storySeen, gear: [GEAR.sail ? 1 : 0, GEAR.grapple ? 1 : 0], vis: [...vistas], md: [...MODDONE], bf: [...BOOKS_FOUND], br: [...BOOKS_READ], rv: [...REVEALED], rc: RC.done ? +RC.best.toFixed(2) : 0 } }));
    saveDirty = false;
  } catch (err){}
}
function loadGame(){ try { const s = localStorage.getItem(SKEY); return s ? JSON.parse(s) : null; } catch (e){ return null; } }
function applySave(sv){
  try {
    if (!sv || sv.v !== 5) return false;
    const e = sv.e || []; for (let i = 0; i + 1 < e.length; i += 2){ const k = e[i] | 0, v = e[i + 1] | 0; if (k >= 0 && k < world.length && v >= 0 && v < NB && (v === 0 || B_NAME[v]) && !B_PROT[world[k]]){ if (world[k] !== v){ if (!orig.has(k)) orig.set(k, world[k]); world[k] = v; edits.set(k, v); } } }
    inv.fill(null); (sv.inv || []).forEach((s, i) => { if (s && i < 36 && (B_NAME[s[0]] || I_NAME[s[0]])){ inv[i] = { id: s[0], n: clamp(s[1] | 0, 1, maxStack(s[0])) }; if (isBook(s[0])){ if (s[3] && WRITINGS().some(w => w.slug === s[3])) inv[i].bk = String(s[3]); else inv[i] = null; } else if (s[0] === WEAPON){ const w = s[2]; if (w && FAM[w.f] && RARITY[w.r] && isFinite(w.dmg)) inv[i].w = { f: w.f | 0, r: w.r | 0, dmg: +w.dmg, spd: +w.spd, reach: +w.reach, crit: +w.crit, ax: (w.ax || []).filter(a => AFFIX[a]), nm: String(w.nm).slice(0, 60) }; else inv[i] = null; } } });
    if (sv.w){ const W = sv.w; savedSeed = W.seed >>> 0; (W.ch || []).forEach(p => { if (Array.isArray(p) && typeof p[0] === 'string') chestLooted.set(p[0], +p[1] || 0); }); if (W.st){ wildStats.chests = W.st.c | 0; wildStats.kills = W.st.k | 0; wildStats.deaths = W.st.d | 0; const b = W.st.b; if (b && FAM[b.f] && RARITY[b.r]) wildStats.best = b; } savedSeen = W.seen || []; if (isFinite(W.hp)) php = clamp(W.hp | 0, 1, PMAXHP); if (SIGN_LABEL[W.lw]) lastWay = W.lw; }
    if (sv.p && isFinite(sv.p[0]) && sv.p[1] > CATCH_Y){ PL.x = sv.p[0]; PL.y = sv.p[1]; PL.z = sv.p[2]; PL.yaw = sv.p[3] || 0; PL.pitch = sv.p[4] || 0; PL.safe = { x: PL.x, y: PL.y, z: PL.z, yaw: PL.yaw }; }
    if (isFinite(sv.t)) dayT = ((sv.t % 1) + 1) % 1;
    sel = clamp(sv.sel | 0, 0, 8);
    if (sv.o){ sens = clamp(+sv.o.sens || 1, .4, 3); $('#sens').value = sens; AU.muted = !!sv.o.mute; if (sv.o.vol) for (const k in AU.vol) if (typeof sv.o.vol[k] === 'number') AU.vol[k] = clamp(sv.o.vol[k], 0, 1); third = !!sv.o.tp; headBob = sv.o.bob !== false && !REDUCED; tipsOn = sv.o.tips !== false; if (typeof sv.o.aj === 'boolean') autoJump = sv.o.aj; }
    const g = sv.g || {};
    (g.found || []).forEach(i => found.add(i)); (g.md || []).forEach(k => MODDONE.add(k)); (g.bf || []).forEach(k => BOOKS_FOUND.add(String(k))); (g.br || []).forEach(k => BOOKS_READ.add(String(k))); (g.rv || []).forEach(k => REVEALED.add(k)); (g.visited || []).forEach(i => visited.add(i)); (g.ways || []).forEach(i => ways.add(i)); (g.friends || []).forEach(i => friends.add(i));
    tutStep = clamp(g.tut | 0, 0, TUT.length); if (SAIL_STAND && g.sail) SAIL_STAND.taken = true; goldSail = !!g.gold; storySeen = !!g.story; if (Array.isArray(g.gear)){ GEAR.sail = !!g.gear[0]; GEAR.grapple = !!g.gear[1]; } (g.vis || []).forEach(v => vistas.add(v | 0));
    pendingComp = g.comp; if (g.rc > 0){ RC.done = true; RC.best = g.rc; } updateSailLevel(false);
    edits.forEach((v, k) => { if (v === 0 && REGROWS[baseAt(k)]){ const x = k % WX, zz = (k / WX) | 0; REGROW.push({ x, y: (zz / WZ) | 0, z: zz % WZ, id: baseAt(k), t: 20 + Math.random() * 60 }); } });
    return true;
  } catch (err){ return false; }
}
let pendingComp = -1, savedSeed = 0, savedSeen = [];
function resetWorld(){
  try { localStorage.removeItem(SKEY); } catch (e){}
  generate(); orig.clear(); edits.clear(); floodAll(); countChunks();
  chunks.forEach((c, k) => { if (c.count || c.mesh || c.wmesh) markDirty(k); });
  resetInventory(); found.clear(); visited.clear(); ways.clear(); friends.clear(); tutStep = 0; goldSail = false; storySeen = false; GEAR.sail = GEAR.grapple = false; vistas.clear(); if (ENGINE) ENGINE.wake = .12; php = PMAXHP; wildStats.chests = wildStats.kills = wildStats.deaths = 0; wildStats.best = null; lastWay = 'hub'; RC.done = false; RC.best = 0; RC.next = 0; REGROW.length = 0; sailLevel = 0;
  PL.x = PL.px = SPAWN.x; PL.y = PL.py = SPAWN.y; PL.z = PL.pz = SPAWN.z; PL.yaw = 0; PL.pitch = 0; PL.vx = PL.vy = PL.vz = 0; PL.safe = null;
  spawnMobs(); DROPS.forEach(d => d.on = false); buildMapStatic(); invChanged(); renderJournalSoon(); saveGame(); tutShow();
}

/* ================= main loop: fixed 120 Hz physics, 30 Hz AI, interpolated rendering ================= */
let last = performance.now(), raf = 0, tAcc = 0, physAcc = 0, mapT = 0, titleA = .6, hudWhere = '', visT = 0, lastSave = 0;
let frames = 0, ftSum = 0, evalT = 0, frameN = 0;
function applyQuality(){ renderer.setPixelRatio(BASE_DPR * qScale); renderer.setSize(innerWidth, innerHeight, false); UScale.value = innerHeight * BASE_DPR * qScale * .69; setFog(); }
let qPending = false, qCool = 0, qBad = 0, qGood = 0, fogNear = 60, fogFar = 160;
function setFog(){ fogNear = state === 'title' ? 110 : renderDist * .5; fogFar = state === 'title' ? 300 : renderDist * 1.3; }
function onResize(){ if (!glOK) return; placeHotsel(); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); applyQuality(); if (sky) renderer.render(scene, camera); }
Wn.addEventListener('resize', onResize);
Wn.addEventListener('orientationchange', () => setTimeout(onResize, 120));
function frame(now){
  raf = requestAnimationFrame(frame);
  const raw = (now - last) / 1000;
  const cap = state === 'play' || state === 'cine' ? 0 : (state === 'pause' ? 1 / 12 : 1 / 30);
  if (cap && raw < cap - .003) return;
  last = now;
  const dt = Math.min(raw, .1);
  tAcc += dt; U.uTime.value = tAcc;
  if (qPending){ qPending = false; applyQuality(); }
  { const f = U.uFog.value, k = 1 - Math.exp(-2 * dt); f.x += (fogNear - f.x) * k; f.y += (fogFar - f.y) * k; }
  if (state !== 'pause' && !CINE.on) dayT = (dayT + dt / DAYLEN) % 1;
  updateSky();
  if (state === 'title'){
    titleA += dt * (REDUCED ? .015 : .045);
    camera.position.set(HOMEC.x + Math.cos(titleA) * 112, 92 + Math.sin(titleA * .7) * 5, HOMEC.z + Math.sin(titleA) * 112);
    const off = innerWidth >= 760 ? 34 : 0; camera.lookAt(HOMEC.x - Math.sin(titleA) * off, 58, HOMEC.z - 2 + Math.cos(titleA) * off);
    if (camera.fov !== 60){ camera.fov = 60; camera.updateProjectionMatrix(); }
    const lb = $('#loadbar'); if (totalToMesh && !lb._done){ const p = Math.min(1, meshedOnce / totalToMesh); lb.firstChild.style.width = Math.round(p * 30) / 30 * 100 + '%'; if (p >= 1){ lb._done = true; lb.style.visibility = 'hidden'; } }
  } else if (state === 'play'){
    sampleInput(dt);
    const sdt = hitStop > 0 ? dt * .08 : dt; hitStop = Math.max(0, hitStop - dt);
    physAcc += sdt; let n = 0;
    while (physAcc >= STEP_DT && n < 12){ stepPlayer(STEP_DT); stepVine(STEP_DT); physAcc -= STEP_DT; n++; }
    if (n >= 12) physAcc = 0;
    renderAlpha = physAcc / STEP_DT;
    useCD -= dt; if (useHeld && useCD <= 0 && isBlockItem(heldId())) useAction(false);
    atkCD = Math.max(0, atkCD - sdt); if (atkHeld && atkCD <= 0) playerAttack();
    stepEnemies(sdt); stepArrows(sdt); tickHealth(dt);
  }
  if (CINE.on) stepCine(dt);
  if (state !== 'title' && !CINE.on){
    updateCamera(dt);
    if (state === 'play' && !PL.catching){
      const f = fwd();
      raycast(EYE.x, EYE.y, EYE.z, f.x, f.y, f.z, 5.5, HIT, false);
      rayMob(EYE.x, EYE.y, EYE.z, f.x, f.y, f.z, HIT.ok ? Math.min(5, HIT.t) : 5);
      updateMining(dt, tAcc);
      const ns = nearestSign(PL.x, PL.y, PL.z, 4.6); if (ns !== nearSign) nearSign = ns;
      nearChestC = nearestChest(3.6);
      nearEngine = !!ENGINE && hyp2(PL.x - ENGINE.console.x, PL.z - ENGINE.console.z) < 3.4 && Math.abs(PL.y - ENGINE.console.y) < 3;
      if (CINE.queued && !PL.catching) startCine();
      if (PL.onGround){ const oi = outerIsle(PL.x, PL.z); if (oi && !oi.seen){ oi.seen = true; if (!oi.content){ showIsleCard(oi); oi.cardShown = true; } renderJournalSoon(); saveDirty = true; } }
      computePlace();
      const isl_ = PL.onGround ? islandAt(PL.x, PL.z) : -2;
      if (isl_ >= 0 && !visited.has(isl_)){ visited.add(isl_); if (isl_ > 0){ toastCard('Discovered', ISL[isl_].name); tut('glide'); } renderJournalSoon(); saveDirty = true; }
      if (tutStep === 0 && hyp2(PL.x - SPAWN.x, PL.z - SPAWN.z) > 4) tut('move');
    } else { HIT.ok = false; MOBHIT.m = null; PLACE.ok = false; crack.visible = false; }
    stepTravel(dt);
    outline.visible = HIT.ok && !MOBHIT.m; if (outline.visible){ const pl = B_RT[HIT.id] === 3; outline.position.set(HIT.x + .5, HIT.y + (pl ? .475 : .5), HIT.z + .5); outline.scale.set(pl ? .7 : 1, pl ? .95 : 1, pl ? .7 : 1); }
    ghost.visible = PLACE.ok && !MOBHIT.m && state === 'play'; if (ghost.visible){ ghost.position.set(PLACE.x + .5, PLACE.y + .5, PLACE.z + .5); const id = heldId(); ghostMat.uniforms.uTileH.value = B_RT[id] === 3 ? B_TILES[id * 6 + 2] : B_TILES[id * 6]; ghostMat.uniforms.uTint.value.setRGB(PLACE.valid ? 1 : 1.3, PLACE.valid ? 1 : .55, PLACE.valid ? 1 : .5); }
    vineTip.visible = VG.on; if (VG.on){ const s = Math.min(1, VG.tipT / VINE_RATE); vineTip.position.set(VG.x + .5, VG.y + .5 - (1 - s) * .3, VG.z + .5); vineTip.scale.setScalar(.2 + s * .8); }
    updatePrompts(); updateObjective();
    mapT -= dt; if (mapT <= 0){ mapT = .1; drawMap(); const w = islandAt(PL.x, PL.z), oi = w < 0 ? outerIsle(PL.x, PL.z) : null, nm = w >= 0 ? ISL[w].name : oi ? oi.name : inSafe(PL.x, PL.z) ? 'Open sky' : 'The Wilds'; if (nm !== hudWhere){ hudWhere = nm; $('#whereName').textContent = nm; } }
  }
  updatePop(dt);
  if (state !== 'pause'){ stepMobs(dt, tAcc); stepDrops(dt, tAcc); updateParticles(dt); stepFliers(dt, tAcc); updateFestival(dt, tAcc); }
  updateShards(tAcc); updateRings(tAcc); updateCubes(tAcc); updateEngine(tAcc, dt); updateGrappleFX(); if (state === 'play') { updateCrosshair(dt); updateGift(dt); updateVistas(dt); } updateBanners(tAcc); updateChests(dt, tAcc);
  if (state !== 'title' && !CINE.on){ pumpWildGen(); pumpBuilds(4); updateWildsAmbience(dt); updateDmgNumbers(dt); }
  updateSilhouettes(dt);
  if (state === 'play'){ stepRings(dt); stepRegrow(dt); }
  renderMobs(tAcc, dt); renderEnemies(tAcc, dt);
  pumpMeshing(state === 'play' ? 3 : 8);
  visT -= dt; if (visT <= 0){ visT = .25; if ((tAcc | 0) % 4 === 0) unloadFar(); const cx = camera.position.x, cz = camera.position.z, R = (state === 'title' ? 300 : renderDist * 1.3) + 10; for (const c of chunks){ if (!c.mesh && !c.wmesh) continue; const v = hyp2(c.cx * 16 + 8 - cx, c.cz * 16 + 8 - cz) < R; if (c.mesh) c.mesh.visible = v; if (c.wmesh) c.wmesh.visible = v; } }
  sky.position.copy(camera.position); if ((frameN = (frameN || 0) + 1) % 3 === 0) updateClouds(tAcc); audioFrame(dt); modsTick(dt);
  U.uReveal.value = Math.min(1, U.uReveal.value + dt * 1.5);
  if (CINE.on) cineRender(); else { renderer.render(scene, camera); renderHandPass(); }
  if (state === 'play'){
    frames++; ftSum += raw; evalT += raw;
    if (evalT > 2){
      // hysteresis: two bad windows to step down, five good windows to step up, and a cooldown after any change
      const avg = ftSum / frames; frames = 0; ftSum = 0; evalT = 0; qCool -= 2;
      qBad = avg > .026 ? qBad + 1 : 0; qGood = avg < .0125 ? qGood + 1 : 0;
      if (qCool <= 0 && qBad >= 2){ qBad = 0; qCool = 12; if (renderDist > (LOW ? 48 : 72)){ renderDist -= 12; setFog(); } else if (qScale > .62){ qScale = Math.max(.62, qScale - .12); qPending = true; } }
      else if (qCool <= 0 && qGood >= 5){ qGood = 0; qCool = 20; if (qScale < 1){ qScale = Math.min(1, qScale + .12); qPending = true; } else if (renderDist < (LOW ? 76 : 120)){ renderDist += 8; setFog(); } }
    }
  }
  if (saveDirty && now - lastSave > 6000){ lastSave = now; saveGame(); }
}
D.addEventListener('visibilitychange', () => {
  if (D.hidden){ if (CINE.on && !CINE.paused){ cinePause(true); CINE.autoP = true; } cancelAnimationFrame(raf); raf = 0; if (AU.ctx) AU.ctx.suspend().catch(() => {}); saveGame(); if (state === 'play' && lookMode !== 'lock') setState('pause'); }
  else if (glOK && !raf && !ctxLost){ if (CINE.on && CINE.autoP){ CINE.autoP = false; cinePause(false); } last = performance.now(); raf = requestAnimationFrame(frame); if (AU.ctx && state !== 'title') AU.ctx.resume().catch(() => {}); }
});
Wn.addEventListener('pagehide', saveGame);
let ctxLost = false;
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); ctxLost = true; cancelAnimationFrame(raf); raf = 0; if (state === 'play') setState('pause'); toast('Graphics paused. Reconnecting…', 4000); });
canvas.addEventListener('webglcontextrestored', () => { ctxLost = false; chunks.forEach((c, k) => { if (c.count || c.mesh) markDirty(k); }); last = performance.now(); if (!raf) raf = requestAnimationFrame(frame); });

// ---- boot: world generation is spread over frames so the title animates immediately ----
function boot(){
  initContent(); setState('title');
  if (!glOK){ hudEl.hidden = true; $('#bPlay').disabled = true; openIndex(); routeHash(); return; }
  buildSky(); onResize(); updateSky();
  camera.position.set(HOMEC.x + 110, 92, HOMEC.z); camera.lookAt(HOMEC.x, 58, HOMEC.z);
  renderer.render(scene, camera);
  const gen = generateSteps(); let done = false;
  const steps = [];
  function pump(){
    const t0 = performance.now();
    while (!done && performance.now() - t0 < 12){ const r = gen.next(); if (r.done) done = true; }
    if (!done){ renderer.render(scene, camera); requestAnimationFrame(pump); return; }
    finishBoot();
  }
  requestAnimationFrame(pump);
}
function finishBoot(){
  baseReady = true;
  const sv = loadGame();
  if (!(sv && applySave(sv))){ resetInventory(); PL.x = SPAWN.x; PL.y = SPAWN.y; PL.z = SPAWN.z; PL.yaw = 0; }
  else $('#bPlay').lastChild.textContent = 'Continue';
  PL.px = PL.x; PL.py = PL.y; PL.pz = PL.z;
  floodAll(); countChunks();
  chunks.forEach((c, k) => { if (c.count) markDirty(k); });
  totalToMesh = dirtyList.filter(k => { const c = chunks[k]; return Math.hypot(c.cx * 16 + 8 - camera.position.x, c.cz * 16 + 8 - camera.position.z) < 150; }).length;
  startWildGen(); layoutWilds(savedSeed || ((Math.random() * 4294967295) >>> 0)); for (const k of savedSeen) if (OUT[k]) OUT[k].seen = true; $('#vSeed').textContent = '#' + (OUT_SEED % 100000);
  buildSigns(); buildGlow(); buildParticles(); buildFliers(); buildUpdrafts(); buildWildDrafts(); buildSilhouettes(); buildChestMeshes(); buildEnemyMeshes(); buildHearts(); buildMobs(); buildShards(); buildRings(); buildCubes(); buildEngine(); buildGrappleFX(); buildBanners(); buildDrops(); buildHand(); buildOutline(); buildAvatar(); buildMapStatic();
  if (pendingComp >= 0 && MOBS[pendingComp] && MOBS[pendingComp].type !== 'jelly'){ companion = MOBS[pendingComp]; companion.friend = true; }
  if (goldSail) setGold(); gearChanged();
  setMuted(AU.muted); syncMix(); setThird(third); invChanged(); $('#vBob').textContent = headBob ? 'On' : 'Off'; $('#vAuto').textContent = autoJump ? 'On' : 'Off'; $('#vTips').textContent = tipsOn ? 'On' : 'Off';
  startMesher(); pumpMeshing(30);
  U.uReveal.value = 0;
  last = performance.now(); raf = requestAnimationFrame(frame); routeHash();
  if (D.fonts && D.fonts.load) Promise.all([D.fonts.load("700 40px 'Silkscreen'"), D.fonts.load("400 20px 'Silkscreen'")]).then(redrawSigns).catch(() => {});
}
function setGold(){ if (sailRig) setSailGold(sailRig); if (standSail) setSailGold(standSail); }
requestAnimationFrame(() => setTimeout(boot, 0));
})();
</script>
