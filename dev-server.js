// Serveur de développement : sert public/ et imite la partie de l'API GitHub utilisée par le site,
// en stockant les issues et commentaires dans un fichier JSON local.
// En local, le « token » saisi sur le site est simplement ton prénom.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const DB_FILE = path.join(__dirname, 'local-db.json');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const load = () => (fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : { issues: [], comments: [] });
const save = (db) => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

const user = (login) => ({ login, avatar_url: `/avatar/${encodeURIComponent(login)}.svg?v=1` });

function avatarSvg(login) {
  const hue = [...login].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
  const letter = login.charAt(0).toUpperCase().replace(/[<&]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="hsl(${hue},60%,50%)"/><text x="32" y="42" font-size="30" text-anchor="middle" fill="#fff" font-family="sans-serif">${letter}</text></svg>`;
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data ? JSON.parse(data) : {}));
  });
}

async function api(req, res, url) {
  const json = (status, body) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
  const login = decodeURIComponent((req.headers.authorization || '').replace(/^Bearer\s*/, '')).trim();
  if (!login) return json(401, { message: 'Bad credentials' });

  const db = load();
  const p = url.pathname;
  let m;

  if (p === '/user') return json(200, user(login));

  if (/^\/repos\/[^/]+\/[^/]+\/issues$/.test(p)) {
    if (req.method === 'POST') {
      const issue = { number: db.issues.length + 1, title: (await readBody(req)).title, state: 'open' };
      db.issues.push(issue);
      save(db);
      return json(201, issue);
    }
    return json(200, [...db.issues].reverse());
  }

  if ((m = p.match(/^\/repos\/[^/]+\/[^/]+\/issues\/(\d+)$/)) && req.method === 'PATCH') {
    const issue = db.issues.find((i) => i.number === Number(m[1]));
    Object.assign(issue, await readBody(req));
    save(db);
    return json(200, issue);
  }

  if ((m = p.match(/^\/repos\/[^/]+\/[^/]+\/issues\/(\d+)\/comments$/))) {
    const number = Number(m[1]);
    if (req.method === 'POST') {
      const comment = { id: db.comments.length + 1, issue: number, user: user(login), body: (await readBody(req)).body };
      db.comments.push(comment);
      save(db);
      return json(201, comment);
    }
    const page = Number(url.searchParams.get('page') || 1);
    const perPage = Number(url.searchParams.get('per_page') || 30);
    return json(200, db.comments.filter((c) => c.issue === number).slice((page - 1) * perPage, page * perPage));
  }

  json(404, { message: 'Not Found' });
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/user' || url.pathname.startsWith('/repos/')) {
      return api(req, res, url).catch((e) => res.writeHead(500).end(e.message));
    }
    if (url.pathname === '/config.js') {
      return res.writeHead(200, { 'Content-Type': 'text/javascript' }).end("window.DEJ_CONFIG = { repo: 'local/dej', api: '', local: true };");
    }
    const avatar = url.pathname.match(/^\/avatar\/(.+)\.svg$/);
    if (avatar) return res.writeHead(200, { 'Content-Type': 'image/svg+xml' }).end(avatarSvg(decodeURIComponent(avatar[1])));

    const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
    if (!file.startsWith(PUBLIC)) return res.writeHead(403).end();
    fs.readFile(file, (err, data) => {
      if (err) return res.writeHead(404).end('Not found');
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(data);
    });
  })
  .listen(PORT, () => console.log(`Pause déj (mode local) : http://localhost:${PORT}  — données dans ${DB_FILE}`));
