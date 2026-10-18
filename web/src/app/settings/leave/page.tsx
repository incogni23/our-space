"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { OtpInput } from "@/components/otp-input";
import { Button, ButtonLink, ErrorText, Lead, Loading, Screen, Title, TopBar, cx } from "@/components/ui";
import { ApiError, api, errorMessage, homeFor, partnerOf } from "@/lib/api";
import { useMe } from "@/lib/use-me";

// "Tell them tomorrow" is designed (G2) but can't be honest yet: the partner's app
// changes the moment the space closes. Hidden until that's decided (todo.md).
const SHOW_DELAY_OPTION = false;

type LeaveResult = { status: string; readOnlyUntil?: string; newSpaceAvailableAt?: string };

// G2 · Leave the space (or close a space nobody joined)
export default function Leave() {
  const router = useRouter();
  const { me, loading } = useMe();
  const [delay, setDelay] = useState(false);
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (me && !me.space) router.replace(homeFor(me));
  }, [me, router]);

  if (loading || !me?.space) return <Loading />;
  const space = me.space;
  const active = space.status === "active";
  const partnerName = partnerOf(me)?.displayName || "Your person";

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ verificationId: string }>("/space/leave/start", { body: {} });
      setVerificationId(res.verificationId);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e?: FormEvent) {
    e?.preventDefault();
    if (!verificationId || code.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<LeaveResult>("/space/leave", { body: { verificationId, code, notifyTomorrow: delay } });
      const q = new URLSearchParams({ space: space.name });
      if (res.readOnlyUntil) q.set("until", res.readOnlyUntil);
      if (res.newSpaceAvailableAt) q.set("next", res.newSpaceAvailableAt);
      router.replace(active ? `/left?${q}` : "/new");
    } catch (err) {
      setError(err instanceof ApiError && err.code === "code_expired" ? "That code has run out. Send a new one." : errorMessage(err));
      setCode("");
      setBusy(false);
    }
  }

  const steps = active
    ? [
        delay
          ? `${partnerName} is told tomorrow at this time that the space has closed, in the same neutral words you’ll see.`
          : `${partnerName} is told now that the space has closed, in the same neutral words you’ll see.`,
        "You both can read and download what’s there for 30 days. Then it’s deleted.",
        "Preview links stop working now. Files already exported stay wherever they went.",
        "You can start a new space after 7 days.",
      ]
    : ["The invite link stops working.", "You can start a new space straight away."];

  return (
    <Screen className="gap-[18px]">
      <TopBar back="/settings" />
      <div className="flex flex-col gap-2.5">
        <Title>{active ? `Leave ${space.name}?` : `Close ${space.name}?`}</Title>
        <Lead>
          {active
            ? `You can leave whenever you need to. ${partnerName} doesn’t have to agree, and we won’t ask why.`
            : "Nobody has joined yet."}
        </Lead>
      </div>

      <ol className="m-0 flex list-none flex-col rounded-(--radius-card) border border-line bg-surface p-0">
        {steps.map((s, i) => (
          <li key={i} className={cx("flex gap-3 p-3.5 text-sm leading-[1.5]", i > 0 && "border-t border-sunken")}>
            <span className="flex size-6 flex-none items-center justify-center rounded-full bg-sunken font-stamp text-[11px]">{i + 1}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>

      {SHOW_DELAY_OPTION && active && !verificationId ? (
        <label className="flex min-h-[52px] cursor-pointer items-start gap-3 py-1">
          <input type="checkbox" checked={delay} onChange={(e) => setDelay(e.target.checked)} className="mt-0.5 size-[22px] flex-none accent-[var(--action-primary)]" />
          <span className="flex flex-col gap-0.5">
            <span className="text-[15px] font-medium">Tell {partnerName} tomorrow instead</span>
            <span className="text-[13px] leading-[1.45] text-muted">
              For when you need a little time or distance first. You lose access right away either way.
            </span>
          </span>
        </label>
      ) : null}

      {verificationId ? (
        <form onSubmit={confirm} className="flex flex-col gap-2.5">
          <label htmlFor="leave-otp" className="text-[13px] font-medium">
            Code sent to {me.user.phoneMasked}
          </label>
          <OtpInput id="leave-otp" value={code} onChange={setCode} invalid={!!error} autoFocus />
        </form>
      ) : null}

      <ErrorText>{error}</ErrorText>

      <div className="mt-auto flex flex-col gap-2.5">
        {!verificationId ? (
          <>
            <span className="text-center text-[13px] leading-[1.5] text-muted">
              We’ll text a code to {me.user.phoneMasked} to make sure it’s you.
            </span>
            <Button variant="danger" onClick={sendCode} loading={busy}>
              Send code
            </Button>
          </>
        ) : (
          <Button variant="danger" onClick={() => confirm()} loading={busy} disabled={code.length !== 6}>
            {active ? `Leave ${space.name}` : `Close ${space.name}`}
          </Button>
        )}
        <ButtonLink href="/settings" variant="secondary">
          Stay
        </ButtonLink>
      </div>
    </Screen>
  );
}
