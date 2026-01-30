// recorder.js
// Module d'enregistrement audio : gère getUserMedia, MediaRecorder et décodage du son enregistré

// Factory pour créer un système d'enregistrement avec injection de dépendances
export function initRecorder(deps = {}) {
  // Dépendances injectées pour affichage, décodage et gestion d'erreurs
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

  // État interne : flux audio, enregistreur, et chunk audio collectés
  let mediaStream = null;
  let mediaRecorder = null;
  let recordedChunks = [];

  // Vérifie si un enregistrement est en cours
  function isRecording() {
    return !!(mediaRecorder && mediaRecorder.state === 'recording');
  }

  // Démarre l'enregistrement : demande accès au micro et crée un MediaRecorder
  async function startRecordingForSlot(slotIndex) {
    try {
      // Obtient le flux audio du micro (réutilisé si déjà demandé)
      if (!mediaStream) {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
    } catch (err) {
      // Affiche une erreur si l'utilisateur refuse l'accès ou le micro est indisponible
      if (showError) showError('Accès au micro refusé ou indisponible.');
      return;
    }

    recordedChunks = [];
    try {
      // Crée l'enregistreur audio et collecte les données en chunks
      mediaRecorder = new MediaRecorder(mediaStream);
    } catch (err) {
      if (showError) showError('MediaRecorder non supporté par ce navigateur.');
      return;
    }

    // Collecte chaque chunk d'audio enregistré
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };

    // Quand l'enregistrement s'arrête, combine les chunks en blob et décode l'audio
    mediaRecorder.onstop = async () => {
      // Crée un blob WebM à partir des chunks et prépare un nom de fichier
      const blob = new Blob(recordedChunks, { type: recordedChunks[0] ? recordedChunks[0].type : 'audio/webm' });
      const defaultName = `mic-recording-${Date.now()}.webm`;
      if (recordStatus) recordStatus.textContent = 'Décodage…';

      // Crée un objet File pour réutilisation
      const file = new File([blob], defaultName, { type: blob.type });

      // Décode et affiche les prévisualisations de l'audio enregistré
      try {
        if (!decodeFileToBuffer) throw new Error('decodeFileToBuffer missing');
        const previewBuffer = await decodeFileToBuffer(file);
        try {
          // Affiche une miniature du son sur le canvas de prévisualisation
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

        // Affiche la barre d'actions pour utiliser ou supprimer l'enregistrement
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

  // Arrête l'enregistrement en cours
  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
    if (recordBtn) recordBtn.textContent = 'Enregistrer avec le micro';
  }

  // Exporte l'API publique du module d'enregistrement
  return {
    startRecording: startRecordingForSlot,
    stopRecording,
    isRecording
  };
}
