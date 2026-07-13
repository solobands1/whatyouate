// iOS-style avatar: the user's initials on a solid color circle. No photo (deliberately —
// a photo/data-URL would bloat the JWT). Default color is the WhatYouAte brand blue, and
// picking blue is how you "revert". Initials come from the name we already store.

export const DEFAULT_AVATAR_COLOR = "#DDEBFF"; // light blue — matches the original avatar
export const AVATAR_COLORS = [
  "#DDEBFF", // light blue (default / revert — the original look)
  "#6FA8FF", // brand blue
  "#FF6482", // coral
  "#FF9500", // orange
  "#34C759", // green
  "#30B0C7", // teal
  "#AF52DE", // purple
  "#FF2D55", // pink
  "#8E8E93", // gray
];

function isLightColor(hex: string): boolean {
  const c = hex.replace("#", "");
  if (c.length < 6) return false;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 175;
}

// Initials color: the light blue keeps the original darker-blue letters; other light
// swatches use dark ink; the rest use white.
function textColorFor(bg: string): string {
  if (bg.toLowerCase() === "#ddebff") return "#4F88E8"; // darker blue on light blue
  return isLightColor(bg) ? "#1F2937" : "#ffffff";
}

export function avatarInitials(firstName?: string, lastName?: string, email?: string): string {
  const f = (firstName ?? "").trim();
  const l = (lastName ?? "").trim();
  const fromName = ((f[0] ?? "") + (l[0] ?? "")).toUpperCase();
  if (fromName) return fromName;
  const e = (email ?? "").trim();
  return e ? e[0].toUpperCase() : "";
}

export default function ProfileAvatar({
  firstName,
  lastName,
  email,
  color,
  size = 40,
  className = "",
}: {
  firstName?: string;
  lastName?: string;
  email?: string;
  color?: string | null;
  size?: number;
  className?: string;
}) {
  const initials = avatarInitials(firstName, lastName, email);
  const bg = color || DEFAULT_AVATAR_COLOR;
  const textColor = textColorFor(bg);
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${className}`}
      style={{ width: size, height: size, backgroundColor: bg, color: textColor, fontSize: Math.round(size * 0.4) }}
    >
      {initials || (
        <svg
          width={Math.round(size * 0.5)}
          height={Math.round(size * 0.5)}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
        </svg>
      )}
    </div>
  );
}
