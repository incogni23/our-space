"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { OtpInput } from "@/components/otp-input";
import { Button, Card, ErrorText, Lead, Loading, Screen, Title, TopBar } from "@/components/ui";
import { ApiError, api, errorMessage, type SignInResult } from "@/lib/api";

const COUNTRIES = [
  { code: "+91", label: "India" },
  { code: "+1", label: "United States / Canada" },
  { code: "+44", label: "United Kingdom" },
  { code: "+61", label: "Australia" },
  { code: "+65", label: "Singapore" },
  { code: "+971", label: "United Arab Emirates" },
  { code: "+49", label: "Germany" },
];

/** Only same-site paths are allowed as a return destination. */
function safeNext(v: string | null): string | null {
  return v && v.startsWith("/") && !v.startsWith("//") ? v : null;
}

// A2 · Your number → A3 · Enter the code
function SignIn() {
  const router = useRouter();
  const params = useSearchParams();
  const intent = params.get("intent") ?? "start";
  const next = safeNext(params.get("next")) ?? (intent === "join" ? "/join" : null);
  const stepLabel = intent === "start" ? "STEP 1 OF 4" : undefined;

  const [country, setCountry] = useState("+91");
  const [local, setLocal] = useState("");
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  const phone = `${country}${local.replace(/[^\d]/g, "")}`;
  const display = `${country} ${local.trim()}`;

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ verificationId: string }>("/auth/start", { body: { phone } });
      setVerificationId(res.verificationId);
      setCode("");
      setResendIn(30);
    } catch (err) {
      if (err instanceof ApiError && err.code === "rate_limited") setResendIn(err.detail.retryAfterSeconds ?? 30);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e?: FormEvent) {
    e?.preventDefault();
    if (!verificationId || code.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<SignInResult>("/auth/verify", { body: { verificationId, code } });
      if (res.sessionStatus === "needs_second_factor") {
        router.replace(next ? `/check?next=${encodeURIComponent(next)}` : "/check");
      } else {
        router.replace(next ?? "/home");
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === "code_expired") {
        setError("That code has run out or had too many tries. We can send a new one.");
      } else {
        setError(errorMessage(err));
      }
      setCode("");
      setBusy(false);
    }
  }

  useEffect(() => {
    if (code.length === 6 && !busy) void verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  if (!verificationId) {
    return (
      <Screen className="gap-7">
        <TopBar back="/" step={stepLabel} />
        <div className="flex flex-col gap-2.5">
          <Title>{intent === "signin" ? "Welcome back." : "First, your number."}</Title>
          <Lead>We’ll text you a 6-digit code. It proves this number is yours; it doesn’t tell anyone you’re here.</Lead>
        </div>

        <form onSubmit={sendCode} className="flex flex-1 flex-col gap-7">
          <div className="flex flex-col gap-2">
            <label htmlFor="phone" className="text-[13px] font-medium">
              Mobile number
            </label>
            <div className="flex gap-2">
              <label htmlFor="country" className="sr-only">
                Country code
              </label>
              <select
                id="country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="h-[52px] w-[118px] flex-none truncate rounded-(--radius-control) border border-line-control bg-surface px-3 text-base font-medium text-ink"
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} {c.label}
                  </option>
                ))}
              </select>
              <input
                id="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                autoFocus
                required
                value={local}
                onChange={(e) => setLocal(e.target.value)}
                placeholder="98765 43210"
                className="h-[52px] min-w-0 flex-1 rounded-(--radius-control) border border-line-control bg-surface px-3.5 text-[17px] tracking-[0.02em] text-ink placeholder:text-muted focus:border-2 focus:border-ink focus:outline-none"
              />
            </div>
          </div>

          <Card className="flex gap-3">
            <svg width="20" height="20" viewBox="0 0 32 32" className="mt-px flex-none" aria-hidden="true">
              <rect x="8" y="5" width="16" height="22" rx="3" fill="none" stroke="currentColor" strokeWidth="2.2" />
            </svg>
            <p className="m-0 text-sm leading-[1.5] text-muted">
              <strong className="font-semibold text-ink">One number, one person.</strong> Your person verifies their own
              number when they join. Nobody can be added to your space without saying yes.
            </p>
          </Card>

          <ErrorText>{error}</ErrorText>

          <div className="mt-auto flex flex-col gap-3">
            <Button type="submit" loading={busy} disabled={local.replace(/\D/g, "").length < 6 || resendIn > 0}>
              {resendIn > 0 ? `Try again in ${resendIn}s` : "Send code"}
            </Button>
            <span className="text-center text-xs leading-[1.5] text-muted">
              Carrier SMS rates may apply. We never use your number for marketing.
            </span>
          </div>
        </form>
      </Screen>
    );
  }

  return (
    <Screen className="gap-7">
      <TopBar back={() => setVerificationId(null)} step={stepLabel} />
      <div className="flex flex-col gap-2.5">
        <Title>Enter the code.</Title>
        <Lead>
          Sent to {display}.{" "}
          <button type="button" onClick={() => setVerificationId(null)} className="font-medium text-ink underline">
            Change number
          </button>
        </Lead>
      </div>

      <form onSubmit={verify} className="flex flex-1 flex-col gap-7">
        <div className="flex flex-col gap-2.5">
          <label htmlFor="otp" className="text-[13px] font-medium">
            6-digit code
          </label>
          <OtpInput id="otp" value={code} onChange={setCode} invalid={!!error} autoFocus />
          <div className="flex min-h-11 items-center justify-between text-sm">
            {resendIn > 0 ? (
              <span className="text-muted">
                Resend in <span className="font-stamp">0:{String(resendIn).padStart(2, "0")}</span>
              </span>
            ) : (
              <button type="button" onClick={() => sendCode()} className="min-h-11 font-medium text-ink underline">
                Send a new code
              </button>
            )}
          </div>
        </div>

        <ErrorText>{error}</ErrorText>

        <div className="mt-auto">
          <Button type="submit" loading={busy} disabled={code.length !== 6}>
            Verify
          </Button>
        </div>
      </form>
    </Screen>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<Loading />}>
      <SignIn />
    </Suspense>
  );
}
