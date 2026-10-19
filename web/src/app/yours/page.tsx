"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, ErrorText, Field, Heart, Loading, Screen } from "@/components/ui";
import { api, errorMessage, homeFor, partnerOf } from "@/lib/api";
import { hourLabel } from "@/lib/awake";
import { INKS, applyInk, inkColor, type Ink } from "@/lib/theme";
import { useMe } from "@/lib/use-me";

// A8 · Make it yours. Next: H1 choose a plan (Phase 1b); until billing lands, the space.
export default function MakeItYours() {
  const router = useRouter();
  const { me, loading } = useMe();
  const [name, setName] = useState("");
  const [ink, setInk] = useState<Ink>("accent");
  const [awakeFrom, setAwakeFrom] = useState(7);
  const [awakeTo, setAwakeTo] = useState(24);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!me) return;
    if (me.space?.status !== "active") {
      router.replace(homeFor(me));
      return;
    }
    setName((n) => n || me.user.displayName);
    setInk(me.user.ink);
    setAwakeFrom(me.user.awakeFrom);
    setAwakeTo(me.user.awakeTo);
  }, [me, router]);

  if (loading || !me?.space) return <Loading />;
  const partner = partnerOf(me);
  const joinedByMe = me.space.members[1]?.id === me.user.id;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      await api("/me", { method: "PATCH", body: { displayName: name.trim(), personTint: me!.user.personTint, timeZone, ink, awakeFrom, awakeTo } });
      router.replace("/space");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Screen className="gap-5">
      <div className="flex items-center gap-3 rounded-(--radius-card) bg-petal px-3.5 py-3">
        <Heart size={24} color="var(--accent-ink)" />
        <span className="text-sm leading-[1.45]">
          <strong className="font-semibold text-shared-ink">
            {joinedByMe ? `You joined ${me.space.name}.` : `${partner?.displayName || "Your person"} joined ${me.space.name}.`}
          </strong>{" "}
          It belongs to both of you now.
        </span>
      </div>

      <div className="flex items-baseline justify-between">
        <h1 className="m-0 font-display text-[40px] font-black italic leading-[0.95] tracking-[-0.02em]">Make it yours.</h1>
        {!joinedByMe ? <span className="whitespace-nowrap font-type text-[11px] tracking-[0.16em] text-muted">STEP 4 OF 4</span> : null}
      </div>

      {!me.user.displayName ? (
        <Field id="name" label="Your first name" autoComplete="given-name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
      ) : null}

      <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0">
        <legend className="mb-2.5 p-0 text-[13px] font-medium">
          Your handwriting ink <span className="font-normal text-muted">· the words you write show in it</span>
        </legend>
        <div role="radiogroup" aria-label="Your ink" className="flex items-center gap-2.5">
          {INKS.map((i) => (
            <button
              key={i.id}
              type="button"
              role="radio"
              aria-checked={ink === i.id}
              aria-label={i.label}
              onClick={() => {
                setInk(i.id);
                applyInk(i.id);
              }}
              className="size-12 cursor-pointer rounded-full shadow-[inset_0_0_0_3px_var(--ground)]"
              style={{ background: inkColor(i.id), border: ink === i.id ? "2.5px solid var(--text)" : "2px solid transparent" }}
            />
          ))}
          <span className="font-hand text-2xl" style={{ color: inkColor(ink) }}>
            love, {name.trim() || "me"}
          </span>
        </div>
        {partner ? <span className="text-xs text-muted">{partner.displayName || "Your person"} picks their own. You can both use the same one.</span> : null}
      </fieldset>

      <fieldset className="m-0 flex flex-col gap-2 rounded-2xl bg-paper px-4 py-3.5 shadow-(--shadow-paper)">
        <legend className="sr-only">Usually awake</legend>
        <span className="text-[13px] text-muted">Usually awake</span>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="from">
            From
          </label>
          <select id="from" value={awakeFrom} onChange={(e) => setAwakeFrom(Number(e.target.value))} className="h-11 flex-1 rounded-(--radius-control) border border-line-control bg-surface px-2 text-[15px] font-semibold text-ink">
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {hourLabel(h)}
              </option>
            ))}
          </select>
          <span className="text-muted">–</span>
          <label className="sr-only" htmlFor="to">
            Until
          </label>
          <select id="to" value={awakeTo} onChange={(e) => setAwakeTo(Number(e.target.value))} className="h-11 flex-1 rounded-(--radius-control) border border-line-control bg-surface px-2 text-[15px] font-semibold text-ink">
            {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
              <option key={h} value={h} disabled={h === awakeFrom}>
                {hourLabel(h)}
              </option>
            ))}
          </select>
        </div>
        <span className="text-xs text-muted">Only used to suggest good times. Never shown as “online”.</span>
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
