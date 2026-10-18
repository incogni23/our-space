"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FamilyGrid, usePalette } from "@/components/palette-picker";
import { Film } from "@/components/print";
import { ErrorText, Heart, Loading, Screen } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { INKS, applyFamily, applyInk, familyName, inkColor, type Family, type Ink } from "@/lib/theme";
import { useSpace } from "@/lib/use-space";

// v2 · Pick your colours. The family is shared; the ink is yours.
export default function Colours() {
  const router = useRouter();
  const { ready, me, partner, reload } = useSpace({ write: true });
  const [family, setFamily] = useState<Family | null>(null);
  const [ink, setInk] = useState<Ink | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const palette = usePalette(me?.space?.palette);

  if (!ready || !me?.space) return <Loading />;
  const fam = family ?? me.space.palette;
  const myInk = ink ?? me.user.ink;
  const pName = partner?.displayName || "your person";

  function preview(f: Family) {
    setFamily(f);
    applyFamily(f);
  }

  function previewInk(i: Ink) {
    setInk(i);
    applyInk(i);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (myInk !== me!.user.ink) {
        await api("/me", {
          method: "PATCH",
          body: { displayName: me!.user.displayName, personTint: me!.user.personTint, ink: myInk },
        });
      }
      if (fam !== me!.space!.palette && !(await palette.pick(fam))) {
        setBusy(false);
        return;
      }
      await reload();
      router.push("/space");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  function back() {
    // Leaving without saving puts the old look back.
    applyFamily(me!.space!.palette);
    applyInk(me!.user.ink);
  }

  return (
    <Screen className="gap-4 px-4 pb-[150px] pt-[50px]">
      <div className="flex items-center justify-between">
        <Link href="/space" onClick={back} aria-label="Back" className="-ml-2.5 flex size-11 items-center justify-center text-ink">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </Link>
        <span className="font-type text-[11px] tracking-[0.16em] text-muted">MAKE IT YOURS</span>
        <span className="w-[34px]" />
      </div>

      <div className="flex flex-col gap-0.5">
        <h1 className="m-0 font-display text-[44px] font-black italic leading-[0.95] tracking-[-0.02em]">Pick your colours.</h1>
        <span className="font-hand text-2xl text-accent-ink">together, or surprise them</span>
      </div>

      <div role="img" aria-label={`Preview of ${me.space.name} in ${familyName(fam)}`} className="relative h-[250px] overflow-hidden rounded-[20px] bg-paper shadow-[0_16px_30px_-18px_rgba(0,0,0,0.5)]">
        <div className="absolute inset-2.5 rounded-[14px] bg-ground p-3">
          <span className="font-display text-[30px] font-black italic leading-[0.9]">{me.space.name}</span>
          <div className="mt-1.5 border-t-2 border-ink" />
          <div className="absolute left-4 top-[66px] w-[140px] -rotate-4 bg-paper p-[5px] pb-[26px] shadow-[0_10px_18px_-10px_rgba(0,0,0,0.6)]">
            <Film seed={3} className="h-[118px] w-full" />
            <span className="absolute bottom-[3px] left-2 font-hand text-base" style={{ color: inkColor(myInk) }}>
              us, at the window
            </span>
          </div>
          <span className="absolute left-[58px] top-[58px] h-4 w-[60px] -rotate-10 bg-petal" />
          <div className="absolute right-4 top-[66px] flex w-[150px] flex-col gap-[3px] rounded-xl bg-paper p-2.5">
            <span className="font-type text-[9px] font-bold tracking-[0.14em] text-accent-ink">TONIGHT</span>
            <span className="font-display text-lg font-bold italic">Sunday call</span>
            <span className="text-[11px] text-muted">8:30 pm · 11:00 am</span>
          </div>
          <div className="absolute bottom-4 right-[22px] flex size-[62px] items-center justify-center rounded-full bg-accent-ink">
            <Heart size={26} color="var(--on-accent)" />
          </div>
          <span className="absolute bottom-[22px] left-[172px] -rotate-8 font-display text-[26px] font-bold italic text-accent">xoxo</span>
        </div>
      </div>

      <FamilyGrid big value={fam} onPick={preview} />

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-2 p-0 text-[13px] font-semibold">
          Your handwriting ink <span className="font-normal text-muted">· {pName} picks their own</span>
        </legend>
        <div role="radiogroup" aria-label="Your ink" className="flex items-center gap-2.5">
          {INKS.map((i) => (
            <button
              key={i.id}
              type="button"
              role="radio"
              aria-checked={i.id === myInk}
              aria-label={i.label}
              onClick={() => previewInk(i.id)}
              className="size-12 cursor-pointer rounded-full shadow-[inset_0_0_0_3px_var(--ground)]"
              style={{ background: inkColor(i.id), border: i.id === myInk ? "2.5px solid var(--text)" : "2px solid transparent" }}
            />
          ))}
          <span className="font-hand text-2xl" style={{ color: inkColor(myInk) }}>
            love, {me.user.displayName || "me"}
          </span>
        </div>
      </fieldset>

      <ErrorText>{error ?? palette.error}</ErrorText>

      <div className="fixed inset-x-0 bottom-0 bg-ground px-4 pb-7 pt-3.5">
        <div className="mx-auto flex max-w-[408px] flex-col gap-1.5">
          <button
            type="button"
            onClick={save}
            disabled={busy}
            aria-busy={busy || undefined}
            className="min-h-[54px] rounded-[27px] bg-nav text-base font-medium text-nav-text disabled:opacity-55"
          >
            {fam === me.space.palette ? "Save" : `Paint ${me.space.name} ${familyName(fam)}`}
          </button>
          <span className="text-center text-xs text-muted">{pName} gets a little note. Either of you can change it any time.</span>
        </div>
      </div>
    </Screen>
  );
}
