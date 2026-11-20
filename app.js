'use strict';

/* ---------- Konfiguration & Zustand ---------- */
const CFG_KEY = 'lager.cfg';
const CACHE_KEY = 'lager.cache';
const FAECHER = 10;

function guessRepo() {
  const h = location.hostname;
  if (h.endsWith('.github.io')) {
    const owner = h.split('.')[0];
    const repo = location.pathname.split('/').filter(Boolean)[0] || `${owner}.github.io`;
    return { owner, repo };
  }
  return { owner: 'levitgh', repo: 'lager' };
}

const cfg = Object.assign({ branch: 'main', path: 'data.json', token: '' }, guessRepo(), loadJSON(CFG_KEY) || {});
const S = { data: null, sha: null, pending: false, saving: false, status: 'local', filter: 'alle', query: '' };
let saveTimer = null;

function loadJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').trim().toLowerCase();
const $ = sel => document.querySelector(sel);

function emptyData() {
  return { version: 1, regale: [{ id: 1, name: 'Regal 1' }, { id: 2, name: 'Regal 2' }], boxen: [] };
}
function sanitize(d) {
  d = d && typeof d === 'object' ? d : emptyData();
  if (!Array.isArray(d.regale) || !d.regale.length) d.regale = emptyData().regale;
  if (!Array.isArray(d.boxen)) d.boxen = [];
  d.boxen.forEach(b => {
    if (!b.id) b.id = uid();
    if (!Array.isArray(b.items)) b.items = [];
    b.items.forEach(i => { if (!i.id) i.id = uid(); i.soll = Math.max(0, +i.soll || 0); i.ist = Math.max(0, +i.ist || 0); });
  });
  return d;
}

/* ---------- GitHub-Sync ---------- */
function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}
function apiUrl() {
  return `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${cfg.path}`;
}
function headers() {
  const h = { Accept: 'application/vnd.github+json' };
  if (cfg.token) h.Authorization = `Bearer ${cfg.token}`;
  return h;
}
async function remoteGet() {
  const res = await fetch(`${apiUrl()}?ref=${encodeURIComponent(cfg.branch)}`, { headers: headers(), cache: 'no-store' });
  if (res.status === 404) return { data: null, sha: null };
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const j = await res.json();
  return { data: JSON.parse(b64decode(j.content)), sha: j.sha };
}
async function remotePut(data, sha) {
  const body = { message: `Lager aktualisiert (${new Date().toLocaleString('de-DE')})`, content: b64encode(JSON.stringify(data, null, 2) + '\n'), branch: cfg.branch };
  if (sha) body.sha = sha;
  const res = await fetch(apiUrl(), { method: 'PUT', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (res.status === 409 || res.status === 422) return { conflict: true };
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const j = await res.json();
  return { sha: j.content.sha };
}

function setStatus(st) {
  S.status = st;
  const el = $('#sync');
  const txt = { ok: 'Synchron', busy: 'Speichert…', local: cfg.token ? 'Nicht synchron' : (S.pending ? 'Nur auf Gerät' : 'Nur lesen'), err: 'Fehler', load: 'Lädt…' }[st] || '';
  el.className = 'sync ' + (st === 'load' ? 'busy' : st);
  el.textContent = txt;
}

function cache() { saveJSON(CACHE_KEY, { data: S.data, sha: S.sha, pending: S.pending }); }

function commit() {
  S.pending = true;
  cache();
  render();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 700);
}

async function save() {
  if (!S.pending) return;
  if (!cfg.token) { setStatus('local'); if (!save.warned) { save.warned = true; toast('Nur auf diesem Gerät gespeichert – Token in Einstellungen eintragen'); } return; }
  if (S.saving) { clearTimeout(saveTimer); saveTimer = setTimeout(save, 500); return; }
  S.saving = true; setStatus('busy');
  try {
    let r = await remotePut(S.data, S.sha);
    if (r.conflict) {
      // Anderer Stand auf GitHub: aktuellen sha holen, dann eigenen Stand schreiben (letzter gewinnt)
      const remote = await remoteGet();
      r = await remotePut(S.data, remote.sha);
      if (r.conflict) throw new Error('Konflikt');
    }
    S.sha = r.sha; S.pending = false; cache(); setStatus('ok');
  } catch (e) {
    console.error(e); setStatus('err'); toast('Speichern fehlgeschlagen – Token prüfen');
  } finally { S.saving = false; }
}

async function load(manual) {
  const c = loadJSON(CACHE_KEY);
  if (c && c.data && !S.data) { S.data = sanitize(c.data); S.sha = c.sha; S.pending = !!c.pending; render(); }
  setStatus('load');
  try {
    const remote = await remoteGet();
    if (S.pending && cfg.token) {
      S.sha = remote.sha; await save();
    } else if (remote.data) {
      S.data = sanitize(remote.data); S.sha = remote.sha; S.pending = false; cache(); setStatus(cfg.token ? 'ok' : 'local');
    } else {
      if (!S.data) {
        try { const r = await fetch(`data.json?t=${Date.now()}`, { cache: 'no-store' }); if (r.ok) S.data = sanitize(await r.json()); } catch {}
      }
      if (!S.data) S.data = emptyData();
      setStatus('local');
    }
    if (manual) toast('Aktueller Stand geladen');
  } catch (e) {
    console.error(e);
    if (!S.data) {
      // Fallback: statische data.json aus derselben Seite (z. B. bei GitHub-Limit)
      try { const r = await fetch(`data.json?t=${Date.now()}`, { cache: 'no-store' }); if (r.ok) S.data = sanitize(await r.json()); } catch {}
    }
    if (!S.data) S.data = emptyData();
    setStatus(S.pending ? 'local' : 'err');
    if (manual) toast('GitHub nicht erreichbar');
  }
  render();
}

/* ---------- Datenlogik ---------- */
const boxAt = (regal, fach) => S.data.boxen.find(b => b.regal === regal && b.fach === fach);
const boxById = id => S.data.boxen.find(b => b.id === id);
const regalName = id => (S.data.regale.find(r => r.id === id) || {}).name || `Regal ${id}`;
const loc = b => `${regalName(b.regal)} · Fach ${b.fach}`;

function itemStatus(i) {
  if (i.soll > 0 && i.ist < i.soll) return { k: 'bad', t: `fehlt ${i.soll - i.ist}` };
  if (i.soll === 0 && i.ist > 0) return { k: 'warn', t: 'gehört nicht hierher' };
  if (i.ist > i.soll) return { k: 'warn', t: `${i.ist - i.soll} zu viel` };
  return { k: 'ok', t: 'da' };
}
function boxStats(b) {
  let fehlt = 0, falsch = 0;
  b.items.forEach(i => { const s = itemStatus(i); if (s.k === 'bad') fehlt += i.soll - i.ist; else if (s.k === 'warn' && i.soll === 0) falsch++; });
  return { fehlt, falsch, count: b.items.length };
}
function wohinGehoert(item, box) {
  return S.data.boxen.filter(b => b.id !== box.id && b.items.some(i => norm(i.name) === norm(item.name) && i.soll > 0));
}
function totalFehlt() { return S.data.boxen.reduce((n, b) => { const s = boxStats(b); return n + s.fehlt + s.falsch; }, 0); }

/* ---------- Rendering ---------- */
function route() {
  const p = (location.hash || '#/regal/1').slice(2).split('/');
  return { name: p[0] || 'regal', arg: p[1] };
}

function render() {
  if (!S.data) return;
  const r = route();
  const main = $('#main');
  document.querySelectorAll('.tabbar a').forEach(a => a.classList.toggle('active', a.dataset.tab === (r.name === 'box' ? 'regal' : r.name)));
  const nf = totalFehlt();
  const badge = $('#fehltBadge'); badge.hidden = !nf; badge.textContent = nf;
  $('#backBtn').hidden = r.name !== 'box';

  if (r.name === 'box') main.innerHTML = viewBox(r.arg);
  else if (r.name === 'suche') main.innerHTML = viewSuche();
  else if (r.name === 'fehlt') main.innerHTML = viewFehlt();
  else main.innerHTML = viewRegal(+r.arg || 1);

  if (r.name === 'suche' && !S.searchTouched && matchMedia('(pointer:fine)').matches) { const inp = $('#q'); if (inp) inp.focus(); }
}

function viewRegal(rid) {
  $('#title').textContent = 'Lager';
  const boxen = S.data.boxen.filter(b => b.regal === rid);
  const items = boxen.reduce((n, b) => n + b.items.length, 0);
  const fehlt = boxen.reduce((n, b) => { const s = boxStats(b); return n + s.fehlt + s.falsch; }, 0);
  const seg = S.data.regale.map(r => `<a href="#/regal/${r.id}" class="${r.id === rid ? 'active' : ''}">${esc(r.name)}</a>`).join('');
  let levels = '';
  for (let lvl = FAECHER / 2; lvl >= 1; lvl--) {
    levels += `<div class="level">${cell(rid, lvl * 2 - 1)}${cell(rid, lvl * 2)}</div>`;
  }
  return `
    <div class="segmented">${seg}</div>
    <div class="stats">
      <div class="stat"><b>${boxen.length}<small style="font-size:14px;color:var(--muted);font-weight:500">/${FAECHER}</small></b><span>Boxen</span></div>
      <div class="stat"><b>${items}</b><span>Gegenstände</span></div>
      <div class="stat ${fehlt ? 'bad' : 'good'}"><b>${fehlt || '✓'}</b><span>${fehlt ? 'fehlen / falsch' : 'alles da'}</span></div>
    </div>
    <div class="shelf">${levels}<div class="floor">Boden</div></div>`;
}

function cell(rid, fach) {
  const b = boxAt(rid, fach);
  if (!b) return `<button class="cell empty" data-action="newBox" data-regal="${rid}" data-fach="${fach}"><span class="fach">Fach ${fach}</span><span class="plus">+</span>Box anlegen</button>`;
  const s = boxStats(b);
  let pill = `<span class="pill ok">✓ komplett</span>`;
  if (!s.count) pill = `<span class="pill muted">leer</span>`;
  else if (s.fehlt) pill = `<span class="pill bad">${s.fehlt} fehlt</span>`;
  else if (s.falsch) pill = `<span class="pill warn">${s.falsch} falsch</span>`;
  return `<button class="cell" data-action="openBox" data-id="${b.id}">
    <span class="fach">Fach ${fach}</span>
    <span class="name">${esc(b.name || 'Ohne Namen')}</span>
    <span class="meta"><span>${s.count} ${s.count === 1 ? 'Teil' : 'Teile'}</span>${pill}</span>
  </button>`;
}

function viewBox(id) {
  const b = boxById(id);
  if (!b) { location.hash = '#/regal/1'; return ''; }
  $('#title').textContent = '';
  const s = boxStats(b);
  let items = b.items.slice().sort((x, y) => x.name.localeCompare(y.name, 'de'));
  if (S.filter === 'fehlt') items = items.filter(i => itemStatus(i).k !== 'ok');
  const rows = items.map(i => {
    const st = itemStatus(i);
    let sub = `<span style="color:var(--${st.k === 'bad' ? 'bad' : st.k === 'warn' ? 'warn' : 'ok'})">${st.t}</span>`;
    if (st.k === 'warn' && i.soll === 0) {
      const w = wohinGehoert(i, b);
      if (w.length) sub += ` · gehört in ${w.map(x => esc(x.name || loc(x))).join(', ')}`;
    }
    return `<div class="row">
      <span class="dot ${st.k}"></span>
      <div class="grow tap" data-action="editItem" data-id="${i.id}">
        <div class="title">${esc(i.name)}</div>
        <div class="sub">${sub}</div>
      </div>
      <div class="stepper">
        <button data-action="ist" data-id="${i.id}" data-d="-1" aria-label="weniger">−</button>
        <span class="val">${i.ist}<small> / ${i.soll}</small></span>
        <button data-action="ist" data-id="${i.id}" data-d="1" aria-label="mehr">+</button>
      </div>
    </div>`;
  }).join('');
  const emptyTxt = b.items.length
    ? `<div class="empty-state"><b>Nichts fehlt</b>Alle Gegenstände sind da.</div>`
    : `<div class="empty-state"><b>Box ist noch leer</b>Füge unten hinzu, was in diese Box gehört.</div>`;
  return `
    <div class="box-head">
      <input class="name" id="boxName" value="${esc(b.name)}" placeholder="Name der Box" data-id="${b.id}" enterkeyhint="done">
      <div class="loc">
        <span>${esc(loc(b))}</span>
        ${s.fehlt ? `<span class="pill bad">${s.fehlt} fehlt</span>` : ''}
        ${s.falsch ? `<span class="pill warn">${s.falsch} falsch</span>` : ''}
        ${!s.fehlt && !s.falsch && s.count ? `<span class="pill ok">✓ komplett</span>` : ''}
      </div>
      <div class="actions">
        <button class="btn small" data-action="moveBox" data-id="${b.id}">Verschieben</button>
        ${s.fehlt ? `<button class="btn small" data-action="allDa" data-id="${b.id}">Alles da</button>` : ''}
        <button class="btn small danger" data-action="delBox" data-id="${b.id}">Löschen</button>
      </div>
    </div>
    <div class="chips">
      <button class="chip ${S.filter === 'alle' ? 'active' : ''}" data-action="filter" data-f="alle">Alle (${b.items.length})</button>
      <button class="chip ${S.filter === 'fehlt' ? 'active' : ''}" data-action="filter" data-f="fehlt">Abweichungen (${b.items.filter(i => itemStatus(i).k !== 'ok').length})</button>
    </div>
    <div class="section-title"><span>Ist / Soll</span></div>
    ${rows ? `<div class="list">${rows}</div>` : emptyTxt}
    <form class="add-row" data-form="addItem" data-id="${b.id}" autocomplete="off">
      <input class="input" name="name" placeholder="Gegenstand hinzufügen" required>
      <input class="input qty" name="soll" type="number" inputmode="numeric" min="0" value="1" aria-label="Soll-Menge">
      <button class="btn primary" type="submit">+</button>
    </form>`;
}

function searchResults() {
  const q = norm(S.query);
  if (!q) return `<div class="empty-state"><b>Was suchst du?</b>Tippe einen Gegenstand oder Boxnamen ein.</div>`;
  const hits = [];
  S.data.boxen.forEach(b => {
    if (norm(b.name).includes(q)) hits.push({ b, box: true });
    b.items.forEach(i => { if (norm(i.name).includes(q)) hits.push({ b, i }); });
  });
  hits.sort((a, c) => a.b.regal - c.b.regal || a.b.fach - c.b.fach);
  if (!hits.length) return `<div class="empty-state"><b>Nichts gefunden</b>Kein Gegenstand und keine Box passt zu „${esc(S.query)}“.</div>`;
  return `<div class="list">${hits.map(h => {
    if (h.box) return `<div class="row tap" data-action="openBox" data-id="${h.b.id}"><span class="dot" style="background:var(--accent)"></span><div class="grow"><div class="title">${esc(h.b.name || 'Ohne Namen')}</div><div class="sub">Box · ${esc(loc(h.b))}</div></div>${chev()}</div>`;
    const st = itemStatus(h.i);
    return `<div class="row tap" data-action="openBox" data-id="${h.b.id}"><span class="dot ${st.k}"></span><div class="grow"><div class="title">${esc(h.i.name)}</div><div class="sub">${esc(h.b.name || 'Box')} · ${esc(loc(h.b))} · ${h.i.ist}/${h.i.soll}${st.k !== 'ok' ? ' · ' + st.t : ''}</div></div>${chev()}</div>`;
  }).join('')}</div>`;
}

function viewSuche() {
  $('#title').textContent = 'Suche';
  return `
    <div class="search">
      <svg viewBox="0 0 24 24" width="18" height="18"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <input class="input" id="q" type="search" placeholder="z. B. Akkuschrauber" value="${esc(S.query)}" autocomplete="off" enterkeyhint="search">
    </div>
    <div id="results">${searchResults()}</div>`;
}

function viewFehlt() {
  $('#title').textContent = 'Fehlt';
  const groups = S.data.boxen.slice().sort((a, b) => a.regal - b.regal || a.fach - b.fach)
    .map(b => ({ b, items: b.items.filter(i => itemStatus(i).k !== 'ok') }))
    .filter(g => g.items.length);
  if (!groups.length) return `<div class="empty-state" style="padding-top:60px"><b>Alles an seinem Platz ✓</b>In keiner Box fehlt etwas.</div>`;
  return groups.map(g => `
    <div class="section-title"><span>${esc(g.b.name || 'Ohne Namen')} · ${esc(loc(g.b))}</span><button class="btn small" data-action="openBox" data-id="${g.b.id}">Öffnen</button></div>
    <div class="list">${g.items.map(i => {
      const st = itemStatus(i);
      let sub = st.t;
      if (st.k === 'warn' && i.soll === 0) { const w = wohinGehoert(i, g.b); if (w.length) sub += ` · gehört in ${w.map(x => esc(x.name || loc(x))).join(', ')}`; }
      return `<div class="row"><span class="dot ${st.k}"></span><div class="grow"><div class="title">${esc(i.name)}</div><div class="sub">${sub}</div></div>
        <div class="stepper"><button data-action="ist" data-box="${g.b.id}" data-id="${i.id}" data-d="-1">−</button><span class="val">${i.ist}<small> / ${i.soll}</small></span><button data-action="ist" data-box="${g.b.id}" data-id="${i.id}" data-d="1">+</button></div></div>`;
    }).join('')}</div>`).join('');
}

const chev = () => `<svg class="chev" viewBox="0 0 24 24" width="18" height="18"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/* ---------- Sheets ---------- */
function openSheet(html) {
  const sh = $('#sheet');
  sh.innerHTML = `<div class="grabber"></div>${html}`;
  sh.hidden = false; $('#sheetBackdrop').hidden = false;
  const first = sh.querySelector('input:not([type=hidden])');
  if (first && matchMedia('(pointer:fine)').matches) setTimeout(() => first.focus(), 50);
}
function closeSheet() { $('#sheet').hidden = true; $('#sheetBackdrop').hidden = true; $('#sheet').innerHTML = ''; }

function sheetNewBox(regal, fach) {
  openSheet(`<h2>Neue Box</h2>
    <form data-form="newBox" data-regal="${regal}" data-fach="${fach}" autocomplete="off">
      <label class="field"><span>Name</span><input class="input" name="name" placeholder="z. B. Werkzeug, Weihnachtsdeko" required></label>
      <p class="hint">${esc(regalName(regal))} · Fach ${fach}</p>
      <div class="btns"><button type="button" class="btn" data-action="close">Abbrechen</button><button class="btn primary" type="submit">Anlegen</button></div>
    </form>`);
}

function sheetEditItem(box, item) {
  openSheet(`<h2>Gegenstand</h2>
    <form data-form="editItem" data-box="${box.id}" data-id="${item.id}" autocomplete="off">
      <label class="field"><span>Name</span><input class="input" name="name" value="${esc(item.name)}" required></label>
      <div class="row2">
        <label class="field"><span>Soll (gehört rein)</span><input class="input" name="soll" type="number" inputmode="numeric" min="0" value="${item.soll}"></label>
        <label class="field"><span>Ist (ist drin)</span><input class="input" name="ist" type="number" inputmode="numeric" min="0" value="${item.ist}"></label>
      </div>
      <p class="hint">Soll 0 heißt: gehört nicht in diese Box, liegt aber gerade drin.</p>
      <label class="field"><span>In andere Box verschieben</span>
        <select class="input" name="target"><option value="">— bleibt in ${esc(box.name || 'dieser Box')} —</option>
        ${S.data.boxen.filter(b => b.id !== box.id).sort((a, b) => a.regal - b.regal || a.fach - b.fach).map(b => `<option value="${b.id}">${esc(b.name || 'Ohne Namen')} (${esc(loc(b))})</option>`).join('')}</select>
      </label>
      <div class="btns"><button type="button" class="btn danger" data-action="delItem" data-box="${box.id}" data-id="${item.id}">Löschen</button><button class="btn primary" type="submit">Speichern</button></div>
    </form>`);
}

function sheetMoveBox(b) {
  let opts = '';
  S.data.regale.forEach(r => {
    for (let f = 1; f <= FAECHER; f++) {
      const occ = boxAt(r.id, f);
      if (occ && occ.id === b.id) continue;
      opts += `<option value="${r.id}:${f}">${esc(r.name)} · Fach ${f}${occ ? ` (tauschen mit ${esc(occ.name || 'Box')})` : ' (frei)'}</option>`;
    }
  });
  openSheet(`<h2>Box verschieben</h2>
    <form data-form="moveBox" data-id="${b.id}">
      <label class="field"><span>Neuer Platz für „${esc(b.name || 'Box')}“</span><select class="input" name="to">${opts}</select></label>
      <p class="hint">Ist das Fach belegt, tauschen die beiden Boxen die Plätze.</p>
      <div class="btns"><button type="button" class="btn" data-action="close">Abbrechen</button><button class="btn primary" type="submit">Verschieben</button></div>
    </form>`);
}

function sheetSettings() {
  openSheet(`<h2>Einstellungen</h2>
    <form data-form="settings" autocomplete="off">
      <div class="row2">
        <label class="field"><span>GitHub-Nutzer</span><input class="input" name="owner" value="${esc(cfg.owner)}" autocapitalize="off"></label>
        <label class="field"><span>Repository</span><input class="input" name="repo" value="${esc(cfg.repo)}" autocapitalize="off"></label>
      </div>
      <label class="field"><span>Zugriffstoken (zum Speichern)</span><input class="input" name="token" type="password" value="${esc(cfg.token)}" placeholder="github_pat_…" autocapitalize="off" spellcheck="false"></label>
      <p class="hint">Einmal pro Gerät eintragen. Erstellen unter <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → Fine-grained token</a>: nur dieses Repository, Berechtigung „Contents: Read and write“. Das Token bleibt nur auf diesem Gerät.</p>
      <div class="btns"><button type="button" class="btn" data-action="reload">Neu laden</button><button class="btn primary" type="submit">Speichern</button></div>
      <div class="btns"><button type="button" class="btn" data-action="export">Backup herunterladen</button>
      <button type="button" class="btn" data-action="renameRegal">Regale umbenennen</button></div>
    </form>`);
}

function sheetRenameRegale() {
  openSheet(`<h2>Regale umbenennen</h2>
    <form data-form="renameRegale">${S.data.regale.map(r => `<label class="field"><span>Regal ${r.id}</span><input class="input" name="r${r.id}" value="${esc(r.name)}"></label>`).join('')}
      <div class="btns"><button type="button" class="btn" data-action="close">Abbrechen</button><button class="btn primary" type="submit">Speichern</button></div>
    </form>`);
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2200);
}

/* ---------- Events ---------- */
function findItem(boxId, itemId) {
  const b = boxId ? boxById(boxId) : S.data.boxen.find(x => x.items.some(i => i.id === itemId));
  return { b, i: b && b.items.find(i => i.id === itemId) };
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  if (a === 'back') { history.length > 1 ? history.back() : (location.hash = '#/regal/1'); }
  else if (a === 'settings') sheetSettings();
  else if (a === 'sync') load(true);
  else if (a === 'close') closeSheet();
  else if (a === 'newBox') sheetNewBox(+el.dataset.regal, +el.dataset.fach);
  else if (a === 'openBox') { S.filter = 'alle'; location.hash = `#/box/${el.dataset.id}`; }
  else if (a === 'filter') { S.filter = el.dataset.f; render(); }
  else if (a === 'ist') {
    const { i } = findItem(el.dataset.box, el.dataset.id);
    if (i) { i.ist = Math.max(0, i.ist + +el.dataset.d); commit(); }
  }
  else if (a === 'editItem') { const { b, i } = findItem(null, el.dataset.id); if (i) sheetEditItem(b, i); }
  else if (a === 'delItem') {
    const { b, i } = findItem(el.dataset.box, el.dataset.id);
    if (i && confirm(`„${i.name}“ löschen?`)) { b.items = b.items.filter(x => x.id !== i.id); closeSheet(); commit(); }
  }
  else if (a === 'allDa') {
    const b = boxById(el.dataset.id);
    b.items.forEach(i => { if (i.ist < i.soll) i.ist = i.soll; }); commit(); toast('Alles als da markiert');
  }
  else if (a === 'moveBox') sheetMoveBox(boxById(el.dataset.id));
  else if (a === 'delBox') {
    const b = boxById(el.dataset.id);
    if (confirm(`Box „${b.name || 'Ohne Namen'}“ mit ${b.items.length} Gegenständen löschen?`)) {
      S.data.boxen = S.data.boxen.filter(x => x.id !== b.id); location.hash = `#/regal/${b.regal}`; commit();
    }
  }
  else if (a === 'reload') { closeSheet(); load(true); }
  else if (a === 'export') {
    const blob = new Blob([JSON.stringify(S.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = `lager-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  else if (a === 'renameRegal') sheetRenameRegale();
});

$('#sheetBackdrop').addEventListener('click', closeSheet);

document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  const fd = new FormData(f);
  const kind = f.dataset.form;
  if (kind === 'newBox') {
    const b = { id: uid(), regal: +f.dataset.regal, fach: +f.dataset.fach, name: String(fd.get('name')).trim(), items: [] };
    S.data.boxen.push(b); closeSheet(); commit(); location.hash = `#/box/${b.id}`;
  } else if (kind === 'addItem') {
    const b = boxById(f.dataset.id);
    const name = String(fd.get('name')).trim(); if (!name) return;
    const soll = Math.max(0, parseInt(fd.get('soll'), 10) || 0);
    const ex = b.items.find(i => norm(i.name) === norm(name));
    if (ex) { ex.soll += soll; ex.ist += soll; toast('Menge erhöht'); }
    else b.items.push({ id: uid(), name, soll, ist: soll });
    commit();
    const inp = document.querySelector('form[data-form=addItem] input[name=name]'); if (inp) inp.focus();
  } else if (kind === 'editItem') {
    const { b, i } = findItem(f.dataset.box, f.dataset.id);
    i.name = String(fd.get('name')).trim() || i.name;
    i.soll = Math.max(0, parseInt(fd.get('soll'), 10) || 0);
    i.ist = Math.max(0, parseInt(fd.get('ist'), 10) || 0);
    const target = fd.get('target');
    if (target) {
      const t = boxById(target);
      b.items = b.items.filter(x => x.id !== i.id);
      const ex = t.items.find(x => norm(x.name) === norm(i.name));
      if (ex) { ex.soll += i.soll; ex.ist += i.ist; } else t.items.push(i);
      toast(`Verschoben nach ${t.name || loc(t)}`);
    }
    closeSheet(); commit();
  } else if (kind === 'moveBox') {
    const b = boxById(f.dataset.id);
    const [r, fa] = String(fd.get('to')).split(':').map(Number);
    const occ = boxAt(r, fa);
    if (occ) { occ.regal = b.regal; occ.fach = b.fach; }
    b.regal = r; b.fach = fa; closeSheet(); commit(); toast(`Jetzt in ${loc(b)}`);
  } else if (kind === 'settings') {
    cfg.owner = String(fd.get('owner')).trim(); cfg.repo = String(fd.get('repo')).trim(); cfg.token = String(fd.get('token')).trim();
    saveJSON(CFG_KEY, cfg); closeSheet(); toast('Gespeichert'); load(true);
  } else if (kind === 'renameRegale') {
    S.data.regale.forEach(r => { const v = String(fd.get('r' + r.id) || '').trim(); if (v) r.name = v; });
    closeSheet(); commit();
  }
});

document.addEventListener('input', e => {
  if (e.target.id === 'q') {
    S.query = e.target.value; S.searchTouched = true;
    $('#results').innerHTML = searchResults();
  }
});
document.addEventListener('change', e => {
  if (e.target.id === 'boxName') {
    const b = boxById(e.target.dataset.id); b.name = e.target.value.trim(); commit();
  }
});
document.addEventListener('keydown', e => {
  if (e.target.id === 'boxName' && e.key === 'Enter') e.target.blur();
  if (e.key === 'Escape') closeSheet();
});

window.addEventListener('hashchange', () => { S.searchTouched = false; closeSheet(); render(); window.scrollTo(0, 0); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !S.pending && !S.saving) load(false); });

setStatus('load');
load(false);
