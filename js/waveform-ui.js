import TrimbarsDrawer from './trimbarsdrawer.js';
import { pixelToSeconds } from './utils.js';
import { drawWaveform, drawMiniWaveform } from './waveforms.js';

// Lightweight waveform UI module
// Exports an init function which mounts the waveform container before the provided buttonsContainer
// and returns the canvas elements and a `showWaveformForSound(buffer, url)` helper.

export function initWaveformUI(buttonsContainer) {
  // create container
  const container = document.createElement('div');
  container.id = 'waveformContainer';
  container.style.margin = '12px auto';
  container.style.position = 'relative';
  container.style.maxWidth = '800px';
  container.style.width = '100%';
  container.style.boxSizing = 'border-box';

  const waveformCanvas = document.createElement('canvas');
  waveformCanvas.width = 800;
  waveformCanvas.height = 120;
  waveformCanvas.style.width = '100%';
  waveformCanvas.style.display = 'block';
  waveformCanvas.style.border = '1px solid #000000ff';
  waveformCanvas.style.zIndex = '1';
  container.appendChild(waveformCanvas);

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

  // insert container above the buttons grid
  if (buttonsContainer && buttonsContainer.parentElement) {
    buttonsContainer.insertAdjacentElement('beforebegin', container);
  } else {
    // fallback: append to body
    document.body.appendChild(container);
  }

  // hide the waveform UI until a sound is shown
  container.style.display = 'none';

  const trimbarsDrawer = new TrimbarsDrawer(overlayCanvas, 100, 200);

  const mousePos = { x: 0, y: 0 };
  overlayCanvas.onmousemove = (evt) => {
    try {
      const rect = overlayCanvas.getBoundingClientRect();
      const scaleX = overlayCanvas.width / rect.width;
      const scaleY = overlayCanvas.height / rect.height;
      mousePos.x = (evt.clientX - rect.left) * scaleX;
      mousePos.y = (evt.clientY - rect.top) * scaleY;
      if (trimbarsDrawer && typeof trimbarsDrawer.moveTrimBars === 'function') trimbarsDrawer.moveTrimBars(mousePos);
    } catch (err) {
      console.warn('waveform-ui overlay mousemove error', err);
    }
  };

  overlayCanvas.onmousedown = () => trimbarsDrawer.startDrag();

  function stopDragAndSave(currentShownBuffer, currentShownUrl) {
    trimbarsDrawer.stopDrag();
    if (currentShownBuffer && currentShownUrl) {
      const leftPx = trimbarsDrawer.leftTrimBar.x;
      const rightPx = trimbarsDrawer.rightTrimBar.x;
      const leftSec = pixelToSeconds(leftPx, currentShownBuffer.duration, waveformCanvas.width);
      const rightSec = pixelToSeconds(rightPx, currentShownBuffer.duration, waveformCanvas.width);
      return { start: leftSec, end: rightSec };
    }
    return null;
  }

  overlayCanvas.onmouseup = () => {
    try {
      trimbarsDrawer.stopDrag();
      // compute and dispatch trimmed positions if possible
      if (currentShownBuffer && currentShownUrl) {
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

  // state for the currently shown buffer/url
  let currentShownBuffer = null;
  let currentShownUrl = null;

  function showWaveformForSound(buffer, url, trimPositionsMap) {
    if (!waveformCanvas) return;
    const containerEl = waveformCanvas.parentElement;
    if (containerEl) containerEl.style.display = '';
    currentShownBuffer = buffer;
    currentShownUrl = url;

    // draw waveform and ensure overlay canvas is synced for trimbars
    try { drawWaveform(buffer, waveformCanvas, overlayCanvas); } catch (err) { console.warn('drawWaveform error', err); }

    // restore trims (seconds -> pixels)
    const stored = (trimPositionsMap && trimPositionsMap.get(url)) || { start: 0, end: buffer.duration };
    const leftPx = (stored.start / buffer.duration) * waveformCanvas.width;
    const rightPx = (stored.end / buffer.duration) * waveformCanvas.width;
    trimbarsDrawer.leftTrimBar.x = leftPx;
    trimbarsDrawer.rightTrimBar.x = rightPx;
    if (trimPositionsMap) trimPositionsMap.set(url, { start: stored.start, end: stored.end });
  }

  return {
    waveformCanvas,
    overlayCanvas,
    trimbarsDrawer,
    showWaveformForSound,
    drawMiniWaveform,
    stopDragAndSave: () => stopDragAndSave(currentShownBuffer, currentShownUrl),
    getCurrentShown: () => ({ buffer: currentShownBuffer, url: currentShownUrl })
  };
}
