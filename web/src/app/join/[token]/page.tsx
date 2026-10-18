"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar, Button, ButtonLink, Card, ErrorText, Frames, Loading, Logo, Screen } from "@/components/ui";
import { ApiError, api, errorMessage, formatDayTime, homeFor, type Me } from "@/lib/api";
import { useMe } from "@/lib/use-me";

type Preview = { inviterName: string; spaceName: string; expiresAt: string };

const lockIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);
const leaveIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 4h6v16h-6" />
    <path d="M10 8l-4 4 4 4M6 12h10" />
  </svg>
);

function Row({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[22px_1fr] gap-2.5 text-sm leading-[1.5]">
      {icon}
      <span>
        <strong className="font-semibold">{title}</strong> <span className="text-muted">{children}</span>
      </span>
    </div>
  );
}

// A7 · Partner's phone · accept
export default function Accept() {
  const router = useRouter();
  const { token } = useParams<{ token: string }>();
  const { me, loading } = useMe({ signedOut: null });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [problem, setProblem] = useState<{ code: string; message: string } | null>(null);
  const [busy, setBusy] = useState<"join" | "decline" | null>(null);
  const [declined, setDeclined] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Preview>(`/invitations/${encodeURIComponent(token)}`)
      .then(setPreview)
      .catch((err) =>
        setProblem(err instanceof ApiError ? { code: err.code, message: err.message } : { code: "network", message: errorMessage(err) }),
      );
  }, [token]);

  async function join() {
    setBusy("join");
    setError(null);
    try {
      await api<{ space: Me["space"] }>(`/invitations/${encodeURIComponent(token)}/accept`, { body: {} });
      router.replace("/yours");
    } catch (err) {
      if (err instanceof ApiError && ["already_in_space", "invite_expired", "invite_unavailable", "cooldown"].includes(err.code)) {
        setProblem({ code: err.code, message: err.message });
      } else {
        setError(errorMessage(err));
      }
      setBusy(null);
    }
  }

  async function decline() {
    setBusy("decline");
    setError(null);
    try {
      await api(`/invitations/${encodeURIComponent(token)}/decline`, { body: {} });
      setDeclined(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (loading || (!preview && !problem)) return <Loading />;

  if (problem) {
    const titles: Record<string, string> = {
      invite_expired: "This invite has run out.",
      invite_unavailable: "This invite can’t be used any more.",
      invite_not_found: "We couldn’t find that invite.",
      already_in_space: "You’re already in a space.",
      cooldown: "Not just yet.",
    };
    return (
      <Screen>
        <Logo />
        <div className="flex flex-col gap-2.5 pt-6">
          <h1 className="m-0 font-display text-[32px] font-normal leading-[1.1]">{titles[problem.code] ?? "Something went wrong."}</h1>
          <p className="m-0 text-[15px] leading-[1.55] text-muted">
            {problem.code === "invite_expired" || problem.code === "invite_unavailable" || problem.code === "invite_not_found"
              ? "Invites work once and last 3 days, so old links can’t be reused. Ask for a fresh one."
              : problem.message}
          </p>
        </div>
        <div className="mt-auto flex flex-col gap-2.5">
          {me ? <ButtonLink href={homeFor(me)}>Go to my space</ButtonLink> : <ButtonLink href="/">Back to start</ButtonLink>}
        </div>
      </Screen>
    );
  }

  const p = preview!;

  if (declined) {
    return (
      <Screen>
        <Logo />
        <div className="flex flex-col gap-2.5 pt-6">
          <h1 className="m-0 font-display text-[32px] font-normal leading-[1.1]">Okay.</h1>
          <p className="m-0 text-[15px] leading-[1.55] text-muted">
            {p.inviterName} will see that the invite wasn’t accepted, nothing more.
          </p>
        </div>
        <div className="mt-auto">
          <ButtonLink href="/" variant="secondary">
            Done
          </ButtonLink>
        </div>
      </Screen>
    );
  }

  return (
    <Screen className="gap-5 pt-14">
      <div className="flex min-h-11 items-center justify-between">
        <Logo className="text-xl" />
        {me?.user.phoneMasked ? (
          <span className="flex items-center gap-1.5 text-xs font-medium text-ok-ink">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7" />
            </svg>
            {me.user.phoneMasked} verified
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-3.5">
        <div className="flex items-center gap-3">
          <Avatar name={p.inviterName} tint="terracotta" size={48} />
          <span className="text-base font-semibold">{p.inviterName}</span>
        </div>
        <h1 className="m-0 font-display text-[32px] font-normal leading-[1.1] tracking-[-0.015em]">
          {p.inviterName} invited you to share <span className="italic">{p.spaceName}.</span>
        </h1>
      </div>

      <Card className="flex flex-col gap-3 rounded-2xl px-[18px] py-4">
        <span className="font-stamp text-[10px] tracking-[0.1em] text-muted">WHAT JOINING MEANS</span>
        <Row icon={<Frames size={20} />} title="Just the two of you.">
          No one else can ever be added.
        </Row>
        <Row icon={lockIcon} title="One space at a time.">
          While you’re in {p.spaceName}, this account can’t join or start another.
        </Row>
        <Row icon={leaveIcon} title="Either of you can leave.">
          Any time, without the other’s permission.
        </Row>
      </Card>

      <ErrorText>{error}</ErrorText>

      <div className="mt-auto flex flex-col gap-2.5">
        {me ? (
          <>
            <Button onClick={join} loading={busy === "join"} disabled={!!busy}>
              Join {p.spaceName}
            </Button>
            <div className="grid grid-cols-2 gap-2.5">
              <ButtonLink href="/" variant="secondary" className="min-h-12 text-[15px]">
                Not now
              </ButtonLink>
              <Button variant="secondary" className="min-h-12 text-[15px]" onClick={decline} loading={busy === "decline"} disabled={!!busy}>
                Decline
              </Button>
            </div>
          </>
        ) : (
          <ButtonLink href={`/sign-in?intent=join&next=${encodeURIComponent(`/join/${token}`)}`}>
            Verify your number to join
          </ButtonLink>
        )}
        <span className="text-center text-xs text-muted">
          Invite works until {formatDayTime(p.expiresAt)} your time. Declining tells {p.inviterName} the invite wasn’t
          accepted, nothing more.
        </span>
      </div>
    </Screen>
  );
}
