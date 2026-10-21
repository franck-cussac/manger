# 🍽️ Pause déj

Mini site statique pour organiser le déjeuner de l'équipe. Il n'y a pas de serveur ni de base de données : **les issues GitHub du dépôt servent de stockage**.

## Fonctionnement

- Chaque jour a son issue `🍽️ Déj AAAA-MM-JJ`, créée automatiquement à la première action.
- Chaque action (proposer, je viens, je viens pas, voter) est un commentaire posté sur cette issue. Le site relit les commentaires toutes les 10 s pour reconstruire l'état.
- Avec 1 resto proposé, on a trois choix : **Je viens**, **Je viens pas** ou **Contre-proposition**.
- Dès qu'il y a 2 restos ou plus, on passe en mode vote. Seuls ceux qui ont dit « je viens » peuvent voter.
- Celui qui propose un resto est compté comme venant, et il vote pour sa proposition.
- **À 14h (heure de Paris)**, le site passe sur l'issue du lendemain. On repart donc de zéro, et les anciennes issues servent d'historique.
- Le site n'utilise pas d'API Google : il intègre une carte Google Maps et met un lien vers la fiche. Le menu n'est pas disponible via Google, mais on peut donner un lien vers le menu en proposant le resto.

## Restaurants du quartier

`public/restaurants.json` contient la liste des restos autour de Nation. Dans le formulaire « Proposer », on peut chercher un resto par nom ou par cuisine, et le formulaire se remplit tout seul. Coller un lien Google Maps à la main reste possible.

Cette liste vient d'**OpenStreetMap**, car Google Maps ne permet pas de lister des lieux sans clé API. Chaque resto reçoit un lien Google Maps centré sur sa position. Pour regénérer la liste :

```sh
npm run init-restos          # rayon de 600 m autour de Nation
npm run init-restos -- 1000  # autre rayon, en mètres
```

Le fichier est versionné dans le dépôt, donc il est disponible en local comme sur GitHub Pages.

## Mise en place (une fois)

1. Pousser ce dossier sur un dépôt GitHub (branche `main`). Les **Issues** doivent être activées.
2. *Settings › Pages › Source* : choisir **GitHub Actions**.
3. Le workflow `.github/workflows/deploy.yml` déploie le site à chaque push.

## Pour chaque membre de l'équipe (une fois)

Créer un [token classic](https://github.com/settings/tokens/new?scopes=public_repo&description=Pause%20d%C3%A9j) (le lien pré-remplit le formulaire) :

- **Expiration** : une durée raisonnable, par exemple 90 jours.
- **Scopes** : uniquement `public_repo`.

Ensuite, coller le token (`ghp_…`) sur le site. Il reste uniquement dans le navigateur (`localStorage`).

> Pourquoi pas un fine-grained token ? Ce type de token ne peut viser que les dépôts de son propre compte ou ceux d'une organisation dont on est membre. Un simple collaborateur du dépôt ne le voit donc pas dans la liste.

## Développement local

En local, pas besoin de GitHub. `dev-server.js` sert le site et imite l'API GitHub, en stockant les données dans `local-db.json`. Ce fichier est ignoré par git, et il suffit de le supprimer pour repartir de zéro.

```sh
npm start   # http://localhost:3000 (PORT=xxxx npm start pour changer de port)
npm test    # tests de la logique (session de 14h, parsing des liens, votes)
```

Ou avec Docker, sans avoir besoin de Node sur la machine :

```sh
docker compose up                                  # http://localhost:3000 (PORT=8080 docker compose up)
docker compose run --rm app npm run init-restos    # regénère la liste des restos
docker compose run --rm app npm test
```

Sur le site, on saisit simplement un prénom à la place du token. Pour simuler un collègue, il suffit d'ouvrir une fenêtre de navigation privée avec un autre prénom.
