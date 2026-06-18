// Celebration feedback for the habit builder: a subtle Web Audio chime (works in
// the app's WebView immediately) plus a native haptic (fires only inside the app
// once @capacitor/haptics is compiled in via `npx cap sync ios` + a build).
// Every call is a safe no-op where unsupported, so this is harmless on the web.

let audioCtx: AudioContext | null = null;

function ctx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!audioCtx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    return audioCtx;
  } catch {
    return null;
  }
}

// Call from a real user gesture (e.g. the checkpoint tap) so iOS lets us play
// audio a beat later when the confirmation lands.
export function unlockAudio() {
  const c = ctx();
  if (c && c.state === "suspended") c.resume().catch(() => {});
}

// A warm, instrument-like note instead of a bare sine: a slightly detuned
// fundamental pair (for chorus warmth) plus a few overtones that decay faster
// (a glockenspiel/mallet feel), so it reads as a real chime, not a toy beep.
function voice(c: AudioContext, dest: AudioNode, freq: number, startAt: number, dur: number, peak: number, attack = 0.012) {
  const partials = [
    { mult: 1,    g: 0.85, d: 1.0,  detune: -4 },
    { mult: 1,    g: 0.45, d: 1.0,  detune: 5 },
    { mult: 2,    g: 0.32, d: 0.6,  detune: 0 },
    { mult: 3.01, g: 0.14, d: 0.45, detune: 0 },
    { mult: 4.2,  g: 0.05, d: 0.38, detune: 0 },
  ];
  for (const p of partials) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = freq * p.mult;
    if (p.detune) osc.detune.value = p.detune;
    const pk = peak * p.g;
    const d = dur * p.d;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.linearRampToValueAtTime(pk, startAt + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + d);
    osc.connect(gain).connect(dest);
    osc.start(startAt);
    osc.stop(startAt + d + 0.03);
  }
}

function playChime(kind: "daily" | "built") {
  const c = ctx();
  if (!c) return;
  if (c.state === "suspended") c.resume().catch(() => {});
  const t = c.currentTime + 0.01;
  // Shared output chain: a gentle lowpass rounds off the highs so nothing
  // sounds brittle or digital.
  const master = c.createGain();
  master.gain.value = 0.6;
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 6200;
  lp.Q.value = 0.2;
  master.connect(lp).connect(c.destination);

  // Shared satisfying base: a low root for body under an ascending triad, with a
  // sparkle that rings out. Used as-is for daily completions.
  voice(c, master, 261.63, t, 1.0, 0.10, 0.02);   // C4 — root / body
  voice(c, master, 523.25, t, 0.72, 0.13);         // C5
  voice(c, master, 659.25, t + 0.09, 0.72, 0.13);  // E5
  voice(c, master, 783.99, t + 0.18, 0.9, 0.13);   // G5
  voice(c, master, 1046.5, t + 0.30, 1.15, 0.10);  // C6 — sparkle, rings longer
  if (kind === "daily") {
    // A friendly extra higher note to end on — a little upward lift.
    voice(c, master, 1318.51, t + 0.42, 0.95, 0.09); // E6
  } else {
    // Grander finale: a deeper octave swell for weight, and the arpeggio keeps
    // climbing to a higher shimmer that rings out — same family, bigger moment.
    voice(c, master, 130.81, t, 1.5, 0.09, 0.03);     // C3 — deep swell / weight
    voice(c, master, 1318.51, t + 0.42, 1.3, 0.085);  // E6 — higher reach
    voice(c, master, 1567.98, t + 0.54, 1.6, 0.07);   // G6 — final shimmer
  }
}

// Native haptics via the Capacitor bridge global — undefined (no-op) until the
// plugin is compiled into the app, so this never breaks the web build.
function nativeHaptics(): { impact?: (o: { style: string }) => void; notification?: (o: { type: string }) => void } | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { Capacitor?: { Plugins?: { Haptics?: never } } }).Capacitor?.Plugins?.Haptics ?? null;
}

export function celebrateDaily() {
  try { nativeHaptics()?.impact?.({ style: "MEDIUM" }); } catch { /* no-op */ }
  playChime("daily");
}

export function celebrateBuilt() {
  try { nativeHaptics()?.notification?.({ type: "SUCCESS" }); } catch { /* no-op */ }
  playChime("built");
}
