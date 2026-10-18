"use client";

import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { FAMILIES, applyFamily, type Family } from "@/lib/theme";
import { cx } from "./ui";

/** Repaint the space. Applies instantly, saves, and the partner gets a note. */
export function usePalette(current: Family | undefined) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function pick(f: Family, onDone?: () => void): Promise<boolean> {
    if (f === current) return true;
    const prev = current;
    applyFamily(f);
    setSaving(true);
    setError(null);
    try {
      await api("/space/palette", { body: { palette: f } });
      onDone?.();
      return true;
    } catch (err) {
      applyFamily(prev);
      setError(errorMessage(err));
      return false;
    } finally {
      setSaving(false);
    }
  }
  return { pick, error, saving };
}

/** Three dots of the current family, for the palette button. */
export function PaletteDots() {
  return (
    <span aria-hidden="true" className="relative block size-11">
      <span className="absolute left-[11px] top-3 size-3 rounded-full bg-accent" />
      <span className="absolute right-[11px] top-3 size-3 rounded-full bg-second" />
      <span className="absolute bottom-2.5 left-4 size-3 rounded-full bg-petal shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]" />
    </span>
  );
}

/** Grid of colour families as radios. `big` is the Colours page version. */
export function FamilyGrid({ value, onPick, big = false }: { value: Family | undefined; onPick: (f: Family) => void; big?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Colour family" className={cx("grid gap-2", big ? "grid-cols-2 gap-2.5" : "grid-cols-3")}>
      {FAMILIES.map((f) => {
        const on = f.id === value;
        return (
          <button
            key={f.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onPick(f.id)}
            style={{ background: f.ground, color: f.text, border: on ? `2.5px solid ${f.text}` : "1px solid rgba(0,0,0,0.12)" }}
            className={cx(
              "relative flex cursor-pointer",
              big ? "min-h-[92px] flex-col justify-between gap-2 rounded-2xl p-3 text-left" : "min-h-[58px] flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-[11px] font-medium",
            )}
          >
            <span className="flex gap-[3px]">
              {[f.accent, f.second, f.petal, ...(big ? [f.tape] : [])].map((c, i) => (
                <span key={i} className={cx("rounded-full", big ? "size-4" : "size-3", i > 1 && "shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]")} style={{ background: c }} />
              ))}
            </span>
            {big ? (
              <span className="flex flex-col">
                <span className="font-display text-[17px] font-bold">{f.name}</span>
                <span className="font-hand text-[17px] opacity-85">{f.line}</span>
              </span>
            ) : (
              <span>{f.name}</span>
            )}
            {big && on ? (
              <span className="absolute right-2.5 top-2.5 flex size-[22px] items-center justify-center rounded-full" style={{ background: f.text, color: f.ground }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12.5l4.5 4.5L19 7" />
                </svg>
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
