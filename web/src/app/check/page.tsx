"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { Button, ErrorText, Field, Lead, Loading, Screen, Title, TopBar } from "@/components/ui";
import { ApiError, api, errorMessage } from "@/lib/api";

function safeNext(v: string | null): string {
  return v && v.startsWith("/") && !v.startsWith("//") ? v : "/home";
}

// G5 · New phone · one more check
function Check() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"code" | "fresh" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handle(err: unknown) {
    if (err instanceof ApiError && err.status === 401) router.replace("/sign-in?intent=signin");
    else setError(errorMessage(err));
  }

  async function useCode(e: FormEvent) {
    e.preventDefault();
    setBusy("code");
    setError(null);
    try {
      await api("/auth/recovery", { body: { code } });
      router.replace(next);
    } catch (err) {
      handle(err);
      setBusy(null);
    }
  }

  async function startFresh() {
    setBusy("fresh");
    setError(null);
    try {
      await api("/auth/start-fresh", { body: {} });
      router.replace("/new");
    } catch (err) {
      handle(err);
      setBusy(null);
    }
  }

  return (
    <Screen className="gap-[18px]">
      <TopBar back="/" right={<span className="font-stamp text-[11px] tracking-[0.1em] text-muted">SIGNING IN</span>} />
      <div className="flex flex-col gap-2.5">
        <Title>One more check.</Title>
        <Lead>Your number is verified, but this device is new to us. A text code alone doesn’t open a space full of memories.</Lead>
      </div>

      <form onSubmit={useCode} className="flex flex-col gap-3">
        <Field
          id="recovery"
          label="A recovery code you saved"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="abcde-fghjk"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputClassName="font-stamp tracking-[0.08em]"
          hint="One of the 8 codes from Settings › Recovery codes."
        />
        <ErrorText>{error}</ErrorText>
        <Button type="submit" loading={busy === "code"} disabled={!code.trim() || !!busy}>
          Use recovery code
        </Button>
      </form>

      <div className="flex flex-col gap-2.5 border-t border-line pt-[18px]">
        <span className="font-display text-xl leading-[1.2]">Just got this number?</span>
        <span className="text-[13px] leading-[1.5] text-muted">
          Carriers reuse numbers. If it’s new to you, start fresh with it. You won’t see anything from before, and the old
          account stays locked to its owner.
        </span>
        <Button variant="secondary" onClick={startFresh} loading={busy === "fresh"} disabled={!!busy}>
          This number is new to me
        </Button>
      </div>
    </Screen>
  );
}

export default function CheckPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Check />
    </Suspense>
  );
}
