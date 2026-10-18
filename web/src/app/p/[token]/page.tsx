"use client";
/* eslint-disable @next/next/no-img-element -- served by our API, no-store */

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/ui";

// F4 · A preview link: the one image, nothing else. No sign-in, no tracking.
export default function SharedImage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<"loading" | "ok" | "off">("loading");

  useEffect(() => {
    fetch(`/api/v1/public/links/${encodeURIComponent(token)}`, { cache: "no-store", credentials: "omit" })
      .then((r) => setState(r.ok ? "ok" : "off"))
      .catch(() => setState("off"));
  }, [token]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-ground px-4 py-10 text-ink">
      {state === "ok" ? (
        <img
          src={`/api/v1/public/links/${encodeURIComponent(token)}/image`}
          alt="A picture shared from Between Us"
          referrerPolicy="no-referrer"
          className="max-h-[80vh] w-auto max-w-full shadow-(--shadow-lift)"
        />
      ) : state === "off" ? (
        <div className="flex max-w-[360px] flex-col items-center gap-3 text-center">
          <h1 className="m-0 font-display text-[30px] font-normal leading-[1.1]">This link has been turned off.</h1>
          <p className="m-0 text-[15px] leading-[1.55] text-muted">It may have run out, or the people who shared it turned it off.</p>
        </div>
      ) : null}
      <Logo className="text-lg text-muted" />
    </main>
  );
}
