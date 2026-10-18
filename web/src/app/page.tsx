"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Film, Label, Polaroid, SpinStamp } from "@/components/print";
import { ButtonLink, Heart, Loading, Rule, Screen, Tape } from "@/components/ui";
import { homeFor } from "@/lib/api";
import { useMe } from "@/lib/use-me";

// A1 · Welcome (v2: Nº 0 of the magazine)
export default function Welcome() {
  const router = useRouter();
  const { me, loading } = useMe({ signedOut: null });

  useEffect(() => {
    if (me) router.replace(homeFor(me));
  }, [me, router]);

  if (loading || me) return <Loading />;

  return (
    <Screen className="gap-3.5 overflow-x-clip px-[18px] pb-7 pt-[50px]">
      <Rule>
        <span>Between Us</span>
        <span>Nº 0</span>
        <span className="text-accent-ink">For two only</span>
      </Rule>

      <div className="relative h-[368px]" aria-hidden="true">
        <Polaroid rotate={-10} className="absolute -left-1.5 top-10 w-[150px]" pad="p-1.5 pb-[30px]">
          <Film seed={1} className="h-[180px] w-full" />
        </Polaroid>
        <Polaroid rotate={9} className="absolute -right-2 top-[70px] w-[140px]" pad="p-1.5 pb-[30px]">
          <Film seed={2} className="h-[170px] w-full" />
        </Polaroid>
        <Polaroid rotate={-2} caption="just us ♡" ink="var(--accent-ink)" className="absolute left-1/2 top-2 z-[2] ml-[-105px] w-[210px] [&>span]:text-[24px]" pad="p-2 pb-11">
          <Film seed={3} className="h-[250px] w-full" />
        </Polaroid>
        <Tape className="left-1/2 top-[-4px] z-[3] ml-[-49px] h-6 w-[90px]" rotate={-6} />
        <Tape tone="tape" className="right-[30px] top-[60px] z-[1] h-[22px] w-[70px]" rotate={18} />
        <SpinStamp text="· A LITTLE WORLD · FOR TWO " className="absolute bottom-1.5 right-2 z-[4]" />
        <svg width="90" height="70" viewBox="0 0 90 70" className="absolute bottom-1.5 left-3.5 z-[4]">
          <path d="M45 62 C 10 40, 4 18, 20 10 C 32 4, 42 14, 45 22 C 48 14, 58 4, 70 10 C 86 18, 80 40, 45 62" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-display leading-[0.92] tracking-[-0.02em]">
          <span className="block text-[44px] font-normal">A little world</span>
          <span className="block text-[52px] font-black italic text-accent">for two.</span>
        </h1>
        <span className="font-hand text-[23px] text-muted">(just the two of you. promise.)</span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Label>Only you two</Label>
        <Label>No public profile</Label>
        <Label>Leave any time</Label>
      </div>

      <div className="mt-auto flex flex-col gap-2">
        <ButtonLink href="/sign-in?intent=start" className="min-h-[54px]">
          Start our story
          <Heart size={16} />
        </ButtonLink>
        <ButtonLink href="/sign-in?intent=join" variant="secondary" className="min-h-[50px] text-[15px]">
          I have an invite
        </ButtonLink>
        <Link href="/sign-in?intent=signin" className="flex min-h-11 items-center justify-center text-sm font-medium text-ink underline underline-offset-[3px]">
          I already have a space
        </Link>
      </div>
    </Screen>
  );
}
