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
        "grid grid-cols-[52px_1fr] items-center gap-3.5 rounded-2xl bg-surface px-3.5 py-3 text-ink no-underline",
        highlight || st.tone === "you" ? "shadow-(--ring-new)" : "shadow-(--shadow-paper)",
      )}
    >
      <span className="flex flex-col items-center border-r-[1.5px] border-dashed border-line pr-3">
        <span className="font-stamp text-[10px] uppercase text-muted">{fmt(at, tz, { weekday: "short" })}</span>
        <span className="font-display text-[28px] leading-none">{fmt(at, tz, { day: "numeric" })}</span>
      </span>
      <span className="flex min-w-0 flex-col gap-[3px]">
        <span className="truncate text-[15px] font-semibold">{plan.title}</span>
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
    </Link>
  );
}
