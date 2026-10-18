"use client";

import Link from "next/link";
import type { Member, Pin, User } from "@/lib/api";
import { Avatar, cx } from "./ui";

const kindLabel = { link: "Link", place: "Place", song: "Song", idea: "Idea" } as const;

export const statusStyle = {
  saved: { label: "Saved", cls: "bg-sunken text-ink" },
  planned: { label: "Planned", cls: "bg-ok-wash text-ok-ink" },
  done: { label: "Done", cls: "bg-shared-wash text-shared-ink" },
  remembered: { label: "Remembered", cls: "bg-shared-wash text-shared-ink" },
} as const;

function KindIcon({ kind, size = 18 }: { kind: Pin["kind"]; size?: number }) {
  const p = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (kind === "place")
    return (
      <svg {...p}>
        <path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z" />
        <circle cx="12" cy="10" r="2" />
      </svg>
    );
  if (kind === "song")
    return (
      <svg {...p}>
        <path d="M9 18V6l10-2v12" />
        <circle cx="6.5" cy="18" r="2.5" />
        <circle cx="16.5" cy="16" r="2.5" />
      </svg>
    );
  if (kind === "link")
    return (
      <svg {...p}>
        <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
        <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
      </svg>
    );
  return (
    <svg {...p}>
      <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z" />
    </svg>
  );
}

export { KindIcon };

/**
 * A pin on a board. No fake imagery: link previews arrive with the unfurl worker,
 * so cards are typographic, tinted by kind.
 */
export function PinCard({ pin, people, isNew }: { pin: Pin; people: Array<User | Member>; isNew?: boolean }) {
  const by = people.find((p) => p.id === pin.createdBy);
  const st = statusStyle[pin.status];
  return (
    <Link
      href={`/pins/${pin.id}`}
      className={cx(
        "flex flex-col gap-[7px] rounded-(--radius-card) text-ink no-underline",
        isNew && "shadow-(--ring-new) pb-1.5",
      )}
    >
      {pin.kind === "idea" ? (
        <div className="flex flex-col gap-2 rounded-(--radius-note) border border-line bg-surface p-3.5">
          <span className="font-display text-lg leading-[1.3]">{pin.title}</span>
        </div>
      ) : (
        <div
          className={cx(
            "relative flex min-h-[120px] flex-col justify-end gap-1 overflow-hidden rounded-(--radius-pin) p-3",
            pin.kind === "place" && "bg-terracotta-wash text-terracotta-ink",
            pin.kind === "song" && "bg-mauve-wash text-mauve-ink",
            pin.kind === "link" && "border border-line bg-surface text-muted",
          )}
        >
          <KindIcon kind={pin.kind} />
          <span className="break-words font-display text-[17px] leading-[1.15] text-ink">{pin.title}</span>
          {isNew ? (
            <span className="absolute left-2 top-2 rounded-md bg-action px-2 py-[3px] text-[11px] font-semibold text-action-text">
              Just saved
            </span>
          ) : null}
        </div>
      )}
      {pin.note ? (
        <span
          className={cx(
            "mx-1 border-l-2 pl-2 font-display text-sm italic leading-[1.35]",
            by?.personTint === "sage" ? "border-sage" : by?.personTint === "mauve" ? "border-mauve" : "border-terracotta",
          )}
        >
          {pin.note}
        </span>
      ) : null}
      <span className="flex items-center gap-1.5 px-1 text-xs text-muted">
        {by ? <Avatar name={by.displayName} tint={by.personTint} size={18} /> : null}
        {kindLabel[pin.kind]}
        {pin.status !== "saved" ? <span className={cx("ml-auto rounded-md px-2 py-[2px] font-semibold", st.cls)}>{st.label}</span> : null}
      </span>
    </Link>
  );
}
