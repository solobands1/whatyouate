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

// One soft, bell-like sine tone. A longer `attack` rounds off the front so it
// blooms in rather than pinging like a notification.
function tone(c: AudioContext, freq: number, startAt: number, dur: number, peak: number, attack = 0.012) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.linearRampToValueAtTime(peak, startAt + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(startAt);
  osc.stop(startAt + dur + 0.03);
}

function playChime(kind: "daily" | "built") {
  const c = ctx();
  if (!c) return;
  if (c.state === "suspended") c.resume().catch(() => {});
  const t = c.currentTime + 0.01;
  if (kind === "daily") {
    // Warm, rounded lift instead of two bright pings: lower register, soft attack,
    // a low-end note for body, resolving up a fourth — satisfying, not a notification.
    tone(c, 196.0, t, 0.6, 0.05, 0.05);          // G3 — body
    tone(c, 392.0, t, 0.62, 0.10, 0.04);         // G4
    tone(c, 523.25, t + 0.09, 0.85, 0.10, 0.04); // C5 — resolves up a fourth
  } else {
    // Fuller and more satisfying: a low root for body under the ascending triad,
    // with a sparkle that rings out longer.
    tone(c, 261.63, t, 1.0, 0.08, 0.02);   // C4 — root / body
    tone(c, 523.25, t, 0.72, 0.11);        // C5
    tone(c, 659.25, t + 0.09, 0.72, 0.11); // E5
    tone(c, 783.99, t + 0.18, 0.9, 0.11);  // G5
    tone(c, 1046.5, t + 0.30, 1.15, 0.09); // C6 — sparkle, rings longer
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
