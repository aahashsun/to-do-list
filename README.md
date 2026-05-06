# Infinite whiteboard todos

Post-it notes on a huge, pannable **world plane** — drag tasks around, wire them together, stash them in recoverable trash, set countdown timers with a repeating bell, and personalize the canvas with palettes, wallpapers, stars, optional music, and a live clock header.

Built with **React 19**, **TypeScript**, and **Vite 6**. There is **no backend**; everything stays in memory in the browser (refresh clears state unless you add persistence).


# Board navigation

- **Scroll wheel**: pans.
- **`Ctrl`** (or **`Cmd`**) **+ wheel**: zooms toward cursor; pinch zoom on trackpads behaves similarly inside the shell.
- **`Alt`** + drag, or **middle mouse** drag on the backdrop: pans the viewport.
- **Zoom HUD** (bottom-left cluster): − / zoom % / + / **Reset view**.

# Notes

- Grab the **thumb-tack strip** labeled “drag” to move a note (**left** mouse).
- **Bottom-right resize grip**: drag diagonally to grow or shrink; sizes are clamped to sensible min/max pixels and stay consistent with connectors.
- **`+ New note`** in the toolbar spawns near the viewport center with a slight stagger.

# Trash

- Hover/drag-over feedback on the bin while dragging a note.
- Single **click** the trash icon to open the list modal (no double‑click requirement).

# Timers & audio

- Per-note countdown from the timer chip → modal with presets or custom durations.
- On deadline: note enters **ringing** state; bell uses small modules (`playBell.ts`, `bellRepeats.ts`) for repeat scheduling/cancel.
- **Music dock**: load audio from your machine; playback uses the Web Audio/Media stack (tags read via **`music-metadata`** when available).

# Appearance & customization

- **Appearance** flyout (toolbar): editable post-it palette, wire colors (normal + preview while linking), **upload/remove** background image, toggle star overlay over custom images.

# Context menu (**right‑click`)

On the canvas or on a note (toolbar/HUD strips excluded):

- **New note here** at the pointer.
- On a note: **color**, **size** (presets + custom width/height), **move to trash**, **connect to…** (pick another note from a list).

# UI accents

- **Clock** banner (center top): date, time, and short timezone hint (read‑only overlay).


## License

This project is released under the **MIT License** — see [`LICENSE`](./LICENSE).


