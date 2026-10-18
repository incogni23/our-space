"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { BottomNav } from "@/components/bottom-nav";
import { ReadOnlyBanner } from "@/components/read-only-banner";
import { StatusStamp } from "@/components/print";
import { Button, ButtonLink, ErrorText, Loading, PrintTitle, Rule, Screen, Tape } from "@/components/ui";
import { api, errorMessage, type Board } from "@/lib/api";
import { useSpace } from "@/lib/use-space";
import { useLiveTick } from "@/lib/live";

// Boards index
export default function Boards() {
  const { ready, people, readOnly, spaceName, me } = useSpace();
  const tick = useLiveTick(["board.", "pin."], ready);
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    api<{ boards: Board[] }>("/boards")
      .then((r) => setBoards(r.boards))
      .catch((e) => setError(errorMessage(e)));
  }, [ready, tick]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ board: Board }>("/boards", { body: { name } });
      setBoards((b) => [{ ...r.board, pinCount: 0, plannedCount: 0 }, ...(b ?? [])]);
      setName("");
      setAdding(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!ready || boards === null) return <Loading />;

  return (
    <Screen wide className="gap-4 px-4 pb-[120px] pt-[50px]">
      <header className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="font-type text-[11px] tracking-[0.16em] text-muted">THE SCRAPBOOK</span>
          {!adding && !readOnly ? (
            <button type="button" onClick={() => setAdding(true)} className="min-h-11 px-1 text-[13px] font-medium text-accent-ink">
              + New board
            </button>
          ) : null}
        </div>
        <PrintTitle className="text-[56px] leading-[0.88]">Boards</PrintTitle>
        <span className="origin-left -rotate-[1.5deg] font-hand text-2xl text-accent-ink">everything we keep meaning to do</span>
        <Rule className="mt-1.5">
          <span>
            {boards.length} {boards.length === 1 ? "board" : "boards"}
          </span>
          <span>{boards.reduce((n, b) => n + b.pinCount, 0)} things</span>
          <span className="text-accent-ink">{boards.reduce((n, b) => n + b.plannedCount, 0)} planned</span>
        </Rule>
      </header>

      {adding ? (
        <form onSubmit={create} className="flex gap-2">
          <label htmlFor="boardname" className="sr-only">
            Board name
          </label>
          <input
            id="boardname"
            autoFocus
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Restaurants to try"
            className="h-12 min-w-0 flex-1 rounded-(--radius-control) border border-line-control bg-surface px-3.5 text-base text-ink placeholder:text-muted focus:border-2 focus:border-ink focus:outline-none"
          />
          <Button type="submit" className="min-h-12 w-auto px-4 text-[15px]" loading={busy} disabled={!name.trim()}>
            Add
          </Button>
        </form>
      ) : null}

      {readOnly ? <ReadOnlyBanner name={spaceName} until={me?.readOnlySpace?.until} /> : null}

      <ErrorText>{error}</ErrorText>

      {boards.length === 0 ? (
        readOnly ? (
          <p className="m-0 pt-6 text-center text-[15px] text-muted">Nothing was saved here.</p>
        ) : (
        <div className="flex flex-col gap-3 pt-6 text-center">
          <h2 className="m-0 font-display text-2xl font-bold italic">A board for anything.</h2>
          <p className="m-0 text-[15px] leading-[1.55] text-muted">Places, songs, someday trips. Start with one.</p>
          <ButtonLink href="/add" className="mt-2">
            Save something for us
          </ButtonLink>
        </div>
        )
      ) : (
        <ul className="m-0 grid list-none grid-cols-2 gap-x-3.5 gap-y-5 p-0 pt-2 lg:grid-cols-4 lg:gap-x-6 lg:gap-y-8">
          {boards.map((b, i) => {
            const by = people.find((p) => p.id === b.createdBy);
            const rot = [-1.5, 1.2, 1, -1.2][i % 4];
            return (
              <li key={b.id} className="relative">
                <Link
                  href={`/boards/${b.id}`}
                  className="flex min-h-[150px] flex-col justify-between gap-3 bg-paper p-3.5 text-ink no-underline shadow-[0_14px_24px_-14px_rgba(0,0,0,0.55)]"
                  style={{ transform: `rotate(${rot}deg)` }}
                >
                  <span className="break-words font-display text-[22px] font-bold italic leading-[1.05]">{b.name}</span>
                  <span className="flex flex-col gap-1.5">
                    <span className="font-type text-[10px] uppercase tracking-[0.12em] text-muted">
                      {b.pinCount} {b.pinCount === 1 ? "thing" : "things"}
                      {by ? ` · ${by.id === people[0]?.id ? "yours" : by.displayName}` : ""}
                    </span>
                    {b.plannedCount ? <StatusStamp>{b.plannedCount} planned</StatusStamp> : null}
                  </span>
                </Link>
                <Tape tone={i % 2 ? "tape" : "petal"} className="left-1/2 -top-2 -ml-8" rotate={i % 2 ? 5 : -4} />
              </li>
            );
          })}
        </ul>
      )}

      <BottomNav current="boards" readOnly={readOnly} />
    </Screen>
  );
}
