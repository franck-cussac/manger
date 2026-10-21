// Génère public/restaurants.json : les restaurants autour de Nation, d'après OpenStreetMap
// (Google Maps ne permet pas de lister des lieux sans clé API). Chaque resto reçoit un lien Google Maps.
// Usage : npm run init-restos [-- rayon_en_metres]
const fs = require('fs');
const path = require('path');

const NATION = { lat: 48.8484, lng: 2.3958 };
const RADIUS = Number(process.argv[2]) || 600;
const OUT = path.join(__dirname, '..', 'public', 'restaurants.json');

const CUISINES = {
  french: 'français', italian: 'italien', pizza: 'pizza', japanese: 'japonais', sushi: 'sushi', chinese: 'chinois',
  vietnamese: 'vietnamien', thai: 'thaï', indian: 'indien', korean: 'coréen', lebanese: 'libanais', greek: 'grec',
  burger: 'burger', kebab: 'kebab', sandwich: 'sandwich', asian: 'asiatique', regional: 'régional', crepe: 'crêpes',
  brunch: 'brunch', mexican: 'mexicain', african: 'africain', turkish: 'turc', moroccan: 'marocain', salad: 'salades',
  bagel: 'bagels', chicken: 'poulet', breakfast: 'petit-déj', coffee_shop: 'café', tapas: 'tapas', spanish: 'espagnol',
  portuguese: 'portugais', american: 'américain', bistro: 'bistrot', seafood: 'fruits de mer', vegan: 'vegan',
  vegetarian: 'végétarien', ramen: 'ramen', noodle: 'nouilles', poke: 'poké', italian_pizza: 'pizza', friture: 'friterie',
};

const query = `[out:json][timeout:60];
nwr["amenity"~"^(restaurant|fast_food)$"]["name"](around:${RADIUS},${NATION.lat},${NATION.lng});
out center tags;`;

const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

// Les serveurs Overpass sont souvent surchargés : on essaie le miroir si le premier échoue.
async function overpass() {
  for (const server of SERVERS) {
    try {
      const res = await fetch(server, {
        method: 'POST',
        headers: { 'User-Agent': 'pause-dej/1.0', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (res.ok) return await res.json();
      console.warn(`${server} : HTTP ${res.status}`);
    } catch (e) {
      console.warn(`${server} : ${e.message}`);
    }
  }
  throw new Error('Aucun serveur Overpass disponible, réessaie dans quelques minutes.');
}

(async () => {
  const { elements } = await overpass();

  const restos = elements
    .map(({ tags: t, lat, lon, center }) => {
      const adresse = [[t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' '), t['addr:postcode']]
        .filter(Boolean)
        .join(', ');
      const cuisine = (t.cuisine || (t.amenity === 'fast_food' ? 'fast_food' : ''))
        .split(';')
        .map((c) => (c === 'fast_food' ? 'rapide' : CUISINES[c.trim()] || c.trim().replace(/_/g, ' ')))
        .filter(Boolean)
        .join(', ');
      const pos = { lat: lat ?? center.lat, lng: lon ?? center.lon };
      return {
        nom: t.name,
        adresse,
        cuisine,
        // Recherche du nom centrée sur la position exacte : évite les homonymes ailleurs dans Paris.
        url: `https://www.google.com/maps/search/${encodeURIComponent(t.name)}/@${pos.lat},${pos.lng},19z`,
        menu: t['website:menu'] || t['contact:website'] || t.website || '',
        tel: (t.phone || t['contact:phone'] || '').split(';')[0].trim(),
        ...pos,
      };
    })
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));

  fs.writeFileSync(OUT, `${JSON.stringify(restos, null, 2)}\n`);
  console.log(`${restos.length} restaurants (rayon ${RADIUS} m autour de Nation) → ${path.relative(process.cwd(), OUT)}`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
