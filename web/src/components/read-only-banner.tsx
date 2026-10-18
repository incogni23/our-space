"use client";

import { EXPORT_URL } from "@/lib/api";

/** Shown across a closed space during its read-only window. */
export function ReadOnlyBanner({ name, until }: { name: string; until?: string }) {
  const day = until ? new Date(until).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) : null;
  return (
    <div role="note" className="flex flex-col gap-2 rounded-(--radius-card) bg-sunken px-3.5 py-3 text-sm leading-[1.45]">
      <span>
        <strong className="font-semibold">{name} has closed.</strong> You can read and download everything
        {day ? ` until ${day}` : ""}. Nothing can be added or changed.
      </span>
      <a href={EXPORT_URL} className="self-start text-sm font-medium text-ink underline underline-offset-[3px]">
        Download a copy
      </a>
    </div>
  );
}
