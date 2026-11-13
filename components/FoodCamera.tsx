"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { shutterTap } from "../lib/celebrate";

// The in-app camera for meal photos, opened by every "Take A Photo" (the Log Food sheet, the first-meal
// step, Retake on the capture screen). It replaces the iOS system camera and its separate "Use Photo"
// step: a live rear-camera viewfinder via getUserMedia, one tap on the shutter, and the still goes
// straight to the capture screen, which already shows the photo full size with the hint field,
// Analyze and Retake. That screen is the review step, so there is no second one in here.
//
// The still is cut from the video at its own resolution, cropped to exactly what the viewfinder
// shows, and saved as a JPEG. The capture screen then compresses it the same way as any photo.
//
// Every way out stops the camera (close, shutter, library pick, unmount, the app going to the
// background), so the camera light never stays on. When the camera can't run, the panel says why
// and offers the library and the old system camera (a file input with `capture`).

export type FoodPhotoSource = "camera" | "library";

type Props = {
  open: boolean;
  onClose: () => void;
  // The photo, from the shutter, the library or the system-camera fallback. The camera has already
  // stopped and keeps showing the shot (or a spinner) until the parent closes or navigates away.
  onPhoto: (file: File, source: FoodPhotoSource) => void;
};

// False where getUserMedia doesn't exist at all (very old iOS, or a page served without https).
// Callers then go straight to the old file input with `capture` instead of opening this screen.
export function canUseInAppCamera(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function";
}

type Problem = "denied" | "none" | "busy" | "slow" | "stopped";
type Phase =
  | { name: "starting" }
  | { name: "live" }
  | { name: "handoff"; source: FoodPhotoSource }
  | { name: "problem"; problem: Problem };

// 4:3 at 1920 wide (1440x1920 held upright) where the phone offers it: plenty for food, and small
// enough to hand over quickly. These are ideals, so a camera without that size still opens.
const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: "environment",
  width: { ideal: 1920 },
  height: { ideal: 1440 },
};
// The same quality the old in-app capture used. The capture screen re-encodes at 0.8 (down to 0.6)
// at 800px for analysis, so this only needs to be clean, not small.
const JPEG_QUALITY = 0.9;
// From having a stream to its first frame. The wait for the permission prompt isn't counted.
const FIRST_FRAME_TIMEOUT_MS = 8000;
const VIEW_ASPECT = 3 / 4; // width / height of the viewfinder, held upright

function problemFor(err: unknown): Problem {
  const name = (err as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return "busy";
  return "none";
}

async function openRearCamera(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: false, video: VIDEO_CONSTRAINTS });
  } catch (err) {
    // Only ideals are asked for, so this shouldn't happen, but older WebKit has thrown on sizes.
    if ((err as { name?: string } | null)?.name !== "OverconstrainedError") throw err;
    return navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "environment" } });
  }
}

function isNativeApp(): boolean {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

export default function FoodCamera({ open, ...rest }: Props) {
  // Mounted only while open, so every open starts clean and closing always runs the cleanup.
  if (!open) return null;
  return <FoodCameraScreen {...rest} />;
}

function FoodCameraScreen({ onClose, onPhoto }: Omit<Props, "open">) {
  const areaRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const shotRef = useRef<HTMLCanvasElement | null>(null);
  const flashRef = useRef<HTMLDivElement | null>(null);
  const libraryRef = useRef<HTMLInputElement | null>(null);
  const systemRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Bumped by every start and stop, so a getUserMedia that resolves after the camera was closed (or
  // restarted) is stopped on arrival instead of switching the light back on.
  const genRef = useRef(0);
  const frameTimerRef = useRef<number | null>(null);
  const resumeOnShowRef = useRef(false);
  const restartsRef = useRef<number[]>([]);
  const busyRef = useRef(false);
  const [phase, setPhase] = useState<Phase>({ name: "starting" });
  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;
  const [torch, setTorch] = useState<{ supported: boolean; on: boolean }>({ supported: false, on: false });
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);

  const stopStream = useCallback(() => {
    genRef.current += 1;
    if (frameTimerRef.current != null) {
      window.clearTimeout(frameTimerRef.current);
      frameTimerRef.current = null;
    }
    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach((track) => {
      track.onended = null;
      try { track.stop(); } catch { /* already stopped */ }
    });
    const video = videoRef.current;
    if (video) {
      video.onloadeddata = null;
      video.onplaying = null;
      try { video.pause(); } catch { /* ignore */ }
      video.srcObject = null;
    }
    setTorch({ supported: false, on: false });
  }, []);

  const startStream = useCallback(async () => {
    stopStream();
    const gen = genRef.current;
    busyRef.current = false;
    setPhase({ name: "starting" });
    let stream: MediaStream;
    try {
      stream = await openRearCamera();
    } catch (err) {
      if (gen !== genRef.current) return;
      console.warn("[camera] getUserMedia failed", (err as { name?: string } | null)?.name ?? err);
      setPhase({ name: "problem", problem: problemFor(err) });
      return;
    }
    if (gen !== genRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    streamRef.current = stream;
    const track = stream.getVideoTracks()[0];
    if (track) {
      // iOS can end the track itself (a call comes in, another app takes the camera).
      track.onended = () => {
        if (gen !== genRef.current) return;
        if (document.visibilityState === "hidden") return; // the visibility handler restarts it
        const now = Date.now();
        restartsRef.current = [...restartsRef.current.filter((t) => now - t < 15_000), now];
        if (restartsRef.current.length > 2) {
          stopStream();
          setPhase({ name: "problem", problem: "stopped" });
        } else {
          void startStream();
        }
      };
      const caps = typeof track.getCapabilities === "function"
        ? (track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean })
        : null;
      setTorch({ supported: caps?.torch === true, on: false });
    }
    const video = videoRef.current;
    if (!video) return;
    video.muted = true;
    video.setAttribute("playsinline", "");
    video.srcObject = stream;
    frameTimerRef.current = window.setTimeout(() => {
      if (gen !== genRef.current) return;
      stopStream();
      setPhase({ name: "problem", problem: "slow" });
    }, FIRST_FRAME_TIMEOUT_MS);
    const markLive = () => {
      if (gen !== genRef.current || !video.videoWidth) return;
      if (frameTimerRef.current != null) {
        window.clearTimeout(frameTimerRef.current);
        frameTimerRef.current = null;
      }
      setPhase((p) => (p.name === "starting" ? { name: "live" } : p));
    };
    video.onloadeddata = markLive;
    video.onplaying = markLive;
    video.play().catch(() => { /* autoplay is allowed for a muted stream; loadeddata still fires */ });
  }, [stopStream]);

  // Start on open; stop on every way out.
  useEffect(() => {
    void startStream();
    return () => stopStream();
  }, [startStream, stopStream]);

  // The app going to the background: let go of the camera, and pick it up again on return.
  useEffect(() => {
    const suspend = () => {
      const name = phaseRef.current.name;
      if (name !== "live" && name !== "starting") return;
      resumeOnShowRef.current = true;
      stopStream();
      setPhase({ name: "starting" });
    };
    const resume = () => {
      if (!resumeOnShowRef.current || document.visibilityState === "hidden") return;
      resumeOnShowRef.current = false;
      if (phaseRef.current.name === "starting") void startStream();
    };
    const onVisibility = () => (document.visibilityState === "hidden" ? suspend() : resume());
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", suspend);
    window.addEventListener("pageshow", resume);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", suspend);
      window.removeEventListener("pageshow", resume);
    };
  }, [startStream, stopStream]);

  // A 3:4 viewfinder, as large as fits between the top and bottom bars.
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const measure = () => {
      const availW = area.clientWidth - 16;
      const availH = area.clientHeight;
      if (availW <= 0 || availH <= 0) return;
      // A multiple of 3 wide keeps it exactly 3:4, so a 4:3 stream is captured whole.
      const w = Math.floor(Math.min(availW, availH * VIEW_ASPECT) / 3) * 3;
      const next = { w, h: (w / 3) * 4 };
      setBox((prev) => (prev && prev.w === next.w && prev.h === next.h ? prev : next));
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(area);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const close = () => {
    if (phaseRef.current.name === "handoff") return; // the photo is already on its way
    stopStream();
    onClose();
  };

  const handOff = (file: File, source: FoodPhotoSource) => {
    stopStream();
    setPhase({ name: "handoff", source });
    onPhoto(file, source);
  };

  const takePhoto = async () => {
    const video = videoRef.current;
    const view = viewRef.current;
    const canvas = shotRef.current;
    if (busyRef.current || phaseRef.current.name !== "live" || !video || !view || !canvas) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;
    busyRef.current = true;
    shutterTap();
    flashRef.current?.animate?.([{ opacity: 0.85 }, { opacity: 0 }], { duration: 240, easing: "ease-out" });
    // Crop to what the viewfinder shows (the video is drawn object-cover), keeping the video's own
    // pixels: a 4:3 stream comes through whole, a 16:9 one loses its top and bottom.
    const target = view.clientWidth / view.clientHeight || VIEW_ASPECT;
    let sw = vw;
    let sh = vh;
    if (vw / vh > target) sw = Math.round(vh * target);
    else sh = Math.round(vw / target);
    const sx = Math.round((vw - sw) / 2);
    const sy = Math.round((vh - sh) / 2);
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      busyRef.current = false;
      return;
    }
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
    // Freeze on the shot (the canvas is shown in place of the video) while it's encoded.
    setPhase({ name: "handoff", source: "camera" });
    stopStream();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob) {
      // Couldn't encode (out of memory): back to the viewfinder rather than a dead end.
      void startStream();
      return;
    }
    onPhoto(new File([blob], `meal-${Date.now()}.jpg`, { type: "image/jpeg" }), "camera");
  };

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !torch.supported) return;
    const next = !torch.on;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorch((t) => ({ ...t, on: next }));
    } catch {
      setTorch({ supported: false, on: false });
    }
  };

  const pickFromLibrary = () => libraryRef.current?.click();
  const openSystemCamera = () => systemRef.current?.click();
  const openSettings = () => {
    // The native shell hands non-app URLs to iOS, and app-settings: opens this app's page in Settings.
    try { window.location.href = "app-settings:"; } catch { /* ignore */ }
  };

  const fileChosen = (source: FoodPhotoSource) => (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (file) handOff(file, source);
  };

  const live = phase.name === "live";
  const showShot = phase.name === "handoff" && phase.source === "camera";
  const showControls = phase.name === "starting" || phase.name === "live";
  const guide = box ? Math.round(Math.min(box.w * 0.8, box.h * 0.64)) : 0;

  return (
    <div
      className="fixed inset-0 z-[150] flex select-none flex-col bg-black text-white"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)", touchAction: "manipulation", overscrollBehavior: "contain" }}
      role="dialog"
      aria-modal="true"
      aria-label="Camera"
      data-food-camera
      data-camera-phase={phase.name === "problem" ? phase.problem : phase.name}
    >
      <div className="flex h-14 shrink-0 items-center px-3">
        <ChromeButton label="Close Camera" onClick={close} disabled={phase.name === "handoff"}>
          <svg viewBox="0 0 24 24" className="h-5 w-5" {...iconProps} strokeWidth="2.2"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </ChromeButton>
      </div>

      <div ref={areaRef} className="relative flex min-h-0 flex-1 items-center justify-center">
        <div
          ref={viewRef}
          className="relative overflow-hidden rounded-[22px] bg-[#0d1016]"
          style={box ? { width: box.w, height: box.h } : { width: "calc(100% - 16px)", height: "100%" }}
          data-viewfinder
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${live ? "opacity-100" : "opacity-0"}`}
          />
          <canvas ref={shotRef} className={`absolute inset-0 h-full w-full ${showShot ? "" : "hidden"}`} />

          {live && guide > 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center animate-fadeIn" data-frame-guide>
              <div
                className="relative rounded-[30px]"
                style={{ width: guide, height: guide, border: "1.5px solid rgba(255,255,255,0.72)", boxShadow: "0 0 0 9999px rgba(8,12,20,0.30), inset 0 0 28px rgba(255,255,255,0.06)" }}
              >
                <p
                  className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/45 px-3.5 py-1.5 text-[13px] font-medium text-white/95 backdrop-blur-sm"
                  style={{ bottom: "calc(100% + 14px)" }}
                >
                  Fit Your Meal In The Frame
                </p>
              </div>
            </div>
          )}

          {(phase.name === "starting" || (phase.name === "handoff" && phase.source === "library")) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3" data-camera-loading>
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-white/80" />
              {phase.name === "starting" && <p className="text-[13px] font-medium text-white/55">Starting Camera</p>}
            </div>
          )}

          {phase.name === "problem" && (
            <ProblemPanel
              problem={phase.problem}
              native={isNativeApp()}
              onSettings={openSettings}
              onRetry={() => void startStream()}
              onLibrary={pickFromLibrary}
              onSystemCamera={openSystemCamera}
            />
          )}

          <div ref={flashRef} className="pointer-events-none absolute inset-0 bg-white opacity-0" />
        </div>
      </div>

      <div className={`grid shrink-0 grid-cols-3 items-center px-6 pb-5 pt-5 ${showControls ? "" : "invisible"}`}>
        <div className="flex justify-start">
          <ToolButton label="Library" ariaLabel="Choose From Library" onClick={pickFromLibrary}>
            <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" {...iconProps} strokeWidth="1.8">
              <rect x="3" y="3" width="18" height="18" rx="4" />
              <circle cx="8.8" cy="8.8" r="1.7" />
              <path d="M21 15.5l-4.6-4.6a1.5 1.5 0 0 0-2.1 0L5 20.5" />
            </svg>
          </ToolButton>
        </div>
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => void takePhoto()}
            disabled={!live}
            aria-label="Take Photo"
            className="group flex h-[78px] w-[78px] items-center justify-center rounded-full border-[4px] border-white/95 shadow-[0_6px_24px_rgba(111,168,255,0.35)] transition disabled:opacity-40"
            data-shutter
          >
            <span className="block h-[60px] w-[60px] rounded-full bg-white transition-transform duration-100 group-active:scale-90" />
          </button>
        </div>
        <div className="flex justify-end">
          {torch.supported ? (
            <ToolButton label="Flash" ariaLabel={torch.on ? "Turn Flash Off" : "Turn Flash On"} onClick={() => void toggleTorch()} active={torch.on}>
              <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" {...iconProps} strokeWidth="1.8" fill={torch.on ? "currentColor" : "none"}>
                <path d="M13.2 2.5L5 13.4h6.3l-.9 8.1 8.6-11.2h-6.4l.6-7.8z" />
              </svg>
            </ToolButton>
          ) : (
            <span className="h-12 w-12" aria-hidden="true" />
          )}
        </div>
      </div>

      <input ref={libraryRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={fileChosen("library")} data-library-input />
      <input ref={systemRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={fileChosen("camera")} data-system-camera-input />
    </div>
  );
}

const iconProps = { fill: "none", stroke: "currentColor", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

function ChromeButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition active:scale-95 active:bg-white/20 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function ToolButton({ label, ariaLabel, onClick, active, children }: { label: string; ariaLabel: string; onClick: () => void; active?: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={ariaLabel} aria-pressed={active} className="flex flex-col items-center gap-1.5 transition active:scale-95">
      <span className={`flex h-12 w-12 items-center justify-center rounded-2xl transition ${active ? "bg-primary text-white shadow-[0_4px_16px_rgba(111,168,255,0.45)]" : "bg-white/[0.12] text-white"}`}>
        {children}
      </span>
      <span className="text-[11px] font-medium text-white/65">{label}</span>
    </button>
  );
}

const PROBLEMS: Record<Problem, { title: string; body: (native: boolean) => string }> = {
  denied: {
    title: "Camera Access Is Off",
    body: (native) => native
      ? "To take meal photos here, open Settings, tap WhatYouAte and turn on Camera. You can still pick a photo you already have."
      : "To take meal photos here, allow camera access for this site in your browser settings, then try again.",
  },
  none: {
    title: "Camera Not Available",
    body: () => "We couldn't start the camera here. You can still use your phone's camera or pick a photo you already have.",
  },
  busy: {
    title: "Camera Is Busy",
    body: () => "Another app may be using the camera. Close it and try again, or pick a photo you already have.",
  },
  slow: {
    title: "Camera Is Taking A While",
    body: () => "It didn't start in time. Try again, or pick a photo you already have.",
  },
  stopped: {
    title: "Camera Stopped",
    body: () => "The camera stopped unexpectedly. Try again, or pick a photo you already have.",
  },
};

function ProblemPanel({ problem, native, onSettings, onRetry, onLibrary, onSystemCamera }: {
  problem: Problem;
  native: boolean;
  onSettings: () => void;
  onRetry: () => void;
  onLibrary: () => void;
  onSystemCamera: () => void;
}) {
  const copy = PROBLEMS[problem];
  const primaryBtn = "w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white shadow-[0_8px_22px_rgba(111,168,255,0.35)] transition active:scale-[0.98] active:bg-primary-dark";
  const secondaryBtn = "w-full rounded-xl bg-white/10 py-3 text-sm font-semibold text-white transition active:scale-[0.98] active:bg-white/15";
  const primary =
    problem === "denied" ? (native ? { label: "Open Settings", onClick: onSettings } : { label: "Try Again", onClick: onRetry })
    : problem === "none" ? { label: "Use Phone Camera", onClick: onSystemCamera }
    : { label: "Try Again", onClick: onRetry };
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center px-7 text-center animate-fadeIn" data-camera-problem={problem}>
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-white/85">
        {problem === "denied" ? (
          <svg viewBox="0 0 24 24" className="h-7 w-7" {...iconProps} strokeWidth="1.7">
            <path d="M3 3l18 18" />
            <path d="M9.5 4.5h5l1.8 2.5H19a2 2 0 0 1 2 2v8.2M17.6 19.5H5a2 2 0 0 1-2-2v-8.5A2 2 0 0 1 5 7h1.6" />
            <path d="M14.4 14.6a3.3 3.3 0 0 1-4.9-4.4" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-7 w-7" {...iconProps} strokeWidth="1.7">
            <path d="M21 17.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8.5a2 2 0 0 1 2-2h2.7l1.8-2.5h5l1.8 2.5H19a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="3.4" />
          </svg>
        )}
      </span>
      <h2 className="mt-4 text-lg font-semibold text-white">{copy.title}</h2>
      <p className="mt-2 max-w-[290px] text-sm leading-relaxed text-white/70">{copy.body(native)}</p>
      <div className="mt-6 w-full max-w-[260px] space-y-2.5">
        <button type="button" className={primaryBtn} onClick={primary.onClick}>{primary.label}</button>
        <button type="button" className={secondaryBtn} onClick={onLibrary}>Choose From Library</button>
        {(problem === "busy" || problem === "slow" || problem === "stopped") && (
          <button type="button" className="w-full py-2 text-[13px] font-medium text-white/55 transition active:opacity-60" onClick={onSystemCamera}>Use Phone Camera</button>
        )}
      </div>
    </div>
  );
}
