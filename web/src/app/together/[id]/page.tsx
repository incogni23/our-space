"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { SyncedPlayer, mediaLabel, mediaOf } from "@/components/synced-player";
import { Avatar, Button, ErrorText, Loading, Screen, cx } from "@/components/ui";
import { api, errorMessage, type TogetherSession } from "@/lib/api";
import { useSpace } from "@/lib/use-space";

type Msg = { from: string; text: string; at: string };

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

// Together · a session. Being on this screen is what "here" means; nothing is stored.
export default function TogetherRoom() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const { ready, me, partner } = useSpace({ write: true });
  const [s, setS] = useState<TogetherSession | null>(null);
  const [here, setHere] = useState<string[]>([]);
  const [offset, setOffset] = useState(0); // server clock minus ours
  const [now, setNow] = useState(() => Date.now());
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!ready) return;
    const es = new EventSource(`/api/v1/together/${id}/stream`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener("state", (e) => {
      const ev = JSON.parse((e as MessageEvent).data) as { session: TogetherSession; here: string[] };
      setS(ev.session);
      setHere(ev.here ?? []);
      setOffset(new Date(ev.session.serverNow).getTime() - Date.now());
    });
    es.addEventListener("message", (e) => {
      const ev = JSON.parse((e as MessageEvent).data) as { message: Msg };
      setMsgs((m) => [...m.slice(-99), ev.message]);
    });
    return () => es.close();
  }, [ready, id]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [msgs.length]);

  async function act(action: string, positionMs?: number) {
    setBusy(action);
    setError(null);
    try {
      await api(`/together/${id}/act`, { body: { action, positionMs: positionMs ?? 0 } });
      if (action === "end") router.replace("/space");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function say(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    const t = text;
    setText("");
    try {
      await api(`/together/${id}/say`, { body: { text: t } });
    } catch (err) {
      setError(errorMessage(err));
      setText(t);
    }
  }

  if (!ready || !me) return <Loading />;
  if (!s) {
    return (
      <Screen className="items-center justify-center">
        <span className="text-sm text-muted">Joining…</span>
      </Screen>
    );
  }

  const pName = partner?.displayName || "your person";
  const meHere = here.includes(me.user.id);
  const partnerHere = !!partner && here.includes(partner.id);
  const serverNow = now + offset;
  const startAt = new Date(s.positionAt).getTime();
  const countdown = s.status === "playing" && serverNow < startAt ? Math.ceil((startAt - serverNow) / 1000) : 0;
  const pos = s.status === "playing" && serverNow >= startAt ? s.positionMs + (serverNow - startAt) : s.positionMs;
  const droppedByPartner = s.status === "paused" && s.pausedReason === "connection" && s.updatedBy !== me.user.id;
  const heldTooLong = s.status === "paused" && serverNow - startAt > 5 * 60_000 && !partnerHere;
  const media = mediaOf(s.url);

  if (s.status === "ended") {
    return (
      <Screen className="items-center justify-center gap-4 text-center">
        <h1 className="m-0 font-display text-[40px] font-black italic">That was nice.</h1>
        <p className="m-0 text-[15px] text-muted">The session has ended. Messages from it weren’t kept.</p>
        <Link href="/space" className="font-medium">
          Back to your space
        </Link>
      </Screen>
    );
  }

  return (
    <main className="min-h-dvh bg-[#2E2329] text-[#F3EBE1]">
      <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col gap-5 px-4 pb-6 pt-[52px]">
        <div className="flex items-center justify-between">
          <Link href="/space" className="-ml-1.5 flex min-h-11 items-center gap-1 text-[15px] text-[#F3EBE1] no-underline">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" />
            </svg>
            Space
          </Link>
          <span className="font-stamp text-[11px] uppercase tracking-[0.1em] text-[#C2B5AB]">Together</span>
        </div>

        <div className="flex flex-col gap-2">
          <h1 className="m-0 font-display text-[30px] font-black italic leading-[0.95] tracking-[-0.02em]">{s.title}</h1>
          {media ? (
            <span className="font-type text-[11px] uppercase tracking-[0.12em] text-[#C2B5AB]">{mediaLabel(media)} · plays here for both of you, in step</span>
          ) : s.url ? (
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="self-start text-sm font-medium text-[#DDA09D]">
              Open it in its own app →
            </a>
          ) : null}
        </div>

        <div className="flex gap-3" aria-label="Who’s here">
          {[
            { id: me.user.id, name: me.user.displayName || "You", ink: me.user.ink, on: meHere && connected },
            ...(partner ? [{ id: partner.id, name: partner.displayName || "Them", ink: partner.ink, on: partnerHere }] : []),
          ].map((p) => (
            <span key={p.id} className="flex items-center gap-2 rounded-full bg-[rgba(243,235,225,0.08)] py-1 pl-1 pr-3 text-[13px]">
              <Avatar name={p.name} ink={p.ink} size={26} />
              {p.id === me.user.id ? "You" : p.name}
              <span className={cx("size-2 rounded-full", p.on ? "bg-[#B9C6AC]" : "bg-[#7A6D73]")} aria-label={p.on ? "here" : "not here"} />
            </span>
          ))}
        </div>

        {droppedByPartner && !partnerHere ? (
          <div role="status" className="rounded-(--radius-card) bg-[#4A3226] px-4 py-3 text-sm leading-[1.5] text-[#E6B79F]">
            {heldTooLong ? (
              <strong className="font-semibold">Pick up where you left off?</strong>
            ) : (
              <>
                <strong className="font-semibold">{pName}’s connection dropped.</strong> Playback is paused for both of you. We’ll hold your place for 5 minutes.
              </>
            )}
          </div>
        ) : null}

        {media ? (
          <SyncedPlayer
            media={media}
            status={s.status}
            positionMs={s.positionMs}
            startAt={startAt}
            offset={offset}
            onUserPause={(ms) => void act("pause", Math.max(0, Math.round(ms)))}
          />
        ) : null}

        <div className={cx("flex flex-col items-center gap-3 rounded-[22px] bg-[rgba(243,235,225,0.06)] px-4 text-center", media ? "py-4" : "py-8")}>
          {s.status === "waiting" ? (
            <>
              <span className="font-display text-2xl">{partnerHere ? `${pName} is here.` : `Waiting for ${pName}…`}</span>
              <span className="text-sm text-[#C2B5AB]">{partnerHere ? (media ? "Start together and it plays here for both of you." : "Open it in your apps, then start together.") : "They’ve been invited. You can wait here."}</span>
            </>
          ) : countdown > 0 ? (
            <>
              <span className={cx("font-display leading-none", media ? "text-[56px]" : "text-[88px]")} aria-live="assertive">
                {countdown}
              </span>
              <span className="text-sm text-[#C2B5AB]">{media ? "Starting for both of you" : "Get ready to press play"}{s.positionMs ? ` at ${clock(s.positionMs)}` : ""}</span>
            </>
          ) : s.status === "playing" ? (
            <>
              <span className="font-stamp text-[11px] uppercase tracking-[0.1em] text-[#B9C6AC]">Playing for both</span>
              <span className={cx("font-display leading-none tabular-nums", media ? "text-[36px]" : "text-[56px]")}>{clock(pos)}</span>
              <span className="text-xs text-[#C2B5AB]">
                {media ? "If either of you falls behind, it pulls you back in step." : "If you drift, use −10s / +10s to line up together."}
              </span>
            </>
          ) : (
            <>
              <span className="font-stamp text-[11px] uppercase tracking-[0.1em] text-[#E6B79F]">Paused for both</span>
              <span className={cx("font-display leading-none tabular-nums", media ? "text-[36px]" : "text-[56px]")}>{clock(pos)}</span>
            </>
          )}
        </div>

        <ErrorText>{error}</ErrorText>

        <div className="flex flex-col gap-2">
          {s.status === "waiting" ? (
            <Button className="bg-[#F3EBE1]! text-[#231C21]! hover:bg-white!" onClick={() => act("start")} loading={busy === "start"} disabled={!partnerHere}>
              {partnerHere ? "Start together" : `Start when ${pName} is here`}
            </Button>
          ) : s.status === "playing" ? (
            <div className="grid grid-cols-[1fr_2fr_1fr] gap-2">
              <Button className="min-h-12 bg-[rgba(243,235,225,0.1)]! text-[#F3EBE1]! hover:bg-[rgba(243,235,225,0.16)]!" onClick={() => act("seek", Math.max(0, pos - 10_000))} aria-label="Back 10 seconds for both">
                −10s
              </Button>
              <Button className="min-h-12 bg-[#F3EBE1]! text-[#231C21]! hover:bg-white!" onClick={() => act("pause")} loading={busy === "pause"}>
                Pause for both
              </Button>
              <Button className="min-h-12 bg-[rgba(243,235,225,0.1)]! text-[#F3EBE1]! hover:bg-[rgba(243,235,225,0.16)]!" onClick={() => act("seek", pos + 10_000)} aria-label="Forward 10 seconds for both">
                +10s
              </Button>
            </div>
          ) : (
            <Button className="bg-[#F3EBE1]! text-[#231C21]! hover:bg-white!" onClick={() => act("resume")} loading={busy === "resume"} disabled={!partnerHere}>
              {partnerHere ? "Resume together" : `Resume when ${pName} is back`}
            </Button>
          )}
        </div>

        <section aria-labelledby="chathead" className="flex min-h-0 flex-1 flex-col gap-2">
          <h2 id="chathead" className="m-0 font-stamp text-[10px] uppercase tracking-[0.1em] text-[#C2B5AB]">
            Just for now · not saved
          </h2>
          <ol ref={listRef} className="m-0 flex max-h-[28vh] list-none flex-col gap-1.5 overflow-y-auto p-0" aria-live="polite">
            {msgs.map((m, i) => (
              <li key={i} className={cx("max-w-[80%] rounded-2xl px-3 py-2 text-[15px] leading-[1.4]", m.from === me.user.id ? "self-end bg-[#F3EBE1] text-[#231C21]" : "self-start bg-[rgba(243,235,225,0.12)]")}>
                {m.text}
              </li>
            ))}
          </ol>
          <form onSubmit={say} className="flex gap-2">
            <label htmlFor="say" className="sr-only">
              Say something
            </label>
            <input
              id="say"
              value={text}
              maxLength={300}
              onChange={(e) => setText(e.target.value)}
              placeholder="Say something…"
              className="h-12 min-w-0 flex-1 rounded-(--radius-control) border border-[#43383F] bg-[#2F262C] px-3.5 text-[15px] text-[#F3EBE1] placeholder:text-[#7A6D73] focus:border-[#DDA09D] focus:outline-none"
            />
            <button type="submit" aria-label="Send" disabled={!text.trim()} className="flex size-12 items-center justify-center rounded-(--radius-control) bg-[rgba(243,235,225,0.1)] disabled:opacity-50">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          </form>
        </section>

        <button type="button" onClick={() => act("end")} className="min-h-11 self-center text-sm font-medium text-[#C2B5AB] underline underline-offset-[3px]">
          End session
        </button>
      </div>
    </main>
  );
}
