"use client";
/* eslint-disable @next/next/no-img-element -- photos come from our authenticated API */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Button, ErrorText, Loading, cx } from "@/components/ui";
import { api, errorMessage, photoUrl, uploadPhoto, type Memory, type MemoryKind, type Photo } from "@/lib/api";
import { dayKey } from "@/lib/time";
import { useSpace } from "@/lib/use-space";

const KINDS: Array<{ id: MemoryKind; label: string }> = [
  { id: "moment", label: "Moment" },
  { id: "trip", label: "Trip" },
  { id: "change", label: "A change" },
  { id: "start", label: "Where it started" },
];

// Add a memory (feeds E0)
export default function NewMemory() {
  const router = useRouter();
  const { ready, me } = useSpace({ write: true });
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<MemoryKind>("moment");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [place, setPlace] = useState("");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tz = me?.user.timeZone ?? "UTC";

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).slice(0, 30 - photos.length);
    e.target.value = "";
    if (!files.length) return;
    setError(null);
    setUploading({ done: 0, total: files.length });
    const added: Photo[] = [];
    for (const [i, f] of files.entries()) {
      try {
        const p = await uploadPhoto(f);
        added.push(p);
        setPhotos((prev) => [...prev, p]);
      } catch (err) {
        setError(errorMessage(err));
      }
      setUploading({ done: i + 1, total: files.length });
    }
    setUploading(null);
    // Dates from the photos themselves, when we have them.
    const taken = [...photos, ...added].map((p) => p.takenAt).filter(Boolean).sort() as string[];
    if (taken.length) {
      setDate((d) => d || dayKey(taken[0], tz));
      if (taken.length > 1 && dayKey(taken[taken.length - 1], tz) !== dayKey(taken[0], tz)) {
        setEndsOn((d) => d || dayKey(taken[taken.length - 1], tz));
      }
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ memory: Memory }>("/memories", {
        body: {
          kind,
          title,
          caption,
          place,
          happenedOn: date || dayKey(new Date(), tz),
          endsOn: kind === "trip" && endsOn ? endsOn : "",
          photoIds: photos.map((p) => p.id),
        },
      });
      router.replace(`/story/${r.memory.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (!ready || !me) return <Loading />;

  return (
    <main className="min-h-dvh bg-[var(--scrim)]">
      <Link href="/story" aria-label="Close" className="fixed inset-0" />
      <form
        onSubmit={save}
        aria-labelledby="memtitle"
        className="relative mx-auto mt-[max(4vh,32px)] flex min-h-[calc(100dvh-max(4vh,32px))] w-full max-w-[440px] flex-col gap-4 rounded-t-(--radius-sheet) bg-surface px-[18px] pb-8 pt-2.5 shadow-(--shadow-sheet)"
      >
        <span className="h-1 w-9 self-center rounded-[2px] bg-line" aria-hidden="true" />
        <div className="flex items-center justify-between">
          <h1 id="memtitle" className="m-0 font-display text-[32px] font-black italic leading-none">
            Add a memory
          </h1>
          <Link href="/story" aria-label="Close" className="-mr-2.5 flex size-11 items-center justify-center text-ink">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </Link>
        </div>

        <div role="radiogroup" aria-label="Kind" className="grid grid-cols-4 gap-1.5">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              role="radio"
              aria-checked={kind === k.id}
              onClick={() => setKind(k.id)}
              className={cx(
                "min-h-12 rounded-(--radius-control) px-1 text-[12px] leading-tight text-ink",
                kind === k.id ? "border-2 border-ink bg-surface font-semibold" : "border border-line bg-ground font-medium",
              )}
            >
              {k.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium">
            Photos <span className="font-normal text-muted">{kind === "change" ? "(optional)" : ""}</span>
          </span>
          <div className="grid grid-cols-4 gap-2">
            {photos.map((p) => (
              <span key={p.id} className="relative aspect-square overflow-hidden rounded-lg bg-sunken">
                <img src={photoUrl(p.id)} alt="" className="size-full object-cover" />
                <button
                  type="button"
                  aria-label="Remove photo"
                  onClick={() => setPhotos((list) => list.filter((x) => x.id !== p.id))}
                  className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-[rgba(46,35,41,0.7)] text-[#FFFCF7]"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </span>
            ))}
            {photos.length < 30 ? (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={!!uploading}
                className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border-[1.5px] border-dashed border-line-control text-[11px] font-medium text-ink disabled:opacity-60"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add
              </button>
            ) : null}
          </div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={pick} className="sr-only" tabIndex={-1} aria-hidden="true" />
          {uploading ? (
            <div role="status" className="flex flex-col gap-1.5">
              <span className="text-[13px]">
                Uploading {Math.min(uploading.done + 1, uploading.total)} of {uploading.total}.{" "}
                <span className="text-muted">Only you can see these until they finish.</span>
              </span>
              <span className="h-1 overflow-hidden rounded bg-sunken">
                <span className="block h-1 rounded bg-ink transition-[width]" style={{ width: `${(uploading.done / uploading.total) * 100}%` }} />
              </span>
            </div>
          ) : (
            <span className="text-xs text-muted">Location and camera details are removed from every photo.</span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="mtitle" className="text-[13px] font-medium">
            {kind === "start" ? "Where it started" : kind === "change" ? "What changed" : "Call it"}
          </label>
          <input
            id="mtitle"
            required
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={kind === "trip" ? "Pondicherry, the long weekend" : kind === "start" ? "The 6:00 Shatabdi to Bengaluru" : kind === "change" ? "Dev moved to New York" : "The picnic that got rained out"}
            className="h-[50px] rounded-(--radius-control) border border-line-control bg-surface px-3.5 font-display text-[19px] text-ink placeholder:text-muted focus:border-2 focus:border-ink focus:outline-none"
          />
        </div>

        <div className={cx("grid gap-2", kind === "trip" ? "grid-cols-2" : "grid-cols-1")}>
          <div className="flex flex-col gap-2">
            <label htmlFor="mdate" className="text-[13px] font-medium">
              {kind === "trip" ? "From" : "When"}
            </label>
            <input id="mdate" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-12 rounded-(--radius-control) border border-line-control bg-surface px-3 text-base text-ink" />
          </div>
          {kind === "trip" ? (
            <div className="flex flex-col gap-2">
              <label htmlFor="mend" className="text-[13px] font-medium">
                To
              </label>
              <input id="mend" type="date" value={endsOn} min={date} onChange={(e) => setEndsOn(e.target.value)} className="h-12 rounded-(--radius-control) border border-line-control bg-surface px-3 text-base text-ink" />
            </div>
          ) : null}
        </div>

        {kind === "moment" || kind === "trip" ? (
          <div className="flex flex-col gap-2">
            <label htmlFor="mplace" className="text-[13px] font-medium">
              Where <span className="font-normal text-muted">(optional)</span>
            </label>
            <input id="mplace" maxLength={120} value={place} onChange={(e) => setPlace(e.target.value)} className="h-12 rounded-(--radius-control) border border-line-control bg-surface px-3.5 text-[15px] text-ink focus:border-2 focus:border-ink focus:outline-none" />
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <label htmlFor="mcaption" className="text-[13px] font-medium">
            A line to remember it by <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="mcaption"
            maxLength={500}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="the scooter that wouldn’t start"
            className="h-12 rounded-(--radius-control) border border-line-control bg-surface px-3.5 font-display text-[17px] italic text-ink placeholder:text-muted focus:border-2 focus:border-ink focus:outline-none"
          />
        </div>

        <ErrorText>{error}</ErrorText>

        <div className="mt-auto">
          <Button type="submit" loading={busy} disabled={!title.trim() || !!uploading}>
            Add to Our Story
          </Button>
        </div>
      </form>
    </main>
  );
}
