"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearOutbox } from "@/lib/outbox";
import { forgetThisDevice, pushState, turnOffPush, turnOnPush, type PushState } from "@/lib/push";
import { Button, Card, ErrorText, Heart, Loading, Screen, Stamp } from "@/components/ui";
import { EXPORT_URL, api, errorMessage, homeFor, partnerOf } from "@/lib/api";
import { useMe } from "@/lib/use-me";
import { familyName, resetTheme } from "@/lib/theme";

const chevron = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

// G1 · Settings
export default function Settings() {
  const router = useRouter();
  const { me, loading } = useMe();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [push, setPush] = useState<PushState | null>(null);
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    void pushState().then(setPush).catch(() => setPush("unsupported"));
  }, []);

  async function togglePush() {
    setPushBusy(true);
    setError(null);
    try {
      setPush(push === "on" ? await turnOffPush() : await turnOnPush());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPushBusy(false);
    }
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading || !me) return <Loading />;
  const partner = partnerOf(me);
  const space = me.space;

  async function makeCodes() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ codes: string[] }>("/me/recovery-codes", { body: {} });
      setCodes(res.codes);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await forgetThisDevice();
    clearOutbox();
    await api("/auth/sign-out", { body: {} }).catch(() => {});
    resetTheme();
    router.replace("/");
  }

  return (
    <Screen className="gap-[18px] px-4">
      <Link href={homeFor(me)} className="-ml-1.5 flex min-h-11 items-center gap-1 self-start text-[15px] text-ink no-underline">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 6l-6 6 6 6" />
        </svg>
        Back
      </Link>
      <h1 className="m-0 font-display text-[34px] font-normal leading-[1.05]">Settings</h1>

      {space ? (
        <div className="flex items-center gap-3.5 rounded-2xl bg-surface p-4 shadow-(--shadow-paper)">
          <Heart size={36} />
          <span className="flex flex-col gap-0.5">
            <span className="font-display text-[22px] leading-[1.1]">{space.name}</span>
            <span className="text-[13px] text-muted">
              {partner ? `You and ${partner.displayName || "your person"}` : "Waiting for your person"}
            </span>
            <span className="text-xs text-muted">One space at a time, for each of you.</span>
          </span>
        </div>
      ) : null}

      {space?.status === "active" ? (
        <section className="flex flex-col gap-2">
          <Stamp>Make it yours</Stamp>
          <Link href="/colours" className="flex min-h-[60px] items-center gap-3 rounded-(--radius-card) border border-line bg-surface px-3.5 py-2.5 text-ink no-underline">
            <span className="flex gap-1" aria-hidden="true">
              <span className="size-4 rounded-full bg-accent" />
              <span className="size-4 rounded-full bg-second" />
              <span className="size-4 rounded-full bg-petal" />
            </span>
            <span className="flex flex-1 flex-col gap-0.5">
              <span className="text-[15px] font-medium">Colours and your ink</span>
              <span className="text-[13px] text-muted">{familyName(space.palette)} · either of you can change it</span>
            </span>
            {chevron}
          </Link>
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <Stamp>Your account</Stamp>
        <div className="flex flex-col rounded-(--radius-card) border border-line bg-surface">
          <Link href="/settings/number" className="flex min-h-[60px] items-center gap-3 px-3.5 py-2.5 text-ink no-underline">
            <span className="flex flex-1 flex-col gap-0.5">
              <span className="text-[15px] font-medium">Phone number</span>
              <span className="text-[13px] text-muted">{me.user.phoneMasked ?? "None"}</span>
            </span>
            {chevron}
          </Link>
          <div className="flex min-h-[60px] items-center gap-3 border-t border-sunken px-3.5 py-2.5">
            <span className="flex flex-1 flex-col gap-0.5">
              <span className="text-[15px] font-medium">Recovery codes</span>
              <span className="text-[13px] text-muted">For signing in on a new phone. Making new ones replaces the old.</span>
            </span>
            <Button variant="secondary" className="min-h-11 w-auto px-3 text-sm" onClick={makeCodes} loading={busy}>
              Make codes
            </Button>
          </div>
        </div>
        <ErrorText>{error}</ErrorText>
        {codes ? (
          <Card className="flex flex-col gap-2 bg-time-wash">
            <span className="text-sm font-semibold text-time-ink">Save these somewhere safe. They’re shown once.</span>
            <ul className="m-0 grid list-none grid-cols-2 gap-1.5 p-0 font-stamp text-sm">
              {codes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </Card>
        ) : null}
      </section>

      <section className="flex flex-col gap-2">
        <Stamp>Notifications</Stamp>
        <div className="flex min-h-[60px] items-center gap-3 rounded-(--radius-card) border border-line bg-surface px-3.5 py-2.5">
          <span className="flex flex-1 flex-col gap-0.5">
            <span className="text-[15px] font-medium">On this device</span>
            <span className="text-[13px] leading-[1.4] text-muted">
              {push === "on"
                ? "Only for things with a time: a note opening, a plan reminder. Never what a note says."
                : push === "denied"
                  ? "Notifications are blocked for this site in your browser settings."
                  : push === "ios-install"
                    ? "On iPhone, add Between Us to your Home Screen first (Share › Add to Home Screen)."
                    : push === "unsupported"
                      ? "This browser can’t show notifications."
                      : "Off. You’ll still see everything in the app."}
            </span>
          </span>
          {push === "on" || push === "off" ? (
            <button
              type="button"
              role="switch"
              aria-checked={push === "on"}
              aria-label="Notifications on this device"
              onClick={togglePush}
              disabled={pushBusy}
              className={`relative h-8 w-[52px] flex-none rounded-2xl ${push === "on" ? "bg-action" : "bg-line-control"}`}
            >
              <span className={`absolute top-[3px] size-[26px] rounded-full bg-surface transition-[left] duration-(--dur-quick) ${push === "on" ? "left-[23px]" : "left-[3px]"}`} />
            </button>
          ) : null}
        </div>
      </section>

      {space?.status === "active" ? (
        <section className="flex flex-col gap-2">
          <Stamp>Your data</Stamp>
          <a
            href={EXPORT_URL}
            className="flex min-h-[60px] items-center gap-3 rounded-(--radius-card) border border-line bg-surface px-3.5 py-2.5 text-ink no-underline"
          >
            <span className="flex flex-1 flex-col gap-0.5">
              <span className="text-[15px] font-medium">Download a copy</span>
              <span className="text-[13px] text-muted">Boards, plans, Our Story and photos, as a zip</span>
            </span>
            {chevron}
          </a>
        </section>
      ) : null}

      {space ? (
        <section className="flex flex-col gap-2">
          <Stamp>Leaving</Stamp>
          <Link
            href="/settings/leave"
            className="flex min-h-16 items-center gap-3 rounded-(--radius-card) border border-line bg-surface px-3.5 py-3 text-ink no-underline"
          >
            <span className="flex flex-1 flex-col gap-0.5">
              <span className="text-[15px] font-semibold text-danger">
                {space.status === "active" ? `Leave ${space.name}` : `Close ${space.name}`}
              </span>
              <span className="text-[13px] leading-[1.4] text-muted">
                {space.status === "active"
                  ? `You don’t need ${partner?.displayName || "your person"}’s OK. We’ll show you what happens first.`
                  : "Nobody has joined yet. The invite link stops working."}
              </span>
            </span>
            {chevron}
          </Link>
        </section>
      ) : null}

      <Button variant="text" onClick={signOut} className="mt-auto">
        Sign out
      </Button>
    </Screen>
  );
}
