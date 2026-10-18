"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BottomNav } from "@/components/bottom-nav";
import { NoteLetter } from "@/components/note-letter";
import { ReadOnlyBanner } from "@/components/read-only-banner";
import { ButtonLink, ErrorText, Loading, Screen } from "@/components/ui";
import { api, errorMessage, type Note } from "@/lib/api";
import { useLiveTick } from "@/lib/live";
import { useSpace } from "@/lib/use-space";

// Notes between you (NoteLetter, 4.3)
export default function Notes() {
  const { ready, me, partner, readOnly, spaceName } = useSpace();
  const tick = useLiveTick(["note."], ready);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    api<{ notes: Note[] }>("/notes")
      .then((r) => setNotes(r.notes))
      .catch((e) => setError(errorMessage(e)));
  }, [ready, tick]);

  if (!ready || !me || (notes === null && !error)) return <Loading />;
  const pName = partner?.displayName || "your person";
  const forYou = (notes ?? []).filter((n) => !n.mine);
  const fromYou = (notes ?? []).filter((n) => n.mine);

  return (
    <Screen className="gap-4 px-4 pb-[120px] pt-[52px]">
      <Link href="/space" className="-ml-1.5 flex min-h-11 items-center gap-1 self-start text-[15px] text-ink no-underline">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 6l-6 6 6 6" />
        </svg>
        Space
      </Link>
      <div className="flex items-center justify-between">
        <h1 className="m-0 font-display text-[34px] font-normal leading-[1.05]">Notes</h1>
        {readOnly ? null : (
          <ButtonLink href="/notes/new" className="min-h-11 w-auto px-3.5 text-sm">
            Write one
          </ButtonLink>
        )}
      </div>
      {readOnly ? <ReadOnlyBanner name={spaceName} until={me.readOnlySpace?.until} /> : null}
      <ErrorText>{error}</ErrorText>

      <section className="flex flex-col gap-2.5" aria-labelledby="foryou">
        <h2 id="foryou" className="m-0 font-stamp text-[10px] uppercase tracking-[0.1em] text-muted">
          For you
        </h2>
        {forYou.length === 0 ? (
          <p className="m-0 text-sm text-muted">Nothing from {pName} yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {forYou.map((n) => (
              <NoteLetter key={n.id} note={n} myTz={me.user.timeZone} partnerName={pName} partnerTz={partner?.timeZone} />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2.5" aria-labelledby="fromyou">
        <h2 id="fromyou" className="m-0 font-stamp text-[10px] uppercase tracking-[0.1em] text-muted">
          From you
        </h2>
        {fromYou.length === 0 ? (
          <p className="m-0 text-sm text-muted">Write {pName} something to open later: tomorrow morning, or a day that matters.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {fromYou.map((n) => (
              <NoteLetter key={n.id} note={n} myTz={me.user.timeZone} partnerName={pName} partnerTz={partner?.timeZone} />
            ))}
          </div>
        )}
        <p className="m-0 pt-1 text-xs leading-[1.5] text-muted">
          {pName} sees only who and when until a note opens. You’ll see when it’s been read.
        </p>
      </section>

      <BottomNav current="space" readOnly={readOnly} />
    </Screen>
  );
}
