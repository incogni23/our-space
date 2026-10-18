"use client";

import Link from "next/link";
import type { Note } from "@/lib/api";
import { dayShort, timeOnly } from "@/lib/time";
import { Heart, cx } from "./ui";

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
  const fresh = !note.mine && note.state === "delivered" && note.opened === false;
  if (note.state === "waiting" || fresh) {
    return (
      <Link
        href={href}
        aria-label={fresh ? `A letter from ${partnerName}, unopened` : `A letter from ${partnerName}, opens ${opensLabel(note.deliverAt!, myTz)}`}
        className="relative block h-[132px] overflow-hidden rounded-md bg-petal text-ink no-underline shadow-[0_12px_24px_-16px_rgba(0,0,0,0.4)]"
      >
        <span className="washi absolute inset-x-0 top-0 h-[68px] bg-paper opacity-60" />
        <span className={cx("absolute left-1/2 top-[44px] -ml-[17px] flex size-[34px] items-center justify-center rounded-full bg-accent-ink shadow-[0_3px_6px_rgba(0,0,0,0.25)]", !fresh && "opacity-70")}>
          <Heart size={16} color="var(--on-accent)" />
        </span>
        <span className="absolute inset-x-3 bottom-2.5 flex flex-col gap-0.5">
          <span className="font-hand text-[22px] leading-none">a letter from {partnerName}</span>
          <span className="font-type text-[9.5px] uppercase tracking-[0.12em]">
            {fresh ? "Unopened · break the seal" : `Opens ${opensLabel(note.deliverAt!, myTz)}`}
          </span>
        </span>
      </Link>
    );
  }
  if (note.state === "draft") {
    return (
      <Link href={href} className="flex min-h-[112px] flex-col justify-between gap-2 rounded-[4px] border-[1.5px] border-dashed border-line-control p-3 text-muted no-underline">
        <span className="line-clamp-3 font-type text-[13px] leading-[1.5]">{note.body}</span>
        <span className="font-type text-[9.5px] uppercase tracking-[0.12em]">Draft · only you</span>
      </Link>
    );
  }
  if (note.state === "scheduled") {
    const theirs = note.deliverTz && partnerTz && note.deliverTz === partnerTz;
    const tz = theirs ? partnerTz! : myTz;
    return (
      <Link href={href} className="flex min-h-[112px] flex-col justify-between gap-2 bg-paper p-3 text-ink no-underline shadow-[0_12px_24px_-16px_rgba(0,0,0,0.4)]">
        <span className="line-clamp-3 font-type text-[13px] leading-[1.5]">{note.body}</span>
        <span className="font-type text-[9.5px] font-bold uppercase tracking-[0.12em] text-accent-ink">
          Sends {opensLabel(note.deliverAt!, tz)} {theirs ? `${partnerName}’s time` : "your time"}
        </span>
      </Link>
    );
  }
  // delivered and opened (or mine)
  return (
    <Link href={href} className="relative block min-h-[112px] rotate-[-0.8deg] text-ink no-underline">
      <span className="relative flex min-h-[112px] flex-col justify-between gap-2 bg-paper p-3 shadow-[0_12px_24px_-16px_rgba(0,0,0,0.4)]">
        <span className="line-clamp-3 font-type text-[13px] leading-[1.5]">{note.body}</span>
        <span className="font-type text-[9.5px] uppercase tracking-[0.12em] text-muted">
          {note.mine
            ? note.readAt
              ? `Read ${dayShort(note.readAt, myTz)}, ${timeOnly(note.readAt, myTz)}`
              : `Delivered ${dayShort(note.deliveredAt!, myTz)} · sealed`
            : `From ${partnerName} · ${dayShort(note.deliveredAt!, myTz)}`}
          {note.kept ? " · kept" : ""}
          {note.heartedAt || note.hearted ? <span className="text-accent"> · ♥</span> : null}
        </span>
      </span>
    </Link>
  );
}
