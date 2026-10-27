const test = require('node:test');
const assert = require('node:assert');
const Dej = require('../public/logic.js');

test('la session bascule au lendemain à 14h heure de Paris', () => {
  assert.strictEqual(Dej.sessionDate(new Date('2026-10-21T11:59:00Z')), '2026-10-21'); // 13h59 Paris
  assert.strictEqual(Dej.sessionDate(new Date('2026-10-21T12:00:00Z')), '2026-10-22'); // 14h00 Paris
  assert.strictEqual(Dej.sessionDate(new Date('2026-12-31T13:30:00Z')), '2027-01-01'); // 14h30 Paris (hiver)
});

test('parse un lien Google Maps complet', () => {
  const url = 'https://www.google.com/maps/place/Pizza+Luigi/@48.8566,2.3522,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d48.8567!4d2.3523';
  assert.deepStrictEqual(Dej.parseMapsUrl(url), { nom: 'Pizza Luigi', lat: 48.8567, lng: 2.3523 });
  assert.deepStrictEqual(Dej.parseMapsUrl('https://maps.app.goo.gl/abc'), { nom: '', lat: null, lng: null });
});

test('encode / décode un événement', () => {
  const evt = { type: 'propose', nom: 'Chez <-->', url: 'https://x' };
  assert.deepStrictEqual(Dej.decodeEvent(Dej.encodeEvent(evt, 'texte')), evt);
  assert.strictEqual(Dej.decodeEvent('commentaire normal'), null);
});

test("reconstruit l'état et n'accepte que les votes de ceux qui viennent", () => {
  const c = (id, user, evt) => ({ id, user, avatar: '', body: Dej.encodeEvent(evt, '') });
  const state = Dej.buildState([
    c(1, 'alice', { type: 'propose', nom: 'A', url: 'https://a' }),
    c(2, 'bob', { type: 'vote', resto: '1' }), // ignoré : bob n'a pas dit qu'il venait
    c(3, 'bob', { type: 'viens' }),
    c(4, 'carol', { type: 'propose', nom: 'B', url: 'https://b' }),
    c(5, 'bob', { type: 'vote', resto: '4' }),
    c(6, 'dave', { type: 'viens_pas' }),
  ]);
  assert.deepStrictEqual(state.restos.map((r) => [r.nom, r.votants.map((p) => p.login)]), [
    ['A', ['alice']],
    ['B', ['bob', 'carol']],
  ]);
  assert.strictEqual(state.gens.find((p) => p.login === 'dave').statut, 'viens_pas');
});

test("seul l'auteur peut retirer sa proposition, et les votes sont annulés", () => {
  const c = (id, user, evt) => ({ id, user, avatar: '', body: Dej.encodeEvent(evt, '') });
  const state = Dej.buildState([
    c(1, 'alice', { type: 'propose', nom: 'A', url: 'https://a' }),
    c(2, 'carol', { type: 'propose', nom: 'B', url: 'https://b' }),
    c(3, 'bob', { type: 'viens' }),
    c(4, 'bob', { type: 'vote', resto: '2' }),
    c(5, 'bob', { type: 'retire', resto: '1' }), // ignoré : bob n'est pas l'auteur
    c(6, 'carol', { type: 'retire', resto: '2' }),
  ]);
  assert.deepStrictEqual(state.restos.map((r) => r.nom), ['A']);
  const bob = state.gens.find((p) => p.login === 'bob');
  assert.deepStrictEqual([bob.statut, bob.vote], ['viens', null]);
});

test("les invités externes : le dernier nombre par équipe l'emporte, 0 retire l'équipe", () => {
  const c = (id, user, evt) => ({ id, user, avatar: '', body: Dej.encodeEvent(evt, '') });
  const state = Dej.buildState([
    c(1, 'alice', { type: 'invites', equipe: 'Marketing', nombre: 3 }),
    c(2, 'bob', { type: 'invites', equipe: 'Compta', nombre: 2 }),
    c(3, 'carol', { type: 'invites', equipe: ' marketing ', nombre: 5 }), // même équipe, corrigée par quelqu'un d'autre
    c(4, 'bob', { type: 'invites', equipe: 'Compta', nombre: 0 }),
    c(5, 'dave', { type: 'invites', equipe: '', nombre: 4 }), // ignoré : pas de nom d'équipe
  ]);
  assert.deepStrictEqual(state.invites, [{ equipe: 'marketing', nombre: 5, by: 'carol' }]);
});
