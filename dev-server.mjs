// Lokaler Testserver: liefert docs/ aus und ersetzt das Google-Skript durch dieselbe Logik
// (apps-script/Code.gs) mit einer Datei als Speicher. So lässt sich alles ohne Google ausprobieren.
// Start: npm start   (Port per PORT ändern, Daten liegen in data/dev.json)
import http from 'node:http';
import vm from 'node:vm';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const siteDir = join(root, 'docs');
const dataFile = process.env.DATA_FILE || join(root, 'data', 'dev.json');
const PORT = Number(process.env.PORT || 8080);

const ctx = vm.createContext({ console });
vm.runInContext(readFileSync(join(root, 'apps-script', 'Code.gs'), 'utf8'), ctx);

const tables = existsSync(dataFile) ? JSON.parse(readFileSync(dataFile, 'utf8')) : { _rev: 0 };
const tab = (n) => (tables[n] ||= []);
const store = {
  all: (n) => tab(n).map((r) => ({ ...r })),
  find: (n, id) => tab(n).find((r) => r.id === Number(id)) || null,
  nextId: (n) => tab(n).reduce((m, r) => Math.max(m, r.id), 0) + 1,
  insert: (n, rec) => { tab(n).push({ ...rec }); },
  update: (n, id, rec) => { tab(n)[tab(n).findIndex((r) => r.id === Number(id))] = { ...rec }; },
  rev: () => String(tables._rev),
  bump: () => { tables._rev++; mkdirSync(dirname(dataFile), { recursive: true }); writeFileSync(dataFile, JSON.stringify(tables)); },
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.txt': 'text/plain; charset=utf-8' };
const json = (res, obj) => { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/exec') {
    if (req.method === 'GET') return json(res, ctx.handleSafe_(store, { action: url.searchParams.get('action') || 'all' }));
    const chunks = []; for await (const c of req) chunks.push(c);
    try { return json(res, ctx.handleSafe_(store, JSON.parse(Buffer.concat(chunks).toString('utf8')))); }
    catch { return json(res, { ok: false, error: 'Ungültige Daten.' }); }
  }
  if (url.pathname === '/config.js') {
    res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' });
    return res.end("window.APP_CONFIG = { BACKEND_URL: '/exec' };");
  }
  const rel = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const file = normalize(join(siteDir, rel));
  if (!file.startsWith(siteDir + sep)) { res.writeHead(403); return res.end('Forbidden'); }
  let data;
  try { data = await readFile(file); } catch { res.writeHead(404); return res.end('Nicht gefunden'); }
  const head = { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes' };
  // Safari spielt Audio nur ab, wenn der Server Teilabrufe (Range) beherrscht, GitHub Pages und Co. tun das
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (m && (m[1] !== '' || m[2] !== '')) {
    const start = m[1] === '' ? Math.max(0, data.length - Number(m[2])) : Number(m[1]);
    const end = m[1] === '' || m[2] === '' ? data.length - 1 : Math.min(Number(m[2]), data.length - 1);
    if (start > end || start >= data.length) { res.writeHead(416, { 'Content-Range': `bytes */${data.length}` }); return res.end(); }
    res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': end - start + 1 });
    return res.end(data.subarray(start, end + 1));
  }
  res.writeHead(200, { ...head, 'Content-Length': data.length });
  res.end(data);
}).listen(PORT, '127.0.0.1', () => console.log(`Testserver: http://127.0.0.1:${PORT}  (Daten: ${dataFile})`));
