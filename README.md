Ceci est le projet sampler fait en groupe par ALECU Luca et Baptiste GIACCHERO:

Répartition des taches:
La partie obligatoire de FRONT-END (sampler) sans compter quelques fonctionnalités comme les barres de progression animées
ont été faite  ensemble de manière relativement égale par ALECU Luca et baptiste giacchero.

La partie optionnelle de de FRONT-END (sampler) ainsi que quelques fonctionnalités comme les barres de progression animées
ont été faites par ALECU Luca.

La partie Angular a été faite par Baptiste GIACCHERO.

Utilisation d'IA:
Le seul outils utilisé a été copilot, la partie FRONT-END (sampler) ayant été réalisé majoritèrement avant de recevoir les consignes nous ne possèdons plus les prompt précis concernant cette partie.

pour les parties récente du FRONT-END (sampler) les prompts majeurs sont:

-dans le contexte de ce projet, qu'est ce qu'un headless et que doit il réaliser, comment doit il fonctionner, détail ta  réponse le plus possible.

-dans ce projet on a séparé la GUI du moteur audio, cette séparation est elle propre, si oui pourquoi.

-dans le dossier contexte je t'ai donné un exemple du cours de barre de progression, explique en détail ligne par ligne son fonctionnement



Pour la partie Angular les prompts majeurs sont:

« Analyse tout le code du sampler et explique-moi comment les presets sont chargés depuis l’API et appliqués aux pads. »

« Fais un mapping entre les exigences du sujet et les fichiers/fonctions de mon projet actuel, et dis-moi ce qui manque. »

« Configure Angular pour communiquer avec mon back-end sur http://localhost:3000, qui lui mme utilise CORS»

« Empêche la création d’un preset si une des URLs ne pointe pas vers un fichier audio valide sur mon back-end. »

« Fais en sorte que les fichiers audio ajoutés par drag & drop se cumulent avec ceux du file picker, dans la limite de 16. »

« Mutualise toute la logique d’upload et de validation d’URLs dans un utilitaire partagé pour éviter la duplication entre composants. »

« Explique moi les messages d’erreur Angular pour les opérations sur les presets »

« Identifie le code dupliqué entre CreateSamplerComponent et ModifySamplerComponent et propose un refactoring propre. »

« Assure-toi que les presets créés/modifiés via Angular restent compatibles avec le sampler (structure JSON, chemins d’URLs). »

« Explique comment un preset JSON est transformé en URLs utilisées par le sampler dans js/presets.js. »

« Quand je charge tel preset, le sampler affiche ‘Unable to decode audio data’ : analyse la cause explique en détails l'origine du problème ainsi que la façon de le régler. »


### Lancement Partie Sampler (Front End)
Il faut se placer dans le dossier ExempleRESTEndpointCorrige dans le terminal bash
```bash
npm i cors
```
puis faire 

```bash
npm run start
```

et enfin faire Open with live serveur dans le dossier index.html

### Lancement Angular avec `ng serve`

Prérequis :
- Node.js installé (version 18+).
- Le back-end démarré dans `ExampleRESTEndpointCorrige` (`npm run start`).

Depuis la racine du projet :

```bash
cd angular
npm install      # à faire une seule fois
npx ng serve     # ou: npm run start si un script est défini
```

Par défaut, Angular démarre sur `http://localhost:4200/`.

L’app appelle l’API de presets sur `http://localhost:3000/api/presets`.

Si l’URL du back-end change, mettre à jour `src/environments/environment.ts` :

```ts
export const environment = {
	production: false,
	apiBase: 'http://localhost:3000'
};
```

### Test headless (sans GUI)
Un test sans interface graphique est fourni dans [headless-test.html](headless-test.html).

Il faut se placer dans le dossier ExempleRESTEndpointCorrige dans le terminal bash
```bash
npm i cors
```
puis faire 

```bash
npm run start
```

puis faire Open with live serveur dans le dossier

Les résultats s’affichent dans la console et sur la page (sans widgets UI).

### Explications Sampler classique
Information CRITIQUE:
 La partie de sauvegarde de nouveau preset ou de nouveaux sons a été faite avant de recevoir les consignes et cela ayant une application similaire a votre demande "10.OPTIONNEL (MAIS SOUHAITE): possibilité de sauvegarder un nouveau preset sur le serveur." notez que ce que nous avons implémenté ne réalise pas ceci mais une autre façon de faire qui est de les sauvegarder dans la mémoire locale du navigateur, même si cette fonctionnalité est moins bonne que celle sugérée nous avons préféré la conserver malgré tout.

1. Architecture globale du sampler Web

- `index.html` : point d'entrée HTML, charge le Web Component `<audio-sampler>`.

Structure principale (dossier `js/`) :

- `sampler-component.js` : Web Component encapsulant toute l'interface via Shadow DOM.
- `main.js` : orchestre l'initialisation et gère l'AudioContext.
- `soundutils.js` : moteur audio pur (chargement, décodage, lecture via Web Audio API).
- `presets.js` : gestion des presets (chargement depuis l'API, construction de la grille 4×4).
- `assignments.js` : logique d'assignation de sons aux pads (drag & drop, file picker).
- `waveform-ui.js` : interface de visualisation des formes d'onde et trimming.
- `waveforms.js` : rendu canvas des waveforms (mini et grande).
- `recorder.js` : gestion du micro (`getUserMedia`, `MediaRecorder`).
- `ui-presets.js` : UI du sélecteur de presets et actions avancées (slicing, pitch sampler).
- `ui-helpers.js` : utilitaires DOM (création d'éléments, popups).
- `choosers.js` : popups de sélection de sons (enregistrements, sons locaux).
- `indexeddb.js` : stockage local des enregistrements via IndexedDB.
- `trimbarsdrawer.js` : gestion graphique des barres de trim sur l'overlay canvas.
- `utils.js` : fonctions utilitaires génériques (conversion pixel↔secondes, etc.).

Séparation GUI / Moteur audio :

- **Moteur audio** : `soundutils.js` expose `loadAndDecodeSound()`, `loadAndDecodeSoundWithProgress()` et `playSound()` qui manipulent l'`AudioContext` et les `AudioBuffer`. Ces fonctions sont pures et ne touchent pas le DOM.
- **GUI** : tous les autres modules UI (`waveform-ui.js`, `assignments.js`, `ui-presets.js`, etc.) reçoivent ces fonctions audio en injection de dépendances et ne créent jamais directement l'`AudioContext`.
- **Composition** : `main.js` crée l'`AudioContext`, importe les modules, injecte les dépendances et branche les écouteurs d'événements.

2. Modules et composants en détail

2.1 `index.html` et `sampler-component.js` (point d'entrée)

Rôle :
- `sampler-component.js` définit le Custom Element :
  - Crée un Shadow DOM fermé (`mode: 'closed'`).
  - Injecte le HTML et les styles inlinés (copie de `css/styles.css`).
  - Appelle `initApp(shadowRoot)` depuis `main.js` lors du `connectedCallback`.

2.2 `main.js` 

Rôle :
- Point d'orchestration central de l'application.
- Crée l'`AudioContext` unique.
- Initialise tous les modules en leur injectant leurs dépendances :
  - Moteur audio : `loadAndDecodeSound`, `loadAndDecodeSoundWithProgress`, `playSound`.
  - État partagé : `trimPositions` (Map stockant start/end par URL), `currentButtons` (tableau des 16 boutons).
  - Accesseurs de configuration : `KEYBOARD_KEYS` (mapping clavier AZERTY 4×4).
- Séquence d'initialisation :
  1. Création du contexte audio.
  2. Initialisation de l'UI waveform (`initWaveformUI`).
  3. Initialisation des assignments (`initAssignments`).
  4. Initialisation du module presets (`initPresets`).
  5. Fetch des presets depuis l'API (`/api/presets`).
  6. Initialisation de l'UI presets (`initUIPresets`) pour le sélecteur custom.
  7. Initialisation du recorder (`initRecorder`).
  8. Branchement des écouteurs clavier globaux.
  9. Création de l'UI persistante d'actions d'enregistrement.
- Expose `decodeFileToBuffer(file)` pour décoder un fichier local en `AudioBuffer`.
- Branche l'événement custom `waveform-trim-changed` pour synchroniser `trimPositions`.

Fonctions principales :
- `initApp(root)` : initialise toute l'application à partir d'un nœud racine (Shadow DOM ou document).
- `showRecordingActions(container, info)` : affiche les boutons d'actions pour un enregistrement/son chargé.
- `onGlobalKeyDown(e)` : gère les touches clavier pour déclencher les pads (mapping AZERTY).
- `createPersistentRecordingActions()` : crée une UI permanente d'actions sur le dernier enregistrement.

2.3 `soundutils.js` 

Rôle :
- Fournit les fonctions de base du moteur audio, sans aucune dépendance DOM.

Fonctions exportées :
- `loadAndDecodeSound(url, ctx)` :
  - Charge un fichier audio via `fetch()`.
  - Décode via `ctx.decodeAudioData()`.
  - Retourne une `Promise<AudioBuffer>`.
- `loadAndDecodeSoundWithProgress(url, ctx, onProgress)` :
  - Charge via `XMLHttpRequest` pour obtenir les événements `onprogress`.
  - Appelle `onProgress(loaded, total)` pendant le téléchargement.
  - Décode et retourne l'`AudioBuffer`.
  - Utilisé pour les barres de progression animées lors du chargement des presets.
- `playSound(ctx, buffer, startTime, endTime, playbackRate?)` :
  - Crée un `AudioBufferSourceNode` (one-shot).
  - Connecte à `ctx.destination`.
  - Démarre la lecture avec `start(0, startTime, endTime - startTime)`.

Principe "fire and forget" :
- Chaque appel à `playSound()` crée un nouveau nœud source (les `BufferSourceNode` ne peuvent être démarrés qu'une seule fois).

2.4 `presets.js` (gestion des presets)

Rôle :
- Gère le chargement et l'affichage des presets.
- Stocke les presets générés dynamiquement (pitch sampler, slicing, sons locaux).

Fonctions principales :
- `fetchPresets(url)` : récupère la liste des presets depuis `/api/presets`.
- `normalizePresets(raw)` : transforme la réponse JSON en structure uniforme `{ name, files: [urls...] }`.
- `createPresetFromBuffers(name, buffers, names, type, pitchRates)` :
  - Crée un preset généré en mémoire (non sauvegardé dans l'API).
  - Stocke dans `generatedPresetStore` (Map).
  - Retourne un `<option>` pour l'ajouter au sélecteur.
- `setAssignments(a)`, `setWaveformUI(ui)` : injecte les modules complémentaires.
- `getDecodedSounds()` : retourne les buffers du preset actuel (pour réutilisation dans les presets générés).

Mapping de la grille :
- Les sons sont affichés de bas en haut, gauche à droite :
  ```
  [ 0  1  2  3 ]  → sons 13 à 16
  [ 4  5  6  7 ]  → sons  9 à 12
  [ 8  9 10 11 ]  → sons  5 à  8
  [12 13 14 15 ]  → sons  1 à  4
  ```

2.5 `assignments.js` (assignation de sons aux pads)

Rôle :
- Gère l'assignation de fichiers audio locaux ou d'enregistrements aux slots de la grille.
- Gère le drag & drop et le file picker.

Fonctions principales :
- `assignFileToSlot(file, slotIndex, targetBtn?)` :
  - Décode le fichier via `decodeFileToBuffer`.
  - Crée une pseudo-URL `local:${file.name}` pour identifier le son.
  - Remplace le bouton dans la grille avec un nouveau nœud.
  - Branche le click handler pour jouer le son (avec trim).
  - Réactive drag & drop et file picker sur le nouveau bouton.
- `assignBufferToSlot(buffer, name, slotIndex)` :
  - Variante pour assigner directement un `AudioBuffer` (sans fichier source).
- `enableDragDropOnButton(btn, slotIndex)` :
  - Branche les écouteurs `dragenter`, `dragover`, `dragleave`, `drop`.
  - Extrait le fichier depuis `dataTransfer`.
  - Appelle `assignFileToSlot` avec le bouton exact en paramètre pour un remplacement précis.
- `enableFilePickerOnButton(btn, slotIndex)` :
  - Ajoute l'icône "+" en bas à droite du bouton.
  - Au clic : affiche un popup `showRecordingsChooser` offrant :
    - Sélection d'un enregistrement IndexedDB.
    - Ou ouverture du file picker natif.
  - Une fois un son sélectionné : appelle `assignFileToSlot`.
- `displayNumberToSlotIndex(displayNumber)` :
  - Convertit un numéro affiché (1–16, bas-gauche) en index de slot interne.

Mapping display → slot :
- Les numéros affichés (1–16) correspondent à l'ordre visuel bas-gauche → haut-droite.
- Mapping interne : `[12,13,14,15, 8,9,10,11, 4,5,6,7, 0,1,2,3]`.

2.6 `waveform-ui.js` et `waveforms.js` (visualisation audio)

Rôle de `waveforms.js` :
- Fonctions pures de rendu canvas.
- `drawWaveform(buffer, canvas, overlayCanvas)` : dessine la waveform principale (800×120 px).
- `drawMiniWaveform(buffer, canvas)` : dessine une mini waveform (preview 80 px height).
- `drawWaveformBase(buffer, canvas, opts)` : fonction générique sous-jacente avec options de style.

Rôle de `waveform-ui.js` :
- Crée et gère l'UI de visualisation audio avec trims.
- `initWaveformUI(buttonsContainer)` :
  - Crée un conteneur `#waveformContainer` inséré avant la grille de boutons.
  - Crée deux canvas superposés :
    - `waveformCanvas` : affiche la waveform.
    - `overlayCanvas` : affiche les barres de trim (transparent, reçoit les clics).
  - Instancie un `TrimbarsDrawer` pour gérer le drag des barres.
  - Branche les événements souris : `onmousemove`, `onmousedown`, `onmouseup`.
  - Lance une boucle d'animation (`requestAnimationFrame`) pour redessiner les barres.
  - Cache l'UI par défaut (visible uniquement quand un son est sélectionné).
- `showWaveformForSound(buffer, url, trimPositionsMap)` :
  - Affiche le conteneur.
  - Dessine la waveform via `drawWaveform`.
  - Restaure les positions de trim depuis `trimPositionsMap` (ou initialise à 0/duration).
  - Convertit secondes → pixels pour positionner les barres.
- Au relâchement de souris (`onmouseup`) : déclenche un événement custom `waveform-trim-changed` avec `{ url, start, end }` pour synchroniser `trimPositions` dans `main.js`.

Retour :
- Objet avec `{ waveformCanvas, overlayCanvas, trimbarsDrawer, showWaveformForSound, ... }`.

2.7 `trimbarsdrawer.js` (barres de trim)

Fichier : `js/trimbarsdrawer.js`

Rôle :
- Classe gérant l'état et le rendu des deux barres de trim (gauche/droite).
- `startDrag()` : détecte quelle barre est proche de la souris et active le drag.
- `moveTrimBars(mousePos)` : déplace la barre en drag si active.
- `stopDrag()` : désactive le drag.
- `draw()` : dessine les deux barres verticales sur le canvas avec un rectangle de surbrillance entre elles.
- `clear()` : efface le canvas overlay.

2.8 `recorder.js` (enregistrement micro)

Fichier : `js/recorder.js`

Rôle :
- Gère l'accès au micro via `getUserMedia` et l'enregistrement via `MediaRecorder`.

Fonction principale :
- `initRecorder(deps)` :
  - Retourne un objet avec `{ startRecording, stopRecording, isRecording }`.
- `startRecording()` :
  - Demande l'accès micro (`getUserMedia({ audio: true })`).
  - Crée un `MediaRecorder` sur le stream.
  - Enregistre les chunks dans `recordedChunks`.
  - Au stop (`onstop`) :
    - Crée un `Blob` avec les chunks.
    - Décode le blob en `AudioBuffer`.
    - Dessine une mini waveform sur `lastRecordingCanvas`.
    - Appelle `showRecordingActions` pour afficher les boutons d'action (Ajouter au sampler, Sauvegarder, Charger).
- `stopRecording()` :
  - Stoppe l'enregistreur si actif.
  - Remet le bouton en mode "Enregistrer avec le micro".

2.9 `ui-presets.js` (UI avancée des presets)

Rôle :
- Gère l'UI du sélecteur de presets custom (remplace le `<select>` natif par un dropdown stylé).
- Gère le menu "Ajouter un preset" avec trois options :
  1. **Créer un sampler à partir des sons locaux** : popup de sélection multi-sons, puis création d'un preset généré en mémoire.
  2. **Slicer un enregistrement sur les silences** : analyse le dernier enregistrement, découpe sur les silences via un algorithme de détection d'enveloppe, crée un preset avec les slices.
  3. **Créer un sampler en pitchant le son** : prend un son source, génère 16 variations de pitch (de 0.6× à 1.8×), crée un preset "pitch sampler".

Fonctions principales :
- `createCustomPresetDropdown()` :
  - Cache le `<select>` natif.
  - Crée un bouton custom avec label + caret.
  - Crée un dropdown positionné via `position: absolute`.
  - Remplit le dropdown avec les options du select.
  - Au clic sur une option : met à jour le `<select>` et déclenche l'événement `change`.
- `showAddPresetMenu(anchorEl)` :
  - Affiche un menu contextuel avec trois boutons.
  - Bouton 1 : ouvre `showLocalSoundsChooser` avec tous les sons actuellement chargés, permet d'en sélectionner jusqu'à 16, puis crée un preset via `presetsModule.createPresetFromBuffers`.
  - Bouton 2 : récupère le dernier enregistrement (ou buffer visible), applique `sliceBufferOnSilence()` (fonction inline) :
    - Calcule l'enveloppe du signal (moyenne mobile de la valeur absolue).
    - Détecte les zones sous un seuil (silence).
    - Groupe les zones sonores entre les silences.
    - Retourne un tableau d'`AudioBuffer` (un par slice).
    - Limite à 16 slices, crée un preset.
  - Bouton 3 : prend un buffer source, génère un tableau de 16 taux de pitch (linéaire de 0.6 à 1.8), crée un preset "pitch" avec `createPresetFromBuffers(..., 'pitch', rates)`.

2.10 `choosers.js` (popups de sélection)

Rôle :
- Fournit des popups réutilisables pour sélectionner des sons depuis différentes sources.

Fonctions principales :
- `showRecordingsChooser(slotIndex, anchorEl, deps)` :
  - Affiche un popup avec deux onglets :
    - "Enregistrés" : liste les enregistrements stockés dans IndexedDB via `listRecordings()`.
    - "Local file" : bouton pour ouvrir le file picker natif.
  - Permet de sélectionner un enregistrement et de l'assigner au slot.
  - Branche `wireLocal(callback)` pour ouvrir le file picker.
- `showLocalSoundsChooser(anchorEl, onSelect, deps, onLoad?, opts?)` :
  - Affiche un popup avec une liste de sons (sons locaux + enregistrements IndexedDB).
  - Mode multi-sélection (checkboxes) ou simple sélection.
  - Bouton "Play" : permet de prévisualiser un son avant de l'ajouter.
  - Bouton "Créer" (optionnel) : valide la sélection et appelle `onSelect(selectedItems)`.
  - Utilisé pour créer des presets composites ou assigner plusieurs sons.

2.11 `indexeddb.js` (stockage local)

Fichier : `js/indexeddb.js`

Rôle :
- Gère le stockage des enregistrements dans IndexedDB.
- Base de données : `samplerRecordings`, store : `recordings`.
- Structure : `{ id, blob, name, type, created }`.

Fonctions exportées :
- `saveRecording(blob, name)` : ajoute un nouvel enregistrement.
- `listRecordings()` : retourne tous les enregistrements.
- `getRecording(id)` : récupère un enregistrement par son ID.
- `deleteRecording(id)` : supprime un enregistrement.

2.12 `ui-helpers.js` (utilitaires DOM)

Rôle :
- Fonctions utilitaires pour créer des éléments DOM et gérer des popups.

Fonctions principales :
- `mkBtn(...classes)` : crée un `<button>` avec des classes CSS.
- `mkDiv(styleObj)` : crée un `<div>` avec des styles inline.
- `mkEl(tag, classNames, styleObj)` : crée un élément générique.
- `attachOutsideClick(el, onOutside)` : branche un écouteur de clic document pour fermer un popup au clic extérieur.
- `placePopupNear(anchorEl, popupEl, opts)` : positionne un popup près d'un élément ancre (en dessous, à droite, à gauche, etc.) avec ajustement automatique si débordement de viewport.
- `makeListRow(labelText, actions, opts)` : crée une ligne de liste avec un label et des boutons d'action (utilisé dans les choosers).

2.13 `utils.js` (utilitaires génériques)

Rôle :
- Fonctions de conversion et utilitaires divers.

Fonctions principales :
- `pixelToSeconds(px, duration, canvasWidth)` : convertit une position pixel en secondes.
- `secondsToPixel(seconds, duration, canvasWidth)` : inverse.
- Utilisé pour synchroniser les positions de trim entre pixels (canvas) et secondes (audio).


3.1 Enregistrement micro

1. Utilisateur clique sur "Enregistrer avec le micro".
2. `recorder.startRecording()` :
   - Demande accès micro (`getUserMedia`).
   - Crée un `MediaRecorder` et démarre l'enregistrement.
   - Bouton devient "Stop".
3. Utilisateur clique sur "Stop" → `recorder.stopRecording()`.
4. `MediaRecorder.onstop` :
   - Crée un `Blob` avec les chunks enregistrés.
   - Décode en `AudioBuffer`.
   - Dessine une mini waveform sur `lastRecordingCanvas`.
   - Appelle `showRecordingActions` avec `{ buffer, blob, file, name }`.
5. UI d'actions persistante s'affiche avec :
   - **Play** : joue le buffer complet.
   - **Ajouter au sampler** : prompt pour choisir un slot, puis assigne le son.
   - **Sauvegarder l'audio** : prompt pour le nom, puis sauvegarde dans IndexedDB via `saveRecording`.
   - **Charger enregistrés/API** : ouvre un chooser pour remplacer le son affiché.

3.2 Création d'un preset généré (slicing, pitch, sons locaux)

1. Utilisateur clique sur "Ajouter un preset".
2. Menu contextuel avec trois options.

**Option 1 : Sons locaux**
- Ouvre `showLocalSoundsChooser` avec tous les sons actuellement chargés.
- Utilisateur sélectionne jusqu'à 16 sons.
- Appelle `presetsModule.createPresetFromBuffers(name, buffers, names, 'buffers')`.
- Ajoute un `<option>` au sélecteur et charge le preset.

**Option 2 : Slicing**
- Récupère le dernier enregistrement ou buffer affiché.
- Applique l'algorithme de slicing sur les silences.
- Crée un preset avec les slices (max 16).

**Option 3 : Pitch sampler**
- Prend un buffer source (dernier enregistrement ou premier son local).
- Génère 16 taux de pitch linéaires (0.6 à 1.8).
- Crée un preset avec les mêmes buffers mais différents playback rates.
- Le click handler de chaque pad passe le `playbackRate` à `playSound`.

3.3 Gestion du clavier

1. Écouteur global `onGlobalKeyDown` dans `main.js`.
2. Mapping AZERTY 4×4 :
   ```
   Row 1: &  é  "  '
   Row 2: a  z  e  r
   Row 3: q  s  d  f
   Row 4: w  x  c  v
   ```
3. Lorsqu'une touche est pressée :
   - Vérifie que ce n'est pas un input/textarea actif.
   - Trouve l'index du bouton correspondant dans `KEYBOARD_KEYS`.
   - Ajoute une classe CSS `keyboard-active` temporairement (140ms).
   - Déclenche un clic sur le bouton via `btn.click()`.

4. Résumé de l'architecture

Le sampler Web est une application modulaire avec une séparation nette entre :
- **Moteur audio** (`soundutils.js`) : fonctions pures de chargement et lecture via Web Audio API.
- **UI** : modules dédiés (waveform, presets, assignments, recorder, etc.) qui reçoivent le moteur en injection de dépendances.
- **Composition** (`main.js`) : orchestre l'initialisation, crée l'`AudioContext`, branche les événements globaux.

### Explication angular

1.Architecture globale de l’app Angular:

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

2.Composants et services en détail

2.1 `AppComponent` (shell principal)

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

2.2 `PresetsService`

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

2.3 Utilitaires audio : `preset-audio-utils.ts`

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

2.4 `PresetsListComponent` (liste des presets)

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

2.5 `CreateSamplerComponent` (création de preset)

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

2.6 `ModifySamplerComponent` (édition de preset)

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
