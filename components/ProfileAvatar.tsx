// iOS-style avatar: the user's initials on a solid color circle. No photo (deliberately —
// a photo/data-URL would bloat the JWT). Default color is the WhatYouAte brand blue, and
// picking blue is how you "revert". Initials come from the name we already store.

export const DEFAULT_AVATAR_COLOR = "#6FA8FF"; // WhatYouAte primary blue
export const AVATAR_COLORS = [
  "#6FA8FF", // blue (default / revert)
  "#FF6482", // coral
  "#FF9500", // orange
  "#34C759", // green
  "#30B0C7", // teal
  "#AF52DE", // purple
  "#FF2D55", // pink
  "#8E8E93", // gray
];

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
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${className}`}
      style={{ width: size, height: size, backgroundColor: color || DEFAULT_AVATAR_COLOR, fontSize: Math.round(size * 0.4) }}
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
