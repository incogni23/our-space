"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button, Card, ErrorText, Field, Lead, Loading, Screen, Title, TopBar, cx } from "@/components/ui";
import { ApiError, api, errorMessage, formatDay, homeFor } from "@/lib/api";
import { useMe } from "@/lib/use-me";

const SUGGESTIONS = ["Window Seat", "Our place", "Sundays", "Two time zones"];

// A4 · Make a space
export default function NewSpace() {
  const router = useRouter();
  const { me, loading } = useMe();
  const [myName, setMyName] = useState("");
  const [spaceName, setSpaceName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableAt, setAvailableAt] = useState<string | null>(null);

  useEffect(() => {
    if (!me) return;
    if (me.space) router.replace(homeFor(me));
    setMyName((n) => n || me.user.displayName);
    setAvailableAt(me.newSpaceAvailableAt ?? null);
  }, [me, router]);

  const timeZone = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!me) return;
    setBusy(true);
    setError(null);
    try {
      await api("/me", {
        method: "PATCH",
        body: { displayName: myName.trim(), personTint: me.user.personTint, timeZone: timeZone || undefined },
      });
      await api("/space", { body: { name: spaceName.trim() || "Our space" } });
      router.push("/invite");
    } catch (err) {
      if (err instanceof ApiError && err.code === "cooldown") setAvailableAt(err.detail.availableAt ?? null);
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (loading || !me) return <Loading />;

  return (
    <Screen>
      <TopBar back="/" step="STEP 2 OF 4" />
      <div className="flex flex-col gap-2.5">
        <Title>Make a space.</Title>
        <Lead>Only the two of you will see these. You can change them together later.</Lead>
      </div>

      {me.readOnlySpace ? (
        <Card className="flex items-center justify-between gap-3">
          <span className="text-sm leading-[1.45]">
            <strong className="font-semibold">{me.readOnlySpace.name}</strong> is readable until {formatDay(me.readOnlySpace.until)}.
          </span>
          <Link href="/space" className="flex min-h-11 items-center text-sm font-medium">
            Open
          </Link>
        </Card>
      ) : null}

      {availableAt ? (
        <Card className="bg-time-wash">
          <p className="m-0 text-sm leading-[1.5] text-time-ink">
            <strong className="font-semibold">You can start a new space from {formatDay(availableAt)}.</strong> There’s a
            short pause after leaving a space.
          </p>
        </Card>
      ) : null}

      <form onSubmit={submit} className="flex flex-1 flex-col gap-6">
        <Field
          id="myname"
          label="Your first name"
          autoComplete="given-name"
          required
          maxLength={40}
          value={myName}
          onChange={(e) => setMyName(e.target.value)}
        />

        <div className="flex flex-col gap-2">
          <label htmlFor="spacename" className="text-[13px] font-medium">
            Name your space <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="spacename"
            value={spaceName}
            maxLength={60}
            onChange={(e) => setSpaceName(e.target.value)}
            placeholder="Our space"
            className="h-14 rounded-(--radius-control) border-2 border-ink bg-surface px-3.5 font-display text-2xl text-ink placeholder:text-muted focus:outline-none"
          />
          <div className="flex flex-wrap gap-2 pt-1">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={spaceName === s}
                onClick={() => setSpaceName(s)}
                className={cx(
                  "min-h-10 rounded-[10px] border px-3.5 text-sm font-medium text-ink",
                  spaceName === s ? "border-shared bg-shared-wash" : "border-line bg-surface",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {timeZone ? (
          <Card className="flex flex-col gap-0.5">
            <span className="text-[13px] text-muted">Your time zone</span>
            <span className="text-[15px] font-semibold">{timeZone.replace(/_/g, " ")}</span>
            <span className="text-xs text-muted">Used to show both your clocks. Detected from this device.</span>
          </Card>
        ) : null}

        <ErrorText>{error}</ErrorText>

        <div className="mt-auto">
          <Button type="submit" loading={busy} disabled={!myName.trim() || !!availableAt}>
            Continue
          </Button>
        </div>
      </form>
    </Screen>
  );
}
