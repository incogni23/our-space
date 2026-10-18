"use client";
/* eslint-disable @next/next/no-img-element -- photos come from our authenticated API */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ErrorText, Loading, cx } from "@/components/ui";
import { api, errorMessage, photoUrl, type Creation, type Memory } from "@/lib/api";
import { defaultSpec, type Layout } from "@/lib/render";
import { useSpace } from "@/lib/use-space";

type Pick = { format: "collage" | "softlaunch"; layout: Layout; reveal?: "faceless" | "hint" };

const FORMATS: Array<{ id: string; label: string; hint: string; pick: Pick | null; tint: string }> = [
  { id: "faceless", label: "Faceless", hint: "Hands, shadows, silhouettes, cropped details.", pick: { format: "softlaunch", layout: "softlaunch", reveal: "faceless" }, tint: "bg-mauve-wash text-mauve-ink" },
  { id: "soft", label: "Soft launch", hint: "Subtle hints, initials, little references.", pick: { format: "softlaunch", layout: "softlaunch", reveal: "hint" }, tint: "bg-shared-wash text-shared-ink" },
  { id: "dump", label: "Photo dump", hint: "A carousel of selected memories.", pick: { format: "collage", layout: "loose" }, tint: "bg-terracotta-wash text-terracotta-ink" },
  { id: "grid", label: "Collage", hint: "A clean grid or a film strip.", pick: { format: "collage", layout: "grid" }, tint: "bg-sunken text-ink" },
  { id: "reel", label: "Reel", hint: "Video montages are coming later.", pick: null, tint: "bg-ok-wash text-ok-ink" },
];

// F1 · Make something with this memory
function NewCreation() {
  const router = useRouter();
  const memoryParam = useSearchParams().get("memory");
  const { ready, me, partner } = useSpace({ write: true });
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [memoryId, setMemoryId] = useState<string | null>(memoryParam);
  const [memory, setMemory] = useState<Memory | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    api<{ memories: Memory[] }>("/memories")
      .then((r) => {
        const withPhotos = r.memories.filter((m) => m.photoCount > 0);
        setMemories(withPhotos);
        setMemoryId((cur) => cur ?? withPhotos[0]?.id ?? null);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [ready]);

  useEffect(() => {
    if (!ready || !memoryId) return;
    api<{ memory: Memory }>(`/memories/${memoryId}`)
      .then((r) => setMemory(r.memory))
      .catch((e) => setError(errorMessage(e)));
  }, [ready, memoryId]);

  async function choose(f: (typeof FORMATS)[number]) {
    if (!f.pick || !memory || !me) return;
    setBusy(f.id);
    setError(null);
    try {
      const initials = `${(me.user.displayName || "a").slice(0, 1).toLowerCase()} + ${(partner?.displayName || "b").slice(0, 1).toLowerCase()}`;
      const spec = { ...defaultSpec(f.pick.format, (memory.photos ?? []).map((p) => p.id), memory.caption || memory.title.toLowerCase(), initials), layout: f.pick.layout };
      if (f.pick.reveal) spec.reveal = f.pick.reveal;
      const r = await api<{ creation: Creation }>("/creations", { body: { format: f.pick.format, memoryId: memory.id, spec } });
      router.replace(`/made/${r.creation.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  }

  if (!ready || memories === null) return <Loading />;
  const cover = memory?.photos?.[0];

  return (
    <main className="min-h-dvh bg-[#2E2329]">
      <div className="relative mx-auto min-h-dvh w-full max-w-[440px]">
        <div className="absolute inset-x-0 top-0 h-[42vh] overflow-hidden bg-sunken">
          {cover ? <img src={photoUrl(cover.id, "full")} alt="" className="size-full object-cover" /> : null}
        </div>
        <div className="absolute inset-x-3 top-[52px] flex items-center justify-between">
          <Link href="/story" aria-label="Close" className="flex size-11 items-center justify-center rounded-(--radius-control) bg-[rgba(255,252,247,0.94)] text-[#44353E]">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </Link>
          {memory ? (
            <span className="max-w-[60%] truncate rounded-lg bg-[rgba(255,252,247,0.94)] px-2.5 py-[7px] font-stamp text-[10px] uppercase tracking-[0.1em] text-[#44353E]">{memory.title}</span>
          ) : null}
        </div>

        <div className="relative flex min-h-dvh flex-col justify-end pt-[34vh]">
          <div className="flex flex-col gap-3.5 rounded-t-[24px] bg-surface px-4 pb-8 pt-3 text-ink">
            <span className="h-1 w-10 self-center rounded-[2px] bg-line" aria-hidden="true" />
            <div className="flex flex-col gap-1.5">
              <h1 className="m-0 font-display text-[28px] font-normal leading-[1.1]">Make something with this memory</h1>
              <p className="m-0 text-sm leading-[1.5] text-muted">Choose a format for your photos.</p>
            </div>
            {memories.length === 0 ? (
              <p className="m-0 text-sm text-muted">
                Add a memory with photos first. <Link href="/story/new">Add a memory</Link>
              </p>
            ) : (
              <label className="flex flex-col gap-1.5 text-[13px] font-medium">
                From
                <select value={memoryId ?? ""} onChange={(e) => setMemoryId(e.target.value)} className="h-11 rounded-(--radius-control) border border-line-control bg-surface px-3 text-[15px] font-normal text-ink">
                  {memories.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title} · {m.photoCount} photo{m.photoCount === 1 ? "" : "s"}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="grid grid-cols-2 gap-2.5">
              {FORMATS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => choose(f)}
                  disabled={!f.pick || !memory || !!busy}
                  aria-busy={busy === f.id || undefined}
                  className={cx(
                    "flex min-h-[118px] flex-col items-start gap-2 rounded-(--radius-card) border border-line bg-ground p-3.5 text-left text-ink disabled:opacity-55",
                    f.id === "reel" && "col-span-2 min-h-0",
                  )}
                >
                  <span className={cx("flex size-9 items-center justify-center rounded-[10px] font-display text-lg", f.tint)}>{f.label.slice(0, 1)}</span>
                  <span className="text-[15px] font-semibold">{f.label}</span>
                  <span className="text-[13px] leading-[1.4] text-muted">{f.hint}</span>
                </button>
              ))}
            </div>
            <ErrorText>{error}</ErrorText>
            <p className="m-0 text-[13px] leading-[1.5] text-muted">Private first. Your originals stay untouched, and nothing leaves the space until you choose who sees it.</p>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function NewCreationRoute() {
  return (
    <Suspense fallback={<Loading />}>
      <NewCreation />
    </Suspense>
  );
}
