"use client";

import { useState } from "react";
import { markNoticeSeen, type Notice } from "@/lib/api";

/** Quiet one-time notices (anything but space_closed, which has its own screen). */
export function NoticeBanner({ notices }: { notices: Notice[] }) {
  const [hidden, setHidden] = useState<string[]>([]);
  const shown = notices.filter((n) => n.kind !== "space_closed" && !hidden.includes(n.id));
  if (shown.length === 0) return null;

  return (
    <div className="flex flex-col gap-2" role="status">
      {shown.map((n) => (
        <div key={n.id} className="flex items-center gap-3 rounded-(--radius-card) bg-sunken px-3.5 py-2.5 text-sm leading-[1.45]">
          <span className="flex-1">
            {n.kind === "partner_number_updated" ? `${n.payload.name || "Your person"} updated their number.` : null}
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
