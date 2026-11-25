# SLGM Konzertplanung

Gemeinsame Planung des **Sommerkonzerts 2026/2027** am Sächsischen Landesgymnasium für Musik Dresden: Die Leiterinnen und Leiter tragen ihr Ensemble samt Stückvorschlägen ein, dazu gibt es einen Zeitrahmen und Kommentare. Es gibt keine Anmeldung. Den Namen gibt man dort an, wo er gebraucht wird: als Leitung beim Ensemble und beim Kommentar.

Ton: Zum Intro läuft die Musik „The Path of the Force“ von Luis Humanoide (Pixabay, `docs/audio/intro.m4a`, auf 75 Sekunden gekürzt und auf ca. 1 MB verkleinert; sie wird beim Überspringen oder am Ende des Crawls ausgeblendet). Die Quelle steht im Seitenfuß. Browser erlauben Ton oft erst nach einem Klick; dann erscheint der Knopf „Ton an“, der das Intro mit Musik neu startet. Ohne Musik: in `docs/config.js` `INTRO_AUDIO` leer lassen. Die Lizenz des Stücks (Pixabay-Inhaltslizenz) vor dem Veröffentlichen auf der Pixabay-Seite des Stücks prüfen. Die Originaldateien im Projektordner (`Star Wars.mp3`, `luis_humanoide-….mp3`) gehören nicht in das Repository.

Übersicht der Stücke: Ansicht umschaltbar zwischen **Nach Ensemble**, **Tabelle** (Spalten sortierbar) und **Nach Komponist**. Jedes Stück kann optional dem **Nacht/Mühsal**, dem **Licht/Sternen** oder **Beidem** zugeordnet werden; danach und per Suchfeld lässt sich filtern. Ansicht und Filter merkt sich der Browser.

Optik: dunkler Sternenhimmel mit Opening-Crawl zum Motto „Per aspera ad astra“, der ins Licht und in die helle Arbeitsfläche übergeht (Intro läuft einmal pro Besuch, überspringbar, bei „Bewegung reduzieren“ nur auf Knopfdruck).

**Aufbau:** Eine statische Seite (`docs/`, läuft auf GitHub Pages) und ein Google-Skript (`apps-script/Code.gs`), das alle Eingaben in einer Google-Tabelle speichert. Die Tabelle ist der dauerhafte Speicher und zugleich die Sicherung.

## Lokal ausprobieren (ohne Google)

```bash
npm start
```

Öffnet einen Testserver auf http://127.0.0.1:8080. Er nutzt dieselbe Logik wie das Google-Skript, die Daten liegen in `data/dev.json`. Tests der Speicherlogik: `npm test`.

## Stand der Einrichtung

**Veröffentlicht:** https://wolfgangskill.github.io/sommerkonzert-planung/ (GitHub Pages, Branch `main`, Ordner `/docs`). Änderungen an `docs/` gehen nach einem Push nach ca. einer Minute live.

Der Speicher ist eingerichtet: Google-Tabelle „Konzertplanung Daten SLGM“ mit gebundenem Skript, als Web-App bereitgestellt (Ausführen als Besitzerin/Besitzer, Zugriff „Jeder“, Version 3). Die URL steht schon in `docs/config.js`. Jede Aktion in der Seite braucht etwa 2 bis 4 Sekunden, weil Google-Skripte nicht schneller antworten.

Blätter: Konzerte (genau eine Zeile), Ensembles, Stuecke, Aufgaben, Kommentare. Die Blätter „Programm“, „Personen“ und „Tabellenblatt1“ stammen aus früheren Fassungen bzw. sind leer und werden nicht mehr benutzt (können gelöscht werden).

## Speicher einrichten (einmalig, falls neu aufgesetzt werden muss)

1. In Google Drive eine neue **Google-Tabelle** anlegen, z. B. „Konzertplanung Daten“.
2. *Erweiterungen → Apps Script* öffnen, den Inhalt von `apps-script/Code.gs` einfügen, speichern.
3. Die Funktion **`einrichten`** einmal ausführen (Play-Knopf). Google fragt nach Berechtigungen für die eigene Tabelle. Es entstehen die Blätter Konzerte, Ensembles, Stuecke, Aufgaben, Kommentare.
4. *Bereitstellen → Neue Bereitstellung → Typ „Web-App“*: Ausführen als **Ich**, Zugriff **Jeder**. Die **Web-App-URL** (endet auf `/exec`) kopieren.
5. In `docs/config.js` bei `BACKEND_URL` eintragen.

Wird `Code.gs` später geändert: *Bereitstellen → Bereitstellungen verwalten → Bearbeiten → Neue Version*, sonst läuft die alte.

## Auf GitHub Pages veröffentlichen

Neues Repository anlegen, den Inhalt dieses Ordners hochladen (`data/` und `legacy-server/` weglassen), dann *Settings → Pages → Deploy from a branch → `main` → Ordner `/docs`*. Die Seite ist danach unter `https://<benutzername>.github.io/<repository>/` erreichbar.

## Dass nichts verloren geht

- Löschen in der App **entfernt nichts endgültig**: Es füllt nur die Spalte `deleted_at`. Wiederherstellen: Zelle in der Tabelle leeren.
- Die Google-Tabelle hat eine **Versionsverlauf** (*Datei → Versionsverlauf*), auch alte Stände und Fehleingaben lassen sich zurückholen.
- Oben rechts gibt es **Sicherung (JSON)**: lädt alle Daten, auch gelöschte, als Datei herunter.
- Gleichzeitiges Speichern wird vom Skript nacheinander abgearbeitet, Einträge überschreiben sich nicht gegenseitig.

## Datenschutz und Zugang

- Wer die Seiten-Adresse kennt, kann alles lesen und ändern, und die Skript-URL steht im öffentlichen Quelltext. Den Link nur im Kollegium weitergeben und **keine Namen von Schülerinnen und Schülern** eintragen.
- Die Namensabfrage ist keine Zugangskontrolle, jeder kann sich eintragen, wie er möchte.
- Roboto liegt lokal in `docs/fonts/`, es werden keine Schriften von Google geladen. Beim Zugriff auf das Skript sieht Google aber die IP-Adressen. Das vorher mit der Datenschutzbeauftragten oder dem Datenschutzbeauftragten der Schule klären.

## Ordner

- `docs/` – die Seite (`index.html`, `style.css`, `app.js`, `api.js`, `config.js`, `fonts/`)
- `apps-script/` – `Code.gs` (Speicher) und `test.mjs` (Tests)
- `dev-server.mjs` – lokaler Testserver
- `legacy-server/` – erste Fassung mit eigenem Server und Login (nicht mehr benötigt, nur zur Ansicht)
- `index.html`, `sommerkonzert-seite.zip` – frühere Einzelseite zur Sommerkonzert-Programmplanung

## Noch offen

Bildmarke des SLGM (Datei fehlt), Reihenfolge der Ensembles im Programm festlegen, Dateianhänge, Wiederherstellen gelöschter Einträge direkt in der App. Mehrere Konzerte sind bewusst nicht vorgesehen; die frühere Mehrkonzert-Fassung liegt in `legacy-server/`.
