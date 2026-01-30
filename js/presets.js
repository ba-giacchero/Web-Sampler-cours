import { pixelToSeconds } from './utils.js';

// Module de gestion des presets : charge, normalise et affiche les kits de sons
// Factory pour créer un système de presets avec injection de dépendances
export function initPresets(deps = {}) {
  // Dépendances injectées pour chargement, affichage et interaction
  const {
    API_BASE,
    loadAndDecodeSound,
    loadAndDecodeWithProgress,
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

  // État interne : liste de presets, cache des presets générés, sons décodés
  let presets = [];
  const generatedPresetStore = new Map();
  let lastDecodedSounds = [];
  let assignments = null;
  let waveformCanvas = null;
  let trimbarsDrawer = null;

  // Injecte le module d'assignations (drag-drop, file picker)
  function setAssignments(a) { assignments = a; }
  // Injecte l'interface de visualisation du waveform et les trim bars
  function setWaveformUI(ui) { if (ui) { waveformCanvas = ui.waveformCanvas; trimbarsDrawer = ui.trimbarsDrawer; } }

  // Récupère les données de presets depuis une URL (JSON) avec CORS
  async function fetchPresets(url) {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status} en récupérant ${url}`);
    return res.json();
  }

  // Normalise différents formats de presets en structure standard { name, files }
  // Supporte : array direct, presets.samples, presets.files, presets.urls
  function normalizePresets(raw) {
    // Convertit les chemins relatifs en URLs absolues basées sur API_BASE
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
        // keep presets even if they have no files yet so they appear
        // in the sampler list (they will just create empty pads)
        return { name: preset.name || preset.title || `Preset ${i + 1}`, files };
      }).filter(p => Array.isArray(p.files));
    }

    if (raw && Array.isArray(raw.presets)) return normalizePresets(raw.presets);
    return [];
  }

  // Charge un preset généré (depuis slicer, pitch sampler, etc.)
  // Crée une grille de boutons avec les buffers audio et positions de trim
  async function loadGeneratedPreset(preset) {
    // Récupère les buffers audio stockés pour ce preset
    const data = generatedPresetStore.get(preset.id);
    if (!data) throw new Error('Generated preset not found');
    const decodedSounds = data.buffers.slice(0);
    lastDecodedSounds = decodedSounds.slice(0);
    // Mapping spatial : remet les sons dans l'ordre de grille
    const mapping = [12,13,14,15,8,9,10,11,4,5,6,7,0,1,2,3];
    const assignedBuffers = new Array(16).fill(null);
    const assignedIndex = new Array(16).fill(null);
    // Remappe les buffers selon la grille 4x4
    for (let p = 0; p < data.buffers.length && p < mapping.length; p++) {
      assignedBuffers[mapping[p]] = data.buffers[p];
      assignedIndex[mapping[p]] = p;
    }

    // Crée une grille de 16 boutons, chacun associé à un son ou vide
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

  // Crée un preset à partir de buffers audio (pour slicer, pitch sampler, etc.)
  // Retourne { id, opt } pour ajouter le preset à la liste
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

  // Charge un preset par index : récupère le JSON, crée la grille de boutons
  // Gère le chargement progressif avec barres de progression par fichier
  async function loadPresetByIndex(idx) {
    const preset = presets[idx];
    if (!preset) return;
    // Vide la grille et réinitialise les messages d'erreur
    buttonsContainer.innerHTML = '';
    showError('');
    // Gérée de manière spéciale : les buffers sont déjà en mémoire
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
      // Précrée les boutons et lance les chargements en parallèle
      const mapping = [12,13,14,15,8,9,10,11,4,5,6,7,0,1,2,3];
      const totalSlots = KEYBOARD_KEYS.length || 16;
      lastDecodedSounds = [];
      // Crée les boutons avec barres de progression et démarre les chargements
      const slotButtons = new Array(totalSlots).fill(null);
      const loadPromises = [];
      for (let i = 0; i < totalSlots; i++) {
        const btn = document.createElement('button');
        slotButtons[i] = btn;
        const assignedKey = KEYBOARD_KEYS[i] || null;
        if (assignedKey) btn.dataset.key = assignedKey;
        // Détermine si ce slot est associé à un fichier du preset
        const mapIndex = mapping.indexOf(i);
        const hasFile = mapIndex !== -1 && mapIndex < preset.files.length;
        if (hasFile) {
          const url = preset.files[mapIndex];
          const name = (url && url.split('/').pop()) || `sound ${mapIndex + 1}`;
          const soundNum = mapIndex + 1;
          btn.textContent = `Loading ${soundNum} — ${name}`;
          // Crée une barre de progression pour ce fichier
          const prog = document.createElement('progress');
          prog.value = 0; prog.max = 1;
          prog.style.display = 'block';
          prog.style.width = '100%';
          prog.style.marginTop = '6px';
          btn.appendChild(prog);

          // Lance le chargement avec mise à jour de la barre si disponible
          const loader = (typeof loadAndDecodeWithProgress === 'function')
            ? loadAndDecodeWithProgress(url, (loaded, total) => { try { if (total > 0) { prog.max = total; prog.value = loaded; } else { prog.removeAttribute('value'); } } catch(_){} })
            : loadAndDecodeSound(url);

          // Quand le fichier est chargé, finalise le bouton et enregistre le buffer
          const p = Promise.resolve(loader).then((decodedSound) => {
            // Remove progress bar and finalize button
            try { prog.remove(); } catch(_){}
            btn.textContent = `Play ${soundNum} — ${name}`;
            // Stocke le son décodé et initialise la position de trim
            lastDecodedSounds[mapIndex] = decodedSound;
            // initialize trim for this url
            trimPositions.set(url, { start: 0, end: decodedSound.duration });
            btn.addEventListener('click', () => {
              try { showWaveformForSound(decodedSound, url); } catch (err) { console.warn('Unable to show waveform', err); }
              try { if (window && window.ctx && window.ctx.state === 'suspended') window.ctx.resume(); } catch (e) {}
              // Récupère les positions de trim : depuis le stockage ou depuis les trim bars
              let start = 0; let end = decodedSound.duration;
              const stored = trimPositions.get(url);
              if (stored) { start = stored.start; end = stored.end; }
              // Fallback : utilise les positions visuelles des trim bars si disponibles
              else if (trimbarsDrawer && waveformCanvas) {
                const l = trimbarsDrawer.leftTrimBar.x; const r = trimbarsDrawer.rightTrimBar.x;
                start = pixelToSeconds(l, decodedSound.duration, waveformCanvas.width);
                end = pixelToSeconds(r, decodedSound.duration, waveformCanvas.width);
              }
              // S'assure que les positions sont valides (min 0.01s de durée)
              start = Math.max(0, Math.min(start, decodedSound.duration));
              end = Math.max(start + 0.01, Math.min(end, decodedSound.duration));
              trimPositions.set(url, { start, end });
              playSound(decodedSound, start, end);
            });
          }).catch((err) => {
            console.error('Load error for', url, err);
            btn.classList.add('empty-slot');
            btn.textContent = '';
          });
          loadPromises.push(p);
        } else {
          btn.textContent = '';
          btn.classList.add('empty-slot');
          btn.title = `Add a sound to slot ${i + 1}`;
        }

        if (assignments && typeof assignments.enableDragDropOnButton === 'function') assignments.enableDragDropOnButton(btn, i);
        if (assignments && typeof assignments.enableFilePickerOnButton === 'function') assignments.enableFilePickerOnButton(btn, i);
        buttonsContainer.appendChild(btn);
        if (assignments && typeof assignments.setCurrentButton === 'function') assignments.setCurrentButton(i, btn);
      }

      await Promise.all(loadPromises);
      showStatus(`Loaded preset: ${preset.name} (${(lastDecodedSounds.filter(Boolean)).length} sounds)`);
    } catch (err) { console.error(err); showError(`Erreur lors du chargement du preset "${preset.name}": ${err.message || err}`); }
  }

  // Exporte l'API publique du module de presets
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
