"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  onDetected: (barcode: string) => void;
};

export default function BarcodeScannerOverlay({ open, onClose, onDetected }: Props) {
  const regionId = useRef(`barcode-region-${Math.random().toString(36).slice(2, 8)}`);
  const scannerRef = useRef<any>(null);
  const detectedRef = useRef(false);

  const teardown = () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (!scanner) return;
    try {
      const stopped = scanner.stop?.();
      if (stopped && typeof stopped.finally === "function") {
        stopped.finally(() => { try { scanner.clear?.(); } catch {} });
        return;
      }
    } catch {}
    try { scanner.clear?.(); } catch {}
  };

  useEffect(() => {
    if (!open) {
      detectedRef.current = false;
      return;
    }

    let cancelled = false;

    const startScanner = async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelled) return;

        const scanner = new Html5Qrcode(regionId.current, { verbose: false });
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 260, height: 150 }, aspectRatio: 1.7778 },
          (decodedText: string) => {
            if (detectedRef.current) return;
            detectedRef.current = true;
            teardown();
            onDetected(decodedText.trim());
            onClose();
          },
          () => {}
        );
      } catch {
        onClose();
      }
    };

    startScanner();

    return () => {
      cancelled = true;
      teardown();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5">
      <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl">
        <div className="relative overflow-hidden rounded-lg bg-black">
          <div
            id={regionId.current}
            className="[&>video]:h-56 [&>video]:w-full [&>video]:object-cover [&>span]:hidden [&>img]:hidden [&>canvas]:hidden [&>div]:hidden"
          />
          {/* scanning frame overlay */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {/* dark vignette outside the target box */}
            <div className="absolute inset-0 bg-black/40" style={{ maskImage: "radial-gradient(ellipse 70% 45% at 50% 50%, transparent 60%, black 100%)" }} />
            {/* corner brackets */}
            <div className="relative h-28 w-64">
              {/* top-left */}
              <span className="absolute left-0 top-0 h-5 w-5 border-l-2 border-t-2 border-white rounded-tl" />
              {/* top-right */}
              <span className="absolute right-0 top-0 h-5 w-5 border-r-2 border-t-2 border-white rounded-tr" />
              {/* bottom-left */}
              <span className="absolute bottom-0 left-0 h-5 w-5 border-b-2 border-l-2 border-white rounded-bl" />
              {/* bottom-right */}
              <span className="absolute bottom-0 right-0 h-5 w-5 border-b-2 border-r-2 border-white rounded-br" />
              {/* animated scan line */}
              <div className="absolute left-1 right-1 h-px bg-primary/80 animate-scan" />
            </div>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-muted/60">Point camera at barcode</p>
          <button
            type="button"
            className="rounded-xl border border-ink/10 bg-white px-4 py-2 text-xs font-semibold text-ink/70 transition hover:bg-ink/5"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
