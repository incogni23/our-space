"use client";

import { useMemo, useState, type FormEvent } from "react";
import { cityOf, type Member } from "@/lib/api";
import { dayKey, dayShort, instantFor, theirTime, timeOnly } from "@/lib/time";
import { Button, ErrorText, cx } from "./ui";

export type NoteDraft = { body: string; when: "now" | "morning" | "at" | "draft"; date: string; time: string; inTheirTime: boolean };

export type NotePayload = { body: string; when: "now" | "at" | "draft"; local?: string; timeZone?: string };

/** Turns the form into what the API takes: "tomorrow morning" is 7:00 their time. */
export function toPayload(d: NoteDraft, myTz: string, partnerTz: string): NotePayload {
  if (d.when === "now" || d.when === "draft") return { body: d.body, when: d.when };
  if (d.when === "morning") {
    const tomorrow = dayKey(new Date(Date.now() + 86_400_000), partnerTz);
    return { body: d.body, when: "at", local: `${tomorrow}T07:00`, timeZone: partnerTz };
  }
  return { body: d.body, when: "at", local: `${d.date}T${d.time}`, timeZone: d.inTheirTime ? partnerTz : myTz };
}

export function NoteForm({
  initial,
  myTz,
  partner,
  submitLabel,
  busy,
  error,
  onSubmit,
}: {
  initial: NoteDraft;
  myTz: string;
  partner?: Member;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  onSubmit: (d: NoteDraft) => void;
}) {
  const [d, setD] = useState<NoteDraft>(initial);
  const pName = partner?.displayName || "them";
  const pTz = partner?.timeZone ?? myTz;
  const differentZone = pTz !== myTz;

  const at = useMemo(() => {
    const p = toPayload(d, myTz, pTz);
    if (p.when !== "at" || !p.local) return null;
    const [date, time] = p.local.split("T");
    return instantFor(date, time, p.timeZone!);
  }, [d, myTz, pTz]);

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit(d);
  }

  const options: Array<{ id: NoteDraft["when"]; label: string; hint: string }> = [
    { id: "now", label: "Now", hint: "Opens straight away" },
    { id: "morning", label: "Tomorrow morning", hint: `7:00 am ${differentZone ? `${pName}’s time` : ""}`.trim() },
    { id: "at", label: "Pick a time", hint: "A day that matters" },
    { id: "draft", label: "Keep as draft", hint: "Only you can see it" },
  ];

  return (
    <form onSubmit={submit} className="flex flex-1 flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="notebody" className="text-[13px] font-medium">
          For {pName}
        </label>
        <textarea
          id="notebody"
          rows={7}
          maxLength={2000}
          autoFocus
          value={d.body}
          onChange={(e) => setD({ ...d, body: e.target.value })}
          placeholder="good morning, you"
          className="lined resize-none rounded-[2px] border-0 bg-paper bg-local [background-position:0_23px] px-[22px] pb-4 pt-[22px] font-type text-[15px] leading-[30px] text-ink shadow-[0_18px_30px_-20px_rgba(0,0,0,0.5)] placeholder:text-muted focus:outline-2 focus:outline-offset-2 focus:outline-ink"
        />
      </div>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-2 p-0 text-[13px] font-medium">When it opens</legend>
        <div role="radiogroup" className="grid grid-cols-2 gap-2">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={d.when === o.id}
              onClick={() => setD({ ...d, when: o.id })}
              className={cx(
                "flex min-h-[60px] flex-col items-start justify-center gap-0.5 rounded-(--radius-control) px-3 text-left text-ink",
                d.when === o.id ? "border-2 border-ink bg-surface" : "border border-line bg-ground",
              )}
            >
              <span className="text-sm font-semibold">{o.label}</span>
              <span className="text-xs text-muted">{o.hint}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {d.when === "at" ? (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-[1.3fr_1fr] gap-2">
            <label htmlFor="ndate" className="sr-only">
              Date
            </label>
            <input id="ndate" type="date" value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} className="h-12 rounded-(--radius-control) border border-line-control bg-surface px-3 text-base text-ink" />
            <label htmlFor="ntime" className="sr-only">
              Time
            </label>
            <input id="ntime" type="time" value={d.time} onChange={(e) => setD({ ...d, time: e.target.value })} className="h-12 rounded-(--radius-control) border border-line-control bg-surface px-3 text-base text-ink" />
          </div>
          {differentZone ? (
            <div role="radiogroup" aria-label="Whose time" className="flex flex-wrap gap-1.5">
              {[true, false].map((theirs) => (
                <button
                  key={String(theirs)}
                  type="button"
                  role="radio"
                  aria-checked={d.inTheirTime === theirs}
                  onClick={() => setD({ ...d, inTheirTime: theirs })}
                  className={cx("min-h-10 rounded-[20px] border-[1.5px] border-ink px-3.5 text-[13px] font-medium", d.inTheirTime === theirs ? "bg-ink text-ground" : "text-ink")}
                >
                  {theirs ? `${pName}’s time (${cityOf(pTz)})` : `Your time (${cityOf(myTz)})`}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {at && partner ? (
        <p className="m-0 rounded-(--radius-control) bg-shared-wash px-3.5 py-2.5 text-sm leading-[1.5] text-shared-ink">
          Opens for {pName} at {timeOnly(at, pTz)} {dayShort(at, pTz)}
          {differentZone ? ` · ${theirTime(at, pTz, myTz).text} for you` : ""}.
        </p>
      ) : null}

      <ErrorText>{error}</ErrorText>

      <div className="mt-auto">
        <Button type="submit" loading={busy} disabled={!d.body.trim() || (d.when === "at" && !at)}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
