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
    { mult: 1,    g: 0.92, d: 1.0,  detune: -4 },
    { mult: 1,    g: 0.5,  d: 1.0,  detune: 6 },
    { mult: 2,    g: 0.22, d: 0.55, detune: 0 },
    { mult: 3.01, g: 0.07, d: 0.4,  detune: 0 },
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
  lp.frequency.value = 3800;
  lp.Q.value = 0.2;
  master.connect(lp).connect(c.destination);

  // Shared base, an octave lower than a typical UI ding so it lands warm and
  // grounded: a deep root for body under an ascending triad that resolves up to
  // the tonic and rings. Used as-is for daily completions.
  voice(c, master, 130.81, t, 1.1, 0.09, 0.02);    // C3 — root / body
  voice(c, master, 261.63, t, 0.7, 0.13);          // C4
  voice(c, master, 329.63, t + 0.09, 0.7, 0.13);   // E4
  voice(c, master, 392.0, t + 0.18, 0.85, 0.13);   // G4
  voice(c, master, 523.25, t + 0.30, 1.2, 0.12);   // C5 — resolves to the tonic, rings
  if (kind === "daily") {
    // A friendly extra higher note to end on — a gentle upward lift.
    voice(c, master, 659.25, t + 0.42, 1.0, 0.10);  // E5
  } else {
    // Grander finale: a deeper octave swell for weight, and the arpeggio keeps
    // climbing past the tonic and rings out — same family, bigger moment.
    voice(c, master, 65.41, t, 1.7, 0.08, 0.03);    // C2 — deep swell / weight
    voice(c, master, 659.25, t + 0.42, 1.3, 0.10);  // E5 — higher reach
    voice(c, master, 783.99, t + 0.54, 1.7, 0.085); // G5 — final climb, rings out
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
