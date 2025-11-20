export function drawWaveformBase(buffer, canvas, opts = {}) {
  if (!canvas || !buffer) return;
  const dpr = window.devicePixelRatio || 1;
  const height = typeof opts.height === 'number' ? opts.height : 120;
  const cw = canvas.width = Math.floor(canvas.clientWidth * dpr);
  const ch = canvas.height = Math.floor(height * dpr);
  if (opts.syncOverlay && opts.overlayCanvas) {
    opts.overlayCanvas.width = cw;
    opts.overlayCanvas.height = ch;
  }
  const ctx2 = canvas.getContext('2d');
  ctx2.clearRect(0, 0, cw, ch);
  const channelData = buffer.numberOfChannels > 0 ? buffer.getChannelData(0) : new Float32Array(0);
  const step = Math.max(1, Math.floor(channelData.length / cw));
  if (opts.background) { ctx2.fillStyle = opts.background; ctx2.fillRect(0, 0, cw, ch); }
  ctx2.lineWidth = (opts.scaleLineWidthByDpr ? (opts.lineWidth || 1) * dpr : (opts.lineWidth || 1));
  ctx2.strokeStyle = opts.strokeStyle || '#007acc';
  ctx2.beginPath();
  for (let i = 0; i < cw; i++) {
    const start = i * step;
    let min = 1.0, max = -1.0;
    for (let j = 0; j < step && (start + j) < channelData.length; j++) {
      const v = channelData[start + j];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const y1 = ((1 + max) / 2) * ch;
    const y2 = ((1 + min) / 2) * ch;
    const x = i + (opts.xOffsetScaleByDpr ? 0.5 * dpr : 0.5);
    ctx2.moveTo(x, y1);
    ctx2.lineTo(x, y2);
  }
  ctx2.stroke();
}

export function drawWaveform(buffer, canvas, overlayCanvas) {
  drawWaveformBase(buffer, canvas, { height: 120, background: '#fafafa', strokeStyle: '#007acc', lineWidth: 1, syncOverlay: !!overlayCanvas, overlayCanvas, xOffsetScaleByDpr: false, scaleLineWidthByDpr: false });
}

export function drawMiniWaveform(buffer, canvas) {
  drawWaveformBase(buffer, canvas, { height: 80, background: '#ffffff', strokeStyle: '#0b2a3a', lineWidth: 1, syncOverlay: false, xOffsetScaleByDpr: true, scaleLineWidthByDpr: true });
}
