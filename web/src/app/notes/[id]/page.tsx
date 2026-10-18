"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BottomNav } from "@/components/bottom-nav";
import { opensLabel } from "@/components/note-letter";
import { NoteForm, toPayload, type NoteDraft } from "@/components/note-form";
import { Kicker, StatusStamp } from "@/components/print";
import { Button, ButtonLink, ErrorText, Heart, Loading, Screen, cx } from "@/components/ui";
import { api, cityOf, errorMessage, type Note } from "@/lib/api";
import { issueNoFor } from "@/lib/issue";
import { inkColor } from "@/lib/theme";
import { useLiveTick } from "@/lib/live";
import { dayLong, dayKey, fmt, timeOnly, toInputs } from "@/lib/time";
import { useSpace } from "@/lib/use-space";

function hourIn(tz: string): number {
  try {
    return Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(new Date()));
  } catch {
    return new Date().getHours();
  }
}

// One note, v2: sealed envelope (tap the heart seal), the letter, or (for its
// writer, before delivery) the editor.
export default function NoteDetail() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const { ready, me, partner, readOnly } = useSpace();
  const tick = useLiveTick(["note."], ready);
  const [note, setNote] = useState<Note | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    api<{ note: Note }>(`/notes/${id}`)
      .then((r) => setNote(r.note))
      .catch((e) => setError(errorMessage(e)));
  }, [ready, id, tick]);

  if (!ready || !me || (!note && !error)) return <Loading />;
  if (!note) {
    return (
      <Screen className="px-4">
        <ErrorText>{error}</ErrorText>
        <Link href="/notes">Back to notes</Link>
      </Screen>
    );
  }

  const myTz = me.user.timeZone;
  const pTz = partner?.timeZone ?? myTz;
  const pName = partner?.displayName || "your person";

  async function save(d: NoteDraft) {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ note: Note }>(`/notes/${id}`, { method: "PATCH", body: toPayload(d, myTz, pTz) });
      setNote(r.note);
      setEditing(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    try {
      await api(`/notes/${id}`, { method: "DELETE" });
      router.replace("/notes");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function keep(k: boolean) {
    try {
      await api(`/notes/${id}/keep`, { body: { keep: k } });
      setNote({ ...note!, kept: k });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const back = (
    <Link href="/notes" className="-ml-1.5 flex min-h-11 items-center gap-1 self-start text-[15px] text-ink no-underline">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 6l-6 6 6 6" />
      </svg>
      Notes
    </Link>
  );

  // Writer, not yet delivered: editable.
  if (note.mine && note.state !== "delivered" && editing && !readOnly) {
    const when = note.state === "draft" ? "draft" : "at";
    const theirs = note.deliverTz === pTz && pTz !== myTz;
    const inputs = note.deliverAt ? toInputs(note.deliverAt, theirs ? pTz : myTz) : { date: dayKey(new Date(Date.now() + 86_400_000), myTz), time: "07:00" };
    return (
      <Screen className="gap-4">
        {back}
        <NoteForm
          initial={{ body: note.body ?? "", when, date: inputs.date, time: inputs.time, inTheirTime: theirs || pTz === myTz }}
          myTz={myTz}
          partner={partner}
          submitLabel="Save"
          busy={busy}
          error={error}
          onSubmit={save}
        />
      </Screen>
    );
  }

  async function breakSeal() {
    setOpening(true);
    try {
      const r = await api<{ note: Note }>(`/notes/${id}/open`, { body: {} });
      setNote(r.note);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setOpening(false);
    }
  }

  const author = note.mine ? me.user : partner;
  const authorInk = inkColor(author?.ink ?? (note.mine ? me.user.ink : "second"));
  const authorTz = note.mine ? myTz : pTz;
  const writtenAt = note.deliveredAt ?? note.deliverAt ?? note.createdAt;
  const sealed = note.state === "waiting" || (!note.mine && note.state === "delivered" && note.opened === false);
  const issueNo = issueNoFor(me.space?.activatedAt, writtenAt);

  return (
    <Screen className="gap-4 px-4 pb-[120px] pt-[50px]">
      <div className="flex items-center justify-between">
        <Link href="/notes" aria-label="Back to notes" className="-ml-2.5 flex size-11 items-center justify-center text-ink">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </Link>
        <span className="font-type text-[11px] tracking-[0.16em] text-muted">LITTLE THINGS{me.space ? ` · Nº ${issueNo}` : ""}</span>
        <span className="w-[34px]" />
      </div>

      {sealed ? (
        <div className="flex flex-col items-center gap-[22px] pt-[30px] text-center">
          <h1 className="m-0 font-display text-[40px] font-black italic leading-none">
            {note.state === "waiting" ? "Something’s coming." : "You’ve got mail."}
          </h1>
          <div className="relative h-[220px] w-full max-w-[320px]">
            <div className="absolute inset-0 rounded-md bg-petal shadow-[0_26px_40px_-22px_rgba(0,0,0,0.55)]" />
            <div className="washi absolute inset-x-0 bottom-0 h-[120px] bg-paper opacity-45" />
            <div className="washi absolute inset-x-0 top-0 h-32 rounded-t-md bg-paper opacity-75" />
            <span className="absolute bottom-4 left-[18px] text-left font-type text-[11px] uppercase leading-[1.6] tracking-[0.12em]">
              To: {me.user.displayName || "you"}, {cityOf(myTz)}
              <br />
              From: {pName}, {cityOf(pTz)}
            </span>
            <span className="absolute right-4 top-3.5 flex h-16 w-[54px] rotate-4 items-center justify-center rounded border-2 border-dashed border-accent-ink font-display text-xl font-bold italic text-accent-ink">
              xo
            </span>
            {note.state === "waiting" ? (
              <span className="absolute left-1/2 top-24 -ml-9 flex size-[72px] items-center justify-center rounded-full bg-accent-ink opacity-70 shadow-[0_6px_12px_rgba(0,0,0,0.3)]" aria-hidden="true">
                <Heart size={32} color="var(--on-accent)" />
              </span>
            ) : (
              <button
                type="button"
                onClick={breakSeal}
                disabled={opening}
                aria-label={`Break the seal and open ${pName}’s letter`}
                className="absolute left-1/2 top-24 -ml-9 flex size-[72px] cursor-pointer items-center justify-center rounded-full bg-accent-ink shadow-[0_6px_12px_rgba(0,0,0,0.3),inset_0_0_0_5px_rgba(255,255,255,0.12)] transition-transform duration-(--dur-base) active:scale-90 disabled:opacity-70"
              >
                <Heart size={32} color="var(--on-accent)" />
              </button>
            )}
          </div>
          {note.state === "waiting" ? (
            <>
              <span className="-rotate-3 font-hand text-[28px] text-accent-ink">opens {opensLabel(note.deliverAt!, myTz)} ♡</span>
              <span className="font-type text-[11px] uppercase tracking-[0.12em] text-muted">Only who and when, until then</span>
            </>
          ) : (
            <>
              <span className="-rotate-3 font-hand text-[30px] text-accent-ink">tap the heart to open ♡</span>
              <span className="font-type text-[11px] uppercase tracking-[0.12em] text-muted">
                Sent {fmt(writtenAt, myTz, { weekday: "short", day: "numeric", month: "short" })} · {timeOnly(writtenAt, pTz)} {pTz === myTz ? "" : "their time"}
              </span>
              <span className="text-xs text-muted">{pName} will see when you opened it.</span>
            </>
          )}
        </div>
      ) : (
        <article
          className={cx(
            "lined relative -rotate-1 bg-paper px-[22px] pb-[30px] pt-[26px] shadow-[0_26px_40px_-22px_rgba(0,0,0,0.5)]",
            note.state === "draft" && "outline-[1.5px] outline-dashed outline-line-control",
          )}
        >
          <span className="washi absolute -top-3.5 right-3.5 flex size-[46px] rotate-[14deg] items-center justify-center rounded-full bg-accent-ink" aria-hidden="true">
            <Heart size={20} color="var(--on-accent)" />
          </span>
          <span className="mb-4 block font-type text-[10.5px] uppercase tracking-[0.14em] text-muted">
            {fmt(writtenAt, authorTz, { weekday: "short", day: "numeric", month: "short" })} · {timeOnly(writtenAt, authorTz)} · {cityOf(authorTz)}
          </span>
          <p className="m-0 whitespace-pre-wrap font-type text-[15px] leading-[1.65]">{note.body}</p>
          <span className="mt-3.5 block -rotate-3 font-hand text-[34px]" style={{ color: authorInk }}>
            — {author?.displayName || pName}
          </span>
          <span className="mt-1 block font-type text-[10px] uppercase tracking-[0.1em] text-muted">
            {note.state === "draft" && "Draft · only you can see this"}
            {note.state === "scheduled" &&
              `Sends ${opensLabel(note.deliverAt!, note.deliverTz === pTz ? pTz : myTz)} ${note.deliverTz === pTz && pTz !== myTz ? `${pName}’s time` : "your time"}`}
            {note.state === "delivered" && (note.mine ? `Delivered ${dayLong(note.deliveredAt!, myTz)}` : `From ${pName} · ${dayLong(note.deliveredAt!, myTz)}`)}
          </span>
        </article>
      )}

      <ErrorText>{error}</ErrorText>

      {!readOnly && note.mine && note.state !== "delivered" ? (
        <div className="flex flex-col gap-2">
          <Button variant="secondary" onClick={() => setEditing(true)} className="min-h-[50px] text-[15px]">
            {note.state === "draft" ? "Edit or send" : "Edit"}
          </Button>
          <button type="button" onClick={remove} className="min-h-11 text-[15px] font-medium text-danger">
            Take it back
          </button>
        </div>
      ) : null}

      {note.mine && note.state === "delivered" ? (
        <div className="flex items-center gap-2.5 border-y border-ink py-3 text-sm">
          {note.readAt ? (
            <>
              <StatusStamp>Read</StatusStamp>
              <span>
                {dayLong(note.readAt, myTz)}, {timeOnly(note.readAt, myTz)}
                {pTz !== myTz ? <span className="text-muted"> · {timeOnly(note.readAt, pTz)} for {pName}</span> : null}
              </span>
            </>
          ) : (
            <>
              <StatusStamp color="var(--muted)">Delivered</StatusStamp>
              <span className="text-muted">{pName} hasn’t broken the seal yet.</span>
            </>
          )}
        </div>
      ) : null}

      {!note.mine && note.state === "delivered" && !sealed ? (
        <div className="flex flex-col gap-2">
          {!readOnly ? (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => keep(!note.kept)} aria-pressed={!!note.kept} className="min-h-[50px] text-sm">
                {note.kept ? "Kept in Our Story ♡" : "Keep in Our Story"}
              </Button>
            </div>
          ) : null}
          {!readOnly ? (
            <ButtonLink href="/notes/new" className="min-h-[54px]">
              Write back{pTz !== myTz ? `, for ${pName}’s ${hourIn(pTz) < 12 ? "morning" : hourIn(pTz) < 17 ? "afternoon" : "evening"}` : ""}
            </ButtonLink>
          ) : null}
          <span className="text-center text-xs text-muted">
            {pName} can see when you opened it. {!readOnly ? (
              <button type="button" onClick={remove} className="font-medium text-danger underline underline-offset-2">
                Delete
              </button>
            ) : null}
          </span>
        </div>
      ) : null}

      {note.mine && (note.state === "scheduled" || note.state === "delivered") ? (
        <section aria-labelledby="theirview" className="flex flex-col gap-2.5 pt-2">
          <Kicker id="theirview">What {pName} sees</Kicker>
          {note.state === "scheduled" ? (
            <div className="flex items-center gap-3.5">
              <span className="relative h-16 w-24 flex-none rounded bg-petal" aria-hidden="true">
                <span className="washi absolute inset-x-0 top-0 h-9 bg-paper opacity-75" />
                <span className="absolute left-1/2 top-6 -ml-3 flex size-6 items-center justify-center rounded-full bg-accent-ink">
                  <Heart size={12} color="var(--on-accent)" />
                </span>
              </span>
              <span className="text-sm leading-[1.45]">
                A sealed envelope from {me.user.displayName || "you"}: “opens {opensLabel(note.deliverAt!, pTz)}”. Only who and when, until then.
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-3.5">
              <span className="relative h-16 w-24 flex-none rounded bg-petal" aria-hidden="true">
                <span className="washi absolute inset-x-0 top-0 h-9 bg-paper opacity-75" />
                <span className="absolute left-1/2 top-6 -ml-3 flex size-6 items-center justify-center rounded-full bg-accent-ink">
                  <Heart size={12} color="var(--on-accent)" />
                </span>
              </span>
              <span className="text-sm leading-[1.45]">
                “You’ve got mail.” They tap the heart seal to open it, and that’s the moment you see as Read.
              </span>
            </div>
          )}
        </section>
      ) : null}

      <BottomNav current="space" readOnly={readOnly} />
    </Screen>
  );
}
