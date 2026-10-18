"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { homeFor, partnerOf } from "./api";
import { useMe } from "./use-me";

/** For pages inside an active space: sends everyone else to where they belong. */
export function useSpace() {
  const router = useRouter();
  const state = useMe();
  const { me } = state;
  useEffect(() => {
    if (me && me.space?.status !== "active") router.replace(homeFor(me));
  }, [me, router]);
  const ready = !!me && me.space?.status === "active";
  const partner = me ? partnerOf(me) : undefined;
  const people = me ? [me.user, ...(partner ? [partner] : [])] : [];
  return { ...state, ready, partner, people };
}
