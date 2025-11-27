const KEYBOARD_KEYS = ['&','é','"','\'','a','z','e','r','q','s','d','f','w','x','c','v'];

class WebSampler extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._ctx = null;
    this._buffers = new Array(16).fill(null);
    this._buttons = [];
    this._mapping = KEYBOARD_KEYS; // index -> key
    this._slotRates = new Array(16).fill(undefined); // per-slot playbackRate for pitch presets
    this._presets = [];
    this._render();
  }

  connectedCallback() {
    this._ensureAudioContext();
    this._bindKeys();
  }

  disconnectedCallback() {
    window.removeEventListener('keydown', this._keyHandler);
  }

  _ensureAudioContext() {
    if (!this._ctx) {
      try {
        this._ctx = new (window.AudioContext || window.webkitAudioContext)();
        // also make it accessible for pages that expect window.ctx
        if (!window.ctx) window.ctx = this._ctx;
      } catch (e) {
        console.warn('AudioContext not available', e);
      }
    }
  }

  async _decodeFile(file) {
    const ab = await file.arrayBuffer();
    return await this._ctx.decodeAudioData(ab);
  }

  _playBuffer(buffer, start = 0, end = null, rate = 1) {
    if (!buffer || !this._ctx) return;
    const src = this._ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    src.connect(this._ctx.destination);
    const dur = buffer.duration;
    const s = Math.max(0, Math.min(start, dur));
    const e = (typeof end === 'number') ? Math.max(s + 0.01, Math.min(end, dur)) : dur;
    try {
      src.start(0, s, e - s);
    } catch (err) { console.warn('play error', err); }
    return src;
  }

  _bindKeys() {
    this._keyHandler = (e) => {
      if (e.repeat) return;
      const tgt = e.target; const tag = tgt && tgt.tagName && tgt.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tgt.isContentEditable) return;
      const key = String(e.key || '').toLowerCase();
      const idx = this._mapping.indexOf(key);
      if (idx === -1) return;
      const btn = this._buttons[idx];
      if (!btn) return;
      btn.classList.add('playing');
      try { btn.click(); } catch (err) { console.warn('trigger error', err); }
      setTimeout(()=>btn.classList.remove('playing'), 140);
    };
    window.addEventListener('keydown', this._keyHandler);
  }

  _render() {
    const wrapper = document.createElement('div');
    wrapper.className = 'sampler';

    // controls area: presets select + add preset button
    const controls = document.createElement('div');
    controls.className = 'controls';

    const topControls = document.createElement('div');
    topControls.style.display = 'flex';
    topControls.style.gap = '8px';

    this._presetSelect = document.createElement('select');
    this._presetSelect.disabled = true;
    this._presetSelect.title = 'Select preset';

    this._addPresetBtn = document.createElement('button');
    this._addPresetBtn.type = 'button';
    this._addPresetBtn.className = 'action-btn';
    this._addPresetBtn.textContent = 'Ajouter preset';
    this._addPresetBtn.disabled = true;
    this._addPresetBtn.addEventListener('click', (e) => { e.stopPropagation(); this._showAddPresetMenu(this._addPresetBtn); });

    topControls.appendChild(this._presetSelect);
    topControls.appendChild(this._addPresetBtn);
    controls.appendChild(topControls);

    // additional UI: slicer source selector, preview canvas, recorder buttons
    const extraRow = document.createElement('div');
    extraRow.style.display = 'flex';
    extraRow.style.alignItems = 'center';
    extraRow.style.gap = '8px';

    // slicer source select
    this._slicerSource = document.createElement('select');
    this._slicerSource.title = 'Slicer source';
    // populate with slots + preview option later
    const optPreview = document.createElement('option'); optPreview.value = 'preview'; optPreview.textContent = 'Preview / Recording';
    this._slicerSource.appendChild(optPreview);
    for (let s = 0; s < 16; s++) { const o = document.createElement('option'); o.value = `slot:${s}`; o.textContent = `Slot ${s+1}`; this._slicerSource.appendChild(o); }

    // mini preview canvas
    this._previewCanvas = document.createElement('canvas'); this._previewCanvas.width = 200; this._previewCanvas.height = 48; this._previewCanvas.style.border = '1px solid #ddd';

    // recorder buttons
    this._recordBtn = document.createElement('button'); this._recordBtn.type = 'button'; this._recordBtn.textContent = 'Record';
    this._stopRecordBtn = document.createElement('button'); this._stopRecordBtn.type = 'button'; this._stopRecordBtn.textContent = 'Stop'; this._stopRecordBtn.disabled = true;
    this._addPreviewToSamplerBtn = document.createElement('button'); this._addPreviewToSamplerBtn.type = 'button'; this._addPreviewToSamplerBtn.textContent = 'Ajouter au sampler'; this._addPreviewToSamplerBtn.disabled = true;

    extraRow.appendChild(this._slicerSource);
    extraRow.appendChild(this._previewCanvas);
    extraRow.appendChild(this._recordBtn);
    extraRow.appendChild(this._stopRecordBtn);
    extraRow.appendChild(this._addPreviewToSamplerBtn);

    controls.appendChild(extraRow);

    const grid = document.createElement('div');
    grid.className = 'grid';

    for (let i = 0; i < 16; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot empty';
      slot.dataset.index = String(i);
      slot.title = `Slot ${i+1}`;

      const label = document.createElement('div');
      label.className = 'label';
      label.textContent = '';
      slot.appendChild(label);

      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'audio/*';
      fileInput.addEventListener('change', async (ev) => {
        const f = ev.target.files && ev.target.files[0];
        if (f) await this._assignFileToSlot(f, i, slot);
        fileInput.value = '';
      });
      slot.appendChild(fileInput);

      // click to play
      slot.addEventListener('click', async (ev) => {
        // ignore clicks on the file input overlay
        if (ev.target === fileInput) return;
        const buf = this._buffers[i];
        if (!buf) return; // nothing assigned
        // resume context if suspended
        if (this._ctx && this._ctx.state === 'suspended') try { await this._ctx.resume(); } catch(e){}
        const rate = (this._slotRates && this._slotRates[i]) ? this._slotRates[i] : 1;
        this._playBuffer(buf, 0, buf.duration, rate);
      });

      // allow drop
      slot.addEventListener('dragover', (ev) => { ev.preventDefault(); slot.classList.add('dragover'); });
      slot.addEventListener('dragleave', () => slot.classList.remove('dragover'));
      slot.addEventListener('drop', async (ev) => {
        ev.preventDefault(); slot.classList.remove('dragover');
        const dt = ev.dataTransfer;
        if (dt && dt.files && dt.files.length > 0) {
          const f = dt.files[0];
          await this._assignFileToSlot(f, i, slot);
        }
      });

      grid.appendChild(slot);
      this._buttons.push(slot);
    }

    const hint = document.createElement('div');
    hint.className = 'small';
    hint.innerHTML = 'Click a slot to play. Click the slot to pick a file (file overlay). Or drag & drop an audio file onto a slot.<br>Keyboard: &amp; é " \', a z e r ... (AZERTY-style)';
    controls.appendChild(hint);

    // layout: left grid, right controls (to match base sampler)
    const layout = document.createElement('div');
    layout.className = 'layout';

    const leftCol = document.createElement('div');
    leftCol.className = 'left-col';
    leftCol.appendChild(grid);

    const rightCol = document.createElement('div');
    rightCol.className = 'right-col';
    rightCol.appendChild(controls);

    layout.appendChild(leftCol);
    layout.appendChild(rightCol);
    wrapper.appendChild(layout);

    const style = document.createElement('link');
    style.setAttribute('rel','stylesheet');
    style.setAttribute('href','styles.css');

    this.shadowRoot.appendChild(style);
    this.shadowRoot.appendChild(wrapper);
    // initialize presets after DOM built
    this._initPresets();
    this._wireRecorderUI();
  }

  _wireRecorderUI() {
    this._recordingInfo = null; // { blob, buffer, name }
    this._mediaRecorder = null;
    this._recordChunks = [];

    this._recordBtn.addEventListener('click', async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this._mediaRecorder = new MediaRecorder(stream);
        this._recordChunks = [];
        this._mediaRecorder.ondataavailable = (ev) => { if (ev.data && ev.data.size) this._recordChunks.push(ev.data); };
        this._mediaRecorder.onstop = async () => {
          const blob = new Blob(this._recordChunks, { type: 'audio/webm' });
          const file = new File([blob], `rec-${Date.now()}.webm`, { type: blob.type });
          try {
            const buf = await this._decodeFile(file);
            this._recordingInfo = { blob, buffer: buf, name: file.name };
            this._drawMiniWaveform(buf, this._previewCanvas);
            this._addPreviewToSamplerBtn.disabled = false;
          } catch (err) { console.error('decode recorded file failed', err); alert('Impossible de décoder l\'enregistrement'); }
        };
        this._mediaRecorder.start();
        this._recordBtn.disabled = true; this._stopRecordBtn.disabled = false;
      } catch (err) { console.error('start recording failed', err); alert('Impossible d\'accéder au micro'); }
    });

    this._stopRecordBtn.addEventListener('click', async () => {
      if (this._mediaRecorder && this._mediaRecorder.state === 'recording') {
        this._mediaRecorder.stop();
        this._recordBtn.disabled = false; this._stopRecordBtn.disabled = true;
      }
    });

    this._addPreviewToSamplerBtn.addEventListener('click', async () => {
      if (!this._recordingInfo || !this._recordingInfo.buffer) return;
      const s = prompt('Numéro du slot (1–16) pour assigner ce son:', '1');
      if (!s) return; const n = Number(s); if (!n || isNaN(n) || n < 1 || n > 16) { alert('Numéro invalide'); return; }
      const target = n - 1;
      try {
        await this._assignBufferToSlot(this._recordingInfo.buffer, this._recordingInfo.name, target);
        alert(`Assigné au slot ${n}`);
      } catch (err) { console.error('assign preview failed', err); alert('Impossible d\'assigner le son'); }
    });
  }

  async _assignBufferToSlot(buffer, name, idx) {
    this._buffers[idx] = buffer;
    const slotNode = this._buttons[idx];
    if (slotNode) {
      slotNode.classList.remove('empty');
      slotNode.querySelector('.label').textContent = name || `sound ${idx+1}`;
      this._buttons[idx] = slotNode;
    }
  }

  _drawMiniWaveform(buffer, canvas) {
    if (!buffer || !canvas) return;
    const cw = canvas.width; const ch = canvas.height; const ctx = canvas.getContext('2d'); ctx.clearRect(0,0,cw,ch); ctx.fillStyle='#f4f6f8'; ctx.fillRect(0,0,cw,ch);
    const data = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / cw));
    ctx.strokeStyle = '#0a74da'; ctx.lineWidth = 1; ctx.beginPath();
    for (let x=0;x<cw;x++) {
      const i = x * step; let min=1, max=-1; for (let j=0;j<step && (i+j)<data.length;j++){ const v = data[i+j]; if (v<min) min=v; if (v>max) max=v; }
      const y1 = ((1 - max) * ch)/2; const y2 = ((1 - min) * ch)/2; ctx.moveTo(x, y1); ctx.lineTo(x, y2);
    }
    ctx.stroke();
  }

  // ----- Presets support (fetch + load) -----
  async _initPresets() {
    const API_BASE = this.getAttribute('api-base') || 'http://localhost:3000';
    const PRESETS_URL = `${API_BASE}/api/presets`;
    try {
      const raw = await fetch(PRESETS_URL, { mode: 'cors' }).then(r => { if (!r.ok) throw new Error('fetch presets failed'); return r.json(); });
      const presets = this._normalizePresets(raw, API_BASE);
      if (!Array.isArray(presets) || presets.length === 0) {
        console.warn('No presets available from API');
        return;
      }
      this._presets = presets;
      this._populatePresetSelect(presets);
      this._presetSelect.disabled = false;
      this._addPresetBtn.disabled = false;
      this._presetSelect.addEventListener('change', async () => {
        const idx = Number(this._presetSelect.value);
        await this._loadPresetByIndex(idx);
      });
      await this._loadPresetByIndex(0);
    } catch (err) {
      console.warn('init presets error', err);
    }
  }

  _normalizePresets(raw, API_BASE) {
    const makeAbs = (p) => new URL(p, API_BASE).toString();
    if (Array.isArray(raw)) {
      return raw.map((preset, i) => {
        let files = [];
        if (Array.isArray(preset.samples)) files = preset.samples.map(s => s && s.url ? `presets/${s.url}` : null).filter(Boolean).map(makeAbs);
        else if (Array.isArray(preset.files)) files = preset.files.map(makeAbs);
        else if (Array.isArray(preset.urls)) files = preset.urls.map(makeAbs);
        return { name: preset.name || preset.title || `Preset ${i+1}`, files };
      }).filter(p => p.files && p.files.length > 0);
    }
    if (raw && Array.isArray(raw.presets)) return this._normalizePresets(raw.presets, API_BASE);
    return [];
  }

  _populatePresetSelect(presets) {
    this._presetSelect.innerHTML = '';
    presets.forEach((p,i) => {
      const opt = document.createElement('option'); opt.value = String(i); opt.textContent = p.name || `Preset ${i+1}`; this._presetSelect.appendChild(opt);
    });
  }

  async _loadPresetByIndex(idx) {
    const preset = (this._presets && this._presets[idx]) ? this._presets[idx] : null;
    if (!preset) return;
    this._buffers = new Array(16).fill(null);
    this._slotRates = new Array(16).fill(undefined);
    this._buttons.forEach((btn,i) => { btn.classList.add('empty'); btn.querySelector('.label').textContent = ''; });
    try {
      if (preset.generated) {
        // generated preset contains buffers already
        const decoded = preset.buffers || [];
        const mapping = [12,13,14,15,8,9,10,11,4,5,6,7,0,1,2,3];
        for (let p = 0; p < decoded.length && p < mapping.length; p++) {
          const target = mapping[p];
          this._buffers[target] = decoded[p];
          // apply pitch rate if present
          if (preset.type === 'pitch' && preset.pitchRates && typeof preset.pitchRates[p] !== 'undefined') this._slotRates[target] = preset.pitchRates[p];
          const btn = this._buttons[target]; if (btn) { btn.classList.remove('empty'); btn.querySelector('.label').textContent = (preset.names && preset.names[p]) ? preset.names[p] : `sound ${target+1}`; }
        }
      } else {
        const decoded = await Promise.all(preset.files.map(url => this._loadAndDecode(url)));
        const mapping = [12,13,14,15,8,9,10,11,4,5,6,7,0,1,2,3];
        for (let p = 0; p < decoded.length && p < mapping.length; p++) {
          const target = mapping[p];
          this._buffers[target] = decoded[p];
          const btn = this._buttons[target]; if (btn) { btn.classList.remove('empty'); btn.querySelector('.label').textContent = (preset.files[p] && preset.files[p].split('/').pop()) || `sound ${target+1}`; }
        }
      }
    } catch (err) { console.error('load preset error', err); }
  }

  async _loadAndDecode(url) {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ab = await res.arrayBuffer();
    return await this._ctx.decodeAudioData(ab);
  }

  // Slice buffer on silences and return array of AudioBuffer slices
  _sliceBufferOnSilence(buffer, opts = {}) {
    const threshold = typeof opts.threshold === 'number' ? opts.threshold : 0.02; // amplitude threshold
    const minSilenceDuration = opts.minSilenceDuration || 0.12; // seconds
    const minSliceDuration = opts.minSliceDuration || 0.05; // seconds
    const padding = typeof opts.padding === 'number' ? opts.padding : 0.03; // seconds

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
      const newBuf = this._ctx.createBuffer(channels, frameCount, sr);
      for (let c = 0; c < channels; c++) {
        const src = buffer.getChannelData(c);
        const dst = newBuf.getChannelData(c);
        for (let k = 0; k < frameCount; k++) dst[k] = src[seg.start + k];
      }
      return newBuf;
    });

    return out;
  }

  _showAddPresetMenu(anchorEl) {
    const existing = this.shadowRoot.getElementById('addPresetMenu');
    if (existing) { existing.remove(); return; }
    const container = document.createElement('div'); container.id = 'addPresetMenu'; container.className = 'action-btn'; container.style.position='absolute'; container.style.zIndex='9999'; container.style.padding='8px';
    const rect = anchorEl.getBoundingClientRect(); container.style.left = `${Math.max(6, rect.left + window.scrollX)}px`; container.style.top = `${rect.bottom + window.scrollY + 8}px`;
    const makeBtn = (text, cb) => { const b = document.createElement('button'); b.type='button'; b.className='action-btn'; b.textContent=text; b.style.display='block'; b.style.width='100%'; b.style.marginBottom='6px'; b.addEventListener('click', (e)=>{ e.stopPropagation(); cb(); container.remove(); }); return b; };

    // Create from all local sounds
    container.appendChild(makeBtn('Créer un sampler à partir des sons locaux', async () => {
      const decoded = this._buffers.slice(0);
      const available = decoded.filter(Boolean);
      if (!available || available.length === 0) { alert('Aucun son local disponible.'); return; }
      const steps = 16; const buffers = new Array(steps).fill(null); const names = new Array(steps).fill('');
      let j=0; for (let i=0;i<decoded.length && j<steps;i++) { if (decoded[i]) { buffers[j]=decoded[i]; names[j]=this._buttons[i] && this._buttons[i].querySelector('.label').textContent || `sound ${i+1}`; j++; } }
      const id = `gen-${Date.now()}`;
      const gen = { name: `Local sampler ${Date.now()}`, generated: true, id, buffers, names, type: 'buffers' };
      this._presets.push(gen);
      const opt = document.createElement('option'); opt.value = String((this._presets.length - 1)); opt.textContent = gen.name;
      this._presetSelect.appendChild(opt); this._presetSelect.value = opt.value; this._presetSelect.dispatchEvent(new Event('change'));
    }));

    // Create from a chosen slot (duplicate into 16 slots or map to positions)
    container.appendChild(makeBtn('Créer depuis un slot (choisir)', async () => {
      const s = prompt('Numéro du slot source (1–16) :', '1'); if (!s) return; const n = Number(s); if (!n || isNaN(n) || n<1 || n>16) { alert('Numéro invalide'); return; }
      const buf = this._buffers[n-1]; if (!buf) { alert('Slot vide'); return; }
      const steps = 16; const buffers = new Array(steps).fill(null).map(()=>buf);
      const names = new Array(steps).fill(`slot ${n}`);
      const id = `gen-${Date.now()}`;
      const gen = { name: `From slot ${n} ${Date.now()}`, generated: true, id, buffers, names, type: 'buffers' };
      this._presets.push(gen);
      const opt = document.createElement('option'); opt.value = String((this._presets.length - 1)); opt.textContent = gen.name;
      this._presetSelect.appendChild(opt); this._presetSelect.value = opt.value; this._presetSelect.dispatchEvent(new Event('change'));
    }));

    // Slicer from a chosen slot
    container.appendChild(makeBtn('Slicer un slot choisi', async () => {
      const s = prompt('Numéro du slot à slicer (1–16) :', '1'); if (!s) return; const n = Number(s); if (!n || isNaN(n) || n<1 || n>16) { alert('Numéro invalide'); return; }
      const buf = this._buffers[n-1]; if (!buf) { alert('Slot vide'); return; }
      try {
        const slices = this._sliceBufferOnSilence(buf, { threshold: 0.02, minSilenceDuration: 0.12, minSliceDuration: 0.05, padding: 0.03 });
        if (!slices || slices.length === 0) { alert('Aucune découpe trouvée.'); return; }
        const maxSlots = 16; let finalSlices = slices; if (slices.length > maxSlots) finalSlices = slices.slice(0, maxSlots);
        const names = finalSlices.map((_,i) => `slice ${i+1}`);
        const id = `gen-${Date.now()}`;
        const gen = { name: `Sliced slot ${n} ${Date.now()}`, generated: true, id, buffers: finalSlices, names, type: 'buffers' };
        this._presets.push(gen);
        const opt = document.createElement('option'); opt.value = String((this._presets.length - 1)); opt.textContent = gen.name;
        this._presetSelect.appendChild(opt); this._presetSelect.value = opt.value; this._presetSelect.dispatchEvent(new Event('change'));
      } catch (err) { console.error('slicer error', err); alert('Erreur lors du slicing. Voir console.'); }
    }));

    // Slicer from preview/recording
    container.appendChild(makeBtn('Slicer la preview/enregistrement', async () => {
      const buf = (this._recordingInfo && this._recordingInfo.buffer) ? this._recordingInfo.buffer : this._buffers.find(Boolean);
      if (!buf) { alert('Aucun enregistrement/sound disponible pour slicer.'); return; }
      try {
        const slices = this._sliceBufferOnSilence(buf, { threshold: 0.02, minSilenceDuration: 0.12, minSliceDuration: 0.05, padding: 0.03 });
        if (!slices || slices.length === 0) { alert('Aucune découpe trouvée.'); return; }
        const maxSlots = 16; let finalSlices = slices; if (slices.length > maxSlots) finalSlices = slices.slice(0, maxSlots);
        const names = finalSlices.map((_,i) => `slice ${i+1}`);
        const id = `gen-${Date.now()}`;
        const gen = { name: `Sliced preview ${Date.now()}`, generated: true, id, buffers: finalSlices, names, type: 'buffers' };
        this._presets.push(gen);
        const opt = document.createElement('option'); opt.value = String((this._presets.length - 1)); opt.textContent = gen.name;
        this._presetSelect.appendChild(opt); this._presetSelect.value = opt.value; this._presetSelect.dispatchEvent(new Event('change'));
      } catch (err) { console.error('slicer error', err); alert('Erreur lors du slicing. Voir console.'); }
    }));

    // Create pitch sampler from a chosen slot
    container.appendChild(makeBtn('Créer un sampler en pitchant un slot...', async () => {
      const s = prompt('Numéro du slot source (1–16) :', '1'); if (!s) return; const n = Number(s); if (!n || isNaN(n) || n<1 || n>16) { alert('Numéro invalide'); return; }
      const srcBuf = this._buffers[n-1]; if (!srcBuf) { alert('Slot vide'); return; }
      const steps = 16; const min=0.6, max=1.8; const rates = Array.from({length:steps},(_,i)=>min+(i/(steps-1))*(max-min));
      const buffers = new Array(steps).fill(null).map(()=>srcBuf);
      const names = rates.map((r,i)=>`pitch ${Math.round(r*100)}%`);
      const id = `gen-${Date.now()}`;
      const gen = { name: `Pitch from slot ${n} ${Date.now()}`, generated: true, id, buffers, names, type: 'pitch', pitchRates: rates };
      this._presets.push(gen);
      const opt = document.createElement('option'); opt.value = String((this._presets.length - 1)); opt.textContent = gen.name;
      this._presetSelect.appendChild(opt); this._presetSelect.value = opt.value; this._presetSelect.dispatchEvent(new Event('change'));
    }));

    this.shadowRoot.appendChild(container);
    setTimeout(()=>document.addEventListener('click', (e)=>{ if (!container.contains(e.target)) container.remove(); }), 10);
  }

  async _assignFileToSlot(file, idx, slotNode) {
    if (!file) return;
    try {
      const buf = await this._decodeFile(file);
      this._buffers[idx] = buf;
      // update UI
      slotNode.classList.remove('empty');
      const label = slotNode.querySelector('.label');
      label.textContent = file.name || `sound ${idx+1}`;
      // keep pointer for external use
      this._buttons[idx] = slotNode;
    } catch (err) {
      console.error('assign file failed', err);
    }
  }
}

customElements.define('web-sampler', WebSampler);

export default WebSampler;
