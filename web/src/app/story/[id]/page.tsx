"use client";
/* eslint-disable @next/next/no-img-element -- photos come from our authenticated API */

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BottomNav } from "@/components/bottom-nav";
import { Avatar, ErrorText, Loading, Screen } from "@/components/ui";
import { api, errorMessage, photoUrl, type Memory } from "@/lib/api";
import { useSpace } from "@/lib/use-space";
import { useLiveTick } from "@/lib/live";

const kindLabel = { moment: "Moment", trip: "Trip", change: "A change", start: "Where it started" } as const;

function longDate(d: string) {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

// Memory detail
export default function MemoryDetail() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const { ready, me, people, readOnly } = useSpace();
  const tick = useLiveTick(["memory."], ready);
  const [memory, setMemory] = useState<Memory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!ready) return;
    api<{ memory: Memory }>(`/memories/${id}`)
      .then((r) => setMemory(r.memory))
      .catch((e) => setError(errorMessage(e)));
  }, [ready, id, tick]);

  async function remove() {
    try {
      await api(`/memories/${id}`, { method: "DELETE" });
      router.replace("/story");
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (!ready || (!memory && !error)) return <Loading />;
  if (!memory) {
    return (
      <Screen className="px-4">
        <ErrorText>{error}</ErrorText>
        <Link href="/story">Back to Our Story</Link>
      </Screen>
    );
  }

  const by = people.find((p) => p.id === memory.createdBy);
  const [first, ...rest] = memory.photos ?? [];
  const when = memory.endsOn && memory.endsOn !== memory.happenedOn ? `${longDate(memory.happenedOn)} – ${longDate(memory.endsOn)}` : longDate(memory.happenedOn);

  return (
    <Screen className="gap-4 px-4 pb-[120px] pt-[52px]">
      <Link href="/story" className="-ml-1.5 flex min-h-11 items-center gap-1 self-start text-[15px] text-ink no-underline">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 6l-6 6 6 6" />
        </svg>
        Our Story
      </Link>

      {first ? (
        <a href={photoUrl(first.id, "full")} target="_blank" rel="noopener" className="block overflow-hidden rounded-(--radius-card) bg-sunken">
          <img src={photoUrl(first.id, "full")} alt={memory.caption || memory.title} className="max-h-[60vh] w-full object-cover" style={{ aspectRatio: `${first.width} / ${first.height}` }} />
        </a>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <span className="font-stamp text-[10px] uppercase tracking-[0.1em] text-muted">
          {kindLabel[memory.kind]} · {when}
          {memory.place ? ` · ${memory.place}` : ""}
        </span>
        <h1 className="m-0 font-display text-[30px] font-black italic leading-[0.95] tracking-[-0.02em]">{memory.title}</h1>
        {memory.caption ? <p className="m-0 font-display text-[19px] italic leading-[1.4] text-muted">{memory.caption}</p> : null}
        {by ? (
          <span className="flex items-center gap-1.5 text-[13px] text-muted">
            <Avatar name={by.displayName} ink={by.ink} size={20} />
            Added by {by.id === me?.user.id ? "you" : by.displayName}
          </span>
        ) : null}
      </div>

      {rest.length ? (
        <div className="grid grid-cols-3 gap-1.5">
          {rest.map((p) => (
            <a key={p.id} href={photoUrl(p.id, "full")} target="_blank" rel="noopener" className="block aspect-square overflow-hidden rounded-lg bg-sunken">
              <img src={photoUrl(p.id)} alt="" className="size-full object-cover" loading="lazy" />
            </a>
          ))}
        </div>
      ) : null}

      {!readOnly && (memory.photos?.length ?? 0) > 0 ? (
        <Link href={`/made/new?memory=${memory.id}`} className="flex min-h-[52px] items-center justify-center rounded-(--radius-card) bg-action text-base font-medium text-action-text no-underline">
          Make something
        </Link>
      ) : null}

      <ErrorText>{error}</ErrorText>

      {readOnly ? null : confirmDelete ? (
        <div className="flex flex-col gap-2 rounded-(--radius-card) bg-paper shadow-(--shadow-paper) p-3.5">
          <span className="text-sm">Remove this memory from Our Story for both of you?</span>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setConfirmDelete(false)} className="min-h-11 rounded-(--radius-control) border border-line text-sm font-medium">
              Keep it
            </button>
            <button type="button" onClick={remove} className="min-h-11 rounded-(--radius-control) bg-danger text-sm font-medium text-inverse">
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirmDelete(true)} className="mt-2 min-h-11 self-center text-sm font-medium text-danger">
          Remove memory
        </button>
      )}

      <BottomNav current="story" readOnly={readOnly} />
    </Screen>
  );
}
