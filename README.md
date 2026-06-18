# CutRoom
Link: https://cutroom-phi.vercel.app/


A browser-based video editor. Import video/audio, arrange a multi-clip timeline,
cut / trim / retime clips, add music, recorded voiceover, and AI text-to-speech,
then export an MP4 at social / YouTube resolutions — all client-side. No upload,
no server: your media never leaves the browser.

Built with React + Vite + Tailwind, with FFmpeg (WebAssembly) for export and
Piper/VITS (WebAssembly) for text-to-speech.

## Features
- Media bin → preview → "Add to timeline" workflow (NLE-style)
- Multi-clip video timeline: drag to reorder, drag edges to trim, razor/split
- Per-clip playback **speed** (0.25×–4×), baked into preview and export
- Multiple positioned audio lanes (music / voiceover / TTS) with volume + trim
- In-browser **text-to-speech** (6 voices, no API key)
- Microphone **recording** for voiceover
- Output presets (Instagram / LinkedIn / Facebook / YouTube), quality levels
- Autosave of the edit (localStorage); MP4 / H.264 export

## Run locally
Requires Node 18+.

```bash
npm install
npm run dev      # http://localhost:5173
```

`predev` / `prebuild` run `scripts/copy-core.mjs`, which copies the FFmpeg and
onnxruntime WASM binaries from `node_modules` into `public/` so the app serves
them itself (these folders are git-ignored and regenerated on every build).

```bash
npm run build    # outputs to dist/
npm run preview  # serve the production build locally
```

## Deploy (host it as a link)
The build is fully static. `base: "./"` (in `vite.config.js`) makes it work both
at a root domain and on a subpath.

**Netlify / Vercel (recommended — root domain):**
Connect the GitHub repo. Build command `npm run build`, publish directory `dist`.
Config is already included (`netlify.toml`, `vercel.json`).

**GitHub Pages:**
A workflow is included at `.github/workflows/deploy.yml`. In your repo:
Settings → Pages → Build and deployment → Source = "GitHub Actions". Push to
`main` and it deploys to `https://<you>.github.io/<repo>/`.

## Notes / limits
- Export uses the single-thread FFmpeg core (works on any static host). Long or
  4K exports are slow and memory-heavy — a server-side render is the path for
  heavy jobs (see ROADMAP).
- TTS downloads a voice model (~20–60 MB) from Hugging Face on first use, then
  the browser caches it. Needs internet the first time per voice.

## Tech
React 18 · Vite 5 · Tailwind 3 · @ffmpeg/ffmpeg (wasm) · @diffusionstudio/vits-web · lucide-react
