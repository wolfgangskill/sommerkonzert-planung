'use strict';
/* Datenzugriff auf den gemeinsamen Speicher (Google-Apps-Script, apps-script/Code.gs).
   Gelesen wird immer alles auf einmal (die Datenmenge ist klein). Eine Versionsnummer ("rev")
   verhindert unnötiges Neuladen. Jede Schreib-Antwort bringt den neuen Gesamtstand gleich mit. */
(function () {
  const url = String((window.APP_CONFIG || {}).BACKEND_URL || '');

  async function send(promise) {
    let res;
    try { res = await promise; } catch { throw new Error('Keine Verbindung zum Speicher. Bitte Internetverbindung prüfen.'); }
    let j;
    try { j = await res.json(); } catch { throw new Error('Der Speicher hat unerwartet geantwortet. Ist die Bereitstellung des Skripts aktuell?'); }
    if (j.ok === false) { const e = new Error(j.error || 'Der Speicher hat einen Fehler gemeldet.'); e.code = j.code; throw e; }
    return j;
  }
  const need = () => { if (!url) throw new Error('Der Speicher ist noch nicht eingerichtet (BACKEND_URL in config.js).'); };
  const get = (action) => { need(); return send(fetch(`${url}?action=${action}`, { redirect: 'follow' })); };
  // text/plain vermeidet eine CORS-Vorabfrage, die Apps Script nicht beantwortet
  const post = (payload) => {
    need();
    return send(fetch(url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) }));
  };

  let cache = null;
  const hasConcert = (d) => (d.concerts || []).some((c) => !c.deleted_at);

  async function load(force) {
    if (cache && !force) {
      const r = await get('rev');
      if (r.rev === cache.rev) return cache;
    }
    cache = await get('all');
    if (!cache.concerts || !hasConcert(cache)) {
      const r = await post({ action: 'init' }); // legt das eine Konzert an (nur einmal, serverseitig gesperrt)
      cache = r.snapshot || r;
    }
    return cache;
  }

  async function write(payload) {
    const r = await post(payload);
    if (r.snapshot) cache = r.snapshot; else cache = null;
    return cache || load(true);
  }

  window.Store = { load, write };
})();
