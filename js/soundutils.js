async function loadAndDecodeSound(url, ctx) {
   const response = await fetch(url);
   const sound = await response.arrayBuffer();

    console.log("Sound loaded as arrayBuffer    ");
    
    // Let's decode it. This is also asynchronous
    const decodedSound = await ctx.decodeAudioData(sound);
    console.log("Sound decoded");

    return decodedSound;
  };

  // This function builds the audio graph for playing the sound
  // In this simple case, it is just a buffer source connected to the destination
  // (the audio card)
  // We return the created buffer source node
  function buildAudioGraph(ctx, buffer) {
    let bufferSource = ctx.createBufferSource();
    bufferSource.buffer = buffer;
    bufferSource.connect(ctx.destination);
    return bufferSource;  
  }

  function playSound(ctx, buffer, startTime, endTime) {
    // buffer is the decoded sound...

    // some checks as sometimes startTime or endTime can be out of range
    // when dragging the trim bars
    if(startTime < 0) startTime = 0;
    if(endTime > buffer.duration) endTime = buffer.duration;

    // The Web Audio API BufferSourceNode instances are one-shot: they can only
    // be started once, so we need to create a new one each time we want to play
    // the sound; We call this "fire and forget!"
    // It is the case also with OscillatorNode nodes
    let bufferSource = buildAudioGraph(ctx, buffer);

    // default playbackRate = 1 (normal pitch)
    if (typeof arguments[4] !== 'undefined') {
      try { bufferSource.playbackRate.value = arguments[4]; } catch (err) { /* ignore if unsupported */ }
    }

    // First parameter = when to start (0 = now), if > 0 then the sound will be delayed
    // Second parameter = where to start in the sound (in seconds)
    // Third parameter = where to stop in the sound (in seconds)
    // If we don't provide the third parameter, the sound will be played until its end
    // If the second parameter is >= the sound duration, nothing will be played
    // If the third parameter is > the sound duration, it will be limited to the sound duration
    // see https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode/start
    bufferSource.start(0, startTime, endTime);
}

  
  // export the function
  export { loadAndDecodeSound, playSound };

  // XMLHttpRequest-based loader with progress callback (like ExempleASupprimer)
  // onProgress: (loadedBytes, totalBytes) => void
  export function loadAndDecodeSoundWithProgress(url, ctx, onProgress) {
    return new Promise((resolve, reject) => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'arraybuffer';
        xhr.onprogress = (e) => {
          try {
            if (typeof onProgress === 'function' && e && typeof e.loaded === 'number') {
              onProgress(e.loaded, e.total || 0);
            }
          } catch (_) {}
        };
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