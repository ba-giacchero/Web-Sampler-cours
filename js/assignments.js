// assignments.js
// Extracted helpers for assigning files/buffers to sampler slots,
// drag & drop and file picker wiring.

export function initAssignments(deps) {
  const {
    decodeFileToBuffer,
    buttonsContainer,
    currentButtons,
    getCurrentButtons,
    setCurrentButton,
    KEYBOARD_KEYS,
    trimPositions,
    playSound, // function(buffer,start,end,rate)
    filePicker,
    showRecordingsChooser,
    listRecordings,
    getRecording,
    deleteRecording,
    showWaveformForSound,
    showStatus,
    showError
  } = deps;

  // mapping used across the app: bottom-left -> left->right then upward
  const mapping = [12,13,14,15,8,9,10,11,4,5,6,7,0,1,2,3];
  function displayNumberForSlot(idx) {
    const pos = mapping.indexOf(idx);
    return pos !== -1 ? (pos + 1) : (idx + 1);
  }

  async function pickFileForSlot(slotIndex) {
    if (!filePicker) return;
    filePicker.onchange = async (ev) => {
      const f = ev.target.files && ev.target.files[0];
      if (f) await assignFileToSlot(f, slotIndex);
      filePicker.value = '';
      filePicker.onchange = null;
    };
    filePicker.click();
  }

  async function assignFileToSlot(file, slotIndex, targetBtn) {
    if (!file) return;
    try {
      if (showStatus) showStatus(`Decoding ${file.name}…`);
      const buffer = await decodeFileToBuffer(file);

      // store buffer in decodedSounds via currentButtons usage externally
      // caller is responsible for keeping decodedSounds in sync if needed

      // pseudo-url for trims
      const pseudoUrl = `local:${file.name}`;
      if (trimPositions) trimPositions.set(pseudoUrl, { start: 0, end: buffer.duration });

      // determine which button to replace: prefer explicit targetBtn (from the '+' that was clicked)
      const buttonsArr = (typeof getCurrentButtons === 'function') ? getCurrentButtons() : (currentButtons || []);
      let btn = targetBtn && targetBtn.nodeType === 1 ? targetBtn : buttonsArr[slotIndex];
      // if no button found, create one and append
      if (!btn) {
        btn = document.createElement('button');
        buttonsContainer.appendChild(btn);
        if (typeof setCurrentButton === 'function') setCurrentButton(slotIndex, btn);
        else if (currentButtons) currentButtons[slotIndex] = btn;
      }

      const key = KEYBOARD_KEYS[slotIndex];
      const newBtn = btn.cloneNode(true);
      // if targetBtn was provided and is a child of buttonsContainer, replace that node specifically
      try {
        if (btn.parentElement === buttonsContainer) {
          buttonsContainer.replaceChild(newBtn, btn);
        } else {
          // fallback: try to replace by index using the current buttons array
          const existingArr = (typeof getCurrentButtons === 'function') ? getCurrentButtons() : (currentButtons || []);
          const existing = existingArr[slotIndex];
          if (existing && existing.parentElement === buttonsContainer) buttonsContainer.replaceChild(newBtn, existing);
          else buttonsContainer.appendChild(newBtn);
        }
      } catch (err) {
        // on any error, append as fallback
        buttonsContainer.appendChild(newBtn);
      }
      // ensure main app's currentButtons points to the new node
      if (typeof setCurrentButton === 'function') setCurrentButton(slotIndex, newBtn);
      else if (currentButtons) currentButtons[slotIndex] = newBtn;
      if (key) newBtn.dataset.key = key;
      const soundNum = displayNumberForSlot(slotIndex);
      newBtn.textContent = `Play ${soundNum} — ${file.name}`;
      newBtn.classList.remove('empty-slot');

      newBtn.addEventListener('click', () => {
        try { if (showWaveformForSound) showWaveformForSound(buffer, pseudoUrl); } catch (err) { console.warn('Unable to show waveform for local file', err); }
        try {
          // prefer explicit trim positions stored in trimPositions map (set by waveform-ui)
          let start = 0;
          let end = buffer.duration;
          try {
            const stored = (trimPositions && typeof trimPositions.get === 'function') ? trimPositions.get(pseudoUrl) : null;
            try { console.debug('[assignments] click local pseudoUrl=', pseudoUrl, 'stored=', stored); } catch(e){}
            if (stored) {
              start = typeof stored.start === 'number' ? stored.start : start;
              end = typeof stored.end === 'number' ? stored.end : end;
            }
          } catch (err) { /* ignore trim read errors and fallback to full buffer */ }
          start = Math.max(0, Math.min(start, buffer.duration));
          end = Math.max(start + 0.01, Math.min(end, buffer.duration));
          if (playSound) playSound(buffer, start, end);
        } catch (err) { console.warn('playSound error', err); }
      });

      enableDragDropOnButton(newBtn, slotIndex);
      enableFilePickerOnButton(newBtn, slotIndex);

      newBtn.classList.add('assigned-local');
      setTimeout(() => newBtn.classList.remove('assigned-local'), 400);
      if (showStatus) showStatus(`Assigned ${file.name} to slot ${slotIndex + 1}`);
    } catch (err) {
      console.error('assignFileToSlot error', err);
      if (showError) showError('Impossible de décoder le fichier audio (format non supporté?)');
    }
  }

  async function assignBufferToSlot(buffer, name, slotIndex) {
    if (!buffer) return;
    try {
      const pseudoUrl = `generated:${name}:${Date.now()}`;
      if (trimPositions) trimPositions.set(pseudoUrl, { start: 0, end: buffer.duration });

      const buttonsArr = (typeof getCurrentButtons === 'function') ? getCurrentButtons() : (currentButtons || []);
      let btn = buttonsArr[slotIndex];
      if (!btn) { btn = document.createElement('button'); buttonsContainer.appendChild(btn); if (typeof setCurrentButton === 'function') setCurrentButton(slotIndex, btn); else if (currentButtons) currentButtons[slotIndex] = btn; }

      const key = KEYBOARD_KEYS[slotIndex];
      const newBtn = btn.cloneNode(true);
      try { if (btn.parentElement === buttonsContainer) buttonsContainer.replaceChild(newBtn, btn); else buttonsContainer.appendChild(newBtn); } catch (e) { buttonsContainer.appendChild(newBtn); }
      if (typeof setCurrentButton === 'function') setCurrentButton(slotIndex, newBtn); else if (currentButtons) currentButtons[slotIndex] = newBtn;
      if (key) newBtn.dataset.key = key;
      const soundNum = displayNumberForSlot(slotIndex);
      newBtn.textContent = `Play ${soundNum} — ${name}`;
      newBtn.classList.remove('empty-slot');

      newBtn.addEventListener('click', () => {
        try { if (showWaveformForSound) showWaveformForSound(buffer, pseudoUrl); } catch (e) { console.warn(e); }
        try {
          let start = 0;
          let end = buffer.duration;
          try {
            const stored = (trimPositions && typeof trimPositions.get === 'function') ? trimPositions.get(pseudoUrl) : null;
            if (stored) {
              start = typeof stored.start === 'number' ? stored.start : start;
              end = typeof stored.end === 'number' ? stored.end : end;
            }
          } catch (err) { }
          start = Math.max(0, Math.min(start, buffer.duration));
          end = Math.max(start + 0.01, Math.min(end, buffer.duration));
          if (playSound) playSound(buffer, start, end);
        } catch (err) { console.warn('playSound error', err); }
      });

      enableDragDropOnButton(newBtn, slotIndex);
      enableFilePickerOnButton(newBtn, slotIndex);
      newBtn.classList.add('assigned-local');
      setTimeout(() => newBtn.classList.remove('assigned-local'), 400);
      if (showStatus) showStatus(`Assigned ${name} to slot ${slotIndex + 1}`);
    } catch (err) {
      console.error('assignBufferToSlot error', err);
      if (showError) showError('Impossible d’assigner le buffer');
    }
  }

  function enableDragDropOnButton(btn, slotIndex) {
    btn.addEventListener('dragenter', (e) => { e.preventDefault(); btn.classList.add('drag-over'); });
    btn.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; btn.classList.add('drag-over'); });
    btn.addEventListener('dragleave', () => btn.classList.remove('drag-over'));
    btn.addEventListener('drop', async (e) => {
      try {
        e.preventDefault(); btn.classList.remove('drag-over');
        let f = null;
        if (e.dataTransfer) {
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) f = e.dataTransfer.files[0];
          else if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
            const item = e.dataTransfer.items[0];
            if (item.kind === 'file' && typeof item.getAsFile === 'function') f = item.getAsFile();
          }
        }
        if (!f) {
          // nothing to do (could be dragged text or unsupported payload)
          if (console && console.debug) console.debug('drop: no file found', e.dataTransfer);
          return;
        }
        // pass the exact button node so assignFileToSlot replaces the correct element
        await assignFileToSlot(f, slotIndex, btn);
      } catch (err) {
        console.error('Drag & drop assignment error', err);
      }
    });
  }

  function enableFilePickerOnButton(btn, slotIndex) {
    let assign = btn.querySelector('.assign-icon');
    if (!assign) {
      assign = document.createElement('span');
      assign.className = 'assign-icon'; assign.title = 'Assign local file'; assign.textContent = '+';
      assign.tabIndex = 0; assign.style.cursor = 'pointer'; assign.style.userSelect = 'none'; btn.appendChild(assign);
    }
    assign.onclick = async (e) => {
      e.stopPropagation();
      try {
        const chooser = await showRecordingsChooser(slotIndex, assign, { listRecordings, getRecording, deleteRecording, assignFileToSlot, decodeFileToBuffer });
        if (chooser && typeof chooser.wireLocal === 'function') {
          chooser.wireLocal(() => {
            // open native file picker but ensure the resulting file is assigned to THIS button
            if (!filePicker) return;
            filePicker.onchange = async (ev) => {
              const f = ev.target.files && ev.target.files[0];
              if (f) await assignFileToSlot(f, slotIndex, btn);
              filePicker.value = '';
              filePicker.onchange = null;
            };
            filePicker.click();
          });
        }
      } catch (err) { console.error('Error showing recordings chooser', err); }
    };
    assign.addEventListener('mousedown', (e) => { e.stopPropagation(); });
    assign.addEventListener('mouseup', (e) => { e.stopPropagation(); });
    assign.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); assign.click(); } });
  }

  function displayNumberToSlotIndex(displayNumber) {
    const n = Number(displayNumber);
    if (!n || isNaN(n) || n < 1 || n > mapping.length) return null;
    return mapping[n - 1];
  }

  return {
    pickFileForSlot,
    assignFileToSlot,
    assignBufferToSlot,
    enableDragDropOnButton,
    enableFilePickerOnButton,
    displayNumberToSlotIndex,
    // expose accessors so other modules (presets) can keep the main `currentButtons` array in sync
    getCurrentButtons: () => (typeof getCurrentButtons === 'function' ? getCurrentButtons() : (currentButtons || [])),
    setCurrentButton: (idx, node) => { if (typeof setCurrentButton === 'function') return setCurrentButton(idx, node); if (currentButtons) currentButtons[idx] = node; }
  };
}
