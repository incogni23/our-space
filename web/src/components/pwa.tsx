"use client";

import { useEffect, useState } from "react";
import { flush, useOutbox } from "@/lib/outbox";

/** Registers the service worker and keeps the outbox moving. Mounted once in the root layout. */
export function Pwa() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    }
    void flush();
    const online = () => void flush();
    window.addEventListener("online", online);
    const t = setInterval(() => void flush(), 30_000);
    return () => {
      window.removeEventListener("online", online);
      clearInterval(t);
    };
  }, []);
  return <OfflineBanner />;
}

// 5.2 · Offline: "You can still read and write. Things you save will send when you're back."
function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  const waiting = useOutbox();
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  if (!offline && waiting.length === 0) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-0 z-(--z-toast) flex justify-center px-3 pt-[max(env(safe-area-inset-top),8px)]">
      <div className="flex max-w-[440px] items-start gap-2.5 rounded-(--radius-card) bg-action px-3.5 py-2.5 text-[13px] leading-[1.45] text-action-text shadow-(--shadow-lift)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="mt-0.5 flex-none" aria-hidden="true">
          <path d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5-2.6M14 10.4A10 10 0 0 1 19 13M12 20h.01" />
        </svg>
        <span>
          {offline ? (
            <>
              <strong className="font-semibold">You’re offline.</strong> You can still read, and things you save will send when you’re back.
            </>
          ) : (
            <strong className="font-semibold">Sending…</strong>
          )}
          {waiting.length ? ` ${waiting.length} waiting to send.` : ""}
        </span>
      </div>
    </div>
  );
}
