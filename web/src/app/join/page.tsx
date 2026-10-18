"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, ErrorText, Field, Lead, Screen, Title, TopBar } from "@/components/ui";

/** Pull the token out of a pasted link (…/join/<token>) or accept a bare token. */
function tokenFrom(input: string): string | null {
  const s = input.trim();
  const m = s.match(/\/join\/([A-Za-z0-9_-]{20,})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(s) ? s : null;
}

// "I have an invite" without the link open
export default function JoinWithLink() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const t = tokenFrom(value);
    if (!t) {
      setError("That doesn’t look like an invite link. Ask your person to send it again.");
      return;
    }
    router.push(`/join/${t}`);
  }

  return (
    <Screen>
      <TopBar back="/" />
      <div className="flex flex-col gap-2.5">
        <Title>Open your invite.</Title>
        <Lead>Tap the link your person sent you, or paste it here.</Lead>
      </div>
      <form onSubmit={submit} className="flex flex-1 flex-col gap-6">
        <Field
          id="link"
          label="Invite link"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="https://…/join/…"
          autoFocus
          inputClassName="text-[15px]"
        />
        <ErrorText>{error}</ErrorText>
        <div className="mt-auto">
          <Button type="submit" disabled={!value.trim()}>
            Continue
          </Button>
        </div>
      </form>
    </Screen>
  );
}
