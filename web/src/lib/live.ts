"use client";

import { useEffect, useState } from "react";

// One EventSource per tab, shared by every component that listens.
// Events say only *what* changed; pages refetch what they show.

export type LiveEvent = { type: string; id: string; actor: string };

type Listener = (ev: LiveEvent) => void;

let source: EventSource | null = null;
const listeners = new Set<Listener>();

function open() {
  if (source && source.readyState !== EventSource.CLOSED) return;
  source = new EventSource("/api/v1/live");
  let opened = false;
  source.addEventListener("change", (e) => {
    let ev: LiveEvent;
    try {
      ev = JSON.parse((e as MessageEvent).data);
    } catch {
      return;
    }
    listeners.forEach((l) => l(ev));
  });
  // A reconnect after a gap may have missed events: tell listeners to refresh.
  source.addEventListener("open", () => {
    if (opened) listeners.forEach((l) => l({ type: "live.reconnected", id: "", actor: "" }));
    opened = true;
  });
}

function close() {
  source?.close();
  source = null;
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  open();
  return () => {
    listeners.delete(l);
    if (listeners.size === 0) close();
  };
}

/**
 * A number that goes up whenever an event whose type starts with one of
 * `prefixes` arrives (and after a reconnect). Put it in a fetch effect's deps.
 */
export function useLiveTick(prefixes: string[], enabled = true): number {
  const [tick, setTick] = useState(0);
  const key = prefixes.join("|");
  useEffect(() => {
    if (!enabled) return;
    const ps = key.split("|");
    return subscribe((ev) => {
      if (ev.type === "live.reconnected" || ps.some((p) => ev.type.startsWith(p))) setTick((t) => t + 1);
    });
  }, [key, enabled]);
  return tick;
}
