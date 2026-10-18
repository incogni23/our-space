"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { NoteForm, toPayload, type NoteDraft } from "@/components/note-form";
import { Loading, Screen, TopBar } from "@/components/ui";
import { errorMessage, type Note } from "@/lib/api";
import { dayKey } from "@/lib/time";
import { useSpace } from "@/lib/use-space";
import { sendOrQueue } from "@/lib/outbox";

// Write a note
export default function NewNote() {
  const router = useRouter();
  const { ready, me, partner } = useSpace({ write: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ready || !me) return <Loading />;
  const myTz = me.user.timeZone;
  const initial: NoteDraft = { body: "", when: "morning", date: dayKey(new Date(Date.now() + 86_400_000), myTz), time: "07:00", inTheirTime: true };

  async function save(d: NoteDraft) {
    setBusy(true);
    setError(null);
    try {
      const r = await sendOrQueue<{ note: Note }>("/notes", toPayload(d, myTz, partner?.timeZone ?? myTz), "A note");
      router.replace(r ? `/notes/${r.note.id}?saved=1` : "/notes");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Screen className="gap-4">
      <TopBar back="/notes" />
      <h1 className="m-0 font-display text-[30px] font-black italic leading-[0.95] tracking-[-0.02em]">Write a note</h1>
      <NoteForm initial={initial} myTz={myTz} partner={partner} submitLabel="Seal it" busy={busy} error={error} onSubmit={save} />
    </Screen>
  );
}
