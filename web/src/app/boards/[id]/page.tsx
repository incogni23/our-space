"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { BottomNav } from "@/components/bottom-nav";
import { PinCard, statusStyle } from "@/components/pin-card";
import { ErrorText, Loading, Screen, cx } from "@/components/ui";
import { ago, api, errorMessage, type Board, type Pin } from "@/lib/api";
import { useSpace } from "@/lib/use-space";
import { useLiveTick } from "@/lib/live";

type Filter = "all" | "open" | "done";

// C2 · Board
function BoardPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const saved = useSearchParams().get("saved");
  const { ready, people, readOnly } = useSpace();
  const tick = useLiveTick(["board.", "pin."], ready);
  const [board, setBoard] = useState<Board | null>(null);
  const [pins, setPins] = useState<Pin[]>([]);
  const [view, setView] = useState<"visual" | "list">("visual");
  const [filter, setFilter] = useState<Filter>("all");
  const [toast, setToast] = useState<string | null>(saved);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    api<{ board: Board; pins: Pin[] }>(`/boards/${id}`)
      .then((r) => {
        setBoard(r.board);
        setPins(r.pins);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [ready, id, tick]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  async function undo() {
    if (!toast) return;
    const pinId = toast;
    setToast(null);
    try {
      await api(`/pins/${pinId}`, { method: "DELETE" });
      setPins((p) => p.filter((x) => x.id !== pinId));
      router.replace(`/boards/${id}`);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (!ready || (!board && !error)) return <Loading />;
  if (!board) {
    return (
      <Screen className="px-4">
        <ErrorText>{error}</ErrorText>
        <Link href="/boards">Back to boards</Link>
      </Screen>
    );
  }

  const shown = pins.filter((p) =>
    filter === "all" ? true : filter === "open" ? p.status === "saved" || p.status === "planned" : p.status === "done" || p.status === "remembered",
  );
  const starter = people.find((p) => p.id === board.createdBy);
  const left = shown.filter((_, i) => i % 2 === 0);
  const right = shown.filter((_, i) => i % 2 === 1);

  return (
    <Screen className="gap-4 px-4 pb-[170px] pt-[52px]">
      <Link href="/boards" className="-ml-1.5 flex min-h-11 items-center gap-1 self-start text-[15px] text-ink no-underline">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 6l-6 6 6 6" />
        </svg>
        Boards
      </Link>

      <div className="flex flex-col gap-1.5">
        <h1 className="m-0 font-display text-[32px] font-normal leading-[1.05]">{board.name}</h1>
        <span className="h-1 w-7 rounded-[2px] bg-shared" />
        <span className="text-[13px] text-muted">
          {board.pinCount} {board.pinCount === 1 ? "thing" : "things"}
          {starter ? ` · started by ${starter.id === people[0]?.id ? "you" : starter.displayName}` : ""}
          {board.plannedCount ? ` · ${board.plannedCount} planned` : ""}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="radiogroup" aria-label="View" className="flex rounded-(--radius-control) bg-sunken p-[3px]">
          {(["visual", "list"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={view === v}
              onClick={() => setView(v)}
              className={cx("min-h-[38px] rounded-[9px] px-3.5 text-sm font-medium capitalize text-ink", view === v && "bg-surface")}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5" role="radiogroup" aria-label="Filter">
          {([
            ["all", "All"],
            ["open", "Not yet"],
            ["done", "Done"],
          ] as const).map(([f, label]) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={filter === f}
              onClick={() => setFilter(f)}
              className={cx(
                "min-h-[38px] rounded-[10px] border px-3 text-[13px] font-medium",
                filter === f ? "border-action bg-action text-action-text" : "border-line bg-surface text-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <ErrorText>{error}</ErrorText>

      {shown.length === 0 ? (
        <p className="m-0 pt-6 text-center text-[15px] text-muted">
          {pins.length === 0 ? "Nothing here yet." : "Nothing in this filter."}
        </p>
      ) : view === "visual" ? (
        <div className="grid grid-cols-2 items-start gap-3">
          {[left, right].map((col, i) => (
            <div key={i} className="flex flex-col gap-3.5">
              {col.map((p) => (
                <PinCard key={p.id} pin={p} people={people} isNew={p.id === saved} />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col overflow-hidden rounded-(--radius-card) border border-line bg-surface p-0">
          {shown.map((p, i) => {
            const by = people.find((x) => x.id === p.createdBy);
            const st = statusStyle[p.status];
            return (
              <li key={p.id} className={cx(i > 0 && "border-t border-sunken")}>
                <Link href={`/pins/${p.id}`} className="flex min-h-16 items-center gap-3 px-3.5 py-2 text-ink no-underline">
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[15px] font-semibold">{p.title}</span>
                    <span className="text-xs capitalize text-muted">
                      {p.kind} · {by?.id === people[0]?.id ? "you" : by?.displayName} · {ago(p.createdAt)}
                    </span>
                  </span>
                  <span className={cx("rounded-md px-2 py-[3px] text-xs font-semibold", st.cls)}>{st.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {toast ? (
        <div
          role="status"
          className="fixed inset-x-4 bottom-[104px] z-(--z-toast) mx-auto flex min-h-[52px] max-w-[408px] items-center justify-between rounded-(--radius-card) bg-action pl-4 pr-2 text-action-text shadow-[0_12px_28px_-12px_rgba(46,35,41,0.6)]"
        >
          <span className="flex items-center gap-2.5 text-sm">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--shared-tone)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7" />
            </svg>
            Saved to {board.name}
          </span>
          <button type="button" onClick={undo} className="min-h-11 rounded-[10px] px-3 text-sm font-semibold underline underline-offset-[3px]">
            Undo
          </button>
        </div>
      ) : null}

      <BottomNav current="boards" readOnly={readOnly} />
    </Screen>
  );
}

export default function BoardRoute() {
  return (
    <Suspense fallback={<Loading />}>
      <BoardPage />
    </Suspense>
  );
}
