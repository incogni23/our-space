"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, ButtonLink, Card, Loading, Screen } from "@/components/ui";
import { EXPORT_URL, formatDay, homeFor, markNoticeSeen, type Notice } from "@/lib/api";
import { useMe } from "@/lib/use-me";

type Closed = Extract<Notice, { kind: "space_closed" }>;

// 5.2 · Unlinked. Same neutral wording for both people; no blame.
export default function SpaceClosed() {
  const router = useRouter();
  const { me, loading } = useMe();
  const [busy, setBusy] = useState(false);
  const notice = me?.notices.find((n): n is Closed => n.kind === "space_closed");

  useEffect(() => {
    if (me && !notice) router.replace(homeFor(me));
  }, [me, notice, router]);

  if (loading || !notice) return <Loading />;
  const p = notice.payload;
  const stillReadable = new Date(p.readOnlyUntil) > new Date();

  async function done() {
    setBusy(true);
    await markNoticeSeen(notice!.id).catch(() => {});
    router.replace("/new");
  }

  return (
    <Screen className="gap-5 pt-24">
      <svg width="64" height="64" viewBox="0 0 32 32" aria-hidden="true">
        <rect x="3" y="4" width="16" height="20" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <rect x="13" y="8" width="16" height="20" rx="3" fill="none" stroke="var(--line-control)" strokeWidth="1.6" strokeDasharray="2.5 2.5" />
      </svg>
      <div className="flex flex-col gap-2.5">
        <h1 className="m-0 font-display text-[34px] font-normal leading-[1.08]">{p.spaceName} has closed.</h1>
        <p className="m-0 text-[15px] leading-[1.55] text-muted">
          {p.leftByName || "The other person"} left on {formatDay(p.leftAt)}.
        </p>
      </div>

      {stillReadable ? (
        <Card className="flex flex-col gap-1 p-4">
          <span className="font-stamp text-[10px] tracking-[0.1em] text-shared-ink">
            UNTIL {formatDay(p.readOnlyUntil).toUpperCase()}
          </span>
          <span className="text-sm leading-[1.5]">
            You can read and download what you shared until then. After that it’s deleted for both of you.
          </span>
        </Card>
      ) : null}

      <div className="mt-auto flex flex-col gap-2.5">
        {stillReadable ? (
          <>
            <a href={EXPORT_URL} className="flex min-h-[52px] items-center justify-center rounded-(--radius-card) bg-action text-base font-medium text-action-text no-underline">
              Download a copy
            </a>
            <ButtonLink href="/space" variant="secondary">
              Look back through it
            </ButtonLink>
          </>
        ) : null}
        <Button variant={stillReadable ? "text" : "primary"} onClick={done} loading={busy}>
          Got it
        </Button>
      </div>
    </Screen>
  );
}
