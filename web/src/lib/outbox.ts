"use client";

// Offline outbox (canvas 5.2): things saved without a connection wait here and
// send when you're back. Each carries an Idempotency-Key so a retry after a
// dropped connection never creates a duplicate. Nothing is shown as sent until
// the server says so.

import { useEffect, useState } from "react";
import { ApiError, api } from "./api";

const KEY = "bu_outbox";

export type Pending = { id: string; path: string; body: unknown; label: string; createdAt: string };

type Listener = () => void;
const listeners = new Set<Listener>();
let flushing = false;

function read(): Pending[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]") as Pending[];
  } catch {
    return [];
  }
}

function write(list: Pending[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {}
  listeners.forEach((l) => l());
}

function uuid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isNetworkError(err: unknown): boolean {
  return !(err instanceof ApiError) || err.status === 0 || err.status >= 502;
}

/**
 * Sends now if possible; if there's no connection, queues it and returns null.
 * Server errors (bad input etc.) are thrown as usual.
 */
export async function sendOrQueue<T>(path: string, body: unknown, label: string): Promise<T | null> {
  const id = uuid();
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    write([...read(), { id, path, body, label, createdAt: new Date().toISOString() }]);
    return null;
  }
  try {
    return await api<T>(path, { body, idempotencyKey: id });
  } catch (err) {
    if (isNetworkError(err)) {
      write([...read(), { id, path, body, label, createdAt: new Date().toISOString() }]);
      return null;
    }
    throw err;
  }
}

/** Tries to send everything waiting; keeps what still can't go. */
export async function flush(): Promise<void> {
  if (flushing || (typeof navigator !== "undefined" && !navigator.onLine)) return;
  flushing = true;
  try {
    for (const p of read()) {
      try {
        await api(p.path, { body: p.body, idempotencyKey: p.id });
        write(read().filter((x) => x.id !== p.id));
      } catch (err) {
        if (isNetworkError(err)) break; // still offline: try again later
        write(read().filter((x) => x.id !== p.id)); // rejected for good (e.g. space closed)
      }
    }
  } finally {
    flushing = false;
  }
}

export function useOutbox(): Pending[] {
  const [list, setList] = useState<Pending[]>([]);
  useEffect(() => {
    const update = () => setList(read());
    update();
    listeners.add(update);
    window.addEventListener("storage", update);
    return () => {
      listeners.delete(update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return list;
}

export function clearOutbox() {
  write([]);
}
