Angular Presets Admin (Angular)
================================

Ce dossier contient l’application Angular qui sert d’interface d’administration
pour les presets du sampler Web. Elle communique avec le back-end Express
dans `ExampleRESTEndpointCorrige` via l’API REST `/api/presets` et
`/api/upload/:folder`.

## 1. Lancer l’application avec `ng serve`

Prérequis :
- Node.js installé (version 18+ conseillée).
- Le back-end démarré dans `ExampleRESTEndpointCorrige` (`npm run start`).

Depuis la racine du projet :

```bash
cd angular
npm install      # à faire une seule fois
npx ng serve     # ou: npm run start si un script est défini
```

Par défaut, Angular démarre sur `http://localhost:4200/`.

L’app appelle l’API de presets sur `http://localhost:3000/api/presets`.

Si l’URL du back-end change, mets à jour `src/environments/environment.ts` :

```ts
export const environment = {
	production: false,
	apiBase: 'http://localhost:3000'
};
```

## 2. Architecture globale de l’app Angular

Structure principale (dossier `src/app`) :

- `app.component.*` : shell principal (layout) avec header et `<router-outlet>`.
- `presets.service.ts` : service central pour tous les appels HTTP sur les presets.
- `preset-audio-utils.ts` : fonctions utilitaires partagées pour la gestion des sons.
- `presets-list/` : composant listant tous les presets et les actions de base.
- `create-sampler/` : composant pour créer un nouveau preset.
- `modify-sampler/` : composant pour modifier un preset existant.

Routing (dans `app.module.ts`) :

- `/` → liste des presets (`PresetsListComponent`).
- `/createsampler` → création d’un nouveau preset (`CreateSamplerComponent`).
- `/modifysampler/:name` → modification d’un preset existant (`ModifySamplerComponent`).

Tous ces écrans sont rendus à l’intérieur du shell `AppComponent`.

## 3. Composants et services en détail

### 3.1 `AppComponent` (shell principal)

Fichiers :
- `src/app/app.component.ts`
- `src/app/app.component.html`
- `src/app/app.component.css` (ou styles globaux)

Rôle :
- Affiche le cadre commun de l’application :
	- Titre (“Sampler Presets”).
	- Infos de connexion à l’API.
	- Carte centrale contenant le contenu.
- Héberge le `<router-outlet>` qui affiche les pages : liste, création, modification.

### 3.2 `PresetsService`

Fichier : `src/app/presets.service.ts`

Rôle :
- Point central d’accès à l’API REST `/api/presets` et `/api/upload/:folder`.
- Fournit les méthodes utilisées par les composants :
	- `list()` : récupère la liste complète des presets.
	- `getOne(name)` : récupère un preset par son nom.
	- `create(preset)` : crée un nouveau preset (`POST /api/presets`).
	- `update(oldName, preset)` : remplace/renomme un preset (`PUT /api/presets/:oldName`).
	- `rename(oldName, newName)` : renomme partiellement via `PATCH`.
	- `delete(name)` : supprime un preset.
	- `upload(folder, files)` : envoie des fichiers audio (`POST /api/upload/:folder`).

Types exposés :
- `Preset` : modèle d’un preset (name, type, isFactoryPresets, samples…).
- `PresetSample` : un son dans un preset (`name`, `url`).
- `UploadResponse` : structure renvoyée par `/api/upload/:folder`.

### 3.3 Utilitaires audio : `preset-audio-utils.ts`

Fichier : `src/app/preset-audio-utils.ts`

Rôle :
- Mutualiser la logique “générique” autour des sons et URLs pour éviter
	la duplication entre `CreateSamplerComponent` et `ModifySamplerComponent`.

Fonctions principales :
- `appendAudioFiles(existing, added, max)` :
	- Ajoute des `File` à une liste existante jusqu’à une limite (16 par défaut).
	- Retourne `{ files, truncated }` pour savoir si certains fichiers ont été ignorés.
- `buildSamplesFromUrls(urls)` : construit des `PresetSample` à partir de lignes d’URL.
- `buildSamplesFromUpload(folderName, upload)` : construit des `PresetSample` à partir
	de la réponse d’upload renvoyée par le back-end.
- `isValidAudioUrl(url)` : vérifie qu’une URL pointe vers un fichier audio accessible
	(HEAD sur l’URL, vérification du `Content-Type`).
- `validateUrlSamples(samples)` : contrôle chaque `PresetSample` et renvoie la première
	URL invalide, ou `null` si toutes sont valides.

### 3.4 `PresetsListComponent` (liste des presets)

Dossier : `src/app/presets-list/`

Rôle :
- Affiche la liste de tous les presets retournés par `PresetsService.list()`.
- Montre un nom par preset avec plusieurs actions :
	- **Modifier** → navigue vers `/modifysampler/:name`.
	- **Rename** → simple `prompt` qui appelle `PresetsService.rename`.
	- **Delete** → demande de confirmation puis appelle `PresetsService.delete`.
- Propose un bouton “Créer un preset vide” qui envoie vers `/createsampler`.

Points importants :
- Gestion de l’état :
	- `presets` : tableau de `Preset` affichés.
	- `loading` : indicateur de chargement.
	- `error` : message d’erreur éventuel.
- Rafraîchit la liste après chaque opération (rename/delete) via `load()`.

### 3.5 `CreateSamplerComponent` (création de preset)

Dossier : `src/app/create-sampler/`

Rôle :
- Permet de créer un nouveau preset de trois façons :
	1. **Preset vide** : seulement un nom, sans sons.
	2. **Preset avec URLs** : nom + liste d’URLs de sons.
	3. **Preset avec fichiers audio** : nom + fichiers audio uploadés
		 (+ éventuellement des URLs en plus).

Fonctionnement :
- Formulaire :
	- Champ texte pour le nom du preset.
	- Textarea pour les URLs (une par ligne).
	- Zone de drag & drop + bouton “Parcourir le PC…” pour sélectionner des fichiers audio.
- Validation :
	- Vérifie que le nom n’est pas vide.
	- Vérifie qu’il n’existe pas déjà un preset avec le même nom.
	- Vérifie, si des URLs sont fournies, qu’elles pointent vers des fichiers audio valides
		via `validateUrlSamples`.
	- Limite globale à 16 sons (fichiers + URLs) par preset.
- API :
	- Cas 1 (vide) : `POST /api/presets` avec `samples: []`.
	- Cas 2 (URLs uniquement) : `POST /api/presets` avec `samples` construits via
		`buildSamplesFromUrls`.
	- Cas 3 (fichiers) :
		- Upload via `PresetsService.upload(name, files)`.
		- Construction des `samples` avec `buildSamplesFromUpload` + URLs éventuelles.
		- `POST /api/presets` avec l’ensemble.

### 3.6 `ModifySamplerComponent` (édition de preset)

Dossier : `src/app/modify-sampler/`

Rôle :
- Permet de modifier un preset existant :
	- Changer son nom.
	- Supprimer certains sons existants.
	- Ajouter de nouveaux sons par URL et/ou par upload de fichiers.

Fonctionnement :
- Chargement initial :
	- Récupère le nom dans l’URL (`:name`).
	- Charge le preset correspondant via `PresetsService.getOne`.
	- Initialise :
		- `originalName` : nom actuel (clé pour la mise à jour).
		- `name` : champ éditable.
		- `existingSamples` : liste de sons existants.
- Édition :
	- Suppression d’un son existant via une croix dans la liste.
	- Ajout de nouveaux sons :
		- URLs saisies dans un textarea (une par ligne).
		- Fichiers audio ajoutés via drag & drop / “Parcourir le PC…”.
	- Limite de 16 sons au total (existants + nouveaux fichiers + nouvelles URLs).
	- Validation des nouvelles URLs via `validateUrlSamples`.
- Sauvegarde (`save()`) :
	- Vérifie que le nouveau nom n’est pas vide et ne duplique pas un autre preset.
	- Si pas de nouveaux fichiers :
		- Concatène `existingSamples` + nouveaux `urlSamples`.
		- Envoie un `PUT /api/presets/:originalName` avec les champs mis à jour.
	- Si nouveaux fichiers :
		- Upload via `upload(originalName || name, files)`.
		- Construit de nouveaux `PresetSample` avec `buildSamplesFromUpload`.
		- Concatène anciens + nouveaux + URLs, applique la limite de 16.
		- Envoie le `PUT` avec la nouvelle liste complète de `samples`.

## 4. Résumé du flux fonctionnel

- **Lister** : `/` → `PresetsListComponent` → `GET /api/presets`.
- **Créer** : `/createsampler` → `CreateSamplerComponent` → validations →
	`POST /api/presets` (+ `POST /api/upload/:folder` si fichiers).
- **Modifier** : `/modifysampler/:name` → `ModifySamplerComponent` →
	chargement du preset → édition → `PUT /api/presets/:originalName`
	(+ `POST /api/upload/:folder` si nouveaux fichiers).
- **Renommer rapide** : bouton “Rename” dans la liste → `PATCH /api/presets/:name`.
- **Supprimer** : bouton “Delete” dans la liste → `DELETE /api/presets/:name`.

Cette app Angular est ainsi un panneau d’administration complet pour préparer
et maintenir les presets utilisés par le sampler Web principal.
