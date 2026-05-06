let ctxRef: AudioContext | null = null;

function ctx(): AudioContext {
  if (!ctxRef) ctxRef = new AudioContext();
  return ctxRef;
}

async function resume(c: AudioContext) {
  if (c.state === "suspended") await c.resume();
}

/** Short two-tone chime — light “desk bell” feel. Safe to call repeatedly (e.g. stacked timers). */
export async function playLightBell() {
  const ac = ctx();
  await resume(ac);
  const t0 = ac.currentTime;
  const out = ac.createGain();
  out.gain.setValueAtTime(0, t0);
  out.gain.linearRampToValueAtTime(0.14, t0 + 0.015);
  out.gain.exponentialRampToValueAtTime(0.001, t0 + 1.25);
  out.connect(ac.destination);

  const tone = (freq: number, start: number, dur: number) => {
    const o = ac.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(freq, start);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(1, start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.008, start + dur);
    o.connect(g);
    g.connect(out);
    o.start(start);
    o.stop(start + dur + 0.04);
  };

  tone(1318.51, t0, 0.35);
  tone(880, t0 + 0.16, 0.42);
}
