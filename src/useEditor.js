import { useReducer, useCallback, useEffect, useRef } from "react";

export const STORAGE_KEY = "cutroom:doc:v1";

export const initialDoc = {
  name: "Untitled project",
  clips: [],            // [{ id, srcId, in, out, speed, scale, posX, posY, rot }]
  audio: [],            // [{ id, srcId, start, in, out, vol, kind, label, fadeIn, fadeOut }]
  texts: [],            // [{ id, content, start, dur, pos, size, color, bg }]
  useOriginal: true,
  output: { presetId: "ig_reel", w: 1080, h: 1920, quality: "high" },
};

const uid = () => Math.random().toString(36).slice(2, 10);

function docReducer(doc, a) {
  switch (a.type) {
    case "ADD_CLIPS":
      return { ...doc, clips: [...doc.clips, ...a.clips] };
    case "INSERT_CLIP": {
      const clips = [...doc.clips];
      const at = Math.max(0, Math.min(a.index, clips.length));
      clips.splice(at, 0, a.clip);
      return { ...doc, clips };
    }
    case "DELETE_CLIP":
      return { ...doc, clips: doc.clips.filter((c) => c.id !== a.id) };
    case "DUPLICATE_CLIP": {
      const i = doc.clips.findIndex((c) => c.id === a.id);
      if (i < 0) return doc;
      const copy = { ...doc.clips[i], id: uid() };
      const clips = [...doc.clips];
      clips.splice(i + 1, 0, copy);
      return { ...doc, clips };
    }
    case "REORDER": {
      const clips = [...doc.clips];
      const [moved] = clips.splice(a.from, 1);
      clips.splice(a.to, 0, moved);
      return { ...doc, clips };
    }
    case "TRIM_CLIP":
      return {
        ...doc,
        clips: doc.clips.map((c) =>
          c.id === a.id ? { ...c, in: a.in, out: a.out } : c
        ),
      };
    case "SET_SPEED":
      return { ...doc, clips: doc.clips.map((c) => (c.id === a.id ? { ...c, speed: a.speed } : c)) };
    case "UPDATE_CLIP":
      return { ...doc, clips: doc.clips.map((c) => (c.id === a.id ? { ...c, ...a.patch } : c)) };
    case "ADD_TEXT":
      return { ...doc, texts: [...(doc.texts || []), a.text] };
    case "UPDATE_TEXT":
      return { ...doc, texts: (doc.texts || []).map((t) => (t.id === a.id ? { ...t, ...a.patch } : t)) };
    case "REMOVE_TEXT":
      return { ...doc, texts: (doc.texts || []).filter((t) => t.id !== a.id) };
    case "SPLIT_CLIP": {
      const i = doc.clips.findIndex((c) => c.id === a.id);
      if (i < 0) return doc;
      const c = doc.clips[i];
      const at = c.in + a.local;
      if (at <= c.in + 0.05 || at >= c.out - 0.05) return doc;
      const left = { ...c, out: at };
      const right = { ...c, id: uid(), in: at };
      const clips = [...doc.clips];
      clips.splice(i, 1, left, right);
      return { ...doc, clips };
    }
    case "REMOVE_SRC":
      return { ...doc, clips: doc.clips.filter((c) => c.srcId !== a.srcId), audio: doc.audio.filter((x) => x.srcId !== a.srcId) };
    case "ADD_AUDIO":
      return { ...doc, audio: [...doc.audio, a.clip] };
    case "UPDATE_AUDIO":
      return { ...doc, audio: doc.audio.map((c) => (c.id === a.id ? { ...c, ...a.patch } : c)) };
    case "REMOVE_AUDIO":
      return { ...doc, audio: doc.audio.filter((c) => c.id !== a.id) };
    case "SET_OUTPUT":
      return { ...doc, output: { ...doc.output, ...a.patch } };
    case "SET_USE_ORIGINAL":
      return { ...doc, useOriginal: a.value };
    case "RENAME":
      return { ...doc, name: a.name };
    case "REPLACE":
      return a.doc;
    case "RESET":
      return { ...initialDoc };
    default:
      return doc;
  }
}

// History wrapper — every doc action is undoable; selection lives outside.
function historyReducer(state, action) {
  if (action.type === "UNDO") {
    if (!state.past.length) return state;
    const past = state.past.slice(0, -1);
    const present = state.past[state.past.length - 1];
    return { past, present, future: [state.present, ...state.future] };
  }
  if (action.type === "REDO") {
    if (!state.future.length) return state;
    const [present, ...future] = state.future;
    return { past: [...state.past, state.present], present, future };
  }
  const present = docReducer(state.present, action);
  if (present === state.present) return state; // no-op, don't pollute history
  return { past: [...state.past, state.present], present, future: [] };
}

export function loadSavedDoc() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.clips)) return null;
    if (!Array.isArray(parsed.audio)) parsed.audio = [];
    if (!Array.isArray(parsed.texts)) parsed.texts = [];
    return parsed;
  } catch {
    return null;
  }
}

export function useEditor() {
  const [state, raw] = useReducer(historyReducer, {
    past: [], present: initialDoc, future: [],
  });

  const dispatch = useCallback((action) => raw(action), []);
  const undo = useCallback(() => raw({ type: "UNDO" }), []);
  const redo = useCallback(() => raw({ type: "REDO" }), []);

  // Debounced autosave of the editable document (not media binaries).
  const saveTimer = useRef(null);
  useEffect(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.present)); } catch {}
    }, 600);
    return () => clearTimeout(saveTimer.current);
  }, [state.present]);

  return {
    doc: state.present,
    dispatch,
    undo, redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}

export { uid };
