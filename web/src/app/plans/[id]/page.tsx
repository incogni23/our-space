"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import { BottomNav } from "@/components/bottom-nav";
import { planState } from "@/components/plan-row";
import { Button, ErrorText, Loading, Screen, cx } from "@/components/ui";
import { api, cityOf, errorMessage, type Plan } from "@/lib/api";
import { dayKey, dayLong, dayShort, daysUntil, fmt, icsFor, instantFor, relDay, theirTime, timeOnly } from "@/lib/time";
import { useSpace } from "@/lib/use-space";
import { useLiveTick } from "@/lib/live";

// D2 · Plan detail
function PlanDetail() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const created = useSearchParams().get("created");
  const { ready, me, partner, readOnly } = useSpace();
  const tick = useLiveTick(["plan."], ready);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [sDate, setSDate] = useState("");
  const [sTime, setSTime] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tz = me?.user.timeZone ?? "UTC";
  const pName = partner?.displayName || "them";

  useEffect(() => {
    if (!ready) return;
    api<{ plan: Plan }>(`/plans/${id}`)
      .then((r) => setPlan(r.plan))
      .catch((e) => setError(errorMessage(e)));
  }, [ready, id, tick]);

  useEffect(() => {
    if (created && plan) setToast(plan.status === "proposed" ? `Added to Plans. ${pName} will see it.` : "Added to Plans.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [created, plan?.id]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const next = plan?.occurrences?.find((o) => Date.parse(o) > Date.now() - 2 * 3600_000) ?? plan?.startsAt;

  // Weekly plans: if my local time shifts later (DST in either zone), say so.
  const dstNote = useMemo(() => {
    if (!plan || plan.repeat !== "weekly" || !plan.occurrences?.length) return null;
    const first = timeOnly(plan.occurrences[0], tz);
    const changed = plan.occurrences.find((o) => timeOnly(o, tz) !== first);
    return changed ? { from: dayShort(changed, tz), time: timeOnly(changed, tz) } : null;
  }, [plan, tz]);

  async function respond(action: "accept" | "decline" | "suggest", e?: FormEvent) {
    e?.preventDefault();
    if (!plan) return;
    setBusy(action);
    setError(null);
    try {
      const body: Record<string, string> = { action };
      if (action === "suggest") {
        body.local = `${sDate}T${sTime}`;
        body.timeZone = tz;
      }
      const r = await api<{ plan: Plan }>(`/plans/${plan.id}/respond`, { body });
      const fresh = await api<{ plan: Plan }>(`/plans/${plan.id}`).catch(() => r);
      setPlan(fresh.plan);
      setSuggesting(false);
      setToast(action === "accept" ? "You’re both in." : action === "decline" ? "Okay. It’s off the list." : `Sent to ${pName}.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    if (!plan) return;
    setBusy("cancel");
    try {
      await api(`/plans/${plan.id}/cancel`, { body: {} });
      router.replace("/plans");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  }

  function addToCalendar() {
    if (!plan) return;
    const blob = new Blob([icsFor(plan)], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${plan.title.replace(/[^\w\s-]/g, "").trim() || "plan"}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function startSuggest() {
    const base = next ? new Date(next) : new Date();
    setSDate(dayKey(base, tz));
    setSTime(fmt(base, tz, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }));
    setSuggesting(true);
  }

  if (!ready || !me || (!plan && !error)) return <Loading />;
  if (!plan || !next) {
    return (
      <Screen className="px-4">
        <ErrorText>{error}</ErrorText>
        <Link href="/plans">Back to plans</Link>
      </Screen>
    );
  }

  const st = planState(plan, me.user.id, pName);
  const open = !readOnly && (plan.status === "proposed" || plan.status === "confirmed");
  const myTurn = !readOnly && plan.status === "proposed" && st.tone === "you";
  const n = daysUntil(next, tz);
  const theirs = partner ? theirTime(next, tz, partner.timeZone) : null;
  const sAt = suggesting ? instantFor(sDate, sTime, tz) : null;

  return (
    <Screen className="gap-[18px] px-4 pb-[170px] pt-[52px]">
      <Link href="/plans" className="-ml-1.5 flex min-h-11 items-center gap-1 self-start text-[15px] text-ink no-underline">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 6l-6 6 6 6" />
        </svg>
        Plans
      </Link>

      <div className="relative flex flex-col rounded-[18px] bg-surface shadow-(--shadow-paper)">
        <div className="flex flex-col gap-1 p-4">
          <span className="font-stamp text-[10px] uppercase tracking-[0.1em] text-shared-ink">{relDay(n)}</span>
          <span className="font-display text-[44px] leading-none">{fmt(next, tz, { day: "numeric" })}</span>
          <span className="font-stamp text-[11px] uppercase tracking-[0.1em] text-muted">
            {fmt(next, tz, { weekday: "short" })} · {fmt(next, tz, { month: "short" })} · {timeOnly(next, tz)}
          </span>
        </div>
        <div className="border-t-[1.5px] border-dashed border-line px-4 py-3 text-[13px] text-muted">
          {theirs && !theirs.sameZoneTime ? `${theirs.text} for ${pName} in ${cityOf(partner!.timeZone)}` : `Same time for ${pName}`}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h1 className="m-0 font-display text-[30px] font-black italic leading-[0.95] tracking-[-0.02em]">{plan.title}</h1>
        {open ? (
          <span
            className={cx(
              "flex items-center gap-1.5 self-start rounded-lg px-2.5 py-1.5 text-[13px] font-semibold",
              st.tone === "ok" ? "bg-ok-wash text-ok-ink" : st.tone === "you" ? "bg-shared-wash text-shared-ink" : "bg-sunken text-ink",
            )}
          >
            {st.tone === "ok" ? "Both in" : st.tone === "you" ? (plan.suggestedBy ? `${pName} suggested another time` : `${pName} asked you`) : st.label}
          </span>
        ) : (
          <span className="self-start rounded-lg bg-sunken px-2.5 py-1.5 text-[13px] font-semibold">
            {plan.status === "declined" ? "Not this time" : "Cancelled"}
          </span>
        )}
      </div>

      {plan.suggestedStartsAt && open ? (
        <div className="flex flex-col gap-1 rounded-(--radius-card) bg-time-wash px-4 py-3 text-sm leading-[1.5]">
          <span className="font-semibold text-time-ink">
            {plan.suggestedBy === me.user.id ? "You suggested" : `${pName} suggested`} {dayShort(plan.suggestedStartsAt, tz)}, {timeOnly(plan.suggestedStartsAt, tz)} your time
          </span>
          {partner && partner.timeZone !== tz ? (
            <span className="text-muted">
              {timeOnly(plan.suggestedStartsAt, partner.timeZone)} {dayShort(plan.suggestedStartsAt, partner.timeZone)} for {pName}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col rounded-(--radius-card) border border-line bg-surface">
        <div className="grid grid-cols-[24px_1fr] items-start gap-3 p-3.5">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
            <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
            <path d="M3.5 10h17M8 3v4M16 3v4" />
          </svg>
          <span className="flex flex-col gap-0.5">
            <span className="text-[15px] font-semibold">
              {dayLong(next, tz)} · {timeOnly(next, tz)}
            </span>
            <span className="text-[13px] text-muted">
              {plan.repeat === "weekly" ? `Every ${fmt(next, plan.anchorTz, { weekday: "long" })} at ${timeOnly(next, plan.anchorTz)} ${cityOf(plan.anchorTz)} time. ` : ""}
              {plan.kind === "call" ? "A call." : ""}
            </span>
          </span>
        </div>
        {dstNote ? (
          <div className="grid grid-cols-[24px_1fr] items-start gap-3 border-t border-sunken bg-time-wash p-3.5">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--status-time-ink)" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 7.5V12l3 2" />
            </svg>
            <span className="text-[13px] leading-[1.5]">
              <strong className="font-semibold text-time-ink">Clocks change.</strong> From {dstNote.from} this moves to {dstNote.time} for you.
            </span>
          </div>
        ) : null}
        {plan.place ? (
          <div className="grid grid-cols-[24px_1fr] items-start gap-3 border-t border-sunken p-3.5">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              <path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z" />
              <circle cx="12" cy="10" r="2" />
            </svg>
            <span className="flex flex-col gap-0.5">
              <span className="break-words text-[15px] font-semibold">{plan.place}</span>
              {plan.pinId ? (
                <Link href={`/pins/${plan.pinId}`} className="text-[13px]">
                  From the pin
                </Link>
              ) : null}
            </span>
          </div>
        ) : null}
        {plan.remind !== "none" ? (
          <div className="grid grid-cols-[24px_1fr] items-start gap-3 border-t border-sunken p-3.5">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z" />
              <path d="M10 20a2 2 0 0 0 4 0" />
            </svg>
            <span className="flex flex-col gap-0.5">
              <span className="text-[15px] font-semibold">
                {plan.remind === "evening_before"
                  ? `Reminder · ${dayShort(new Date(new Date(next).getTime() - 86_400_000), tz)}, 8:00 pm`
                  : `Reminder · ${timeOnly(new Date(new Date(next).getTime() - 3_600_000), tz)}`}
              </span>
              <span className="text-[13px] text-muted">For both of you, in your own time. Shown in the app.</span>
            </span>
          </div>
        ) : null}
        {plan.notes ? <p className="m-0 border-t border-sunken p-3.5 text-sm leading-[1.5]">{plan.notes}</p> : null}
      </div>

      {myTurn && !suggesting ? (
        <div className="flex flex-col gap-2">
          <Button onClick={() => respond("accept")} loading={busy === "accept"} disabled={!!busy}>
            {plan.suggestedStartsAt ? "Accept the new time" : "I’m in"}
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" className="min-h-12 text-[15px]" onClick={startSuggest} disabled={!!busy}>
              Suggest another time
            </Button>
            <Button variant="secondary" className="min-h-12 text-[15px]" onClick={() => respond("decline")} loading={busy === "decline"} disabled={!!busy}>
              Not this time
            </Button>
          </div>
        </div>
      ) : null}

      {suggesting ? (
        <form onSubmit={(e) => respond("suggest", e)} className="flex flex-col gap-2.5 rounded-(--radius-card) border border-line bg-surface p-3.5">
          <span className="text-[13px] font-medium">Another time · your time ({cityOf(tz)})</span>
          <div className="grid grid-cols-[1.3fr_1fr] gap-2">
            <label htmlFor="sdate" className="sr-only">
              Date
            </label>
            <input id="sdate" type="date" value={sDate} onChange={(e) => setSDate(e.target.value)} className="h-12 rounded-(--radius-control) border border-line-control bg-surface px-3 text-base text-ink" />
            <label htmlFor="stime" className="sr-only">
              Time
            </label>
            <input id="stime" type="time" value={sTime} onChange={(e) => setSTime(e.target.value)} className="h-12 rounded-(--radius-control) border border-line-control bg-surface px-3 text-base text-ink" />
          </div>
          {sAt && partner && partner.timeZone !== tz ? (
            <span className="text-[13px] text-muted">
              That’s {timeOnly(sAt, partner.timeZone)} {dayShort(sAt, partner.timeZone)} for {pName}.
            </span>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" className="min-h-12 text-[15px]" onClick={() => setSuggesting(false)}>
              Back
            </Button>
            <Button type="submit" className="min-h-12 text-[15px]" loading={busy === "suggest"} disabled={!sAt}>
              Send
            </Button>
          </div>
        </form>
      ) : null}

      <div className="flex flex-col gap-2.5">
        <span className="font-stamp text-[10px] uppercase tracking-[0.1em] text-muted">What happened</span>
        <ol className="m-0 flex list-none flex-col gap-2.5 p-0 text-sm leading-[1.45]">
          {(plan.events ?? []).map((e, i) => {
            const who = e.userId === me.user.id ? "You" : pName;
            const at = e.at ? ` ${dayShort(e.at, tz)}, ${timeOnly(e.at, tz)}` : "";
            const text = {
              created: `${who} planned it for${at}`,
              accepted: `${who} said yes`,
              declined: `${who} said not this time`,
              suggested: `${who} suggested${at}`,
              moved: `${who} moved it to${at}`,
              edited: `${who} changed the details`,
              cancelled: `${who} cancelled it`,
            }[e.action];
            return (
              <li key={i} className="flex gap-2.5">
                <span className="mt-1.5 size-2 flex-none rounded-full bg-ink" />
                <span>
                  {text}
                  <span className="block text-xs text-muted">{dayShort(e.when, tz)}, {timeOnly(e.when, tz)}</span>
                </span>
              </li>
            );
          })}
          {plan.status === "proposed" ? (
            <li className="flex gap-2.5">
              <span className="mt-1.5 size-2 flex-none rounded-full border-[1.5px] border-ink" />
              <span className="text-muted">
                {st.tone === "wait"
                  ? `${partner?.displayName || "They"} can accept, suggest another time, or say no.`
                  : "Your turn: accept, suggest another time, or say no."}
              </span>
            </li>
          ) : null}
        </ol>
      </div>

      <ErrorText>{error}</ErrorText>

      {open ? (
        <div className="flex flex-col gap-2">
          <Button variant="secondary" className="min-h-12 text-[15px]" onClick={addToCalendar}>
            Add to my phone’s calendar
          </Button>
          <button type="button" onClick={cancel} disabled={!!busy} className="min-h-11 text-[15px] font-medium text-danger">
            Cancel this plan
          </button>
        </div>
      ) : null}

      {toast ? (
        <div
          role="status"
          className="fixed inset-x-4 bottom-[104px] z-(--z-toast) mx-auto flex min-h-[52px] max-w-[408px] items-center gap-2.5 rounded-(--radius-card) bg-action px-4 text-sm text-action-text shadow-[0_12px_28px_-12px_rgba(46,35,41,0.6)]"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--shared-tone)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12.5l4.5 4.5L19 7" />
          </svg>
          {toast}
        </div>
      ) : null}

      <BottomNav current="plans" readOnly={readOnly} />
    </Screen>
  );
}

export default function PlanRoute() {
  return (
    <Suspense fallback={<Loading />}>
      <PlanDetail />
    </Suspense>
  );
}
