"use client";

import { useState, type FormEvent } from "react";
import { OtpInput } from "@/components/otp-input";
import { Button, ButtonLink, Card, ErrorText, Lead, Loading, Screen, Title, TopBar } from "@/components/ui";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useMe } from "@/lib/use-me";

const COUNTRIES = ["+91", "+1", "+44", "+61", "+65", "+971", "+49"];

type Step = "start" | "current-code" | "new-number" | "new-code" | "done";

// G4 · Change your number: confirm the current number, then verify the new one.
export default function ChangeNumber() {
  const { me, loading, reload } = useMe();
  const [step, setStep] = useState<Step>("start");
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [newId, setNewId] = useState<string | null>(null);
  const [country, setCountry] = useState("+91");
  const [local, setLocal] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const newPhone = `${country}${local.replace(/\D/g, "")}`;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError && err.code === "code_expired" ? "That code has run out. Start again." : errorMessage(err));
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  const sendCurrent = () =>
    run(async () => {
      const res = await api<{ verificationId: string }>("/me/phone/start", { body: { which: "current", phone: "" } });
      setCurrentId(res.verificationId);
      setStep("current-code");
    });

  const confirmCurrent = (e?: FormEvent) => {
    e?.preventDefault();
    return run(async () => {
      await api("/me/phone/approve", { body: { verificationId: currentId, code } });
      setCode("");
      setStep("new-number");
    });
  };

  const sendNew = (e?: FormEvent) => {
    e?.preventDefault();
    return run(async () => {
      const res = await api<{ verificationId: string }>("/me/phone/start", { body: { which: "new", phone: newPhone } });
      setNewId(res.verificationId);
      setStep("new-code");
    });
  };

  const confirmNew = (e?: FormEvent) => {
    e?.preventDefault();
    return run(async () => {
      await api("/me/phone/approve", { body: { verificationId: newId, code } });
      await api("/me/phone", { body: { currentVerificationId: currentId, newVerificationId: newId, phone: newPhone } });
      await reload();
      setStep("done");
    });
  };

  if (loading || !me) return <Loading />;

  return (
    <Screen className="gap-[18px]">
      <TopBar back="/settings" />
      <div className="flex flex-col gap-2.5">
        <Title>New number?</Title>
        <Lead>Your space and everything in it moves with you.</Lead>
      </div>

      <Card className="flex items-center gap-3">
        <span className="flex flex-1 flex-col gap-0.5">
          <span className="text-[13px] text-muted">Current number</span>
          <span className="text-base font-medium">{me.user.phoneMasked}</span>
          {step !== "start" && step !== "current-code" ? <span className="text-xs text-ok-ink">Confirmed with a code</span> : null}
        </span>
      </Card>

      {step === "start" ? (
        <Button onClick={sendCurrent} loading={busy}>
          Text a code to my current number
        </Button>
      ) : null}

      {step === "current-code" || step === "new-code" ? (
        <form onSubmit={step === "current-code" ? confirmCurrent : confirmNew} className="flex flex-col gap-2.5">
          <label htmlFor="g4-otp" className="text-[13px] font-medium">
            {step === "current-code" ? `Code sent to ${me.user.phoneMasked}` : `Code sent to ${country} ${local}`}
          </label>
          <OtpInput id="g4-otp" value={code} onChange={setCode} invalid={!!error} autoFocus />
          <Button type="submit" loading={busy} disabled={code.length !== 6}>
            {step === "current-code" ? "Confirm" : "Confirm new number"}
          </Button>
        </form>
      ) : null}

      {step === "new-number" ? (
        <form onSubmit={sendNew} className="flex flex-col gap-2.5">
          <label htmlFor="newnum" className="text-[13px] font-medium">
            New number
          </label>
          <div className="flex gap-2">
            <label htmlFor="newcountry" className="sr-only">
              Country code
            </label>
            <select
              id="newcountry"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="h-[52px] rounded-(--radius-control) border border-line-control bg-surface px-3 text-base text-ink"
            >
              {COUNTRIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <input
              id="newnum"
              type="tel"
              inputMode="tel"
              autoFocus
              value={local}
              onChange={(e) => setLocal(e.target.value)}
              className="h-[52px] min-w-0 flex-1 rounded-(--radius-control) border border-line-control bg-surface px-3.5 text-[17px] text-ink focus:border-2 focus:border-ink focus:outline-none"
            />
          </div>
          <Button type="submit" loading={busy} disabled={local.replace(/\D/g, "").length < 6}>
            Text a code to the new number
          </Button>
        </form>
      ) : null}

      {step === "done" ? (
        <div className="flex flex-col gap-1.5 rounded-(--radius-card) bg-ok-wash p-4 text-ok-ink">
          <span className="text-base font-semibold">Your number is now {me.user.phoneMasked}.</span>
          <span className="text-[13px] leading-[1.5]">Your old number no longer signs you in.</span>
        </div>
      ) : null}

      <ErrorText>{error}</ErrorText>

      <ul className="m-0 mt-auto flex list-none flex-col gap-2 border-t border-line p-0 pt-3.5 text-[13px] leading-[1.5] text-muted">
        <li>Your person sees a short note that you updated your number, not the number itself.</li>
        <li>The old number stops working for sign-in as soon as the new one is confirmed.</li>
        <li>If that old number is later given to someone else, it opens nothing here.</li>
      </ul>
      {step === "done" ? (
        <ButtonLink href="/settings" variant="secondary">
          Back to settings
        </ButtonLink>
      ) : null}
    </Screen>
  );
}
