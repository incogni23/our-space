"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { BottomNav } from "@/components/bottom-nav";
import { KindIcon } from "@/components/pin-card";
import { Avatar, ErrorText, Frames, Loading, Screen, cx } from "@/components/ui";
import { ago, api, errorMessage, type Pin, type PinNote, type PinStatus } from "@/lib/api";
import { useSpace } from "@/lib/use-space";

const STATUSES: Array<{ id: PinStatus; label: string }> = [
  { id: "saved", label: "Saved" },
  { id: "planned", label: "Planned" },
  { id: "done", label: "Done" },
  { id: "remembered", label: "Remembered" },
];

// C3 · Pin detail
export default function PinDetail() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const { ready, me, people, partner } = useSpace();
  const [pin, setPin] = useState<Pin | null>(null);
  const [notes, setNotes] = useState<PinNote[]>([]);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    api<{ pin: Pin; notes: PinNote[] }>(`/pins/${id}`)
      .then((r) => {
        setPin(r.pin);
        setNotes(r.notes);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [ready, id]);

  async function setStatus(status: PinStatus) {
    if (!pin || pin.status === status) return;
    const prev = pin.status;
    setPin({ ...pin, status });
    try {
      await api(`/pins/${pin.id}`, { method: "PATCH", body: { status } });
    } catch (e) {
      setPin({ ...pin, status: prev });
      setError(errorMessage(e));
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!reply.trim() || !pin) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ note: PinNote }>(`/pins/${pin.id}/notes`, { body: { body: reply } });
      setNotes((n) => [...n, r.note]);
      setReply("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!pin) return;
    try {
      await api(`/pins/${pin.id}`, { method: "DELETE" });
      router.replace(`/boards/${pin.boardId}`);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (!ready || (!pin && !error)) return <Loading />;
  if (!pin) {
    return (
      <Screen className="px-4">
        <ErrorText>{error}</ErrorText>
        <Link href="/boards">Back to boards</Link>
      </Screen>
    );
  }

  const by = people.find((p) => p.id === pin.createdBy);
  const mine = pin.createdBy === me?.user.id;
  const tintBorder = (tint?: string) => (tint === "sage" ? "border-sage" : tint === "mauve" ? "border-mauve" : "border-terracotta");

  return (
    <Screen className="gap-4 px-4 pb-[120px] pt-[52px]">
      <Link href={`/boards/${pin.boardId}`} className="-ml-1.5 flex min-h-11 items-center gap-1 self-start text-[15px] text-ink no-underline">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 6l-6 6 6 6" />
        </svg>
        {pin.boardName || "Board"}
      </Link>

      <div className="flex flex-col gap-1.5">
        <span className="flex items-center gap-1.5 text-[13px] capitalize text-muted">
          <KindIcon kind={pin.kind} size={14} />
          {pin.kind}
        </span>
        <h1 className="m-0 break-words font-display text-[32px] font-normal leading-[1.05]">{pin.title}</h1>
        <span className="flex items-center gap-1.5 text-[13px] text-muted">
          <Frames size={13} />
          Between us · {pin.boardName} · saved by {mine ? "you" : by?.displayName}, {ago(pin.createdAt)}
        </span>
      </div>

      {pin.note ? (
        <div className={cx("flex flex-col gap-1.5 border-l-2 pl-3", tintBorder(by?.personTint))}>
          <span className="font-display text-[19px] italic leading-[1.4]">{pin.note}</span>
          <span className="text-xs font-medium text-muted">{mine ? "You" : by?.displayName}</span>
        </div>
      ) : null}

      <Link
        href={`/plans/new?pin=${pin.id}`}
        className="flex min-h-[52px] items-center justify-center gap-2.5 rounded-(--radius-card) bg-action text-base font-medium text-action-text no-underline"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
          <path d="M3.5 10h17M8 3v4M16 3v4" />
        </svg>
        Plan this
      </Link>

      {pin.url ? (
        <a
          href={pin.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-12 items-center justify-center gap-2 rounded-(--radius-control) border border-line bg-surface text-sm font-medium text-ink no-underline"
        >
          {pin.kind === "place" ? "Open in Maps" : pin.kind === "song" ? "Open to listen" : "Open link"}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
          </svg>
        </a>
      ) : null}

      <div className="flex flex-col gap-2">
        <span id="statuslabel" className="text-[13px] font-medium">
          Where it stands
        </span>
        <div role="radiogroup" aria-labelledby="statuslabel" className="grid grid-cols-4 rounded-(--radius-control) bg-sunken p-[3px]">
          {STATUSES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={pin.status === s.id}
              onClick={() => setStatus(s.id)}
              className={cx(
                "min-h-10 rounded-[9px] text-[13px] text-ink",
                pin.status === s.id ? "bg-surface font-semibold shadow-[0_1px_2px_rgba(68,53,62,0.1)]" : "font-medium",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <section className="flex flex-col gap-2.5" aria-labelledby="noteslabel">
        <h2 id="noteslabel" className="m-0 text-[13px] font-medium">
          Notes between you
        </h2>
        {notes.map((n) => {
          const a = people.find((p) => p.id === n.authorId);
          return (
            <div key={n.id} className="flex items-start gap-2.5">
              {a ? <Avatar name={a.displayName} tint={a.personTint} size={24} /> : null}
              <span className="flex flex-col gap-0.5">
                <span className="text-[15px] leading-[1.45]">{n.body}</span>
                <span className="text-xs text-muted">{ago(n.createdAt)}</span>
              </span>
            </div>
          );
        })}
        <form onSubmit={send} className="flex gap-2">
          <label htmlFor="reply" className="sr-only">
            Add a line for {partner?.displayName || "them"}
          </label>
          <input
            id="reply"
            maxLength={1000}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder={`Add a line for ${partner?.displayName || "them"}…`}
            className="h-12 min-w-0 flex-1 rounded-(--radius-control) border border-line-control bg-surface px-3.5 text-[15px] text-ink placeholder:text-muted focus:border-2 focus:border-ink focus:outline-none"
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={busy || !reply.trim()}
            className="flex size-12 items-center justify-center rounded-(--radius-control) border border-line bg-surface text-ink disabled:opacity-50"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </form>
      </section>

      <ErrorText>{error}</ErrorText>

      <button type="button" onClick={remove} className="mt-2 min-h-11 self-center text-sm font-medium text-danger">
        Remove from board
      </button>

      <BottomNav current="boards" />
    </Screen>
  );
}
