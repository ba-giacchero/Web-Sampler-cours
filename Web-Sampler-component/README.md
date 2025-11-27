Web Sampler Component

This folder contains a minimal Web Component version of the sampler from `Web-Sampler-cours-1`.

Files:
- `index.html` — demo page that instantiates `<web-sampler>`
- `web-sampler.js` — the component implementation (ES module)
- `styles.css` — minimal styling used by the component

Usage:
- Run a static server in `Web-Sampler-component` and open `index.html`.
  Example using `npx http-server`:

```powershell
cd "c:/Users/bagia/Desktop/notes cours/Web/VersionMax/Web-Sampler-component"
npx http-server -c-1
```

- Open the page in the browser. Click a slot to pick a file (or drag & drop an audio file onto a slot). Press the mapped keyboard keys to trigger sounds.

Notes & limitations:
- This is a compact, self-contained demo. It focuses on the core assignment + playback + keyboard mapping behavior.
- It does not implement all features from the original app (no waveform UI, trimming, presets fetching, DB storage, or recorder UI).
- It's intended as a starting point to incrementally re-add features inside the component.

If you want, I can:
- add drag/drop visual feedback and file-type checks,
- add a small visual waveform preview,
- wire the component to the presets module or the IndexedDB utilities from the original project.
