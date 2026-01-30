// Charge un fichier audio et le décode en AudioBuffer
async function loadAndDecodeSound(url, ctx) {
   const response = await fetch(url);
   const sound = await response.arrayBuffer();

    console.log("Sound loaded as arrayBuffer    ");
    
    // Décode le buffer audio (opération asynchrone)
    const decodedSound = await ctx.decodeAudioData(sound);
    console.log("Sound decoded");

    return decodedSound;
  };

  // Construit le graphe audio pour jouer le son
  // Crée un BufferSourceNode connecté à la destination (haut-parleur)
  function buildAudioGraph(ctx, buffer) {
    let bufferSource = ctx.createBufferSource();
    bufferSource.buffer = buffer;
    bufferSource.connect(ctx.destination);
    return bufferSource;  
  }

  function playSound(ctx, buffer, startTime, endTime) {
    // Vérifie que les positions de trim sont valides
    if(startTime < 0) startTime = 0;
    if(endTime > buffer.duration) endTime = buffer.duration;

    // Les BufferSourceNode ne peuvent être utilisés qu'une seule fois
    // Donc on crée un nouveau nœud à chaque lecture (fire and forget)
    let bufferSource = buildAudioGraph(ctx, buffer);

    // Applique le pitch si fourni (4e paramètre)
    if (typeof arguments[4] !== 'undefined') {
      try { bufferSource.playbackRate.value = arguments[4]; } catch (err) { /* ignore if unsupported */ }
    }

    // Lance la lecture avec les positions de trim
    // start(quand, où_dans_le_son, durée_à_jouer)
    bufferSource.start(0, startTime, endTime);
}

  // Exporte les fonctions principales
  export { loadAndDecodeSound, playSound };

  // Charge et décode un son avec callback de progression (XMLHttpRequest)
  // onProgress: (loadedBytes, totalBytes) => void
  export function loadAndDecodeSoundWithProgress(url, ctx, onProgress) {
    return new Promise((resolve, reject) => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'arraybuffer';
        // Appelle le callback de progression pendant le chargement
        xhr.onprogress = (e) => {
          try {
            if (typeof onProgress === 'function' && e && typeof e.loaded === 'number') {
              onProgress(e.loaded, e.total || 0);
            }
          } catch (_) {}
        };
        // Décode le son une fois le chargement terminé
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              ctx.decodeAudioData(xhr.response).then((buffer) => {
                resolve(buffer);
              }).catch((err) => {
                reject(err);
              });
            } catch (err) { reject(err); }
          } else {
            reject(new Error(`HTTP ${xhr.status} while loading ${url}`));
          }
        };
        xhr.onerror = () => reject(new Error('XHR error while loading ' + url));
        xhr.send();
      } catch (err) { reject(err); }
    });
  }