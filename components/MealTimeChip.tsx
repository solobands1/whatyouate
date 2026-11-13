"use client";

import WheelPicker from "./WheelPicker";
import { atMinute, clampToToday, mealTimeLabel, minuteOfDay, todayTimeOptions } from "../lib/firstMeal";

// The meal-time chip on the first-meal step's loggers (Type It In, the photo screen, Scan A
// Barcode, Quick Add): "Today, 12:30 PM · Change". It opens the app's wheel with today's times up
// to now, so the first meal is always logged today and never in the future. Sized like the date
// chip it replaces in those loggers (ManualDateRow).
export default function MealTimeChip({ value, onChange }: { value: number; onChange: (ts: number) => void }) {
  const current = String(minuteOfDay(value));
  return (
    <WheelPicker
      value={current}
      defaultValue={current}
      onChange={(v) => onChange(clampToToday(atMinute(Number(v))))}
      options={todayTimeOptions(new Date(), minuteOfDay(value))}
      placeholder=""
      title="Meal Time"
      renderTrigger={(open) => (
        <button
          type="button"
          // Drop the keyboard first (the logger's text field is usually focused), or on iOS it can
          // stay up and cover the wheel.
          onClick={() => { (document.activeElement as HTMLElement | null)?.blur?.(); open(); }}
          className="inline-flex items-center gap-1.5 rounded-full border border-ink/10 px-2.5 py-1 transition active:opacity-70"
          aria-label={`Meal time: ${mealTimeLabel(value)}. Change`}
          data-meal-time-chip
        >
          <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0 text-ink/35" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          <span className="text-[11px] text-ink/65" data-meal-time-label>{mealTimeLabel(value)}</span>
          <span className="text-[11px] font-semibold text-primary">Change</span>
        </button>
      )}
    />
  );
}
