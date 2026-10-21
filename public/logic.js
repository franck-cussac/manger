// Logique pure (sans DOM ni réseau) : calcul de la session, parsing des liens Maps,
// encodage des actions dans les commentaires d'issue et reconstruction de l'état.
(function () {
  const TZ = 'Europe/Paris';
  const RESET_HOUR = 14;

  function parisParts(date) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
    }).formatToParts(date);
    const get = (type) => Number(parts.find((p) => p.type === type).value);
    return { y: get('year'), m: get('month'), d: get('day'), h: get('hour') };
  }

  // Date (AAAA-MM-JJ) du déjeuner en cours : à partir de 14h (heure de Paris), on passe au lendemain.
  function sessionDate(now = new Date()) {
    const { y, m, d, h } = parisParts(now);
    return new Date(Date.UTC(y, m - 1, h >= RESET_HOUR ? d + 1 : d)).toISOString().slice(0, 10);
  }

  function issueTitle(date) {
    return `🍽️ Déj ${date}`;
  }

  function formatDate(date) {
    return new Date(`${date}T12:00:00Z`).toLocaleDateString('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
    });
  }

  // Extrait ce qu'on peut d'un lien Google Maps complet (les liens courts maps.app.goo.gl ne contiennent rien).
  function parseMapsUrl(url) {
    const out = { nom: '', lat: null, lng: null };
    const place = url.match(/\/maps\/place\/([^/@?]+)/);
    if (place) {
      try {
        out.nom = decodeURIComponent(place[1].replace(/\+/g, ' ')).trim();
      } catch {
        // nom mal encodé : on laisse l'utilisateur le saisir
      }
    }
    const coords = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (coords) {
      out.lat = Number(coords[1]);
      out.lng = Number(coords[2]);
    }
    return out;
  }

  // Carte intégrée sans clé API.
  function embedUrl(resto) {
    let q = resto.nom;
    if (resto.adresse) q = `${resto.nom}, ${resto.adresse} Paris`;
    else if (resto.lat != null) q = `${resto.lat},${resto.lng}`;
    return `https://maps.google.com/maps?q=${encodeURIComponent(q)}&z=16&output=embed`;
  }

  // Chaque action est un commentaire lisible, avec le JSON caché dans un commentaire HTML.
  const MARKER = /<!-- dej (\{.*\}) -->/;

  function encodeEvent(evt, text) {
    const json = JSON.stringify(evt).replace(/>/g, '\\u003e');
    return `${text}\n\n<!-- dej ${json} -->`;
  }

  function decodeEvent(body) {
    const m = body && body.match(MARKER);
    if (!m) return null;
    try {
      return JSON.parse(m[1]);
    } catch {
      return null;
    }
  }

  // Rejoue les commentaires dans l'ordre pour obtenir l'état du jour.
  // comments : [{ id, user, avatar, body }]
  function buildState(comments) {
    const restos = [];
    const gens = new Map();

    for (const c of comments) {
      const e = decodeEvent(c.body);
      if (!e) continue;
      if (!gens.has(c.user)) gens.set(c.user, { login: c.user, avatar: c.avatar, statut: null, vote: null });
      const p = gens.get(c.user);

      switch (e.type) {
        case 'propose':
          if (!e.nom || !e.url) break;
          restos.push({
            id: String(c.id), nom: e.nom, url: e.url, menu: e.menu || '',
            adresse: e.adresse || '', cuisine: e.cuisine || '',
            lat: e.lat ?? null, lng: e.lng ?? null, by: c.user,
          });
          // Celui qui propose vient, et vote pour sa proposition.
          p.statut = 'viens';
          p.vote = String(c.id);
          break;
        case 'viens':
          p.statut = 'viens';
          break;
        case 'viens_pas':
          p.statut = 'viens_pas';
          p.vote = null;
          break;
        case 'retire': {
          // Seul l'auteur peut retirer sa proposition ; les votes qui la visaient sont annulés.
          const i = restos.findIndex((r) => r.id === e.resto && r.by === c.user);
          if (i === -1) break;
          restos.splice(i, 1);
          for (const other of gens.values()) if (other.vote === e.resto) other.vote = null;
          break;
        }
        case 'vote':
          if (p.statut === 'viens' && restos.some((r) => r.id === e.resto)) p.vote = e.resto;
          break;
      }
    }

    const people = [...gens.values()];
    for (const r of restos) r.votants = people.filter((p) => p.statut === 'viens' && p.vote === r.id);
    return { restos, gens: people };
  }

  const Dej = { sessionDate, issueTitle, formatDate, parseMapsUrl, embedUrl, encodeEvent, decodeEvent, buildState };
  if (typeof module !== 'undefined') module.exports = Dej;
  else globalThis.Dej = Dej;
})();
