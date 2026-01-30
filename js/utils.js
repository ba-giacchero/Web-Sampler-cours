// Calcule la distance euclidienne entre deux points (x1,y1) et (x2,y2)
function distance(x1, y1, x2, y2) {
    let y = x2 - x1;
    let x = y2 - y1;

    return Math.sqrt(x * x + y * y);
}

// Convertit une position en pixels sur le canvas en temps en secondes dans le buffer audio
// Utilise une proportion simple : largeur canvas <-> durée du buffer
function pixelToSeconds(x, bufferDuration, canvasWidth) {
    // Proportion : canvasWidth pixels = bufferDuration secondes
    let result = x * bufferDuration / canvasWidth;
    return result;
}

export { distance, pixelToSeconds };