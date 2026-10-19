"use client";

import Link from "next/link";
import { photoUrl, type Member, type Pin, type User } from "@/lib/api";
import { inkColor } from "@/lib/theme";
import { StatusStamp } from "./print";
import { cx } from "./ui";

const kindLabel = { link: "Link", place: "Place", song: "Song", idea: "Idea", photo: "Photo" } as const;

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
  if (kind === "photo")
    return (
      <svg {...p}>
        <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
        <circle cx="12" cy="12" r="3.2" />
        <path d="M8.5 5.5l1.2-2h4.6l1.2 2" />
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

function hash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const stampText = { saved: "", planned: "Planned", done: "Done", remembered: "Remembered" } as const;

/**
 * A pin on a board, v2 scrapbook: photos as taped black-and-white polaroids,
 * ideas as petal notes in the writer's hand, links as typed cards. Each person's
 * words are in their own ink. One sticker per card at most.
 */
export function PinCard({ pin, people, isNew }: { pin: Pin; people: Array<User | Member>; isNew?: boolean }) {
  const by = people.find((p) => p.id === pin.createdBy);
  const mine = by?.id === people[0]?.id;
  const ink = inkColor(by?.ink ?? (mine ? "accent" : "second"));
  const h = hash(pin.id);
  const rot = ((h % 9) - 4) * 0.6; // -2.4..2.4deg
  const tapeRot = (h % 2 ? 1 : -1) * (3 + (h % 6));
  const tone = mine ? "petal" : "tape";
  const shadow = "shadow-[0_14px_24px_-14px_rgba(0,0,0,0.55)]";
  return (
    <Link href={`/pins/${pin.id}`} className="relative flex flex-col gap-1.5 text-ink no-underline" style={{ transform: `rotate(${rot}deg)` }}>
      {pin.kind === "idea" ? (
        <div className={cx("relative bg-petal px-3.5 pb-[18px] pt-4 [clip-path:polygon(0_0,100%_0,100%_86%,88%_100%,0_100%)]", shadow)}>
          <span className="break-words font-hand text-[26px] leading-[1.05] text-ink">{pin.title}</span>
        </div>
      ) : pin.previewMediaId ? (
        <div className={cx("relative bg-paper p-1.5 pb-2", shadow)}>
          {/* eslint-disable-next-line @next/next/no-img-element -- served by our API */}
          <img src={photoUrl(pin.previewMediaId)} alt="" className="bw block max-h-[220px] w-full object-cover" loading="lazy" />
          {isNew ? (
            <span className="absolute -left-1.5 top-3 -rotate-6 bg-accent px-2 py-1 font-type text-[10px] font-bold tracking-[0.12em] text-on-accent">JUST SAVED</span>
          ) : null}
        </div>
      ) : (
        <div className={cx("relative flex flex-col gap-2 rounded-[4px] border-[1.5px] border-ink bg-paper p-3", shadow)}>
          <span className="flex items-center gap-1.5 font-type text-[10px] uppercase tracking-[0.14em] text-muted">
            <KindIcon kind={pin.kind} size={13} />
            {kindLabel[pin.kind]}
            {pin.previewSite ? ` · ${pin.previewSite}` : ""}
          </span>
          <span className="break-words font-display text-[21px] font-bold leading-[1.05]">{pin.title}</span>
          {pin.previewDescription ? <span className="line-clamp-3 font-type text-xs leading-normal">{pin.previewDescription}</span> : null}
          {isNew ? (
            <span className="absolute -left-1.5 -top-2 -rotate-6 bg-accent px-2 py-1 font-type text-[10px] font-bold tracking-[0.12em] text-on-accent">JUST SAVED</span>
          ) : null}
        </div>
      )}
      {pin.kind !== "idea" && pin.previewMediaId ? (
        <span aria-hidden="true" className={cx("washi absolute left-1/2 -top-[9px] -ml-8 h-5 w-16", tone === "petal" ? "bg-petal" : "bg-tape")} style={{ transform: `rotate(${tapeRot}deg)` }} />
      ) : null}
      {pin.kind === "idea" || !pin.previewMediaId || (pin.kind === "photo" && pin.title === "A photo") ? null : (
        <span className="px-0.5 font-display text-base font-bold leading-[1.1]">{pin.title}</span>
      )}
      {pin.note ? (
        <span className="px-0.5 font-hand text-[19px] leading-[1.05]" style={{ color: ink }}>
          {pin.note}
        </span>
      ) : null}
      {pin.status !== "saved" ? (
        <StatusStamp color={pin.status === "planned" ? "var(--accent-ink)" : "var(--text)"}>{stampText[pin.status]}</StatusStamp>
      ) : null}
      <span className="sr-only">Saved by {mine ? "you" : by?.displayName}</span>
    </Link>
  );
}
