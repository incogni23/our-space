"use client";

import { useState } from "react";
import { cx } from "./ui";

/** One real input (so paste and SMS autofill work) drawn as six boxes. */
export function OtpInput({
  id,
  value,
  onChange,
  invalid,
  autoFocus,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  autoFocus?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={6}
        autoFocus={autoFocus}
        value={value}
        aria-invalid={invalid || undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
        className="absolute inset-0 h-[60px] w-full cursor-text opacity-0"
      />
      <div className="grid grid-cols-6 gap-2" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => {
          const active = focused && i === Math.min(value.length, 5);
          return (
            <span
              key={i}
              className={cx(
                "flex h-[60px] items-center justify-center rounded-(--radius-control) bg-surface font-display text-[28px]",
                active ? "border-2 border-ink" : invalid ? "border border-error" : "border border-line-control",
              )}
            >
              {value[i] ?? (active ? <span className="h-[26px] w-0.5 bg-ink" /> : null)}
            </span>
          );
        })}
      </div>
    </div>
  );
}
