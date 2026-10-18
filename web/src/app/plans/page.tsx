"use client";

import { BottomNav } from "@/components/bottom-nav";
import { Loading, Screen, Title } from "@/components/ui";
import { useSpace } from "@/lib/use-space";

// D3 · Plans — next slice of Phase 2. Empty state copy from canvas 5.2.
export default function Plans() {
  const { ready } = useSpace();
  if (!ready) return <Loading />;
  return (
    <Screen className="gap-4 px-4 pb-[120px] pt-14">
      <Title className="text-[32px]">Plans</Title>
      <div className="flex flex-col gap-2 pt-10 text-center">
        <h2 className="m-0 font-display text-2xl font-normal">Nothing on the calendar yet.</h2>
        <p className="m-0 text-[15px] leading-[1.55] text-muted">Planning across both your clocks is coming next.</p>
      </div>
      <BottomNav current="plans" />
    </Screen>
  );
}
