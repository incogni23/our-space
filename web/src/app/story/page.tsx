"use client";
/* eslint-disable @next/next/no-img-element -- photos come from our authenticated API, not next/image */

import Link from "next/link";
import { useEffect, useState } from "react";
import { BottomNav } from "@/components/bottom-nav";
import { ReadOnlyBanner } from "@/components/read-only-banner";
import { Avatar, ButtonLink, ErrorText, Loading, Screen, cx } from "@/components/ui";
import { api, errorMessage, photoUrl, type Memory } from "@/lib/api";
import { useSpace } from "@/lib/use-space";
import { useLiveTick } from "@/lib/live";

type Filter = "all" | "trip" | "moment";

const monthDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" }).toUpperCase();

function dateStamp(m: Memory): string {
  if (m.endsOn && m.endsOn !== m.happenedOn) {
    const a = new Date(`${m.happenedOn}T12:00:00Z`);
    const b = new Date(`${m.endsOn}T12:00:00Z`);
    if (a.getUTCMonth() === b.getUTCMonth()) {
      return `${a.getUTCDate()}–${b.getUTCDate()} ${b.toLocaleDateString(undefined, { month: "short", timeZone: "UTC" }).toUpperCase()}`;
    }
    return `${monthDay(m.happenedOn)} – ${monthDay(m.endsOn)}`;
  }
  return monthDay(m.happenedOn);
}

// E0 · Our Story
export default function Story() {
  const { ready, people, readOnly, spaceName, me } = useSpace();
  const tick = useLiveTick(["memory."], ready);
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    api<{ memories: Memory[] }>("/memories")
      .then((r) => setMemories(r.memories))
      .catch((e) => setError(errorMessage(e)));
  }, [ready, tick]);

  if (!ready || (memories === null && !error)) return <Loading />;

  const shown = (memories ?? []).filter((m) => filter === "all" || m.kind === filter || (filter === "moment" && m.kind !== "trip"));
  const years: Array<{ year: string; items: Memory[] }> = [];
  for (const m of shown) {
    const y = m.happenedOn.slice(0, 4);
    const last = years[years.length - 1];
    if (last && last.year === y) last.items.push(m);
    else years.push({ year: y, items: [m] });
  }
  const tintBorder = (id: string) => {
    const t = people.find((p) => p.id === id)?.personTint;
    return t === "sage" ? "border-sage" : t === "mauve" ? "border-mauve" : "border-terracotta";
  };

  return (
    <Screen className="gap-4 px-4 pb-[120px] pt-14">
      <div className="flex items-center justify-between">
        <h1 className="m-0 font-display text-[34px] font-normal leading-[1.05]">Our Story</h1>
        {readOnly ? null : (
          <ButtonLink href="/story/new" className="min-h-11 w-auto px-3.5 text-sm">
            Add a memory
          </ButtonLink>
        )}
      </div>

      {readOnly ? <ReadOnlyBanner name={spaceName} until={me?.readOnlySpace?.until} /> : null}

      <div className="flex gap-1.5" role="radiogroup" aria-label="Filter">
        {([
          ["all", "All"],
          ["trip", "Trips"],
          ["moment", "Moments"],
        ] as const).map(([f, label]) => (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={filter === f}
            onClick={() => setFilter(f)}
            className={cx(
              "min-h-[38px] rounded-[10px] border px-3.5 text-[13px] font-medium",
              filter === f ? "border-action bg-action text-action-text" : "border-line bg-surface text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <ErrorText>{error}</ErrorText>

      {memories && memories.length === 0 ? (
        <div className="flex flex-col items-center gap-3 pt-8 text-center">
          <div className="flex gap-4" aria-hidden="true">
            <span className="h-[108px] w-[84px] rounded-lg border-[1.5px] border-dashed border-line-control" />
            <span className="mt-[18px] h-[108px] w-[84px] rounded-lg border-[1.5px] border-dashed border-line-control" />
          </div>
          <h2 className="m-0 font-display text-2xl font-normal">Your story starts with any photo.</h2>
          <p className="m-0 text-[15px] leading-[1.55] text-muted">It doesn’t have to be a good one. A screenshot counts.</p>
          {readOnly ? null : (
            <ButtonLink href="/story/new" className="mt-1">
              Add a memory
            </ButtonLink>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-[22px_1fr] gap-x-3">
          <div className="relative" style={{ gridRow: `span ${shown.length + years.length}` }}>
            <div className="absolute bottom-0 left-2.5 top-2 w-[1.5px] bg-line" />
          </div>
          {years.map((y) => (
            <YearBlock key={y.year} year={y.year} items={y.items} people={people} tintBorder={tintBorder} />
          ))}
        </div>
      )}

      <BottomNav current="story" readOnly={readOnly} />
    </Screen>
  );
}

function YearBlock({
  year,
  items,
  people,
  tintBorder,
}: {
  year: string;
  items: Memory[];
  people: ReturnType<typeof useSpace>["people"];
  tintBorder: (id: string) => string;
}) {
  return (
    <>
      <span className="pb-2.5 pt-1 font-display text-[22px] text-muted">{year}</span>
      {items.map((m) => {
        const by = people.find((p) => p.id === m.createdBy);
        if (m.kind === "change") {
          return (
            <Link key={m.id} href={`/story/${m.id}`} className="relative mb-[22px] flex flex-col gap-1.5 rounded-(--radius-note) bg-sunken px-4 py-3.5 text-ink no-underline">
              <span className="absolute -left-7 top-[18px] size-2 rounded-full border-[1.5px] border-ink bg-ground" />
              <span className="font-stamp text-[10px] tracking-[0.1em] text-muted">{monthDay(m.happenedOn)} · A CHANGE</span>
              <span className="font-display text-[19px] leading-[1.2]">{m.title}</span>
              {m.caption ? <span className={cx("border-l-2 pl-2 font-display text-sm italic leading-[1.35]", tintBorder(m.createdBy))}>{m.caption}</span> : null}
            </Link>
          );
        }
        if (m.kind === "start") {
          return (
            <Link key={m.id} href={`/story/${m.id}`} className="relative mb-[22px] flex rounded-(--radius-card) bg-surface text-ink no-underline shadow-(--shadow-paper)">
              <span className="absolute -left-[29px] top-[22px] size-2.5 rounded-[3px] bg-shared shadow-[0_0_0_4px_var(--bg-ground)]" />
              <span className="flex flex-1 flex-col gap-1 px-4 py-3.5">
                <span className="font-stamp text-[10px] tracking-[0.1em] text-shared-ink">{monthDay(m.happenedOn)} · WHERE IT STARTED</span>
                <span className="font-display text-[19px] leading-[1.2]">{m.title}</span>
                <span className="text-xs text-muted">
                  Added by {by?.displayName ?? "you"}
                  {m.caption ? ` · ${m.caption}` : ""}
                </span>
              </span>
              {m.coverId ? (
                <img src={photoUrl(m.coverId)} alt="" className="w-[70px] rounded-r-(--radius-card) border-l-[1.5px] border-dashed border-line object-cover" />
              ) : (
                <span className="w-[54px] border-l-[1.5px] border-dashed border-line" />
              )}
            </Link>
          );
        }
        if (m.kind === "trip") {
          return (
            <Link key={m.id} href={`/story/${m.id}`} className="relative flex flex-col gap-2.5 pb-[22px] text-ink no-underline">
              <span className="absolute -left-[29px] top-2.5 size-2.5 rounded-[3px] bg-shared shadow-[0_0_0_4px_var(--bg-ground)]" />
              {m.coverId ? (
                <span className="relative block h-[220px] overflow-hidden rounded-(--radius-card) bg-sunken">
                  <img src={photoUrl(m.coverId, "full")} alt={m.caption || m.title} className="size-full object-cover" />
                  {m.photoCount > 1 ? (
                    <span className="absolute bottom-2.5 right-2.5 rounded bg-[rgba(46,35,41,0.6)] px-[7px] py-[3px] font-stamp text-[10px] text-[#FFFCF7]">+{m.photoCount - 1}</span>
                  ) : null}
                </span>
              ) : null}
              <span className="font-stamp text-[10px] tracking-[0.1em] text-muted">
                {dateStamp(m)} · TRIP{m.photoCount ? ` · ${m.photoCount} PHOTO${m.photoCount === 1 ? "" : "S"}` : ""}
              </span>
              <span className="font-display text-2xl leading-[1.1]">{m.title}</span>
              <span className="flex items-center justify-between gap-2.5">
                {m.caption ? <span className="font-display text-[15px] italic text-muted">{m.caption}</span> : <span />}
                {by ? <Avatar name={by.displayName} tint={by.personTint} size={22} /> : null}
              </span>
            </Link>
          );
        }
        return (
          <Link key={m.id} href={`/story/${m.id}`} className={cx("relative grid items-center gap-3.5 pb-6 text-ink no-underline", m.coverId ? "grid-cols-[124px_1fr]" : "grid-cols-1")}>
            <span className="absolute -left-7 top-10 size-2 rounded-full bg-ink shadow-[0_0_0_4px_var(--bg-ground)]" />
            {m.coverId ? (
              <span className="-rotate-[1.5deg] rounded-(--radius-print) bg-surface px-1.5 pb-[18px] pt-1.5 shadow-(--shadow-lift)">
                <img src={photoUrl(m.coverId)} alt={m.caption || m.title} className="block h-[90px] w-full object-cover" />
              </span>
            ) : null}
            <span className="flex flex-col gap-[5px]">
              <span className="font-stamp text-[10px] tracking-[0.1em] text-muted">
                {monthDay(m.happenedOn)}
                {m.place ? ` · ${m.place.toUpperCase()}` : ""}
              </span>
              <span className="font-display text-[19px] leading-[1.15]">{m.title}</span>
              {m.caption ? <span className={cx("border-l-2 pl-2 font-display text-sm italic leading-[1.35]", tintBorder(m.createdBy))}>{m.caption}</span> : null}
            </span>
          </Link>
        );
      })}
    </>
  );
}
