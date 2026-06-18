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

// A short synthesized reverb (decaying noise impulse) to glue the notes into
// one cohesive sound instead of separate plucks.
function makeReverb(c: AudioContext, seconds = 1.3, decay = 3): ConvolverNode {
  const rate = c.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buf = c.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  const conv = c.createConvolver();
  conv.buffer = buf;
  return conv;
}

function playChime(kind: "daily" | "built") {
  const c = ctx();
  if (!c) return;
  if (c.state === "suspended") c.resume().catch(() => {});
  const t = c.currentTime + 0.01;
  // Shared bus → dry path (gentle lowpass) plus a wet reverb tail that ties the
  // notes together into one sound instead of separate plucks.
  const bus = c.createGain();
  bus.gain.value = 0.6;
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 3800;
  lp.Q.value = 0.2;
  bus.connect(lp).connect(c.destination);
  const wet = c.createGain();
  wet.gain.value = 0.32;
  bus.connect(makeReverb(c)).connect(wet).connect(c.destination);

  // Lower, warm, grounded. Notes are rolled tightly and sustain well past their
  // onset so they overlap and bloom into one held chord rather than a sequence.
  voice(c, bus, 130.81, t, 1.8, 0.09, 0.02);          // C3 — low root / body
  voice(c, bus, 523.25, t, 1.5, 0.11, 0.025);         // C5
  voice(c, bus, 659.25, t + 0.07, 1.5, 0.11, 0.025);  // E5
  voice(c, bus, 783.99, t + 0.14, 1.6, 0.11, 0.025);  // G5
  voice(c, bus, 1046.5, t + 0.23, 1.9, 0.11, 0.03);   // C6 — resolves to the tonic, rings
  if (kind === "daily") {
    // A friendly extra higher note to end on — a gentle upward lift.
    voice(c, bus, 1318.51, t + 0.33, 1.7, 0.09, 0.035); // E6
  } else {
    // Grander finale: a deeper octave swell for weight, and the arpeggio keeps
    // climbing then lands back on the tonic up high and rings out longer.
    voice(c, bus, 65.41, t, 2.8, 0.08, 0.03);           // C2 — deep swell / weight
    voice(c, bus, 1318.51, t + 0.33, 1.9, 0.09, 0.035); // E6 — higher reach
    voice(c, bus, 1567.98, t + 0.48, 2.1, 0.08, 0.04);  // G6 — climb
    voice(c, bus, 1046.5, t + 0.66, 3.0, 0.085, 0.05);  // C6 — lands on the tonic, rings out
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
