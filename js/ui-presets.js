import { pixelToSeconds } from './utils.js';

export function initUIPresets(deps = {}) {
  const {
    presetSelect,
    showLocalSoundsChooser,
    listRecordings,
    getRecording,
    decodeFileToBuffer,
    drawMiniWaveform,
    getDecodedSounds, // () => decodedSounds
    getCurrentButtons, // () => currentButtons
    presetsModuleGetter, // () => presetsModule
    assignments,
    showError,
    showStatus
  } = deps;
  const audioCtx = (deps && deps.ctx) || (typeof window !== 'undefined' && window.ctx) || null;

  function createCustomPresetDropdown() {
    if (!presetSelect) return;
    if (document.querySelector('.custom-select-wrapper')) return;

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
    const dropdown = document.createElement('div');
    dropdown.id = 'presetDropdown';
    dropdown.style.display = 'none';
    dropdown.style.position = 'absolute';
    dropdown.style.zIndex = '9999';
    document.body.appendChild(dropdown);

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
        const rect = btn.getBoundingClientRect();
        const left = Math.max(6, rect.left + window.scrollX);
        const top = rect.bottom + window.scrollY + 8;
        dropdown.style.left = `${left}px`;
        dropdown.style.top = `${top}px`;
        dropdown.style.minWidth = `${Math.max(rect.width, 200)}px`;
        dropdown.style.display = '';
        window.addEventListener('scroll', onWindowScroll, true);
      } else {
        dropdown.style.display = 'none';
        window.removeEventListener('scroll', onWindowScroll, true);
      }
    });

    document.addEventListener('click', (ev) => { if (!wrapper.contains(ev.target) && !dropdown.contains(ev.target)) { dropdown.style.display = 'none'; window.removeEventListener('scroll', onWindowScroll, true); } });
    function onWindowScroll() { dropdown.style.display = 'none'; window.removeEventListener('scroll', onWindowScroll, true); }

    presetSelect.parentElement.insertBefore(wrapper, presetSelect);
  }

  // showAddPresetMenu: uses a number of helpers from main.js via deps
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

    // Create sampler from local sounds
    container.appendChild(makeBtn('Créer un sampler à partir des sons locaux', async () => {
      const decoded = (typeof getDecodedSounds === 'function') ? getDecodedSounds() : [];
      const localBuffers = (decoded || []).map((b,i) => {
        const raw = (getCurrentButtons && typeof getCurrentButtons === 'function' && getCurrentButtons()[i] && getCurrentButtons()[i].textContent) ? getCurrentButtons()[i].textContent.trim() : null;
        const clean = raw ? raw.replace(/^Play\s+\d+\s*[—-]\s*/i, '') : `sound ${i+1}`;
        return { buffer: b || null, name: clean || `sound ${i+1}`, index: i };
      });
      const available = localBuffers.filter(x => x.buffer);
      if (!available || available.length === 0) { showError('Aucun son local disponible.'); return; }
      showLocalSoundsChooser(container, async (selectedItems) => {
        const steps = 16;
        const buffers = new Array(steps).fill(null);
        const names = new Array(steps).fill('');
        selectedItems.slice(0,steps).forEach((it, i) => { buffers[i] = it.buffer; names[i] = it.name || `sound ${i+1}`; });
        const presetsModule = (typeof presetsModuleGetter === 'function') ? presetsModuleGetter() : null;
        if (presetsModule && typeof presetsModule.createPresetFromBuffers === 'function') {
          const res = presetsModule.createPresetFromBuffers(`Local sampler ${Date.now()}`, buffers, names, 'buffers');
          if (res && res.opt) {
            presetSelect.appendChild(res.opt);
            const labelBtn = document.querySelector('.custom-select-btn .label'); if (labelBtn) labelBtn.textContent = res.opt.textContent;
            presetSelect.value = res.opt.value; presetSelect.dispatchEvent(new Event('change'));
          }
        }
      }, { listRecordings, getRecording, decodeFileToBuffer, decodedItems: localBuffers.map((b) => ({ id: `local-${b.index}`, source: 'local', buffer: b.buffer, name: b.name, index: b.index })) }, undefined, { showLoadButton: false });
    }));

    // Slicer on silences
    container.appendChild(makeBtn('Slicer un enregistrement sur les silences', async () => {
      let buf = null;
      const persistentActions = document.getElementById('persistentRecordingActions');
      if (persistentActions && persistentActions._info && persistentActions._info.buffer) {
        buf = persistentActions._info.buffer;
      } else if (typeof window.currentShownBuffer !== 'undefined' && window.currentShownBuffer) {
        buf = window.currentShownBuffer;
      } else {
        const recs = await listRecordings();
        if (!recs || recs.length === 0) { showError('Aucun enregistrement trouvé.'); return; }
        const r = recs.sort((a,b)=>b.created-a.created)[0];
        const ent = await getRecording(r.id);
        if (!ent || !ent.blob) { showError('Impossible de récupérer l’enregistrement.'); return; }
        const file = new File([ent.blob], ent.name || `rec-${r.id}`, { type: ent.type || 'audio/webm' });
        try { buf = await decodeFileToBuffer(file); } catch (err) { showError('Impossible de décoder l’enregistrement.'); return; }
      }

      function sliceBufferOnSilence(buffer, opts = {}) {
        const threshold = typeof opts.threshold === 'number' ? opts.threshold : 0.02;
        const minSilenceDuration = opts.minSilenceDuration || 0.12;
        const minSliceDuration = opts.minSliceDuration || 0.05;
        const padding = typeof opts.padding === 'number' ? opts.padding : 0.03;

        const sr = buffer.sampleRate;
        const len = buffer.length;
        const mono = new Float32Array(len);
        const channels = buffer.numberOfChannels;
        for (let c = 0; c < channels; c++) { const ch = buffer.getChannelData(c); for (let i = 0; i < len; i++) mono[i] += ch[i] / channels; }
        const win = Math.max(1, Math.floor(0.01 * sr));
        const env = new Float32Array(len);
        let sum = 0;
        for (let i = 0; i < len; i++) { sum += Math.abs(mono[i]); if (i >= win) sum -= Math.abs(mono[i - win]); env[i] = sum / Math.min(i + 1, win); }
        const silent = new Uint8Array(len);
        for (let i = 0; i < len; i++) silent[i] = env[i] < threshold ? 1 : 0;
        const minSilenceSamples = Math.floor(minSilenceDuration * sr);
        const minSliceSamples = Math.floor(minSliceDuration * sr);
        const padSamples = Math.floor(padding * sr);
        const segments = [];
        let i = 0;
        while (i < len) {
          while (i < len && silent[i]) i++;
          if (i >= len) break;
          const start = i;
          while (i < len) {
            if (!silent[i]) { i++; continue; }
            let j = i;
            while (j < len && silent[j]) j++;
            if ((j - i) >= minSilenceSamples) { i = j; break; } else { i = j; }
          }
          const end = Math.min(i, len);
          if ((end - start) >= minSliceSamples) { const s = Math.max(0, start - padSamples); const e = Math.min(len, end + padSamples); segments.push({ start: s, end: e }); }
        }
        if (segments.length === 0) segments.push({ start: 0, end: len });
        const out = segments.map(seg => {
          if (!audioCtx) throw new Error('AudioContext not available for slicing');
          const frameCount = seg.end - seg.start;
          const newBuf = audioCtx.createBuffer(channels, frameCount, sr);
          for (let c = 0; c < channels; c++) { const src = buffer.getChannelData(c); const dst = newBuf.getChannelData(c); for (let k = 0; k < frameCount; k++) dst[k] = src[seg.start + k]; }
          return newBuf;
        });
        return out;
      }

      const slices = sliceBufferOnSilence(buf, { threshold: 0.02, minSilenceDuration: 0.12, minSliceDuration: 0.05, padding: 0.03 });
      if (!slices || slices.length === 0) { showError('Aucune découpe trouvée.'); return; }
      const maxSlots = 16;
      let finalSlices = slices;
      if (slices.length > maxSlots) { finalSlices = slices.slice(0, maxSlots); showError(`Trop de slices (${slices.length}), limité à ${maxSlots} premiers.`); }

      const baseName = (persistentActions && persistentActions._info && persistentActions._info.name) ? persistentActions._info.name : (typeof window.currentShownUrl !== 'undefined' && window.currentShownUrl) ? (window.currentShownUrl.split('/').pop() || 'slice') : 'slice';
      const names = finalSlices.map((_, i) => `${baseName} ${i + 1}`);
      const presetsModule = (typeof presetsModuleGetter === 'function') ? presetsModuleGetter() : null;
      if (presetsModule && typeof presetsModule.createPresetFromBuffers === 'function') {
        const res = presetsModule.createPresetFromBuffers(`Sliced sampler ${Date.now()}`, finalSlices, names, 'buffers');
        if (res && res.opt) { presetSelect.appendChild(res.opt); const labelBtn = document.querySelector('.custom-select-btn .label'); if (labelBtn) labelBtn.textContent = res.opt.textContent; presetSelect.value = res.opt.value; presetSelect.dispatchEvent(new Event('change')); }
      }
    }));

    // Pitch sampler
    container.appendChild(makeBtn('Créer un sampler en pitchant le son', async () => {
      let buf = null;
      const persistentActions = document.getElementById('persistentRecordingActions');
      if (persistentActions && persistentActions._info && persistentActions._info.buffer) { buf = persistentActions._info.buffer; }
      else if (typeof window.currentShownBuffer !== 'undefined' && window.currentShownBuffer) { buf = window.currentShownBuffer; }
      if (!buf) {
        try {
          const recs = await listRecordings();
          if (recs && recs.length) {
            const r = recs.sort((a,b)=>b.created-a.created)[0];
            const ent = await getRecording(r.id);
            if (ent && ent.blob) { const file = new File([ent.blob], ent.name || `rec-${r.id}`, { type: ent.type || 'audio/webm' }); try { buf = await decodeFileToBuffer(file); } catch (err) { console.warn('decode recent recording failed', err); } }
          }
        } catch (err) { console.warn('error while fetching recordings for pitch sampler fallback', err); }
      }
      const decoded = (typeof getDecodedSounds === 'function') ? getDecodedSounds() : [];
      if (!buf && decoded && decoded.find(Boolean)) buf = decoded.find(Boolean);
      if (!buf) { showError('Aucun son disponible pour pitcher.'); return; }
      const steps = 16; const min = 0.6; const max = 1.8;
      const rates = Array.from({length: steps}, (_,i) => min + (i/(steps-1))*(max-min));
      const buffers = new Array(steps).fill(null).map(() => buf);
      const names = rates.map((r,i) => `pitch ${Math.round(r*100)}%`);
      const presetsModule = (typeof presetsModuleGetter === 'function') ? presetsModuleGetter() : null;
      if (presetsModule && typeof presetsModule.createPresetFromBuffers === 'function') {
        const res = presetsModule.createPresetFromBuffers(`Pitch sampler ${Date.now()}`, buffers, names, 'pitch', rates);
        if (res && res.opt) { presetSelect.appendChild(res.opt); const labelBtn = document.querySelector('.custom-select-btn .label'); if (labelBtn) labelBtn.textContent = res.opt.textContent; presetSelect.value = res.opt.value; presetSelect.dispatchEvent(new Event('change')); }
      }
    }));

    document.body.appendChild(container);
    setTimeout(() => document.addEventListener('click', (e) => { if (!container.contains(e.target)) container.remove(); }), 10);
  }

  return { createCustomPresetDropdown, showAddPresetMenu };
}
