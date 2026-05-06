import type { JSX } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseBlob } from "music-metadata";
import { startBellRepeats, stopBell } from "./bellRepeats";
import "./App.css";

const NOTE_W = 200;
/** Approx. vertical midpoint for wires (sticky + timer row). */
const NOTE_H = 172;

/**
 * Shared world plane (px) for wallpaper + SVG. Same coordinate space as note `left/top`.
 * Extremely large roam; not mathematically ∞ to stay within practical browser limits.
 */
export const WORLD_MIN = -300_000;
export const WORLD_SPAN = 600_000;

export const DEFAULT_NOTE_PALETTE = [
  "#fff59d",
  "#ffab91",
  "#aed581",
  "#81d4fa",
  "#ce93d8",
  "#ffe082",
  "#f48fb1",
  "#bcaaa4",
] as const;

const DEFAULT_WIRE_STROKE = "#f6edd6";
const DEFAULT_WIRE_PREVIEW = "#ffe9a8";

const MIN_PALETTE_SIZE = 3;

export type Note = {
  id: string;
  x: number;
  y: number;
  text: string;
  colorIndex: number;
  /** Wall-clock time when the countdown reaches zero */
  timerEndMs: number | null;
  /** True after the deadline until the user responds (finished / extend) */
  timerRinging: boolean;
  /** Marked when user confirms the task was done */
  taskDone: boolean;
};

type TimerDialogState = {
  noteId: string;
  view: "pick" | "running" | "ringing" | "extend";
};

type Connection = {
  id: string;
  fromId: string;
  toId: string;
};

type Track = {
  id: string;
  url: string;
  title: string;
  artist: string;
  file: File;
};

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Reads embedded tags when available; falls back to "Artist - Title" from the filename. */
async function readTrackMeta(file: File): Promise<{ title: string; artist: string }> {
  const base = file.name.replace(/\.[^/.]+$/, "").trim() || "Untitled";
  const fromName = () => {
    const dash = base.match(/^(.+?)\s*-\s*(.+)$/);
    if (dash) {
      return { artist: dash[1].trim() || "Unknown artist", title: dash[2].trim() || base };
    }
    return { title: base, artist: "Unknown artist" };
  };
  const fallback = fromName();
  try {
    const meta = await parseBlob(file, { duration: false });
    const title = meta.common.title?.trim() || fallback.title;
    const artist =
      meta.common.artist?.trim() ||
      (meta.common.artists?.length ? meta.common.artists.join(", ") : "") ||
      fallback.artist;
    return { title, artist };
  } catch {
    return fallback;
  }
}

function curvePath(x1: number, y1: number, x2: number, y2: number) {
  const mx = (x1 + x2) / 2;
  const sag = Math.min(80, Math.abs(x2 - x1) * 0.35);
  const cy = (y1 + y2) / 2 + sag;
  return `M ${x1} ${y1} Q ${mx} ${cy} ${x2} ${y2}`;
}

function formatCountdownMs(endMs: number | null, ringing: boolean, now: number) {
  if (ringing) return "0:00";
  if (endMs == null) return "—";
  const sec = Math.max(0, Math.ceil((endMs - now) / 1000));
  if (sec >= 86400) {
    const d = Math.floor(sec / 86400);
    const r = sec % 86400;
    const h = Math.floor(r / 3600);
    const rm = r % 3600;
    const m = Math.floor(rm / 60);
    const s = rm % 60;
    return `${d}d ${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const MIN_DURATION_MS = 1000;
const MAX_DURATION_MS = 366 * 24 * 60 * 60 * 1000;

type DurationDraft = { days: string; hours: string; mins: string; secs: string };

function emptyDurationDraft(): DurationDraft {
  return { days: "0", hours: "0", mins: "15", secs: "0" };
}

function parseNonnegIntDigits(s: string): number | null {
  const t = String(s).trim();
  if (t === "") return 0;
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function draftToMs(d: DurationDraft): number | null {
  const DD = parseNonnegIntDigits(d.days);
  const HH = parseNonnegIntDigits(d.hours);
  const MM = parseNonnegIntDigits(d.mins);
  const SS = parseNonnegIntDigits(d.secs);
  if (DD === null || HH === null || MM === null || SS === null) return null;
  const ms = DD * 864e5 + HH * 3600e3 + MM * 60e3 + SS * 1000;
  if (ms < MIN_DURATION_MS) return null;
  return Math.min(ms, MAX_DURATION_MS);
}

/** Quick-start / extend presets — always milliseconds. */
const TIMER_PRESETS: { label: string; ms: number }[] = [
  { label: "30 sec", ms: 30_000 },
  { label: "1 min", ms: 60_000 },
  { label: "5 min", ms: 5 * 60_000 },
  { label: "15 min", ms: 15 * 60_000 },
  { label: "1 hour", ms: 60 * 60_000 },
  { label: "1 day", ms: 24 * 60 * 60_000 },
];

function DurationFields({
  draft,
  onDraftChange,
  idSuffix,
}: {
  draft: DurationDraft;
  onDraftChange: (d: DurationDraft) => void;
  idSuffix: string;
}) {
  const cell = (key: keyof DurationDraft, label: string, baseId: string) => (
    <label className="timer-dur-cell" htmlFor={`${baseId}-${idSuffix}`}>
      <span>{label}</span>
      <input
        id={`${baseId}-${idSuffix}`}
        type="text"
        inputMode="numeric"
        className="timer-dur-input"
        value={draft[key]}
        onChange={(e) => onDraftChange({ ...draft, [key]: e.target.value })}
        autoComplete="off"
      />
    </label>
  );
  return (
    <div className="timer-dur-grid" role="group" aria-label="Duration parts">
      {cell("days", "Days", "dur-d")}
      {cell("hours", "Hours", "dur-h")}
      {cell("mins", "Minutes", "dur-m")}
      {cell("secs", "Seconds", "dur-s")}
    </div>
  );
}

function useLocalClockParts() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const now = useMemo(() => new Date(), [tick]);
  const timeStr = useMemo(
    () =>
      now.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      }),
    [now]
  );
  const dateStr = useMemo(
    () =>
      now.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
    [now]
  );
  const tzName =
    Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
      .formatToParts(now)
      .find((p) => p.type === "timeZoneName")?.value ?? "";
  const nowMs = now.getTime();
  return { tick, nowMs, timeStr, dateStr, tzName };
}

export default function App() {
  const boardRef = useRef<HTMLDivElement>(null);
  const trashRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bgImageInputRef = useRef<HTMLInputElement>(null);
  const settingsPanelRef = useRef<HTMLDivElement>(null);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);
  const customBgUrlRef = useRef<string | null>(null);

  const [notePalette, setNotePalette] = useState<string[]>(() => [...DEFAULT_NOTE_PALETTE]);
  const [wireColor, setWireColor] = useState(DEFAULT_WIRE_STROKE);
  const [wirePreviewColor, setWirePreviewColor] = useState(DEFAULT_WIRE_PREVIEW);
  const [customBackgroundUrl, setCustomBackgroundUrl] = useState<string | null>(null);
  const [starsOnCustomBg, setStarsOnCustomBg] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [notes, setNotes] = useState<Note[]>(() => [
    {
      id: uid(),
      x: 120,
      y: 100,
      text: "Drag notes around the board.\nConnect them with the metal eyelets.",
      colorIndex: 0,
      timerEndMs: null,
      timerRinging: false,
      taskDone: false,
    },
    {
      id: uid(),
      x: 400,
      y: 220,
      text: "Drop a note on the trash to remove it (recoverable). Set a timer below.",
      colorIndex: 2,
      timerEndMs: null,
      timerRinging: false,
      taskDone: false,
    },
  ]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [trashedNotes, setTrashedNotes] = useState<Note[]>([]);
  const [trashModalOpen, setTrashModalOpen] = useState(false);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragOffset = useRef({ dx: 0, dy: 0 });

  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [wirePreview, setWirePreview] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(
    null
  );

  const [tracks, setTracks] = useState<Track[]>([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const trackUrlsRef = useRef<Set<string>>(new Set());
  const { tick, nowMs, timeStr, dateStr, tzName } = useLocalClockParts();

  const [viewport, setViewport] = useState({ pan: { x: 0, y: 0 }, scale: 1 });
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const panDragRef = useRef<{
    pointerId: number;
    sx: number;
    sy: number;
    ox: number;
    oy: number;
  } | null>(null);

  const [timerDialog, setTimerDialog] = useState<TimerDialogState | null>(null);
  const [durationDraft, setDurationDraft] = useState<DurationDraft>(() => emptyDurationDraft());

  useEffect(() => {
    function onPointerDown(ev: MouseEvent) {
      if (!settingsOpen) return;
      const t = ev.target as Node;
      if (
        settingsPanelRef.current?.contains(t) ||
        settingsBtnRef.current?.contains(t)
      ) {
        return;
      }
      setSettingsOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [settingsOpen]);

  useEffect(() => {
    setNotes((prev) => {
      let changed = false;
      const idsToPlay: string[] = [];
      const next = prev.map((n) => {
        if (n.timerEndMs != null && !n.timerRinging && nowMs >= n.timerEndMs) {
          changed = true;
          idsToPlay.push(n.id);
          return { ...n, timerRinging: true };
        }
        return n;
      });
      if (!changed) return prev;
      idsToPlay.forEach((nid) => {
        startBellRepeats(nid);
      });
      return next;
    });
  }, [tick, nowMs]);

  /** Zoom board around a screen-space point relative to `#board-shell` inner area. */
  const applyWheelZoomAt = useCallback((clientX: number, clientY: number, scaleDeltaFactor: number) => {
    const shell = boardRef.current;
    if (!shell) return;
    const br = shell.getBoundingClientRect();
    const lx = clientX - br.left;
    const ly = clientY - br.top;
    setViewport((v) => {
      const ns = Math.min(3.5, Math.max(0.18, v.scale * scaleDeltaFactor));
      const wx = (lx - v.pan.x) / v.scale;
      const wy = (ly - v.pan.y) / v.scale;
      return { scale: ns, pan: { x: lx - wx * ns, y: ly - wy * ns } };
    });
  }, []);

  useEffect(() => {
    const shell = boardRef.current;
    if (!shell) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const dz = Math.exp(-e.deltaY * 0.004);
        applyWheelZoomAt(e.clientX, e.clientY, dz);
        return;
      }
      setViewport((v) => ({
        ...v,
        pan: { x: v.pan.x - e.deltaX, y: v.pan.y - e.deltaY },
      }));
    };
    shell.addEventListener("wheel", onWheel, { passive: false });
    return () => shell.removeEventListener("wheel", onWheel);
  }, [applyWheelZoomAt]);

  useEffect(() => {
    return () => {
      if (customBgUrlRef.current) {
        URL.revokeObjectURL(customBgUrlRef.current);
        customBgUrlRef.current = null;
      }
    };
  }, []);

  const setCustomBackgroundFromFile = (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    if (customBgUrlRef.current) {
      URL.revokeObjectURL(customBgUrlRef.current);
      customBgUrlRef.current = null;
    }
    const url = URL.createObjectURL(file);
    customBgUrlRef.current = url;
    setCustomBackgroundUrl(url);
  };

  const clearCustomBackground = () => {
    if (customBgUrlRef.current) {
      URL.revokeObjectURL(customBgUrlRef.current);
      customBgUrlRef.current = null;
    }
    setCustomBackgroundUrl(null);
    if (bgImageInputRef.current) bgImageInputRef.current.value = "";
  };

  const updatePaletteColorAt = (index: number, hex: string) => {
    setNotePalette((prev) => prev.map((c, i) => (i === index ? hex : c)));
  };

  const addPaletteColor = () => {
    setNotePalette((prev) => [...prev, "#fef3c7"]);
  };

  const removePaletteColor = (index: number) => {
    setNotePalette((prev) => {
      if (prev.length <= MIN_PALETTE_SIZE) return prev;
      const next = prev.filter((_, i) => i !== index);
      const reindex = (note: Note) => {
        let ci = note.colorIndex;
        if (ci === index) ci = Math.min(index, next.length - 1);
        else if (ci > index) ci -= 1;
        return { ...note, colorIndex: ci };
      };
      setNotes((n) => n.map(reindex));
      setTrashedNotes((n) => n.map(reindex));
      return next;
    });
  };

  const resetAppearanceDefaults = () => {
    setNotePalette([...DEFAULT_NOTE_PALETTE]);
    setWireColor(DEFAULT_WIRE_STROKE);
    setWirePreviewColor(DEFAULT_WIRE_PREVIEW);
    clearCustomBackground();
    setStarsOnCustomBg(true);
  };

  const noteMap = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);

  const boardPoint = useCallback((clientX: number, clientY: number) => {
    const shell = boardRef.current;
    if (!shell) return { x: clientX, y: clientY };
    const br = shell.getBoundingClientRect();
    const lx = clientX - br.left;
    const ly = clientY - br.top;
    const { pan, scale } = viewportRef.current;
    return {
      x: (lx - pan.x) / scale,
      y: (ly - pan.y) / scale,
    };
  }, []);

  const zoomBoardAtCenter = useCallback((factor: number) => {
    const shell = boardRef.current;
    if (!shell) return;
    const br = shell.getBoundingClientRect();
    applyWheelZoomAt(br.left + br.width / 2, br.top + br.height / 2, factor);
  }, [applyWheelZoomAt]);

  const resetBoardView = () => setViewport({ pan: { x: 0, y: 0 }, scale: 1 });

  function onBoardShellPointerDown(e: React.PointerEvent) {
    const t = e.target as HTMLElement;
    if (t.closest("[data-note-id]")) return;
    if (t.closest(".toolbar-left")) return;
    if (t.closest(".board-view-hud")) return;
    if (!(e.altKey || e.button === 1)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const v = viewportRef.current;
    panDragRef.current = {
      pointerId: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      ox: v.pan.x,
      oy: v.pan.y,
    };
  }

  function onBoardShellPointerMove(e: React.PointerEvent) {
    const d = panDragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    e.preventDefault();
    setViewport((v) => ({
      scale: v.scale,
      pan: {
        x: d.ox + e.clientX - d.sx,
        y: d.oy + e.clientY - d.sy,
      },
    }));
  }

  function onBoardShellPointerEnd(e: React.PointerEvent) {
    const d = panDragRef.current;
    if (d?.pointerId === e.pointerId) {
      panDragRef.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  }

  const isOverTrash = useCallback((clientX: number, clientY: number) => {
    const el = trashRef.current;
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }, []);

  const findNoteIdAtPoint = useCallback((clientX: number, clientY: number, excludeId?: string) => {
    const els = document.elementsFromPoint(clientX, clientY);
    for (const e of els) {
      let el: Element | null = e;
      while (el) {
        const id = (el as HTMLElement).dataset?.noteId;
        if (id && id !== excludeId) return id;
        el = el.parentElement;
      }
    }
    return null;
  }, []);

  const startDragNote = (e: React.PointerEvent, note: Note) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = boardPoint(e.clientX, e.clientY);
    dragOffset.current = { dx: p.x - note.x, dy: p.y - note.y };
    setDraggingId(note.id);
  };

  const onNotePointerMove = (e: React.PointerEvent, note: Note) => {
    if (draggingId !== note.id) return;
    const p = boardPoint(e.clientX, e.clientY);
    setNotes((prev) =>
      prev.map((n) =>
        n.id === note.id
          ? { ...n, x: p.x - dragOffset.current.dx, y: p.y - dragOffset.current.dy }
          : n
      )
    );
  };

  const endDragNote = (e: React.PointerEvent, note: Note) => {
    if (draggingId !== note.id) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (isOverTrash(e.clientX, e.clientY)) {
      stopBell(note.id);
      setNotes((prev) => prev.filter((n) => n.id !== note.id));
      setConnections((prev) => prev.filter((c) => c.fromId !== note.id && c.toId !== note.id));
      setTrashedNotes((prev) => [
        ...prev,
        {
          ...note,
          timerEndMs: null,
          timerRinging: false,
        },
      ]);
    }
    setDraggingId(null);
  };

  const startConnect = (e: React.PointerEvent, note: Note) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const p = boardPoint(e.clientX, e.clientY);
    const x1 = note.x + NOTE_W;
    const y1 = note.y + NOTE_H / 2;
    setConnectFrom(note.id);
    setWirePreview({ x1, y1, x2: p.x, y2: p.y });
  };

  const onConnectPointerMove = (e: React.PointerEvent) => {
    if (!connectFrom) return;
    const p = boardPoint(e.clientX, e.clientY);
    const from = noteMap.get(connectFrom);
    if (!from) return;
    setWirePreview({
      x1: from.x + NOTE_W,
      y1: from.y + NOTE_H / 2,
      x2: p.x,
      y2: p.y,
    });
  };

  const endConnect = (e: React.PointerEvent) => {
    if (!connectFrom) return;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const targetId = findNoteIdAtPoint(e.clientX, e.clientY, connectFrom);
    if (targetId) {
      setConnections((prev) => {
        const exists = prev.some(
          (c) =>
            (c.fromId === connectFrom && c.toId === targetId) ||
            (c.fromId === targetId && c.toId === connectFrom)
        );
        if (exists) return prev;
        return [...prev, { id: uid(), fromId: connectFrom, toId: targetId }];
      });
    }
    setConnectFrom(null);
    setWirePreview(null);
  };

  const addNote = () => {
    setNotes((prev) => {
      const shell = boardRef.current;
      let x = 120 + (prev.length % 5) * 40;
      let y = 100 + (prev.length % 3) * 48;
      if (shell) {
        const br = shell.getBoundingClientRect();
        const center = boardPoint(br.left + br.width / 2, br.top + br.height / 2);
        x = Math.round(center.x - NOTE_W / 2 + (prev.length % 7) * 12);
        y = Math.round(center.y - NOTE_H / 3 + ((prev.length % 4) * 14));
      }
      return [
        ...prev,
        {
          id: uid(),
          x,
          y,
          text: "",
          colorIndex: prev.length % notePalette.length,
          timerEndMs: null,
          timerRinging: false,
          taskDone: false,
        },
      ];
    });
  };

  const updateNoteText = (id: string, text: string) => {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, text } : n)));
  };

  const wireElements = useMemo(() => {
    const list: JSX.Element[] = [];
    for (const c of connections) {
      const a = noteMap.get(c.fromId);
      const b = noteMap.get(c.toId);
      if (!a || !b) continue;
      const x1 = a.x + NOTE_W;
      const y1 = a.y + NOTE_H / 2;
      const x2 = b.x;
      const y2 = b.y + NOTE_H / 2;
      list.push(
        <path
          key={c.id}
          d={curvePath(x1, y1, x2, y2)}
          className="wire"
          fill="none"
          stroke={wireColor}
          strokeOpacity={0.72}
        />
      );
    }
    if (wirePreview) {
      list.push(
        <path
          key="preview"
          d={curvePath(wirePreview.x1, wirePreview.y1, wirePreview.x2, wirePreview.y2)}
          className="wire wire-preview"
          fill="none"
          stroke={wirePreviewColor}
          strokeOpacity={0.92}
        />
      );
    }
    return list;
  }, [connections, noteMap, wirePreview, wireColor, wirePreviewColor]);

  const currentTrack = tracks[currentTrackIndex];

  useEffect(() => {
    const a = audioRef.current;
    if (!a || !currentTrack) return;
    a.src = currentTrack.url;
    if (isPlaying) void a.play().catch(() => setIsPlaying(false));
  }, [currentTrack, currentTrack?.url]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (isPlaying) void a.play().catch(() => setIsPlaying(false));
    else a.pause();
  }, [isPlaying]);

  const onAudioEnded = () => {
    if (tracks.length === 0) return;
    setCurrentTrackIndex((i) => (i + 1) % tracks.length);
    setIsPlaying(true);
  };

  const addSongs = async (files: FileList | null) => {
    if (!files?.length) return;
    const next: Track[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("audio/")) continue;
      const { title, artist } = await readTrackMeta(file);
      const url = URL.createObjectURL(file);
      trackUrlsRef.current.add(url);
      next.push({
        id: uid(),
        url,
        title,
        artist,
        file,
      });
    }
    if (!next.length) return;
    setTracks((prev) => {
      const merged = [...prev, ...next];
      if (prev.length === 0) setCurrentTrackIndex(0);
      return merged;
    });
  };

  useEffect(() => {
    const urls = trackUrlsRef.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.clear();
    };
  }, []);

  const skip = (delta: number) => {
    if (tracks.length === 0) return;
    setCurrentTrackIndex((i) => (i + delta + tracks.length) % tracks.length);
    setIsPlaying(true);
  };

  const emptyTrashPermanently = () => {
    const ok = window.confirm(
      "Warning: All notes in the trash will be permanently deleted. This cannot be undone.\n\nDo you want to empty the trash now?"
    );
    if (!ok) return;
    setTrashedNotes([]);
    setTrashModalOpen(false);
  };

  const restoreNote = (note: Note) => {
    setTrashedNotes((prev) => prev.filter((n) => n.id !== note.id));
    setNotes((prev) => [...prev, note]);
  };

  const timerDialogNote = useMemo(
    () => (timerDialog ? notes.find((n) => n.id === timerDialog.noteId) : undefined),
    [notes, timerDialog],
  );

  useEffect(() => {
    if (timerDialog?.noteId) setDurationDraft(emptyDurationDraft());
  }, [timerDialog?.noteId]);

  const startNoteTimerFromMs = (noteId: string, msRaw: number) => {
    const ms = Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, Math.round(msRaw)));
    stopBell(noteId);
    setNotes((prev) =>
      prev.map((n) =>
        n.id === noteId ? { ...n, timerEndMs: Date.now() + ms, timerRinging: false, taskDone: false } : n
      )
    );
    setTimerDialog(null);
  };

  /** Add milliseconds (running: add after deadline; ringing: new countdown from now). */
  const extendNoteByMs = (noteId: string, addMsRaw: number) => {
    const addMs = Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, Math.round(addMsRaw)));
    stopBell(noteId);
    const now = Date.now();
    setNotes((prev) =>
      prev.map((n) => {
        if (n.id !== noteId) return n;
        if (n.timerRinging) {
          return { ...n, timerRinging: false, timerEndMs: now + addMs, taskDone: false };
        }
        const end = n.timerEndMs != null ? n.timerEndMs + addMs : now + addMs;
        return { ...n, timerRinging: false, timerEndMs: end, taskDone: false };
      })
    );
    setTimerDialog(null);
  };

  const cancelNoteTimer = (noteId: string) => {
    stopBell(noteId);
    setNotes((prev) =>
      prev.map((n) => (n.id === noteId ? { ...n, timerEndMs: null, timerRinging: false } : n))
    );
    setTimerDialog(null);
  };

  const markNoteTaskFinished = (noteId: string) => {
    stopBell(noteId);
    setNotes((prev) =>
      prev.map((n) =>
        n.id === noteId ? { ...n, timerEndMs: null, timerRinging: false, taskDone: true } : n
      )
    );
    setTimerDialog(null);
  };

  const openTimerForNote = (note: Note) => {
    stopBell(note.id);
    let view: TimerDialogState["view"] = "pick";
    if (note.timerRinging) view = "ringing";
    else if (note.timerEndMs != null && nowMs < note.timerEndMs) view = "running";
    setTimerDialog({ noteId: note.id, view });
  };

  const timerExtendGoBack = () => {
    if (!timerDialog) return;
    const n = timerDialogNote;
    if (!n) {
      setTimerDialog(null);
      return;
    }
    if (n.timerRinging) setTimerDialog({ noteId: n.id, view: "ringing" });
    else if (n.timerEndMs != null && nowMs < n.timerEndMs) setTimerDialog({ noteId: n.id, view: "running" });
    else setTimerDialog({ noteId: n.id, view: "pick" });
  };

  const showStarOverlay = !customBackgroundUrl || starsOnCustomBg;

  return (
    <div className="app">
      <header className="clock-bar" aria-label={`Local time, ${tzName}`}>
        <time className="clock-time" dateTime={new Date(nowMs).toISOString()}>
          {timeStr}
        </time>
        <span className="clock-meta">
          <span className="clock-date">{dateStr}</span>
          {tzName ? <span className="clock-tz">{tzName}</span> : null}
        </span>
      </header>

      <div
        id="board-shell"
        className="board board-shell"
        ref={boardRef}
        onPointerDown={onBoardShellPointerDown}
        onPointerMove={onBoardShellPointerMove}
        onPointerUp={onBoardShellPointerEnd}
        onPointerCancel={onBoardShellPointerEnd}
        onAuxClick={(e) => {
          if (e.button === 1) e.preventDefault();
        }}
      >
        <div
          className="board-viewport"
          style={{
            transform: `translate(${viewport.pan.x}px, ${viewport.pan.y}px) scale(${viewport.scale})`,
            transformOrigin: "0 0",
          }}
        >
          <div className="board-backdrop" aria-hidden>
            <div
              className="board-world-sheet"
              style={{
                position: "absolute",
                left: WORLD_MIN,
                top: WORLD_MIN,
                width: WORLD_SPAN,
                height: WORLD_SPAN,
              }}
            >
              {customBackgroundUrl && (
                <div
                  className="board-custom-bg board-custom-bg--tiled"
                  style={{ backgroundImage: `url(${customBackgroundUrl})` }}
                />
              )}
              <div className={`board-night-fall ${customBackgroundUrl ? "has-image" : ""}`} />
              <div className={`board-stars-layer ${showStarOverlay ? "stars-on" : "stars-off"}`}>
                <div className="board-stars board-stars-a board-stars--tiled" />
                <div className="board-stars board-stars-b board-stars--tiled" />
              </div>
              <div className="board-vignette" />
            </div>
          </div>

          <svg
            className="wire-layer"
            aria-hidden
            preserveAspectRatio="none"
            viewBox={`${WORLD_MIN} ${WORLD_MIN} ${WORLD_SPAN} ${WORLD_SPAN}`}
            style={{
              position: "absolute",
              left: WORLD_MIN,
              top: WORLD_MIN,
              width: WORLD_SPAN,
              height: WORLD_SPAN,
            }}
          >
            {wireElements}
          </svg>

          {notes.map((note, idx) => (
          <article
            key={note.id}
            className={`note${note.taskDone ? " note--done" : ""}${note.timerRinging ? " note--timer-ringing" : ""}`}
            data-note-id={note.id}
            style={{
              left: note.x,
              top: note.y,
              backgroundColor: notePalette[note.colorIndex % notePalette.length],
              zIndex: draggingId === note.id ? 20 : 10,
              transform: `rotate(${idx % 2 === 0 ? -0.8 : 0.6}deg)`,
            }}
          >
            <div
              className="note-pin-bar"
              onPointerDown={(e) => startDragNote(e, note)}
              onPointerMove={(e) => onNotePointerMove(e, note)}
              onPointerUp={(e) => endDragNote(e, note)}
              onPointerCancel={(e) => endDragNote(e, note)}
            >
              <span className="tack" aria-hidden />
              <span className="note-pin-label">drag</span>
            </div>
            <textarea
              className="note-body"
              value={note.text}
              onChange={(e) => updateNoteText(note.id, e.target.value)}
              placeholder="Write a task…"
              rows={4}
            />
            <div className="note-timer-footer" onPointerDown={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="note-timer-chip"
                onClick={() => openTimerForNote(note)}
                aria-label={
                  note.timerRinging
                    ? "Timer finished — open options"
                    : note.timerEndMs
                      ? "Timer — tap to change"
                      : "Set a countdown timer"
                }
              >
                <span className="note-timer-icon" aria-hidden>
                  ⏱
                </span>
                <span className="note-timer-digits">
                  {formatCountdownMs(note.timerEndMs, note.timerRinging, nowMs)}
                </span>
              </button>
              {note.timerRinging ? (
                <span className="note-timer-pulse-hint">Tap • done or extend?</span>
              ) : null}
            </div>
            <button
              type="button"
              className="eyelet eyelet-out"
              title="Drag to another note to connect"
              aria-label="Connect to another note"
              onPointerDown={(e) => startConnect(e, note)}
              onPointerMove={onConnectPointerMove}
              onPointerUp={endConnect}
              onPointerCancel={endConnect}
            />
          </article>
        ))}
        </div>

        <div className="board-bottom-left-stack">
          <div className="board-view-hud" role="toolbar" aria-label="Board zoom">
            <div className="board-view-hud-zoom">
              <button
                type="button"
                className="btn hud-zoom-step"
                aria-label="Zoom out"
                onClick={() => zoomBoardAtCenter(1 / 1.18)}
              >
                −
              </button>
              <span className="hud-zoom-label">{Math.round(viewport.scale * 100)}%</span>
              <button type="button" className="btn hud-zoom-step" aria-label="Zoom in" onClick={() => zoomBoardAtCenter(1.18)}>
                +
              </button>
            </div>
            <button type="button" className="btn hud-reset-view" onClick={resetBoardView}>
              Reset view
            </button>
          </div>

          <aside className="board-pan-help" aria-live="polite">
            Scroll wheel pans • Hold <kbd>Ctrl</kbd> and scroll to zoom (pinch expands here too) •{" "}
            <kbd>Alt</kbd>&thinsp;+&thinsp;drag or middle&thinsp;mouse&thinsp;drag to pan the board • Stars and uploaded
            wallpaper tile across an enormous workspace
          </aside>
        </div>

        <div className="toolbar-left">
          <input
            ref={bgImageInputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              setCustomBackgroundFromFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <div className="toolbar-buttons">
            <button
              type="button"
              ref={settingsBtnRef}
              className={`btn ghost settings-trigger ${settingsOpen ? "active" : ""}`}
              aria-expanded={settingsOpen}
              aria-controls="appearance-panel"
              onClick={() => setSettingsOpen((o) => !o)}
            >
              ⚙ Appearance
            </button>
            <button type="button" className="btn primary" onClick={addNote}>
              + New note
            </button>
          </div>
          {settingsOpen && (
            <div
              id="appearance-panel"
              ref={settingsPanelRef}
              className="settings-panel"
              role="region"
              aria-label="Appearance settings"
            >
              <h3 className="settings-heading">Post-it colors</h3>
              <p className="settings-desc">New notes cycle through this palette. Edit or add swatches.</p>
              <ul className="palette-editor">
                {notePalette.map((c, idx) => (
                  <li key={idx} className="palette-editor-row">
                    <label className="sr-only" htmlFor={`palette-${idx}`}>
                      Color {idx + 1}
                    </label>
                    <input
                      id={`palette-${idx}`}
                      type="color"
                      className="color-swatch-input"
                      value={/^#[0-9a-fA-F]{6}$/.test(c) ? c : "#ffffff"}
                      onChange={(e) => updatePaletteColorAt(idx, e.target.value)}
                    />
                    <span className="palette-hex mono">{/^#[0-9a-fA-F]{6}$/.test(c) ? c : "#…"}</span>
                    <button
                      type="button"
                      className="btn small btn-remove-swatch"
                      disabled={notePalette.length <= MIN_PALETTE_SIZE}
                      onClick={() => removePaletteColor(idx)}
                      title={
                        notePalette.length <= MIN_PALETTE_SIZE
                          ? `Keep at least ${MIN_PALETTE_SIZE} colors`
                          : "Remove swatch"
                      }
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" className="btn ghost settings-row-btn" onClick={addPaletteColor}>
                + Add color
              </button>

              <h3 className="settings-heading">Connection wires</h3>
              <div className="settings-row-two">
                <label className="color-field">
                  <span>Wires</span>
                  <input
                    type="color"
                    value={wireColor}
                    onChange={(e) => setWireColor(e.target.value)}
                  />
                </label>
                <label className="color-field">
                  <span>While linking</span>
                  <input
                    type="color"
                    value={wirePreviewColor}
                    onChange={(e) => setWirePreviewColor(e.target.value)}
                  />
                </label>
              </div>

              <h3 className="settings-heading">Background</h3>
              <p className="settings-desc">
                Star field covers a huge roamable plane. Uploaded images repeat as wallpaper tiles—you can zoom or pan anywhere on the canvas.
              </p>
              <div className="settings-bg-actions">
                <button type="button" className="btn ghost" onClick={() => bgImageInputRef.current?.click()}>
                  Upload image…
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={!customBackgroundUrl}
                  onClick={clearCustomBackground}
                >
                  Remove image
                </button>
              </div>
              <label className="settings-checkbox">
                <input
                  type="checkbox"
                  checked={starsOnCustomBg}
                  disabled={!customBackgroundUrl}
                  onChange={(e) => setStarsOnCustomBg(e.target.checked)}
                />
                <span>Show star overlay on custom image</span>
              </label>

              <div className="settings-footer">
                <button type="button" className="btn small" onClick={resetAppearanceDefaults}>
                  Reset defaults
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="music-dock" role="region" aria-label="Music player">
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          multiple
          className="sr-only"
          onChange={(e) => {
            void addSongs(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className="btn ghost btn-add-tracks"
          onClick={() => fileInputRef.current?.click()}
        >
          Load songs
        </button>
        <div className="now-playing">
          <div className="np-title">{currentTrack?.title ?? "No track"}</div>
          <div className="np-artist">{currentTrack?.artist ?? "Add audio from your device"}</div>
        </div>
        <div className="transport">
          <button
            type="button"
            className="icon-btn"
            aria-label="Previous track"
            disabled={tracks.length === 0}
            onClick={() => skip(-1)}
          >
            ⏮
          </button>
          <button
            type="button"
            className="icon-btn main"
            aria-label={isPlaying ? "Pause" : "Play"}
            disabled={tracks.length === 0}
            onClick={() => setIsPlaying((p) => !p)}
          >
            {isPlaying ? "⏸" : "▶"}
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Next track"
            disabled={tracks.length === 0}
            onClick={() => skip(1)}
          >
            ⏭
          </button>
        </div>
        <audio ref={audioRef} onEnded={onAudioEnded} />
      </div>

      {timerDialog && timerDialogNote && (
        <div
          className="modal-backdrop timer-dialog-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="timer-dialog-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setTimerDialog(null);
          }}
        >
          <div className="modal timer-dialog">
            {(() => {
              const nid = timerDialog.noteId;
              const v = timerDialog.view;
              const preview = timerDialogNote.text.trim() || "(empty note)";
              if (v === "pick") {
                return (
                  <>
                    <h2 id="timer-dialog-title">Set countdown</h2>
                    <p className="modal-hint">
                      Starts from now using your computer&apos;s local clock ({tzName || "your time zone"}). When time
                      is up you will hear a light bell repeating five times—you can tap the note&apos;s timer at any time
                      to stop the ringing and choose what&apos;s next.
                    </p>
                    <blockquote className="timer-task-quote">{preview}</blockquote>
                    <p className="modal-hint-small">Quick durations</p>
                    <div className="timer-preset-grid timer-preset-grid-dense">
                      {TIMER_PRESETS.map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          className="btn primary"
                          onClick={() => startNoteTimerFromMs(nid, preset.ms)}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                    <p className="modal-hint-small">
                      Custom: days + hours + minutes + seconds (at least{" "}
                      <strong>{MIN_DURATION_MS / 1000}s</strong>, maximum about one year)
                    </p>
                    <DurationFields draft={durationDraft} onDraftChange={setDurationDraft} idSuffix="pick" />
                    <button
                      type="button"
                      className="btn primary timer-start-draft"
                      onClick={() => {
                        const ms = draftToMs(durationDraft);
                        if (ms != null) startNoteTimerFromMs(nid, ms);
                      }}
                    >
                      Start with custom duration
                    </button>
                    <button type="button" className="btn ghost timer-close-wide" onClick={() => setTimerDialog(null)}>
                      Close
                    </button>
                  </>
                );
              }
              if (v === "running") {
                return (
                  <>
                    <h2 id="timer-dialog-title">Timer active</h2>
                    <p className="modal-hint">
                      Ends in&nbsp;
                      <strong>{formatCountdownMs(timerDialogNote.timerEndMs, false, nowMs)}</strong>
                    </p>
                    <blockquote className="timer-task-quote">{preview}</blockquote>
                    <div className="timer-dialog-actions-stack">
                      <button
                        type="button"
                        className="btn primary"
                        onClick={() => setTimerDialog({ noteId: nid, view: "extend" })}
                      >
                        Extend time…
                      </button>
                      <button type="button" className="btn ghost" onClick={() => cancelNoteTimer(nid)}>
                        Cancel timer
                      </button>
                      <button type="button" className="btn ghost" onClick={() => setTimerDialog(null)}>
                        Close
                      </button>
                    </div>
                  </>
                );
              }
              if (v === "ringing") {
                return (
                  <>
                    <h2 id="timer-dialog-title">Time&apos;s up</h2>
                    <p className="modal-hint">
                      The bell repeats until you tap the timer—or choose an option here. Did you finish this task?
                    </p>
                    <blockquote className="timer-task-quote">{preview}</blockquote>
                    <div className="timer-dialog-actions-stack">
                      <button type="button" className="btn primary" onClick={() => markNoteTaskFinished(nid)}>
                        Yes, I finished it
                      </button>
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => setTimerDialog({ noteId: nid, view: "extend" })}
                      >
                        Extend time…
                      </button>
                    </div>
                  </>
                );
              }
              return (
                <>
                  <h2 id="timer-dialog-title">Add time</h2>
                  <p className="modal-hint">Add more clock time before the next reminder.</p>
                  <blockquote className="timer-task-quote">{preview}</blockquote>
                  <button type="button" className="btn ghost timer-back-row" onClick={timerExtendGoBack}>
                    ← Back
                  </button>
                  <p className="modal-hint-small">Quick amounts</p>
                  <div className="timer-preset-grid timer-preset-grid-dense">
                    {TIMER_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        className="btn primary"
                        onClick={() => extendNoteByMs(nid, preset.ms)}
                      >
                        +&nbsp;{preset.label.toLowerCase()}
                      </button>
                    ))}
                  </div>
                  <p className="modal-hint-small">Custom increment (days · hours · min · sec)</p>
                  <DurationFields draft={durationDraft} onDraftChange={setDurationDraft} idSuffix="extend" />
                  <button
                    type="button"
                    className="btn primary timer-start-draft"
                    onClick={() => {
                      const ms = draftToMs(durationDraft);
                      if (ms != null) extendNoteByMs(nid, ms);
                    }}
                  >
                    Add custom duration
                  </button>
                  <button type="button" className="btn ghost timer-close-wide" onClick={() => setTimerDialog(null)}>
                    Close
                  </button>
                </>
              );
            })()}
          </div>
        </div>
      )}

      <div
        ref={trashRef}
        className="trash-bin"
        title="Drop notes here to remove. Double-click to open trash."
        onDoubleClick={(e) => {
          e.preventDefault();
          setTrashModalOpen(true);
        }}
      >
        <span className="trash-icon" aria-hidden>
          🗑
        </span>
        <span className="trash-label">Trash</span>
      </div>

      {trashModalOpen && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="trash-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setTrashModalOpen(false);
          }}
        >
          <div className="modal">
            <h2 id="trash-title">Trash</h2>
            <p className="modal-hint">Drag notes onto the bin to move them here. Restore or delete forever.</p>
            <ul className="trash-list">
              {trashedNotes.length === 0 ? (
                <li className="muted">The trash is empty.</li>
              ) : (
                trashedNotes.map((n) => (
                  <li key={n.id} className="trash-item">
                    <span
                      className="trash-swatch"
                      style={{
                        backgroundColor: notePalette[n.colorIndex % notePalette.length],
                      }}
                    />
                    <span className="trash-snippet">{n.text.trim() || "(empty note)"}</span>
                    <button type="button" className="btn small" onClick={() => restoreNote(n)}>
                      Restore
                    </button>
                  </li>
                ))
              )}
            </ul>
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setTrashModalOpen(false)}>
                Close
              </button>
              <button
                type="button"
                className="btn danger"
                disabled={trashedNotes.length === 0}
                onClick={emptyTrashPermanently}
              >
                Delete permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
