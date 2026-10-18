"use client";

import Link from "next/link";
import type { Member, Plan, User } from "@/lib/api";
import { fmt, theirTime, timeOnly } from "@/lib/time";
import { cx } from "./ui";

export function planState(p: Plan, meId: string, partnerName: string): { label: string; tone: "ok" | "wait" | "you" } {
  if (p.status === "confirmed") return { label: "Both in", tone: "ok" };
  const lastMover = p.suggestedBy ?? p.createdBy;
  if (lastMover === meId) return { label: `Waiting for ${partnerName}`, tone: "wait" };
  return { label: p.suggestedBy ? `${partnerName} suggested another time` : "Your answer", tone: "you" };
}

/** One occurrence of a plan as a ticket row (D3). */
export function PlanRow({
  plan,
  at,
  me,
  partner,
  highlight,
}: {
  plan: Plan;
  at: string;
  me: User;
  partner?: Member;
  highlight?: boolean;
}) {
  const tz = me.timeZone;
  const pName = partner?.displayName || "them";
  const st = planState(plan, me.id, pName);
  const theirs = partner ? theirTime(at, tz, partner.timeZone) : null;
  return (
    <Link
      href={`/plans/${plan.id}`}
      className={cx(
        "relative grid grid-cols-[1fr_72px] items-stretch rounded-[18px] bg-paper text-ink no-underline shadow-[0_12px_24px_-16px_rgba(0,0,0,0.4)]",
        (highlight || st.tone === "you") && "outline-2 outline-offset-2 outline-accent",
      )}
    >
      <span className="flex min-w-0 flex-col gap-1 py-3 pl-4 pr-3">
        <span className="font-type text-[10px] font-bold uppercase tracking-[0.16em] text-accent-ink">{plan.kind === "call" ? "Call" : "Plan"}</span>
        <span className="truncate font-display text-[22px] font-bold italic leading-none">{plan.title}</span>
        <span className="text-[13px] text-muted">
          {timeOnly(at, tz)} you
          {theirs && !theirs.sameZoneTime ? ` · ${theirs.text} ${pName}` : ""}
          {plan.repeat === "weekly" ? ` · every ${fmt(at, plan.anchorTz, { weekday: "long" })}` : ""}
        </span>
        <span
          className={cx(
            "flex items-center gap-[5px] text-xs font-semibold",
            st.tone === "ok" ? "text-ok-ink" : st.tone === "you" ? "text-shared-ink" : "text-ink",
          )}
        >
          {st.tone === "ok" ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 7.5V12l3 2" />
            </svg>
          )}
          {st.label}
        </span>
      </span>
      <span className="flex flex-col items-center justify-center border-l-[1.5px] border-dashed border-muted">
        <span className="font-type text-[10px] uppercase tracking-[0.14em] text-muted">{fmt(at, tz, { weekday: "short" })}</span>
        <span className="font-display text-[32px] leading-none">{fmt(at, tz, { day: "numeric" })}</span>
        <span className="font-type text-[10px] uppercase tracking-[0.14em] text-muted">{fmt(at, tz, { month: "short" })}</span>
      </span>
      <span className="absolute -top-2 right-[64px] size-4 rounded-full bg-ground" aria-hidden="true" />
      <span className="absolute -bottom-2 right-[64px] size-4 rounded-full bg-ground" aria-hidden="true" />
    </Link>
  );
}
