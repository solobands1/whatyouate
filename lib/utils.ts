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

export function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function approxFromRange(min: number, max: number) {
  if (!min && !max) return 0;
  return Math.round((min + max) / 2);
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

export function rangeText(min: number, max: number, unit = "") {
  if (!min && !max) return "–";
  const suffix = unit ? ` ${unit}` : "";
  return `~${Math.round(min)}–${Math.round(max)}${suffix}`;
}

export function minutesBetween(start: number, end: number) {
  return Math.max(1, Math.round((end - start) / 60000));
}
