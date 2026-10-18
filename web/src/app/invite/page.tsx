"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button, ErrorText, Field, Frames, Lead, Loading, Screen, Title, TopBar } from "@/components/ui";
import { api, errorMessage, formatDayTime, homeFor } from "@/lib/api";
import { saveLastInvite, type LastInvite } from "@/lib/last-invite";
import { useMe } from "@/lib/use-me";

// A5 · Invite your person
export default function Invite() {
  const router = useRouter();
  const { me, loading } = useMe();
  const [name, setName] = useState("");
  const [invite, setInvite] = useState<LastInvite | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (me && me.space?.status !== "pending") router.replace(homeFor(me));
    if (me?.space?.invite?.inviteeName) setName((n) => n || me.space!.invite!.inviteeName);
  }, [me, router]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ url: string; expiresAt: string }>("/space/invitations", { body: { inviteeName: name.trim() } });
      const v = { url: res.url, expiresAt: res.expiresAt, inviteeName: name.trim() };
      saveLastInvite(v);
      setInvite(v);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    if (!invite || !me?.space) return;
    const text = `${me.user.displayName || "I"} invited you to share a space called ${me.space.name} on Between Us.`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Between Us", text, url: invite.url });
        router.push("/waiting");
        return;
      } catch {
        // dismissed: fall through to copy
      }
    }
    await copy();
  }

  async function copy() {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.url);
      setCopied(true);
    } catch {
      setError("Couldn’t copy. Press and hold the link to copy it.");
    }
  }

  if (loading || !me?.space) return <Loading />;
  const who = name.trim() || "your person";
  const they = name.trim() || "They";

  return (
    <Screen className="gap-[22px]">
      <TopBar back="/new" step="STEP 3 OF 4" />
      <div className="flex flex-col gap-2.5">
        <Title>Invite your person.</Title>
        <Lead>Send the link however you usually talk. It works once, for one person, for 3 days.</Lead>
      </div>

      {!invite ? (
        <form onSubmit={create} className="flex flex-1 flex-col gap-[22px]">
          <Field
            id="theirname"
            label="Their first name"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <p className="m-0 flex gap-2.5 text-sm leading-[1.5] text-muted">
            <Frames size={18} filled={false} dashedSecond />
            <span>
              {they} verifies their own number and chooses to join. Nothing in the space is shared until they say yes.
            </span>
          </p>
          <ErrorText>{error}</ErrorText>
          <div className="mt-auto">
            <Button type="submit" loading={busy}>
              Make invite link
            </Button>
          </div>
        </form>
      ) : (
        <>
          <div className="relative flex rounded-(--radius-ticket) bg-surface shadow-(--shadow-paper)">
            <div className="flex min-w-0 flex-1 flex-col gap-2 p-[18px]">
              <span className="font-stamp text-[10px] tracking-[0.1em] text-muted">WHAT {who.toUpperCase()} WILL SEE</span>
              <span className="font-display text-[21px] leading-[1.2]">
                {me.user.displayName || "Someone"} invited you to share a space called {me.space.name}.
              </span>
              <span className="text-[13px] text-muted">Works until {formatDayTime(invite.expiresAt)}</span>
            </div>
            <div className="flex w-[72px] items-center justify-center border-l-[1.5px] border-dashed border-line">
              <Frames size={28} />
            </div>
            <div className="absolute -top-[9px] right-[63px] size-[18px] rounded-full bg-ground" />
            <div className="absolute -bottom-[9px] right-[63px] size-[18px] rounded-full bg-ground" />
          </div>

          <p className="m-0 break-all rounded-(--radius-control) bg-sunken px-3.5 py-3 font-stamp text-xs">{invite.url}</p>

          <ErrorText>{error}</ErrorText>

          <div className="mt-auto flex flex-col gap-2.5">
            <Button onClick={share}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
              </svg>
              Share invite
            </Button>
            <Button variant="secondary" onClick={copy}>
              {copied ? "Copied" : "Copy link"}
            </Button>
            <Button variant="text" onClick={() => router.push("/waiting")}>
              Done
            </Button>
            <span role="status" className="sr-only">
              {copied ? "Link copied" : ""}
            </span>
          </div>
        </>
      )}
    </Screen>
  );
}
