"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useLiveTick } from "./live";
import { homeFor, partnerOf } from "./api";
import { useMe } from "./use-me";

/**
 * For pages inside a space: an active one, or a closed one during its read-only
 * window (`readOnly`). Sends everyone else to where they belong.
 */
export function useSpace(opts: { write?: boolean } = {}) {
  const router = useRouter();
  const state = useMe();
  const { me, reload } = state;
  const spaceTick = useLiveTick(["space.", "notice.", "note.delivered"], !!me?.space);
  useEffect(() => {
    if (spaceTick) void reload();
  }, [spaceTick, reload]);
  const active = !!me && me.space?.status === "active";
  const readOnly = !!me && !me.space && !!me.readOnlySpace;
  useEffect(() => {
    if (!me) return;
    if (readOnly && opts.write) router.replace("/space");
    else if (!active && !readOnly) router.replace(homeFor(me));
  }, [me, router, active, readOnly, opts.write]);
  const ready = active || (readOnly && !opts.write);
  const partner = me ? (active ? partnerOf(me) : me.readOnlySpace?.members.find((m) => m.id !== me.user.id)) : undefined;
  const people = me ? [me.user, ...(partner ? [partner] : [])] : [];
  const spaceName = me?.space?.name ?? me?.readOnlySpace?.name ?? "";
  return { ...state, ready, readOnly, partner, people, spaceName };
}
