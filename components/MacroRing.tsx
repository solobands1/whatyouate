// 3/4-arc speedometer-style ring gauge. Originally the Insights macro ring; now a
// shared visual used wherever a value-vs-target needs a rounded-arc gauge.
export default function MacroRing({
  label,
  value,
  unit,
  target,
  animate,
  caption,
}: {
  label: string;
  value: number;
  unit: string;
  target: number | null;
  animate: boolean;
  caption?: string;
}) {
  const SIZE = 72;
  const R = 28;
  const STROKE = 7;
  const C = 2 * Math.PI * R;
  const ARC = 0.75 * C; // 270° worth of circumference
  const rawProgress = target && target > 0 && value > 0 ? value / target : 0;
  const progress = Number.isFinite(rawProgress) ? Math.min(1, rawProgress) : 0;
  const offset = ARC * (1 - (animate ? progress : 0));
  const displayVal = value > 0 ? `${value}${unit}` : "—";
  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        {/* rotate(135deg) places the arc start at bottom-left, gap at bottom */}
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ transform: "rotate(135deg)" }}>
          <circle
            cx={SIZE / 2} cy={SIZE / 2} r={R}
            fill="none" stroke="currentColor" strokeWidth={STROKE}
            strokeDasharray={`${ARC} ${C}`}
            className="text-ink/10"
            strokeLinecap="butt"
          />
          <circle
            cx={SIZE / 2} cy={SIZE / 2} r={R}
            fill="none" stroke="currentColor" strokeWidth={STROKE}
            strokeDasharray={`${ARC} ${C}`}
            strokeDashoffset={offset}
            className="text-primary"
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 700ms cubic-bezier(0.22,1,0.36,1)" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-[15px] font-semibold leading-none text-ink">{displayVal}</p>
        </div>
      </div>
      <p className="text-[10px] uppercase tracking-wide text-muted/65">{label}</p>
      {caption && <p className="text-[9px] text-muted/60">{caption}</p>}
    </div>
  );
}
