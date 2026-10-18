"use client";

import Link from "next/link";
import { useState } from "react";
import { markNoticeSeen, type Notice } from "@/lib/api";
import { familyName } from "@/lib/theme";
import { dayShort, timeOnly } from "@/lib/time";

/** Quiet one-time notices (anything but space_closed, which has its own screen). */
export function NoticeBanner({ notices, tz }: { notices: Notice[]; tz?: string }) {
  const [hidden, setHidden] = useState<string[]>([]);
  const shown = notices.filter((n) => n.kind !== "space_closed" && !hidden.includes(n.id));
  if (shown.length === 0) return null;

  return (
    <div className="flex flex-col gap-2" role="status">
      {shown.map((n) => (
        <div key={n.id} className="flex items-center gap-3 rounded-(--radius-card) bg-sunken px-3.5 py-2.5 text-sm leading-[1.45]">
          <span className="flex-1">
            {n.kind === "partner_number_updated" ? `${n.payload.name || "Your person"} updated their number.` : null}
            {n.kind === "palette_changed" ? (
              <>
                {n.payload.name || "Your person"} painted the space{" "}
                <span className="font-hand text-[19px] text-accent-ink">{familyName(n.payload.palette).toLowerCase()}</span>.
              </>
            ) : null}
            {n.kind === "note_delivered" ? (
              <>
                A note from {n.payload.fromName || "your person"} is here.{" "}
                <Link href={`/notes/${n.payload.noteId}`} onClick={() => void markNoticeSeen(n.id).catch(() => {})} className="font-medium text-ink">
                  Read it
                </Link>
              </>
            ) : null}
            {n.kind === "together_invite" ? (
              <>
                {n.payload.name || "They"} started Together: {n.payload.title}.{" "}
                <Link href={`/together/${n.payload.sessionId}`} onClick={() => void markNoticeSeen(n.id).catch(() => {})} className="font-medium text-ink">
                  Join
                </Link>
              </>
            ) : null}
            {n.kind === "plan_answer" ? (
              <>
                {n.payload.answer === "accepted"
                  ? `${n.payload.name || "They"} said yes to ${n.payload.title}.`
                  : n.payload.answer === "declined"
                    ? `${n.payload.name || "They"} can’t make ${n.payload.title}.`
                    : `${n.payload.name || "They"} suggested another time for ${n.payload.title}.`}{" "}
                <Link href={`/plans/${n.payload.planId}`} onClick={() => void markNoticeSeen(n.id).catch(() => {})} className="font-medium text-ink">
                  Open
                </Link>
              </>
            ) : null}
            {n.kind === "plan_reminder" ? (
              <>
                {n.payload.title}: {dayShort(n.payload.at, tz ?? "UTC")} at {timeOnly(n.payload.at, tz ?? "UTC")}.{" "}
                <Link href={`/plans/${n.payload.planId}`} onClick={() => void markNoticeSeen(n.id).catch(() => {})} className="font-medium text-ink">
                  Open
                </Link>
              </>
            ) : null}
          </span>
          <button
            type="button"
            onClick={() => {
              setHidden((h) => [...h, n.id]);
              void markNoticeSeen(n.id).catch(() => {});
            }}
            className="min-h-11 px-2 font-medium text-ink underline underline-offset-[3px]"
          >
            OK
          </button>
        </div>
      ))}
    </div>
  );
}
