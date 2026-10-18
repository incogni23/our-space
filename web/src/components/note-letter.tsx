"use client";

import Link from "next/link";
import type { Note } from "@/lib/api";
import { dayShort, timeOnly } from "@/lib/time";
import { cx } from "./ui";

/** When a note opens, in the viewer's words: "7:00 am tomorrow", "8:30 pm Sat 7 Nov". */
export function opensLabel(at: string, tz: string): string {
  const d = new Date(at);
  const today = new Date();
  const day = dayShort(d, tz);
  if (day === dayShort(today, tz)) return `${timeOnly(d, tz)} today`;
  if (day === dayShort(new Date(today.getTime() + 86_400_000), tz)) return `${timeOnly(d, tz)} tomorrow`;
  return `${timeOnly(d, tz)} ${day}`;
}

/**
 * NoteLetter (4.3): draft (dashed, only you) · scheduled (sender) · waiting
 * (sealed envelope: who and when only) · delivered/opened (the letter).
 */
export function NoteLetter({
  note,
  myTz,
  partnerName,
  partnerTz,
}: {
  note: Note;
  myTz: string;
  partnerName: string;
  partnerTz?: string;
}) {
  const href = `/notes/${note.id}`;
  if (note.state === "waiting") {
    return (
      <Link href={href} aria-label={`A note from ${partnerName}, opens ${opensLabel(note.deliverAt!, myTz)}`} className="relative block h-[120px] text-ink no-underline">
        <span className="absolute inset-0 rounded-(--radius-note) bg-shared-wash" />
        <span className="absolute inset-x-0 top-0 h-16 bg-[#EBD3CE] [clip-path:polygon(0_0,100%_0,50%_100%)] dark:bg-[#5A3D43]" />
        <span className="absolute inset-x-0 bottom-3 flex flex-col items-center gap-0.5">
          <span className="text-xs font-medium text-shared-ink">From {partnerName}</span>
          <span className="font-stamp text-[10px] uppercase tracking-[0.08em] text-shared-ink">Opens {opensLabel(note.deliverAt!, myTz)}</span>
        </span>
      </Link>
    );
  }
  if (note.state === "draft") {
    return (
      <Link href={href} className="flex min-h-[104px] flex-col justify-between gap-2 rounded-(--radius-note) border-[1.5px] border-dashed border-line-control p-3 text-muted no-underline">
        <span className="line-clamp-3 font-display text-[15px] italic leading-[1.35]">{note.body}</span>
        <span className="font-stamp text-[10px] uppercase tracking-[0.08em]">Draft · only you</span>
      </Link>
    );
  }
  if (note.state === "scheduled") {
    const theirs = note.deliverTz && partnerTz && note.deliverTz === partnerTz;
    const tz = theirs ? partnerTz! : myTz;
    return (
      <Link href={href} className="flex min-h-[104px] flex-col justify-between gap-2 rounded-(--radius-note) border border-line bg-surface p-3 text-ink no-underline">
        <span className="line-clamp-3 font-display text-[15px] italic leading-[1.35]">{note.body}</span>
        <span className="font-stamp text-[10px] uppercase tracking-[0.08em] text-shared-ink">
          Sends {opensLabel(note.deliverAt!, tz)} {theirs ? `${partnerName}’s time` : "your time"}
        </span>
      </Link>
    );
  }
  // delivered
  const fresh = !note.mine && note.opened === false;
  return (
    <Link href={href} className="relative block min-h-[112px] text-ink no-underline">
      <span className="absolute inset-[6px_-3px_-4px_5px] rotate-[2.5deg] rounded-(--radius-note) bg-shared-wash" />
      <span className={cx("relative flex min-h-[112px] flex-col justify-between gap-2 rounded-(--radius-note) bg-surface p-3 shadow-(--shadow-paper)", fresh && "shadow-(--ring-new)")}>
        <span className="line-clamp-3 font-display text-[15px] italic leading-[1.35]">{note.body}</span>
        <span className="font-stamp text-[10px] uppercase tracking-[0.08em] text-muted">
          {note.mine ? `Delivered ${dayShort(note.deliveredAt!, myTz)}` : `From ${partnerName} · ${dayShort(note.deliveredAt!, myTz)}`}
          {note.kept ? " · kept" : ""}
        </span>
      </span>
    </Link>
  );
}
