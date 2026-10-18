"use client";

import { useId, type CSSProperties, type ReactNode } from "react";
import { HEART, cx } from "./ui";

/** Black-and-white "film" used where there is no photo yet (welcome, empty states). */
export function Film({ seed = 0, className, style }: { seed?: number; className?: string; style?: CSSProperties }) {
  const looks = [
    "radial-gradient(60% 50% at 30% 40%, #8d8a88 0%, transparent 70%), radial-gradient(50% 60% at 72% 62%, #5b5856 0%, transparent 70%), linear-gradient(160deg, #b9b6b3, #3c3a39)",
    "radial-gradient(40% 40% at 50% 35%, #d8d5d2 0%, transparent 70%), linear-gradient(200deg, #6f6c6a, #232120)",
    "radial-gradient(70% 40% at 50% 80%, #4a4847 0%, transparent 70%), linear-gradient(180deg, #cfccc9 0%, #8a8785 55%, #3a3837 100%)",
    "radial-gradient(35% 45% at 35% 50%, #2b2928 0%, transparent 70%), radial-gradient(35% 45% at 65% 50%, #2b2928 0%, transparent 70%), linear-gradient(90deg, #a6a3a0, #e3e0dd, #a6a3a0)",
  ];
  return <div aria-hidden="true" className={cx("bw", className)} style={{ background: looks[seed % looks.length], ...style }} />;
}

/** A polaroid: paper frame, deep shadow, optional caption in someone's hand. */
export function Polaroid({
  children,
  caption,
  ink,
  rotate = 0,
  className,
  pad = "p-1.5 pb-7",
}: {
  children: ReactNode;
  caption?: ReactNode;
  ink?: string;
  rotate?: number;
  className?: string;
  pad?: string;
}) {
  return (
    <div
      className={cx(className?.includes("absolute") ? "" : "relative", "bg-paper shadow-[0_16px_28px_-16px_rgba(0,0,0,0.55)]", pad, className)}
      style={{ transform: rotate ? `rotate(${rotate}deg)` : undefined }}
    >
      {children}
      {caption ? (
        <span className="absolute bottom-1 left-2.5 right-2 truncate font-hand text-[20px] leading-tight" style={{ color: ink ?? "var(--my-ink)" }}>
          {caption}
        </span>
      ) : null}
    </div>
  );
}

/** Round rubber stamp with text around the edge. It spins slowly (off with reduced motion). */
export function SpinStamp({ text, size = 104, className }: { text: string; size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <div aria-hidden="true" className={className ?? "relative"} style={{ width: size, height: size }}>
      <svg className="bu-spin" width={size} height={size} viewBox="0 0 120 120">
        <defs>
          <path id={id} d="M60,60 m-44,0 a44,44 0 1,1 88,0 a44,44 0 1,1 -88,0" />
        </defs>
        <circle cx="60" cy="60" r="58" fill="var(--accent-ink)" />
        <text fontFamily="var(--font-type)" fontSize="11" letterSpacing="2" fill="var(--on-accent)">
          <textPath href={`#${id}`}>{text}</textPath>
        </text>
      </svg>
      <svg width={size * 0.3} height={size * 0.3} viewBox="0 0 24 24" className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <path d={HEART} fill="var(--on-accent)" />
      </svg>
    </div>
  );
}

/** Courier label in a thin box: ONLY YOU TWO. */
export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx("rounded-[4px] border border-ink px-[7px] py-1 font-type text-[10px] uppercase tracking-[0.1em]", className)}>
      {children}
    </span>
  );
}

/** Tilted rubber-stamp status: PLANNED · SAT 5 DEC. */
export function StatusStamp({ children, color = "var(--accent-ink)", className }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span
      className={cx("self-start -rotate-2 rounded-[3px] border-[1.5px] px-1.5 py-[3px] font-type text-[10px] font-bold uppercase tracking-[0.1em]", className)}
      style={{ borderColor: color, color }}
    >
      {children}
    </span>
  );
}

/** Pill filter chip (radio). */
export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={cx(
        "min-h-10 flex-none rounded-[20px] border-[1.5px] border-ink px-[15px] text-[13px] font-medium",
        on ? "bg-ink text-ground" : "bg-transparent text-ink",
      )}
    >
      {children}
    </button>
  );
}

/** Section heading in Courier caps with a rule, magazine-style. */
export function Kicker({ children, right, id }: { children: ReactNode; right?: ReactNode; id?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-ink pb-1.5">
      <h2 id={id} className="m-0 font-type text-[11px] font-bold uppercase tracking-[0.16em]">
        {children}
      </h2>
      {right}
    </div>
  );
}
