// Exercise 3 — fetch presets from REST API and load sounds for the selected preset
// Corrigé pour Live Server + API sur http://localhost:3000

import { loadAndDecodeSound, playSound } from './soundutils.js';
import TrimbarsDrawer from './trimbarsdrawer.js';
import { pixelToSeconds } from './utils.js';
import { saveRecording, listRecordings, getRecording, deleteRecording } from './indexeddb.js';

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
// recording
let mediaStream = null;
let mediaRecorder = null;
let recordedChunks = [];

window.onload = async function init() {
  ctx = new AudioContext();

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
  // create waveform UI (hidden until a sound is selected)
  createWaveformUI();
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

    // Recorder UI: populate slot select (1..16) and wire record button
    const recordSlotSelect = document.getElementById('recordSlotSelect');
    const recordBtn = document.getElementById('recordBtn');
    const recordStatus = document.getElementById('recordStatus');
    
    if (recordSlotSelect) {
      for (let i = 1; i <= 16; i++) {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = String(i);
        recordSlotSelect.appendChild(opt);
      }
    }

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
        recordStatus.textContent = 'Sauvegarde en cours…';
        try {
          // save to IndexedDB
          const id = await saveRecording(blob, defaultName);
          recordStatus.textContent = 'Décodage et assignation…';

          // create a File-like object from the blob so assignFileToSlot can reuse logic
          const file = new File([blob], defaultName, { type: blob.type });
          // decode for mini-preview (draw last recorded waveform)
          try {
            const previewBuffer = await decodeFileToBuffer(file);
            if (lastRecordingCanvas && previewBuffer) drawMiniWaveform(previewBuffer, lastRecordingCanvas);
          } catch (err) {
            console.warn('Unable to decode preview buffer', err);
          }
          await assignFileToSlot(file, slotIndex);

          recordStatus.textContent = `Assigné au slot ${slotIndex + 1} (id ${id})`;
        } catch (err) {
          console.error('Recording assign error', err);
          showError('Erreur lors de la sauvegarde / assignation de l’enregistrement.');
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
      if (recordBtn) recordBtn.textContent = 'Enregistrer';
    }

    if (recordBtn) {
      recordBtn.addEventListener('click', async () => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
          stopRecording();
          return;
        }
        const slot = recordSlotSelect ? Number(recordSlotSelect.value) - 1 : 0;
        if (typeof slot !== 'number' || isNaN(slot) || slot < 0 || slot > 15) {
          showError('Choisis un numéro de slot valide (1–16)');
          return;
        }
        await startRecordingForSlot(slot);
      });
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

/**
 * Normalise la réponse du serveur vers:
 *    [{ name, files: [absoluteUrl, ...] }, ...]
 *
 * D'après ton "exemple REST" (script.js), le serveur renvoie un array de presets,
 * avec pour chaque preset:
 *   { name, type, samples: [{ name, url }, ...] }
 * et les fichiers audio sont servis sous /presets/<sample.url> sur le même host:port.
 * On doit donc construire: absoluteUrl = new URL(`presets/${sample.url}`, API_BASE).
 *
 * Références: ton script.js de démo (coté serveur HTML) construit "presets/" + sample.url,
 * et fetch('/api/presets') côté même origin. :contentReference[oaicite:2]{index=2}
 */
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

    // 2) génère les boutons — toujours créer une grille fixe de slots (16) pour permettre
    // l'assignation de sons locaux même si le preset en fournit moins.
    const totalSlots = KEYBOARD_KEYS.length || 16;
    for (let i = 0; i < totalSlots; i++) {
      const btn = document.createElement('button');
      const assignedKey = KEYBOARD_KEYS[i] || null;
      if (assignedKey) btn.dataset.key = assignedKey;

      const decodedSound = decodedSounds[i];
      const url = preset.files[i];

      if (decodedSound) {
        const name = (url && url.split('/').pop()) || `sound ${i + 1}`;
        btn.textContent = `Play ${i + 1} — ${name}`;

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
      enableDragDropOnButton(btn, i);
      enableFilePickerOnButton(btn, i);

      buttonsContainer.appendChild(btn);
      currentButtons.push(btn);
    }

    showStatus(`Loaded preset: ${preset.name} (${decodedSounds.length} sounds)`);
  } catch (err) {
    console.error(err);
    showError(`Erreur lors du chargement du preset "${preset.name}": ${err.message || err}`);
  }
}

// ---------- Waveform + trimbars UI helpers ----------
function createWaveformUI() {
  const container = document.createElement('div');
  container.id = 'waveformContainer';

  container.style.margin = '12px auto';
  container.style.position = 'relative';
  container.style.maxWidth = '800px';
  container.style.width = '100%';
  container.style.boxSizing = 'border-box';

  waveformCanvas = document.createElement('canvas');
  waveformCanvas.width = 800;
  waveformCanvas.height = 120;
  waveformCanvas.style.width = '100%';
  waveformCanvas.style.display = 'block';
  waveformCanvas.style.border = '1px solid #000000ff';
  waveformCanvas.style.zIndex = '1';
  container.appendChild(waveformCanvas);

  overlayCanvas = document.createElement('canvas');
  overlayCanvas.width = 800;
  overlayCanvas.height = 120;
  overlayCanvas.style.position = 'absolute';
  overlayCanvas.style.left = '0';
  overlayCanvas.style.top = '0';
  overlayCanvas.style.width = '100%';
  overlayCanvas.style.pointerEvents = 'auto';
  overlayCanvas.style.zIndex = '2';
  overlayCanvas.style.background = 'transparent';
  container.appendChild(overlayCanvas);

  buttonsContainer.insertAdjacentElement('afterend', container);

  trimbarsDrawer = new TrimbarsDrawer(overlayCanvas, 100, 200);

  // convert client coordinates to canvas pixel coordinates (account for DPR)
  overlayCanvas.onmousemove = (evt) => {
    const rect = overlayCanvas.getBoundingClientRect();
    const scaleX = overlayCanvas.width / rect.width;
    const scaleY = overlayCanvas.height / rect.height;
    mousePos.x = (evt.clientX - rect.left) * scaleX;
    mousePos.y = (evt.clientY - rect.top) * scaleY;
    trimbarsDrawer.moveTrimBars(mousePos);
  };

  overlayCanvas.onmousedown = () => trimbarsDrawer.startDrag();

  function stopDragAndSave() {
    trimbarsDrawer.stopDrag();
    // save current trim positions for the current sound (if any)
    if (currentShownBuffer && currentShownUrl) {
      const leftPx = trimbarsDrawer.leftTrimBar.x;
      const rightPx = trimbarsDrawer.rightTrimBar.x;
      const leftSec = pixelToSeconds(leftPx, currentShownBuffer.duration, waveformCanvas.width);
      const rightSec = pixelToSeconds(rightPx, currentShownBuffer.duration, waveformCanvas.width);
      trimPositions.set(currentShownUrl, { start: leftSec, end: rightSec });
    }
  }

  overlayCanvas.onmouseup = stopDragAndSave;
  // ensure we also catch mouseup outside the canvas
  window.addEventListener('mouseup', (evt) => {
    // if a drag was in progress, stop it and save
    if ((trimbarsDrawer.leftTrimBar && trimbarsDrawer.leftTrimBar.dragged) ||
        (trimbarsDrawer.rightTrimBar && trimbarsDrawer.rightTrimBar.dragged)) {
      stopDragAndSave();
    }
  });

  requestAnimationFrame(animateOverlay);
  container.style.display = 'none';
}

function showWaveformForSound(buffer, url) {
  if (!waveformCanvas) return;
  const container = waveformCanvas.parentElement;
  container.style.display = '';
  currentShownBuffer = buffer;
  currentShownUrl = url;

  // draw waveform
  drawWaveform(buffer, waveformCanvas);

  // restore trims (seconds -> pixels)
  const stored = trimPositions.get(url) || { start: 0, end: buffer.duration };
  const leftPx = (stored.start / buffer.duration) * waveformCanvas.width;
  const rightPx = (stored.end / buffer.duration) * waveformCanvas.width;
  trimbarsDrawer.leftTrimBar.x = leftPx;
  trimbarsDrawer.rightTrimBar.x = rightPx;
  // ensure a normalized entry
  trimPositions.set(url, { start: stored.start, end: stored.end });
}

// overlay draw loop
function animateOverlay() {
  if (trimbarsDrawer && overlayCanvas) {
    trimbarsDrawer.clear();
    trimbarsDrawer.draw();
  }
  requestAnimationFrame(animateOverlay);
}

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

function drawWaveform(buffer, canvas) {
  const cw = canvas.width = Math.floor(canvas.clientWidth * (window.devicePixelRatio || 1));
  const ch = canvas.height = Math.floor(120 * (window.devicePixelRatio || 1));
  // keep overlay canvas in sync (pixel size)
  if (overlayCanvas) {
    overlayCanvas.width = cw;
    overlayCanvas.height = ch;
  }
  const ctx2 = canvas.getContext('2d');
  ctx2.clearRect(0, 0, cw, ch);

  // Use first channel (or mix if needed)
  const channelData = buffer.numberOfChannels > 0 ? buffer.getChannelData(0) : new Float32Array(0);
  const step = Math.max(1, Math.floor(channelData.length / cw));
  ctx2.fillStyle = '#fafafa';
  ctx2.fillRect(0, 0, cw, ch);
  ctx2.lineWidth = 1;
  ctx2.strokeStyle = '#007acc';
  ctx2.beginPath();

  for (let i = 0; i < cw; i++) {
    const start = i * step;
    let min = 1.0, max = -1.0;
    for (let j = 0; j < step && (start + j) < channelData.length; j++) {
      const v = channelData[start + j];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const y1 = ((1 + max) / 2) * ch;
    const y2 = ((1 + min) / 2) * ch;
    ctx2.moveTo(i + 0.5, y1);
    ctx2.lineTo(i + 0.5, y2);
  }
  ctx2.stroke();
}

// Draw a compact preview waveform for the last recorded sound
function drawMiniWaveform(buffer, canvas) {
  if (!canvas || !buffer) return;
  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.width = Math.floor(canvas.clientWidth * dpr);
  const ch = canvas.height = Math.floor(80 * dpr);
  const ctx2 = canvas.getContext('2d');
  ctx2.clearRect(0, 0, cw, ch);
  // background
  ctx2.fillStyle = '#ffffff';
  ctx2.fillRect(0, 0, cw, ch);

  const channelData = buffer.numberOfChannels > 0 ? buffer.getChannelData(0) : new Float32Array(0);
  const step = Math.max(1, Math.floor(channelData.length / cw));
  ctx2.lineWidth = 1 * dpr;
  ctx2.strokeStyle = '#0b2a3a';
  ctx2.beginPath();
  for (let i = 0; i < cw; i++) {
    const start = i * step;
    let min = 1.0, max = -1.0;
    for (let j = 0; j < step && (start + j) < channelData.length; j++) {
      const v = channelData[start + j];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const y1 = ((1 + max) / 2) * ch;
    const y2 = ((1 + min) / 2) * ch;
    ctx2.moveTo(i + 0.5 * dpr, y1);
    ctx2.lineTo(i + 0.5 * dpr, y2);
  }
  ctx2.stroke();
}

// --- Import / Drag & Drop helpers ---

const filePicker = document.getElementById('filePicker');

async function decodeFileToBuffer(file) {
  const arrayBuffer = await file.arrayBuffer();
  return await ctx.decodeAudioData(arrayBuffer);
}

async function assignFileToSlot(file, slotIndex) {
  if (!file) return;
  try {
    showStatus(`Decoding ${file.name}…`);
    let buffer = await decodeFileToBuffer(file);
    // no trimming on assign (restored original behavior)

    // store buffer in decodedSounds
    decodedSounds[slotIndex] = buffer;

    // create a pseudo-url for trimming storage and identification
    const pseudoUrl = `local:${file.name}`;
    trimPositions.set(pseudoUrl, { start: 0, end: buffer.duration });

    // update or create button for this slot
    let btn = currentButtons[slotIndex];
    if (!btn) {
      btn = document.createElement('button');
      buttonsContainer.appendChild(btn);
      currentButtons[slotIndex] = btn;
    }

  // set label and data-key will be applied to the replacement node so we can
  // ensure any 'empty-slot' class is removed and formatting matches preset buttons
  const key = KEYBOARD_KEYS[slotIndex];

  // remove existing listeners to avoid duplicates
  const newBtn = btn.cloneNode(true);
  // replace in DOM and currentButtons
  buttonsContainer.replaceChild(newBtn, btn);
  currentButtons[slotIndex] = newBtn;

  // apply proper label / key on the replacement node and remove empty-slot styling
  if (key) newBtn.dataset.key = key;
  newBtn.textContent = `Play ${slotIndex + 1} — ${file.name}`;
  newBtn.classList.remove('empty-slot');

    // add click listener to show waveform + play the assigned buffer (same flow as preset buttons)
    newBtn.addEventListener('click', () => {
      try {
        // show waveform + trimbars for this local buffer (use pseudoUrl as identifier)
        showWaveformForSound(buffer, pseudoUrl);
      } catch (err) {
        console.warn('Unable to show waveform for local file', err);
      }

      // resume audio context on user gesture
      if (ctx.state === 'suspended') ctx.resume();

      // compute start/end from stored trims (if available) or trimbars
      let start = 0;
      let end = buffer.duration;
      const stored = trimPositions.get(pseudoUrl);
      if (stored) {
        start = stored.start;
        end = stored.end;
      } else if (trimbarsDrawer) {
        const l = trimbarsDrawer.leftTrimBar.x;
        const r = trimbarsDrawer.rightTrimBar.x;
        start = pixelToSeconds(l, buffer.duration, waveformCanvas.width);
        end = pixelToSeconds(r, buffer.duration, waveformCanvas.width);
      }

      // clamp
      start = Math.max(0, Math.min(start, buffer.duration));
      end = Math.max(start + 0.01, Math.min(end, buffer.duration));

      // store current trim before playing
      trimPositions.set(pseudoUrl, { start, end });

      // play using stored trims
      playSound(ctx, buffer, start, end);
    });

    // re-enable drag/drop & picker on the replacement button
    enableDragDropOnButton(newBtn, slotIndex);
    enableFilePickerOnButton(newBtn, slotIndex);

    // small visual feedback
    newBtn.classList.add('assigned-local');
    setTimeout(() => newBtn.classList.remove('assigned-local'), 400);
    showStatus(`Assigned ${file.name} to slot ${slotIndex + 1}`);
  } catch (err) {
    console.error('assignFileToSlot error', err);
    showError('Impossible de décoder le fichier audio (format non supporté?)');
  }
}



function enableDragDropOnButton(btn, slotIndex) {
  btn.addEventListener('dragover', (e) => { e.preventDefault(); btn.classList.add('drag-over'); });
  btn.addEventListener('dragleave', () => btn.classList.remove('drag-over'));
  btn.addEventListener('drop', async (e) => {
    e.preventDefault();
    btn.classList.remove('drag-over');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    await assignFileToSlot(f, slotIndex);
  });
}

function enableFilePickerOnButton(btn, slotIndex) {
  // Add a small assign icon (bottom-right) that opens the file picker when clicked.
  // This prevents accidental picker opening when the user double-clicks to play.
  let assign = btn.querySelector('.assign-icon');
  if (!assign) {
    // use a non-button element to avoid nesting interactive controls inside a <button>
    assign = document.createElement('span');
    assign.className = 'assign-icon';
    assign.title = 'Assign local file';
    assign.textContent = '+';
    assign.tabIndex = 0; // make focusable for keyboard
    assign.style.cursor = 'pointer';
    assign.style.userSelect = 'none';
    btn.appendChild(assign);
  }
  assign.onclick = (e) => {
    e.stopPropagation();
    // show chooser to pick a local file or select from saved recordings
    showRecordingsChooser(slotIndex, assign);
  };
  // prevent parent button from receiving mouse events originating on the assign icon
  assign.addEventListener('mousedown', (e) => { e.stopPropagation(); });
  assign.addEventListener('mouseup', (e) => { e.stopPropagation(); });
  // support keyboard activation (Enter / Space)
  assign.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      assign.click();
    }
  });
}

function pickFileForSlot(slotIndex) {
  filePicker.onchange = async (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (f) await assignFileToSlot(f, slotIndex);
    filePicker.value = '';
    filePicker.onchange = null;
  };
  filePicker.click();
}

// Show a small chooser UI near the assign button to pick a saved recording or local file
async function showRecordingsChooser(slotIndex, anchorEl) {
  // remove any existing chooser
  const existing = document.getElementById('recordingsChooser');
  if (existing) existing.remove();

  const container = document.createElement('div');
  container.id = 'recordingsChooser';
  container.style.position = 'absolute';
  container.style.zIndex = 9999;
  // visual styles (background, border, shadow, padding) are controlled by CSS
  container.style.padding = '8px';
  container.style.maxHeight = '220px';
  container.style.overflow = 'auto';

  // position near anchor
  const rect = anchorEl.getBoundingClientRect();
  container.style.left = `${rect.right + window.scrollX + 6}px`;
  container.style.top = `${rect.top + window.scrollY}px`;

  const title = document.createElement('div');
  title.textContent = 'Choisir une source';
  title.style.fontWeight = '600';
  title.style.marginBottom = '6px';
  container.appendChild(title);

  // two-button menu: local file OR saved recordings
  const btnRow = document.createElement('div');
  btnRow.style.display = 'flex';
  btnRow.style.gap = '6px';
  btnRow.style.marginBottom = '8px';

  const localBtn = document.createElement('button');
  localBtn.type = 'button';
  localBtn.textContent = 'Fichier local…';
  localBtn.className = 'action-btn';
  localBtn.onclick = () => { pickFileForSlot(slotIndex); container.remove(); };
  btnRow.appendChild(localBtn);

  const savedBtn = document.createElement('button');
  savedBtn.type = 'button';
  savedBtn.textContent = 'Enregistrements…';
  savedBtn.className = 'action-btn';
  btnRow.appendChild(savedBtn);

  container.appendChild(btnRow);

  // list area (populated only when user clicks "Enregistrements…")
  const list = document.createElement('div');
  list.style.display = 'block';
  list.style.fontSize = '13px';
  list.style.minWidth = '220px';
  container.appendChild(list);

  async function populateRecordings() {
    list.innerHTML = '';
    try {
      const recs = await listRecordings();
      if (!recs || recs.length === 0) {
        const p = document.createElement('div');
        p.textContent = 'Aucun enregistrement trouvé.';
        p.style.color = '#666';
        list.appendChild(p);
        return;
      }
      recs.sort((a,b) => b.created - a.created);
      recs.forEach(r => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.alignItems = 'center';
        row.style.marginBottom = '6px';

        const label = document.createElement('div');
        label.textContent = r.name || `rec-${r.id}`;
        label.title = new Date(r.created).toLocaleString();
        label.style.flex = '1';
        label.style.marginRight = '8px';
        row.appendChild(label);

        const useBtn = document.createElement('button');
        useBtn.type = 'button';
        useBtn.textContent = 'Use';
        useBtn.className = 'action-btn';
        useBtn.onclick = async (e) => {
          e.stopPropagation();
          const ent = await getRecording(r.id);
          if (!ent || !ent.blob) { showError('Impossible de récupérer l’enregistrement.'); return; }
          const file = new File([ent.blob], ent.name || `rec-${r.id}`, { type: ent.type || 'audio/webm' });
          await assignFileToSlot(file, slotIndex);
          container.remove();
        };
        row.appendChild(useBtn);

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.textContent = 'Delete';
        delBtn.style.marginLeft = '6px';
        delBtn.className = 'action-btn';
        delBtn.onclick = async (ev) => {
          ev.stopPropagation();
          if (!confirm(`Supprimer ${r.name || r.id} ?`)) return;
          await deleteRecording(r.id);
          row.remove();
        };
        row.appendChild(delBtn);

        list.appendChild(row);
      });
    } catch (err) {
      const p = document.createElement('div');
      p.textContent = 'Erreur en accédant aux enregistrements.';
      p.style.color = 'red';
      list.appendChild(p);
      console.error('showRecordingsChooser error', err);
    }
  }

  savedBtn.onclick = () => populateRecordings();

  // close on outside click
  function onDocClick(e) {
    if (!container.contains(e.target)) container.remove();
  }
  setTimeout(() => document.addEventListener('click', onDocClick), 10);

  document.body.appendChild(container);

  // ensure chooser fits in viewport: if it overflows right, position it to the left of anchor
  requestAnimationFrame(() => {
    const cRect = container.getBoundingClientRect();
    const winW = window.innerWidth;
    if (cRect.right > winW) {
      const newLeft = Math.max(6, rect.left + window.scrollX - cRect.width - 6);
      container.style.left = `${newLeft}px`;
    }
    // if bottom overflows, clamp vertically
    const winH = window.innerHeight;
    if (cRect.bottom > winH) {
      const newTop = Math.max(6, rect.bottom + window.scrollY - cRect.height);
      container.style.top = `${newTop}px`;
    }
  });
}

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
    const localBuffers = decodedSounds.map((b,i) => ({ buffer: b || null, name: (currentButtons[i] && currentButtons[i].textContent) ? currentButtons[i].textContent : `sound ${i+1}`, index: i }));
    const available = localBuffers.filter(x => x.buffer);
    if (!available || available.length === 0) { showError('Aucun son local disponible.'); return; }
    showLocalSoundsChooser(container, async (selectedItems) => {
      // selectedItems: array of { buffer, name, index }
      // build buffers array of length 16 placing selected sounds in order
      const steps = 16;
      const buffers = new Array(steps).fill(null);
      const names = new Array(steps).fill('');
      selectedItems.slice(0,steps).forEach((it, i) => { buffers[i] = it.buffer; names[i] = it.name || `sound ${i+1}`; });
      createPresetFromBuffers(`Local sampler ${Date.now()}`, buffers, names, 'buffers');
    });
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
    // take most recent recording or first decoded sound
    let buf = null;
    const recs = await listRecordings();
    if (recs && recs.length) {
      const r = recs.sort((a,b)=>b.created-a.created)[0];
      const ent = await getRecording(r.id);
      if (ent && ent.blob) {
        const file = new File([ent.blob], ent.name || `rec-${r.id}`, { type: ent.type || 'audio/webm' });
        buf = await decodeFileToBuffer(file);
      }
    }
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

  // build grid of buttons (reuse same logic as loadPresetByIndex but without decoding)
  const totalSlots = KEYBOARD_KEYS.length || 16;
  for (let i=0;i<totalSlots;i++) {
    const btn = document.createElement('button');
    const assignedKey = KEYBOARD_KEYS[i] || null;
    if (assignedKey) btn.dataset.key = assignedKey;

    const buffer = decodedSounds[i];
    const name = data.names && data.names[i] ? data.names[i] : (buffer ? `sound ${i+1}` : '');
    if (buffer) {
      btn.textContent = `Play ${i+1} — ${name}`;
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

// Display chooser to pick local decoded sounds (checkbox list, max 16)
async function showLocalSoundsChooser(anchorEl, onCreate) {
  const existing = document.getElementById('localSoundsChooser');
  if (existing) { existing.remove(); return; }

  // gather decodedSounds (local assignments) and recordings from IndexedDB
  const decodedItems = decodedSounds.map((b,i) => ({
    id: `local-${i}`,
    source: 'local',
    buffer: b || null,
    name: (currentButtons[i] && currentButtons[i].textContent) ? currentButtons[i].textContent : `sound ${i+1}`,
    index: i
  }));

  let recs = [];
  try {
    recs = await listRecordings();
  } catch (err) {
    console.warn('Unable to list recordings', err);
  }

  const recordingItems = (recs || []).map(r => ({
    id: `rec-${r.id}`,
    source: 'recording',
    buffer: null,
    blob: r.blob,
    name: r.name || `rec-${r.id}`,
    recId: r.id
  }));

  const items = [...decodedItems, ...recordingItems];
  const available = items.filter(it => it.buffer || it.blob);
  if (!available || available.length === 0) { showError('Aucun son local disponible.'); return; }

  const container = document.createElement('div');
  container.id = 'localSoundsChooser';
  container.style.position = 'absolute';
  container.style.zIndex = '10000';
  container.style.padding = '10px';

  const rect = anchorEl.getBoundingClientRect();
  container.style.left = `${Math.max(6, rect.left + window.scrollX)}px`;
  container.style.top = `${rect.bottom + window.scrollY + 8}px`;

  const title = document.createElement('div');
  title.textContent = 'Choisir jusqu’à 16 sons locaux';
  title.style.fontWeight = '700';
  title.style.marginBottom = '8px';
  container.appendChild(title);

  const list = document.createElement('div');
  list.style.maxHeight = '320px';
  list.style.overflow = 'auto';
  list.style.marginBottom = '8px';
  container.appendChild(list);

  let selectedCount = 0;
  const checkboxes = [];

  available.forEach((it, idx) => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.justifyContent = 'space-between';
    row.style.marginBottom = '6px';

    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.alignItems = 'center';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.style.marginRight = '8px';
    cb.dataset.itemId = it.id;
    checkboxes.push(cb);

    const label = document.createElement('div');
    label.textContent = it.name;
    label.style.flex = '1';
    left.appendChild(cb);
    left.appendChild(label);

    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'action-btn';
    play.textContent = 'Play';
    play.style.marginLeft = '8px';
    play.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (ctx.state === 'suspended') ctx.resume();
      try {
        let buffer = it.buffer;
        if (!buffer && it.blob) {
          const file = new File([it.blob], it.name || 'rec.webm', { type: it.blob.type });
          buffer = await decodeFileToBuffer(file);
          // cache decoded buffer for reuse
          it.buffer = buffer;
        }
        if (buffer) playSound(ctx, buffer, 0, buffer.duration);
      } catch (err) {
        console.error('play preview error', err);
      }
    });

    row.appendChild(left);
    row.appendChild(play);
    list.appendChild(row);

    cb.addEventListener('change', () => {
      if (cb.checked) {
        if (selectedCount >= 16) { cb.checked = false; showError('Limite 16 sons'); return; }
        selectedCount++;
      } else {
        selectedCount = Math.max(0, selectedCount - 1);
      }
    });
  });

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.gap = '8px';

  const createBtn = document.createElement('button');
  createBtn.type = 'button';
  createBtn.className = 'action-btn';
  createBtn.textContent = 'Créer le sampler';
  createBtn.addEventListener('click', async () => {
    const selected = [];
    for (const cb of checkboxes) {
      if (cb.checked) {
        const id = cb.dataset.itemId;
        const it = available.find(x => x.id === id);
        if (!it) continue;
        // ensure buffer is decoded for recordings
        if (!it.buffer && it.blob) {
          try {
            const file = new File([it.blob], it.name || 'rec.webm', { type: it.blob.type });
            it.buffer = await decodeFileToBuffer(file);
          } catch (err) { console.error('decode for create error', err); }
        }
        selected.push({ buffer: it.buffer, name: it.name, index: it.index });
      }
    }
    if (selected.length === 0) { showError('Sélectionne au moins un son'); return; }
    onCreate(selected);
    container.remove();
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'action-btn';
  cancelBtn.textContent = 'Annuler';
  cancelBtn.addEventListener('click', () => container.remove());

  actions.appendChild(createBtn);
  actions.appendChild(cancelBtn);
  container.appendChild(actions);

  document.body.appendChild(container);
  // after appending, ensure chooser fits in viewport and adjust position if needed
  requestAnimationFrame(() => {
    const cRect = container.getBoundingClientRect();
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    // adjust horizontal position if overflowing right
    if (cRect.right > winW) {
      const newLeft = Math.max(6, Math.min(rect.left + window.scrollX, winW - cRect.width - 6));
      container.style.left = `${newLeft}px`;
    }
    // adjust vertical position if overflowing bottom (open above anchor if needed)
    if (cRect.bottom > winH) {
      const newTop = Math.max(6, rect.top + window.scrollY - cRect.height - 8);
      container.style.top = `${newTop}px`;
    }
  });

  setTimeout(() => document.addEventListener('click', (e) => { if (!container.contains(e.target)) container.remove(); }), 10);
}
