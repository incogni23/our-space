"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api, type Me } from "./api";

type State = { me: Me | null; loading: boolean; error: string | null };

/**
 * Loads the signed-in person. Signed-out visitors go to `signedOut` (default "/"),
 * sessions waiting for a second factor go to /check.
 */
export function useMe(opts: { signedOut?: string | null } = {}) {
  const router = useRouter();
  const signedOut = opts.signedOut === undefined ? "/" : opts.signedOut;
  const [state, setState] = useState<State>({ me: null, loading: true, error: null });

  const load = useCallback(async () => {
    try {
      const me = await api<Me>("/me");
      setState({ me, loading: false, error: null });
      return me;
    } catch (err) {
      if (err instanceof ApiError && err.code === "needs_second_factor") {
        router.replace("/check");
      } else if (err instanceof ApiError && err.status === 401) {
        if (signedOut) router.replace(signedOut);
        setState({ me: null, loading: false, error: null });
      } else {
        setState({ me: null, loading: false, error: "We couldn’t reach Between Us. Check your connection." });
      }
      return null;
    }
  }, [router, signedOut]);

  useEffect(() => {
    void load();
  }, [load]);

  return { ...state, reload: load };
}
