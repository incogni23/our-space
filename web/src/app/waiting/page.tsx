"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar, Button, ButtonLink, Loading, Screen, Stamp } from "@/components/ui";
import { formatDay, homeFor } from "@/lib/api";
import { readLastInvite } from "@/lib/last-invite";
import { useMe } from "@/lib/use-me";
import { useLiveTick } from "@/lib/live";
import { NoticeBanner } from "@/components/notice-banner";

// A6 · Waiting for your person (and "The invite wasn't accepted", canvas 5.2)
export default function Waiting() {
  const router = useRouter();
  const { me, loading, reload } = useMe();
  const [copied, setCopied] = useState(false);
  const [lastUrl, setLastUrl] = useState<string | null>(null);

  useEffect(() => {
    setLastUrl(readLastInvite()?.url ?? null);
  }, []);

  useEffect(() => {
    if (!me) return;
    if (me.space?.status === "active") router.replace("/yours");
    else if (!me.space) router.replace(homeFor(me));
  }, [me, router]);

  // Pairing completes on the other phone: hear about it live, with a slow fallback.
  const joinedTick = useLiveTick(["space."], !!me?.space);
  useEffect(() => {
    if (joinedTick) void reload();
  }, [joinedTick, reload]);
  useEffect(() => {
    const t = setInterval(() => void reload(), 30000);
    return () => clearInterval(t);
  }, [reload]);

  if (loading || !me?.space) return <Loading />;
  const space = me.space;
  const invite = space.invite;
  const name = invite?.inviteeName || "your person";
  const Name = invite?.inviteeName || "Your person";

  async function copy() {
    if (!lastUrl) return;
    await navigator.clipboard.writeText(lastUrl).then(() => setCopied(true), () => {});
  }

  return (
    <Screen className="gap-5 px-4 pt-14">
      <header className="flex min-h-11 items-center gap-2.5">
        <span className="flex">
          <Avatar name={me.user.displayName} ink={me.user.ink} ring />
          <span className="ml-1.5 size-8 rounded-full border-[1.5px] border-dashed border-line-control" aria-hidden="true" />
        </span>
        <span className="flex flex-col">
          <span className="font-display text-[19px] leading-[1.1]">{space.name}</span>
          <span className="text-xs text-muted">Waiting for {name} to join</span>
        </span>
        <Link href="/settings" className="ml-auto min-h-11 px-1 text-sm font-medium text-ink underline underline-offset-[3px] leading-[44px]">
          Settings
        </Link>
      </header>

      <NoticeBanner notices={me.notices} />

      <div className="flex flex-col items-center gap-[18px] px-2 pb-1 pt-[18px] text-center">
        <div className="flex gap-[22px]" aria-hidden="true">
          <div className="flex h-[108px] w-[84px] items-end rounded-lg bg-paper shadow-(--shadow-paper) p-2 shadow-(--shadow-paper)">
            <span className="font-stamp text-[9px] tracking-[0.1em] text-muted">
              {(me.user.displayName || "you").slice(0, 1).toUpperCase()}
            </span>
          </div>
          <div className="mt-[18px] h-[108px] w-[84px] rounded-lg border-[1.5px] border-dashed border-line-control" />
        </div>

        {invite?.state === "not_accepted" ? (
          <>
            <h1 className="m-0 font-display text-[34px] font-black italic leading-[0.95]">The invite wasn’t accepted.</h1>
            <p className="m-0 max-w-[320px] text-[15px] leading-[1.55] text-muted">
              That’s all we know. You can invite again or close the space.
            </p>
          </>
        ) : (
          <>
            <h1 className="m-0 font-display text-[34px] font-black italic leading-[0.95]">
              {invite ? `${Name} hasn’t joined yet.` : "Nobody’s invited yet."}
            </h1>
            <p className="m-0 max-w-[320px] text-[15px] leading-[1.55] text-muted">
              Nothing is shared with anyone until {invite ? name : "your person"} accepts.
            </p>
          </>
        )}
      </div>

      {invite?.state === "waiting" ? (
        <div className="overflow-hidden rounded-2xl bg-paper shadow-(--shadow-paper)">
          <div className="flex flex-col gap-1 px-4 py-3.5">
            <span className="text-[15px] font-semibold">Invite sent to {Name}</span>
            <span className="flex items-center gap-1.5 text-[13px] text-time-ink">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <circle cx="12" cy="12" r="8.5" />
                <path d="M12 7.5V12l3 2" />
              </svg>
              Works until {formatDay(invite.expiresAt)}
            </span>
          </div>
          <div className="grid grid-cols-2 border-t border-sunken">
            <Link href="/invite" className="flex min-h-12 items-center justify-center text-sm font-medium text-ink">
              New link
            </Link>
            <button
              type="button"
              onClick={copy}
              disabled={!lastUrl}
              className="min-h-12 border-l border-sunken text-sm font-medium text-ink disabled:text-muted"
            >
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <ButtonLink href="/invite">{invite ? "Invite again" : "Invite your person"}</ButtonLink>
          <ButtonLink href="/settings/leave" variant="secondary">
            Close the space
          </ButtonLink>
        </div>
      )}

      <div className="mt-auto flex flex-col gap-3">
        <Stamp className="text-center">One space at a time</Stamp>
        <p className="m-0 text-center text-xs leading-[1.5] text-muted">
          If the invite runs out, you can send a new one. Old links stop working.
        </p>
        <Button variant="text" onClick={() => void reload()}>
          Check again
        </Button>
      </div>
    </Screen>
  );
}
