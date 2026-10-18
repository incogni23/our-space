"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button, ErrorText, Field, Lead, Loading, Screen, Title, TopBar } from "@/components/ui";
import { ApiError, api, errorMessage, type TogetherSession } from "@/lib/api";
import { useSpace } from "@/lib/use-space";

// Together · start a session (or go to the open one)
export default function TogetherStart() {
  const router = useRouter();
  const { ready, partner } = useSpace({ write: true });
  const [checking, setChecking] = useState(true);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    api<{ session: TogetherSession | null }>("/together")
      .then((r) => (r.session ? router.replace(`/together/${r.session.id}`) : setChecking(false)))
      .catch(() => setChecking(false));
  }, [ready, router]);

  async function start(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ session: TogetherSession }>("/together", { body: { title, url } });
      router.replace(`/together/${r.session.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === "together_open") {
        const cur = await api<{ session: TogetherSession | null }>("/together").catch(() => null);
        if (cur?.session) return router.replace(`/together/${cur.session.id}`);
      }
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (!ready || checking) return <Loading />;
  const pName = partner?.displayName || "your person";

  return (
    <Screen className="gap-5">
      <TopBar back="/space" />
      <div className="flex flex-col gap-2.5">
        <Title>Together</Title>
        <Lead>
          Watch or listen at the same time. YouTube and Spotify links play right here for both of you, in step: the same second, paused together. For anything else, you each press play on a shared 3-2-1.
        </Lead>
      </div>
      <form onSubmit={start} className="flex flex-1 flex-col gap-5">
        <Field id="ttitle" label="What are you putting on?" required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Before Sunrise, or our playlist" autoFocus />
        <Field id="turl" label={<>Link <span className="font-normal text-muted">(optional)</span></>} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="youtube.com/… or open.spotify.com/track/…" inputClassName="text-[15px]" hint="YouTube, Spotify tracks and episodes, or an audio/video file play here. Netflix and others: you each open it." />
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px] leading-[1.5] text-muted">
          <li>{pName} gets an invite. When you’re both here, you start on a shared 3-2-1.</li>
          <li>Either of you can pause for both. Messages here aren’t saved.</li>
        </ul>
        <ErrorText>{error}</ErrorText>
        <div className="mt-auto">
          <Button type="submit" loading={busy} disabled={!title.trim()}>
            Invite {pName}
          </Button>
        </div>
      </form>
    </Screen>
  );
}
