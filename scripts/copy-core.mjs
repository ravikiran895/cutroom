// Copies both FFmpeg cores into public/ so the app serves them itself.
// - single-thread  -> public/ffmpeg/      (works everywhere)
// - multi-thread   -> public/ffmpeg-mt/   (used when crossOriginIsolated)
import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function copy(pkg, files, destName) {
  const src = join(root, "node_modules", pkg, "dist/esm");
  const dest = join(root, "public", destName);
  mkdirSync(dest, { recursive: true });
  for (const f of files) {
    const from = join(src, f);
    if (!existsSync(from)) { console.error(`[copy-core] missing ${from} — run "npm install".`); process.exit(1); }
    copyFileSync(from, join(dest, f));
  }
}

copy("@ffmpeg/core", ["ffmpeg-core.js", "ffmpeg-core.wasm"], "ffmpeg");
copy("@ffmpeg/core-mt", ["ffmpeg-core.js", "ffmpeg-core.wasm", "ffmpeg-core.worker.js"], "ffmpeg-mt");

// onnxruntime-web wasm binaries for in-browser text-to-speech
import { readdirSync } from "node:fs";
try {
  const ortSrc = join(root, "node_modules/onnxruntime-web/dist");
  const ortDest = join(root, "public/ort");
  mkdirSync(ortDest, { recursive: true });
  for (const f of readdirSync(ortSrc)) {
    if (f.endsWith(".wasm") || f.endsWith(".mjs")) copyFileSync(join(ortSrc, f), join(ortDest, f));
  }
  console.log("[copy-core] onnxruntime wasm copied to public/ort/");
} catch (e) { console.warn("[copy-core] onnxruntime not copied (TTS optional):", e.message); }

console.log("[copy-core] FFmpeg cores copied (single-thread + multi-thread).");
