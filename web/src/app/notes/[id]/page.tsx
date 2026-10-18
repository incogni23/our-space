"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BottomNav } from "@/components/bottom-nav";
import { opensLabel } from "@/components/note-letter";
import { NoteForm, toPayload, type NoteDraft } from "@/components/note-form";
import { ErrorText, Loading, Screen } from "@/components/ui";
import { api, errorMessage, type Note } from "@/lib/api";
import { useLiveTick } from "@/lib/live";
import { dayLong, dayKey, toInputs } from "@/lib/time";
import { useSpace } from "@/lib/use-space";

// One note: sealed envelope, letter, or (for its writer, before delivery) the editor.
export default function NoteDetail() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const { ready, me, partner, readOnly } = useSpace();
  const tick = useLiveTick(["note."], ready);
  const [note, setNote] = useState<Note | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
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

  return (
    <Screen className="gap-5 px-4 pb-[120px] pt-[52px]">
      {back}

      {note.state === "waiting" ? (
        <div className="flex flex-col items-center gap-5 pt-6 text-center">
          <div className="relative h-[180px] w-full max-w-[300px]" aria-hidden="true">
            <span className="absolute inset-0 rounded-(--radius-note) bg-shared-wash" />
            <span className="absolute inset-x-0 top-0 h-24 bg-[#EBD3CE] [clip-path:polygon(0_0,100%_0,50%_100%)] dark:bg-[#5A3D43]" />
          </div>
          <h1 className="m-0 font-display text-[28px] font-normal leading-[1.15]">A note from {pName} is waiting.</h1>
          <p className="m-0 text-[15px] leading-[1.55] text-muted">Opens {opensLabel(note.deliverAt!, myTz)}, your time. Only who and when are shown until then.</p>
        </div>
      ) : (
        <article className="relative">
          <span className="absolute inset-[8px_-4px_-6px_6px] rotate-[1.5deg] rounded-(--radius-note) bg-shared-wash" aria-hidden="true" />
          <div className={`relative flex min-h-[260px] flex-col gap-4 rounded-(--radius-note) bg-surface p-5 shadow-(--shadow-paper) ${note.state === "draft" ? "border-[1.5px] border-dashed border-line-control" : ""}`}>
            <p className="m-0 whitespace-pre-wrap font-display text-[21px] italic leading-[1.5]">{note.body}</p>
            <span className="mt-auto font-stamp text-[10px] uppercase tracking-[0.08em] text-muted">
              {note.state === "draft" && "Draft · only you can see this"}
              {note.state === "scheduled" &&
                `Sends ${opensLabel(note.deliverAt!, note.deliverTz === pTz ? pTz : myTz)} ${note.deliverTz === pTz && pTz !== myTz ? `${pName}’s time` : "your time"}`}
              {note.state === "delivered" && (note.mine ? `Delivered ${dayLong(note.deliveredAt!, myTz)}` : `From ${pName} · ${dayLong(note.deliveredAt!, myTz)}`)}
            </span>
          </div>
        </article>
      )}

      <ErrorText>{error}</ErrorText>

      {!readOnly && note.mine && note.state !== "delivered" ? (
        <div className="flex flex-col gap-2">
          <button type="button" onClick={() => setEditing(true)} className="min-h-12 rounded-(--radius-control) border border-line bg-surface text-[15px] font-medium text-ink">
            {note.state === "draft" ? "Edit or send" : "Edit"}
          </button>
          <button type="button" onClick={remove} className="min-h-11 text-[15px] font-medium text-danger">
            Take it back
          </button>
        </div>
      ) : null}

      {note.mine && note.state === "delivered" ? (
        <p className="m-0 text-center text-xs text-muted">You’ll only ever see “Delivered”. Whether it was read stays with {pName}.</p>
      ) : null}

      {!readOnly && !note.mine && note.state === "delivered" ? (
        <div className="flex flex-col gap-2">
          <button type="button" onClick={() => keep(!note.kept)} aria-pressed={!!note.kept} className="min-h-12 rounded-(--radius-control) border border-line bg-surface text-[15px] font-medium text-ink">
            {note.kept ? "Kept · tap to unkeep" : "Keep this one"}
          </button>
          <button type="button" onClick={remove} className="min-h-11 text-[15px] font-medium text-danger">
            Delete
          </button>
        </div>
      ) : null}

      <BottomNav current="space" readOnly={readOnly} />
    </Screen>
  );
}
