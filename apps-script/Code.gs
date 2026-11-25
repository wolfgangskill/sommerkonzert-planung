/**
 * SLGM Konzertplanung – gemeinsamer Speicher in einer Google-Tabelle.
 *
 * Einrichtung: siehe README.md, Abschnitt „Speicher einrichten“.
 * Das Skript gehört in eine Google-Tabelle (Erweiterungen → Apps Script) und wird als
 * Web-App bereitgestellt. Jede Tabelle der App wird ein eigenes Blatt (Konzerte, Ensembles,
 * Stuecke, Aufgaben, Kommentare). Zeilen werden nie gelöscht, "Löschen" in der App füllt
 * nur die Spalte "deleted_at". Wiederherstellen: Spalte leeren.
 *
 * Die Logik (handle, cleanFields …) kennt keine Google-Klassen und ist deshalb lokal
 * testbar (apps-script/test.mjs). Nur makeSheetStore, doGet und doPost sprechen mit Google.
 */

var CONCERT_REF = { table: 'concerts', msg: 'Konzert nicht gefunden.' };
var ENSEMBLE_REF = { table: 'ensembles', msg: 'Ensemble nicht gefunden (vielleicht wurde es gelöscht).' };

// ops: welche einfachen Aktionen (insert/update/delete) für die Tabelle erlaubt sind.
// Ensembles und Stücke werden zusammen über "save_ensemble" geschrieben.
var TABLES = {
  concerts: {
    sheet: 'Konzerte', ops: ['update'],
    fields: {
      title:          { t: 's', max: 120, req: true, label: 'Titel' },
      date:           { t: 'd', label: 'Datum' },
      start_time:     { t: 'tm', label: 'Beginn' },
      end_time:       { t: 'tm', label: 'Ende' },
      venue:          { t: 's', max: 120, label: 'Ort' },
      status:         { t: 's', oneOf: ['idee', 'geplant', 'bestaetigt', 'durchgefuehrt', 'abgesagt'], def: 'geplant', label: 'Status' },
      description:    { t: 's', max: 4000, label: 'Beschreibung' },
      time_frame_min: { t: 'i', max: 1000, label: 'Zeitrahmen' },
      created_by:     { t: 's', max: 100, label: 'Angelegt von' }
    }
  },
  ensembles: {
    sheet: 'Ensembles', ops: ['delete'], parent: 'concert_id', refs: { concert_id: CONCERT_REF },
    fields: {
      concert_id: { t: 'i', req: true, label: 'Konzert' },
      name:       { t: 's', max: 100, req: true, label: 'Name des Ensembles' },
      lead:       { t: 's', max: 100, req: true, label: 'Leitung' },
      performers: { t: 's', max: 200, label: 'Besetzung' },
      headcount:  { t: 's', max: 200, label: 'Mitwirkende' }, // freier Text (Anzahl und Zusammensetzung)
      notes:      { t: 's', max: 1000, label: 'Hinweise' }
    }
  },
  pieces: {
    sheet: 'Stuecke', ops: [], parent: 'concert_id', refs: { concert_id: CONCERT_REF, ensemble_id: ENSEMBLE_REF },
    fields: {
      concert_id:   { t: 'i', req: true, label: 'Konzert' },
      ensemble_id:  { t: 'i', req: true, label: 'Ensemble' },
      position:     { t: 'i', max: 100000, label: 'Position' },
      title:        { t: 's', max: 160, req: true, label: 'Stück' },
      composer:     { t: 's', max: 160, label: 'Komponist/Arrangeur' },
      duration_min: { t: 'n', max: 240, label: 'Dauer' },
      notes:        { t: 's', max: 500, label: 'Bemerkung' },
      mood:         { t: 's', oneOf: ['', 'nacht', 'licht', 'beides'], label: 'Zuordnung' } // optional: Nacht/Mühsal, Licht/Sterne oder beides
    }
  },
  tasks: {
    sheet: 'Aufgaben', ops: ['insert', 'update', 'delete'], parent: 'concert_id', refs: { concert_id: CONCERT_REF },
    fields: {
      concert_id: { t: 'i', req: true, label: 'Konzert' },
      title:      { t: 's', max: 200, req: true, label: 'Aufgabe' },
      assignee:   { t: 's', max: 100, label: 'Zuständig' },
      due_date:   { t: 'd', label: 'Frist' },
      done:       { t: 'b', label: 'Erledigt' }
    }
  },
  comments: {
    sheet: 'Kommentare', ops: ['insert', 'delete'], parent: 'concert_id', refs: { concert_id: CONCERT_REF },
    fields: {
      concert_id: { t: 'i', req: true, label: 'Konzert' },
      author:     { t: 's', max: 100, req: true, label: 'Name' },
      body:       { t: 's', max: 4000, req: true, label: 'Kommentar' }
    }
  }
};

function fail_(msg) { throw new Error(msg); }
function pad2_(n) { return (n < 10 ? '0' : '') + n; }

/* ---------- Prüfen und Umwandeln (streng beim Schreiben) ---------- */
function coerceStrict_(spec, v) {
  var s;
  switch (spec.t) {
    case 's':
      s = (v === null || v === undefined) ? '' : String(v).trim();
      if (spec.req && !s) fail_(spec.label + ' fehlt.');
      if (spec.max && s.length > spec.max) fail_(spec.label + ' ist zu lang (höchstens ' + spec.max + ' Zeichen).');
      if (spec.oneOf && spec.oneOf.indexOf(s) < 0) fail_(spec.label + ' ist ungültig.');
      return s;
    case 'd':
      s = (v === null || v === undefined) ? '' : String(v).trim();
      if (!s) { if (spec.req) fail_(spec.label + ' fehlt.'); return ''; }
      var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
      var d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
      if (!d || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) fail_(spec.label + ' ist ungültig.');
      return s;
    case 'tm':
      s = (v === null || v === undefined) ? '' : String(v).trim();
      if (s && !/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) fail_(spec.label + ' ist ungültig.');
      return s;
    case 'i':
    case 'n':
      if (v === '' || v === null || v === undefined) { if (spec.req) fail_(spec.label + ' fehlt.'); return 0; }
      var n = Number(String(v).replace(',', '.'));
      if (!isFinite(n) || n < 0 || (spec.max && n > spec.max)) fail_(spec.label + ' ist ungültig.');
      return spec.t === 'i' ? Math.round(n) : n;
    case 'b':
      return v === true || /^(true|ja|1)$/i.test(String(v));
  }
  fail_('Unbekannter Feldtyp.');
}

function zero_(spec) {
  if (spec.def !== undefined) return spec.def;
  return spec.t === 'i' || spec.t === 'n' ? 0 : spec.t === 'b' ? false : '';
}

function cleanFields_(table, data, partial) {
  var fields = TABLES[table].fields, out = {};
  Object.keys(fields).forEach(function (k) {
    var has = Object.prototype.hasOwnProperty.call(data, k);
    if (partial && !has) return;
    var spec = fields[k];
    out[k] = (has || spec.req) ? coerceStrict_(spec, data[k]) : zero_(spec);
  });
  return out;
}

/* ---------- Lesen (nachsichtig, Tabelle darf von Hand bearbeitet werden) ---------- */
function normalize_(table, raw) {
  var fields = TABLES[table].fields, rec = { id: Number(raw.id) };
  Object.keys(fields).forEach(function (k) {
    var t = fields[k].t, v = raw[k];
    if (v === null || v === undefined) v = '';
    if (t === 'i') rec[k] = Math.round(Number(v)) || 0;
    else if (t === 'n') rec[k] = Number(v) || 0;
    else if (t === 'b') rec[k] = v === true || /^(true|ja|1)$/i.test(String(v));
    else rec[k] = String(v);
  });
  ['created_at', 'updated_at', 'deleted_at'].forEach(function (k) { rec[k] = raw[k] ? String(raw[k]) : ''; });
  return rec;
}

/* ---------- Aktionen ---------- */
function snapshot_(store) {
  var out = { ok: true, rev: store.rev() };
  Object.keys(TABLES).forEach(function (t) { out[t] = store.all(t); });
  return out;
}

function handle(store, req) {
  var a = req.action;
  if (a === 'rev') return { ok: true, rev: store.rev() };
  if (a === 'all') return snapshot_(store);

  var now = new Date().toISOString();
  var table = req.table, spec = TABLES[table];

  function live(t, id, msg) {
    var r = store.find(t, id);
    if (!r || r.deleted_at) fail_(msg);
    return r;
  }
  function touchConcert(id) {
    var c = store.find('concerts', id);
    if (c) { c.updated_at = now; store.update('concerts', c.id, c); }
  }
  function checkRefs(t, data) {
    var refs = TABLES[t].refs || {};
    Object.keys(refs).forEach(function (k) { live(refs[k].table, data[k], refs[k].msg); });
  }
  function insertRow(t, data) {
    checkRefs(t, data);
    var rec = Object.assign({ id: store.nextId(t) }, data, { created_at: now, updated_at: now, deleted_at: '' });
    store.insert(t, rec);
    return rec;
  }
  function allowed(op) {
    if (!spec || spec.ops.indexOf(op) < 0) fail_('Diese Aktion ist nicht erlaubt.');
  }

  var res;
  if (a === 'init') {
    // legt das eine Konzert an, falls es noch fehlt (läuft unter Sperre, doppelt anlegen ist ausgeschlossen)
    var has = store.all('concerts').filter(function (c) { return !c.deleted_at; }).length > 0;
    if (!has) {
      var c = cleanFields_('concerts', { title: req.title || 'Sommerkonzert 2026/2027', time_frame_min: req.time_frame_min || 0 }, false);
      insertRow('concerts', c);
    } else {
      return snapshot_(store);
    }
    res = { ok: true };

  } else if (a === 'insert') {
    allowed('insert');
    var rec = insertRow(table, cleanFields_(table, req.data || {}, false));
    touchConcert(rec.concert_id);
    res = { ok: true, id: rec.id };

  } else if (a === 'update' || a === 'delete') {
    allowed(a);
    var cur = live(table, Number(req.id), 'Eintrag nicht gefunden (vielleicht wurde er gelöscht).');
    var next;
    if (a === 'update') {
      var upd = cleanFields_(table, req.data || {}, true);
      delete upd.concert_id; delete upd.ensemble_id; // Zuordnungen bleiben fest
      next = Object.assign({}, cur, upd, { updated_at: now });
    } else {
      next = Object.assign({}, cur, { updated_at: now, deleted_at: now });
    }
    store.update(table, cur.id, next);
    if (table === 'concerts') { /* nichts weiter */ } else touchConcert(next.concert_id);
    res = { ok: true, id: cur.id };

  } else if (a === 'save_ensemble') {
    // Ensemble samt Stückliste in einem Schritt speichern (neu oder ändern)
    var ens = cleanFields_('ensembles', req.data || {}, false);
    checkRefs('ensembles', ens);
    var submitted = (req.pieces || []).map(function (p) {
      var d = cleanFields_('pieces', Object.assign({}, p, { concert_id: ens.concert_id, ensemble_id: 1 }), false);
      return { id: Number(p.id) || 0, data: d };
    });
    var eid;
    if (req.id) {
      var old = live('ensembles', Number(req.id), ENSEMBLE_REF.msg);
      eid = old.id;
      delete ens.concert_id;
      store.update('ensembles', eid, Object.assign({}, old, ens, { updated_at: now }));
    } else {
      eid = insertRow('ensembles', ens).id;
    }
    var existing = store.all('pieces').filter(function (p) { return p.ensemble_id === eid && !p.deleted_at; });
    var keep = {};
    submitted.forEach(function (sp, i) {
      var cur2 = null;
      existing.forEach(function (e) { if (e.id === sp.id) cur2 = e; });
      sp.data.ensemble_id = eid;
      sp.data.position = i + 1;
      if (cur2) {
        keep[cur2.id] = true;
        delete sp.data.concert_id;
        store.update('pieces', cur2.id, Object.assign({}, cur2, sp.data, { updated_at: now }));
      } else {
        sp.data.concert_id = store.find('ensembles', eid).concert_id;
        insertRow('pieces', sp.data);
      }
    });
    existing.forEach(function (e) {
      if (!keep[e.id]) store.update('pieces', e.id, Object.assign({}, e, { updated_at: now, deleted_at: now }));
    });
    touchConcert(store.find('ensembles', eid).concert_id);
    res = { ok: true, id: eid };

  } else {
    fail_('Unbekannte Aktion.');
  }
  store.bump();
  res.snapshot = snapshot_(store); // spart dem Browser den zweiten Aufruf
  return res;
}

function handleSafe_(store, req) {
  try { return handle(store, req); }
  catch (err) { return { ok: false, error: String(err && err.message ? err.message : err) }; }
}

/* ---------- Google-Tabelle als Speicher ---------- */
function columns_(table) {
  return ['id'].concat(Object.keys(TABLES[table].fields), ['created_at', 'updated_at', 'deleted_at']);
}

function makeSheetStore() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();
  var cache = {}, headerCache = {};

  function sheetFor(table) {
    var name = TABLES[table].sheet, sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      var cols = columns_(table);
      sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@'); // alles als Text: kein Datums-/Formel-Umbau
      sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    return sh;
  }
  // Die Spaltenreihenfolge kommt aus der Kopfzeile des Blatts. Neue Spalten (nach einem Update des Skripts)
  // werden hinten ergänzt, bestehende Daten bleiben dadurch unverändert und richtig zugeordnet.
  function headers_(table, sh) {
    if (headerCache[table]) return headerCache[table];
    var last = sh.getLastColumn();
    var have = last > 0 ? sh.getRange(1, 1, 1, last).getValues()[0].map(function (h) { return String(h); }) : [];
    columns_(table).forEach(function (c) {
      if (have.indexOf(c) >= 0) return;
      have.push(c);
      while (have.length > sh.getMaxColumns()) sh.insertColumnAfter(sh.getMaxColumns());
      sh.getRange(1, have.length, sh.getMaxRows(), 1).setNumberFormat('@');
      sh.getRange(1, have.length).setValue(c).setFontWeight('bold');
    });
    return (headerCache[table] = have);
  }
  function cell_(v) {
    if (Object.prototype.toString.call(v) === '[object Date]') {
      // falls jemand ein Feld von Hand als Datum formatiert hat
      return Utilities.formatDate(v, tz, v.getFullYear() < 1950 ? 'HH:mm' : 'yyyy-MM-dd');
    }
    return v;
  }
  function load(table) {
    if (cache[table]) return cache[table];
    var sh = sheetFor(table), cols = headers_(table, sh), n = sh.getLastRow() - 1, rows = [];
    if (n > 0) {
      sh.getRange(2, 1, n, cols.length).getValues().forEach(function (r, i) {
        var raw = {};
        cols.forEach(function (c, j) { raw[c] = cell_(r[j]); });
        if (raw.id === '' || raw.id === null) return; // leere Zeile
        rows.push({ row: i + 2, rec: normalize_(table, raw) });
      });
    }
    return (cache[table] = rows);
  }
  function toRow(cols, rec) {
    return cols.map(function (c) {
      var v = rec[c];
      if (typeof v === 'boolean') return v ? 'ja' : 'nein';
      return v === undefined || v === null ? '' : v;
    });
  }
  function write(table, rowNo, rec) {
    var sh = sheetFor(table), cols = headers_(table, sh), range = sh.getRange(rowNo, 1, 1, cols.length);
    range.setNumberFormat('@');
    range.setValues([toRow(cols, rec)]);
  }
  function entry(table, id) {
    var rows = load(table);
    for (var i = 0; i < rows.length; i++) if (rows[i].rec.id === id) return rows[i];
    return null;
  }

  return {
    all: function (t) { return load(t).map(function (x) { return x.rec; }); },
    find: function (t, id) { var e = entry(t, Number(id)); return e ? e.rec : null; },
    nextId: function (t) { return load(t).reduce(function (m, x) { return Math.max(m, x.rec.id); }, 0) + 1; },
    insert: function (t, rec) {
      var rows = load(t), sh = sheetFor(t), rowNo = Math.max(sh.getLastRow(), 1) + 1;
      write(t, rowNo, rec);
      rows.push({ row: rowNo, rec: normalize_(t, rec) });
    },
    update: function (t, id, rec) {
      var e = entry(t, Number(id));
      if (!e) fail_('Eintrag nicht gefunden.');
      write(t, e.row, rec);
      e.rec = normalize_(t, rec);
    },
    rev: function () { return PropertiesService.getScriptProperties().getProperty('rev') || '0'; },
    bump: function () {
      var p = PropertiesService.getScriptProperties();
      p.setProperty('rev', String((Number(p.getProperty('rev')) || 0) + 1));
    }
  };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Lesen: ?action=rev (nur Versionsnummer) oder ?action=all (alle Daten)
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'all';
  if (action !== 'rev' && action !== 'all') return json_({ ok: false, error: 'Unbekannte Aktion.' });
  return json_(handleSafe_(makeSheetStore(), { action: action }));
}

// Schreiben: nacheinander, damit sich gleichzeitige Eingaben nicht überschreiben
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var req = JSON.parse(e.postData.contents);
    return json_(handleSafe_(makeSheetStore(), req));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    try { lock.releaseLock(); } catch (x) { /* nicht gesperrt */ }
  }
}

// Einmal von Hand ausführen (Apps-Script-Editor), legt alle Blätter an und fragt die Berechtigungen ab
function einrichten() {
  var store = makeSheetStore();
  Object.keys(TABLES).forEach(function (t) { store.all(t); });
}
