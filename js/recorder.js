// recorder.js
// Extracted recorder logic: manages getUserMedia, MediaRecorder and decoding

export function initRecorder(deps = {}) {
  const {
    decodeFileToBuffer,
    lastRecordingCanvas,
    waveformCanvas,
    drawMiniWaveform,
    showRecordingActions,
    showStatus,
    showError,
    recordBtn,
    recordStatus
  } = deps;

  let mediaStream = null;
  let mediaRecorder = null;
  let recordedChunks = [];

  function isRecording() {
    return !!(mediaRecorder && mediaRecorder.state === 'recording');
  }

  async function startRecordingForSlot(slotIndex) {
    try {
      if (!mediaStream) {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
    } catch (err) {
      if (showError) showError('Accès au micro refusé ou indisponible.');
      return;
    }

    recordedChunks = [];
    try {
      mediaRecorder = new MediaRecorder(mediaStream);
    } catch (err) {
      if (showError) showError('MediaRecorder non supporté par ce navigateur.');
      return;
    }

    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };

    mediaRecorder.onstop = async () => {
      const blob = new Blob(recordedChunks, { type: recordedChunks[0] ? recordedChunks[0].type : 'audio/webm' });
      const defaultName = `mic-recording-${Date.now()}.webm`;
      if (recordStatus) recordStatus.textContent = 'Décodage…';

      // create a File-like object for reuse
      const file = new File([blob], defaultName, { type: blob.type });

      // Decode preview + full buffer and display previews
      try {
        if (!decodeFileToBuffer) throw new Error('decodeFileToBuffer missing');
        const previewBuffer = await decodeFileToBuffer(file);
        try {
          if (lastRecordingCanvas && previewBuffer) {
            if (typeof drawMiniWaveform === 'function') drawMiniWaveform(previewBuffer, lastRecordingCanvas);
            else if (typeof window.drawMiniWaveform === 'function') window.drawMiniWaveform(previewBuffer, lastRecordingCanvas);
          }
        } catch (err) { console.warn('Unable to draw preview on top canvas', err); }

        // full buffer (may be same as previewBuffer if decode is deterministic)
        const buffer = previewBuffer;
        // update top label if present
        const labelEl = typeof document !== 'undefined' ? document.getElementById('lastRecordingLabel') : null;
        if (labelEl) labelEl.textContent = 'Son chargé/enregistré';

        // show action toolbar attached to the top preview canvas
        const topParent = lastRecordingCanvas && lastRecordingCanvas.parentElement ? lastRecordingCanvas.parentElement : (waveformCanvas ? waveformCanvas.parentElement : null);
        if (showRecordingActions) showRecordingActions(topParent, { buffer, file, blob, name: defaultName });
        if (recordStatus) recordStatus.textContent = 'Enregistrement prêt';
      } catch (err) {
        console.error('Unable to decode recorded file', err);
        if (showError) showError('Impossible de décoder l’enregistrement.');
        if (recordStatus) recordStatus.textContent = '';
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

  return {
    startRecording: startRecordingForSlot,
    stopRecording,
    isRecording
  };
}
