"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Button, ButtonLink, Card, Loading, Screen } from "@/components/ui";
import { EXPORT_URL, formatDay } from "@/lib/api";

// G3 · After leaving
function Left() {
  const params = useSearchParams();
  const space = params.get("space") || "the space";
  const until = params.get("until");
  const next = params.get("next");
  const canStart = !next || new Date(next) <= new Date();

  return (
    <Screen className="gap-5 pt-24">
      <svg width="64" height="64" viewBox="0 0 32 32" aria-hidden="true">
        <rect x="3" y="4" width="16" height="20" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <rect x="13" y="8" width="16" height="20" rx="3" fill="none" stroke="var(--line-control)" strokeWidth="1.6" strokeDasharray="2.5 2.5" />
      </svg>
      <div className="flex flex-col gap-2.5">
        <h1 className="m-0 font-display text-[34px] font-normal leading-[1.08]">You’ve left {space}.</h1>
        <p className="m-0 text-[15px] leading-[1.55] text-muted">
          The other person is told the space has closed. No reason was given, and none will be.
        </p>
      </div>

      {until ? (
        <Card className="flex flex-col gap-1 p-4">
          <span className="font-stamp text-[10px] tracking-[0.1em] text-shared-ink">UNTIL {formatDay(until).toUpperCase()}</span>
          <span className="text-sm leading-[1.5]">
            You can both still read and download what you shared. After that it’s deleted for both of you.
          </span>
          <a href={EXPORT_URL} className="mt-2 flex min-h-[52px] items-center justify-center rounded-(--radius-card) bg-action text-base font-medium text-action-text no-underline">
            Download a copy
          </a>
          <ButtonLink href="/space" variant="text">
            Look back through it
          </ButtonLink>
        </Card>
      ) : null}

      <div className="flex flex-col gap-2">
        {canStart ? (
          <ButtonLink href="/new">Start a new space</ButtonLink>
        ) : (
          <>
            <Button disabled aria-describedby="cooldown" className="border border-dashed border-line-control bg-transparent text-muted">
              Start a new space
            </Button>
            <span id="cooldown" className="text-center text-[13px] leading-[1.5] text-muted">
              Available from {formatDay(next!)}, 7 days after leaving.
            </span>
          </>
        )}
      </div>

      <p className="m-0 mt-auto text-center text-[13px] leading-[1.5] text-muted">
        Your account and number stay yours. Sign in any time.
      </p>
    </Screen>
  );
}

export default function LeftPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Left />
    </Suspense>
  );
}
