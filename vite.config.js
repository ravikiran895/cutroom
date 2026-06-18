import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" makes all asset URLs relative, so the same build works at a root
// domain (Netlify/Vercel: https://cutroom.app) AND on a subpath
// (GitHub Pages: https://you.github.io/cutroom/). FFmpeg/ORT paths resolve via
// import.meta.env.BASE_URL in ffmpeg.js / tts.js.
//
// No COOP/COEP headers — the app uses the single-thread FFmpeg core, which runs
// on any static host. (Multi-thread needs cross-origin isolation, which broke
// the canvas preview, so it stays off.)
export default defineConfig({
  base: "./",
  plugins: [react()],
  worker: { format: "es" },
});
