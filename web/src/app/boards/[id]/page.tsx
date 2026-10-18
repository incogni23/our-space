"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { BottomNav } from "@/components/bottom-nav";
import { PinCard, statusStyle } from "@/components/pin-card";
import { Chip } from "@/components/print";
import { ErrorText, Loading, PrintTitle, Rule, Screen, cx } from "@/components/ui";
import { inkColor } from "@/lib/theme";
import { ago, api, errorMessage, type Board, type Pin } from "@/lib/api";
import { useSpace } from "@/lib/use-space";
import { useLiveTick } from "@/lib/live";

type Filter = "all" | "open" | "done";

// C2 · Board
function BoardPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const saved = useSearchParams().get("saved");
  const { ready, people, partner, readOnly } = useSpace();
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
    <Screen wide className="gap-4 px-4 pb-[170px] pt-[52px]">
      <Link href="/boards" className="-ml-1.5 flex min-h-11 items-center gap-1 self-start text-[15px] text-ink no-underline">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 6l-6 6 6 6" />
        </svg>
        Boards
      </Link>

      <header className="flex flex-col gap-1">
        <PrintTitle className="text-[52px]">{board.name}</PrintTitle>
        <Rule className="mt-1.5">
          <span>
            {board.pinCount} {board.pinCount === 1 ? "thing" : "things"}
          </span>
          {starter ? <span>Started by {starter.id === people[0]?.id ? "you" : starter.displayName}</span> : null}
          <span className="text-accent-ink">{board.plannedCount} planned</span>
        </Rule>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="radiogroup" aria-label="Show" className="-mr-4 flex gap-1.5 overflow-x-auto pr-4">
          {([
            ["all", `All ${pins.length}`],
            ["open", "Not yet"],
            ["done", "Remembered"],
          ] as const).map(([f, label]) => (
            <Chip key={f} on={filter === f} onClick={() => setFilter(f)}>
              {label}
            </Chip>
          ))}
        </div>
        <div role="radiogroup" aria-label="View" className="flex gap-1">
          {(["visual", "list"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={view === v}
              onClick={() => setView(v)}
              className={cx("min-h-10 rounded-[20px] px-3 text-[13px] font-medium capitalize", view === v ? "text-ink underline underline-offset-4" : "text-muted")}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <ErrorText>{error}</ErrorText>

      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-2.5 py-[30px] text-center">
          <span className="font-display text-2xl font-bold italic">{pins.length === 0 ? "Nothing here yet." : "Nothing in this filter."}</span>
          {pins.length === 0 && !readOnly ? (
            <Link href="/add" className="font-hand text-[22px] text-accent-ink">
              save the first thing?
            </Link>
          ) : null}
        </div>
      ) : view === "visual" ? (
        <>
          <div className="grid grid-cols-2 items-start gap-3.5 pt-1 lg:hidden">
            {[left, right].map((col, i) => (
              <div key={i} className="flex flex-col gap-[18px]" style={{ paddingTop: i ? 34 : 0 }}>
                {col.map((p) => (
                  <PinCard key={p.id} pin={p} people={people} isNew={p.id === saved} />
                ))}
              </div>
            ))}
          </div>
          <div className="hidden gap-[22px] pt-3 lg:block lg:columns-3 xl:columns-4">
            {shown.map((p) => (
              <div key={p.id} className="mb-7 break-inside-avoid">
                <PinCard pin={p} people={people} isNew={p.id === saved} />
              </div>
            ))}
          </div>
        </>
      ) : (
        <ul className="m-0 flex list-none flex-col overflow-hidden rounded-2xl bg-paper p-0 shadow-(--shadow-paper)">
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

      {partner ? (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-ink pt-3 text-[13px] [&>span]:whitespace-nowrap">
          <span className="flex items-center gap-1.5">
            <span className="h-[3px] w-[18px] rounded-sm" style={{ background: inkColor(people[0]?.ink) }} />
            your notes
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-[3px] w-[18px] rounded-sm" style={{ background: inkColor(partner.ink ?? "second") }} />
            {partner.displayName}’s notes
          </span>
          <span className="ml-auto font-hand text-[19px] text-muted">everyone’s ink, their own</span>
        </div>
      ) : null}

      {!readOnly ? (
        <Link
          href="/add"
          aria-label={`Save something to ${board.name}`}
          className="fixed bottom-[104px] right-5 z-(--z-sticky) flex size-[58px] items-center justify-center rounded-full bg-accent text-on-accent shadow-[0_14px_26px_-12px_rgba(0,0,0,0.55)] min-[480px]:right-[calc(50%-200px)] lg:hidden"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </Link>
      ) : null}

      {toast ? (
        <div
          role="status"
          className="fixed inset-x-4 bottom-[104px] z-(--z-toast) lg:bottom-8 lg:left-[264px] mx-auto flex min-h-[52px] max-w-[408px] items-center justify-between rounded-[26px] bg-action pl-4 pr-2 text-action-text shadow-[0_12px_28px_-12px_rgba(46,35,41,0.6)]"
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
