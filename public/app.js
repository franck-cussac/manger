// Interface : GitHub sert de base de données (une issue par jour, un commentaire par action).
const API = window.DEJ_CONFIG.api ?? 'https://api.github.com';
const REPO = window.DEJ_CONFIG.repo;
const LOCAL = Boolean(window.DEJ_CONFIG.local); // dev-server.js : le « token » est juste un prénom
const POLL_MS = 10_000;
const TOKEN_KEY = 'dej_token';

let token = localStorage.getItem(TOKEN_KEY);
let me = null; // { login, avatar }
let session = null; // date AAAA-MM-JJ
let issueNumber = null;
let state = null;
let showForm = false;
let busy = false;
let error = '';
let catalogue = []; // restos du quartier, générés par scripts/init-restos.js

fetch('restaurants.json')
  .then((r) => (r.ok ? r.json() : []))
  .then((data) => (catalogue = data))
  .catch(() => {});

const $app = document.getElementById('app');

// ---------- GitHub ----------

async function gh(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${LOCAL ? encodeURIComponent(token) : token}`,
      Accept: 'application/vnd.github+json',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!res.ok) {
    const err = new Error(`GitHub ${res.status}`);
    err.status = res.status;
    try {
      err.message += ` : ${(await res.json()).message}`;
    } catch {}
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

async function findIssue(title) {
  const issues = await gh(`/repos/${REPO}/issues?state=all&sort=created&direction=desc&per_page=50`);
  const matches = issues.filter((i) => !i.pull_request && i.title === title).sort((a, b) => a.number - b.number);
  return matches.map((i) => i.number);
}

// Crée l'issue du jour si besoin. Si deux personnes la créent en même temps, on garde la plus ancienne.
async function ensureIssue() {
  if (issueNumber) return issueNumber;
  const title = Dej.issueTitle(session);
  let found = await findIssue(title);
  if (!found.length) {
    const created = await gh(`/repos/${REPO}/issues`, {
      method: 'POST',
      body: JSON.stringify({ title, body: `Pause déjeuner du ${Dej.formatDate(session)}, gérée par le site.` }),
    });
    found = await findIssue(title);
    if (found[0] !== created.number) {
      await gh(`/repos/${REPO}/issues/${created.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) });
    }
  }
  issueNumber = found[0];
  return issueNumber;
}

async function loadComments(number) {
  const all = [];
  for (let page = 1; ; page++) {
    const batch = await gh(`/repos/${REPO}/issues/${number}/comments?per_page=100&page=${page}`);
    all.push(...batch.map((c) => ({ id: c.id, user: c.user.login, avatar: c.user.avatar_url, body: c.body })));
    if (batch.length < 100) return all;
  }
}

async function post(evt, text) {
  busy = true;
  render();
  try {
    await ensureIssue();
    await gh(`/repos/${REPO}/issues/${issueNumber}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: Dej.encodeEvent(evt, text) }),
    });
    showForm = false;
    await refresh();
  } catch (e) {
    handleError(e);
  } finally {
    busy = false;
    render();
  }
}

let refreshing = false;
async function refresh() {
  if (!token || refreshing) return;
  refreshing = true;
  try {
    if (!me) {
      const u = await gh('/user');
      me = { login: u.login, avatar: u.avatar_url };
    }
    const s = Dej.sessionDate();
    if (s !== session) {
      // Nouvelle journée (14h passées) : retour à l'écran de proposition.
      session = s;
      issueNumber = null;
      state = null;
      showForm = false;
    }
    if (!issueNumber) issueNumber = (await findIssue(Dej.issueTitle(session)))[0] ?? null;
    state = Dej.buildState(issueNumber ? await loadComments(issueNumber) : []);
    error = '';
  } catch (e) {
    handleError(e);
  } finally {
    refreshing = false;
    render();
  }
}

function handleError(e) {
  console.error(e);
  if (e.status === 401) {
    logout();
    error = 'Token invalide ou expiré, recolle-en un nouveau.';
  } else if (e.status === 403 || e.status === 404) {
    error = `Accès refusé au dépôt ${REPO}. Vérifie que ton token classic a bien le scope public_repo.`;
  } else {
    error = e.message;
  }
}

function logout() {
  localStorage.removeItem(TOKEN_KEY);
  token = null;
  me = null;
  state = null;
  render();
}

// ---------- Rendu ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const safeUrl = (u) => (/^https?:\/\//i.test(u) ? u : '#');
// Évite les @mentions involontaires dans les commentaires GitHub.
const md = (s) => String(s).replace(/@/g, '@​').replace(/[*_`[\]]/g, '\\$&');

const avatar = (p) => `<img class="avatar" src="${esc(p.avatar)}&s=64" alt="" title="${esc(p.login)}">`;
const repoLink = LOCAL ? '<code>local-db.json</code>' : `<a href="https://github.com/${esc(REPO)}/issues" target="_blank" rel="noopener">issues du dépôt</a>`;
const people = (list, empty = 'personne') =>
  list.length ? `<span class="people">${list.map((p) => `<span class="person">${avatar(p)}${esc(p.login)}</span>`).join('')}</span>` : `<span class="muted">${empty}</span>`;

function restoCard(r, extra = '') {
  const menu = r.menu
    ? `<a href="${esc(safeUrl(r.menu))}" target="_blank" rel="noopener">📋 Voir le menu</a>`
    : `<span class="muted">📋 Menu : onglet « Menu » de la fiche Maps</span>`;
  return `
    <article class="card">
      <iframe src="${esc(Dej.embedUrl(r))}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="Carte ${esc(r.nom)}"></iframe>
      <div class="card-body">
        <h2>${esc(r.nom)}</h2>
        <p class="muted">${[r.adresse, r.cuisine, `proposé par ${r.by}`].filter(Boolean).map(esc).join(' · ')}</p>
        <p class="links">
          <a href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener">📍 Ouvrir dans Google Maps</a>
          ${menu}
          ${r.tel ? `<a href="tel:${esc(r.tel.replace(/[^\d+]/g, ''))}">📞 ${esc(r.tel)}</a>` : ''}
        </p>
        ${r.by === me?.login ? `<p><button class="link" data-action="retire" data-id="${esc(r.id)}" ${busy ? 'disabled' : ''}>🗑️ Retirer ma proposition</button></p>` : ''}
        ${extra}
      </div>
    </article>`;
}

function viewLogin() {
  if (LOCAL) {
    return `
    <section class="panel">
      <h2>Mode local</h2>
      <p>Les données sont stockées dans <code>local-db.json</code>. Choisis juste un nom (ouvre une fenêtre privée pour jouer un autre collègue).</p>
      <form data-form="login" class="row">
        <input name="token" placeholder="Ton prénom" required autocomplete="off">
        <button class="primary">Valider</button>
      </form>
    </section>`;
  }
  return `
    <section class="panel">
      <h2>Connexion avec GitHub</h2>
      <p>Le site enregistre tout dans les issues du dépôt <code>${esc(REPO)}</code>. Il te faut un token GitHub (à faire une seule fois) :</p>
      <ol>
        <li>Ouvre <a href="https://github.com/settings/tokens/new?scopes=public_repo&description=Pause%20d%C3%A9j" target="_blank" rel="noopener">github.com › New personal access token (classic)</a> : le formulaire est déjà pré-rempli</li>
        <li><b>Expiration</b> : choisis une durée (90 jours par exemple)</li>
        <li><b>Scopes</b> : uniquement <code>public_repo</code> (déjà coché)</li>
        <li>Clique sur <b>Generate token</b>, copie le token (<code>ghp_…</code>) et colle-le ci-dessous</li>
      </ol>
      <form data-form="login" class="row">
        <input name="token" type="password" placeholder="ghp_…" required autocomplete="off">
        <button class="primary">Valider</button>
      </form>
      <p class="muted small">Le token reste uniquement dans ton navigateur.</p>
    </section>`;
}

const catalogueLabel = (r) => [r.nom, r.adresse, r.cuisine && `(${r.cuisine})`].filter(Boolean).join(' — ');

function viewForm(isCounter) {
  return `
    <section class="panel">
      <h2>${isCounter ? 'Contre-proposition' : 'Proposer un restaurant'}</h2>
      <form data-form="propose" class="stack">
        ${catalogue.length ? `
        <label>Restaurant du quartier <span class="muted">(${catalogue.length} autour de Nation)</span>
          <input name="catalogue" list="catalogue" placeholder="Tape un nom ou une cuisine (japonais, pizza…)" autocomplete="off">
          <datalist id="catalogue">${catalogue.map((r) => `<option value="${esc(catalogueLabel(r))}">`).join('')}</datalist>
        </label>
        <label>… ou choisis dans la liste
          <select name="liste">
            <option value="">— Tous les restos référencés —</option>
            ${catalogue.map((r, i) => `<option value="${i}">${esc(catalogueLabel(r))}</option>`).join('')}
          </select>
        </label>
        <p class="muted small">… ou colle n'importe quel lien Google Maps :</p>` : ''}
        <input type="hidden" name="adresse">
        <input type="hidden" name="cuisine">
        <label>Lien Google Maps
          <input name="url" type="url" required placeholder="https://www.google.com/maps/place/…">
        </label>
        <label>Nom du restaurant
          <input name="nom" required placeholder="Rempli automatiquement si possible">
        </label>
        <label>Lien du menu <span class="muted">(facultatif)</span>
          <input name="menu" type="url" placeholder="https://…">
        </label>
        <label>Téléphone pour réserver <span class="muted">(facultatif)</span>
          <input name="tel" type="tel" placeholder="01 23 45 67 89">
        </label>
        <div class="row">
          <button class="primary" ${busy ? 'disabled' : ''}>Proposer</button>
          ${state.restos.length ? '<button type="button" data-action="cancel">Annuler</button>' : ''}
        </div>
      </form>
    </section>`;
}

function viewEmpty() {
  return `
    <section class="panel center">
      <p class="big">🤷 Personne n'a encore proposé de resto.</p>
      <button class="primary big-btn" data-action="form">Proposer un restaurant</button>
    </section>`;
}

function headcount() {
  const coming = state.gens.filter((p) => p.statut === 'viens');
  const n = coming.length;
  return `
    <section class="headcount">
      <span class="count">${n}</span>
      <span><b>${n > 1 ? 'personnes viennent' : 'personne vient'} déjeuner</b><br>${people(coming, 'Sois le premier !')}</span>
    </section>`;
}

function viewSingle(mine) {
  const r = state.restos[0];
  const notComing = state.gens.filter((p) => p.statut === 'viens_pas');
  const buttons = `
    <div class="row actions">
      <button class="${mine?.statut === 'viens' ? 'primary' : ''}" data-action="viens" ${busy ? 'disabled' : ''}>✅ Je viens</button>
      <button class="${mine?.statut === 'viens_pas' ? 'danger' : ''}" data-action="viens_pas" ${busy ? 'disabled' : ''}>❌ Je viens pas</button>
      <button data-action="form" ${busy ? 'disabled' : ''}>🔁 Contre-proposition</button>
    </div>
    <p><b>Ne viennent pas</b> : ${people(notComing)}</p>`;
  return restoCard(r, buttons);
}

function viewVote(mine) {
  const max = Math.max(...state.restos.map((r) => r.votants.length));
  const leaders = state.restos.filter((r) => r.votants.length === max);
  const canVote = mine?.statut === 'viens';
  const noVote = state.gens.filter((p) => p.statut === 'viens' && !p.vote);
  const notComing = state.gens.filter((p) => p.statut === 'viens_pas');

  const header = canVote
    ? `<p>✅ Tu viens. Vote pour ton resto préféré. <button class="link" data-action="viens_pas">Finalement je ne viens pas</button></p>`
    : `<div class="notice">Dis d'abord si tu viens pour pouvoir voter :
         <button class="primary" data-action="viens" ${busy ? 'disabled' : ''}>✅ Je viens</button>
         <button class="${mine?.statut === 'viens_pas' ? 'danger' : ''}" data-action="viens_pas" ${busy ? 'disabled' : ''}>❌ Je viens pas</button>
       </div>`;

  const cards = state.restos
    .map((r) => {
      const isMine = mine?.vote === r.id;
      const lead = max > 0 && leaders.length === 1 && leaders[0] === r ? '<span class="badge">🏆 En tête</span>' : '';
      return restoCard(r, `
        <p class="votes">${lead}<b>${r.votants.length} vote${r.votants.length > 1 ? 's' : ''}</b> ${people(r.votants, '')}</p>
        <button class="${isMine ? 'primary' : ''}" data-action="vote" data-id="${esc(r.id)}" ${!canVote || busy || isMine ? 'disabled' : ''}>
          ${isMine ? '✓ Ton vote' : '🗳️ Voter'}
        </button>`);
    })
    .join('');

  const located = state.restos.filter((r) => r.lat != null).length;
  const mapBlock = located
    ? `<div id="overview-map"></div>${located < state.restos.length ? '<p class="muted small">Certains restos n\'ont pas de position (lien Maps court) et n\'apparaissent pas sur la carte.</p>' : ''}`
    : '';

  return `
    <h2 class="section-title">🗳️ On vote : où on mange ?</h2>
    ${header}
    ${mapBlock}
    <div class="grid">${cards}</div>
    <div class="row"><button data-action="form" ${busy ? 'disabled' : ''}>🔁 Nouvelle contre-proposition</button></div>
    <p><b>Viennent sans avoir voté</b> : ${people(noVote)}</p>
    <p><b>Ne viennent pas</b> : ${people(notComing)}</p>`;
}

function render() {
  const user = me
    ? `<span class="me">${avatar(me)}${esc(me.login)} <button class="link" data-action="logout">déconnexion</button></span>`
    : '';
  const date = session ? `<p class="muted">Déjeuner du ${esc(Dej.formatDate(session))} · remise à zéro à 14h</p>` : '';
  let body;
  if (!token) body = viewLogin();
  else if (!state) body = '<p class="muted center">Chargement…</p>';
  else {
    const mine = state.gens.find((p) => p.login === me.login);
    if (showForm || !state.restos.length) body = showForm ? viewForm(state.restos.length > 0) : viewEmpty();
    else body = headcount() + (state.restos.length === 1 ? viewSingle(mine) : viewVote(mine));
  }

  // Ne pas écraser le formulaire pendant la saisie lors du rafraîchissement automatique.
  const editing = document.activeElement?.closest?.('form');
  if (editing && editing.dataset.form === 'propose' && showForm && !busy && !error) return;

  const html = `
    <header>
      <h1>🍽️ Pause déj</h1>
      ${user}
    </header>
    ${date}
    ${error ? `<p class="error">${esc(error)}</p>` : ''}
    <main>${body}</main>
    <footer class="muted small">Historique : ${repoLink}</footer>`;

  // Rien n'a changé depuis le dernier affichage : on ne touche pas au DOM (sinon les cartes se rechargent).
  if (html === lastHtml) return;
  lastHtml = html;
  if (overviewMap) overviewMap.remove();
  overviewMap = null;
  $app.innerHTML = html;
  mountOverviewMap();
}

let lastHtml = '';
let overviewMap = null;

// Carte Leaflet (fond OpenStreetMap) avec un marqueur par resto proposé.
function mountOverviewMap() {
  const el = document.getElementById('overview-map');
  if (!el || !window.L) return;
  const restos = state.restos.filter((r) => r.lat != null);
  const max = Math.max(...state.restos.map((r) => r.votants.length));
  const unique = state.restos.filter((r) => r.votants.length === max).length === 1;
  overviewMap = L.map(el, { scrollWheelZoom: false });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(overviewMap);
  for (const r of restos) {
    const votes = r.votants.length;
    L.marker([r.lat, r.lng])
      .addTo(overviewMap)
      .bindTooltip(`${esc(r.nom)} · ${votes} vote${votes > 1 ? 's' : ''}`, {
        permanent: true,
        direction: 'top',
        offset: [-15, -12],
        className: votes > 0 && votes === max && unique ? 'tip leader' : 'tip',
      })
      .bindPopup(`<b>${esc(r.nom)}</b><br><a href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener">Ouvrir dans Google Maps</a>`);
  }
  if (restos.length === 1) overviewMap.setView([restos[0].lat, restos[0].lng], 17);
  else overviewMap.fitBounds(restos.map((r) => [r.lat, r.lng]), { paddingTopLeft: [40, 70], paddingBottomRight: [40, 20], maxZoom: 17 });
}

// ---------- Événements ----------

$app.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const restoNom = (id) => state.restos.find((r) => r.id === id)?.nom ?? '';
  switch (btn.dataset.action) {
    case 'form':
      showForm = true;
      render();
      $app.querySelector('input[name=url]')?.focus();
      break;
    case 'cancel':
      showForm = false;
      render();
      break;
    case 'viens':
      post({ type: 'viens' }, '✅ Je viens');
      break;
    case 'viens_pas':
      post({ type: 'viens_pas' }, '❌ Je ne viens pas');
      break;
    case 'vote':
      post({ type: 'vote', resto: btn.dataset.id }, `🗳️ Je vote pour **${md(restoNom(btn.dataset.id))}**`);
      break;
    case 'retire':
      if (confirm(`Retirer « ${restoNom(btn.dataset.id)} » ? Les votes pour ce resto seront annulés.`)) {
        post({ type: 'retire', resto: btn.dataset.id }, `🗑️ Je retire **${md(restoNom(btn.dataset.id))}**`);
      }
      break;
    case 'logout':
      logout();
      break;
  }
});

function fillFromCatalogue(f, r) {
  for (const key of ['url', 'nom', 'menu', 'tel', 'adresse', 'cuisine']) f[key].value = r[key];
  f.nom.dataset.touched = '1';
}

$app.addEventListener('input', (e) => {
  const f = e.target.form?.elements;
  // Choix dans la liste du quartier (recherche ou menu déroulant) : remplit tout le formulaire.
  if (e.target.name === 'catalogue') {
    const r = catalogue.find((x) => catalogueLabel(x) === e.target.value);
    if (r) fillFromCatalogue(f, r);
  }
  if (e.target.name === 'liste' && catalogue[e.target.value]) {
    fillFromCatalogue(f, catalogue[e.target.value]);
    f.catalogue.value = '';
  }
  // Lien collé à la main : pré-remplit le nom à partir du lien Google Maps.
  if (e.target.name === 'url') {
    f.adresse.value = '';
    f.cuisine.value = '';
    const parsed = Dej.parseMapsUrl(e.target.value);
    if (parsed.nom && !f.nom.dataset.touched) f.nom.value = parsed.nom;
  }
});
$app.addEventListener('change', (e) => {
  if (e.target.name === 'nom') e.target.dataset.touched = '1';
});

$app.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  if (e.target.dataset.form === 'login') {
    token = f.token.value.trim();
    localStorage.setItem(TOKEN_KEY, token);
    error = '';
    render();
    await refresh();
  } else if (e.target.dataset.form === 'propose') {
    const url = f.url.value.trim();
    const nom = f.nom.value.trim();
    // Position pour la carte : depuis le lien, sinon depuis la liste du quartier si le nom y figure.
    let { lat, lng } = Dej.parseMapsUrl(url);
    const known = catalogue.find((r) => r.nom.toLowerCase() === nom.toLowerCase());
    if (lat == null && known) ({ lat, lng } = known);
    const verb = state.restos.length ? '🔁 Contre-proposition' : '🍽️ Proposition';
    document.activeElement.blur();
    const evt = { type: 'propose', nom, url, menu: f.menu.value.trim(), tel: f.tel.value.trim(), adresse: f.adresse.value, cuisine: f.cuisine.value, lat, lng };
    post(evt, `${verb} : **${md(nom)}**\n${url}`);
  }
});

setInterval(() => {
  if (document.visibilityState === 'visible') refresh();
}, POLL_MS);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh();
});

render();
refresh();
