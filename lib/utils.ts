export function formatDateShort(ts: number) {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
}

export function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit"
  });
}

export function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function dayKeyFromTs(ts: number) {
  return todayKey(new Date(ts));
}

// Returns YYYY-MM-DD in the user's local timezone.
// offsetMinutes = getTimezoneOffset() — positive = west of UTC (ET=240/300, PT=420/480).
export function localDayKeyFromTs(ts: number, offsetMinutes: number): string {
  const d = new Date(ts - offsetMinutes * 60 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function localTodayKey(offsetMinutes: number): string {
  return localDayKeyFromTs(Date.now(), offsetMinutes);
}

export function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function approxFromRange(min: number, max: number) {
  // Guard against undefined/NaN bounds. A missing bound used to poison the
  // average into NaN, which serializes to null and gets rejected by NOT NULL
  // numeric columns — silently dropping the whole meal on save.
  const a = Number.isFinite(min) ? min : 0;
  const b = Number.isFinite(max) ? max : 0;
  if (!a && !b) return 0;
  return Math.round((a + b) / 2);
}

export function formatApprox(min: number, max: number, unit = "") {
  const value = approxFromRange(min, max);
  if (!value) return "–";
  const suffix = unit ? ` ${unit}` : "";
  return `~${value}${suffix}`;
}

export function generateId() {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export async function fileToThumbnailDataUrl(file: File, maxSize = 480) {
  const imageUrl = URL.createObjectURL(file);
  const img = new Image();
  img.src = imageUrl;
  await new Promise((resolve, reject) => {
    img.onload = () => resolve(true);
    img.onerror = reject;
  });

  const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(imageUrl);
  return canvas.toDataURL("image/jpeg", 0.7);
}

// A food photo going from Home to the capture screen travels through sessionStorage as a data URL,
// and WebKit caps sessionStorage at about 5 MB. A full-size photo from the library (often 3 to 5 MB,
// a third more as base64) wouldn't fit and would be dropped, so anything over maxBytes is redrawn
// at 2048px on its long edge first. The capture screen shrinks every photo to 800px for analysis,
// so nothing it uses is lost. Camera stills from the in-app camera are well under the limit.
export async function fitPhotoForHandoff(file: File, maxBytes = 1.5 * 1024 * 1024, maxEdge = 2048): Promise<File> {
  if (file.size <= maxBytes) return file;
  const imageUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = imageUrl;
    await new Promise((resolve, reject) => {
      img.onload = () => resolve(true);
      img.onerror = reject;
    });
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return file;
    const scale = Math.min(1, maxEdge / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) return file;
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "photo"}.jpg`, { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

export function rangeText(min: number, max: number, unit = "") {
  if (!min && !max) return "–";
  const suffix = unit ? ` ${unit}` : "";
  return `~${Math.round(min)}–${Math.round(max)}${suffix}`;
}

export function minutesBetween(start: number, end: number) {
  return Math.max(1, Math.round((end - start) / 60000));
}
