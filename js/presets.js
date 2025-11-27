import { pixelToSeconds } from './utils.js';

export function initPresets(deps = {}) {
  const {
    API_BASE,
    loadAndDecodeSound,
    buttonsContainer,
    KEYBOARD_KEYS,
    playSound,
    showWaveformForSound,
    showStatus,
    showError,
    decodeFileToBuffer,
    drawMiniWaveform,
    trimPositions
  } = deps;

  let presets = [];
  const generatedPresetStore = new Map();
  let lastDecodedSounds = [];
  let assignments = null;
  let waveformCanvas = null;
  let trimbarsDrawer = null;

  function setAssignments(a) { assignments = a; }
  function setWaveformUI(ui) { if (ui) { waveformCanvas = ui.waveformCanvas; trimbarsDrawer = ui.trimbarsDrawer; } }

  async function fetchPresets(url) {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status} en récupérant ${url}`);
    return res.json();
  }

  function normalizePresets(raw) {
    const makeAbsFromApi = (p) => new URL(p, API_BASE).toString();

    if (Array.isArray(raw)) {
      return raw.map((preset, i) => {
        let files = [];
        if (Array.isArray(preset.samples)) {
          files = preset.samples
            .map(s => s && s.url ? `presets/${s.url}` : null)
            .filter(Boolean)
            .map(makeAbsFromApi);
        } else if (Array.isArray(preset.files)) {
          files = preset.files.map(makeAbsFromApi);
        } else if (Array.isArray(preset.urls)) {
          files = preset.urls.map(makeAbsFromApi);
        }

        return { name: preset.name || preset.title || `Preset ${i + 1}`, files };
      }).filter(p => p.files.length > 0);
    }

    if (raw && Array.isArray(raw.presets)) return normalizePresets(raw.presets);
    return [];
  }

  async function loadGeneratedPreset(preset) {
    const data = generatedPresetStore.get(preset.id);
    if (!data) throw new Error('Generated preset not found');
    const decodedSounds = data.buffers.slice(0);
    lastDecodedSounds = decodedSounds.slice(0);
    const mapping = [12,13,14,15,8,9,10,11,4,5,6,7,0,1,2,3];
    const assignedBuffers = new Array(16).fill(null);
    const assignedIndex = new Array(16).fill(null);
    for (let p = 0; p < data.buffers.length && p < mapping.length; p++) {
      assignedBuffers[mapping[p]] = data.buffers[p];
      assignedIndex[mapping[p]] = p;
    }

    // build grid
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
          try { if (window && window.ctx && window.ctx.state === 'suspended') window.ctx.resume(); } catch (e) {}
          let start = 0, end = buffer.duration;
          const stored = trimPositions.get(pseudoUrl);
          if (stored) { start = stored.start; end = stored.end; }
          start = Math.max(0, Math.min(start, buffer.duration));
          end = Math.max(start+0.01, Math.min(end, buffer.duration));
          trimPositions.set(pseudoUrl, { start, end });
          const rate = (data.type === 'pitch' && data.pitchRates && data.pitchRates[i]) ? data.pitchRates[i] : undefined;
          if (typeof rate !== 'undefined') playSound(buffer, start, end, rate); else playSound(buffer, start, end);
        });
      } else {
        btn.textContent = '';
        btn.classList.add('empty-slot');
      }

      if (assignments && typeof assignments.enableDragDropOnButton === 'function') assignments.enableDragDropOnButton(btn, i);
      if (assignments && typeof assignments.enableFilePickerOnButton === 'function') assignments.enableFilePickerOnButton(btn, i);
      buttonsContainer.appendChild(btn);
      // keep main's currentButtons in sync so assignments can replace this node later
      if (assignments && typeof assignments.setCurrentButton === 'function') assignments.setCurrentButton(i, btn);
    }
  }

  function createPresetFromBuffers(name, buffers, names, type='buffers', pitchRates) {
    const id = `gen-${Date.now()}`;
    generatedPresetStore.set(id, { buffers, names, type, pitchRates });
    presets.push({ name, generated: true, type, id });
    const opt = document.createElement('option');
    opt.value = String(presets.length - 1);
    opt.textContent = name;
    // caller is responsible for adding option into the select
    return { id, opt };
  }

  async function loadPresetByIndex(idx) {
    const preset = presets[idx];
    if (!preset) return;
    buttonsContainer.innerHTML = '';
    showError('');
    if (preset.generated) {
      showStatus(`Loading generated preset…`);
      try {
        await loadGeneratedPreset(preset);
        showStatus(`Loaded preset: ${preset.name}`);
      } catch (err) { console.error(err); showError('Erreur lors du chargement du preset généré.'); }
      return;
    }

    showStatus(`Loading ${preset.files.length} file(s)…`);
    try {
      const decodedSounds = await Promise.all(preset.files.map(url => loadAndDecodeSound(url)));
      lastDecodedSounds = decodedSounds.slice(0);
      const mapping = [12,13,14,15,8,9,10,11,4,5,6,7,0,1,2,3];
      const assignedDecoded = new Array(16).fill(null);
      const assignedUrls = new Array(16).fill(null);
      const assignedIndex = new Array(16).fill(null);
      for (let p = 0; p < decodedSounds.length && p < mapping.length; p++) {
        const target = mapping[p];
        assignedDecoded[target] = decodedSounds[p];
        assignedUrls[target] = preset.files[p];
        assignedIndex[target] = p;
      }

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
          btn.addEventListener('click', () => {
            try { showWaveformForSound(decodedSound, url); } catch (err) { console.warn('Unable to show waveform', err); }
            try { if (window && window.ctx && window.ctx.state === 'suspended') window.ctx.resume(); } catch (e) {}
            let start = 0; let end = decodedSound.duration;
            const stored = trimPositions.get(url);
            if (stored) { start = stored.start; end = stored.end; }
            else if (trimbarsDrawer && waveformCanvas) {
              const l = trimbarsDrawer.leftTrimBar.x; const r = trimbarsDrawer.rightTrimBar.x;
              start = pixelToSeconds(l, decodedSound.duration, waveformCanvas.width);
              end = pixelToSeconds(r, decodedSound.duration, waveformCanvas.width);
            }
            start = Math.max(0, Math.min(start, decodedSound.duration));
            end = Math.max(start + 0.01, Math.min(end, decodedSound.duration));
            trimPositions.set(url, { start, end });
            playSound(decodedSound, start, end);
          });
        } else {
          btn.textContent = '';
          btn.classList.add('empty-slot');
          btn.title = `Add a sound to slot ${i + 1}`;
        }

        if (assignments && typeof assignments.enableDragDropOnButton === 'function') assignments.enableDragDropOnButton(btn, i);
        if (assignments && typeof assignments.enableFilePickerOnButton === 'function') assignments.enableFilePickerOnButton(btn, i);

        buttonsContainer.appendChild(btn);
        // keep main's currentButtons in sync so assignments.replace logic finds the node
        if (assignments && typeof assignments.setCurrentButton === 'function') assignments.setCurrentButton(i, btn);
      }

      showStatus(`Loaded preset: ${preset.name} (${decodedSounds.length} sounds)`);
    } catch (err) { console.error(err); showError(`Erreur lors du chargement du preset "${preset.name}": ${err.message || err}`); }
  }

  return {
    fetchPresets,
    normalizePresets,
    loadPresetByIndex,
    createPresetFromBuffers,
    loadGeneratedPreset,
    setAssignments,
    setWaveformUI,
    setPresets: (p) => { presets = p; },
    getDecodedSounds: () => lastDecodedSounds
  };
}
