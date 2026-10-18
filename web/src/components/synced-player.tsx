"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "./ui";

/*
 * Together: play the thing *inside* Between Us, locked to the session's shared
 * clock, so both of you hear the same second. Works for YouTube (and YouTube
 * Music), Spotify tracks and episodes, and direct audio/video files. Anything
 * else (Netflix, apps) falls back to the shared 3-2-1.
 */

export type Media =
  | { type: "youtube"; id: string }
  | { type: "spotify"; uri: string; kind: "track" | "episode" }
  | { type: "file"; src: string; video: boolean };

export function mediaOf(raw: string | undefined): Media | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  const ytId = /^[\w-]{11}$/;
  if (host === "youtu.be") {
    const id = u.pathname.slice(1, 12);
    return ytId.test(id) ? { type: "youtube", id } : null;
  }
  if (host === "youtube.com" || host === "music.youtube.com" || host === "youtube-nocookie.com") {
    const v = u.searchParams.get("v");
    if (v && ytId.test(v)) return { type: "youtube", id: v };
    const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/);
    return m ? { type: "youtube", id: m[1] } : null;
  }
  if (host === "open.spotify.com") {
    const m = u.pathname.match(/^\/(?:intl-[a-z-]+\/)?(?:embed\/)?(track|episode)\/([A-Za-z0-9]{22})/);
    return m ? { type: "spotify", uri: `spotify:${m[1]}:${m[2]}`, kind: m[1] as "track" | "episode" } : null;
  }
  const ext = u.pathname.toLowerCase().match(/\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|mp4|m4v|webm|mov)$/)?.[1];
  if (ext && (u.protocol === "https:" || u.hostname === "localhost")) {
    return { type: "file", src: u.toString(), video: ["mp4", "m4v", "webm", "mov"].includes(ext) };
  }
  return null;
}

export function mediaLabel(m: Media): string {
  return m.type === "youtube" ? "YouTube" : m.type === "spotify" ? "Spotify" : m.video ? "Video" : "Audio";
}

/** What every player can do, in milliseconds. */
interface Adapter {
  play(): void;
  pause(): void;
  seek(ms: number): void;
  timeMs(): number;
  playing(): boolean;
  buffering(): boolean;
  destroy(): void;
}

// ---- script loaders (once per tab) ----

type YTPlayer = {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(s: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  destroy(): void;
};
type YTNamespace = { Player: new (el: HTMLElement, opts: object) => YTPlayer };
type SpotifyController = {
  play(): void;
  pause(): void;
  resume(): void;
  seek(s: number): void;
  destroy(): void;
  addListener(ev: string, cb: (e: { data: { position: number; isPaused: boolean; isBuffering: boolean } }) => void): void;
};
type SpotifyAPI = { createController(el: HTMLElement, opts: object, cb: (c: SpotifyController) => void): void };

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
    onSpotifyIframeApiReady?: (api: SpotifyAPI) => void;
  }
}

let ytReady: Promise<YTNamespace> | null = null;
function loadYouTube(): Promise<YTNamespace> {
  ytReady ??= new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    window.onYouTubeIframeAPIReady = () => resolve(window.YT!);
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => {
      ytReady = null;
      reject(new Error("youtube"));
    };
    document.head.appendChild(s);
  });
  return ytReady;
}

let spReady: Promise<SpotifyAPI> | null = null;
function loadSpotify(): Promise<SpotifyAPI> {
  spReady ??= new Promise((resolve, reject) => {
    window.onSpotifyIframeApiReady = (api) => resolve(api);
    const s = document.createElement("script");
    s.src = "https://open.spotify.com/embed/iframe-api/v1";
    s.onerror = () => {
      spReady = null;
      reject(new Error("spotify"));
    };
    document.head.appendChild(s);
  });
  return spReady;
}

// ---- adapters ----

async function youtubeAdapter(el: HTMLElement, id: string, onUserPause: () => void): Promise<Adapter> {
  const YT = await loadYouTube();
  let commanded = 0; // when we last told it to play/pause, to tell our pauses from theirs
  let wantPlaying = false;
  return new Promise((resolve) => {
    const p: YTPlayer = new YT.Player(el, {
      host: "https://www.youtube-nocookie.com",
      videoId: id,
      width: "100%",
      height: "100%",
      playerVars: { controls: 0, disablekb: 1, playsinline: 1, rel: 0, modestbranding: 1, fs: 0, iv_load_policy: 3 },
      events: {
        onReady: () =>
          resolve({
            play() {
              wantPlaying = true;
              commanded = Date.now();
              p.playVideo();
            },
            pause() {
              wantPlaying = false;
              commanded = Date.now();
              p.pauseVideo();
            },
            seek: (ms) => p.seekTo(ms / 1000, true),
            timeMs: () => p.getCurrentTime() * 1000,
            playing: () => p.getPlayerState() === 1,
            buffering: () => p.getPlayerState() === 3,
            destroy: () => p.destroy(),
          }),
        onStateChange: (e: { data: number }) => {
          if (e.data === 2 && wantPlaying && Date.now() - commanded > 800) onUserPause();
        },
      },
    });
  });
}

async function spotifyAdapter(el: HTMLElement, uri: string, onUserPause: () => void): Promise<Adapter> {
  const api = await loadSpotify();
  let pos = 0;
  let at = Date.now();
  let paused = true;
  let buffering = false;
  let started = false;
  let commanded = 0;
  let wantPlaying = false;
  return new Promise((resolve) => {
    api.createController(el, { uri, width: "100%", height: 152 }, (c) => {
      c.addListener("playback_update", (e) => {
        const wasPaused = paused;
        pos = e.data.position;
        at = Date.now();
        paused = e.data.isPaused;
        buffering = e.data.isBuffering;
        if (!paused) started = true; // only real playback counts: resume() can't start a track
        if (!wasPaused && paused && wantPlaying && Date.now() - commanded > 800) onUserPause();
      });
      resolve({
          play() {
            wantPlaying = true;
            commanded = Date.now();
            if (started) c.resume();
            else c.play();
          },
          pause() {
            wantPlaying = false;
            commanded = Date.now();
            if (started) c.pause();
          },
          seek: (ms) => c.seek(ms / 1000),
          timeMs: () => (paused ? pos : pos + (Date.now() - at)),
          playing: () => !paused,
          buffering: () => buffering,
          destroy: () => c.destroy(),
      });
    });
  });
}

function fileAdapter(el: HTMLMediaElement, onUserPause: () => void): Adapter {
  let commanded = 0;
  let wantPlaying = false;
  el.addEventListener("pause", () => {
    if (wantPlaying && !el.ended && Date.now() - commanded > 800) onUserPause();
  });
  return {
    play() {
      wantPlaying = true;
      commanded = Date.now();
      void el.play().catch(() => {});
    },
    pause() {
      wantPlaying = false;
      commanded = Date.now();
      el.pause();
    },
    seek: (ms) => {
      el.currentTime = ms / 1000;
    },
    timeMs: () => el.currentTime * 1000,
    playing: () => !el.paused && !el.ended,
    buffering: () => el.readyState < 3 && !el.paused,
    destroy: () => el.pause(),
  };
}

// ---- the synced player ----

const DRIFT_MS = 700; // further apart than this and we re-seek

export function SyncedPlayer({
  media,
  status,
  positionMs,
  startAt,
  offset,
  onUserPause,
}: {
  media: Media;
  status: "waiting" | "playing" | "paused" | "ended";
  positionMs: number;
  /** Server time (ms) the position applies from; in the future during the 3-2-1. */
  startAt: number;
  /** Server clock minus ours. */
  offset: number;
  /** They paused it in the player itself: pause for both at this position. */
  onUserPause: (ms: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLMediaElement | null>(null);
  const adapter = useRef<Adapter | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [needsTap, setNeedsTap] = useState(true);
  const playAsked = useRef(0);
  const stateRef = useRef({ status, positionMs, startAt, offset });
  stateRef.current = { status, positionMs, startAt, offset };
  const pauseCb = useRef(onUserPause);
  pauseCb.current = onUserPause;

  // Build the player for this media.
  const key = media.type === "youtube" ? media.id : media.type === "spotify" ? media.uri : media.src;
  useEffect(() => {
    let cancelled = false;
    const userPause = () => pauseCb.current(adapter.current?.timeMs() ?? 0);
    setReady(false);
    setFailed(false);
    const build = async (): Promise<Adapter | null> => {
      if (media.type === "file") return fileRef.current ? fileAdapter(fileRef.current, userPause) : null;
      const slot = document.createElement("div");
      slot.className = "size-full";
      hostRef.current?.replaceChildren(slot);
      return media.type === "youtube" ? youtubeAdapter(slot, media.id, userPause) : spotifyAdapter(slot, media.uri, userPause);
    };
    build()
      .then((a) => {
        if (cancelled) return a?.destroy();
        adapter.current = a;
        setReady(!!a);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      adapter.current?.destroy();
      adapter.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild only when the media changes
  }, [key]);

  // Keep it on the shared clock.
  useEffect(() => {
    if (!ready) return;
    const sync = () => {
      const a = adapter.current;
      if (!a) return;
      const { status, positionMs, startAt, offset } = stateRef.current;
      const now = Date.now() + offset;
      const t = a.timeMs();
      boxRef.current?.setAttribute("data-position", String(Math.round(t))); // where this device actually is
      if (status === "playing" && now >= startAt) {
        const want = positionMs + (now - startAt);
        if (!a.playing()) {
          if (Math.abs(t - want) > 250) a.seek(want);
          a.play();
          if (!playAsked.current) playAsked.current = Date.now();
          // Browsers block sound until someone taps; if it didn't start, ask.
          if (Date.now() - playAsked.current > 1200 && !a.buffering()) setNeedsTap(true);
        } else {
          playAsked.current = 0;
          setNeedsTap(false);
          if (Math.abs(t - want) > DRIFT_MS) a.seek(want);
        }
      } else {
        playAsked.current = 0;
        if (a.playing()) {
          a.pause();
          if (media.type === "spotify") setNeedsTap(false); // they pressed ▶ on Spotify: sound is unlocked
        }
        if (Math.abs(t - positionMs) > DRIFT_MS) a.seek(positionMs);
      }
    };
    sync();
    const iv = setInterval(sync, 500);
    // Land the start of a 3-2-1 exactly, not on the next tick.
    const until = startAt - (Date.now() + offset);
    const to = status === "playing" && until > 0 ? setTimeout(sync, until) : undefined;
    return () => {
      clearInterval(iv);
      if (to) clearTimeout(to);
    };
  }, [ready, status, positionMs, startAt, offset, media.type]);

  // One tap unlocks sound on this device (autoplay rules), then the clock drives it.
  function tuneIn() {
    const a = adapter.current;
    setNeedsTap(false);
    playAsked.current = 0;
    if (!a) return;
    const { status, startAt, offset } = stateRef.current;
    a.play();
    if (!(status === "playing" && Date.now() + offset >= startAt)) setTimeout(() => adapter.current?.pause(), 120);
  }

  if (failed) {
    return (
      <p className="m-0 rounded-2xl bg-[rgba(243,235,225,0.08)] px-4 py-3 text-sm text-[#E6B79F]">
        {mediaLabel(media)} wouldn’t load here. You can still open it in its own app and press play on the 3-2-1.
      </p>
    );
  }

  return (
    <div ref={boxRef} className={cx("relative overflow-hidden rounded-2xl bg-black", media.type === "file" && !media.video && "min-h-24")}>
      {media.type === "file" ? (
        media.video ? (
          <video ref={(el) => void (fileRef.current = el)} src={media.src} playsInline preload="auto" className="block aspect-video w-full" />
        ) : (
          <>
            <audio ref={(el) => void (fileRef.current = el)} src={media.src} preload="auto" className="hidden" />
            <div className="flex h-24 items-center gap-3 px-4 text-[#FFF6F0]" aria-hidden="true">
              <span className="size-16 flex-none rounded-full bg-[repeating-radial-gradient(circle,#151112_0_2px,#2A2426_2px_4px)] shadow-[0_0_0_1px_rgba(255,255,255,0.08)]" />
              <span className="truncate font-type text-xs uppercase tracking-[0.14em] text-[#C9BDBF]">{decodeURIComponent(media.src.split("/").pop() ?? "")}</span>
            </div>
          </>
        )
      ) : (
        <div ref={hostRef} className={cx("w-full [&_iframe]:block", media.type === "youtube" ? "aspect-video" : "h-[152px]")} />
      )}
      {media.type === "youtube" ? <div className="absolute inset-0" aria-hidden="true" /> /* taps go to our controls, not YouTube's */ : null}
      {ready && needsTap && media.type === "spotify" ? (
        // Spotify only plays after a tap inside its own player, so point at its ▶ instead of covering it.
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 bg-[rgba(28,23,25,0.85)] px-3 py-2 text-[13px] text-[#FFF6F0]" role="status">
          <span aria-hidden="true">↘</span>
          {status === "playing" ? "Tap ▶ on the player to join in. You’ll land on the same second." : "Tap ▶ on the player once to tune in."}
        </div>
      ) : null}
      {ready && needsTap && media.type !== "spotify" ? (
        <button
          type="button"
          onClick={tuneIn}
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-[rgba(28,23,25,0.78)] text-[#FFF6F0]"
        >
          <span className="font-display text-2xl font-bold italic">{status === "playing" ? "Tap to join in" : "Tap to tune in"}</span>
          <span className="text-xs text-[#C9BDBF]">
            {status === "playing" ? "It’s playing for both of you. You’ll land on the same second." : "So your browser lets it play with sound."}
          </span>
        </button>
      ) : null}
      {!ready ? <div className="absolute inset-0 flex items-center justify-center text-sm text-[#C9BDBF]">Loading {mediaLabel(media)}…</div> : null}
    </div>
  );
}
