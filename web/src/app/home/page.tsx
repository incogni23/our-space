"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loading } from "@/components/ui";
import { homeFor } from "@/lib/api";
import { useMe } from "@/lib/use-me";

/** Sends a signed-in person to wherever they are in the journey. */
export default function Home() {
  const router = useRouter();
  const { me } = useMe();
  useEffect(() => {
    if (me) router.replace(homeFor(me));
  }, [me, router]);
  return <Loading />;
}
