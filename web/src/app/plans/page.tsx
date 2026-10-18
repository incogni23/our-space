"use client";

import { useEffect, useMemo, useState } from "react";
import { BottomNav } from "@/components/bottom-nav";
import { ReadOnlyBanner } from "@/components/read-only-banner";
import { PlanRow } from "@/components/plan-row";
import { ButtonLink, ErrorText, Loading, Screen, Title, cx } from "@/components/ui";
import { api, errorMessage, type Plan } from "@/lib/api";
import { dayKey, fmt } from "@/lib/time";
import { useSpace } from "@/lib/use-space";
import { useLiveTick } from "@/lib/live";

type Occ = { plan: Plan; at: string };

// D3 · Plans: Coming up, and a month view.
export default function Plans() {
  const { ready, me, partner, readOnly, spaceName } = useSpace();
  const tick = useLiveTick(["plan."], ready);
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [view, setView] = useState<"up" | "month" | "history">("up");
  const [history, setHistory] = useState<Plan[] | null>(null);
  const [monthOffset, setMonthOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    api<{ plans: Plan[] }>("/plans")
      .then((r) => setPlans(r.plans))
      .catch((e) => setError(errorMessage(e)));
  }, [ready, tick]);

  useEffect(() => {
    if (!ready || view !== "history") return;
    api<{ plans: Plan[] }>("/plans/history")
      .then((r) => setHistory(r.plans))
      .catch((e) => setError(errorMessage(e)));
  }, [ready, view, tick]);

  const tz = me?.user.timeZone ?? "UTC";

  // Coming up: one-offs each time; weekly plans once, at their next occurrence.
  const upcoming = useMemo<Occ[]>(() => {
    if (!plans) return [];
    const list: Occ[] = [];
    for (const p of plans) {
      const occ = p.occurrences ?? [];
      if (p.repeat === "weekly") {
        if (occ[0]) list.push({ plan: p, at: occ[0] });
      } else {
        for (const at of occ) list.push({ plan: p, at });
      }
    }
    return list.sort((a, b) => a.at.localeCompare(b.at));
  }, [plans]);

  const allOcc = useMemo<Occ[]>(() => (plans ?? []).flatMap((p) => (p.occurrences ?? []).map((at) => ({ plan: p, at }))), [plans]);

  if (!ready || !me || (plans === null && !error)) return <Loading />;

  // Group by month in my zone.
  const groups: Array<{ label: string; items: Occ[] }> = [];
  for (const o of upcoming) {
    const label = fmt(o.at, tz, { month: "long", year: "numeric" });
    const g = groups[groups.length - 1];
    if (g && g.label === label) g.items.push(o);
    else groups.push({ label, items: [o] });
  }

  // Month grid
  const today = new Date();
  const [ty, tm] = dayKey(today, tz).split("-").map(Number);
  const first = new Date(Date.UTC(ty, tm - 1 + monthOffset, 1));
  const year = first.getUTCFullYear();
  const month = first.getUTCMonth();
  const daysIn = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const byDay = new Map<string, Occ[]>();
  for (const o of allOcc) {
    const k = dayKey(o.at, tz);
    byDay.set(k, [...(byDay.get(k) ?? []), o]);
  }
  const todayKey = dayKey(today, tz);

  return (
    <Screen className="gap-4 px-4 pb-[120px] pt-14">
      <div className="flex items-center justify-between">
        <Title className="text-[34px]">Plans</Title>
        {readOnly ? null : (
        <ButtonLink href="/plans/new" className="min-h-11 w-auto px-3.5 text-sm">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Plan something
        </ButtonLink>
        )}
      </div>

      {readOnly ? <ReadOnlyBanner name={spaceName} until={me.readOnlySpace?.until} /> : null}

      <div role="radiogroup" aria-label="View" className="grid grid-cols-3 rounded-(--radius-control) bg-sunken p-[3px]">
        {(["up", "month", "history"] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={view === v}
            onClick={() => setView(v)}
            className={cx("min-h-10 rounded-[9px] text-sm font-medium text-ink", view === v && "bg-surface")}
          >
            {v === "up" ? "Coming up" : v === "month" ? "Month" : "History"}
          </button>
        ))}
      </div>

      <ErrorText>{error}</ErrorText>

      {view === "history" ? (
        history === null ? null : history.length === 0 ? (
          <p className="m-0 pt-8 text-center text-[15px] text-muted">Plans you’ve had, and ones that didn’t happen, will collect here.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col overflow-hidden rounded-(--radius-card) border border-line bg-surface p-0">
            {history.map((p, i) => {
              const who = p.respondedBy === me.user.id ? "you" : partner?.displayName || "them";
              const outcome =
                p.status === "cancelled"
                  ? "Cancelled"
                  : p.status === "declined"
                    ? `Not this time · ${who}`
                    : p.status === "confirmed"
                      ? "You both went"
                      : "Never confirmed";
              const tone = p.status === "confirmed" ? "text-ok-ink" : p.status === "proposed" ? "text-muted" : "text-shared-ink";
              return (
                <li key={p.id} className={cx(i > 0 && "border-t border-sunken")}>
                  <a href={`/plans/${p.id}`} className="grid min-h-16 grid-cols-[52px_1fr] items-center gap-3 px-3.5 py-2.5 text-ink no-underline">
                    <span className="flex flex-col items-center">
                      <span className="font-stamp text-[10px] uppercase text-muted">{fmt(p.startsAt, tz, { month: "short" })}</span>
                      <span className="font-display text-2xl leading-none">{fmt(p.startsAt, tz, { day: "numeric" })}</span>
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className={cx("truncate text-[15px] font-semibold", p.status !== "confirmed" && "text-muted line-through decoration-1")}>{p.title}</span>
                      <span className={cx("text-xs font-medium", tone)}>
                        {outcome} · {fmt(p.startsAt, tz, { year: "numeric", weekday: "short" })}
                      </span>
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        )
      ) : view === "up" ? (
        upcoming.length === 0 ? (
          <div className="flex flex-col gap-2 pt-10 text-center">
            <h2 className="m-0 font-display text-2xl font-normal">Nothing on the calendar yet.</h2>
            <p className="m-0 text-[15px] leading-[1.55] text-muted">Is there something you want to look forward to?</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {groups.map((g) => (
              <div key={g.label} className="flex flex-col gap-2.5">
                <span className="pt-1 font-stamp text-[10px] uppercase tracking-[0.1em] text-muted">{g.label}</span>
                {g.items.map((o) => (
                  <PlanRow key={`${o.plan.id}-${o.at}`} plan={o.plan} at={o.at} me={me.user} partner={partner} />
                ))}
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setMonthOffset((m) => m - 1)}
              className="flex size-11 items-center justify-center rounded-(--radius-control) border border-line bg-surface"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </button>
            <span className="font-display text-[22px]">
              {first.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })}
            </span>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => setMonthOffset((m) => m + 1)}
              className="flex size-11 items-center justify-center rounded-(--radius-control) border border-line bg-surface"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {["MO", "TU", "WE", "TH", "FR", "SA", "SU"].map((d) => (
              <span key={d} className="py-1 font-stamp text-[10px] text-muted">
                {d}
              </span>
            ))}
            {Array.from({ length: lead }, (_, i) => (
              <span key={`l${i}`} />
            ))}
            {Array.from({ length: daysIn }, (_, i) => {
              const n = i + 1;
              const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(n).padStart(2, "0")}`;
              const items = byDay.get(key) ?? [];
              const label = `${n} ${first.toLocaleDateString(undefined, { month: "long", timeZone: "UTC" })}${items.length ? `: ${items.map((o) => o.plan.title).join(", ")}` : ""}`;
              return (
                <span
                  key={key}
                  aria-label={label}
                  className={cx(
                    "flex h-12 flex-col items-center justify-center gap-[3px] rounded-[10px] bg-surface text-sm font-medium",
                    key === todayKey && "border-2 border-ink",
                  )}
                >
                  <span>{n}</span>
                  <span className="flex h-[5px] gap-[3px]">
                    {items.slice(0, 3).map((o) => (
                      <span
                        key={o.plan.id + o.at}
                        className={cx(
                          "size-[5px] rounded-full",
                          o.plan.repeat === "weekly" ? "shadow-[inset_0_0_0_1.5px_var(--text-primary)]" : "bg-ink",
                        )}
                      />
                    ))}
                  </span>
                </span>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full shadow-[inset_0_0_0_1.5px_var(--text-primary)]" />
              Every week
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-ink" />
              Plan
            </span>
          </div>
        </div>
      )}

      <BottomNav current="plans" readOnly={readOnly} />
    </Screen>
  );
}
