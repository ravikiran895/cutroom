// In-browser text-to-speech (VITS / Piper). No API key.
// The voice model (~20–60MB) downloads from Hugging Face on first use of a
// voice, then is cached by the browser. ort + engine are loaded lazily so the
// app stays light until TTS is actually used.

export const VOICES = [
  { id: "en_US-hfc_female-medium", label: "Female · US (clear)" },
  { id: "en_US-amy-medium", label: "Amy · US" },
  { id: "en_US-ryan-high", label: "Ryan · US (deep)" },
  { id: "en_US-lessac-medium", label: "Lessac · US (neutral)" },
  { id: "en_GB-alan-medium", label: "Alan · UK" },
  { id: "en_GB-jenny_dioco-medium", label: "Jenny · UK" },
];

let mod = null;
async function engine() {
  if (!mod) {
    // Point onnxruntime at our self-hosted wasm (served from /public/ort).
    try {
      const ort = await import("onnxruntime-web");
      ort.env.wasm.wasmPaths = new URL((import.meta.env.BASE_URL || "/") + "ort/", window.location.href).href;
    } catch { /* ort path config is best-effort */ }
    mod = await import("@diffusionstudio/vits-web");
  }
  return mod;
}

// Returns a WAV Blob for the given text + voice. onProgress(0..1) during model download.
export async function synthesize(text, voiceId, onProgress) {
  const e = await engine();
  try {
    const stored = await e.stored();
    if (!stored.includes(voiceId)) {
      await e.download(voiceId, (p) => onProgress?.(typeof p === "number" ? p : p?.loaded / (p?.total || 1)));
    }
  } catch { /* download progress is best-effort */ }
  const wav = await e.predict({ text, voiceId });
  return wav; // Blob (audio/wav)
}
