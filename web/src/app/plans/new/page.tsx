"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import { Button, ErrorText, Loading, cx } from "@/components/ui";
import { api, cityOf, errorMessage, type Pin, type Plan } from "@/lib/api";
import { dayKey, dayShort, instantFor, theirTime, timeOnly } from "@/lib/time";
import { useSpace } from "@/lib/use-space";

function Toggle({ id, checked, onChange, label, hint }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-3 px-3.5">
      <span className="flex flex-col">
        <span id={id} className="text-[15px] font-medium">
          {label}
        </span>
        {hint ? <span className="text-xs text-muted">{hint}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id}
        onClick={() => onChange(!checked)}
        className={cx("relative h-8 w-[52px] flex-none rounded-2xl", checked ? "bg-action" : "bg-line-control")}
      >
        <span className={cx("absolute top-[3px] size-[26px] rounded-full bg-surface transition-[left] duration-(--dur-quick)", checked ? "left-[23px]" : "left-[3px]")} />
      </button>
    </div>
  );
}

// D1 · Plan this
function NewPlan() {
  const router = useRouter();
  const pinId = useSearchParams().get("pin");
  const { ready, me, partner } = useSpace({ write: true });
  const tz = me?.user.timeZone ?? "UTC";
  const [pin, setPin] = useState<Pin | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"plan" | "call">("plan");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("19:00");
  const [place, setPlace] = useState("");
  const [notes, setNotes] = useState("");
  const [weekly, setWeekly] = useState(false);
  const [ask, setAsk] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!me) return;
    const tomorrow = new Date(Date.now() + 86_400_000);
    setDate((d) => d || dayKey(tomorrow, me.user.timeZone));
  }, [me]);

  useEffect(() => {
    if (!ready || !pinId) return;
    api<{ pin: Pin }>(`/pins/${pinId}`)
      .then((r) => {
        setPin(r.pin);
        setTitle((t) => t || r.pin.title);
        if (r.pin.kind === "place") setPlace((p) => p || r.pin.title);
      })
      .catch(() => {});
  }, [ready, pinId]);

  const at = useMemo(() => instantFor(date, time, tz), [date, time, tz]);
  const pName = partner?.displayName || "them";
  const theirs = at && partner ? theirTime(at, tz, partner.timeZone) : null;
  const differentZone = partner && partner.timeZone !== tz;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ plan: Plan }>("/plans", {
        body: {
          title,
          local: `${date}T${time}`,
          timeZone: tz,
          kind,
          repeat: weekly ? "weekly" : "none",
          place,
          notes,
          pinId: pinId ?? undefined,
          askToConfirm: ask,
        },
      });
      router.replace(`/plans/${r.plan.id}?created=1`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (!ready || !me) return <Loading />;
  const back = pin ? `/pins/${pin.id}` : "/plans";

  return (
    <main className="min-h-dvh bg-[var(--scrim)]">
      <Link href={back} aria-label="Close" className="fixed inset-0" />
      <form
        onSubmit={submit}
        aria-labelledby="plantitle"
        className="relative mx-auto mt-[max(4vh,32px)] flex min-h-[calc(100dvh-max(4vh,32px))] w-full max-w-[440px] flex-col gap-4 rounded-t-(--radius-sheet) bg-surface px-[18px] pb-8 pt-2.5 shadow-(--shadow-sheet)"
      >
        <span className="h-1 w-9 self-center rounded-[2px] bg-line" aria-hidden="true" />
        <div className="flex items-center justify-between gap-3">
          <h1 id="plantitle" className="m-0 font-display text-[26px] font-normal">
            {pin ? "Plan this" : "Plan something"}
          </h1>
          {pin ? <span className="truncate text-xs text-muted">From {pin.boardName}</span> : null}
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="ptitle" className="text-[13px] font-medium">
            What
          </label>
          <input
            id="ptitle"
            required
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Coffee at Kaapi Katte"
            className="h-[50px] rounded-(--radius-control) border border-line-control bg-surface px-3.5 text-[17px] text-ink placeholder:text-muted focus:border-2 focus:border-ink focus:outline-none"
          />
          <div role="radiogroup" aria-label="Kind" className="grid grid-cols-2 rounded-(--radius-control) bg-sunken p-[3px]">
            {(["plan", "call"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => setKind(k)}
                className={cx("min-h-10 rounded-[9px] text-sm font-medium text-ink", kind === k && "bg-surface")}
              >
                {k === "plan" ? "Meet up" : "Call"}
              </button>
            ))}
          </div>
        </div>

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 p-0 text-[13px] font-medium">When · your time ({cityOf(tz)})</legend>
          <div className="grid grid-cols-[1.3fr_1fr] gap-2">
            <label className="sr-only" htmlFor="pdate">
              Date
            </label>
            <input
              id="pdate"
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-12 rounded-(--radius-control) border border-line-control bg-surface px-3 text-base text-ink"
            />
            <label className="sr-only" htmlFor="ptime">
              Time
            </label>
            <input
              id="ptime"
              type="time"
              required
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="h-12 rounded-(--radius-control) border border-line-control bg-surface px-3 text-base text-ink"
            />
          </div>
        </fieldset>

        {at && partner ? (
          differentZone ? (
            <div className="flex flex-col gap-2 rounded-(--radius-control) bg-time-wash px-3.5 py-3 text-sm leading-[1.5]">
              <span className="flex items-start gap-2.5">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--status-time-ink)" strokeWidth="1.8" strokeLinecap="round" className="mt-0.5 flex-none" aria-hidden="true">
                  <circle cx="12" cy="12" r="8.5" />
                  <path d="M12 7.5V12l3 2" />
                </svg>
                <span>
                  <strong className="font-semibold text-time-ink">
                    {pName} is in {cityOf(partner.timeZone)}.
                  </strong>{" "}
                  {timeOnly(at, tz)} {dayShort(at, tz)} for you is <strong className="font-semibold">{timeOnly(at, partner.timeZone)} {dayShort(at, partner.timeZone)}</strong> for {pName}
                  {theirs && !theirs.sameDay ? (dayKey(at, partner.timeZone) < dayKey(at, tz) ? ", the day before" : ", the next day") : ""}.
                </span>
              </span>
              {kind === "plan" ? (
                <button
                  type="button"
                  onClick={() => setKind("call")}
                  className="ml-7 min-h-10 self-start rounded-[10px] border border-terracotta bg-surface px-3 text-sm font-medium text-time-ink"
                >
                  Make it a call instead
                </button>
              ) : null}
            </div>
          ) : (
            <div className="flex items-start gap-2.5 rounded-(--radius-control) bg-ok-wash px-3.5 py-3 text-sm leading-[1.5]">
              <span>
                <strong className="font-semibold text-ok-ink">Same clock.</strong> {timeOnly(at, tz)} for you is {timeOnly(at, tz)} for {pName}.
              </span>
            </div>
          )
        ) : null}

        <div className="flex flex-col gap-2">
          <label htmlFor="pplace" className="text-[13px] font-medium">
            {kind === "call" ? "Call link" : "Where"} <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="pplace"
            maxLength={200}
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            className="h-12 rounded-(--radius-control) border border-line-control bg-surface px-3.5 text-[15px] text-ink focus:border-2 focus:border-ink focus:outline-none"
          />
        </div>

        <div className="flex flex-col rounded-(--radius-card) border border-line">
          <Toggle id="asklbl" checked={ask} onChange={setAsk} label={`Invite ${pName} to confirm`} hint={`${partner?.displayName || "They"} can accept or suggest another time`} />
          <div className="border-t border-sunken">
            <Toggle id="weeklbl" checked={weekly} onChange={setWeekly} label="Every week" hint={weekly ? `Repeats at ${time} ${cityOf(tz)} time` : undefined} />
          </div>
          <div className="flex flex-col gap-2 border-t border-sunken px-3.5 py-3">
            <label htmlFor="pnotes" className="text-[13px] font-medium">
              Notes <span className="font-normal text-muted">(optional)</span>
            </label>
            <textarea
              id="pnotes"
              rows={2}
              maxLength={1000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="resize-none rounded-(--radius-control) border border-line-control bg-surface px-3 py-2.5 text-[15px] text-ink focus:border-2 focus:border-ink focus:outline-none"
            />
          </div>
        </div>

        <ErrorText>{error}</ErrorText>

        <div className="mt-auto">
          <Button type="submit" loading={busy} disabled={!title.trim() || !at}>
            Add to Plans
          </Button>
        </div>
      </form>
    </main>
  );
}

export default function NewPlanRoute() {
  return (
    <Suspense fallback={<Loading />}>
      <NewPlan />
    </Suspense>
  );
}
