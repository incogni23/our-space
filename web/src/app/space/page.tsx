"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BottomNav } from "@/components/bottom-nav";
import { NoticeBanner } from "@/components/notice-banner";
import { opensLabel } from "@/components/note-letter";
import { FamilyGrid, PaletteDots, usePalette } from "@/components/palette-picker";
import { Film, Polaroid, SpinStamp } from "@/components/print";
import { ReadOnlyBanner } from "@/components/read-only-banner";
import { ButtonLink, Heart, Loading, PrintTitle, Rule, Screen, Tape, cx } from "@/components/ui";
import { api, cityOf, homeFor, partnerOf, photoUrl, type Member, type Memory, type Note, type Pin, type Plan, type TogetherSession, type User } from "@/lib/api";
import { bothAwakeLine } from "@/lib/awake";
import { issueOf, roman, sinceOf } from "@/lib/issue";
import { useLiveTick } from "@/lib/live";
import { inkColor } from "@/lib/theme";
import { daysUntil, fmt, theirTime, timeOnly } from "@/lib/time";
import { useMe } from "@/lib/use-me";

function hourIn(tz: string, at: Date): number {
  try {
    return Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(at));
  } catch {
    return at.getHours();
  }
}

function greeting(tz: string): string {
  const h = hourIn(tz, new Date());
  if (h < 5) return "still up";
  if (h < 12) return "good morning";
  if (h < 17) return "good afternoon";
  return "good evening";
}

/** 1:16 pm → ["1:16", "pm"] for the big clock. */
function clockParts(tz: string, at: Date): [string, string] {
  const s = at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
  const [t, ap] = s.split(" ");
  return [t, (ap ?? "").toLowerCase()];
}

function Initial({ p, color }: { p: User | Member; color: string }) {
  return (
    <span
      className="flex size-[30px] items-center justify-center rounded-full font-display text-[15px] font-bold italic text-[#FFFDF9] shadow-[0_0_0_2px_var(--ground)]"
      style={{ background: color }}
    >
      {(p.displayName || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

// B1 · Our Space, v2: this month's issue.
export default function OurSpace() {
  const router = useRouter();
  const { me, loading, reload } = useMe();
  const [newPins, setNewPins] = useState<Pin[] | null>(null);
  const [nextPlan, setNextPlan] = useState<{ plan: Plan; at: string } | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [together, setTogether] = useState<TogetherSession | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [paletteOpen, setPaletteOpen] = useState(false);
  const palette = usePalette(me?.space?.palette);

  const readOnly = !!me && !me.space && !!me.readOnlySpace;
  useEffect(() => {
    if (me && me.space?.status !== "active" && !readOnly) router.replace(homeFor(me));
  }, [me, router, readOnly]);

  const tick = useLiveTick(["pin.", "plan.", "note.", "together.", "memory."], me?.space?.status === "active");
  const spaceTick = useLiveTick(["space.", "notice.", "note."], !!me?.space);
  useEffect(() => {
    if (spaceTick) void reload();
  }, [spaceTick, reload]);
  useEffect(() => {
    if (me?.space?.status !== "active") return;
    api<{ newFromPartner: Pin[] }>("/space/home")
      .then((r) => setNewPins(r.newFromPartner))
      .catch(() => setNewPins([]));
    api<{ plans: Plan[] }>(`/plans?to=${encodeURIComponent(new Date(Date.now() + 120 * 86_400_000).toISOString())}`)
      .then((r) => {
        const occ = r.plans
          .filter((p) => p.status !== "declined" && p.status !== "cancelled")
          .flatMap((p) => (p.occurrences ?? []).filter((o) => Date.parse(o) > Date.now()).map((at) => ({ plan: p, at })))
          .sort((a, b) => a.at.localeCompare(b.at));
        setNextPlan(occ[0] ?? null);
      })
      .catch(() => {});
    api<{ notes: Note[] }>("/notes")
      .then((r) => setNotes(r.notes))
      .catch(() => {});
    api<{ memories: Memory[] }>("/memories")
      .then((r) => setMemories(r.memories))
      .catch(() => {});
    api<{ session: TogetherSession | null }>("/together")
      .then((r) => setTogether(r.session))
      .catch(() => {});
  }, [me, tick]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (readOnly && me?.readOnlySpace) {
    const ro = me.readOnlySpace;
    const other = ro.members.find((m) => m.id !== me.user.id);
    return (
      <Screen className="gap-[18px] px-4 pb-[120px] pt-14">
        <header className="flex flex-col gap-2">
          <PrintTitle className="text-[52px]">{ro.name}</PrintTitle>
          <Rule>
            <span>You and {other?.displayName || "your person"}</span>
            <span>Closed</span>
          </Rule>
        </header>
        <ReadOnlyBanner name={ro.name} until={ro.until} />
        <nav aria-label="What you shared" className="grid grid-cols-3 gap-2.5">
          {([
            ["/boards", "Boards"],
            ["/plans", "Plans"],
            ["/story", "Our Story"],
          ] as const).map(([href, label]) => (
            <Link key={href} href={href} className="flex min-h-20 items-center justify-center rounded-2xl bg-paper font-display text-lg font-bold italic text-ink no-underline shadow-(--shadow-paper)">
              {label}
            </Link>
          ))}
        </nav>
        <ButtonLink href="/new" variant="secondary">
          Start a new space
        </ButtonLink>
        <BottomNav current="space" readOnly />
      </Screen>
    );
  }

  if (loading || !me?.space) return <Loading />;
  const partner = partnerOf(me);
  const pName = partner?.displayName || "your person";
  const myTz = me.user.timeZone;
  const myInk = inkColor(me.user.ink);
  const theirInk = inkColor(partner?.ink ?? "second");
  const issue = issueOf(sinceOf(me.space.activatedAt, memories), now);
  const cover = memories.find((m) => m.coverId);
  const fresh = notes.find((n) => !n.mine && n.state === "delivered" && n.opened === false);
  const waiting = notes.filter((n) => !n.mine && n.state === "waiting").sort((a, b) => (a.deliverAt ?? "").localeCompare(b.deliverAt ?? ""))[0];
  const yearAgo = memories.find((m) => {
    const d = new Date(`${m.happenedOn}T12:00:00`);
    const years = now.getFullYear() - d.getFullYear();
    if (years < 1) return false;
    const same = new Date(d);
    same.setFullYear(now.getFullYear());
    return Math.abs(same.getTime() - now.getTime()) < 4 * 86_400_000;
  });
  const sleeps = nextPlan ? daysUntil(nextPlan.at, myTz) : 0;
  const [myT, myAp] = clockParts(myTz, now);
  const [thT, thAp] = partner ? clockParts(partner.timeZone, now) : ["", ""];
  const overlap = partner ? bothAwakeLine(me.user, partner, now) : null;
  const scatter = [
    { pos: "left-0 top-[18px] w-[170px]", rot: -5, h: "h-[150px]", z: "" },
    { pos: "left-[120px] top-[70px] w-[150px]", rot: 4, h: "h-[140px]", z: "z-[2]" },
    { pos: "right-0 top-1.5 w-[140px]", rot: -2, h: "h-[150px]", z: "" },
  ];

  return (
    <Screen wide className="gap-[22px] overflow-x-clip px-4 pb-[120px] pt-[54px] lg:gap-[30px]">
      <div className="flex items-center justify-between">
        <span className="font-type text-[11px] tracking-[0.16em] text-muted">
          VOL. {roman(issue.vol)} · Nº {issue.no}
        </span>
        <div className="flex items-center gap-2 lg:hidden">
          <span className="mr-1 flex items-center" aria-label={`${me.user.displayName} and ${pName}`}>
            <Initial p={me.user} color={myInk} />
            {partner ? (
              <span className="-ml-[7px]">
                <Initial p={partner} color={theirInk} />
              </span>
            ) : null}
          </span>
          <button
            type="button"
            onClick={() => setPaletteOpen((o) => !o)}
            aria-expanded={paletteOpen}
            aria-label="Our colours"
            className="size-11 rounded-full bg-paper shadow-[0_1px_0_rgba(0,0,0,0.06),0_6px_14px_-8px_rgba(0,0,0,0.35)]"
          >
            <PaletteDots />
          </button>
          <Link href="/settings" aria-label="Settings" className="flex size-11 items-center justify-center rounded-full text-ink">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
              <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
              <circle cx="16" cy="7" r="2" />
              <circle cx="10" cy="17" r="2" />
            </svg>
          </Link>
        </div>
      </div>

      {paletteOpen ? (
        <div className="lg:hidden">
        <div className="flex flex-col gap-2.5 rounded-[18px] bg-paper p-3.5 shadow-[0_14px_30px_-18px_rgba(0,0,0,0.45)]">
          <div className="flex items-baseline justify-between">
            <span className="font-display text-xl font-bold italic">Paint our space</span>
            <Link href="/colours" className="text-[13px] text-accent-ink">
              All colours
            </Link>
          </div>
          <FamilyGrid value={me.space.palette} onPick={(f) => void palette.pick(f, reload)} />
          {palette.error ? (
            <span role="alert" className="text-sm text-error">
              {palette.error}
            </span>
          ) : (
            <span className="font-hand text-xl text-accent-ink">{pName} sees the new colours too ♡</span>
          )}
        </div>
        </div>
      ) : null}

      <header className="flex flex-col gap-2 lg:hidden">
        <PrintTitle className="text-[64px] leading-[0.86] tracking-[-0.03em]">{me.space.name}</PrintTitle>
        <Rule>
          <span>{fmt(now, myTz, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</span>
          <span>{issue.days === 1 ? "1 day" : `${issue.days} days`} of us</span>
          <span className="text-accent-ink">Only you two</span>
        </Rule>
        <span className="origin-left -rotate-2 pt-1 font-hand text-[28px] text-accent-ink">
          {greeting(myTz)}, {me.user.displayName || "you"} ♡
        </span>
      </header>

      <NoticeBanner notices={me.notices} tz={myTz} />

      <header className="hidden flex-col gap-[30px] lg:flex">
        <Rule className="text-[11px] tracking-[0.14em]">
          <span>{fmt(now, myTz, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span>
          <span>{issue.days === 1 ? "1 day" : `${issue.days} days`} of us</span>
          <span className="text-accent-ink">Only you two</span>
        </Rule>
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-[18px]">
          <div className="flex flex-[1_1_380px] flex-col gap-1">
            <h1 className="m-0 font-display text-[clamp(40px,5vw,68px)] font-normal leading-[0.95] tracking-[-0.02em]">
              {greeting(myTz).replace(/^./, (c) => c.toUpperCase())}, <span className="font-black italic text-accent">{me.user.displayName || "you"}.</span>
            </h1>
            {fresh ? <span className="font-hand text-[26px] text-accent-ink">a letter from {pName} is waiting for you ♡</span> : null}
          </div>
          {partner ? (
            <div className="flex items-center gap-[22px]" role="group" aria-label={`Your clocks. You: ${myT} ${myAp}. ${pName}: ${thT} ${thAp}.`}>
              <div className="flex flex-col" aria-hidden="true">
                <span className="font-type text-[10.5px] uppercase tracking-[0.16em] text-accent-ink">You · {cityOf(myTz)}</span>
                <span className="font-display text-[44px] font-semibold leading-none">
                  {myT}
                  <span className="text-xl italic"> {myAp}</span>
                </span>
              </div>
              <Heart size={24} />
              <div className="flex flex-col" aria-hidden="true">
                <span className="font-type text-[10.5px] uppercase tracking-[0.16em]" style={{ color: theirInk }}>
                  {pName} · {cityOf(partner.timeZone)}
                </span>
                <span className="font-display text-[44px] font-semibold leading-none">
                  {thT}
                  <span className="text-xl italic"> {thAp}</span>
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </header>

      <div className="flex flex-col gap-[22px] lg:grid lg:grid-cols-[1.45fr_1fr] lg:items-start lg:gap-7">
        <section aria-label="Cover story" className="relative h-[486px] lg:h-[600px]">
          <Link
            href={nextPlan ? `/plans/${nextPlan.plan.id}` : "/plans/new"}
            className="absolute inset-x-1 top-2.5 block h-[460px] -rotate-[1.4deg] lg:h-[584px] lg:-rotate-[1.2deg] lg:p-3 bg-paper p-[9px] text-[#FFFDF9] no-underline shadow-[0_26px_40px_-22px_rgba(0,0,0,0.55)]"
          >
            <div className="relative size-full overflow-hidden">
              {cover?.coverId ? (
                // eslint-disable-next-line @next/next/no-img-element -- served by our API
                <img src={photoUrl(cover.coverId, "full")} alt={cover.title} className="bw block size-full object-cover" />
              ) : (
                <Film seed={3} className="size-full" />
              )}
              <span className="absolute left-3.5 top-3.5 font-type text-[10.5px] tracking-[0.16em]">COVER STORY</span>
              <div className="absolute bottom-[18px] left-4 right-4 flex flex-col gap-0.5 [text-shadow:0_2px_14px_rgba(0,0,0,0.45)]">
                {nextPlan ? (
                  <>
                    <span className="font-display text-[58px] font-bold leading-[0.9] tracking-[-0.02em] lg:text-[clamp(52px,6vw,86px)]">
                      {sleeps <= 0 ? "Tonight" : sleeps === 1 ? "1 sleep" : `${sleeps} sleeps`}
                    </span>
                    <span className="font-display text-[26px] italic leading-[1.1]">
                      {sleeps <= 0 ? "" : "until "}
                      {nextPlan.plan.title}
                    </span>
                    <span className="mt-1 font-hand text-[22px]">
                      {fmt(nextPlan.at, myTz, { weekday: "short", day: "numeric", month: "short" })}, {timeOnly(nextPlan.at, myTz)}
                      {nextPlan.plan.place ? ` · ${nextPlan.plan.place}` : ""}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="font-display text-[58px] font-bold leading-[0.9] tracking-[-0.02em] lg:text-[clamp(52px,6vw,86px)]">Nº {issue.no}</span>
                    <span className="font-display text-[26px] italic leading-[1.1]">nothing to count down to yet</span>
                    <span className="mt-1 font-hand text-[22px]">plan something, and it goes on the cover →</span>
                  </>
                )}
              </div>
            </div>
          </Link>
          <Tape className="left-6 top-0 h-[26px] w-24 opacity-90" rotate={-12} />
          <Tape tone="tape" className="right-[22px] top-1 h-6 w-[84px] opacity-95" rotate={9} />
          <SpinStamp
            text={issue.months >= 1 ? `· ${issue.months} ${issue.months === 1 ? "MONTH" : "MONTHS"} OF US · YOU & ME ` : "· OUR FIRST MONTH · YOU & ME "}
            size={112}
            className="absolute -right-1.5 bottom-1.5"
          />
        </section>
  
      <div className="flex flex-col gap-[22px] lg:gap-[18px] lg:pt-4">
        <section aria-label="Inside this issue" className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2.5 lg:hidden">
            <span className="font-type text-[11px] tracking-[0.16em]">INSIDE THIS ISSUE</span>
            <span className="h-px flex-1 bg-ink" />
          </div>
          <div className="grid grid-cols-[1.15fr_1fr] gap-3 lg:grid-cols-1 lg:gap-[18px]">
            {nextPlan ? (
              <Link
                href={`/plans/${nextPlan.plan.id}`}
                className="relative flex flex-col gap-1.5 rounded-2xl bg-paper px-3.5 pb-3 pt-3.5 text-ink no-underline shadow-[0_12px_24px_-16px_rgba(0,0,0,0.4)]"
              >
                <span className="font-type text-[10.5px] font-bold uppercase tracking-[0.16em] text-accent-ink">
                  {sleeps <= 0 ? "Tonight" : sleeps === 1 ? "Tomorrow" : fmt(nextPlan.at, myTz, { weekday: "long" })}
                </span>
                <span className="font-display text-[25px] font-bold italic leading-none">{nextPlan.plan.title}</span>
                <span className="text-[13px] leading-[1.4]">
                  <strong>{timeOnly(nextPlan.at, myTz)}</strong> you
                  {partner && !theirTime(nextPlan.at, myTz, partner.timeZone).sameZoneTime ? (
                    <>
                      <br />
                      <strong>{theirTime(nextPlan.at, myTz, partner.timeZone).text}</strong> {pName}
                    </>
                  ) : null}
                </span>
                {nextPlan.plan.notes ? (
                  <span className="mt-1 truncate border-t-[1.5px] border-dashed border-muted pt-2 font-hand text-[19px]" style={{ color: nextPlan.plan.createdBy === me.user.id ? myInk : theirInk }}>
                    {nextPlan.plan.notes}
                  </span>
                ) : null}
                <span className="absolute -right-2 top-1/2 size-4 rounded-full bg-ground" />
              </Link>
            ) : (
              <Link href="/plans/new" className="flex flex-col justify-between gap-2 rounded-2xl border-[1.5px] border-dashed border-ink p-3.5 text-ink no-underline">
                <span className="font-type text-[10.5px] font-bold tracking-[0.16em] text-accent-ink">NOTHING PLANNED</span>
                <span className="font-display text-[22px] font-bold italic leading-none">Make a plan</span>
                <span className="font-hand text-[19px] text-muted">a call counts too</span>
              </Link>
            )}
  
            <Link
              href={fresh ? `/notes/${fresh.id}` : waiting ? "/notes" : "/notes/new"}
              className="relative flex min-h-[168px] flex-col justify-end gap-1 overflow-hidden rounded-md bg-petal p-3 text-ink no-underline shadow-[0_12px_24px_-16px_rgba(0,0,0,0.4)]"
            >
              <span className="washi absolute inset-x-0 top-0 h-[72px] bg-paper opacity-55" />
              <span className="absolute left-1/2 top-[50px] -ml-[19px] flex size-[38px] items-center justify-center rounded-full bg-accent-ink shadow-[0_3px_6px_rgba(0,0,0,0.25)]">
                <Heart size={18} color="var(--on-accent)" />
              </span>
              <span className="font-hand text-2xl leading-none">
                {fresh || waiting ? `a letter from ${pName}` : `write ${pName} a letter`}
              </span>
              <span className="font-type text-[10px] uppercase tracking-[0.12em]">
                {fresh ? "Unopened · tap to break the seal" : waiting ? `Opens ${opensLabel(waiting.deliverAt!, myTz)}` : "Sealed until the time you pick"}
              </span>
            </Link>
          </div>
        </section>
  
      <div className="hidden lg:block">
        <Link
          href={together ? `/together/${together.id}` : "/together"}
          className="flex items-center gap-4 rounded-[20px] bg-paper px-4 py-3.5 text-ink no-underline shadow-[0_12px_24px_-16px_rgba(0,0,0,0.4)]"
        >
          <div
            className={cx("flex size-24 flex-none items-center justify-center rounded-full bg-[repeating-radial-gradient(circle,#151112_0_2px,#2A2426_2px_4px)]", together?.status === "playing" && "bu-rec")}
            aria-hidden="true"
          >
            <div className="flex size-[34px] items-center justify-center rounded-full bg-accent">
              <div className="size-[5px] rounded-full bg-paper" />
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="font-type text-[10.5px] tracking-[0.16em] text-accent-ink">TOGETHER</span>
            <span className="truncate font-display text-[26px] font-bold italic leading-none">{together ? together.title : "Press play at once"}</span>
            <span className="text-[13px] text-muted">
              {together
                ? together.startedBy === me.user.id
                  ? `Waiting for ${pName}`
                  : `${pName} started it`
                : "Watch or listen, paused for both"}
            </span>
            <span className="mt-1 flex min-h-10 items-center self-start rounded-[20px] bg-nav px-3.5 text-[13px] font-medium text-nav-text">
              {together ? (together.startedBy === me.user.id ? "Go back in" : "Join") : "Listen together"}
            </span>
          </div>
        </Link>
  
      </div>
        </div>
      </div>

      {partner ? (
        <section
          aria-label={`Your clocks. You: ${myT} ${myAp}. ${pName}: ${thT} ${thAp}.`}
          className="flex flex-col gap-1.5 border-y border-ink py-3 lg:hidden"
        >
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2" aria-hidden="true">
            <div className="flex flex-col">
              <span className="font-type text-[10.5px] tracking-[0.16em] text-accent-ink">YOU</span>
              <span className="font-display text-[40px] font-semibold leading-none">
                {myT}
                <span className="text-lg italic"> {myAp}</span>
              </span>
              <span className="text-xs text-muted">{cityOf(myTz)}</span>
            </div>
            <Heart size={26} />
            <div className="flex flex-col items-end">
              <span className="font-type text-[10.5px] uppercase tracking-[0.16em]" style={{ color: theirInk }}>
                {pName}
              </span>
              <span className="font-display text-[40px] font-semibold leading-none">
                {thT}
                <span className="text-lg italic"> {thAp}</span>
              </span>
              <span className="text-xs text-muted">{cityOf(partner.timeZone)}</span>
            </div>
          </div>
          {overlap ? <span className="text-center font-hand text-[22px] text-accent-ink">{overlap}</span> : null}
        </section>
      ) : null}

      <section aria-labelledby="newfrom" className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <h2 id="newfrom" className="m-0 font-display text-[26px] font-normal uppercase tracking-[0.08em] lg:font-type lg:text-[11px] lg:font-bold lg:tracking-[0.16em]">
            New from {pName}
          </h2>
          <Link href="/boards" className="flex min-h-11 items-center text-[13px] text-accent-ink">
            Boards →
          </Link>
        </div>
        {newPins === null ? null : newPins.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <span className="font-display text-2xl font-bold italic">Nothing new yet.</span>
            <Link href="/add" className="font-hand text-[22px] text-accent-ink">
              save something for {pName}?
            </Link>
          </div>
        ) : (
          <div className="relative h-[300px] lg:hidden">
            {newPins.slice(0, 3).map((p, i) => {
              const s = scatter[i];
              return (
                <Link key={p.id} href={`/pins/${p.id}`} className={cx("absolute block no-underline", s.pos, s.z)} style={{ transform: `rotate(${s.rot}deg)` }}>
                  <Polaroid caption={p.note || undefined} ink={theirInk} pad="p-[7px] pb-10">
                    {p.previewMediaId ? (
                      // eslint-disable-next-line @next/next/no-img-element -- served by our API
                      <img src={photoUrl(p.previewMediaId)} alt={p.title} className={cx("bw block w-full object-cover", s.h)} />
                    ) : (
                      <div className={cx("flex flex-col justify-end gap-1 border-[1.5px] border-ink p-2.5 text-ink", s.h)}>
                        <span className="font-type text-[9.5px] uppercase tracking-[0.14em] text-muted">{p.kind}</span>
                        <span className="line-clamp-3 font-display text-lg font-bold leading-[1.05]">{p.title}</span>
                      </div>
                    )}
                  </Polaroid>
                </Link>
              );
            })}
            <Tape tone="tape" className="left-[62px] top-1.5 z-[3] w-[70px]" rotate={-14} />
            {newPins.length > 1 ? <Tape className="left-[168px] top-[60px] z-[3]" rotate={10} /> : null}
            <span className="absolute bottom-1.5 right-[18px] -rotate-8 font-display text-[30px] font-bold italic text-accent">xo</span>
          </div>
        )}
        {newPins && newPins.length > 0 ? (
          <div className="hidden grid-cols-4 gap-[22px] pt-3 lg:grid">
            {newPins.slice(0, 4).map((p, i) => (
              <Link key={p.id} href={`/pins/${p.id}`} className="block no-underline" style={{ transform: `rotate(${[-3, 2, -1.5, 2.5][i]}deg)` }}>
                <Polaroid caption={p.note || undefined} ink={theirInk} pad="p-2 pb-11">
                  {p.previewMediaId ? (
                    // eslint-disable-next-line @next/next/no-img-element -- served by our API
                    <img src={photoUrl(p.previewMediaId)} alt={p.title} className="bw block aspect-[4/5] w-full object-cover" />
                  ) : (
                    <div className="flex aspect-[4/5] flex-col justify-end gap-1 border-[1.5px] border-ink p-3 text-ink">
                      <span className="font-type text-[10px] uppercase tracking-[0.14em] text-muted">{p.kind}</span>
                      <span className="line-clamp-4 font-display text-[22px] font-bold leading-[1.05]">{p.title}</span>
                    </div>
                  )}
                </Polaroid>
              </Link>
            ))}
          </div>
        ) : null}
      </section>

      <div className="lg:hidden">
      <Link
        href={together ? `/together/${together.id}` : "/together"}
        className="flex items-center gap-4 rounded-[20px] bg-paper px-4 py-3.5 text-ink no-underline shadow-[0_12px_24px_-16px_rgba(0,0,0,0.4)]"
      >
        <div
          className={cx("flex size-24 flex-none items-center justify-center rounded-full bg-[repeating-radial-gradient(circle,#151112_0_2px,#2A2426_2px_4px)]", together?.status === "playing" && "bu-rec")}
          aria-hidden="true"
        >
          <div className="flex size-[34px] items-center justify-center rounded-full bg-accent">
            <div className="size-[5px] rounded-full bg-paper" />
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="font-type text-[10.5px] tracking-[0.16em] text-accent-ink">TOGETHER</span>
          <span className="truncate font-display text-[26px] font-bold italic leading-none">{together ? together.title : "Press play at once"}</span>
          <span className="text-[13px] text-muted">
            {together
              ? together.startedBy === me.user.id
                ? `Waiting for ${pName}`
                : `${pName} started it`
              : "Watch or listen, paused for both"}
          </span>
          <span className="mt-1 flex min-h-10 items-center self-start rounded-[20px] bg-nav px-3.5 text-[13px] font-medium text-nav-text">
            {together ? (together.startedBy === me.user.id ? "Go back in" : "Join") : "Listen together"}
          </span>
        </div>
      </Link>

      </div>

      <div className={cx("flex flex-col gap-[22px]", yearAgo && "lg:grid lg:grid-cols-[1.6fr_1fr] lg:items-start lg:gap-7")}>
      {yearAgo ? (
        <section aria-labelledby="arch" className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2.5">
            <h2 id="arch" className="m-0 font-type text-[11px] font-normal tracking-[0.16em]">
              FROM THE ARCHIVE · {now.getFullYear() - new Date(yearAgo.happenedOn).getFullYear() === 1 ? "A YEAR" : `${now.getFullYear() - new Date(yearAgo.happenedOn).getFullYear()} YEARS`} AGO THIS WEEK
            </h2>
            <span className="h-px flex-1 bg-ink" />
          </div>
          <div className="relative px-1.5 pt-2.5">
            <Polaroid rotate={1.2} pad="p-[9px] pb-[54px]" caption={yearAgo.caption || yearAgo.title} ink={yearAgo.createdBy === me.user.id ? myInk : theirInk}>
              {yearAgo.coverId ? (
                // eslint-disable-next-line @next/next/no-img-element -- served by our API
                <img src={photoUrl(yearAgo.coverId, "full")} alt={yearAgo.title} className="bw block h-[220px] w-full object-cover" />
              ) : (
                <Film seed={0} className="h-[220px] w-full" />
              )}
              <span className="absolute bottom-4 right-3 font-type text-[10px] tracking-[0.12em] text-muted">
                {new Date(`${yearAgo.happenedOn}T12:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit" }).replace(/\//g, ".")}
              </span>
            </Polaroid>
            <Tape tone="tape" className="left-1/2 top-0 -ml-[46px] h-6 w-[92px]" rotate={-3} />
          </div>
          <div className="flex gap-2">
            <ButtonLink href={`/story/${yearAgo.id}`} variant="secondary" className="min-h-[46px] text-sm">
              Open the memory
            </ButtonLink>
            <ButtonLink href={`/made/new?memory=${yearAgo.id}`} className="min-h-[46px] text-sm">
              Make something
            </ButtonLink>
          </div>
        </section>
      ) : null}

      <section className="relative flex flex-col gap-1.5 overflow-hidden rounded-[20px] bg-ink p-[18px] text-ground">
        <span className="font-type text-[10.5px] tracking-[0.16em]">NEXT ISSUE · Nº {issue.no + 1}</span>
        <span className="font-display text-[30px] leading-[1.05]">
          Comes out <span className="font-bold italic">{issue.next.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</span>
        </span>
        <span className="font-hand text-[22px] text-petal">slip something in before then ♡</span>
        <Heart size={70} className="absolute -bottom-2.5 -right-2 -rotate-[14deg]" />
      </section>

      </div>

      <BottomNav current="space" />
    </Screen>
  );
}
