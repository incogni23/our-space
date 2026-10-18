"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, ErrorText, Field, Frames, Loading, Screen, cx } from "@/components/ui";
import { api, errorMessage, homeFor, partnerOf, type Tint } from "@/lib/api";
import { useMe } from "@/lib/use-me";

const TINTS: Array<{ id: Tint; label: string; cls: string }> = [
  { id: "terracotta", label: "Terracotta", cls: "bg-terracotta-wash text-terracotta-ink" },
  { id: "sage", label: "Sage", cls: "bg-sage-wash text-sage-ink" },
  { id: "mauve", label: "Mauve", cls: "bg-mauve-wash text-mauve-ink" },
];

// A8 · Make it yours. Next: H1 choose a plan (Phase 1b); until billing lands, the space.
export default function MakeItYours() {
  const router = useRouter();
  const { me, loading } = useMe();
  const [name, setName] = useState("");
  const [tint, setTint] = useState<Tint>("terracotta");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!me) return;
    if (me.space?.status !== "active") {
      router.replace(homeFor(me));
      return;
    }
    setName((n) => n || me.user.displayName);
    setTint(me.user.personTint);
  }, [me, router]);

  if (loading || !me?.space) return <Loading />;
  const partner = partnerOf(me);
  const joinedByMe = me.space.members[1]?.id === me.user.id;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      await api("/me", { method: "PATCH", body: { displayName: name.trim(), personTint: tint, timeZone } });
      router.replace("/space");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Screen className="gap-5">
      <div className="flex items-center gap-3 rounded-(--radius-card) bg-shared-wash px-3.5 py-3">
        <Frames size={28} />
        <span className="text-sm leading-[1.45]">
          <strong className="font-semibold text-shared-ink">
            {joinedByMe ? `You joined ${me.space.name}.` : `${partner?.displayName || "Your person"} joined ${me.space.name}.`}
          </strong>{" "}
          It belongs to both of you now.
        </span>
      </div>

      <div className="flex items-baseline justify-between">
        <h1 className="m-0 font-display text-[32px] font-black italic leading-[0.95] tracking-[-0.02em]">Make it yours.</h1>
        {!joinedByMe ? <span className="font-stamp text-[11px] tracking-[0.1em] text-muted">STEP 4 OF 4</span> : null}
      </div>

      {!me.user.displayName ? (
        <Field id="name" label="Your first name" autoComplete="given-name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
      ) : null}

      <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0">
        <legend className="mb-2.5 p-0 text-[13px] font-medium">
          Your colour <span className="font-normal text-muted">· marks what you save and write</span>
        </legend>
        <div className="grid grid-cols-3 gap-2.5">
          {TINTS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={tint === t.id}
              onClick={() => setTint(t.id)}
              className={cx(
                "flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-(--radius-card) bg-surface text-[13px] font-medium text-ink",
                tint === t.id ? "border-2 border-ink" : "border border-line",
              )}
            >
              <span className={cx("flex size-8 items-center justify-center rounded-full text-sm font-semibold", t.cls)}>
                {(name || "?").slice(0, 1).toUpperCase()}
              </span>
              {t.label}
            </button>
          ))}
        </div>
        {partner ? (
          <span className="text-xs text-muted">
            {partner.displayName || "Your person"} picked {partner.personTint}. You can both pick the same one; initials
            still tell you apart.
          </span>
        ) : null}
      </fieldset>

      <ErrorText>{error}</ErrorText>

      <div className="mt-auto flex flex-col gap-2">
        <Button onClick={save} loading={busy} disabled={!name.trim()}>
          Enter {me.space.name}
        </Button>
      </div>
    </Screen>
  );
}
