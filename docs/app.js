'use strict';
/* Sommerkonzert 2026/2027 – Programmplanung. Ein Konzert, viele Ensembles, viele Stückvorschläge. */

const POLL_MS = 30000;
const NAME_KEY = 'slgm-sommerkonzert-name';
const UI_KEY = 'slgm-sommerkonzert-ansicht';

const MOODS = { nacht: 'Nacht · Mühsal', licht: 'Licht · Sterne', beides: 'Beides' };
const MOOD_ORDER = { nacht: 0, beides: 1, licht: 2, '': 3 };
const VIEWS = { ensemble: 'Nach Ensemble', tabelle: 'Tabelle', komponist: 'Nach Komponist' };
const FILTERS = { alle: 'Alle', nacht: 'Nacht', licht: 'Licht', beides: 'Beides', keine: 'Ohne Angabe' };

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const parseD = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtDate = (s, long) => !s ? '' : parseD(s).toLocaleDateString('de-DE', long
  ? { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }
  : { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtNum = (n) => String(Math.round(n * 10) / 10).replace('.', ',');
const fmtMin = (m) => {
  if (m < 60) return `${fmtNum(m)} Min`;
  m = Math.round(m);
  const h = Math.floor(m / 60), r = m % 60;
  return `${h} Std${r ? ` ${r} Min` : ''}`;
};
const fmtStamp = (iso) => new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const live = (r) => !r.deleted_at;
const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

// Der Name wird nur als Vorschlag gemerkt (Leitung beim Ensemble, Name beim Kommentar). Kein Zwang, keine Anmeldung.
const readName = () => { try { return (localStorage.getItem(NAME_KEY) || '').trim(); } catch { return ''; } };
const saveName = (n) => { try { if (n) localStorage.setItem(NAME_KEY, n); } catch { /* privater Modus */ } };

/* ---------- Ansicht und Filter (merkt sich der Browser) ---------- */
const ui = { view: 'ensemble', mood: 'alle', q: '', sortKey: '', sortDir: 1 };
try {
  const saved = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
  if (VIEWS[saved.view]) ui.view = saved.view;
  if (FILTERS[saved.mood]) ui.mood = saved.mood;
} catch { /* egal */ }
const saveUi = () => { try { localStorage.setItem(UI_KEY, JSON.stringify({ view: ui.view, mood: ui.mood })); } catch { /* egal */ } };

const state = { data: null, json: '', vm: null };

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('zeigen');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('zeigen'), 3200);
}

/* ---------- Daten aufbereiten ---------- */
function viewModel(d) {
  const concert = d.concerts.filter(live).sort((a, b) => a.id - b.id)[0];
  const pieces = d.pieces.filter(live);
  const ensembles = d.ensembles.filter((e) => live(e) && e.concert_id === concert.id).sort((a, b) => a.id - b.id)
    .map((e) => ({ ...e, pieces: pieces.filter((p) => p.ensemble_id === e.id).sort((a, b) => a.position - b.position || a.id - b.id) }));
  const comments = d.comments.filter((c) => live(c) && c.concert_id === concert.id).sort((a, b) => a.id - b.id);
  return { concert, ensembles, comments };
}

const moodOf = (p) => (MOODS[p.mood] ? p.mood : '');
const moodBadge = (p) => moodOf(p) ? `<span class="zuo ${moodOf(p)}">${MOODS[moodOf(p)]}</span>` : '';
const allRows = () => state.vm.ensembles.flatMap((e) => e.pieces.map((p) => ({ p, e })));
const isFiltering = () => ui.mood !== 'alle' || ui.q.trim() !== '';

function matches({ p, e }) {
  if (ui.mood === 'keine' ? moodOf(p) !== '' : (ui.mood !== 'alle' && moodOf(p) !== ui.mood)) return false;
  const q = ui.q.trim().toLowerCase();
  return !q || [p.title, p.composer, p.notes, e.name, e.lead].join(' ').toLowerCase().includes(q);
}

/* ---------- Ansichten der Stücke ---------- */
const dauer = (p) => p.duration_min ? `${fmtNum(p.duration_min)} Min` : '';

function ensembleView(rows) {
  const filtering = isFiltering();
  return state.vm.ensembles.map((e) => {
    const pieces = rows.filter((r) => r.e.id === e.id).map((r) => r.p);
    if (filtering && !pieces.length) return '';
    const sum = pieces.reduce((a, p) => a + p.duration_min, 0);
    return `<article class="ensemble">
      <header><div><h3>${esc(e.name)}</h3>
        <div class="meta">Leitung: <b>${esc(e.lead)}</b></div>
        ${e.performers ? `<div class="meta">Besetzung: <b>${esc(e.performers)}</b></div>` : ''}
        ${e.headcount ? `<div class="meta">Mitwirkende: <b>${esc(e.headcount)}</b></div>` : ''}</div>
        <div class="aktion"><button class="btn klein" data-action="edit-ensemble" data-id="${e.id}">Bearbeiten</button>
          <button class="btn klein gefahr" data-action="del-ensemble" data-id="${e.id}">Löschen</button></div></header>
      ${e.notes ? `<div class="notiz">${esc(e.notes)}</div>` : ''}
      ${pieces.length ? `<table class="tabelle"><thead><tr><th>Stück</th><th>Komponist oder Arrangeur</th><th>Zuordnung</th><th>Bemerkung</th><th class="min">Dauer</th></tr></thead><tbody>
        ${pieces.map((p) => `<tr><td class="t">${esc(p.title)}</td><td>${esc(p.composer)}</td><td>${moodBadge(p)}</td><td class="bem">${esc(p.notes)}</td><td class="min">${dauer(p)}</td></tr>`).join('')}</tbody></table>
        <div class="summe"><span>${pieces.length} ${pieces.length === 1 ? 'Stück' : 'Stücke'}</span><span>${sum ? 'Spielzeit ' + fmtMin(sum) : ''}</span></div>`
        : '<p class="meta"><i>Noch kein Stück vorgeschlagen.</i></p>'}
    </article>`;
  }).join('');
}

function sortValue(key, { p, e }) {
  switch (key) {
    case 'title': return p.title;
    case 'composer': return p.composer;
    case 'ensemble': return e.name;
    case 'mood': return MOOD_ORDER[moodOf(p)];
    case 'dur': return p.duration_min || 0;
    default: return 0;
  }
}
function tableView(rows) {
  const list = rows.slice();
  if (ui.sortKey) {
    const k = ui.sortKey, dir = ui.sortDir;
    list.sort((a, b) => {
      const x = sortValue(k, a), y = sortValue(k, b);
      if (typeof x === 'string') { // Leeres immer ans Ende
        if (!x && y) return 1;
        if (x && !y) return -1;
        return collator.compare(x, y) * dir;
      }
      return (x - y) * dir;
    });
  }
  const th = (key, label, cls = '') => `<th class="${cls}"><button class="sortbtn" data-action="sort" data-key="${key}" aria-label="Nach ${esc(label)} sortieren">${esc(label)}${ui.sortKey === key ? (ui.sortDir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`;
  return `<div class="tabellenrahmen"><table class="tabelle gross">
    <thead><tr>${th('title', 'Stück')}${th('composer', 'Komponist oder Arrangeur')}${th('ensemble', 'Ensemble')}${th('mood', 'Zuordnung')}<th>Bemerkung</th>${th('dur', 'Dauer', 'min')}<th></th></tr></thead>
    <tbody>${list.map(({ p, e }) => `<tr>
      <td class="t">${esc(p.title)}</td><td>${esc(p.composer)}</td>
      <td>${esc(e.name)}<div class="gedaempft">${esc(e.lead)}</div></td>
      <td>${moodBadge(p)}</td><td class="bem">${esc(p.notes)}</td><td class="min">${dauer(p)}</td>
      <td class="aktion"><button class="iconbtn" data-action="edit-ensemble" data-id="${e.id}" aria-label="Ensemble bearbeiten" title="Ensemble bearbeiten">✎</button></td></tr>`).join('')}</tbody></table></div>`;
}

function composerView(rows) {
  const groups = new Map();
  for (const r of rows) {
    const name = r.p.composer.trim();
    const key = name.toLowerCase();
    if (!groups.has(key)) groups.set(key, { name, rows: [] });
    groups.get(key).rows.push(r);
  }
  const list = [...groups.values()].sort((a, b) => (!a.name && b.name) ? 1 : (a.name && !b.name) ? -1 : collator.compare(a.name, b.name));
  return list.map((g) => `<article class="ensemble komp">
    <header><h3>${g.name ? esc(g.name) : '<i>Ohne Angabe zum Komponisten</i>'}</h3><span class="meta">${g.rows.length} ${g.rows.length === 1 ? 'Stück' : 'Stücke'}</span></header>
    <table class="tabelle"><thead><tr><th>Stück</th><th>Ensemble</th><th>Zuordnung</th><th>Bemerkung</th><th class="min">Dauer</th></tr></thead><tbody>
      ${g.rows.map(({ p, e }) => `<tr><td class="t">${esc(p.title)}</td><td>${esc(e.name)}<span class="gedaempft"> · ${esc(e.lead)}</span></td><td>${moodBadge(p)}</td><td class="bem">${esc(p.notes)}</td><td class="min">${dauer(p)}</td></tr>`).join('')}</tbody></table>
  </article>`).join('');
}

function resultsHtml() {
  if (!state.vm.ensembles.length) return '<div class="leer">Noch kein Ensemble eingetragen. Mach den Anfang.</div>';
  const all = allRows(), rows = all.filter(matches);
  if (isFiltering() && !rows.length) {
    return '<div class="leer">Keine Stücke gefunden. <button class="linkbtn" data-action="reset-filter">Filter zurücksetzen</button></div>';
  }
  const info = isFiltering() ? `<div class="treffer">${rows.length} von ${all.length} Stücken · <button class="linkbtn" data-action="reset-filter">Filter zurücksetzen</button></div>` : '';
  if (ui.view === 'tabelle') return info + tableView(rows);
  if (ui.view === 'komponist') return info + composerView(rows);
  return info + ensembleView(rows);
}

function toolbarHtml() {
  const all = allRows();
  const count = { alle: all.length, nacht: 0, licht: 0, beides: 0, keine: 0 };
  all.forEach(({ p }) => { count[moodOf(p) || 'keine']++; });
  const seg = (name, items, current, action, withCount) => `<div class="seg" role="group" aria-label="${name}">${Object.entries(items).map(([k, l]) =>
    `<button type="button" class="${current === k ? 'an' : ''}" aria-pressed="${current === k}" data-action="${action}" data-v="${k}">${esc(l)}${withCount ? ` <small>${count[k]}</small>` : ''}</button>`).join('')}</div>`;
  return `<div class="gruppe"><span class="gl">Ansicht</span>${seg('Ansicht', VIEWS, ui.view, 'set-view', false)}</div>
    <div class="gruppe"><span class="gl">Zuordnung</span>${seg('Nach Zuordnung filtern', FILTERS, ui.mood, 'set-mood', true)}</div>`;
}

function refreshPieces() {
  const tb = $('#werkzeug-schalter'), res = $('#ergebnis');
  if (!tb || !res) return;
  tb.innerHTML = toolbarHtml();
  res.innerHTML = resultsHtml();
}

/* ---------- Seite ---------- */
function render() {
  const { concert: c, ensembles, comments } = state.vm;
  const nPieces = ensembles.reduce((a, e) => a + e.pieces.length, 0);

  // Die Terminzeile erscheint erst, wenn es etwas einzutragen gab
  const termin = [c.date ? `<b>${esc(fmtDate(c.date, true))}</b>` : '',
    c.start_time ? esc(c.start_time + (c.end_time ? '–' + c.end_time : '') + ' Uhr') : '', c.venue ? esc(c.venue) : ''].filter(Boolean).join(' · ');

  const commentRow = (k) => `<div class="kommentar">
    <div class="kopfzeile"><span><b>${esc(k.author)}</b> · ${esc(fmtStamp(k.created_at))}</span>
      <button class="iconbtn gefahr" data-action="del-comment" data-id="${k.id}" aria-label="Kommentar löschen">×</button></div>
    <p>${esc(k.body)}</p></div>`;

  const draft = { text: $('#comment-body')?.value, name: $('#comment-name')?.value };
  $('#app').innerHTML = `
    <div class="titelblock">
      <h1 class="titel">Programmplanung</h1>
      <p class="untertitel">Ensembles melden, Stücke vorschlagen</p>
      <p class="titelzusatz">Sächsisches Landesgymnasium für Musik Carl Maria von Weber Dresden</p>
      <p class="titelzusatz"><button class="linkbtn" data-action="edit-concert">${termin ? 'Termin und Ort ändern' : 'Termin und Ort eintragen'}</button></p>
      <hr class="linie">
    </div>

    <section class="leiste" aria-label="Zwischenstand">
      <div class="karte"><div class="zahl">${ensembles.length}</div><div class="label">Ensembles</div></div>
      <div class="karte"><div class="zahl">${nPieces}</div><div class="label">Stückvorschläge</div></div>
    </section>

    ${termin ? `<div class="eckdaten"><span>${termin}</span></div>` : ''}
    ${c.description ? `<div class="kasten">${esc(c.description)}</div>` : ''}

    <section class="bereich" aria-labelledby="ensTitel">
      <div class="abschnittskopf"><h2 class="abschnitt" id="ensTitel">Ensembles und Stücke</h2>
        <button class="btn primär" data-action="add-ensemble" id="addEnsemble">Ensemble eintragen</button></div>
      <div class="werkzeug">
        <div id="werkzeug-schalter" class="schalter"></div>
        <label class="suche"><span class="sr">Suchen</span><input type="search" id="suche" placeholder="Stück, Komponist, Ensemble suchen …" value="${esc(ui.q)}" autocomplete="off"></label>
      </div>
      <div id="ergebnis"></div>
    </section>

    <section class="bereich komm" aria-labelledby="komTitel">
      <div class="abschnittskopf"><h2 class="abschnitt" id="komTitel">Kommentare</h2></div>
      <form id="comment-form" class="karte komform" novalidate>
        <label class="feld"><span>Dein Name</span><input type="text" id="comment-name" maxlength="100" autocomplete="name" placeholder="Vor- und Nachname" value="${esc(readName())}"></label>
        <label class="feld"><span>Dein Kommentar</span><textarea id="comment-body" maxlength="4000" rows="4" placeholder="Absprachen, Fragen, Hinweise für alle"></textarea></label>
        <div class="fehler" role="alert"></div>
        <button class="btn primär" type="submit">Kommentar senden</button>
      </form>
      ${comments.length ? comments.slice().reverse().map(commentRow).join('') : '<div class="leer">Noch keine Kommentare.</div>'}
    </section>`;
  if (draft.text && $('#comment-body')) $('#comment-body').value = draft.text;
  if (draft.name && $('#comment-name')) $('#comment-name').value = draft.name;
  refreshPieces();
}

/* ---------- Modal ---------- */
const fieldHtml = (f, v) => {
  const val = v ?? '';
  const req = f.required ? ' <b class="pflicht">*</b>' : '';
  const ph = f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : '';
  let input;
  if (f.type === 'textarea') input = `<textarea name="${f.name}" maxlength="${f.max || 4000}"${ph}>${esc(val)}</textarea>`;
  else input = `<input type="${f.type || 'text'}" name="${f.name}" value="${esc(val)}"${f.max ? ` maxlength="${f.max}"` : ''}${f.attrs ? ' ' + f.attrs : ''}${ph}>`;
  return `<label class="feld"><span>${esc(f.label)}${req}</span>${input}</label>`;
};
const fieldsHtml = (fields, values) => fields.map((f) => Array.isArray(f)
  ? `<div class="zeile2">${f.map((g) => fieldHtml(g, values[g.name])).join('')}</div>` : fieldHtml(f, values[f.name])).join('');

function openModal({ title, html, submit = 'Speichern', onSubmit, required = [] }) {
  const m = $('#modal');
  m.innerHTML = `<form class="box" novalidate><h2>${esc(title)}</h2>${html}
    <div class="fehler" role="alert"></div>
    <div class="knoepfe"><button type="button" class="btn" data-action="close-modal">Abbrechen</button><button class="btn primär" type="submit">${esc(submit)}</button></div></form>`;
  m.hidden = false;
  const form = $('form', m);
  const first = $('input, textarea', form);
  if (first) first.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', form);
    const err = (msg) => { $('.fehler', form).textContent = msg; };
    for (const [name, label] of required) if (!String(form.elements[name]?.value || '').trim()) return err(`${label} fehlt.`);
    btn.disabled = true; err('');
    try { await onSubmit(form); closeModal(); }
    catch (ex) { err(ex.message); btn.disabled = false; }
  });
}
function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });

const formValues = (form) => Object.fromEntries(new FormData(form).entries());

/* ---------- Speichern ---------- */
async function save(payload) {
  const snap = await Store.write(payload);
  applyData(snap, true);
}
function applyData(d, force) {
  const json = JSON.stringify(d);
  if (!force && json === state.json) return false;
  state.data = d; state.json = json; state.vm = viewModel(d);
  render();
  return true;
}
async function refresh(force) { applyData(await Store.load(force), force); }

/* ---------- Formulare ---------- */
const moodSelect = (cur) => `<select class="p-mood">${[['', 'Keine Angabe'], ...Object.entries(MOODS)].map(([k, l]) => `<option value="${k}"${(cur || '') === k ? ' selected' : ''}>${l}</option>`).join('')}</select>`;

const pieceRow = (p = {}) => `<div class="stueck" data-piece="${p.id || ''}">
  <button type="button" class="iconbtn weg" data-action="remove-piece" aria-label="Stück entfernen" title="Stück entfernen">×</button>
  <label class="feld"><span>Stück</span><input type="text" class="p-title" maxlength="160" placeholder="Titel des Stücks" value="${esc(p.title)}"></label>
  <label class="feld"><span>Komponist oder Arrangeur</span><input type="text" class="p-composer" maxlength="160" value="${esc(p.composer)}"></label>
  <div class="zeile2">
    <label class="feld"><span>Bemerkung</span><input type="text" class="p-notes" maxlength="500" placeholder="Noten, Solisten" value="${esc(p.notes)}"></label>
    <label class="feld"><span>Dauer (Min)</span><input type="text" class="p-dur" inputmode="decimal" maxlength="6" value="${p.duration_min ? esc(fmtNum(p.duration_min)) : ''}"></label>
  </div>
  <label class="feld"><span>Zuordnung (optional): eher Nacht, eher Licht oder beides?</span>${moodSelect(p.mood)}</label></div>`;

function ensembleModal(e) {
  const v = e || { lead: readName() };
  const rows = e && e.pieces.length ? e.pieces : [{}];
  openModal({
    title: e ? 'Ensemble bearbeiten' : 'Ensemble eintragen', submit: e ? 'Änderungen speichern' : 'Ensemble speichern',
    required: [['name', 'Name des Ensembles'], ['lead', 'Leitung']],
    html: fieldsHtml([
      { name: 'name', label: 'Name des Ensembles', required: true, max: 100, placeholder: 'Wie heißt das Ensemble?' },
      { name: 'lead', label: 'Leitung (dein Name)', required: true, max: 100, placeholder: 'Name der Lehrkraft', attrs: 'autocomplete="name"' },
      { name: 'performers', label: 'Besetzung', max: 200, placeholder: 'Instrumente, Stimmen' },
      { name: 'headcount', label: 'Mitwirkende', max: 200, placeholder: 'Anzahl und Zusammensetzung' },
      { name: 'notes', label: 'Hinweise für die Planung', type: 'textarea', max: 1000, placeholder: 'Besondere Wünsche zu Technik, Aufbau oder Zeitpunkt im Programm' },
    ], { ...v, headcount: v.headcount ? String(v.headcount) : '' }) +
      `<div class="stuecke-kopf"><span>Stückvorschläge</span></div>
       <div id="stueckListe">${rows.map(pieceRow).join('')}</div>
       <button type="button" class="btn klein" data-action="add-piece">+ Stück hinzufügen</button>`,
    onSubmit: async (form) => {
      const f = formValues(form);
      const pieces = [...form.querySelectorAll('.stueck')].map((row) => ({
        id: Number(row.dataset.piece) || undefined,
        title: $('.p-title', row).value.trim(), composer: $('.p-composer', row).value.trim(),
        notes: $('.p-notes', row).value.trim(), duration_min: $('.p-dur', row).value.trim(),
        mood: $('.p-mood', row).value,
      })).filter((p) => p.title || p.composer || p.notes || p.duration_min);
      saveName(f.lead.trim());
      await save({
        action: 'save_ensemble', id: e ? e.id : undefined,
        data: { concert_id: state.vm.concert.id, name: f.name, lead: f.lead, performers: f.performers, headcount: f.headcount, notes: f.notes },
        pieces,
      });
      toast(e ? 'Änderungen gespeichert' : 'Ensemble eingetragen. Danke!');
    },
  });
}

function concertModal() {
  const c = state.vm.concert;
  openModal({
    title: 'Termin und Ort', required: [],
    html: fieldsHtml([
      [{ name: 'date', label: 'Datum', type: 'date' }, { name: 'start_time', label: 'Beginn', type: 'time' }, { name: 'end_time', label: 'Ende', type: 'time' }],
      { name: 'venue', label: 'Ort', max: 120, placeholder: 'Saal oder Spielstätte' },
      { name: 'description', label: 'Beschreibung', type: 'textarea', placeholder: 'Anlass, Ziel, Besonderheiten' },
    ], c),
    onSubmit: async (form) => {
      await save({ action: 'update', table: 'concerts', id: c.id, data: formValues(form) });
      toast('Gespeichert');
    },
  });
}

/* ---------- Aktionen ---------- */
const actions = {
  'close-modal': () => closeModal(),
  'add-ensemble': () => ensembleModal(null),
  'edit-ensemble': (el) => { const e = state.vm.ensembles.find((x) => x.id === Number(el.dataset.id)); if (e) ensembleModal(e); },
  'del-ensemble': async (el) => {
    const e = state.vm.ensembles.find((x) => x.id === Number(el.dataset.id));
    if (!e || !confirm(`Ensemble „${e.name}“ mit allen Stückvorschlägen löschen?`)) return;
    await save({ action: 'delete', table: 'ensembles', id: e.id }); toast('Ensemble gelöscht');
  },
  'add-piece': () => {
    const list = $('#stueckListe'); list.insertAdjacentHTML('beforeend', pieceRow());
    $('.p-title', list.lastElementChild).focus();
  },
  'remove-piece': (el) => {
    const list = $('#stueckListe'); el.closest('.stueck').remove();
    if (!list.children.length) list.insertAdjacentHTML('beforeend', pieceRow());
  },
  'edit-concert': () => concertModal(),
  'del-comment': async (el) => {
    if (!confirm('Kommentar löschen?')) return;
    await save({ action: 'delete', table: 'comments', id: Number(el.dataset.id) });
  },
  'set-view': (el) => { if (VIEWS[el.dataset.v]) { ui.view = el.dataset.v; saveUi(); refreshPieces(); } },
  'set-mood': (el) => { if (FILTERS[el.dataset.v]) { ui.mood = el.dataset.v; saveUi(); refreshPieces(); } },
  sort: (el) => {
    const k = el.dataset.key;
    if (ui.sortKey === k) { if (ui.sortDir > 0) ui.sortDir = -1; else { ui.sortKey = ''; ui.sortDir = 1; } } else { ui.sortKey = k; ui.sortDir = 1; }
    refreshPieces();
  },
  'reset-filter': () => { ui.mood = 'alle'; ui.q = ''; const s = $('#suche'); if (s) s.value = ''; saveUi(); refreshPieces(); },
};

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || !actions[el.dataset.action]) return;
  e.preventDefault();
  try { await actions[el.dataset.action](el, e); } catch (err) { toast(err.message); }
});

document.addEventListener('input', (e) => {
  if (e.target.id !== 'suche') return;
  ui.q = e.target.value;
  refreshPieces();
});

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'comment-form') return;
  e.preventDefault();
  const form = e.target, err = (m) => { $('.fehler', form).textContent = m; };
  const name = $('#comment-name').value.trim(), body = $('#comment-body').value.trim();
  if (!name) return err('Bitte deinen Namen eintragen.');
  if (!body) return err('Bitte einen Text eingeben.');
  const btn = $('button[type=submit]', form); btn.disabled = true; err('');
  try {
    saveName(name);
    await save({ action: 'insert', table: 'comments', data: { concert_id: state.vm.concert.id, author: name, body } });
    $('#comment-body').value = '';
  } catch (ex) { err(ex.message); btn.disabled = false; }
});

$('#sicherung').addEventListener('click', async () => {
  try {
    const d = await Store.load(true);
    const blob = new Blob([JSON.stringify({ exportiert_am: new Date().toISOString(), ...d }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `sommerkonzert-sicherung-${todayStr()}.json`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch (err) { toast(err.message); }
});

/* Andere Kolleginnen und Kollegen arbeiten gleichzeitig: regelmäßig nachladen, aber nie beim Tippen stören */
setInterval(async () => {
  if (!state.data || document.hidden || !$('#modal').hidden) return;
  const a = document.activeElement;
  if (a && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName) && a.type !== 'checkbox' && a.closest('#app')) return;
  try { await refresh(false); } catch { /* beim nächsten Mal wieder */ }
}, POLL_MS);

/* ---------- Himmel: Sterne und Crawl ---------- */
const reduziert = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const hero = $('#hero');

function sterneZeichnen() {
  const cv = $('#sterne'), ctx = cv.getContext('2d');
  let w = 0, h = 0, sterne = [], sternschnuppe = null, naechste = 4000;
  function groesse() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = hero.clientWidth; h = hero.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round(w * h / 4200);
    sterne = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.2 + .25, p: Math.random() * 6.28, s: Math.random() * .8 + .2 }));
  }
  function bild(t) {
    ctx.clearRect(0, 0, w, h);
    for (const s of sterne) {
      const a = .35 + .65 * (.5 + .5 * Math.sin(t / 1000 * s.s * 2 + s.p));
      ctx.globalAlpha = a; ctx.fillStyle = s.r > 1 ? '#fff4e0' : '#fff';
      const y = (((s.y - (t / 1000) * s.s * 1.5) % h) + h) % h; // Sterne treiben langsam nach oben
      ctx.beginPath(); ctx.arc(s.x, y, s.r, 0, 6.28); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (!sternschnuppe && t > naechste) { sternschnuppe = { x: Math.random() * w * .8 + w * .1, y: Math.random() * h * .35, t0: t }; naechste = t + 7000 + Math.random() * 8000; }
    if (sternschnuppe) {
      const k = (t - sternschnuppe.t0) / 900;
      if (k > 1) sternschnuppe = null;
      else {
        const x = sternschnuppe.x + k * 220, y = sternschnuppe.y + k * 110;
        const g = ctx.createLinearGradient(x, y, x - 90, y - 45); g.addColorStop(0, 'rgba(255,255,255,' + (1 - k) + ')'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = g; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 90, y - 45); ctx.stroke();
      }
    }
  }
  groesse(); bild(0);
  window.addEventListener('resize', () => { groesse(); bild(performance.now()); });
  if (!reduziert) (function lauf(t) { if (!document.hidden) bild(t); requestAnimationFrame(lauf); })(0);
}

/* ---------- Ton zum Intro ---------- */
// Das Intro startet mit dem Klick auf "Intro starten"; dieser Klick erlaubt dem Browser den Ton, die Musik läuft sofort mit.
// Der Knopf "Ton an/aus" schaltet sie während des Intros ein und aus.
const INTRO_AUDIO = (window.APP_CONFIG || {}).INTRO_AUDIO ?? 'audio/intro.m4a';
const LAUTSTAERKE = 0.7;
const audio = INTRO_AUDIO ? Object.assign(new Audio(INTRO_AUDIO), { preload: 'auto', volume: LAUTSTAERKE }) : null;
const tonBtn = $('#tonBtn');
let fadeTimer = null, introT0 = 0, tonVonHand = false;
const tonLabel = () => { tonBtn.textContent = audio && !audio.paused ? 'Ton aus' : 'Ton an'; };
function tonStart() {
  if (!audio) { tonBtn.hidden = true; return; }
  clearInterval(fadeTimer);
  audio.volume = LAUTSTAERKE;
  try { audio.currentTime = 0; } catch { /* noch nicht geladen */ }
  tonBtn.hidden = false; tonBtn.textContent = 'Ton an';
  const p = audio.play();
  if (p && p.then) p.then(tonLabel).catch((err) => {
    tonBtn.textContent = 'Ton an';
    if (err && err.name !== 'NotAllowedError' && err.name !== 'AbortError') toast('Der Ton konnte nicht abgespielt werden.');
  });
}
function tonStop(ausblenden) {
  if (!audio) return;
  clearInterval(fadeTimer);
  if (!ausblenden || audio.paused) { audio.pause(); tonLabel(); return; }
  fadeTimer = setInterval(() => {
    audio.volume = Math.max(0, audio.volume - 0.07);
    if (audio.volume <= 0.01) { clearInterval(fadeTimer); audio.pause(); audio.volume = LAUTSTAERKE; tonLabel(); }
  }, 100);
}
if (audio) audio.addEventListener('error', () => { tonBtn.textContent = 'Ton an'; toast('Die Musik konnte nicht geladen werden.'); });
// Musik zur laufenden Stelle des Intros dazuschalten (nach dem ersten Klick oder über "Ton an")
function tonSync() {
  if (!audio || !audio.paused || !hero.classList.contains('play')) return;
  const s = (performance.now() - introT0) / 1000;
  if (isFinite(audio.duration) && s >= audio.duration - 1) return;
  clearInterval(fadeTimer); audio.volume = LAUTSTAERKE;
  try { audio.currentTime = s; } catch { /* noch nicht geladen */ }
  const p = audio.play();
  if (p && p.then) p.then(tonLabel).catch(() => { /* weiterhin gesperrt */ });
}
['pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, (e) => {
  if (tonVonHand || !hero.classList.contains('play')) return;
  if (e.target.closest && e.target.closest('#tonBtn, #introSkip')) return;
  tonSync();
}, { passive: true }));
tonBtn.addEventListener('click', () => {
  if (audio && !audio.paused) { tonVonHand = true; tonStop(false); } // stumm schalten, bleibt stumm
  else if (hero.classList.contains('play')) { tonVonHand = false; tonSync(); }
  else introStart();
});

function introStart() {
  const crawl = $('#crawl'), wrap = crawl.parentElement;
  hero.classList.remove('done', 'wait'); hero.classList.add('play'); introT0 = performance.now(); tonVonHand = false;
  crawl.style.animation = 'none'; void crawl.offsetWidth; crawl.style.animation = '';
  const von = wrap.clientHeight, bis = -crawl.scrollHeight - 40;
  crawl.style.setProperty('--from', von + 'px'); crawl.style.setProperty('--to', bis + 'px');
  crawl.style.setProperty('--dur', Math.round((von - bis) / 34) + 's'); // ca. 34 px pro Sekunde
  $('#introSkip').hidden = false; $('#introReplay').hidden = true;
  tonStart();
}
function introEnde() {
  hero.classList.remove('play'); hero.classList.add('done');
  $('#introSkip').hidden = true; $('#introReplay').hidden = false; $('#introReplay').textContent = 'Intro wiederholen';
  tonStop(true); tonBtn.hidden = true;
}
$('#crawl').addEventListener('animationend', introEnde);
$('#introSkip').addEventListener('click', introEnde);
$('#introReplay').addEventListener('click', introStart);
$('#zumFormular').addEventListener('click', () => {
  if (!state.vm) { toast('Die Planung lädt noch. Einen Moment bitte.'); return; }
  $('#app').scrollIntoView({ behavior: 'smooth', block: 'start' });
  ensembleModal(null);
});

sterneZeichnen();
// Das Intro startet erst auf Klick ("Intro starten"). Nur ein Klick erlaubt dem Browser, die Musik gleich mitlaufen zu lassen.

/* ---------- Start ---------- */
(async () => {
  try {
    applyData(await Store.load(false), true);
  } catch (err) {
    $('#app').innerHTML = `<div class="leer">${esc(err.message)}<p><button class="btn" onclick="location.reload()">Erneut versuchen</button></p></div>`;
  }
})();
