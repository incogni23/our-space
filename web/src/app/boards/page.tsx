"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { BottomNav } from "@/components/bottom-nav";
import { Button, ButtonLink, ErrorText, Loading, Screen, Title } from "@/components/ui";
import { api, errorMessage, type Board } from "@/lib/api";
import { useSpace } from "@/lib/use-space";
import { useLiveTick } from "@/lib/live";

// Boards index
export default function Boards() {
  const { ready, people } = useSpace();
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
    <Screen className="gap-4 px-4 pb-[120px] pt-14">
      <div className="flex items-end justify-between">
        <Title className="text-[32px]">Boards</Title>
        {!adding ? (
          <button type="button" onClick={() => setAdding(true)} className="min-h-11 px-1 text-sm font-medium text-ink underline underline-offset-[3px]">
            New board
          </button>
        ) : null}
      </div>

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

      <ErrorText>{error}</ErrorText>

      {boards.length === 0 ? (
        <div className="flex flex-col gap-3 pt-6 text-center">
          <h2 className="m-0 font-display text-2xl font-normal">A board for anything.</h2>
          <p className="m-0 text-[15px] leading-[1.55] text-muted">Places, songs, someday trips. Start with one.</p>
          <ButtonLink href="/add" className="mt-2">
            Save something for us
          </ButtonLink>
        </div>
      ) : (
        <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0">
          {boards.map((b) => {
            const by = people.find((p) => p.id === b.createdBy);
            return (
              <li key={b.id}>
                <Link
                  href={`/boards/${b.id}`}
                  className="flex min-h-[132px] flex-col justify-between gap-3 rounded-(--radius-card) border border-line bg-surface p-3.5 text-ink no-underline"
                >
                  <span className="flex flex-col gap-1.5">
                    <span className="font-display text-xl leading-[1.15]">{b.name}</span>
                    <span className="h-1 w-7 rounded-[2px] bg-shared" />
                  </span>
                  <span className="text-xs text-muted">
                    {b.pinCount} {b.pinCount === 1 ? "thing" : "things"}
                    {b.plannedCount ? ` · ${b.plannedCount} planned` : ""}
                    {by ? ` · ${by.displayName}` : ""}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <BottomNav current="boards" />
    </Screen>
  );
}
