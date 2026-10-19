"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { KindIcon } from "@/components/pin-card";
import { Button, ErrorText, Frames, Loading, cx } from "@/components/ui";
import { api, errorMessage, photoUrl, uploadPhoto, type Board, type Photo, type Pin, type PinKind } from "@/lib/api";
import { sendOrQueue } from "@/lib/outbox";
import { useSpace } from "@/lib/use-space";

/** Same rules as the server's classify(), for the live preview only. */
function guessKind(text: string): PinKind {
  const t = text.trim();
  if (!t || /\s/.test(t) || !t.includes(".")) return "idea";
  const host = t.replace(/^https?:\/\//, "").split("/")[0].toLowerCase().replace(/^www\./, "");
  if (host === "maps.app.goo.gl" || host === "maps.apple.com" || host === "maps.google.com" || /^google\.[a-z.]+$/.test(host) && t.includes("/maps")) return "place";
  if (["open.spotify.com", "music.apple.com", "music.youtube.com", "soundcloud.com"].includes(host)) return "song";
  return "link";
}

const kindName = { link: "Link", place: "Place", song: "Song", idea: "Idea", photo: "Photo" } as const;

// C1 · Save something for us
export default function Add() {
  const router = useRouter();
  const { ready, partner } = useSpace({ write: true });
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [boardId, setBoardId] = useState<string | null>(null);
  const [newBoard, setNewBoard] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    api<{ boards: Board[] }>("/boards")
      .then((r) => {
        setBoards(r.boards);
        if (r.boards[0]) setBoardId(r.boards[0].id);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [ready]);

  const kind: PinKind = useMemo(() => (photo ? "photo" : guessKind(text)), [text, photo]);

  async function pickPhoto(f: File | undefined) {
    if (!f) return;
    setUploading(true);
    setError(null);
    try {
      setPhoto(await uploadPhoto(f));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }
  const target = newBoard?.trim() || boards?.find((b) => b.id === boardId)?.name || (boards?.length ? "" : "a new board");

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = photo ? { text, note, photoId: photo.id } : { text, note, title: kind === "idea" ? "" : title };
      if (newBoard?.trim()) body.newBoardName = newBoard.trim();
      else if (boardId) body.boardId = boardId;
      // Photos are already uploaded, so a photo pin can't wait offline; everything else can.
      const r = photo ? await api<{ pin: Pin }>("/pins", { body }) : await sendOrQueue<{ pin: Pin }>("/pins", body, text.slice(0, 60));
      if (!r) {
        router.replace("/boards"); // queued: the banner shows "waiting to send"
        return;
      }
      router.replace(`/boards/${r.pin.boardId}?saved=${r.pin.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (!ready || boards === null) return <Loading />;

  return (
    <main className="min-h-dvh bg-[var(--scrim)]">
      <Link href="/space" aria-label="Close" className="fixed inset-0" />
      <form
        onSubmit={save}
        aria-labelledby="sheettitle"
        className="relative mx-auto mt-[max(5vh,40px)] flex min-h-[calc(100dvh-max(5vh,40px))] w-full max-w-[440px] flex-col gap-4 rounded-t-(--radius-sheet) bg-surface px-[18px] pb-8 pt-2.5 shadow-(--shadow-sheet)"
      >
        <span className="h-1 w-9 self-center rounded-[2px] bg-line" aria-hidden="true" />
        <div className="flex items-center justify-between">
          <h1 id="sheettitle" className="m-0 font-display text-[26px] font-normal">
            Save something for us
          </h1>
          <Link href="/space" aria-label="Close" className="-mr-2.5 flex size-11 items-center justify-center text-ink">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </Link>
        </div>

        <Link href="/notes/new" className="flex min-h-11 items-center gap-2 self-start text-sm font-medium text-ink">
          Or write {partner?.displayName || "them"} a note →
        </Link>

        {photo ? (
          <div className="flex items-start gap-3.5">
            <div className="w-[132px] flex-none -rotate-2 bg-paper p-1.5 pb-6 shadow-[0_14px_24px_-14px_rgba(0,0,0,0.55)]">
              {/* eslint-disable-next-line @next/next/no-img-element -- served by our API */}
              <img src={photoUrl(photo.id)} alt="The photo you’re saving" className="bw block aspect-[4/5] w-full object-cover" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <label htmlFor="what" className="text-[13px] font-medium">
                Call it <span className="font-normal text-muted">(optional)</span>
              </label>
              <input
                id="what"
                maxLength={200}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="the window seat"
                className="h-[50px] rounded-(--radius-control) border border-line-control bg-surface px-3.5 text-[15px] text-ink placeholder:text-muted focus:border-2 focus:border-ink focus:outline-none"
              />
              <button type="button" onClick={() => setPhoto(null)} className="min-h-11 self-start text-sm font-medium text-ink underline underline-offset-[3px]">
                Use a link instead
              </button>
            </div>
          </div>
        ) : (
          <>
          <div className="flex flex-col gap-2">
            <label htmlFor="what" className="text-[13px] font-medium">
              Paste a link, or type anything
            </label>
            <input
              id="what"
              autoFocus
              required
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="maps.app.goo.gl/… or “cook his mother’s rajma”"
              className="h-[50px] rounded-(--radius-control) border border-line-control bg-surface px-3.5 text-[15px] text-ink placeholder:text-muted focus:border-2 focus:border-ink focus:outline-none"
            />
            {text.trim() ? (
              <div className="flex items-center gap-3 rounded-(--radius-control) border border-line bg-ground p-2.5">
                <span
                  className={cx(
                    "flex size-11 flex-none items-center justify-center rounded-lg",
                    kind === "place" ? "bg-terracotta-wash text-terracotta-ink" : kind === "song" ? "bg-mauve-wash text-mauve-ink" : "bg-sunken text-ink",
                  )}
                >
                  <KindIcon kind={kind} size={20} />
                </span>
                <span className="text-[13px] text-muted">
                  {kindName[kind]}
                  {kind === "idea" ? " · no link" : " · from the link"}
                </span>
              </div>
            ) : null}
          </div>
          <label className={cx("flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-(--radius-button) border-[1.5px] border-dashed border-ink text-sm font-medium text-ink", uploading && "opacity-60")}>
            <input type="file" accept="image/*" className="sr-only" disabled={uploading} onChange={(e) => void pickPhoto(e.target.files?.[0])} />
            <KindIcon kind="photo" size={18} />
            {uploading ? "Uploading…" : "Or add a photo"}
          </label>
          </>
        )}

        {!photo && kind !== "idea" && text.trim() ? (
          <div className="flex flex-col gap-2">
            <label htmlFor="title" className="text-[13px] font-medium">
              Call it <span className="font-normal text-muted">(optional)</span>
            </label>
            <input
              id="title"
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Kaapi Katte, Basavanagudi"
              className="h-[50px] rounded-(--radius-control) border border-line-control bg-surface px-3.5 text-[15px] text-ink placeholder:text-muted focus:border-2 focus:border-ink focus:outline-none"
            />
          </div>
        ) : null}

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 p-0 text-[13px] font-medium">Save to</legend>
          <div className="flex flex-wrap gap-2">
            {boards.map((b) => {
              const on = newBoard === null && boardId === b.id;
              return (
                <button
                  key={b.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setBoardId(b.id);
                    setNewBoard(null);
                  }}
                  className={cx(
                    "min-h-10 rounded-[10px] border px-3.5 text-sm",
                    on ? "border-action bg-action font-semibold text-action-text" : "border-line bg-ground font-medium text-ink",
                  )}
                >
                  {b.name}
                </button>
              );
            })}
            {newBoard === null ? (
              <button
                type="button"
                onClick={() => setNewBoard("")}
                className="min-h-10 rounded-[10px] border border-dashed border-line-control bg-surface px-3.5 text-sm font-medium text-ink"
              >
                + New board
              </button>
            ) : (
              <span className="flex w-full gap-2">
                <label htmlFor="newboard" className="sr-only">
                  New board name
                </label>
                <input
                  id="newboard"
                  autoFocus
                  maxLength={60}
                  value={newBoard}
                  onChange={(e) => setNewBoard(e.target.value)}
                  placeholder="New board name"
                  className="h-11 min-w-0 flex-1 rounded-[10px] border-2 border-ink bg-surface px-3 text-sm text-ink placeholder:text-muted focus:outline-none"
                />
                <button type="button" onClick={() => setNewBoard(null)} className="min-h-11 px-2 text-sm text-muted underline">
                  Cancel
                </button>
              </span>
            )}
          </div>
          {boards.length === 0 && newBoard === null ? (
            <span className="text-xs text-muted">Your first save starts your first board.</span>
          ) : null}
        </fieldset>

        <div className="flex flex-col gap-2">
          <label htmlFor="why" className="text-[13px] font-medium">
            Why are you saving it? <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id="why"
            rows={2}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="resize-none rounded-(--radius-control) border border-line-control bg-surface px-3.5 py-2.5 font-hand text-[22px] leading-[1.15] text-my-ink focus:border-2 focus:border-ink focus:outline-none"
          />
        </div>

        <ErrorText>{error}</ErrorText>

        <div className="mt-auto flex flex-col gap-2.5">
          <span className="flex items-center gap-2 text-[13px] text-muted">
            <Frames size={16} />
            Between us{target ? ` · ${partner?.displayName || "they"} will find it in ${target}` : ""}
          </span>
          <Button type="submit" loading={busy} disabled={(!photo && !text.trim()) || uploading || (newBoard !== null && !newBoard.trim())}>
            Save
          </Button>
        </div>
      </form>
    </main>
  );
}
