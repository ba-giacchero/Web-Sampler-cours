function distance(x1, y1, x2, y2) {
    let y = x2 - x1;
    let x = y2 - y1;

    return Math.sqrt(x * x + y * y);
}

// Convert a position in pixels in the canvas to a time in seconds in the audio buffer
function pixelToSeconds(x, bufferDuration, canvasWidth) {
    // canvas.width -> bufferDuration
    // x -> result
    let result = x * bufferDuration / canvasWidth;
    return result;
}

export { distance, pixelToSeconds };