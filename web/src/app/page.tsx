"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ButtonLink, CheckItem, Loading, Logo, Screen } from "@/components/ui";
import { homeFor } from "@/lib/api";
import { useMe } from "@/lib/use-me";

// A1 · Welcome
export default function Welcome() {
  const router = useRouter();
  const { me, loading } = useMe({ signedOut: null });

  useEffect(() => {
    if (me) router.replace(homeFor(me));
  }, [me, router]);

  if (loading || me) return <Loading />;

  return (
    <Screen className="pt-[60px]">
      <Logo />

      <div className="relative h-[220px]" aria-hidden="true">
        <div className="absolute left-1.5 top-2 h-[170px] w-[210px] rounded-(--radius-pin) border border-line bg-surface p-3.5 shadow-(--shadow-paper)">
          <span className="font-stamp text-[10px] tracking-[0.1em] text-muted">YOU</span>
        </div>
        <div className="absolute left-[134px] top-[50px] flex h-[170px] w-[210px] items-end justify-end rounded-(--radius-pin) border border-line bg-surface p-3.5 shadow-(--shadow-paper)">
          <span className="font-stamp text-[10px] tracking-[0.1em] text-muted">YOUR PERSON</span>
        </div>
        <div className="absolute left-[134px] top-[50px] flex h-[128px] w-[82px] items-center justify-center rounded-[12px_0_12px_0] bg-shared">
          <span className="font-display text-[40px] italic text-[#44353E]">us</span>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h1 className="m-0 font-display text-[40px] font-normal leading-[1.02] tracking-[-0.02em]">
          A little world
          <br />
          for two.
        </h1>
        <p className="m-0 text-base leading-[1.5] text-muted">
          A private space for exactly two people: the things you save, the plans you make, the notes you leave and the
          story you keep.
        </p>
      </div>

      <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
        <CheckItem>Only the two of you. Never anyone else.</CheckItem>
        <CheckItem>No public profile, no followers.</CheckItem>
        <CheckItem>Either of you can leave, any time.</CheckItem>
      </ul>

      <div className="mt-auto flex flex-col gap-2.5">
        <ButtonLink href="/sign-in?intent=start">Start a space</ButtonLink>
        <ButtonLink href="/sign-in?intent=join" variant="secondary">
          I have an invite
        </ButtonLink>
        <ButtonLink href="/sign-in?intent=signin" variant="text">
          I already have a space
        </ButtonLink>
      </div>
    </Screen>
  );
}
