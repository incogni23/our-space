"use client";
/* eslint-disable @next/next/no-img-element -- images come from our authenticated API */

import Link from "next/link";
import { useEffect, useState } from "react";
import { BottomNav } from "@/components/bottom-nav";
import { StatusChip } from "@/components/creation-status";
import { ButtonLink, ErrorText, Loading, Screen } from "@/components/ui";
import { api, errorMessage, photoUrl, type Creation } from "@/lib/api";
import { useLiveTick } from "@/lib/live";
import { useSpace } from "@/lib/use-space";

// Our Story › Made
export default function Made() {
  const { ready, me, partner, readOnly } = useSpace();
  const tick = useLiveTick(["creation."], ready);
  const [items, setItems] = useState<Creation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    api<{ creations: Creation[] }>("/creations")
      .then((r) => setItems(r.creations))
      .catch((e) => setError(errorMessage(e)));
  }, [ready, tick]);

  if (!ready || !me || (items === null && !error)) return <Loading />;
  const pName = partner?.displayName || "your person";

  return (
    <Screen className="gap-4 px-4 pb-[120px] pt-[52px]">
      <Link href="/story" className="-ml-1.5 flex min-h-11 items-center gap-1 self-start text-[15px] text-ink no-underline">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 6l-6 6 6 6" />
        </svg>
        Our Story
      </Link>
      <div className="flex items-center justify-between">
        <h1 className="m-0 font-display text-[44px] font-black italic leading-[0.95] tracking-[-0.02em]">Made by Us</h1>
        {readOnly ? null : (
          <ButtonLink href="/made/new" className="min-h-11 w-auto px-3.5 text-sm">
            Make something
          </ButtonLink>
        )}
      </div>
      <ErrorText>{error}</ErrorText>
      {items && items.length === 0 ? (
        <p className="m-0 pt-6 text-center text-[15px] leading-[1.55] text-muted">
          Collages and soft launches you make from your photos live here. Nothing leaves the space unless you both say so.
        </p>
      ) : (
        <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0">
          {(items ?? []).map((c) => (
            <li key={c.id}>
              <Link href={`/made/${c.id}`} className="flex flex-col gap-2 text-ink no-underline">
                <span className="block aspect-[4/5] overflow-hidden rounded-(--radius-print) bg-sunken shadow-(--shadow-paper)">
                  {c.renderMediaId ? (
                    <img src={photoUrl(c.renderMediaId)} alt="" className="size-full object-cover" loading="lazy" />
                  ) : (
                    <span className="flex size-full items-center justify-center text-xs text-muted">Not previewed yet</span>
                  )}
                </span>
                <span>
                  <StatusChip status={c.status} partnerName={pName} mine={c.createdBy === me.user.id} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <BottomNav current="story" readOnly={readOnly} />
    </Screen>
  );
}
