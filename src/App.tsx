import type { JSX } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseBlob } from "music-metadata";
import "./App.css";

const NOTE_W = 200;
const NOTE_H = 140;

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
    },
    {
      id: uid(),
      x: 400,
      y: 220,
      text: "Drop a note on the trash to remove it (recoverable).",
      colorIndex: 2,
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
    const board = boardRef.current;
    if (!board) return { x: clientX, y: clientY };
    const r = board.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }, []);

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
          ? { ...n, x: Math.max(0, p.x - dragOffset.current.dx), y: Math.max(0, p.y - dragOffset.current.dy) }
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
      setNotes((prev) => prev.filter((n) => n.id !== note.id));
      setConnections((prev) => prev.filter((c) => c.fromId !== note.id && c.toId !== note.id));
      setTrashedNotes((prev) => [...prev, note]);
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
    setNotes((prev) => [
      ...prev,
      {
        id: uid(),
        x: 80 + (prev.length % 5) * 40,
        y: 80 + (prev.length % 3) * 50,
        text: "",
        colorIndex: prev.length % notePalette.length,
      },
    ]);
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

  const showStarOverlay = !customBackgroundUrl || starsOnCustomBg;

  return (
    <div className="app">
      <div className="board" ref={boardRef}>
        <div className="board-backdrop" aria-hidden>
          {customBackgroundUrl && (
            <div
              className="board-custom-bg"
              style={{ backgroundImage: `url(${customBackgroundUrl})` }}
            />
          )}
          <div className={`board-night-fall ${customBackgroundUrl ? "has-image" : ""}`} />
          <div className={`board-stars-layer ${showStarOverlay ? "stars-on" : "stars-off"}`}>
            <div className="board-stars board-stars-a" />
            <div className="board-stars board-stars-b" />
          </div>
          <div className="board-vignette" />
        </div>

        <svg className="wire-layer" aria-hidden>
          {wireElements}
        </svg>

        {notes.map((note, idx) => (
          <article
            key={note.id}
            className="note"
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
                Choose a sky full of stars, or add your own image (&ldquo;cover&rdquo; style).
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
