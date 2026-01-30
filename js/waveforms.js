// Fonction générique de rendu de waveform sur canvas
// Parcourt le buffer audio et dessine une ligne pour chaque pixel en largeur
// Représente le min/max des échantillons dans chaque segment
// opts : options de style (height, background, strokeStyle, lineWidth, etc.)
export function drawWaveformBase(buffer, canvas, opts = {}) {
  if (!canvas || !buffer) return;
  
  // Calcule les dimensions en tenant compte du device pixel ratio (DPR)
  const dpr = window.devicePixelRatio || 1;
  const height = typeof opts.height === 'number' ? opts.height : 120;
  const cw = canvas.width = Math.floor(canvas.clientWidth * dpr);
  const ch = canvas.height = Math.floor(height * dpr);
  
  // Synchronise la taille du canvas overlay si demandé (pour les barres de trim)
  if (opts.syncOverlay && opts.overlayCanvas) {
    opts.overlayCanvas.width = cw;
    opts.overlayCanvas.height = ch;
  }
  
  // Prépare le contexte 2D pour le rendu
  const ctx2 = canvas.getContext('2d');
  ctx2.clearRect(0, 0, cw, ch);
  
  // Récupère les données audio (mono : premier canal)
  const channelData = buffer.numberOfChannels > 0 ? buffer.getChannelData(0) : new Float32Array(0);
  
  // Calcule le nombre d'échantillons à regrouper par pixel en largeur
  // (pour éviter d'afficher chaque échantillon si le buffer est énorme)
  const step = Math.max(1, Math.floor(channelData.length / cw));
  
  // Applique la couleur de fond si fournie
  if (opts.background) { ctx2.fillStyle = opts.background; ctx2.fillRect(0, 0, cw, ch); }
  
  // Configure le style de la ligne (épaisseur et couleur)
  ctx2.lineWidth = (opts.scaleLineWidthByDpr ? (opts.lineWidth || 1) * dpr : (opts.lineWidth || 1));
  ctx2.strokeStyle = opts.strokeStyle || '#007acc';
  ctx2.beginPath();
  
  // Boucle pour chaque colonne de pixels (largeur du canvas)
  for (let i = 0; i < cw; i++) {
    const start = i * step;
    let min = 1.0, max = -1.0;
    
    // Trouve le min et max des échantillons dans ce segment
    for (let j = 0; j < step && (start + j) < channelData.length; j++) {
      const v = channelData[start + j];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    
    // Convertit les valeurs [-1, 1] en coordonnées pixel verticales
    const y1 = ((1 + max) / 2) * ch;
    const y2 = ((1 + min) / 2) * ch;
    const x = i + (opts.xOffsetScaleByDpr ? 0.5 * dpr : 0.5);
    
    // Dessine une ligne verticale du min au max pour ce pixel
    ctx2.moveTo(x, y1);
    ctx2.lineTo(x, y2);
  }
  ctx2.stroke();
}

// Rendu d'une waveform complète avec style par défaut
// Utilisé pour afficher les sons dans la UI principale
export function drawWaveform(buffer, canvas, overlayCanvas) {
  drawWaveformBase(buffer, canvas, { height: 120, background: '#fafafa', strokeStyle: '#007acc', lineWidth: 1, syncOverlay: !!overlayCanvas, overlayCanvas, xOffsetScaleByDpr: false, scaleLineWidthByDpr: false });
}

// Rendu d'une mini waveform avec style compact
// Utilisé pour l'aperçu des sons dans les listes (plus petit, haute densité)
export function drawMiniWaveform(buffer, canvas) {
  drawWaveformBase(buffer, canvas, { height: 80, background: '#ffffff', strokeStyle: '#0b2a3a', lineWidth: 1, syncOverlay: false, xOffsetScaleByDpr: true, scaleLineWidthByDpr: true });
}
