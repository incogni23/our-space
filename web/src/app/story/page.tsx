"use client";
/* eslint-disable @next/next/no-img-element -- photos come from our authenticated API, not next/image */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BottomNav } from "@/components/bottom-nav";
import { Film, Kicker } from "@/components/print";
import { ReadOnlyBanner } from "@/components/read-only-banner";
import { ButtonLink, ErrorText, Loading, PrintTitle, Rule, Screen, cx } from "@/components/ui";
import { api, errorMessage, photoUrl, type Memory } from "@/lib/api";
import { issueOf, issueNoFor, sinceOf } from "@/lib/issue";
import { useLiveTick } from "@/lib/live";
import { inkColor } from "@/lib/theme";
import { useSpace } from "@/lib/use-space";

type Style = "photo" | "accent" | "paper" | "petal";
const STYLES: Style[] = ["accent", "paper", "photo", "petal"];

const look: Record<Style, { box: string; fg: string; mast: string; img: string; shadow: boolean }> = {
  photo: { box: "bg-[#151112]", fg: "text-[#FFFDF9]", mast: "text-[#FFFDF9]", img: "inset-0 size-full", shadow: true },
  accent: { box: "bg-accent", fg: "text-on-accent", mast: "text-on-accent", img: "inset-x-[10%] top-[22%] h-1/2 w-4/5 mix-blend-multiply", shadow: false },
  paper: { box: "border-[1.5px] border-ink bg-paper", fg: "text-ink", mast: "text-accent-ink", img: "inset-x-[12%] top-[24%] h-[46%] w-[76%]", shadow: false },
  petal: { box: "bg-petal", fg: "text-ink", mast: "text-accent-ink", img: "inset-x-[8%] top-[20%] h-1/2 w-[84%]", shadow: false },
};

type Issue = { no: number; month: string; year: string; items: Memory[]; lead?: Memory };

const monthLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { month: "short", year: "numeric" }).toUpperCase();
const stampDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit" }).replace(/\//g, " · ");

/** The memory that makes the cover: a trip with photos beats a moment with photos beats the rest. */
function coverOf(items: Memory[]): Memory | undefined {
  const score = (m: Memory) => (m.coverId ? 2 : 0) + (m.kind === "trip" ? 1 : 0) + Math.min(m.photoCount, 9) / 10;
  return [...items].sort((a, b) => score(b) - score(a))[0];
}

function Cover({ issue, style, name, big, rot = 0, now, onPick }: { issue: Issue; style: Style; name: string; big?: boolean; rot?: number; now?: boolean; onPick: () => void }) {
  const l = look[style];
  const lead = issue.lead;
  const shadow = l.shadow ? "[text-shadow:0_1px_12px_rgba(0,0,0,0.55)]" : "";
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label={`Issue ${issue.no}, ${issue.month}${lead ? `: ${lead.title}` : ""}`}
      className={cx("relative block w-full cursor-pointer overflow-hidden text-left", big ? "h-[380px]" : "h-[230px]", l.box, l.fg, "shadow-[0_16px_26px_-16px_rgba(0,0,0,0.55)]")}
      style={{ transform: rot ? `rotate(${rot}deg)` : undefined }}
    >
      {lead?.coverId ? (
        <img src={photoUrl(lead.coverId, big ? "full" : "thumb")} alt="" className={cx("bw absolute object-cover", l.img)} />
      ) : (
        <Film seed={issue.no} className={cx("absolute", l.img)} />
      )}
      <div className={cx("absolute inset-0 flex flex-col justify-between", big ? "p-4" : "p-2.5")}>
        <div className="flex items-start justify-between gap-1.5">
          <span className={cx("font-display font-black italic leading-[0.85]", big ? "text-[38px]" : "text-xl", l.mast, shadow)}>{name}</span>
          <span className={cx("text-right font-type uppercase leading-normal", big ? "text-[10.5px] tracking-[0.14em]" : "text-[9px] tracking-[0.12em]", shadow)}>
            Nº {issue.no}
            {big ? (
              <>
                <br />
                {issue.month}
              </>
            ) : null}
          </span>
        </div>
        <div className={cx("flex flex-col gap-0.5", shadow)}>
          {now ? (
            <span className="-rotate-3 self-start bg-paper px-2 py-1 font-type text-[10px] font-bold tracking-[0.14em] text-accent-ink [text-shadow:none]">
              THIS MONTH · STILL BEING WRITTEN
            </span>
          ) : null}
          {!big ? <span className="font-type text-[9.5px] tracking-[0.14em]">{issue.month}</span> : null}
          <span className={cx("font-display font-bold leading-[0.95]", big ? "text-[42px] tracking-[-0.01em]" : "line-clamp-3 text-[19px]")}>
            {lead ? lead.title : now ? `${new Date().toLocaleDateString("en-GB", { month: "long" })}, so far` : "A quiet month"}
          </span>
          {big && lead?.caption ? <span className="line-clamp-2 font-hand text-2xl leading-none">{lead.caption}</span> : null}
        </div>
      </div>
    </button>
  );
}

// E0 · Our Story, v2: back issues, one per monthsary.
export default function Story() {
  const { ready, people, readOnly, spaceName, me } = useSpace();
  const tick = useLiveTick(["memory."], ready);
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [year, setYear] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    api<{ memories: Memory[] }>("/memories")
      .then((r) => setMemories(r.memories))
      .catch((e) => setError(errorMessage(e)));
  }, [ready, tick]);

  const activatedAt = me?.space?.activatedAt;
  const since = sinceOf(activatedAt, memories ?? []);
  const current = issueOf(since);

  const issues = useMemo(() => {
    const byNo = new Map<number, Issue>();
    for (const m of memories ?? []) {
      if (m.kind === "change" || m.kind === "start") continue;
      const no = issueNoFor(since, `${m.happenedOn}T12:00:00`);
      const it = byNo.get(no) ?? { no, month: monthLabel(m.happenedOn), year: m.happenedOn.slice(0, 4), items: [] };
      it.items.push(m);
      byNo.set(no, it);
    }
    if (!byNo.has(current.no)) {
      const d = new Date();
      byNo.set(current.no, { no: current.no, month: monthLabel(d.toISOString().slice(0, 10)), year: String(d.getFullYear()), items: [] });
    }
    return [...byNo.values()].map((i) => ({ ...i, lead: coverOf(i.items) })).sort((a, b) => b.no - a.no);
  }, [memories, since, current.no]);

  if (!ready || (memories === null && !error)) return <Loading />;

  const years = [...new Set(issues.map((i) => i.year))];
  const y = year && years.includes(year) ? year : years[0];
  const inYear = issues.filter((i) => i.year === y);
  const lead = inYear.find((i) => i.no === picked) ?? inYear[0];
  const rest = inYear.filter((i) => i !== lead);
  const firsts = (memories ?? []).filter((m) => m.kind === "start" || m.kind === "change").sort((a, b) => a.happenedOn.localeCompare(b.happenedOn));
  const name = spaceName || "Us";
  const sinceLabel = since ? new Date(since).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }).toUpperCase() : "";
  const inkOf = (id: string) => inkColor(people.find((p) => p.id === id)?.ink ?? (id === me?.user.id ? "accent" : "second"));

  return (
    <Screen wide className="gap-4 px-4 pb-[120px] pt-[50px]">
      <header className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="font-type text-[11px] tracking-[0.16em] text-muted">THE ARCHIVE</span>
          {readOnly ? null : (
            <Link href="/story/new" className="flex min-h-11 items-center text-[13px] font-medium text-accent-ink">
              + Add a memory
            </Link>
          )}
        </div>
        <PrintTitle className="text-[56px] leading-[0.88]">Our Story</PrintTitle>
        <span className="origin-left -rotate-[1.5deg] font-hand text-2xl text-accent-ink">a new issue every monthsary</span>
        <Rule className="mt-1.5">
          <span>
            {current.no} {current.no === 1 ? "issue" : "issues"}
          </span>
          {sinceLabel ? <span>Since {sinceLabel}</span> : null}
          <span className="text-accent-ink">{current.days} days</span>
        </Rule>
      </header>

      {readOnly ? <ReadOnlyBanner name={spaceName} until={me?.readOnlySpace?.until} /> : null}

      {years.length > 1 ? (
        <div role="radiogroup" aria-label="Year" className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(years.length, 4)}, minmax(0, 1fr))` }}>
          {years.slice(0, 4).map((yr) => (
            <button
              key={yr}
              type="button"
              role="radio"
              aria-checked={yr === y}
              onClick={() => {
                setYear(yr);
                setPicked(null);
              }}
              className={cx("min-h-11 rounded-[22px] border-[1.5px] border-ink font-display text-lg font-bold italic", yr === y ? "bg-ink text-ground" : "bg-transparent text-ink")}
            >
              {yr}
            </button>
          ))}
        </div>
      ) : null}

      <ErrorText>{error}</ErrorText>

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[1.4fr_1fr] lg:items-start lg:gap-8">
      {lead ? (
        <div className="-rotate-1 lg:[&>button]:h-[520px]">
          <Cover issue={lead} style={lead.no === current.no ? "accent" : "photo"} name={name} big now={lead.no === current.no} onPick={() => {}} />
        </div>
      ) : null}

      {lead ? (
        <section aria-label={`Inside Nº ${lead.no}`} className="flex flex-col gap-2">
          <Kicker>Inside Nº {lead.no}</Kicker>
          {lead.items.length === 0 ? (
            <div className="flex flex-col items-center gap-1 py-3 text-center">
              <span className="font-display text-xl font-bold italic">Nothing in this issue yet.</span>
              {readOnly ? null : (
                <Link href="/story/new" className="font-hand text-[22px] text-accent-ink">
                  add any photo. a screenshot counts.
                </Link>
              )}
            </div>
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {[...lead.items].sort((a, b) => a.happenedOn.localeCompare(b.happenedOn)).map((m) => (
                <li key={m.id} className="border-b border-line last:border-b-0">
                  <Link href={`/story/${m.id}`} className="flex min-h-16 items-center gap-3 py-2 text-ink no-underline">
                    {m.coverId ? (
                      <img src={photoUrl(m.coverId)} alt="" className="bw size-12 flex-none bg-paper object-cover p-[3px] shadow-[0_6px_12px_-8px_rgba(0,0,0,0.5)]" />
                    ) : (
                      <span className="size-12 flex-none bg-petal" aria-hidden="true" />
                    )}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-type text-[10px] uppercase tracking-[0.12em] text-muted">
                        {stampDate(m.happenedOn)}
                        {m.kind === "trip" ? " · trip" : ""}
                        {m.place ? ` · ${m.place}` : ""}
                      </span>
                      <span className="truncate font-display text-lg font-bold leading-tight">{m.title}</span>
                      {m.caption ? (
                        <span className="truncate font-hand text-lg leading-none" style={{ color: inkOf(m.createdBy) }}>
                          {m.caption}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
      </div>

      {rest.length ? (
        <>
          <Kicker>Back issues · {y}</Kicker>
          <div className="grid grid-cols-2 gap-x-3 gap-y-3.5 lg:grid-cols-4 lg:gap-x-6 lg:gap-y-7">
            {rest.map((i, n) => (
              <Cover key={i.no} issue={i} style={STYLES[(n + 1) % 4]} name={name} rot={[-1.5, 1.5, 1, -1][n % 4]} onPick={() => setPicked(i.no)} />
            ))}
          </div>
        </>
      ) : null}

      {firsts.length ? (
        <section aria-label="Firsts and changes" className="flex flex-col gap-2.5 pt-1.5">
          <Kicker>Firsts &amp; changes</Kicker>
          <div className="-mr-4 flex gap-2.5 overflow-x-auto pb-1.5 pr-4 pt-1">
            {firsts.map((m) => (
              <Link key={m.id} href={`/story/${m.id}`} className="flex w-32 flex-none flex-col gap-1 rounded bg-paper p-2.5 text-ink no-underline shadow-[0_10px_18px_-12px_rgba(0,0,0,0.5)]">
                <span className={cx("font-type text-[9.5px] tracking-[0.12em]", m.kind === "start" ? "text-accent-ink" : "text-muted")}>{stampDate(m.happenedOn)}</span>
                <span className="font-hand text-xl leading-none" style={{ color: inkOf(m.createdBy) }}>
                  {m.caption || m.title}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <div className="flex flex-col gap-2 lg:max-w-[420px]">
        {!readOnly ? (
          <ButtonLink href={lead?.lead ? `/made/new?memory=${lead.lead.id}` : "/made/new"} className="min-h-[52px] text-[15px]">
            Make something from an issue
          </ButtonLink>
        ) : null}
        <ButtonLink href="/made" variant="text">
          Things we’ve made
        </ButtonLink>
      </div>

      <BottomNav current="story" readOnly={readOnly} />
    </Screen>
  );
}
