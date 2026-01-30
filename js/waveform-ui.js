import TrimbarsDrawer from './trimbarsdrawer.js';
import { pixelToSeconds } from './utils.js';
import { drawWaveform, drawMiniWaveform } from './waveforms.js';

// Module de waveform interactif
// Crée les canvas pour afficher la forme d'onde et gérer le trim des sons
// Gère les événements de souris pour déplacer les barres de trim

export function initWaveformUI(buttonsContainer) {
  // Crée le container principal pour la waveform
  const container = document.createElement('div');
  container.id = 'waveformContainer';
  container.style.margin = '12px auto';
  container.style.position = 'relative';
  container.style.maxWidth = '800px';
  container.style.width = '100%';
  container.style.boxSizing = 'border-box';

  // Canvas principal pour afficher la waveform du son
  const waveformCanvas = document.createElement('canvas');
  waveformCanvas.width = 800;
  waveformCanvas.height = 120;
  waveformCanvas.style.width = '100%';
  waveformCanvas.style.display = 'block';
  waveformCanvas.style.border = '1px solid #000000ff';
  waveformCanvas.style.zIndex = '1';
  container.appendChild(waveformCanvas);

  // Canvas overlay pour dessiner les barres de trim (au-dessus de la waveform)
  const overlayCanvas = document.createElement('canvas');
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

  // Insère le container avant la grille des boutons
  if (buttonsContainer && buttonsContainer.parentElement) {
    buttonsContainer.insertAdjacentElement('beforebegin', container);
  } else {
    // Fallback : ajoute au body si pas de container
    document.body.appendChild(container);
  }

  // Masque la waveform jusqu'à ce qu'un son soit affiché
  container.style.display = 'none';

  // Crée le gestionnaire des barres de trim gauche/droite
  const trimbarsDrawer = new TrimbarsDrawer(overlayCanvas, 100, 200);

  // Suivi de la position de la souris en coordonnées canvas
  const mousePos = { x: 0, y: 0 };
  overlayCanvas.onmousemove = (evt) => {
    try {
      // Calcule la position relative au canvas en tenant compte du scaling
      const rect = overlayCanvas.getBoundingClientRect();
      const scaleX = overlayCanvas.width / rect.width;
      const scaleY = overlayCanvas.height / rect.height;
      mousePos.x = (evt.clientX - rect.left) * scaleX;
      mousePos.y = (evt.clientY - rect.top) * scaleY;
      // Déplace les barres de trim en fonction de la souris
      if (trimbarsDrawer && typeof trimbarsDrawer.moveTrimBars === 'function') trimbarsDrawer.moveTrimBars(mousePos);
    } catch (err) {
      console.warn('waveform-ui overlay mousemove error', err);
    }
  };

  // Commence le déplacement des barres de trim au clic
  overlayCanvas.onmousedown = () => trimbarsDrawer.startDrag();

  // Arrête le déplacement et convertit les positions en secondes
  function stopDragAndSave(currentShownBuffer, currentShownUrl) {
    trimbarsDrawer.stopDrag();
    if (currentShownBuffer && currentShownUrl) {
      // Convertit les positions en pixels en positions en secondes
      const leftPx = trimbarsDrawer.leftTrimBar.x;
      const rightPx = trimbarsDrawer.rightTrimBar.x;
      const leftSec = pixelToSeconds(leftPx, currentShownBuffer.duration, waveformCanvas.width);
      const rightSec = pixelToSeconds(rightPx, currentShownBuffer.duration, waveformCanvas.width);
      return { start: leftSec, end: rightSec };
    }
    return null;
  }

  // Au relâchement de la souris, envoie l'événement custom avec les nouvelles positions
  overlayCanvas.onmouseup = () => {
    try {
      trimbarsDrawer.stopDrag();
      // Calcule et envoie les positions de trim si possible
      if (currentShownBuffer && currentShownUrl) {
        // Envoie un événement avec les positions en secondes
        const leftPx = trimbarsDrawer.leftTrimBar.x;
        const rightPx = trimbarsDrawer.rightTrimBar.x;
        const leftSec = pixelToSeconds(leftPx, currentShownBuffer.duration, waveformCanvas.width);
        const rightSec = pixelToSeconds(rightPx, currentShownBuffer.duration, waveformCanvas.width);
        const detail = { url: currentShownUrl, start: leftSec, end: rightSec };
        const ev = new CustomEvent('waveform-trim-changed', { detail });
        window.dispatchEvent(ev);
      }
    } catch (err) {
      console.warn('waveform-ui overlay mouseup error', err);
    }
  };

  // Boucle d'animation pour redessiner les barres de trim à chaque frame
  function animateOverlay() {
    try {
      if (trimbarsDrawer) {
        trimbarsDrawer.clear();
        trimbarsDrawer.draw();
      }
    } catch (err) {
      console.warn('waveform-ui animateOverlay error', err);
    }
    requestAnimationFrame(animateOverlay);
  }
  requestAnimationFrame(animateOverlay);

  // Mémorise le buffer et l'URL du son actuellement affiché
  let currentShownBuffer = null;
  let currentShownUrl = null;

  // Affiche la waveform pour un son et restaure ses positions de trim
  function showWaveformForSound(buffer, url, trimPositionsMap) {
    if (!waveformCanvas) return;
    // Affiche le container
    const containerEl = waveformCanvas.parentElement;
    if (containerEl) containerEl.style.display = '';
    currentShownBuffer = buffer;
    currentShownUrl = url;

    // Dessine la waveform et synchronise l'overlay pour les barres
    try { drawWaveform(buffer, waveformCanvas, overlayCanvas); } catch (err) { console.warn('drawWaveform error', err); }

    // Restaure les positions de trim (secondes -> pixels)
    // Récupère les positions stockées ou initialise du début à la fin
    const stored = (trimPositionsMap && trimPositionsMap.get(url)) || { start: 0, end: buffer.duration };
    // Convertit les secondes en pixels sur le canvas
    const leftPx = (stored.start / buffer.duration) * waveformCanvas.width;
    const rightPx = (stored.end / buffer.duration) * waveformCanvas.width;
    trimbarsDrawer.leftTrimBar.x = leftPx;
    trimbarsDrawer.rightTrimBar.x = rightPx;
    if (trimPositionsMap) trimPositionsMap.set(url, { start: stored.start, end: stored.end });
  }

  // Retourne les éléments et fonctions publiques du module
  return {
    waveformCanvas,        // Canvas principal pour la waveform
    overlayCanvas,         // Canvas overlay pour les barres de trim
    trimbarsDrawer,        // Gestionnaire des barres de trim
    showWaveformForSound,  // Fonction pour afficher une waveform
    drawMiniWaveform,      // Fonction pour dessiner une mini waveform
    stopDragAndSave: () => stopDragAndSave(currentShownBuffer, currentShownUrl),  // Arrête le trim et retourne les positions
    getCurrentShown: () => ({ buffer: currentShownBuffer, url: currentShownUrl })  // Retourne le son actuellement affiché
  };
}
