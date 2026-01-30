// main.js - Application principale du sampler audio
// Orchestre tous les modules (presets, waveform, recorder, assignments)
// Point d'entrée : initApp(root) pour initialiser l'interface

// Importe les modules utilitaires et fonctionnalités
import { loadAndDecodeSound, loadAndDecodeSoundWithProgress, playSound } from './soundutils.js';
import { pixelToSeconds } from './utils.js';
import { saveRecording, listRecordings, getRecording, deleteRecording } from './indexeddb.js';
import { mkBtn, mkEl, placePopupNear, makeListRow } from './ui-helpers.js';
import { drawWaveform, drawMiniWaveform } from './waveforms.js';
import { showRecordingsChooser, showLocalSoundsChooser } from './choosers.js';
import { initAssignments } from './assignments.js';
import { initPresets } from './presets.js';
import { initWaveformUI } from './waveform-ui.js';
import { initRecorder } from './recorder.js';
import { initUIPresets } from './ui-presets.js';

// === CONFIGURATION ===
// API et serveur audio pour charger les presets et fichiers
const API_BASE = 'http://localhost:3000';               // <- API + fichiers audio
const PRESETS_URL = `${API_BASE}/api/presets`;

// === CONTEXTE AUDIO ET UI ===
// Contexte Web Audio API pour la lecture de sons
let ctx;
// Eléments DOM liés à l'interface
let rootEl = null;
let presetSelect;
let buttonsContainer;
let statusEl;
let errorEl;
let lastRecordingCanvas;
let filePicker;

// === ÉTAT GLOBAL ===
// Données de presets et sons décodés du preset actuel
let presets = [];          // [{ name, files:[absoluteUrl,...] }, ...]
let decodedSounds = [];    // AudioBuffer[] du preset courant
// presets module instance (initialized in window.onload)
let presetsModule = null;
// current visible buttons for keyboard mapping
let currentButtons = [];
// per-sound trim positions stored by url (seconds)
const trimPositions = new Map();

// === CLAVIER ===
// Mapping touches clavier vers grille 4x4 (AZERTY-friendly)
// Rangée 1: &, é, ", '  (touches de chiffres)
// Rangée 2: A, Z, E, R (première rangée lettres AZERTY)
// Rangée 3: Q, S, D, F (rangée accueil)
// Rangée 4: W, X, C, V (rangée du bas)
const KEYBOARD_KEYS = [
  '&','é','"','\'' ,
  'a','z','e','r',
  'q','s','d','f',
  'w','x','c','v'
];

// === VISUALISATION DU WAVEFORM ===
// Canvas pour affichage de la forme d'onde et barres de trim
let waveformCanvas, overlayCanvas, trimbarsDrawer;
let mousePos = { x: 0, y: 0 };
let currentShownBuffer = null;
let currentShownUrl = null;
let showWaveformForSound;

// === INITIALISATION DE L'APPLICATION ===
// Point d'entrée : initialise le contexte audio, lie les modules, charge les presets
export async function initApp(root) {
  rootEl = root || document;
  // Crée le contexte Web Audio pour jouer les sons
  ctx = new AudioContext();

  // Récupère les éléments DOM depuis la racine fournie (Shadow DOM ou document)
  presetSelect = rootEl.querySelector('#presetSelect');
  buttonsContainer = rootEl.querySelector('#buttonsContainer');
  statusEl = rootEl.querySelector('#status');
  errorEl = rootEl.querySelector('#error');
  lastRecordingCanvas = rootEl.querySelector('#lastRecordingCanvas');
  filePicker = rootEl.querySelector('#filePicker');

  // Expose une fonction globale pour que les modules affichage aient accès à la lecture
  window.playSound = (buffer) => {
    try { playSound(ctx, buffer, 0, buffer.duration); } catch (err) { console.warn('global playSound error', err); }
  };

  try {
    // === INITIALISATION DES MODULES ===
    // Crée le module UI du waveform (canvas + overlay pour trim bars)
    // preset loading will be handled by the `presets` module (initialized below)
    // create waveform UI (hidden until a sound is selected) — initialize the extracted module
    const wfui = initWaveformUI(buttonsContainer);
    waveformCanvas = wfui.waveformCanvas;
    overlayCanvas = wfui.overlayCanvas;
    trimbarsDrawer = wfui.trimbarsDrawer;
    // wrap the wfui showWaveformForSound so main.js state stays in sync
    showWaveformForSound = (buffer, url) => {
      try {
        if (typeof wfui.showWaveformForSound === 'function') wfui.showWaveformForSound(buffer, url, trimPositions);
      } catch (err) { console.warn('showWaveformForSound wrapper error', err); }
      currentShownBuffer = buffer;
      currentShownUrl = url;
    };

    // Écoute les changements de position des trim bars et les stocke
    window.addEventListener('waveform-trim-changed', (ev) => {
      try {
        const d = ev && ev.detail;
        if (d && d.url) {
          // diagnostic log to trace trim changes
          try { console.debug('[waveform-trim-changed] url=', d.url, 'start=', d.start, 'end=', d.end); } catch(e){}
          trimPositions.set(d.url, { start: d.start, end: d.end });
        }
      } catch (err) { console.warn('waveform-trim-changed handler error', err); }
    });
    // Initialise le module d'assignation de sons (drag-drop, file picker)
    const assignments = initAssignments({
      decodeFileToBuffer,
      buttonsContainer,
      // provide accessors for currentButtons so the module updates main.js state directly
      getCurrentButtons: () => currentButtons,
      setCurrentButton: (idx, node) => { currentButtons[idx] = node; },
      KEYBOARD_KEYS,
      trimPositions,
      playSound: (buffer, s, e, r) => playSound(ctx, buffer, s, e, r),
      filePicker,
      showRecordingsChooser,
      listRecordings,
      getRecording,
      deleteRecording,
      showWaveformForSound,
      showStatus,
      showError
    });
    // expose assignments module globally for backward-compatible wrappers
    window.assignments = assignments;

    // Initialise le module de gestion des presets (charge JSON, crée la grille)
    // initialize presets module and fetch presets (requires assignments + waveform UI available)
    presetsModule = initPresets({
      API_BASE,
      loadAndDecodeSound: (url) => loadAndDecodeSound(url, ctx),
      loadAndDecodeWithProgress: (url, onProgress) => loadAndDecodeSoundWithProgress(url, ctx, onProgress),
      buttonsContainer,
      KEYBOARD_KEYS,
      playSound: (buffer, s, e, r) => playSound(ctx, buffer, s, e, r),
      showWaveformForSound,
      showStatus,
      showError,
      decodeFileToBuffer,
      drawMiniWaveform,
      trimPositions
    });
    presetsModule.setAssignments(assignments);
    presetsModule.setWaveformUI({ waveformCanvas, trimbarsDrawer });
    // Récupère et normalise les presets depuis l'API
    const raw = await presetsModule.fetchPresets(PRESETS_URL);
    presets = presetsModule.normalizePresets(raw);
    presetsModule.setPresets(presets);
    if (!Array.isArray(presets) || presets.length === 0) {
      throw new Error('Aucun preset utilisable dans la réponse du serveur.');
    }
    fillPresetSelect(presets);
    // Initialise l'UI pour créer de nouveaux presets (slicer, pitch sampler, local)
    const uiPresets = initUIPresets({
      presetSelect,
      showLocalSoundsChooser,
      listRecordings,
      getRecording,
      decodeFileToBuffer,
      drawMiniWaveform,
      ctx,
      getDecodedSounds: () => (presetsModule && typeof presetsModule.getDecodedSounds === 'function') ? presetsModule.getDecodedSounds() : decodedSounds,
      getCurrentButtons: () => currentButtons,
      presetsModuleGetter: () => presetsModule,
      assignments,
      showError,
      showStatus
    });
    uiPresets.createCustomPresetDropdown();
    const addPresetBtn = rootEl.querySelector('#addPresetBtn');
    if (addPresetBtn) addPresetBtn.addEventListener('click', (e) => { e.stopPropagation(); uiPresets.showAddPresetMenu(addPresetBtn); });
    // enable select now
    presetSelect.disabled = false;

    // Crée la barre d'actions pour enregistrement persistant
    createPersistentRecordingActions();
    if (presetsModule && typeof presetsModule.loadPresetByIndex === 'function') await presetsModule.loadPresetByIndex(0);

    // Écoute le changement de sélection de preset et charge les sons
    // 4) Changement de preset
    // keep native select change handler for programmatic changes
    if (presetSelect) presetSelect.addEventListener('change', async () => {
      const idx = Number(presetSelect.value);
      // update custom UI label if present
      const labelBtn = rootEl.querySelector('.custom-select-btn .label');
        if (labelBtn && presetSelect.options && presetSelect.options[idx]) labelBtn.textContent = presetSelect.options[idx].textContent;
        if (presetsModule && typeof presetsModule.loadPresetByIndex === 'function') await presetsModule.loadPresetByIndex(idx);
    });

    // Écoute les touches clavier pour déclencher les sons
    // keyboard listener for triggering sounds via assigned keys
    window.addEventListener('keydown', onGlobalKeyDown);

    // Recorder UI: wire record button and status via recorder module
    const recordBtn = rootEl.querySelector('#recordBtn');
    const recordStatus = rootEl.querySelector('#recordStatus');

    // Initialise le module d'enregistrement via microphone
    const recorder = initRecorder({
      decodeFileToBuffer,
      lastRecordingCanvas,
      waveformCanvas,
      drawMiniWaveform,
      showRecordingActions,
      showStatus,
      showError,
      recordBtn,
      recordStatus
    });

    // Connecte le bouton d'enregistrement à start/stop
    if (recordBtn) {
      recordBtn.onclick = async () => {
        try {
          if (recorder && typeof recorder.isRecording === 'function' && recorder.isRecording()) {
            recorder.stopRecording();
            return;
          }
          if (recorder && typeof recorder.startRecording === 'function') await recorder.startRecording();
        } catch (err) { console.error('recordBtn click error', err); }
      };
    }

  } catch (err) {
    console.error(err);
    showError(err.message || String(err));
  }
}


// Crée la barre persistante d'actions pour enregistrement (visible au démarrage)
// Inclut : Play, Ajouter au sampler, Sauvegarder, Charger
function createPersistentRecordingActions() {
  const container = rootEl ? rootEl.querySelector('#lastRecordingContainer') : document.getElementById('lastRecordingContainer');
  if (!container) return;
  // ensure position relative for absolute left play
  if (!container.style.position) container.style.position = 'relative';

  // left play button
  const playLeft = document.createElement('button');
  playLeft.id = 'persistentRecordingPlayLeft';
  playLeft.type = 'button';
  playLeft.className = 'action-btn';
  playLeft.textContent = 'Play';
  playLeft.style.position = 'absolute';
  playLeft.style.left = '-56px';
  playLeft.style.top = '50%';
  playLeft.style.transform = 'translateY(-50%)';
  playLeft.style.zIndex = '10002';
  playLeft.disabled = true;
  // click handler: play whatever is currently stored in actions._info (if available)
  playLeft.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    try {
      const actions = document.getElementById('persistentRecordingActions');
      const info = actions && actions._info ? actions._info : null;
      if (!info) return;
      if (ctx && ctx.state === 'suspended') await ctx.resume();
      let buffer = info.buffer;
      // try to obtain buffer from file/blob/recId if needed
      if (!buffer) {
        // attempt from file
        const f = info.file || (info.blob ? new File([info.blob], info.name || 'rec.webm', { type: info.blob.type || 'audio/webm' }) : null);
        if (f) {
          try { buffer = await decodeFileToBuffer(f); info.buffer = buffer; } catch (err) { console.warn('decode file for left play failed', err); }
        } else if (info.recId && typeof getRecording === 'function') {
          try {
            const ent = await getRecording(info.recId);
            if (ent && ent.blob) {
              const file2 = new File([ent.blob], ent.name || info.name || 'rec.webm', { type: ent.type || 'audio/webm' });
              buffer = await decodeFileToBuffer(file2);
              info.buffer = buffer;
            }
          } catch (err) { console.warn('getRecording for left play failed', err); }
        }
      }
      if (buffer) {
        // play full buffer from 0 to duration
        playSound(ctx, buffer, 0, buffer.duration);
      }
    } catch (err) { console.error('persistent left play error', err); }
  });
  container.appendChild(playLeft);

  // action row positioned to the right of the canvas
  const actions = document.createElement('div');
  actions.id = 'persistentRecordingActions';
  actions.style.position = 'absolute';
  actions.style.left = `${container.clientWidth + 8}px`;
  actions.style.top = '0px';
  actions.style.zIndex = '10001';
  actions.style.display = 'flex';
  actions.style.flexDirection = 'column';
  actions.style.gap = '8px';

  // Ajouter au sampler
  const addBtn = document.createElement('button');
  addBtn.type = 'button'; addBtn.className = 'action-btn'; addBtn.textContent = 'Ajouter au sampler'; addBtn.disabled = true;
  addBtn.addEventListener('click', async () => {
    const info = actions._info || {};
    const s = prompt('Numéro du slot (1–16) pour assigner ce son:', '1');
    if (!s) return; const n = Number(s); if (!n || isNaN(n) || n < 1 || n > 16) { alert('Numéro invalide'); return; }
    // map display number (1..16, bottom-left ordering) to internal slot index
    const target = (assignments && typeof assignments.displayNumberToSlotIndex === 'function') ? assignments.displayNumberToSlotIndex(n) : (n - 1);
    if (target === null) { alert('Numéro invalide'); return; }
    try {
      if (info.file) { await assignments.assignFileToSlot(info.file, target); showStatus(`Assigné au slot ${n}`); }
      else if (info.blob) { const f = new File([info.blob], info.name || `rec-${Date.now()}.webm`, { type: info.blob.type || 'audio/webm' }); await assignments.assignFileToSlot(f, target); showStatus(`Assigné au slot ${n}`); }
      else if (info.buffer && typeof assignments.assignBufferToSlot === 'function') { await assignments.assignBufferToSlot(info.buffer, info.name || 'sound', target); showStatus(`Assigné au slot ${n}`); }
      else { alert('Aucun son disponible à assigner'); }
    } catch (err) { console.error('assign from persistent actions error', err); showError('Impossible d’assigner le son'); }
  });

  // Enregistrer: do not move the top '#recordBtn' here — leave it in the recorder bar

  // Charger enregistrés/API
  const loadBtn = document.createElement('button');
  loadBtn.type = 'button'; loadBtn.className = 'action-btn'; loadBtn.textContent = 'Charger enregistrés/API'; loadBtn.disabled = false;
  loadBtn.addEventListener('click', async () => {
    try {
      const info = actions._info || {};
      const deps = { listRecordings, getRecording, decodeFileToBuffer, decodedItems: [{ id: 'current', source: 'local', buffer: info.buffer, name: info.name, index: 0 }] };
      await showLocalSoundsChooser(loadBtn, async (selectedItems) => {
        if (selectedItems && selectedItems.length > 0) {
          const it = selectedItems[0];
          if (it.buffer) {
            try { if (lastRecordingCanvas) drawMiniWaveform(it.buffer, lastRecordingCanvas); } catch (err) { console.warn('draw preview error', err); }
            const labelEl = document.getElementById('lastRecordingLabel'); if (labelEl) labelEl.textContent = 'Son chargé/enregistré';
            actions._info = actions._info || {}; actions._info.buffer = it.buffer; actions._info.name = it.name;
            Array.from(actions.querySelectorAll('button')).forEach(b => b.disabled = false);
            const left = document.getElementById('persistentRecordingPlayLeft'); if (left) left.disabled = false;
          }
        }
      }, deps, async (selectedItems) => {
        if (selectedItems && selectedItems.length > 0) {
          const it = selectedItems[0];
          if (it.buffer) {
            try { if (lastRecordingCanvas) drawMiniWaveform(it.buffer, lastRecordingCanvas); } catch (err) { console.warn('draw preview error', err); }
            const labelEl = document.getElementById('lastRecordingLabel'); if (labelEl) labelEl.textContent = 'Son chargé/enregistré';
            actions._info = actions._info || {}; actions._info.buffer = it.buffer; actions._info.name = it.name;
            Array.from(actions.querySelectorAll('button')).forEach(b => b.disabled = false);
            const left = document.getElementById('persistentRecordingPlayLeft'); if (left) left.disabled = false;
          }
        }
      }, { showCheckboxes: false, showCreateButton: false });
    } catch (err) { console.error('load chooser error', err); showError('Impossible de charger'); }
  });

  // create a save button local to the persistent actions (restore original save behaviour)
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button'; saveBtn.className = 'action-btn'; saveBtn.textContent = "Sauvegarder l'audio"; saveBtn.disabled = true;
  saveBtn.addEventListener('click', async () => {
    try {
      const info = actions._info || {};
      const suggested = info.name || `mic-${Date.now()}.webm`;
      const name = prompt('Nom pour cet enregistrement:', suggested) || suggested;
      const blob = info.blob || (info.file ? new Blob([info.file], { type: info.file.type }) : null);
      if (!blob) { showError('Aucun blob à sauvegarder'); return; }
      await saveRecording(blob, name);
      showStatus('Enregistré');
    } catch (err) { console.error('save recording error', err); showError('Erreur lors de la sauvegarde'); }
  });

  actions.appendChild(addBtn); actions.appendChild(saveBtn); actions.appendChild(loadBtn);
  container.appendChild(actions);
}


// === FONCTIONS UI SIMPLES ===

// Remplit le dropdown de sélection de presets
function fillPresetSelect(presets) {
  if (!presetSelect) return;
  presetSelect.innerHTML = '';
  presets.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = p.name || `Preset ${i + 1}`;
    presetSelect.appendChild(opt);
  });
}

// Affiche un message de statut
function showStatus(msg) { statusEl.textContent = msg || ''; }
// Affiche un message d'erreur et efface le statut
function showError(msg)  { errorEl.textContent = msg || ''; showStatus(''); }
function resetButtons()  { buttonsContainer.innerHTML = ''; }

// Efface les boutons et synchronise l'état interne
function clearButtons() {
  buttonsContainer.innerHTML = '';
  currentButtons = [];
}

// === CHARGEMENT DES ENREGISTREMENTS ===

// Affiche la barre d'actions pour le dernier son enregistré ou chargé
// info: { buffer, file, blob, name }
function showRecordingActions(anchorContainer, info) {
  if (!anchorContainer) return;
  // Si l'UI persistant existe, le met à jour au lieu de créer une nouvelle barre
  const persistent = rootEl ? rootEl.querySelector('#persistentRecordingActions') : document.getElementById('persistentRecordingActions');
  const leftPersistent = rootEl ? rootEl.querySelector('#persistentRecordingPlayLeft') : document.getElementById('persistentRecordingPlayLeft');
  if (persistent && leftPersistent) {
    persistent._info = info;
    const hasBlobOrBuffer = !!(info && (info.buffer || info.blob || info.file));
    Array.from(persistent.querySelectorAll('button')).forEach(b => { b.disabled = !hasBlobOrBuffer; });
    // also enable/disable the left-side play button (it's not inside the persistent container)
    leftPersistent.disabled = !hasBlobOrBuffer;
    // update left play handler
    leftPersistent.onclick = async (ev) => {
      ev.stopPropagation();
      try {
        if (ctx && ctx.state === 'suspended') await ctx.resume();
        let buffer = info.buffer;
        if (!buffer) {
          const f = info.file || (info.blob ? new File([info.blob], info.name || 'rec.webm', { type: info.blob.type || 'audio/webm' }) : null);
          if (f) {
            buffer = await decodeFileToBuffer(f);
            info.buffer = buffer;
          }
        }
        if (buffer) playSound(ctx, buffer, 0, buffer.duration);
      } catch (err) { console.error('Error playing from persistent left button', err); }
    };
    return;
  }

    // left-side Play button (inside same container, positioned to the left of the canvas)
    const playLeft = document.createElement('button');
    playLeft.id = 'recordingPlayLeft';
    playLeft.type = 'button';
    playLeft.className = 'action-btn';
    playLeft.textContent = 'Play';
    // position it on the left side of the canvas
    playLeft.style.position = 'absolute';
    playLeft.style.left = `-56px`;
    playLeft.style.top = '50%';
    playLeft.style.transform = 'translateY(-50%)';
    playLeft.style.zIndex = '10002';
    // click handler: play the loaded buffer (decode if needed)
    playLeft.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      try {
        // ensure audio context resumed
        if (ctx && ctx.state === 'suspended') await ctx.resume();
        let buffer = info.buffer;
        if (!buffer) {
          // try decode from file/blob if available
          const f = info.file || (info.blob ? new File([info.blob], info.name || 'rec.webm', { type: info.blob.type || 'audio/webm' }) : null);
          if (f) {
            buffer = await decodeFileToBuffer(f);
            info.buffer = buffer;
          }
        }
        if (buffer) {
          // play full buffer
          playSound(ctx, buffer, 0, buffer.duration);
        }
      } catch (err) {
        console.error('Error playing preview from left button', err);
      }
    });
    anchorContainer.appendChild(playLeft);

    const actions = document.createElement('div');
    actions.id = 'recordingActions';
    actions.style.position = 'absolute';
    // position inside the waveform container: place to the right of the canvas
    actions.style.left = `${anchorContainer.clientWidth + 8}px`;
    actions.style.top = `0px`;
    actions.style.zIndex = '10001';
    actions.style.display = 'flex';
    actions.style.flexDirection = 'column';
    actions.style.gap = '8px';

  const addBtn = document.createElement('button');
  addBtn.type = 'button'; addBtn.className = 'action-btn'; addBtn.textContent = 'Ajouter au sampler';
  addBtn.addEventListener('click', async () => {
    // ask for slot number
    const s = prompt('Numéro du slot (1–16) pour assigner ce son:', '1');
    if (!s) return;
    const n = Number(s);
    if (!n || isNaN(n) || n < 1 || n > 16) { alert('Numéro invalide'); return; }
    // map display number (1..16 bottom-left ordering) to internal slot index
    const target = (assignments && typeof assignments.displayNumberToSlotIndex === 'function') ? assignments.displayNumberToSlotIndex(n) : (n - 1);
    if (target === null) { alert('Numéro invalide'); return; }
    try {
      if (info.file) {
        await assignments.assignFileToSlot(info.file, target);
        showStatus(`Assigné au slot ${n}`);
      } else if (info.blob) {
        const f = new File([info.blob], info.name || `rec-${Date.now()}.webm`, { type: info.blob.type || 'audio/webm' });
        await assignments.assignFileToSlot(f, target);
        showStatus(`Assigné au slot ${n}`);
      } else if (info.buffer) {
        if (window.assignments && typeof window.assignments.assignBufferToSlot === 'function') {
          await window.assignments.assignBufferToSlot(info.buffer, info.name || `sound`, target);
          showStatus(`Assigné au slot ${n}`);
        } else {
          alert('Impossible d’assigner: pas de fichier disponible');
        }
      }
    } catch (err) { console.error('assign from actions error', err); showError('Impossible d’assigner le son'); }
  });
  actions.appendChild(addBtn);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button'; saveBtn.className = 'action-btn'; saveBtn.textContent = "Sauvegarder l'audio";
  saveBtn.addEventListener('click', async () => {
    try {
      const suggested = info.name || `mic-${Date.now()}.webm`;
      const name = prompt('Nom pour cet enregistrement:', suggested) || suggested;
      const blob = info.blob || (info.file ? new Blob([info.file], { type: info.file.type }) : null);
      if (!blob) { showError('Aucun blob à sauvegarder'); return; }
      await saveRecording(blob, name);
      showStatus('Enregistré');
    } catch (err) { console.error('save recording error', err); showError('Erreur lors de la sauvegarde'); }
  });
  actions.appendChild(saveBtn);

  const loadBtn = document.createElement('button');
  loadBtn.type = 'button'; loadBtn.className = 'action-btn'; loadBtn.textContent = 'Charger enregistrés/API';
  loadBtn.addEventListener('click', async () => {
    try {
      // show chooser to pick saved recordings or local decoded items
      const deps = { listRecordings, decodeFileToBuffer, decodedItems: [{ id: 'current', source: 'local', buffer: info.buffer, name: info.name, index: 0 }] };
      const chooser = await showLocalSoundsChooser(actions, async (selectedItems) => {
        if (selectedItems && selectedItems.length > 0) {
          const it = selectedItems[0];
          if (it.buffer) {
            // draw selected sound on the top preview canvas only
            try { if (lastRecordingCanvas) drawMiniWaveform(it.buffer, lastRecordingCanvas); } catch (err) { console.warn('draw preview error', err); }
            const labelEl = document.getElementById('lastRecordingLabel'); if (labelEl) labelEl.textContent = 'Son chargé/enregistré';
            // update info to new loaded sound and refresh actions
            info.buffer = it.buffer; info.name = it.name;
            showRecordingActions(anchorContainer, info);
          }
        }
      }, deps, async (selectedItems) => {
        // onSelect: invoked when user clicks Play in the chooser — preview and close + load into top preview
        if (selectedItems && selectedItems.length > 0) {
          const it = selectedItems[0];
          if (it.buffer) {
            try { if (lastRecordingCanvas) drawMiniWaveform(it.buffer, lastRecordingCanvas); } catch (err) { console.warn('draw preview error', err); }
            const labelEl = document.getElementById('lastRecordingLabel'); if (labelEl) labelEl.textContent = 'Son chargé/enregistré';
            info.buffer = it.buffer; info.name = it.name;
            showRecordingActions(anchorContainer, info);
          }
        }
      }, { showCheckboxes: false, showCreateButton: false });
      // chooser handles its own DOM
    } catch (err) { console.error('load chooser error', err); showError('Impossible de charger'); }
  });
  actions.appendChild(loadBtn);

  // attach actions inside the waveform container so they move together
  anchorContainer.appendChild(actions);
}

// === CLAVIER ===

// Gestionnaire global clavier : mappe les touches à des boutons de grille
function onGlobalKeyDown(e) {
  // ignore repeated events when holding a key
  if (e.repeat) return;
  // ignore when typing in inputs
  const tgt = e.target;
  const tag = tgt && tgt.tagName && tgt.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tgt.isContentEditable) return;

  const key = String(e.key || '').toLowerCase();
  const idx = KEYBOARD_KEYS.indexOf(key);
  if (idx === -1) return;

  const btn = currentButtons[idx];
  if (!btn) return;

  // resume audio context if needed and trigger the button action
  if (ctx && ctx.state === 'suspended') ctx.resume();
  // visual feedback: briefly add a class (CSS optional)
  btn.classList.add('keyboard-active');
  try {
    btn.click();
  } catch (err) {
    console.warn('Error triggering button via keyboard', err);
  }
  setTimeout(() => btn.classList.remove('keyboard-active'), 140);
}

// === IMPORT / DRAG & DROP ===

// Décode un fichier audio en AudioBuffer pour lecture
async function decodeFileToBuffer(file) {
  const arrayBuffer = await file.arrayBuffer();
  return await ctx.decodeAudioData(arrayBuffer);
}