import { playLightBell } from "./playBell";

const BELL_REPEATS = 5;
const BELL_GAP_MS = 820;

/** Manages sequential bell timeouts per note — cancel skips remaining repeats. */
export type BellRepeater = { cancel: () => void };

const sessions = new Map<string, BellRepeater>();

export function stopBell(noteId: string) {
  const s = sessions.get(noteId);
  if (s) {
    s.cancel();
    sessions.delete(noteId);
  }
}

/** Play the bell `repeats` times spaced by gapMs. Stop with stopBell. */
export function startBellRepeats(noteId: string, repeats = BELL_REPEATS, gapMs = BELL_GAP_MS): BellRepeater {
  stopBell(noteId);
  const timeouts: number[] = [];
  let aborted = false;
  const cancel = () => {
    if (aborted) return;
    aborted = true;
    timeouts.forEach((tid) => clearTimeout(tid));
    timeouts.length = 0;
    sessions.delete(noteId);
  };

  sessions.set(noteId, { cancel });

  for (let i = 0; i < repeats; i++) {
    const tid = window.setTimeout(() => {
      if (aborted) return;
      void playLightBell();
      if (i === repeats - 1) sessions.delete(noteId);
    }, i * gapMs);
    timeouts.push(tid);
  }

  return { cancel };
}
