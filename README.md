# Franchise PY · Suivi du forfait 218 jours

Application web (cycle juin → mai) pour les directeurs et cadres au forfait jours.
- Chaque salarié se connecte avec son adresse e-mail et ne voit que son planning (prévu / réel, CP, RTT, validation mensuelle signée avec déclarations de repos et de charge de travail).
- La DRH (administrateurs) voit toute l'équipe, gère les fiches et les quotas individuels (jours à travailler, CP, RTT), vise les mois et exporte en CSV.
- Hébergement : pages statiques (GitHub Pages) + base et authentification **Supabase** (région Europe).
  La sécurité repose sur la RLS de la base, pas sur le code de la page.

## Contenu
| Fichier | Rôle |
|---|---|
| `index.html`, `style.css`, `app.js` | l'application |
| `config.js` | adresse et clé **publique** Supabase (à renseigner) |
| `vendor/supabase.js` | bibliothèque Supabase 2.116.0, copiée localement (aucun CDN) |
| `supabase/schema.sql` | tables, règles d'accès (RLS), verrous métier |
| `supabase/*_prive*.sql` | données personnelles de départ et import (non versionnés) |

## Installation (environ 30 minutes)

### 1. Créer le projet Supabase
1. Créez un compte sur supabase.com, puis **New project**.
2. **Region : Europe (Frankfurt ou Paris)**. Choisissez un mot de passe de base de données fort et conservez-le dans un gestionnaire de mots de passe.
3. Ouvrez **SQL Editor**, collez le contenu de `supabase/schema.sql`, cliquez **Run**.
   - Puis exécutez vos données de départ (administrateurs et collaborateurs) : fichier `supabase/seed_prive.sql`, conservé hors de Git car il contient des données personnelles. Modèle : insérer dans `public.collaborateurs` au moins un administrateur (`role = 'admin'`) avec son adresse e-mail.

### 2. Réglages d'authentification (Authentication)
- **Providers > Email** : activé. **Confirm email : ACTIVÉ** (obligatoire : l'adresse doit être prouvée avant tout accès).
- **Password requirements** : longueur minimale 12.
- **Premier accès** : le message Supabase contient un lien de connexion ; en cliquant dessus, le salarié arrive sur l'application et choisit son mot de passe. (Avec un SMTP dédié, vous pouvez aussi ajouter `{{ .Token }}` dans le modèle « Magic link » pour afficher un code à 6 chiffres.)
- **URL Configuration > Site URL** : l'adresse GitHub Pages de l'application, et la même adresse dans **Redirect URLs**.
- **E-mails (indispensable avant d'ouvrir à l'équipe)** : le service d'e-mail intégré de Supabase n'envoie qu'aux membres de votre équipe Supabase et très peu de messages par heure. Configurez un SMTP dédié (Project Settings > Authentication > SMTP, par exemple Brevo, Mailjet ou le SMTP de votre messagerie) pour que les salariés reçoivent leur lien.
- **Multi-factor (TOTP)** : recommandé pour les administrateurs (voir « Pour aller plus loin »).

### 3. Renseigner `config.js`
Dans **Project Settings > API**, copiez :
- `Project URL` → `SUPABASE_URL`
- clé `anon` / `public` → `SUPABASE_ANON_KEY`

N'utilisez **jamais** la clé `service_role` dans ce dépôt.

### 4. Publier sur GitHub Pages
1. Créez un dépôt GitHub et envoyez-y ce dossier. Il ne contient aucune donnée personnelle (les fichiers `*_prive*.sql` sont exclus) : il peut être public, ce qui permet d'utiliser GitHub Pages gratuitement.
2. **Settings > Pages > Build and deployment** : Source = *Deploy from a branch*, branche `main`, dossier `/ (root)`.
   Le site est public, mais ne montre rien sans connexion : les données sont protégées par Supabase.
3. Ouvrez l'adresse du site. Connectez-vous avec l'adresse de l'administrateur : « Première connexion », lien reçu par e-mail, choix du mot de passe.

### 5. Ajouter les collaborateurs
Équipe > fiche du collaborateur > **Adresse e-mail** (son adresse professionnelle existante) > Enregistrer.
À sa première connexion, la personne utilise « Première connexion ou mot de passe oublié », saisit son adresse, clique sur le lien reçu par e-mail, puis choisit son mot de passe.
Ajout, retrait (historique conservé) et suppression définitive se font depuis la même fiche.

## Rôles et droits
| Rôle | Ce qu'il voit | Ce qu'il peut faire |
|---|---|---|
| Salarié | son propre planning | saisir, valider et signer ses mois |
| Superviseur | son planning + le planning des **directeurs** (lecture seule) | consulter, sans modifier |
| Lecteur | **tous** les plannings (lecture seule) | consulter uniquement : pas de forfait jours, absent des statistiques du suivi 218 jours |
| Administrateur (DRH) | tout | modifier les plannings, quotas, fiches, viser et rouvrir les mois |

- Les superviseurs et lecteurs n'accèdent ni aux adresses e-mail, ni aux entretiens, ni aux déclarations de validation. Les arrêts maladie et accidents du travail leur apparaissent sous le code neutre « ABS ». Ce filtrage est fait par la base de données (fonctions `consultation_*`).
- Une modification d'un jour par un administrateur dans un mois déjà validé **annule la validation** : le collaborateur voit un message et doit revalider.
- Pour une base déjà installée, exécutez `supabase/migration_roles_projection.sql`.

## Projection du cycle complet
La page projette le nombre de jours travaillés sur tout le cycle : jours planifiés (réel, sinon prévu) + jours non planifiés estimés (lundi au vendredi travaillés, week-ends en OFF, fériés en JF). Les CP restants retirent 5/6 de jour chacun (CP en jours ouvrables). Deux projections sont affichées : sans prendre les RTT restants, puis avec tous les RTT pris, à raison de 2 RTT consécutifs au maximum par prise. Un avertissement signale plus de 2 RTT consécutifs planifiés.

## Sécurité : ce qui est appliqué côté serveur
- RLS activée sur toutes les tables ; l'accès anonyme est révoqué.
- Un salarié ne lit et n'écrit que ses lignes. Un compte sans fiche active ne voit rien.
- Un mois validé est verrouillé côté base (le salarié ne peut plus modifier ses jours). Seule la DRH peut le rouvrir ou le viser.
- Le rattachement compte ↔ fiche se fait par adresse e-mail **confirmée**.
- L'horodatage de signature est posé par le serveur.
- Content-Security-Policy stricte (scripts locaux uniquement, connexions limitées à `*.supabase.co`), aucune police ni script externe.
- Déconnexion automatique après 30 minutes d'inactivité.

## Limites à connaître
- La signature est une **signature électronique simple** (dessin, identité vérifiée par e-mail, horodatage serveur, empreinte SHA-256 du contenu). Elle prouve qui a validé et quand, sans valeur de signature qualifiée.
- La validation mensuelle comprend un court questionnaire (repos quotidien de 11 h, repos hebdomadaire de 35 h, charge de travail, commentaire libre). Ces réponses et les codes **AM** (arrêt maladie) et **AT** (accident du travail) sont des informations sensibles : le salarié ne voit que les siennes, seule la DRH voit celles de l'équipe. Mentionnez-les dans votre registre RGPD, informez les salariés et conservez les données selon votre politique. Hébergement en Europe.
- Si une personne n'a pas confirmé son adresse e-mail, elle n'accède à rien : c'est voulu.

## Pour aller plus loin
- Double authentification (TOTP) obligatoire pour les administrateurs.
- Sauvegardes : activez les sauvegardes quotidiennes Supabase (offre Pro) ou exportez régulièrement en CSV.
- Journal d'audit des modifications côté DRH.
