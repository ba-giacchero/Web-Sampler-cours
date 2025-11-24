// Exercise 3 — fetch presets from REST API and load sounds for the selected preset
// Corrigé pour Live Server + API sur http://localhost:3000

import { loadAndDecodeSound, playSound } from './soundutils.js';
import { pixelToSeconds } from './utils.js';
import { saveRecording, listRecordings, getRecording, deleteRecording } from './indexeddb.js';
import { mkBtn, mkEl, placePopupNear, makeListRow } from './ui-helpers.js';
import { drawWaveform, drawMiniWaveform } from './waveforms.js';
import { showRecordingsChooser, showLocalSoundsChooser } from './choosers.js';
import { initAssignments } from './assignments.js';
import { initWaveformUI } from './waveform-ui.js';

// ====== CONFIG ORIGINS ======
const API_BASE = 'http://localhost:3000';               // <- API + fichiers audio
const PRESETS_URL = `${API_BASE}/api/presets`;

// Web Audio
let ctx;

// UI
const presetSelect = document.getElementById('presetSelect');
const buttonsContainer = document.getElementById('buttonsContainer');
const statusEl = document.getElementById('status');
const errorEl = document.getElementById('error');
const lastRecordingCanvas = document.getElementById('lastRecordingCanvas');

// Etat
let presets = [];          // [{ name, files:[absoluteUrl,...] }, ...]
let decodedSounds = [];    // AudioBuffer[] du preset courant
// store for generated presets (in-memory)
// key -> { buffers: AudioBuffer[], names: string[], type: 'buffers'|'pitch', pitchRates?: number[] }
const generatedPresetStore = new Map();
// current visible buttons for keyboard mapping
let currentButtons = [];
// per-sound trim positions stored by url (seconds)
const trimPositions = new Map();

// keyboard mapping: map 4x4 grid to sensible physical keys (AZERTY-friendly)
// Row 1: &, é, ", '  (unshifted top-row keys on many AZERTY layouts)
// Row 2: A, Z, E, R (AZERTY top letter row leftmost keys)
// Row 3: Q, S, D, F (home row leftmost keys)
// Row 4: W, X, C, V (bottom row leftmost keys)
const KEYBOARD_KEYS = [
  '&','é','"','\'' ,
  'a','z','e','r',
  'q','s','d','f',
  'w','x','c','v'
];

// waveform + overlay
let waveformCanvas, overlayCanvas, trimbarsDrawer;
let mousePos = { x: 0, y: 0 };
let currentShownBuffer = null;
let currentShownUrl = null;
let showWaveformForSound;
// recording
let mediaStream = null;
let mediaRecorder = null;
let recordedChunks = [];

window.onload = async function init() {
  ctx = new AudioContext();

  // expose a simple playSound helper globally so choosers can preview sounds
  window.playSound = (buffer) => {
    try { playSound(ctx, buffer, 0, buffer.duration); } catch (err) { console.warn('global playSound error', err); }
  };

  try {
    // 1) Récupère les presets du serveur
    const raw = await fetchPresets(PRESETS_URL);
    presets = normalizePresets(raw); // -> [{name, files:[absUrl,...]}]

    if (!Array.isArray(presets) || presets.length === 0) {
      throw new Error('Aucun preset utilisable dans la réponse du serveur.');
    }

    // 2) Remplit le <select>
    fillPresetSelect(presets);
    // create a styled custom dropdown that replaces the native select's visible UI
    createCustomPresetDropdown();

    // wire "Ajouter un preset" button
    const addPresetBtn = document.getElementById('addPresetBtn');
    if (addPresetBtn) addPresetBtn.addEventListener('click', (e) => { e.stopPropagation(); showAddPresetMenu(addPresetBtn); });

      // 3) Charge le premier preset par défaut
      presetSelect.disabled = false;
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

    // listen for trim changes emitted by waveform-ui and persist them into trimPositions map
    window.addEventListener('waveform-trim-changed', (ev) => {
      try {
        const d = ev && ev.detail;
        if (d && d.url) {
          trimPositions.set(d.url, { start: d.start, end: d.end });
        }
      } catch (err) { console.warn('waveform-trim-changed handler error', err); }
    });
    // initialize assignment helpers (drag/drop, picker, assign functions)
    const assignments = initAssignments({
      decodeFileToBuffer,
      buttonsContainer,
      // provide accessors for currentButtons so the module updates main.js state directly
      getCurrentButtons: () => currentButtons,
      setCurrentButton: (idx, node) => { currentButtons[idx] = node; },
      KEYBOARD_KEYS,
      trimPositions,
      playSound: (buffer, s, e, r) => playSound(ctx, buffer, s, e, r),
      filePicker: document.getElementById('filePicker'),
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

    // create persistent recording actions UI (visible from start)
    createPersistentRecordingActions();
    await loadPresetByIndex(0);

    // 4) Changement de preset
    // keep native select change handler for programmatic changes
    presetSelect.addEventListener('change', async () => {
      const idx = Number(presetSelect.value);
      // update custom UI label if present
      const labelBtn = document.querySelector('.custom-select-btn .label');
      if (labelBtn && presetSelect.options && presetSelect.options[idx]) labelBtn.textContent = presetSelect.options[idx].textContent;
      await loadPresetByIndex(idx);
    });

    // keyboard listener for triggering sounds via assigned keys
    window.addEventListener('keydown', onGlobalKeyDown);

    // Recorder UI: wire record button and status
    const recordBtn = document.getElementById('recordBtn');
    const recordStatus = document.getElementById('recordStatus');

    async function startRecordingForSlot(slotIndex) {
      try {
        if (!mediaStream) {
          mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
      } catch (err) {
        showError('Accès au micro refusé ou indisponible.');
        return;
      }

      recordedChunks = [];
      try {
        mediaRecorder = new MediaRecorder(mediaStream);
      } catch (err) {
        showError('MediaRecorder non supporté par ce navigateur.');
        return;
      }

      mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };
      mediaRecorder.onstop = async () => {
        const blob = new Blob(recordedChunks, { type: recordedChunks[0] ? recordedChunks[0].type : 'audio/webm' });
        const defaultName = `mic-recording-${Date.now()}.webm`;
        recordStatus.textContent = 'Décodage…';

        // create a File-like object for reuse
        const file = new File([blob], defaultName, { type: blob.type });

        // Draw mini preview
        try {
          const previewBuffer = await decodeFileToBuffer(file);
          if (lastRecordingCanvas && previewBuffer) drawMiniWaveform(previewBuffer, lastRecordingCanvas);
        } catch (err) {
          console.warn('Unable to decode preview buffer', err);
        }

        // Decode full buffer and display it in the waveform rectangle
        try {
          const buffer = await decodeFileToBuffer(file);
          // show only on the top preview canvas (do NOT draw on the bottom waveform canvas)
          const labelEl = document.getElementById('lastRecordingLabel');
          if (labelEl) labelEl.textContent = 'Son chargé/enregistré';
          try {
            // draw a mini/full preview on the top canvas
            if (lastRecordingCanvas) drawMiniWaveform(buffer, lastRecordingCanvas);
          } catch (err) { console.warn('Unable to draw preview on top canvas', err); }
          // show action toolbar attached to the top preview canvas (so bottom trimbars remain untouched)
          const topParent = lastRecordingCanvas && lastRecordingCanvas.parentElement ? lastRecordingCanvas.parentElement : waveformCanvas.parentElement;
          showRecordingActions(topParent, { buffer, file, blob, name: defaultName });
          recordStatus.textContent = 'Enregistrement prêt';
        } catch (err) {
          console.error('Unable to decode recorded file', err);
          showError('Impossible de décoder l’enregistrement.');
          recordStatus.textContent = '';
        }

        setTimeout(() => { if (recordStatus) recordStatus.textContent = ''; }, 2500);
      };

      mediaRecorder.start();
      if (recordBtn) recordBtn.textContent = 'Stop';
      if (recordStatus) recordStatus.textContent = 'Enregistrement…';
    }

    function stopRecording() {
      if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
      if (recordBtn) recordBtn.textContent = 'Enregistrer avec le micro';
    }

    if (recordBtn) {
      recordBtn.onclick = async () => {
        try {
          if (mediaRecorder && mediaRecorder.state === 'recording') {
            stopRecording();
            return;
          }
          await startRecordingForSlot();
        } catch (err) { console.error('recordBtn click error', err); }
      };
    }

  } catch (err) {
    console.error(err);
    showError(err.message || String(err));
  }
};

// ---------- Fetch + normalisation ----------

async function fetchPresets(url) {
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error(`HTTP ${res.status} en récupérant ${url}`);
  return res.json();
}

// create persistent actions UI under #lastRecordingContainer so buttons are visible from start
function createPersistentRecordingActions() {
  const container = document.getElementById('lastRecordingContainer');
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

// Build a custom dropdown to replace the visible behaviour of `#presetSelect` so
// the opened menu can be styled like the other buttons.
function createCustomPresetDropdown() {
  if (!presetSelect) return;
  // do nothing if wrapper already exists
  if (document.querySelector('.custom-select-wrapper')) return;

  // hide native select visually but keep it accessible for form/keyboard if needed
  presetSelect.style.display = 'none';

  const wrapper = document.createElement('div');
  wrapper.className = 'custom-select-wrapper';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'action-btn custom-select-btn';
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = (presetSelect.options && presetSelect.options[0]) ? presetSelect.options[0].textContent : 'Select';
  const caret = document.createElement('span');
  caret.className = 'caret';
  caret.textContent = '▾';
  btn.appendChild(label);
  btn.appendChild(caret);

  wrapper.appendChild(btn);
  // dropdown container (hidden by default) — append to body so it can overlay everything
  const dropdown = document.createElement('div');
  dropdown.id = 'presetDropdown';
  dropdown.style.display = 'none';
  dropdown.style.position = 'absolute';
  dropdown.style.zIndex = '9999';
  document.body.appendChild(dropdown);

  // populate list from native select options
  function populateList() {
    dropdown.innerHTML = '';
    if (!presetSelect.options) return;
    Array.from(presetSelect.options).forEach((opt, i) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'action-btn preset-item';
      item.textContent = opt.textContent;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        // set native select value and trigger change to reuse existing logic
        presetSelect.value = String(i);
        presetSelect.dispatchEvent(new Event('change'));
        dropdown.style.display = 'none';
      });
      dropdown.appendChild(item);
    });
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (dropdown.style.display === 'none') {
      populateList();
      // position dropdown relative to button coordinates so it overlays other UI
      const rect = btn.getBoundingClientRect();
      const left = Math.max(6, rect.left + window.scrollX);
      const top = rect.bottom + window.scrollY + 8; // open downward
      dropdown.style.left = `${left}px`;
      dropdown.style.top = `${top}px`;
      // ensure dropdown at least as wide as the button
      dropdown.style.minWidth = `${Math.max(rect.width, 200)}px`;
      dropdown.style.display = '';
      // hide on scroll to avoid misposition
      window.addEventListener('scroll', onWindowScroll, true);
    } else {
      dropdown.style.display = 'none';
      window.removeEventListener('scroll', onWindowScroll, true);
    }
  });

  // close dropdown on outside click
  document.addEventListener('click', (ev) => { if (!wrapper.contains(ev.target) && !dropdown.contains(ev.target)) { dropdown.style.display = 'none'; window.removeEventListener('scroll', onWindowScroll, true); } });

  function onWindowScroll() { dropdown.style.display = 'none'; window.removeEventListener('scroll', onWindowScroll, true); }

  // insert wrapper before native select
  presetSelect.parentElement.insertBefore(wrapper, presetSelect);
}

function normalizePresets(raw) {
  const makeAbsFromApi = (p) => new URL(p, API_BASE).toString();

  // CAS attendu (array)
  if (Array.isArray(raw)) {
    return raw.map((preset, i) => {
      // format serveur: samples = [{name, url}, ...]
      let files = [];
      if (Array.isArray(preset.samples)) {
        files = preset.samples
          .map(s => s && s.url ? `presets/${s.url}` : null)
          .filter(Boolean)
          .map(makeAbsFromApi); // -> absolu sur API_BASE
      } else if (Array.isArray(preset.files)) {
        // fallback: déjà des chemins (on les rend absolus par l'API)
        files = preset.files.map(makeAbsFromApi);
      } else if (Array.isArray(preset.urls)) {
        files = preset.urls.map(makeAbsFromApi);
      }

      return {
        name: preset.name || preset.title || `Preset ${i + 1}`,
        files
      };
    }).filter(p => p.files.length > 0);
  }

  // CAS { presets: [...] }
  if (raw && Array.isArray(raw.presets)) {
    return normalizePresets(raw.presets);
  }

  // Autres formats -> vide
  return [];
}

// ---------- UI helpers ----------

function fillPresetSelect(presets) {
  presetSelect.innerHTML = '';
  presets.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = p.name || `Preset ${i + 1}`;
    presetSelect.appendChild(opt);
  });
}

function showStatus(msg) { statusEl.textContent = msg || ''; }
function showError(msg)  { errorEl.textContent = msg || ''; showStatus(''); }
function resetButtons()  { buttonsContainer.innerHTML = ''; }

// keep resetButtons in sync with currentButtons
function clearButtons() {
  buttonsContainer.innerHTML = '';
  currentButtons = [];
}

// ---------- Chargement d’un preset ----------

async function loadPresetByIndex(idx) {
  const preset = presets[idx];
  if (!preset) return;

  clearButtons();
  showError('');
  // handle generated presets
  if (preset.generated) {
    showStatus(`Loading generated preset…`);
    try {
      await loadGeneratedPreset(preset);
      showStatus(`Loaded preset: ${preset.name}`);
    } catch (err) {
      console.error(err);
      showError('Erreur lors du chargement du preset généré.');
    }
    return;
  }

  showStatus(`Loading ${preset.files.length} file(s)…`);

  try {
    // 1) charge + décode en parallèle
    decodedSounds = await Promise.all(
      preset.files.map(url => loadAndDecodeSound(url, ctx))
    );

    // remap decoded sounds so that they are assigned starting from
    // bottom-left button, filling rows left->right then moving upward.
    // mapping sequence for 4x4 grid: bottom row indices 12..15, then 8..11, then 4..7, then 0..3
    const mapping = [12,13,14,15,8,9,10,11,4,5,6,7,0,1,2,3];
    const assignedDecoded = new Array(16).fill(null);
    const assignedUrls = new Array(16).fill(null);
    const assignedIndex = new Array(16).fill(null); // which preset file index was assigned here
    for (let p = 0; p < decodedSounds.length && p < mapping.length; p++) {
      const target = mapping[p];
      assignedDecoded[target] = decodedSounds[p];
      assignedUrls[target] = preset.files[p];
      assignedIndex[target] = p;
    }

    // 2) génère les boutons — toujours créer une grille fixe de slots (16) pour permettre
    // l'assignation de sons locaux même si le preset en fournit moins.
    const totalSlots = KEYBOARD_KEYS.length || 16;
    for (let i = 0; i < totalSlots; i++) {
      const btn = document.createElement('button');
      const assignedKey = KEYBOARD_KEYS[i] || null;
      if (assignedKey) btn.dataset.key = assignedKey;

      const decodedSound = assignedDecoded[i];
      const url = assignedUrls[i];

      if (decodedSound) {
        const name = (url && url.split('/').pop()) || `sound ${i + 1}`;
        const soundNum = (assignedIndex[i] !== null && typeof assignedIndex[i] !== 'undefined') ? (assignedIndex[i] + 1) : (i + 1);
        btn.textContent = `Play ${soundNum} — ${name}`;

        // click handler: same flow as before (show waveform, compute trims, play)
        btn.addEventListener('click', () => {
          try {
            showWaveformForSound(decodedSound, url);
          } catch (err) {
            console.warn('Unable to show waveform', err);
          }

          if (ctx.state === 'suspended') ctx.resume();

          let start = 0;
          let end = decodedSound.duration;
          const stored = trimPositions.get(url);
          if (stored) {
            start = stored.start;
            end = stored.end;
          } else if (trimbarsDrawer) {
            const l = trimbarsDrawer.leftTrimBar.x;
            const r = trimbarsDrawer.rightTrimBar.x;
            start = pixelToSeconds(l, decodedSound.duration, waveformCanvas.width);
            end = pixelToSeconds(r, decodedSound.duration, waveformCanvas.width);
          }

          start = Math.max(0, Math.min(start, decodedSound.duration));
          end = Math.max(start + 0.01, Math.min(end, decodedSound.duration));

          trimPositions.set(url, { start, end });
          playSound(ctx, decodedSound, start, end);
        });
      } else {
        // empty slot — keep the button text-free; assignment via the small '+' or drag & drop
        btn.textContent = '';
        btn.classList.add('empty-slot');
        btn.title = `Add a sound to slot ${i + 1}`;
        // clicking empty slot does not play; assignment via assign-icon or drag & drop
      }

      // enable drag & drop and file picker on every slot so users can assign local sounds
      assignments.enableDragDropOnButton(btn, i);
      assignments.enableFilePickerOnButton(btn, i);

      buttonsContainer.appendChild(btn);
      currentButtons.push(btn);
    }

    showStatus(`Loaded preset: ${preset.name} (${decodedSounds.length} sounds)`);
  } catch (err) {
    console.error(err);
    showError(`Erreur lors du chargement du preset "${preset.name}": ${err.message || err}`);
  }
}

// Waveform UI is extracted to `js/waveform-ui.js` and initialized during startup.

// Show action toolbar next to waveform container for the most recently loaded/recorded sound
function showRecordingActions(anchorContainer, info) {
  // info: { buffer, file, blob, name }
  if (!anchorContainer) return;
  // if persistent UI exists, update it instead of creating transient actions
  const persistent = document.getElementById('persistentRecordingActions');
  const leftPersistent = document.getElementById('persistentRecordingPlayLeft');
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
        // create a temporary file by encoding? fallback: use assignBufferToSlot if exists
        if (typeof assignBufferToSlot === 'function') {
          await assignments.assignBufferToSlot(info.buffer, info.name || `sound`, target);
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

// overlay draw loop is now handled by `js/waveform-ui.js`

// Global keyboard handler: map pressed key to the corresponding button (if assigned)
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

// waveform rendering moved to `js/waveforms.js` (imported at top)

// --- Import / Drag & Drop helpers ---

const filePicker = document.getElementById('filePicker');

async function decodeFileToBuffer(file) {
  const arrayBuffer = await file.arrayBuffer();
  return await ctx.decodeAudioData(arrayBuffer);
}

function pickFileForSlot(slotIndex) {
  if (window.assignments && typeof window.assignments.pickFileForSlot === 'function') return window.assignments.pickFileForSlot(slotIndex);
  // no-op if assignments module isn't available
}

async function assignFileToSlot(file, slotIndex) {
  if (window.assignments && typeof window.assignments.assignFileToSlot === 'function') return window.assignments.assignFileToSlot(file, slotIndex);
  // no-op fallback: assignments module not available
}

// Assign an existing decoded AudioBuffer to a slot (used when we have a buffer already)
async function assignBufferToSlot(buffer, name, slotIndex) {
  if (window.assignments && typeof window.assignments.assignBufferToSlot === 'function') return window.assignments.assignBufferToSlot(buffer, name, slotIndex);
  // no-op fallback
}



function enableDragDropOnButton(btn, slotIndex) {
  if (window.assignments && typeof window.assignments.enableDragDropOnButton === 'function') return window.assignments.enableDragDropOnButton(btn, slotIndex);
  // no-op fallback
}

function enableFilePickerOnButton(btn, slotIndex) {
  if (window.assignments && typeof window.assignments.enableFilePickerOnButton === 'function') return window.assignments.enableFilePickerOnButton(btn, slotIndex);
  // no-op fallback
}

// recordings chooser implementation extracted to `js/choosers.js`

// ---------- Add Preset menu + generated preset helpers ----------
function showAddPresetMenu(anchorEl) {
  const existing = document.getElementById('addPresetMenu');
  if (existing) { existing.remove(); return; }
  const container = document.createElement('div');
  container.id = 'addPresetMenu';
  container.style.position = 'absolute';
  container.style.zIndex = '9999';
  container.className = 'action-btn';
  container.style.padding = '8px';

  const rect = anchorEl.getBoundingClientRect();
  container.style.left = `${Math.max(6, rect.left + window.scrollX)}px`;
  container.style.top = `${rect.bottom + window.scrollY + 8}px`;

  const makeBtn = (text, cb) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'action-btn';
    b.textContent = text;
    b.style.display = 'block';
    b.style.width = '100%';
    b.style.marginBottom = '6px';
    b.addEventListener('click', (e) => { e.stopPropagation(); cb(); container.remove(); });
    return b;
  };

  // create actions
  container.appendChild(makeBtn('Créer un sampler à partir des sons locaux', async () => {
    // open chooser listing local decoded sounds (files assigned locally + decoded from preset)
    // remove auto-generated "Play N — " prefix from button labels when building chooser names
    const localBuffers = decodedSounds.map((b,i) => {
      const raw = (currentButtons[i] && currentButtons[i].textContent) ? currentButtons[i].textContent.trim() : null;
      const clean = raw ? raw.replace(/^Play\s+\d+\s*[—-]\s*/i, '') : `sound ${i+1}`;
      return { buffer: b || null, name: clean || `sound ${i+1}`, index: i };
    });
    const available = localBuffers.filter(x => x.buffer);
    if (!available || available.length === 0) { showError('Aucun son local disponible.'); return; }
    // hide per-item "Charger" button in this context: users only need to select sounds to build the sampler
    showLocalSoundsChooser(container, async (selectedItems) => {
      // selectedItems: array of { buffer, name, index }
      // build buffers array of length 16 placing selected sounds in order
      const steps = 16;
      const buffers = new Array(steps).fill(null);
      const names = new Array(steps).fill('');
      selectedItems.slice(0,steps).forEach((it, i) => { buffers[i] = it.buffer; names[i] = it.name || `sound ${i+1}`; });
      createPresetFromBuffers(`Local sampler ${Date.now()}`, buffers, names, 'buffers');
    }, { listRecordings, getRecording, decodeFileToBuffer, decodedItems: localBuffers.map((b) => ({ id: `local-${b.index}`, source: 'local', buffer: b.buffer, name: b.name, index: b.index })) }, undefined, { showLoadButton: false });
  }));

  container.appendChild(makeBtn('Slicer un enregistrement sur les silences', async () => {
    // take the most recent recording, split it on silences and create a sampler
    const recs = await listRecordings();
    if (!recs || recs.length === 0) { showError('Aucun enregistrement trouvé.'); return; }
    const r = recs.sort((a,b)=>b.created-a.created)[0];
    const ent = await getRecording(r.id);
    if (!ent || !ent.blob) { showError('Impossible de récupérer l’enregistrement.'); return; }
    const file = new File([ent.blob], ent.name || `rec-${r.id}`, { type: ent.type || 'audio/webm' });
    let buf;
    try {
      buf = await decodeFileToBuffer(file);
    } catch (err) {
      showError('Impossible de décoder l’enregistrement.');
      return;
    }

    // helper: slice buffer on silence (uses global `ctx`)
    function sliceBufferOnSilence(buffer, opts = {}) {
      const threshold = typeof opts.threshold === 'number' ? opts.threshold : 0.02; // amplitude threshold
      const minSilenceDuration = opts.minSilenceDuration || 0.12; // seconds
      const minSliceDuration = opts.minSliceDuration || 0.05; // seconds
      const padding = typeof opts.padding === 'number' ? opts.padding : 0.03; // seconds of padding around slices

      const sr = buffer.sampleRate;
      const len = buffer.length;

      // Mix to mono envelope
      const mono = new Float32Array(len);
      const channels = buffer.numberOfChannels;
      for (let c = 0; c < channels; c++) {
        const ch = buffer.getChannelData(c);
        for (let i = 0; i < len; i++) mono[i] += ch[i] / channels;
      }

      // Smooth absolute amplitude with short moving average (~10ms)
      const win = Math.max(1, Math.floor(0.01 * sr));
      const env = new Float32Array(len);
      let sum = 0;
      for (let i = 0; i < len; i++) {
        sum += Math.abs(mono[i]);
        if (i >= win) sum -= Math.abs(mono[i - win]);
        env[i] = sum / Math.min(i + 1, win);
      }

      // Mark silence where envelope < threshold
      const silent = new Uint8Array(len);
      for (let i = 0; i < len; i++) silent[i] = env[i] < threshold ? 1 : 0;

      const minSilenceSamples = Math.floor(minSilenceDuration * sr);
      const minSliceSamples = Math.floor(minSliceDuration * sr);
      const padSamples = Math.floor(padding * sr);

      const segments = [];
      let i = 0;
      while (i < len) {
        // skip silence
        while (i < len && silent[i]) i++;
        if (i >= len) break;
        const start = i;
        // advance until a sufficiently long silence is found
        while (i < len) {
          if (!silent[i]) { i++; continue; }
          // found a silent point, measure length
          let j = i;
          while (j < len && silent[j]) j++;
          if ((j - i) >= minSilenceSamples) {
            i = j;
            break;
          } else {
            i = j; // short silence, continue
          }
        }
        const end = Math.min(i, len);
        if ((end - start) >= minSliceSamples) {
          const s = Math.max(0, start - padSamples);
          const e = Math.min(len, end + padSamples);
          segments.push({ start: s, end: e });
        }
      }

      // if no segments detected, fall back to whole buffer
      if (segments.length === 0) segments.push({ start: 0, end: len });

      // convert segments to AudioBuffer objects
      const out = segments.map(seg => {
        const frameCount = seg.end - seg.start;
        const newBuf = ctx.createBuffer(channels, frameCount, sr);
        for (let c = 0; c < channels; c++) {
          const src = buffer.getChannelData(c);
          const dst = newBuf.getChannelData(c);
          for (let k = 0; k < frameCount; k++) dst[k] = src[seg.start + k];
        }
        return newBuf;
      });

      return out;
    }

    // perform slicing
    const slices = sliceBufferOnSilence(buf, { threshold: 0.02, minSilenceDuration: 0.12, minSliceDuration: 0.05, padding: 0.03 });
    if (!slices || slices.length === 0) { showError('Aucune découpe trouvée.'); return; }

    const maxSlots = 16;
    let finalSlices = slices;
    if (slices.length > maxSlots) {
      finalSlices = slices.slice(0, maxSlots);
      showError(`Trop de slices (${slices.length}), limité à ${maxSlots} premiers.`);
    }

    const names = finalSlices.map((_, i) => `${file.name} ${i + 1}`);
    createPresetFromBuffers(`Sliced sampler ${Date.now()}`, finalSlices, names, 'buffers');
  }));

  container.appendChild(makeBtn('Créer un sampler en pitchant le son', async () => {
    // Prefer the buffer currently loaded into the top preview UI (persistent actions _info),
    // then the buffer shown in the bottom waveform (`currentShownBuffer`),
    // then the most recent saved recording, then any decoded preset sound.
    let buf = null;
    const persistentActions = document.getElementById('persistentRecordingActions');
    if (persistentActions && persistentActions._info && persistentActions._info.buffer) {
      buf = persistentActions._info.buffer;
    } else if (typeof currentShownBuffer !== 'undefined' && currentShownBuffer) {
      buf = currentShownBuffer;
    }

    // fallback: most recent saved recording
    if (!buf) {
      try {
        const recs = await listRecordings();
        if (recs && recs.length) {
          const r = recs.sort((a,b)=>b.created-a.created)[0];
          const ent = await getRecording(r.id);
          if (ent && ent.blob) {
            const file = new File([ent.blob], ent.name || `rec-${r.id}`, { type: ent.type || 'audio/webm' });
            try { buf = await decodeFileToBuffer(file); } catch (err) { console.warn('decode recent recording failed', err); }
          }
        }
      } catch (err) { console.warn('error while fetching recordings for pitch sampler fallback', err); }
    }

    // last resort: any decoded sound in the current preset
    if (!buf && decodedSounds && decodedSounds.find(Boolean)) {
      buf = decodedSounds.find(Boolean);
    }

    if (!buf) { showError('Aucun son disponible pour pitcher.'); return; }
    // create preset with pitch rates across slots (e.g., 16 steps from 0.5 to 2)
    const steps = 16;
    const min = 0.6; const max = 1.8;
    const rates = Array.from({length: steps}, (_,i) => min + (i/(steps-1))*(max-min));
    const buffers = new Array(steps).fill(null).map(() => buf);
    const names = rates.map((r,i) => `pitch ${Math.round(r*100)}%`);
    createPresetFromBuffers(`Pitch sampler ${Date.now()}`, buffers, names, 'pitch', rates);
  }));

  document.body.appendChild(container);
  setTimeout(() => document.addEventListener('click', (e) => { if (!container.contains(e.target)) container.remove(); }), 10);
}

function createPresetFromBuffers(name, buffers, names, type='buffers', pitchRates) {
  const id = `gen-${Date.now()}`;
  generatedPresetStore.set(id, { buffers, names, type, pitchRates });
  // add to presets array as generated entry
  presets.push({ name, generated: true, type, id });
  // add option to UI
  const opt = document.createElement('option');
  opt.value = String(presets.length - 1);
  opt.textContent = name;
  presetSelect.appendChild(opt);
  // update custom dropdown label if present
  const labelBtn = document.querySelector('.custom-select-btn .label');
  if (labelBtn) labelBtn.textContent = name;
  // select new preset
  presetSelect.value = opt.value;
  presetSelect.dispatchEvent(new Event('change'));
}

async function loadGeneratedPreset(preset) {
  const data = generatedPresetStore.get(preset.id);
  if (!data) throw new Error('Generated preset not found');

  // use buffers directly (some may be null)
  decodedSounds = data.buffers.slice(0);

  // Remap generated buffers the same way as presets: start at bottom-left
  const mapping = [12,13,14,15,8,9,10,11,4,5,6,7,0,1,2,3];
  const assignedBuffers = new Array(16).fill(null);
  const assignedIndex = new Array(16).fill(null);
  for (let p = 0; p < data.buffers.length && p < mapping.length; p++) {
    assignedBuffers[mapping[p]] = data.buffers[p];
    assignedIndex[mapping[p]] = p;
  }

  // build grid of buttons (reuse same logic as loadPresetByIndex but without decoding)
  const totalSlots = KEYBOARD_KEYS.length || 16;
  for (let i=0;i<totalSlots;i++) {
    const btn = document.createElement('button');
    const assignedKey = KEYBOARD_KEYS[i] || null;
    if (assignedKey) btn.dataset.key = assignedKey;

    const buffer = assignedBuffers[i];
    const pIndex = assignedIndex[i];
    const name = (typeof pIndex === 'number' && data.names && data.names[pIndex]) ? data.names[pIndex] : (buffer ? `sound ${i+1}` : '');
    if (buffer) {
      const soundNum = (typeof pIndex === 'number') ? (pIndex + 1) : (i + 1);
      btn.textContent = `Play ${soundNum} — ${name}`;
      const pseudoUrl = `generated:${preset.id}:${i}`;
      trimPositions.set(pseudoUrl, { start: 0, end: buffer.duration });
      btn.addEventListener('click', () => {
        try { showWaveformForSound(buffer, pseudoUrl); } catch (e) { console.warn(e); }
        if (ctx.state === 'suspended') ctx.resume();
        let start = 0, end = buffer.duration;
        const stored = trimPositions.get(pseudoUrl);
        if (stored) { start = stored.start; end = stored.end; }
        start = Math.max(0, Math.min(start, buffer.duration));
        end = Math.max(start+0.01, Math.min(end, buffer.duration));
        trimPositions.set(pseudoUrl, { start, end });
        const rate = (data.type === 'pitch' && data.pitchRates && data.pitchRates[i]) ? data.pitchRates[i] : undefined;
        if (typeof rate !== 'undefined') playSound(ctx, buffer, start, end, rate); else playSound(ctx, buffer, start, end);
      });
    } else {
      btn.textContent = '';
      btn.classList.add('empty-slot');
    }

    enableDragDropOnButton(btn, i);
    enableFilePickerOnButton(btn, i);
    buttonsContainer.appendChild(btn);
    currentButtons.push(btn);
  }
}
