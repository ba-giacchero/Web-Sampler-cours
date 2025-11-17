// Exercise 3 — fetch presets from REST API and load sounds for the selected preset
// Corrigé pour Live Server + API sur http://localhost:3000

import { loadAndDecodeSound, playSound } from './soundutils.js';
import TrimbarsDrawer from './trimbarsdrawer.js';
import { pixelToSeconds } from './utils.js';

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

// Etat
let presets = [];          // [{ name, files:[absoluteUrl,...] }, ...]
let decodedSounds = [];    // AudioBuffer[] du preset courant
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

    // 3) Charge le premier preset par défaut
    presetSelect.disabled = false;
  // create waveform UI (hidden until a sound is selected)
  createWaveformUI();
  await loadPresetByIndex(0);

    // 4) Changement de preset
    presetSelect.addEventListener('change', async () => {
      const idx = Number(presetSelect.value);
      await loadPresetByIndex(idx);
    });

    // keyboard listener for triggering sounds via assigned keys
    window.addEventListener('keydown', onGlobalKeyDown);

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
    const buffer = await decodeFileToBuffer(file);

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
    assign = document.createElement('button');
    assign.type = 'button';
    assign.className = 'assign-icon';
    assign.title = 'Assign local file';
    assign.textContent = '+';
    btn.appendChild(assign);
  }
  assign.onclick = (e) => {
    e.stopPropagation();
    pickFileForSlot(slotIndex);
  };
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
