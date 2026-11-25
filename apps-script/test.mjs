// Testet die Logik aus Code.gs lokal mit einem Speicher im Arbeitsspeicher.
// Aufruf: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const code = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'Code.gs'), 'utf8');
const ctx = vm.createContext({ console });
vm.runInContext(code, ctx);
const { handleSafe_ } = ctx;

function memStore() {
  const t = {}; let rev = 0;
  const tab = (n) => (t[n] ||= []);
  return {
    all: (n) => tab(n).map((r) => ({ ...r })),
    find: (n, id) => tab(n).find((r) => r.id === Number(id)) || null,
    nextId: (n) => tab(n).reduce((m, r) => Math.max(m, r.id), 0) + 1,
    insert: (n, rec) => tab(n).push({ ...rec }),
    update: (n, id, rec) => { const i = tab(n).findIndex((r) => r.id === Number(id)); tab(n)[i] = { ...rec }; },
    rev: () => String(rev), bump: () => { rev++; },
  };
}
const call = (s, req) => handleSafe_(s, req);
const live = (rows) => rows.filter((r) => !r.deleted_at);
function start() { const s = memStore(); call(s, { action: 'init' }); return s; }

test('init legt genau ein Konzert an, auch bei mehrfachem Aufruf', () => {
  const s = memStore();
  const r = call(s, { action: 'init' });
  assert.equal(r.ok, true);
  assert.equal(r.snapshot.concerts.length, 1);
  assert.equal(r.snapshot.concerts[0].title, 'Sommerkonzert 2026/2027');
  assert.equal(r.snapshot.concerts[0].time_frame_min, 0, 'kein Zeitrahmen vorgegeben');
  assert.equal(r.snapshot.concerts[0].date, '');
  const again = call(s, { action: 'init' });
  assert.equal(again.concerts.length, 1);
});

test('Eckdaten des Konzerts ändern, Konzert nicht löschbar oder neu anlegbar', () => {
  const s = start();
  assert.equal(call(s, { action: 'update', table: 'concerts', id: 1, data: { date: '2027-06-26', venue: 'Kleiner Saal', time_frame_min: '90' } }).ok, true);
  const c = call(s, { action: 'all' }).concerts[0];
  assert.equal(c.date, '2027-06-26'); assert.equal(c.venue, 'Kleiner Saal'); assert.equal(c.time_frame_min, 90);
  assert.equal(call(s, { action: 'update', table: 'concerts', id: 1, data: { date: '2027-02-30' } }).ok, false);
  assert.equal(call(s, { action: 'delete', table: 'concerts', id: 1 }).ok, false);
  assert.equal(call(s, { action: 'insert', table: 'concerts', data: { title: 'x' } }).ok, false);
});

test('Ensemble mit Stücken speichern, ändern, Stücke entfernen, löschen (nur weich)', () => {
  const s = start();
  const r = call(s, { action: 'save_ensemble', data: { concert_id: 1, name: ' Kammerchor ', lead: 'Frau Muster', headcount: '24' },
    pieces: [{ title: 'Ave verum', composer: 'Mozart', duration_min: '3,5' }, { title: 'Abendlied', duration_min: '4' }] });
  assert.equal(r.ok, true);
  assert.equal(r.snapshot.ensembles[0].name, 'Kammerchor');
  assert.equal(r.snapshot.ensembles[0].headcount, '24');
  let pieces = live(r.snapshot.pieces);
  assert.deepEqual(pieces.map((p) => [p.title, p.position, p.duration_min, p.ensemble_id, p.concert_id]), [['Ave verum', 1, 3.5, 1, 1], ['Abendlied', 2, 4, 1, 1]]);

  // ändern: erstes Stück umbenennen, zweites entfernen, neues dazu
  const idA = pieces[0].id;
  const r2 = call(s, { action: 'save_ensemble', id: 1, data: { concert_id: 1, name: 'Kammerchor', lead: 'Frau Muster' },
    pieces: [{ id: idA, title: 'Ave verum corpus' }, { title: 'Neu' }] });
  assert.equal(r2.ok, true);
  pieces = live(r2.snapshot.pieces);
  assert.deepEqual(pieces.map((p) => [p.title, p.position]), [['Ave verum corpus', 1], ['Neu', 2]]);
  assert.equal(r2.snapshot.pieces.length, 3, 'entferntes Stück bleibt als gelöscht erhalten');
  assert.equal(live(r2.snapshot.ensembles).length, 1, 'kein zweites Ensemble entstanden');

  const r3 = call(s, { action: 'delete', table: 'ensembles', id: 1 });
  assert.equal(r3.ok, true);
  assert.equal(live(r3.snapshot.ensembles).length, 0);
  assert.equal(r3.snapshot.ensembles.length, 1, 'Zeile bleibt erhalten');
  assert.equal(call(s, { action: 'save_ensemble', id: 1, data: { concert_id: 1, name: 'x', lead: 'y' }, pieces: [] }).ok, false);
});

test('Prüfungen beim Ensemble (nichts wird halb gespeichert)', () => {
  const s = start();
  assert.match(call(s, { action: 'save_ensemble', data: { concert_id: 1, name: '', lead: 'A' }, pieces: [] }).error, /Name des Ensembles fehlt/);
  assert.match(call(s, { action: 'save_ensemble', data: { concert_id: 1, name: 'E', lead: '' }, pieces: [] }).error, /Leitung fehlt/);
  const bad = call(s, { action: 'save_ensemble', data: { concert_id: 1, name: 'E', lead: 'A' }, pieces: [{ title: 'ok' }, { title: '' }] });
  assert.match(bad.error, /Stück fehlt/);
  assert.equal(call(s, { action: 'all' }).ensembles.length, 0, 'ungültige Stückliste speichert auch das Ensemble nicht');
  assert.match(call(s, { action: 'save_ensemble', data: { concert_id: 99, name: 'E', lead: 'A' }, pieces: [] }).error, /Konzert nicht gefunden/);
  assert.equal(call(s, { action: 'save_ensemble', data: { concert_id: 1, name: 'E', lead: 'A' }, pieces: [{ title: 'x', duration_min: '999' }] }).ok, false);
});

test('Stücke lassen sich nicht einzeln anlegen oder verschieben', () => {
  const s = start();
  assert.equal(call(s, { action: 'insert', table: 'pieces', data: { concert_id: 1, ensemble_id: 1, title: 'x' } }).ok, false);
  call(s, { action: 'save_ensemble', data: { concert_id: 1, name: 'A', lead: 'B' }, pieces: [{ title: 'X' }] });
  call(s, { action: 'save_ensemble', data: { concert_id: 1, name: 'C', lead: 'D' }, pieces: [] });
  // Ensemble 2 versucht, das Stück von Ensemble 1 zu übernehmen -> wird dort nicht angefasst, sondern neu angelegt
  const stuck = call(s, { action: 'all' }).pieces[0];
  const r = call(s, { action: 'save_ensemble', id: 2, data: { concert_id: 1, name: 'C', lead: 'D' }, pieces: [{ id: stuck.id, title: 'Geklaut' }] });
  assert.equal(r.ok, true);
  const first = r.snapshot.pieces.find((p) => p.id === stuck.id);
  assert.equal(first.title, 'X'); assert.equal(first.ensemble_id, 1);
});

test('Aufgaben und Kommentare', () => {
  const s = start();
  const t = call(s, { action: 'insert', table: 'tasks', data: { concert_id: 1, title: 'Plakat', assignee: 'Anna', due_date: '2027-05-01' } });
  assert.equal(t.ok, true);
  assert.equal(call(s, { action: 'update', table: 'tasks', id: t.id, data: { done: true } }).snapshot.tasks[0].done, true);
  assert.equal(call(s, { action: 'insert', table: 'tasks', data: { concert_id: 1, title: '' } }).ok, false);
  assert.equal(call(s, { action: 'insert', table: 'tasks', data: { concert_id: 7, title: 'x' } }).ok, false);
  const c = call(s, { action: 'insert', table: 'comments', data: { concert_id: 1, author: 'Anna', body: 'Hallo <b>x</b>' } });
  assert.equal(c.snapshot.comments[0].body, 'Hallo <b>x</b>');
  assert.match(call(s, { action: 'insert', table: 'comments', data: { concert_id: 1, author: '', body: 'x' } }).error, /Name fehlt/);
  assert.equal(call(s, { action: 'delete', table: 'comments', id: c.id }).snapshot.comments[0].deleted_at !== '', true);
  assert.equal(call(s, { action: 'update', table: 'comments', id: c.id, data: { body: 'neu' } }).ok, false);
  assert.equal(call(s, { action: 'boese' }).ok, false);
});

test('Versionsnummer steigt nur bei Änderungen, Zuletzt-geändert wird gepflegt', async () => {
  const s = start();
  const before = call(s, { action: 'rev' }).rev;
  assert.equal(call(s, { action: 'all' }).rev, before);
  const u0 = s.find('concerts', 1).updated_at;
  await new Promise((r) => setTimeout(r, 5));
  call(s, { action: 'insert', table: 'comments', data: { concert_id: 1, author: 'A', body: 'x' } });
  assert.notEqual(call(s, { action: 'rev' }).rev, before);
  assert.notEqual(s.find('concerts', 1).updated_at, u0);
});

test('Mitwirkende ist ein freies Textfeld', () => {
  const s = start();
  const r = call(s, { action: 'save_ensemble', data: { concert_id: 1, name: 'Orchester', lead: 'Herr Test', headcount: ' ca. 40, überwiegend Klassen 5 bis 8 ' }, pieces: [] });
  assert.equal(r.ok, true);
  assert.equal(r.snapshot.ensembles[0].headcount, 'ca. 40, überwiegend Klassen 5 bis 8');
  assert.equal(call(s, { action: 'save_ensemble', data: { concert_id: 1, name: 'X', lead: 'Y', headcount: 'x'.repeat(201) }, pieces: [] }).ok, false);
  assert.equal(call(s, { action: 'save_ensemble', id: 1, data: { concert_id: 1, name: 'Orchester', lead: 'Herr Test' }, pieces: [] }).snapshot.ensembles[0].headcount, '', 'leer lassen ist erlaubt');
});

test('Zuordnung Nacht/Licht ist optional und wird geprüft', () => {
  const s = start();
  const r = call(s, { action: 'save_ensemble', data: { concert_id: 1, name: 'A', lead: 'B' },
    pieces: [{ title: 'Eins', mood: 'nacht' }, { title: 'Zwei', mood: 'licht' }, { title: 'Drei', mood: 'beides' }, { title: 'Vier' }, { title: 'Fünf', mood: '' }] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.snapshot.pieces.map((p) => p.mood), ['nacht', 'licht', 'beides', '', '']);
  assert.match(call(s, { action: 'save_ensemble', data: { concert_id: 1, name: 'A', lead: 'B' }, pieces: [{ title: 'x', mood: 'dunkel' }] }).error, /Zuordnung ist ungültig/);
  // ändern: Zuordnung wechseln und entfernen
  const ids = r.snapshot.pieces.map((p) => p.id);
  const r2 = call(s, { action: 'save_ensemble', id: 1, data: { concert_id: 1, name: 'A', lead: 'B' }, pieces: [{ id: ids[0], title: 'Eins', mood: 'licht' }, { id: ids[1], title: 'Zwei', mood: '' }] });
  assert.deepEqual(live(r2.snapshot.pieces).map((p) => p.mood), ['licht', '']);
});

// ---- Blatt-Speicher mit einer Attrappe von Google Sheets (prüft die Spalten-Zuordnung) ----
function fakeGoogle(sheetsInit = {}) {
  const sheets = {};
  const mkSheet = (rows) => {
    const grid = rows.map((r) => [...r]);
    const get = (r, c) => (grid[r - 1] && grid[r - 1][c - 1] !== undefined ? grid[r - 1][c - 1] : '');
    const set = (r, c, v) => { while (grid.length < r) grid.push([]); while (grid[r - 1].length < c - 1) grid[r - 1].push(''); grid[r - 1][c - 1] = v; };
    const range = (r, c, nr = 1, nc = 1) => ({
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => get(r + i, c + j))),
      setValues: (vals) => { vals.forEach((row, i) => row.forEach((v, j) => set(r + i, c + j, v))); return range(r, c, nr, nc); },
      setValue: (v) => { set(r, c, v); return range(r, c, nr, nc); },
      setNumberFormat: () => range(r, c, nr, nc), setFontWeight: () => range(r, c, nr, nc),
    });
    return {
      grid, getRange: range,
      getLastRow: () => { let n = 0; grid.forEach((row, i) => { if (row.some((v) => v !== '' && v != null)) n = i + 1; }); return n; },
      getLastColumn: () => grid.reduce((m, row) => { let k = 0; row.forEach((v, j) => { if (v !== '' && v != null) k = j + 1; }); return Math.max(m, k); }, 0),
      getMaxRows: () => 1000, getMaxColumns: () => 26, insertColumnAfter: () => {}, setFrozenRows: () => {},
    };
  };
  Object.entries(sheetsInit).forEach(([n, rows]) => { sheets[n] = mkSheet(rows); });
  const props = {};
  const c2 = vm.createContext({
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSpreadsheetTimeZone: () => 'Europe/Berlin', getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = mkSheet([])) }) },
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
  });
  vm.runInContext(code, c2);
  return { ctx: c2, sheets };
}

test('Blatt-Speicher: neue Spalte "mood" wird hinten ergänzt, alte Daten bleiben richtig zugeordnet', () => {
  // Blatt "Stuecke" so, wie es vor dem Update aussah (ohne mood), mit einer Zeile Daten
  const oldHeader = ['id', 'concert_id', 'ensemble_id', 'position', 'title', 'composer', 'duration_min', 'notes', 'created_at', 'updated_at', 'deleted_at'];
  const oldRow = [1, 1, 1, 1, 'Altes Stück', 'Bach', 3.5, 'a cappella', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', ''];
  const { ctx: c2, sheets } = fakeGoogle({
    Stuecke: [oldHeader, oldRow],
    Konzerte: [['id', 'title', 'date', 'start_time', 'end_time', 'venue', 'status', 'description', 'time_frame_min', 'created_by', 'created_at', 'updated_at', 'deleted_at'],
      [1, 'Sommerkonzert 2026/2027', '', '', '', '', 'geplant', '', 0, '', 'x', 'x', '']],
    Ensembles: [['id', 'concert_id', 'name', 'lead', 'performers', 'headcount', 'notes', 'created_at', 'updated_at', 'deleted_at'], [1, 1, 'Chor', 'Frau A', '', '', '', 'x', 'x', '']],
  });
  const store = c2.makeSheetStore();
  const alt = store.all('pieces');
  assert.equal(alt.length, 1);
  assert.equal(alt[0].title, 'Altes Stück'); assert.equal(alt[0].composer, 'Bach'); assert.equal(alt[0].duration_min, 3.5); assert.equal(alt[0].mood, '');
  assert.equal(sheets.Stuecke.grid[0][11], 'mood', 'neue Spalte steht hinten in der Kopfzeile');

  const r = c2.handleSafe_(store, { action: 'save_ensemble', id: 1, data: { concert_id: 1, name: 'Chor', lead: 'Frau A' },
    pieces: [{ id: 1, title: 'Altes Stück', composer: 'Bach', duration_min: '3,5', notes: 'a cappella', mood: 'nacht' }, { title: 'Neues Stück', mood: 'licht' }] });
  assert.equal(r.ok, true, r.error);
  const grid = sheets.Stuecke.grid;
  assert.deepEqual(grid[1].slice(0, 8).map(String), ['1', '1', '1', '1', 'Altes Stück', 'Bach', '3.5', 'a cappella'], 'alte Spalten unverändert');
  assert.equal(grid[1][11], 'nacht'); assert.equal(grid[2][4], 'Neues Stück'); assert.equal(grid[2][11], 'licht');
  // frischer Zugriff liest alles richtig zurück
  const neu = c2.makeSheetStore().all('pieces');
  assert.deepEqual(JSON.parse(JSON.stringify(neu.map((p) => [p.title, p.mood]))), [['Altes Stück', 'nacht'], ['Neues Stück', 'licht']]);
});

test('Blatt-Speicher: frisches Blatt, Konzert anlegen, Ensemble speichern', () => {
  const { ctx: c2, sheets } = fakeGoogle();
  const store = () => c2.makeSheetStore();
  assert.equal(c2.handleSafe_(store(), { action: 'init' }).ok, true);
  assert.equal(c2.handleSafe_(store(), { action: 'init' }).concerts.length, 1);
  const r = c2.handleSafe_(store(), { action: 'save_ensemble', data: { concert_id: 1, name: 'Orchester', lead: 'Herr B', headcount: 'ca. 40' }, pieces: [{ title: 'S1', mood: 'beides', duration_min: '5' }] });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(sheets.Stuecke.grid[0].slice(0, 5), ['id', 'concert_id', 'ensemble_id', 'position', 'title']);
  assert.equal(c2.handleSafe_(store(), { action: 'all' }).pieces[0].mood, 'beides');
  assert.equal(c2.handleSafe_(store(), { action: 'all' }).ensembles[0].headcount, 'ca. 40');
});
