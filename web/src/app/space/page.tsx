"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BottomNav } from "@/components/bottom-nav";
import { NoticeBanner } from "@/components/notice-banner";
import { ReadOnlyBanner } from "@/components/read-only-banner";
import { PinCard } from "@/components/pin-card";
import { Avatar, ButtonLink, Frames, Loading, Screen } from "@/components/ui";
import { api, cityOf, homeFor, partnerOf, timeIn, type Pin, type Plan } from "@/lib/api";
import { fmt, theirTime, timeOnly } from "@/lib/time";
import { useMe } from "@/lib/use-me";
import { useLiveTick } from "@/lib/live";

function greeting(tz: string): string {
  let h = new Date().getHours();
  try {
    h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(new Date()));
  } catch {}
  if (h < 5) return "Still up";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// B1 · Our Space. Plans ("Next together"), countdowns and memories join as their phases land.
export default function OurSpace() {
  const router = useRouter();
  const { me, loading, reload } = useMe();
  const [newPins, setNewPins] = useState<Pin[] | null>(null);
  const [nextPlan, setNextPlan] = useState<{ plan: Plan; at: string } | null>(null);
  const [now, setNow] = useState(() => new Date());

  const readOnly = !!me && !me.space && !!me.readOnlySpace;
  useEffect(() => {
    if (me && me.space?.status !== "active" && !readOnly) router.replace(homeFor(me));
  }, [me, router, readOnly]);

  const tick = useLiveTick(["pin.", "plan."], me?.space?.status === "active");
  const spaceTick = useLiveTick(["space."], !!me?.space);
  useEffect(() => {
    if (spaceTick) void reload();
  }, [spaceTick, reload]);
  useEffect(() => {
    if (me?.space?.status !== "active") return;
    api<{ newFromPartner: Pin[] }>("/space/home")
      .then((r) => setNewPins(r.newFromPartner))
      .catch(() => setNewPins([]));
    api<{ plans: Plan[] }>(`/plans?to=${encodeURIComponent(new Date(Date.now() + 60 * 86_400_000).toISOString())}`)
      .then((r) => {
        const occ = r.plans
          .flatMap((p) => (p.occurrences ?? []).filter((o) => Date.parse(o) > Date.now()).map((at) => ({ plan: p, at })))
          .sort((a, b) => a.at.localeCompare(b.at));
        setNextPlan(occ[0] ?? null);
      })
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
        <div className="flex items-center gap-2.5">
          <Avatar name={me.user.displayName} tint={me.user.personTint} ring />
          <span className="flex flex-col">
            <span className="font-display text-[19px] leading-[1.1]">{ro.name}</span>
            <span className="text-xs text-muted">You and {other?.displayName || "your person"} · closed</span>
          </span>
        </div>
        <ReadOnlyBanner name={ro.name} until={ro.until} />
        <nav aria-label="What you shared" className="grid grid-cols-3 gap-2.5">
          {([
            ["/boards", "Boards"],
            ["/plans", "Plans"],
            ["/story", "Our Story"],
          ] as const).map(([href, label]) => (
            <Link key={href} href={href} className="flex min-h-20 items-center justify-center rounded-(--radius-card) border border-line bg-surface font-display text-lg text-ink no-underline">
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
  const myTz = me.user.timeZone;
  const sameZone = partner && partner.timeZone === myTz;
  const people = [me.user, ...(partner ? [partner] : [])];
  const today = now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", timeZone: myTz });

  return (
    <Screen className="gap-[18px] px-4 pb-[120px] pt-14">
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-h-11 items-center gap-2.5">
          <span className="flex">
            <Avatar name={me.user.displayName} tint={me.user.personTint} ring />
            {partner ? (
              <span className="-ml-2">
                <Avatar name={partner.displayName} tint={partner.personTint} ring />
              </span>
            ) : null}
          </span>
          <span className="flex flex-col">
            <span className="font-display text-[19px] leading-[1.1]">{me.space.name}</span>
            <span className="flex items-center gap-[5px] text-xs text-muted">
              <Frames size={12} />
              Only you two
            </span>
          </span>
        </div>
        <Link
          href="/settings"
          aria-label="Settings"
          className="flex size-11 items-center justify-center rounded-(--radius-control) border border-line bg-surface text-ink"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
            <circle cx="16" cy="7" r="2" />
            <circle cx="10" cy="17" r="2" />
          </svg>
        </Link>
      </header>

      <NoticeBanner notices={me.notices} />

      <div className="flex flex-col gap-2">
        <span className="font-stamp text-[11px] uppercase tracking-[0.1em] text-muted">{today}</span>
        <h1 className="m-0 font-display text-[34px] font-normal leading-[1.05] tracking-[-0.02em]">
          {greeting(myTz)}, {me.user.displayName || "you"}.
        </h1>
      </div>

      {partner ? (
        <div
          className="flex flex-col gap-1.5 rounded-(--radius-card) border border-line bg-surface px-4 py-3.5"
          aria-label={`You: ${timeIn(myTz, now)}. ${partner.displayName}: ${timeIn(partner.timeZone, now)}${sameZone ? "" : ` in ${cityOf(partner.timeZone)}`}.`}
        >
          <div className="flex justify-between gap-3 text-[13px]">
            <span>
              <strong className="font-semibold text-terracotta-ink">You</strong>{" "}
              <span className="text-muted">{timeIn(myTz, now)}</span>
            </span>
            <span className="text-right">
              <strong className="font-semibold text-mauve-ink">{partner.displayName || "Them"}</strong>{" "}
              <span className="text-muted">
                {timeIn(partner.timeZone, now)}
                {sameZone ? "" : ` · ${cityOf(partner.timeZone)}`}
              </span>
            </span>
          </div>
          {sameZone ? <span className="text-[13px] text-muted">Same clock today.</span> : null}
        </div>
      ) : null}

      {nextPlan ? (
        <article className="relative overflow-hidden rounded-(--radius-sheet) bg-surface shadow-(--shadow-paper)">
          <div className="flex">
            <div className="flex min-w-0 flex-1 flex-col gap-2.5 py-5 pl-5 pr-[18px]">
              <span className="flex items-center gap-2 font-stamp text-[10px] uppercase tracking-[0.1em] text-shared-ink">
                <span className="size-[7px] rounded-[2px] bg-shared" />
                Next together
              </span>
              <h2 className="m-0 font-display text-[30px] font-normal leading-[1.05]">{nextPlan.plan.title}</h2>
              <div className="flex flex-col gap-0.5 text-sm">
                <span>
                  <strong className="font-semibold">{timeOnly(nextPlan.at, myTz)}</strong> <span className="text-muted">your time</span>
                </span>
                {partner && !theirTime(nextPlan.at, myTz, partner.timeZone).sameZoneTime ? (
                  <span>
                    <strong className="font-semibold">{theirTime(nextPlan.at, myTz, partner.timeZone).text}</strong>{" "}
                    <span className="text-muted">{partner.displayName}’s time</span>
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flex w-[84px] flex-col items-center justify-center gap-0.5 border-l-[1.5px] border-dashed border-line">
              <span className="font-stamp text-[10px] uppercase tracking-[0.1em] text-muted">{fmt(nextPlan.at, myTz, { weekday: "short" })}</span>
              <span className="font-display text-[44px] leading-none">{fmt(nextPlan.at, myTz, { day: "numeric" })}</span>
              <span className="font-stamp text-[10px] uppercase tracking-[0.1em] text-muted">{fmt(nextPlan.at, myTz, { month: "short" })}</span>
            </div>
          </div>
          <div className="px-4 pb-4">
            <ButtonLink href={`/plans/${nextPlan.plan.id}`} className="min-h-11 text-[15px]">
              Open plan
            </ButtonLink>
          </div>
        </article>
      ) : null}

      <section className="flex flex-col gap-3" aria-labelledby="newfrom">
        <div className="flex items-center justify-between">
          <h2 id="newfrom" className="m-0 font-display text-2xl font-normal">
            New from {partner?.displayName || "your person"}
          </h2>
          <Link href="/boards" className="flex min-h-11 items-center text-sm font-medium no-underline">
            Boards →
          </Link>
        </div>
        {newPins === null ? null : newPins.length === 0 ? (
          <div className="flex flex-col gap-3 rounded-(--radius-card) border border-dashed border-line-control p-4">
            <span className="text-sm leading-[1.5] text-muted">
              Nothing new from {partner?.displayName || "them"} yet. Places, songs, someday trips: save one for them.
            </span>
            <ButtonLink href="/add" variant="secondary" className="min-h-11 text-[15px]">
              Save something for us
            </ButtonLink>
          </div>
        ) : (
          <div className="-mr-4 flex gap-3.5 overflow-x-auto pb-1 pr-4">
            {newPins.map((p) => (
              <div key={p.id} className="w-[200px] flex-none">
                <PinCard pin={p} people={people} />
              </div>
            ))}
          </div>
        )}
      </section>

      <BottomNav current="space" />
    </Screen>
  );
}
