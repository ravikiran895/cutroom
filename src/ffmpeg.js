import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import ffmpegWorkerURL from "@ffmpeg/ffmpeg/worker?worker&url";

let ffmpeg = null;
let loadPromise = null;

export const MULTITHREAD =
  typeof window !== "undefined" &&
  window.crossOriginIsolated === true &&
  typeof SharedArrayBuffer !== "undefined";

// Resolve self-hosted assets against the app's base URL so the app works both
// at a root domain (Netlify/Vercel) and on a subpath (GitHub Pages).
const asset = (p) => new URL(import.meta.env.BASE_URL + p, window.location.href).href;
const ST = { core: asset("ffmpeg/ffmpeg-core.js"), wasm: asset("ffmpeg/ffmpeg-core.wasm") };
const MT = { core: asset("ffmpeg-mt/ffmpeg-core.js"), wasm: asset("ffmpeg-mt/ffmpeg-core.wasm"), worker: asset("ffmpeg-mt/ffmpeg-core.worker.js") };

export function loadFFmpeg(onLog) {
  if (loadPromise) return loadPromise;
  const run = (async () => {
    ffmpeg = new FFmpeg();
    if (onLog) ffmpeg.on("log", ({ message }) => onLog(message));
    const cfg = MULTITHREAD ? MT : ST;
    const opts = {
      classWorkerURL: ffmpegWorkerURL,
      coreURL: await toBlobURL(cfg.core, "text/javascript"),
      wasmURL: await toBlobURL(cfg.wasm, "application/wasm"),
    };
    if (MULTITHREAD) opts.workerURL = await toBlobURL(cfg.worker, "text/javascript");
    await ffmpeg.load(opts);
    return ffmpeg;
  })();
  const timeout = new Promise((_, rej) =>
    setTimeout(() => rej(new Error("Engine load timed out. Is /ffmpeg/ffmpeg-core.js being served?")), 60000));
  loadPromise = Promise.race([run, timeout]);
  loadPromise.catch(() => { loadPromise = null; });
  return loadPromise;
}

export function cancelExport() {
  if (ffmpeg) { try { ffmpeg.terminate(); } catch {} }
  ffmpeg = null; loadPromise = null;
}

const QUALITY = { fast: "5M", high: "8M", best: "12M" };
const r = (n) => Number(n).toFixed(3);
// FFmpeg's atempo only accepts 0.5–2.0, so chain filters to reach any factor.
function atempoChain(s) {
  let f = s; const parts = [];
  while (f > 2) { parts.push("atempo=2.0"); f /= 2; }
  while (f < 0.5) { parts.push("atempo=0.5"); f *= 2; }
  parts.push("atempo=" + r(f));
  return parts.join(",");
}

// Transcode any imported video to a small, guaranteed-browser-playable H.264
// proxy for preview. The original file is kept for the final export.
export async function makePreview(file, onProgress) {
  const ff = await loadFFmpeg();
  const onP = onProgress ? ({ progress }) => onProgress(Math.min(99, Math.max(0, Math.round(progress * 100)))) : null;
  if (onP) ff.on("progress", onP);
  try {
    await ff.writeFile("prev_in.dat", await fetchFile(file));
    await ff.exec([
      "-i", "prev_in.dat",
      "-vf", "scale=-2:480",
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30",
      "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
      "prev_out.mp4",
    ]);
    const data = await ff.readFile("prev_out.mp4");
    try { await ff.deleteFile("prev_in.dat"); await ff.deleteFile("prev_out.mp4"); } catch {}
    return new Blob([data.buffer], { type: "video/mp4" });
  } finally { if (onP) { try { ff.off?.("progress", onP); } catch {} } }
}

/**
 * @param clips   [{ srcId, in, out }] video, timeline order
 * @param audio   [{ srcId, start, in, out, vol }] positioned audio clips
 * @param sources { [srcId]: { file } }
 */
export async function exportMp4({ clips, audio = [], sources, useOriginal, width, height, quality, textOverlays = [], onProgress }) {
  if (!clips || clips.length === 0) throw new Error("Timeline is empty — add at least one clip.");
  const ff = await loadFFmpeg();
  if (onProgress) ff.on("progress", ({ progress }) =>
    onProgress(Math.min(99, Math.max(0, Math.round(progress * 100)))));

  // write unique sources once
  const usedSrc = [...new Set([...clips.map((c) => c.srcId), ...audio.map((a) => a.srcId)])];
  const inputIndex = {};
  const inputs = [];
  let idx = 0;
  for (const srcId of usedSrc) {
    const name = `src${idx}.dat`;
    await ff.writeFile(name, await fetchFile(sources[srcId].file));
    inputs.push("-i", name);
    inputIndex[srcId] = idx++;
  }
  // text overlay images (full-frame transparent PNGs rendered in the browser)
  const textIdx = [];
  for (let i = 0; i < textOverlays.length; i++) {
    const name = `txt${i}.png`;
    await ff.writeFile(name, await fetchFile(textOverlays[i].file));
    inputs.push("-i", name);
    textIdx.push(idx++);
  }

  const total = clips.reduce((s, c) => s + (c.out - c.in) / (c.speed || 1), 0);
  const fc = [];
  const vLabels = [];
  const origLabels = [];

  clips.forEach((c, i) => {
    const si = inputIndex[c.srcId];
    const sp = c.speed || 1;
    let chain =
      `[${si}:v]trim=${r(c.in)}:${r(c.out)},setpts=(PTS-STARTPTS)/${r(sp)},` +
      `scale=${width}:${height}:force_original_aspect_ratio=increase,` +
      `crop=${width}:${height},setsar=1`;
    // optional transform: zoom/pan + rotation (only when non-default, so the
    // existing export path is byte-for-byte unchanged unless used)
    const z = c.scale || 1, px = c.posX || 0, py = c.posY || 0, rot = c.rot || 0;
    if (z !== 1 || px || py) {
      const sw = Math.max(width, Math.round(width * z));
      const sh = Math.max(height, Math.round(height * z));
      let cx = Math.round((sw - width) / 2 - px * width);
      let cy = Math.round((sh - height) / 2 - py * height);
      cx = Math.max(0, Math.min(cx, sw - width));
      cy = Math.max(0, Math.min(cy, sh - height));
      chain += `,scale=${sw}:${sh},crop=${width}:${height}:${cx}:${cy}`;
    }
    if (rot) chain += `,rotate=${r((rot * Math.PI) / 180)}:ow=${width}:oh=${height}:fillcolor=black`;
    chain += `,fps=30[v${i}]`;
    fc.push(chain);
    vLabels.push(`[v${i}]`);
    if (useOriginal) {
      fc.push(`[${si}:a]atrim=${r(c.in)}:${r(c.out)},asetpts=PTS-STARTPTS,${atempoChain(sp)}[oa${i}]`);
      origLabels.push(`[oa${i}]`);
    }
  });
  fc.push(`${vLabels.join("")}concat=n=${clips.length}:v=1:a=0[vout]`);

  // overlay text images on top of the concatenated video, timed with enable=
  let vfinal = "[vout]";
  textOverlays.forEach((t, i) => {
    const a = r(t.start || 0), b = r((t.start || 0) + (t.dur || 0));
    const out = `[vtx${i}]`;
    fc.push(`${vfinal}[${textIdx[i]}:v]overlay=0:0:enable='between(t,${a},${b})'${out}`);
    vfinal = out;
  });

  const mixLabels = [];
  if (useOriginal && origLabels.length === clips.length) {
    fc.push(`${origLabels.join("")}concat=n=${clips.length}:v=0:a=1[acat]`);
    mixLabels.push("[acat]");
  }
  audio.forEach((a, i) => {
    const si = inputIndex[a.srcId];
    const ms = Math.max(0, Math.round((a.start || 0) * 1000));
    const dur = Math.max(0.05, a.out - a.in);
    let af = `[${si}:a]atrim=${r(a.in)}:${r(a.out)},asetpts=PTS-STARTPTS,volume=${a.vol ?? 1}`;
    if (a.fadeIn > 0) af += `,afade=t=in:st=0:d=${r(Math.min(a.fadeIn, dur))}`;
    if (a.fadeOut > 0) af += `,afade=t=out:st=${r(Math.max(0, dur - a.fadeOut))}:d=${r(Math.min(a.fadeOut, dur))}`;
    af += `,adelay=${ms}:all=1[ac${i}]`;
    fc.push(af);
    mixLabels.push(`[ac${i}]`);
  });

  const args = [...inputs];
  const hasAudio = mixLabels.length > 0;
  if (mixLabels.length === 1) {
    fc.push(`${mixLabels[0]}apad,atrim=0:${r(total)}[aout]`);
  } else if (mixLabels.length > 1) {
    fc.push(`${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=longest:dropout_transition=0:normalize=0,atrim=0:${r(total)}[aout]`);
  }

  args.push("-filter_complex", fc.join(";"), "-map", vfinal);
  if (hasAudio) args.push("-map", "[aout]", "-c:a", "aac", "-b:a", "192k");
  else args.push("-an");

  const br = QUALITY[quality] || QUALITY.high;
  args.push("-c:v", "libx264", "-preset", "veryfast", "-b:v", br, "-maxrate", br,
    "-bufsize", br.replace("M", "") * 2 + "M", "-pix_fmt", "yuv420p", "-r", "30",
    "-movflags", "+faststart", "out.mp4");

  await ff.exec(args);
  const data = await ff.readFile("out.mp4");
  return new Blob([data.buffer], { type: "video/mp4" });
}
