import React, { useState, useRef, useEffect } from "react";
import {
  Upload, Play, Pause, Scissors, Music, Mic, Download, Square, Volume2,
  Film, X, Loader2, Circle, Check, Undo2, Redo2, Copy, Trash2, Plus,
  RotateCcw, MessageSquareText, ClipboardPaste, CopyPlus, Video as VideoIcon,
  SlidersHorizontal, MoveHorizontal, Gauge, Type,
} from "lucide-react";
import { exportMp4, loadFFmpeg, cancelExport, MULTITHREAD } from "./ffmpeg.js";
import { useEditor, uid, loadSavedDoc } from "./useEditor.js";
import { VOICES, synthesize } from "./tts.js";

const PRESET_GROUPS = [
  { platform: "Instagram", items: [["1080×1920 (Reel)", 1080, 1920], ["1080×1080 (Square)", 1080, 1080], ["1080×1350 (Portrait)", 1080, 1350]] },
  { platform: "LinkedIn", items: [["1920×1080", 1920, 1080], ["1080×1080", 1080, 1080], ["1080×1350", 1080, 1350]] },
  { platform: "Facebook", items: [["1920×1080", 1920, 1080], ["1080×1080", 1080, 1080], ["1080×1350", 1080, 1350]] },
  { platform: "YouTube", items: [["1920×1080", 1920, 1080], ["1280×720", 1280, 720]] },
];
const QUALITY = { fast: "Fast · 5 Mbps", high: "High · 8 Mbps", best: "Best · 12 Mbps" };
const KIND = {
  music: { dot: "bg-sky-400", bar: "bg-sky-500/30 border-sky-400/50", handle: "bg-sky-300/70 hover:bg-sky-200" },
  voice: { dot: "bg-rose-400", bar: "bg-rose-500/30 border-rose-400/50", handle: "bg-rose-300/70 hover:bg-rose-200" },
  tts: { dot: "bg-emerald-400", bar: "bg-emerald-500/30 border-emerald-400/50", handle: "bg-emerald-300/70 hover:bg-emerald-200" },
};
const kindOf = (k) => KIND[k] || KIND.music;
const fmt = (s) => { if (!isFinite(s) || s < 0) return "0:00"; const m = Math.floor(s / 60), x = Math.floor(s % 60); return `${m}:${x.toString().padStart(2, "0")}`; };
function drawCover(ctx, media, mw, mh, W, H) {
  if (!mw || !mh) return;
  const scale = Math.max(W / mw, H / mh), dw = mw * scale, dh = mh * scale;
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
  ctx.drawImage(media, (W - dw) / 2, (H - dh) / 2, dw, dh);
}
function drawClipFrame(ctx, media, mw, mh, W, H, t = {}) {
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
  if (!mw || !mh) return;
  const z = t.scale || 1, rot = ((t.rot || 0) * Math.PI) / 180, px = (t.posX || 0) * W, py = (t.posY || 0) * H;
  const scale = Math.max(W / mw, H / mh), dw = mw * scale, dh = mh * scale;
  ctx.save();
  ctx.translate(W / 2 + px, H / 2 + py);
  if (rot) ctx.rotate(rot);
  if (z !== 1) ctx.scale(z, z);
  ctx.drawImage(media, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}
function drawTextOn(ctx, t, W, H) {
  const fs = Math.max(8, Math.round((t.size || 0.09) * H));
  const lines = String(t.content || "").split("\n");
  const lh = fs * 1.2;
  const x = W / 2;
  const cy = t.pos === "top" ? H * 0.16 : t.pos === "bottom" ? H * 0.84 : H * 0.5;
  ctx.save();
  ctx.font = `700 ${fs}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const totalH = lines.length * lh;
  if (t.bg) {
    let maxW = 0; for (const ln of lines) maxW = Math.max(maxW, ctx.measureText(ln).width);
    const padX = fs * 0.55, padY = fs * 0.35;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(x - maxW / 2 - padX, cy - totalH / 2 - padY, maxW + padX * 2, totalH + padY * 2);
  } else {
    ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = fs * 0.2; ctx.shadowOffsetY = fs * 0.04;
  }
  ctx.fillStyle = t.color || "#ffffff";
  lines.forEach((ln, i) => ctx.fillText(ln, x, cy + (i - (lines.length - 1) / 2) * lh));
  ctx.restore();
}

export default function App() {
  const { doc, dispatch, undo, redo, canUndo, canRedo } = useEditor();
  const [sources, setSources] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const [pps, setPps] = useState(50);
  const [clipboard, setClipboard] = useState(null);
  const [trimDrag, setTrimDrag] = useState(null);
  const [audioDrag, setAudioDrag] = useState(null);
  const [trimOpen, setTrimOpen] = useState(false);
  const [audioSelId, setAudioSelId] = useState(null);
  const [textSelId, setTextSelId] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);

  const [engineReady, setEngineReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);

  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportPct, setExportPct] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [resultURL, setResultURL] = useState(null);
  const [err, setErr] = useState(null);
  const [saved, setSaved] = useState(false);
  const [recoverDoc, setRecoverDoc] = useState(null);

  const [ttsOpen, setTtsOpen] = useState(false);
  const [ttsText, setTtsText] = useState("");
  const [ttsVoice, setTtsVoice] = useState(VOICES[0].id);
  const [ttsBusy, setTtsBusy] = useState(false);
  const [ttsMsg, setTtsMsg] = useState("");

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const curGlobalRef = useRef(0);
  const audioElsRef = useRef({});
  const playingAudioRef = useRef(new Set());
  const playingRef = useRef(false);
  const wantPlayRef = useRef(false);
  const seekOnLoadRef = useRef(null);
  const loopRef = useRef(() => {});
  const recorderRef = useRef(null);
  const recTimerRef = useRef(null);
  const exportTimerRef = useRef(null);
  const dragFrom = useRef(null);
  const handleDownRef = useRef(false);
  const timelineRef = useRef(null);

  const { output } = doc;
  const W = output.w, H = output.h;

  const ranges = []; let acc = 0;
  for (const c of doc.clips) { const d = (c.out - c.in) / (c.speed || 1); ranges.push({ id: c.id, start: acc, dur: d, clip: c }); acc += d; }
  const total = acc;
  const selectedClip = doc.clips.find((c) => c.id === selectedId) || null;
  const selectedAudio = doc.audio.find((a) => a.id === audioSelId) || null;
  const selectedText = (doc.texts || []).find((t) => t.id === textSelId) || null;
  const clipAt = (t) => ranges.find((rg) => t >= rg.start && t < rg.start + rg.dur) || ranges[ranges.length - 1] || null;

  const dispClips = doc.clips.map((c) => (trimDrag && trimDrag.id === c.id ? { ...c, in: trimDrag.in, out: trimDrag.out } : c));
  let _o = 0; const layout = dispClips.map((c) => { const dur = (c.out - c.in) / (c.speed || 1); const it = { id: c.id, left: _o * pps, width: dur * pps, dur, clip: c }; _o += dur; return it; });
  const dispTotal = _o || 0;
  const audioDisp = doc.audio.map((a) => (audioDrag && audioDrag.id === a.id ? { ...a, start: audioDrag.start, in: audioDrag.in, out: audioDrag.out } : a));
  const timelineEnd = Math.max(dispTotal, ...audioDisp.map((a) => a.start + (a.out - a.in)), 0.001);
  const contentW = Math.max(timelineEnd * pps + 24, 320);
  const tickStep = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => s * pps >= 64) || 300;
  const ticks = []; for (let t = 0; t <= timelineEnd + 0.001; t += tickStep) ticks.push(t);

  const activeRg = clipAt(current) || ranges[0] || null;
  const activeSrc = activeRg && sources[activeRg.clip.srcId] ? sources[activeRg.clip.srcId].url : undefined;

  // ---- preview engine ----
  const drawFrame = () => {
    const v = videoRef.current, c = canvasRef.current; if (!v || !c) return;
    if (!v.videoWidth || !v.videoHeight) return;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const ctx = c.getContext("2d");
    drawClipFrame(ctx, v, v.videoWidth, v.videoHeight, W, H, activeRg ? activeRg.clip : {});
    const g = curGlobalRef.current;
    for (const t of doc.texts || []) if (g >= t.start && g < t.start + t.dur) drawTextOn(ctx, t, W, H);
  };
  const syncAudio = (g) => {
    const map = audioElsRef.current, set = playingAudioRef.current;
    for (const a of doc.audio) {
      const el = map[a.id]; if (!el) continue;
      const dur = a.out - a.in, pos = g - a.start;
      const active = g >= a.start && g < a.start + dur;
      if (active) {
        let f = 1;
        if (a.fadeIn > 0) f = Math.min(f, pos / a.fadeIn);
        if (a.fadeOut > 0) f = Math.min(f, (dur - pos) / a.fadeOut);
        el.volume = Math.min(1, Math.max(0, (a.vol ?? 1) * Math.max(0, f)));
        if (!set.has(a.id)) { try { el.currentTime = a.in + pos; } catch {} el.play().catch(() => {}); set.add(a.id); }
      } else if (set.has(a.id)) { el.pause(); set.delete(a.id); }
    }
  };
  const pauseAllAudio = () => { Object.values(audioElsRef.current).forEach((el) => el.pause()); playingAudioRef.current.clear(); };
  const stopPlay = () => { cancelAnimationFrame(rafRef.current); playingRef.current = false; wantPlayRef.current = false; if (videoRef.current) videoRef.current.pause(); pauseAllAudio(); setPlaying(false); };

  loopRef.current = () => {
    const v = videoRef.current; if (!v) return;
    const g = curGlobalRef.current; const rg = clipAt(g);
    if (!rg) { stopPlay(); return; }
    const sp = rg.clip.speed || 1;
    if (v.playbackRate !== sp) { try { v.playbackRate = sp; } catch {} }
    if (v.currentTime >= rg.clip.out - 0.05) {
      const nextStart = rg.start + rg.dur;
      if (nextStart >= total - 0.05) { stopPlay(); curGlobalRef.current = 0; setCurrent(0); return; }
      const nextRg = clipAt(nextStart);
      curGlobalRef.current = nextStart; setCurrent(nextStart);
      const sameSrc = nextRg && sources[nextRg.clip.srcId]?.url === sources[rg.clip.srcId]?.url;
      if (sameSrc) { try { v.currentTime = nextRg.clip.in; v.playbackRate = nextRg.clip.speed || 1; } catch {} rafRef.current = requestAnimationFrame(() => loopRef.current()); }
      else { seekOnLoadRef.current = nextRg ? nextRg.clip.in : 0; wantPlayRef.current = true; }
      return;
    }
    const ng = rg.start + (v.currentTime - rg.clip.in) / sp;
    curGlobalRef.current = ng; setCurrent(ng); drawFrame(); syncAudio(ng);
    rafRef.current = requestAnimationFrame(() => loopRef.current());
  };
  const onVideoLoaded = () => {
    const v = videoRef.current; if (!v) return;
    if (seekOnLoadRef.current != null) { try { v.currentTime = seekOnLoadRef.current; } catch {} seekOnLoadRef.current = null; }
    const cur = clipAt(curGlobalRef.current); if (cur) { try { v.playbackRate = cur.clip.speed || 1; } catch {} }
    requestAnimationFrame(drawFrame);
    if (wantPlayRef.current) { const p = v.play(); if (p && p.catch) p.catch(() => {}); cancelAnimationFrame(rafRef.current); rafRef.current = requestAnimationFrame(() => loopRef.current()); }
  };
  const play = () => {
    const v = videoRef.current; if (!v || !ranges.length) return;
    let g = curGlobalRef.current; if (g >= total - 0.05) g = 0;
    curGlobalRef.current = g; setCurrent(g);
    const rg = clipAt(g) || ranges[0]; const sp = rg.clip.speed || 1; const local = rg.clip.in + (g - rg.start) * sp;
    seekOnLoadRef.current = null; wantPlayRef.current = true; playingRef.current = true; setPlaying(true);
    try { v.playbackRate = sp; if (Math.abs((v.currentTime || 0) - local) > 0.3) v.currentTime = local; } catch {}
    const p = v.play(); if (p && p.catch) p.catch(() => {});
    cancelAnimationFrame(rafRef.current); rafRef.current = requestAnimationFrame(() => loopRef.current());
  };
  const togglePlay = () => { if (playingRef.current) stopPlay(); else play(); };
  const seekGlobal = (t) => {
    const c = Math.max(0, Math.min(t, Math.max(total, 0.001)));
    curGlobalRef.current = c; setCurrent(c);
    const rg = clipAt(c) || ranges[0]; if (!rg) return;
    const sp = rg.clip.speed || 1; const local = rg.clip.in + (c - rg.start) * sp;
    const v = videoRef.current; if (v) { try { v.currentTime = local; } catch {} }
    seekOnLoadRef.current = local;
    if (!playingRef.current) pauseAllAudio();
  };
  const seekByClientX = (x) => { const el = timelineRef.current; if (!el) return; const r = el.getBoundingClientRect(); seekGlobal((x - r.left + el.scrollLeft) / pps); };

  // draw the first frame as soon as the active clip is ready (immediate preview)
  useEffect(() => { const v = videoRef.current; if (v && v.readyState >= 2 && !playingRef.current) requestAnimationFrame(drawFrame); /* eslint-disable-next-line */ }, [activeSrc, W, H, current, doc.clips, doc.texts]);

  // ---- engine + recovery ----
  const bootEngine = () => { setErr(null); loadFFmpeg().then(() => setEngineReady(true)).catch((e) => setErr("Engine failed to load: " + (e?.message || e))); };
  useEffect(() => { bootEngine(); const s = loadSavedDoc(); if (s && s.clips.length) setRecoverDoc(s); /* eslint-disable-next-line */ }, []);
  useEffect(() => () => { cancelAnimationFrame(rafRef.current); pauseAllAudio(); }, []);

  // ---- media bin (import) ----
  const probe = (file, kind) => new Promise((res) => {
    const url = URL.createObjectURL(file);
    if (kind === "video") { const v = document.createElement("video"); v.onloadedmetadata = () => res({ url, duration: v.duration, w: v.videoWidth, h: v.videoHeight }); v.onerror = () => res({ url, duration: 0, w: 0, h: 0 }); v.src = url; }
    else { const a = document.createElement("audio"); a.onloadedmetadata = () => res({ url, duration: isFinite(a.duration) ? a.duration : 1 }); a.onerror = () => res({ url, duration: 1 }); a.src = url; }
  });
  const addVideoToBin = async (file) => { if (!file) return; setErr(null); const m = await probe(file, "video"); const srcId = uid(); setSources((s) => ({ ...s, [srcId]: { file, type: "video", kind: "video", name: file.name, ...m } })); return srcId; };
  const addAudioToBin = async (file, kind, label) => { if (!file) return; const m = await probe(file, "audio"); const srcId = uid(); setSources((s) => ({ ...s, [srcId]: { file, type: "audio", kind, name: label || file.name, ...m } })); return srcId; };
  const importFiles = async (files) => { for (const f of files) { if (f.type.startsWith("video/")) await addVideoToBin(f); else if (f.type.startsWith("audio/")) await addAudioToBin(f, "music"); } };

  const addVideoClip = (srcId) => { const src = sources[srcId]; if (!src) return; const clip = { id: uid(), srcId, in: 0, out: src.duration || 1 }; dispatch({ type: "ADD_CLIPS", clips: [clip] }); setSelectedId(clip.id); setResultURL(null); };
  const addAudioClip = (srcId) => { const src = sources[srcId]; if (!src) return; const start = Math.max(0, Math.min(current, Math.max(0, total - 0.1))); const clip = { id: uid(), srcId, start: total ? start : 0, in: 0, out: src.duration || 1, vol: src.kind === "music" ? 0.6 : 1, kind: src.kind, label: src.name }; dispatch({ type: "ADD_AUDIO", clip }); setAudioSelId(clip.id); setSelectedId(null); setTrimOpen(true); };
  const removeFromBin = (srcId) => { dispatch({ type: "REMOVE_SRC", srcId }); setSources((s) => { const n = { ...s }; try { URL.revokeObjectURL(n[srcId]?.url); } catch {} delete n[srcId]; return n; }); };

  const addText = () => {
    const start = Math.max(0, Math.min(current, Math.max(0, total - 0.1)));
    const t = { id: uid(), content: "Your title", start: total ? start : 0, dur: 3, pos: "center", size: 0.09, color: "#ffffff", bg: false };
    dispatch({ type: "ADD_TEXT", text: t });
    setTextSelId(t.id); setSelectedId(null); setAudioSelId(null); setTrimOpen(true);
  };
  const renderTextBlob = (t) => new Promise((res) => {
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    drawTextOn(cv.getContext("2d"), t, W, H);
    cv.toBlob((b) => res(new File([b], "txt.png", { type: "image/png" })), "image/png");
  });

  // ---- audio elements ----
  useEffect(() => {
    const map = audioElsRef.current;
    for (const id of Object.keys(map)) if (!doc.audio.find((a) => a.id === id)) { map[id].pause(); delete map[id]; }
    for (const a of doc.audio) { const src = sources[a.srcId]; if (src && !map[a.id]) { const el = new Audio(src.url); el.preload = "auto"; map[a.id] = el; } }
  }, [doc.audio, sources]);

  // ---- editing ops ----
  const razor = () => { const rg = clipAt(current); if (!rg) return; const local = current - rg.start; if (local > 0.05 && local < rg.dur - 0.05) { dispatch({ type: "SPLIT_CLIP", id: rg.id, local }); setSelectedId(rg.id); } };
  const copyClip = () => { const c = doc.clips.find((x) => x.id === selectedId); if (c) setClipboard({ srcId: c.srcId, in: c.in, out: c.out }); };
  const pasteClip = () => { if (!clipboard) return; const rg = clipAt(current); const index = rg ? doc.clips.findIndex((c) => c.id === rg.id) + 1 : doc.clips.length; const clip = { id: uid(), ...clipboard }; dispatch({ type: "INSERT_CLIP", clip, index }); setSelectedId(clip.id); };
  const cutClip = () => { if (selectedId) { copyClip(); dispatch({ type: "DELETE_CLIP", id: selectedId }); setSelectedId(null); } };

  useEffect(() => {
    if (!trimDrag) return;
    const onMove = (e) => setTrimDrag((td) => { if (!td) return td; const clip = doc.clips.find((c) => c.id === td.id); if (!clip) return td; const src = sources[clip.srcId]; const maxOut = src?.duration ?? td.baseOut; const delta = (e.clientX - td.startX) / pps; if (td.edge === "in") return { ...td, in: Math.max(0, Math.min(td.baseIn + delta, td.baseOut - 0.1)), out: td.baseOut }; return { ...td, in: td.baseIn, out: Math.min(maxOut, Math.max(td.baseOut + delta, td.baseIn + 0.1)) }; });
    const onUp = () => { handleDownRef.current = false; setTrimDrag((td) => { if (td) dispatch({ type: "TRIM_CLIP", id: td.id, in: td.in, out: td.out }); return null; }); };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, [trimDrag, doc.clips, sources, pps, dispatch]);

  useEffect(() => {
    if (!audioDrag) return;
    const onMove = (e) => setAudioDrag((d) => { if (!d) return d; const a = doc.audio.find((x) => x.id === d.id); if (!a) return d; const src = sources[a.srcId]; const maxOut = src?.duration ?? d.baseOut; const delta = (e.clientX - d.startX) / pps; if (d.mode === "move") return { ...d, start: Math.max(0, d.baseStart + delta), in: d.baseIn, out: d.baseOut }; if (d.mode === "in") return { ...d, start: d.baseStart, in: Math.max(0, Math.min(d.baseIn + delta, d.baseOut - 0.1)), out: d.baseOut }; return { ...d, start: d.baseStart, in: d.baseIn, out: Math.min(maxOut, Math.max(d.baseOut + delta, d.baseIn + 0.1)) }; });
    const onUp = () => { handleDownRef.current = false; setAudioDrag((d) => { if (d) dispatch({ type: "UPDATE_AUDIO", id: d.id, patch: { start: d.start, in: d.in, out: d.out } }); return null; }); };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, [audioDrag, doc.audio, sources, pps, dispatch]);

  // ---- recording + tts ----
  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream); const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = async () => { stream.getTracks().forEach((t) => t.stop()); const file = new File(chunks, "voiceover.webm", { type: "audio/webm" }); await addAudioToBin(file, "voice", "Voiceover"); clearInterval(recTimerRef.current); setRecSecs(0); setRecording(false); };
      recorderRef.current = rec; rec.start(); setRecording(true); setRecSecs(0); recTimerRef.current = setInterval(() => setRecSecs((s) => s + 1), 1000);
    } catch { setErr("Microphone access denied."); }
  };
  const stopRec = () => recorderRef.current && recorderRef.current.stop();
  const generateTTS = async () => {
    if (!ttsText.trim()) return;
    setTtsBusy(true); setTtsMsg("Preparing voice (first use downloads the voice model)…");
    try { const blob = await synthesize(ttsText.trim(), ttsVoice, (p) => setTtsMsg("Downloading voice " + Math.round((p || 0) * 100) + "%…")); const file = new File([blob], "tts.wav", { type: "audio/wav" }); await addAudioToBin(file, "tts", "TTS: " + ttsText.slice(0, 18)); setTtsMsg("Added to media bin ✓"); setTtsText(""); }
    catch (e) { setTtsMsg("TTS failed: " + (e?.message || e) + " (needs internet for the first voice download)"); }
    finally { setTtsBusy(false); }
  };

  // ---- export ----
  const doExport = async () => {
    if (!doc.clips.length) { setErr("Add at least one clip to the timeline."); return; }
    setExporting(true); setExportPct(0); setElapsed(0); setResultURL(null); setErr(null);
    const t0 = Date.now(); exportTimerRef.current = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 500);
    try { const textOverlays = await Promise.all((doc.texts || []).map(async (t) => ({ start: t.start, dur: t.dur, file: await renderTextBlob(t) }))); const blob = await exportMp4({ clips: doc.clips, audio: doc.audio, sources, useOriginal: doc.useOriginal, width: W, height: H, quality: output.quality, textOverlays, onProgress: setExportPct }); setExportPct(100); setResultURL(URL.createObjectURL(blob)); }
    catch (e) { const m = (e?.message || String(e)); setErr(/terminate/i.test(m) ? "Export cancelled." : "Export failed: " + m + (doc.useOriginal ? "  (If a clip has no audio, turn off ‘Use original clip audio’.)" : "")); }
    finally { clearInterval(exportTimerRef.current); setExporting(false); }
  };
  const cancel = () => { cancelExport(); setEngineReady(false); setExporting(false); bootEngine(); };
  const download = () => { if (!resultURL) return; const a = document.createElement("a"); a.href = resultURL; a.download = `${doc.name.replace(/\s+/g, "-")}-${W}x${H}.mp4`; a.click(); };

  // ---- shortcuts ----
  useEffect(() => {
    const typing = (el) => el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
    const onKey = (e) => {
      if (typing(e.target)) return; const mod = e.metaKey || e.ctrlKey;
      if (e.code === "Space") { e.preventDefault(); togglePlay(); }
      else if (e.key === "Delete" || e.key === "Backspace") { if (selectedId) { dispatch({ type: "DELETE_CLIP", id: selectedId }); setSelectedId(null); } }
      else if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (mod && ((e.key.toLowerCase() === "z" && e.shiftKey) || e.key.toLowerCase() === "y")) { e.preventDefault(); redo(); }
      else if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); setSaved(true); setTimeout(() => setSaved(false), 1200); }
      else if (mod && e.key.toLowerCase() === "c") { copyClip(); }
      else if (mod && e.key.toLowerCase() === "x") { cutClip(); }
      else if (mod && e.key.toLowerCase() === "v") { e.preventDefault(); pasteClip(); }
      else if (!mod && (e.key.toLowerCase() === "b" || e.key.toLowerCase() === "s")) { razor(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, clipboard, doc.clips, current, total]);

  const Slider = ({ value, onChange, icon: Icon, label, min = 0, max = 1, step = 0.01 }) => (
    <div className="flex items-center gap-3">
      {Icon && <Icon size={15} className="text-zinc-400 shrink-0" />}
      <span className="text-xs text-zinc-400 w-24 shrink-0">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="flex-1 accent-violet-500 h-1" />
      <span className="text-xs text-zinc-500 w-10 text-right tabular-nums">{max === 1 ? Math.round(value * 100) : Number(value).toFixed(1)}</span>
    </div>
  );
  const Tool = ({ onClick, disabled, icon: Icon, label, kbd, danger }) => (
    <button onClick={onClick} disabled={disabled} title={label + (kbd ? ` (${kbd})` : "")} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md disabled:opacity-30 ${danger ? "text-red-400 hover:bg-red-500/10" : "text-zinc-200 hover:bg-zinc-800"}`}>
      <Icon size={14} /><span>{label}</span>{kbd && <kbd className="ml-0.5 text-[9px] text-zinc-500 border border-zinc-700 rounded px-1 hidden xl:inline">{kbd}</kbd>}
    </button>
  );

  const binList = Object.entries(sources);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-zinc-950 text-zinc-100" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); importFiles(e.dataTransfer.files); }}>
      {/* TOP APP BAR */}
      <header className="h-12 shrink-0 border-b border-zinc-800 flex items-center px-3 gap-3">
        <img src={(import.meta.env.BASE_URL || "/") + "favicon-32.png"} alt="CutRoom" className="w-7 h-7 rounded-md" />
        <span className="display text-base font-bold tracking-tight select-none"><span className="text-violet-400">Cut</span><span className="text-zinc-100">Room</span></span>
        <div className="w-px h-5 bg-zinc-800" />
        <input value={doc.name} onChange={(e) => dispatch({ type: "RENAME", name: e.target.value })} className="text-sm text-zinc-300 bg-transparent outline-none focus:bg-zinc-900 rounded px-1.5 py-0.5 max-w-[180px]" />
        <button onClick={() => { dispatch({ type: "RESET" }); setSources({}); setSelectedId(null); setAudioSelId(null); setTextSelId(null); setResultURL(null); }} className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1"><Plus size={13} /> New</button>
        <div className="flex items-center gap-1 ml-1">
          <button onClick={undo} disabled={!canUndo} className="p-1.5 rounded hover:bg-zinc-800 disabled:opacity-30" title="Undo (Ctrl+Z)"><Undo2 size={15} /></button>
          <button onClick={redo} disabled={!canRedo} className="p-1.5 rounded hover:bg-zinc-800 disabled:opacity-30" title="Redo (Ctrl+Shift+Z)"><Redo2 size={15} /></button>
        </div>
        <div className="ml-auto flex items-center gap-3 text-xs">
          <span className="text-zinc-600 hidden md:inline">{saved ? "Saved ✓" : "Autosaving"}</span>
          {engineReady ? <span className="hidden sm:flex items-center gap-1.5 text-zinc-500"><Check size={13} className="text-violet-400" /> engine ready</span> : <span className="flex items-center gap-1.5 text-zinc-500"><Loader2 size={13} className="animate-spin" /> loading engine…</span>}
          <div className="relative">
            <button onClick={() => setExportOpen((v) => !v)} disabled={!doc.clips.length && !exporting} className="flex items-center gap-1.5 bg-violet-500 text-white rounded-lg px-3 py-1.5 font-medium hover:bg-violet-400 disabled:opacity-40">{exporting ? <><Loader2 size={13} className="animate-spin" /> {exportPct}%</> : <><Download size={13} /> Export</>}</button>
            {(exportOpen || exporting) && (
              <div className="absolute right-0 top-full mt-2 w-72 bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-3 z-50 shadow-2xl shadow-black/60 text-left">
                <div className="flex items-center justify-between"><h3 className="text-xs font-semibold text-zinc-300">Export</h3><button onClick={() => setExportOpen(false)} className="text-zinc-500 hover:text-zinc-300"><X size={14} /></button></div>
                <select value={`${W}x${H}`} onChange={(e) => { const [w, h] = e.target.value.split("x").map(Number); dispatch({ type: "SET_OUTPUT", patch: { w, h, presetId: e.target.value } }); }} className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm border border-zinc-700 focus:border-violet-500 outline-none">
                  {PRESET_GROUPS.map((g) => (<optgroup key={g.platform} label={g.platform}>{g.items.map(([label, w, h]) => <option key={g.platform + label} value={`${w}x${h}`}>{label}</option>)}</optgroup>))}
                </select>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-zinc-400">Quality</span>
                  <div className="flex gap-1">{Object.entries(QUALITY).map(([k, v]) => (<button key={k} onClick={() => dispatch({ type: "SET_OUTPUT", patch: { quality: k } })} className={`text-xs px-2.5 py-1 rounded-md ${output.quality === k ? "bg-violet-500 text-white" : "bg-zinc-800 text-zinc-400"}`} title={v}>{v.split(" ")[0]}</button>))}</div>
                </div>
                <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer"><input type="checkbox" checked={doc.useOriginal} onChange={(e) => dispatch({ type: "SET_USE_ORIGINAL", value: e.target.checked })} className="accent-violet-500" /> Use original clip audio</label>
                <p className="text-[11px] text-zinc-600 tabular-nums">{W} × {H} · {QUALITY[output.quality]} · MP4 / H.264</p>
                {!resultURL ? (exporting ? (
                  <button onClick={cancel} className="w-full bg-red-500/20 text-red-300 font-medium rounded-lg py-2.5 flex items-center justify-center gap-2 hover:bg-red-500/30"><X size={15} /> Cancel · {exportPct}% · {fmt(elapsed)}</button>
                ) : (
                  <button onClick={doExport} disabled={!engineReady || !doc.clips.length} className="w-full bg-violet-500 text-white font-medium rounded-lg py-2.5 flex items-center justify-center gap-2 hover:bg-violet-400 disabled:opacity-60"><Download size={15} /> Export MP4</button>
                )) : (
                  <button onClick={download} className="w-full bg-white text-zinc-950 font-medium rounded-lg py-2.5 flex items-center justify-center gap-2 hover:bg-zinc-200"><Download size={15} /> Download MP4</button>
                )}
                {exporting && <div className="h-1 bg-zinc-800 rounded-full overflow-hidden"><div className="h-full bg-violet-500 transition-all" style={{ width: `${Math.max(2, exportPct)}%` }} /></div>}
                {resultURL && <button onClick={() => setResultURL(null)} className="w-full text-xs text-zinc-500 hover:text-zinc-300">Export again</button>}
              </div>
            )}
          </div>
        </div>
      </header>

      {recoverDoc && (
        <div className="shrink-0 flex items-center gap-3 text-xs bg-violet-500/10 border-b border-violet-500/20 px-4 py-2">
          <RotateCcw size={14} className="text-violet-400" />
          <span className="flex-1 text-zinc-300">Found an unsaved session “{recoverDoc.name}” ({recoverDoc.clips.length} clips). Media files need re-importing.</span>
          <button onClick={() => { dispatch({ type: "REPLACE", doc: recoverDoc }); setRecoverDoc(null); }} className="text-violet-400 hover:text-violet-300">Restore edits</button>
          <button onClick={() => setRecoverDoc(null)} className="text-zinc-500 hover:text-zinc-300">Dismiss</button>
        </div>
      )}

      <video ref={videoRef} src={activeSrc} playsInline muted={!doc.useOriginal} onLoadedData={onVideoLoaded} onLoadedMetadata={() => requestAnimationFrame(drawFrame)} onSeeked={() => requestAnimationFrame(drawFrame)} onError={(e) => { const er = e.currentTarget.error; setErr("Video error: code " + (er?.code ?? "?")); }} className="hidden" />

      <div className="flex-1 min-h-0 flex">
        <div className="group relative shrink-0 z-30">
          <div className="w-11 h-full border-r border-zinc-800 bg-zinc-950 flex flex-col items-center gap-4 py-3 text-zinc-500">
            <Film size={18} className="text-violet-400" />
            <span className="[writing-mode:vertical-rl] text-[10px] tracking-widest text-zinc-600 mt-1">MEDIA</span>
          </div>
          <div className="absolute left-0 top-0 bottom-0 w-64 bg-zinc-950 border-r border-zinc-800 shadow-2xl shadow-black/60 flex flex-col -translate-x-[105%] group-hover:translate-x-0 transition-transform duration-200 ease-out">
          <div className="shrink-0 px-3 py-2.5 border-b border-zinc-800 flex items-center justify-between">
            <h2 className="display text-sm font-bold">Media</h2>
            <label className="text-xs text-violet-400 hover:text-violet-300 cursor-pointer flex items-center gap-1"><Upload size={12} /> Import<input type="file" accept="video/*,audio/*" multiple className="hidden" onChange={(e) => importFiles(e.target.files)} /></label>
          </div>
          <div className="shrink-0 px-3 py-2 border-b border-zinc-800 flex items-center gap-3 text-xs flex-wrap">
            {recording ? <button onClick={stopRec} className="text-red-400 flex items-center gap-1"><Square size={11} /> Stop {fmt(recSecs)}</button> : <button onClick={startRec} className="text-rose-400 hover:text-rose-300 flex items-center gap-1"><Mic size={12} /> Record</button>}
            <button onClick={() => setTtsOpen((v) => !v)} className="text-emerald-400 hover:text-emerald-300 flex items-center gap-1"><MessageSquareText size={12} /> TTS</button>
            <button onClick={addText} className="text-fuchsia-400 hover:text-fuchsia-300 flex items-center gap-1"><Type size={12} /> Title</button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {binList.length === 0 && (
              <label className="block border-2 border-dashed border-zinc-800 rounded-lg py-10 text-center cursor-pointer hover:border-violet-500/50">
                <Upload size={22} className="mx-auto text-zinc-600 mb-2" />
                <span className="text-xs text-zinc-500">Drop or click to import<br />video / audio</span>
                <input type="file" accept="video/*,audio/*" multiple className="hidden" onChange={(e) => importFiles(e.target.files)} />
              </label>
            )}
            {binList.map(([id, s]) => (
              <div key={id} className="bg-zinc-800/60 rounded-lg p-2 space-y-2">
                <div className="flex items-center gap-2">
                  {s.type === "video" ? <VideoIcon size={13} className="text-zinc-400 shrink-0" /> : <span className={`w-2 h-2 rounded-full shrink-0 ${kindOf(s.kind).dot}`} />}
                  <span className="text-xs text-zinc-200 truncate flex-1" title={s.name}>{s.name}</span>
                  <button onClick={() => removeFromBin(id)} className="text-zinc-500 hover:text-red-400"><X size={12} /></button>
                </div>
                {s.type === "video"
                  ? <video src={s.url} controls className="w-full rounded bg-black max-h-28" />
                  : <audio src={s.url} controls className="w-full h-8" />}
                <button onClick={() => (s.type === "video" ? addVideoClip(id) : addAudioClip(id))} className="w-full text-xs bg-violet-500/90 text-white rounded py-1.5 hover:bg-violet-400 flex items-center justify-center gap-1"><Plus size={12} /> Add to timeline</button>
              </div>
            ))}
            {ttsOpen && (
              <div className="border-t border-zinc-800 pt-3 space-y-2">
                <div className="text-xs text-emerald-400 flex items-center gap-1"><MessageSquareText size={13} /> Text to speech</div>
                <textarea value={ttsText} onChange={(e) => setTtsText(e.target.value)} rows={3} placeholder="Type what the voice should say…" className="w-full bg-zinc-800 rounded-lg px-2 py-1.5 text-xs border border-zinc-700 focus:border-emerald-400 outline-none resize-none" />
                <select value={ttsVoice} onChange={(e) => setTtsVoice(e.target.value)} className="w-full bg-zinc-800 rounded-lg px-2 py-1.5 text-xs border border-zinc-700 outline-none">{VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select>
                <button onClick={generateTTS} disabled={ttsBusy || !ttsText.trim()} className="w-full bg-emerald-500 text-zinc-950 text-xs font-medium rounded-lg py-2 flex items-center justify-center gap-2 hover:bg-emerald-400 disabled:opacity-50">{ttsBusy ? <><Loader2 size={14} className="animate-spin" /> Generating…</> : "Generate voice"}</button>
                {ttsMsg && <p className="text-[11px] text-zinc-400">{ttsMsg}</p>}
              </div>
            )}
          </div>          </div>
        </div>

        <main className="flex-1 min-w-0 flex flex-col bg-zinc-950">
          <div className="flex-1 min-h-0 flex items-center justify-center p-2">
            {doc.clips.length
              ? <canvas ref={canvasRef} className="max-h-full max-w-full rounded-lg bg-black shadow-lg shadow-black/50" />
              : <div className="text-center text-zinc-600 text-sm flex flex-col items-center gap-2"><Film size={26} className="opacity-50" />Import media, then “Add to timeline” to preview</div>}
          </div>
          <div className="shrink-0 border-t border-zinc-800 px-4 py-2.5 flex items-center justify-center gap-3">
            <button onClick={togglePlay} disabled={!doc.clips.length} className="w-10 h-10 rounded-full bg-violet-500 text-white flex items-center justify-center hover:bg-violet-400 disabled:opacity-40">{playing ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}</button>
            <span className="text-xs tabular-nums text-zinc-400">{fmt(current)} / {fmt(total)}</span>
            <span className="text-[10px] text-zinc-600 hidden md:inline">Space = play/pause</span>
            {err && <span className="text-xs text-red-400 ml-3">{err}</span>}
          </div>
        </main>

        <div className="group relative shrink-0 z-30">
          <div className="w-11 h-full border-l border-zinc-800 bg-zinc-950 flex flex-col items-center gap-4 py-3 text-zinc-500">
            <SlidersHorizontal size={18} className="text-violet-400" />
            <span className="[writing-mode:vertical-rl] text-[10px] tracking-widest text-zinc-600 mt-1">INSPECTOR</span>
          </div>
          <div className="absolute right-0 top-0 bottom-0 w-80 bg-zinc-950 border-l border-zinc-800 shadow-2xl shadow-black/60 flex flex-col translate-x-[105%] group-hover:translate-x-0 transition-transform duration-200 ease-out">
            <div className="shrink-0 px-3 py-2.5 border-b border-zinc-800"><h2 className="display text-sm font-bold">Inspector</h2></div>
            <div className="flex-1 overflow-y-auto p-3 space-y-4">
              {(selectedClip || selectedAudio || selectedText) && (
              <div className="bg-zinc-900 rounded-xl p-3 space-y-2">
                {selectedClip ? (() => { const src = sources[selectedClip.srcId]; const max = src?.duration || selectedClip.out; const sp = selectedClip.speed || 1; const effDur = (selectedClip.out - selectedClip.in) / sp; return (<>
                  <div className="text-[11px] text-zinc-400 flex items-center gap-2"><Scissors size={13} /> Clip · {src?.name}</div>
                  <Slider label={`Start ${fmt(selectedClip.in)}`} value={selectedClip.in} min={0} max={max} step={0.01} onChange={(v) => dispatch({ type: "TRIM_CLIP", id: selectedId, in: Math.min(v, selectedClip.out - 0.1), out: selectedClip.out })} />
                  <Slider label={`End ${fmt(selectedClip.out)}`} value={selectedClip.out} min={0} max={max} step={0.01} onChange={(v) => dispatch({ type: "TRIM_CLIP", id: selectedId, in: selectedClip.in, out: Math.max(v, selectedClip.in + 0.1) })} />
                  <div className="flex items-center gap-2 flex-wrap pt-1">
                    <span className="text-xs text-zinc-400 flex items-center gap-1.5 w-20 shrink-0"><Gauge size={14} /> Speed</span>
                    {[0.25, 0.5, 1, 1.5, 2, 4].map((x) => (
                      <button key={x} onClick={() => dispatch({ type: "SET_SPEED", id: selectedId, speed: x })} className={`text-xs px-2 py-1 rounded-md ${sp === x ? "bg-violet-500 text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}>{x}×</button>
                    ))}
                  </div>
                  <p className="text-[10px] text-zinc-500 tabular-nums">plays in {fmt(effDur)}</p>
                  <Slider icon={SlidersHorizontal} label="Scale (zoom)" value={selectedClip.scale || 1} min={1} max={3} step={0.01} onChange={(v) => dispatch({ type: "UPDATE_CLIP", id: selectedId, patch: { scale: v } })} />
                  <Slider icon={MoveHorizontal} label="Position X" value={selectedClip.posX || 0} min={-0.5} max={0.5} step={0.01} onChange={(v) => dispatch({ type: "UPDATE_CLIP", id: selectedId, patch: { posX: v } })} />
                  <Slider icon={MoveHorizontal} label="Position Y" value={selectedClip.posY || 0} min={-0.5} max={0.5} step={0.01} onChange={(v) => dispatch({ type: "UPDATE_CLIP", id: selectedId, patch: { posY: v } })} />
                  <Slider icon={RotateCcw} label="Rotation°" value={selectedClip.rot || 0} min={-180} max={180} step={1} onChange={(v) => dispatch({ type: "UPDATE_CLIP", id: selectedId, patch: { rot: v } })} />
                  {((selectedClip.scale || 1) !== 1 || selectedClip.posX || selectedClip.posY || selectedClip.rot) ? <div className="flex justify-end"><button onClick={() => dispatch({ type: "UPDATE_CLIP", id: selectedId, patch: { scale: 1, posX: 0, posY: 0, rot: 0 } })} className="text-[11px] text-zinc-400 hover:text-zinc-200">Reset transform</button></div> : null}
                </>); })() : selectedAudio ? (() => { const src = sources[selectedAudio.srcId]; const sdur = src?.duration || selectedAudio.out; const posMax = Math.max(total, selectedAudio.start + (selectedAudio.out - selectedAudio.in), 1); const kc = kindOf(selectedAudio.kind); return (<>
                  <div className="text-[11px] text-zinc-300 flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${kc.dot}`} /> Audio · {selectedAudio.label}</div>
                  <Slider icon={MoveHorizontal} label={`Start at ${fmt(selectedAudio.start)}`} value={selectedAudio.start} min={0} max={posMax} step={0.05} onChange={(v) => dispatch({ type: "UPDATE_AUDIO", id: audioSelId, patch: { start: v } })} />
                  <Slider icon={Scissors} label={`Clip start ${fmt(selectedAudio.in)}`} value={selectedAudio.in} min={0} max={sdur} step={0.05} onChange={(v) => dispatch({ type: "UPDATE_AUDIO", id: audioSelId, patch: { in: Math.min(v, selectedAudio.out - 0.1) } })} />
                  <Slider icon={Scissors} label={`Clip end ${fmt(selectedAudio.out)}`} value={selectedAudio.out} min={0} max={sdur} step={0.05} onChange={(v) => dispatch({ type: "UPDATE_AUDIO", id: audioSelId, patch: { out: Math.max(v, selectedAudio.in + 0.1) } })} />
                  <Slider icon={Volume2} label="Volume" value={selectedAudio.vol ?? 1} onChange={(v) => dispatch({ type: "UPDATE_AUDIO", id: audioSelId, patch: { vol: v } })} />
                  <Slider icon={Volume2} label="Fade in (s)" value={selectedAudio.fadeIn || 0} min={0} max={Math.max(1, (selectedAudio.out - selectedAudio.in) / 2)} step={0.1} onChange={(v) => dispatch({ type: "UPDATE_AUDIO", id: audioSelId, patch: { fadeIn: v } })} />
                  <Slider icon={Volume2} label="Fade out (s)" value={selectedAudio.fadeOut || 0} min={0} max={Math.max(1, (selectedAudio.out - selectedAudio.in) / 2)} step={0.1} onChange={(v) => dispatch({ type: "UPDATE_AUDIO", id: audioSelId, patch: { fadeOut: v } })} />
                  <div className="flex justify-end"><button onClick={() => { dispatch({ type: "REMOVE_AUDIO", id: audioSelId }); setAudioSelId(null); }} className="text-[11px] text-red-400 hover:text-red-300 flex items-center gap-1"><Trash2 size={11} /> Remove</button></div>
                </>); })() : selectedText ? (() => { const posMax = Math.max(total, selectedText.start + selectedText.dur, 1); return (<>
                  <div className="text-[11px] text-fuchsia-300 flex items-center gap-2"><Type size={13} /> Title / text</div>
                  <textarea value={selectedText.content} onChange={(e) => dispatch({ type: "UPDATE_TEXT", id: textSelId, patch: { content: e.target.value } })} rows={2} className="w-full bg-zinc-800 rounded-lg px-2 py-1.5 text-xs border border-zinc-700 focus:border-fuchsia-400 outline-none resize-none" />
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-400 w-16 shrink-0">Position</span>
                    {["top", "center", "bottom"].map((p) => <button key={p} onClick={() => dispatch({ type: "UPDATE_TEXT", id: textSelId, patch: { pos: p } })} className={`text-xs px-2 py-1 rounded-md capitalize ${selectedText.pos === p ? "bg-violet-500 text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}>{p}</button>)}
                    <label className="ml-auto flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer"><input type="checkbox" checked={!!selectedText.bg} onChange={(e) => dispatch({ type: "UPDATE_TEXT", id: textSelId, patch: { bg: e.target.checked } })} className="accent-violet-500" /> box</label>
                    <input type="color" value={selectedText.color || "#ffffff"} onChange={(e) => dispatch({ type: "UPDATE_TEXT", id: textSelId, patch: { color: e.target.value } })} className="w-7 h-7 bg-transparent rounded cursor-pointer" title="Text color" />
                  </div>
                  <Slider icon={Type} label="Size" value={selectedText.size || 0.09} min={0.04} max={0.2} step={0.005} onChange={(v) => dispatch({ type: "UPDATE_TEXT", id: textSelId, patch: { size: v } })} />
                  <Slider icon={MoveHorizontal} label={`Start ${fmt(selectedText.start)}`} value={selectedText.start} min={0} max={posMax} step={0.05} onChange={(v) => dispatch({ type: "UPDATE_TEXT", id: textSelId, patch: { start: v } })} />
                  <Slider icon={SlidersHorizontal} label={`Duration ${fmt(selectedText.dur)}`} value={selectedText.dur} min={0.3} max={Math.max(5, total || 10)} step={0.1} onChange={(v) => dispatch({ type: "UPDATE_TEXT", id: textSelId, patch: { dur: v } })} />
                  <div className="flex justify-end"><button onClick={() => { dispatch({ type: "REMOVE_TEXT", id: textSelId }); setTextSelId(null); }} className="text-[11px] text-red-400 hover:text-red-300 flex items-center gap-1"><Trash2 size={11} /> Remove</button></div>
                </>); })() : null}
              </div>
            )}
              {!(selectedClip || selectedAudio || selectedText) && <p className="text-xs text-zinc-600">Select a clip, audio, or title on the timeline to edit it here.</p>}
            </div>
          </div>
        </div>
      </div>

      <div className="h-[30vh] shrink-0 border-t border-zinc-800 flex flex-col min-h-0 bg-zinc-900/30">
        <div className="shrink-0 px-3 py-2 border-b border-zinc-800 flex items-center gap-1.5 flex-wrap text-xs">
          <Tool onClick={razor} disabled={!total} icon={Scissors} label="Razor" kbd="S" />
          <Tool onClick={cutClip} disabled={!selectedId} icon={Scissors} label="Cut" kbd="Ctrl+X" />
          <Tool onClick={copyClip} disabled={!selectedId} icon={Copy} label="Copy" kbd="Ctrl+C" />
          <Tool onClick={pasteClip} disabled={!clipboard} icon={ClipboardPaste} label="Paste" kbd="Ctrl+V" />
          <Tool onClick={() => selectedId && dispatch({ type: "DUPLICATE_CLIP", id: selectedId })} disabled={!selectedId} icon={CopyPlus} label="Duplicate" />
          <Tool onClick={() => { if (selectedId) { dispatch({ type: "DELETE_CLIP", id: selectedId }); setSelectedId(null); } }} disabled={!selectedId} icon={Trash2} label="Delete" kbd="Del" danger />
          <div className="flex items-center gap-2 text-zinc-400 ml-auto"><span>Zoom</span><input type="range" min={10} max={200} step={5} value={pps} onChange={(e) => setPps(Number(e.target.value))} className="w-28 accent-violet-500 h-1" /></div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-3">
          {doc.clips.length === 0 && doc.audio.length === 0 && (doc.texts || []).length === 0 ? (
            <p className="text-xs text-zinc-600 py-8 text-center">Timeline is empty. Import media on the left, then “Add to timeline”.</p>
          ) : (
            <div ref={timelineRef} className="relative overflow-x-auto overflow-y-hidden pb-1">
              <div className="relative" style={{ width: contentW }}>
                <div className="h-5 relative border-b border-zinc-800 cursor-text" onPointerDown={(e) => seekByClientX(e.clientX)}>
                  {ticks.map((t) => (<span key={t} className="absolute top-0 text-[9px] text-zinc-500 select-none" style={{ left: t * pps }}><span className="absolute left-0 top-3 w-px h-2 bg-zinc-700" />{fmt(t)}</span>))}
                </div>
                <div className="relative h-14 mt-1 bg-zinc-950/40 rounded">
                  {layout.map((L, i) => (
                    <div key={L.id} draggable={!trimDrag}
                      onDragStart={(e) => { if (handleDownRef.current) { e.preventDefault(); return; } dragFrom.current = i; }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => { if (dragFrom.current !== null && dragFrom.current !== i) dispatch({ type: "REORDER", from: dragFrom.current, to: i }); dragFrom.current = null; }}
                      onClick={() => { setSelectedId(L.id); setAudioSelId(null); setTextSelId(null); seekGlobal(L.left / pps); }}
                      className={`absolute top-0 bottom-0 rounded-md overflow-hidden cursor-grab active:cursor-grabbing border-2 bg-gradient-to-b from-zinc-600 to-zinc-700 flex items-center ${selectedId === L.id ? "border-violet-500 z-10" : "border-transparent"}`} style={{ left: L.left, width: Math.max(12, L.width) }}>
                      <div onPointerDown={(e) => { e.stopPropagation(); handleDownRef.current = true; setTrimDrag({ id: L.id, edge: "in", startX: e.clientX, baseIn: L.clip.in, baseOut: L.clip.out, in: L.clip.in, out: L.clip.out }); }} onDragStart={(e) => e.preventDefault()} className="absolute left-0 top-0 bottom-0 w-2 bg-violet-500/60 hover:bg-violet-500 cursor-ew-resize z-10" />
                      <span className="text-[10px] text-zinc-100 truncate px-3 pointer-events-none">{sources[L.clip.srcId]?.name || "clip"} · {fmt(L.dur)}{(L.clip.speed || 1) !== 1 ? ` · ${L.clip.speed}×` : ""}</span>
                      <div onPointerDown={(e) => { e.stopPropagation(); handleDownRef.current = true; setTrimDrag({ id: L.id, edge: "out", startX: e.clientX, baseIn: L.clip.in, baseOut: L.clip.out, in: L.clip.in, out: L.clip.out }); }} onDragStart={(e) => e.preventDefault()} className="absolute right-0 top-0 bottom-0 w-2 bg-violet-500/60 hover:bg-violet-500 cursor-ew-resize z-10" />
                    </div>
                  ))}
                </div>
                {audioDisp.map((a) => { const kc = kindOf(a.kind); const dur = a.out - a.in; return (
                  <div key={a.id} className="relative h-7 mt-1">
                    <div onClick={() => { setAudioSelId(a.id); setSelectedId(null); setTextSelId(null); }} onPointerDown={(e) => { e.stopPropagation(); handleDownRef.current = true; setAudioDrag({ id: a.id, mode: "move", startX: e.clientX, baseStart: a.start, baseIn: a.in, baseOut: a.out, start: a.start, in: a.in, out: a.out }); }} className={`absolute inset-y-0 rounded flex items-center px-2 gap-2 cursor-grab active:cursor-grabbing border ${kc.bar} ${audioSelId === a.id ? "ring-2 ring-violet-400" : ""}`} style={{ left: a.start * pps, width: Math.max(16, dur * pps) }}>
                      <div onPointerDown={(e) => { e.stopPropagation(); handleDownRef.current = true; setAudioDrag({ id: a.id, mode: "in", startX: e.clientX, baseStart: a.start, baseIn: a.in, baseOut: a.out, start: a.start, in: a.in, out: a.out }); }} className={`absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize rounded-l ${kc.handle}`} />
                      <span className="text-[10px] text-zinc-100 truncate pointer-events-none">{a.label || a.kind}</span>
                      <button onPointerDown={(e) => e.stopPropagation()} onClick={() => dispatch({ type: "REMOVE_AUDIO", id: a.id })} className="ml-auto text-zinc-200 hover:text-white pointer-events-auto"><X size={11} /></button>
                      <div onPointerDown={(e) => { e.stopPropagation(); handleDownRef.current = true; setAudioDrag({ id: a.id, mode: "out", startX: e.clientX, baseStart: a.start, baseIn: a.in, baseOut: a.out, start: a.start, in: a.in, out: a.out }); }} className={`absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize rounded-r ${kc.handle}`} />
                    </div>
                  </div>
                ); })}
                {(doc.texts || []).map((t) => (
                  <div key={t.id} className="relative h-7 mt-1">
                    <div onClick={() => { setTextSelId(t.id); setSelectedId(null); setAudioSelId(null); }} className={`absolute inset-y-0 rounded flex items-center px-2 gap-2 cursor-pointer border bg-fuchsia-500/30 border-fuchsia-400/50 ${textSelId === t.id ? "ring-2 ring-fuchsia-300" : ""}`} style={{ left: t.start * pps, width: Math.max(16, t.dur * pps) }}>
                      <Type size={11} className="text-fuchsia-200 shrink-0" />
                      <span className="text-[10px] text-zinc-100 truncate pointer-events-none">{(t.content || "").split("\n")[0] || "title"}</span>
                      <button onClick={(e) => { e.stopPropagation(); dispatch({ type: "REMOVE_TEXT", id: t.id }); if (textSelId === t.id) setTextSelId(null); }} className="ml-auto text-zinc-200 hover:text-white"><X size={11} /></button>
                    </div>
                  </div>
                ))}
                <div className="absolute top-0 bottom-0 w-0.5 bg-white pointer-events-none" style={{ left: current * pps }} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
