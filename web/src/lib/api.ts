export type Tint = "terracotta" | "sage" | "mauve";

export type User = {
  id: string;
  displayName: string;
  personTint: Tint;
  timeZone: string;
  phoneMasked?: string;
};

export type Member = { id: string; displayName: string; personTint: Tint; timeZone: string; joinedAt: string };

export type PinKind = "link" | "place" | "song" | "idea";
export type PinStatus = "saved" | "planned" | "done" | "remembered";

export type Board = {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
  pinCount: number;
  plannedCount: number;
};

export type Pin = {
  id: string;
  boardId: string;
  boardName?: string;
  createdBy: string;
  kind: PinKind;
  title: string;
  url?: string;
  note: string;
  status: PinStatus;
  createdAt: string;
};

export type PinNote = { id: string; authorId: string; body: string; createdAt: string };

export type Space = {
  id: string;
  name: string;
  status: "pending" | "active";
  activatedAt?: string;
  members: Member[];
  invite?: { state: "waiting" | "not_accepted"; inviteeName: string; expiresAt: string };
};

export type Notice =
  | {
      id: string;
      kind: "space_closed";
      createdAt: string;
      payload: { spaceName: string; leftByName: string; leftAt: string; readOnlyUntil: string };
    }
  | { id: string; kind: "partner_number_updated"; createdAt: string; payload: { name: string } };

export type Me = { user: User; space: Space | null; newSpaceAvailableAt?: string; notices: Notice[] };

export type SignInResult = {
  user: User;
  sessionStatus: "active" | "needs_second_factor";
  newUser: boolean;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public detail: { retryAfterSeconds?: number; availableAt?: string } = {},
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const hasBody = init.body !== undefined;
  const res = await fetch(`/api/v1${path}`, {
    method: init.method ?? (hasBody ? "POST" : "GET"),
    headers: hasBody ? { "Content-Type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiError(res.status, e.code ?? "unknown", e.message ?? "Something went wrong. Try again.", e);
  }
  return data as T;
}

export function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong. Check your connection and try again.";
}

/** The screen a signed-in person belongs on right now. */
export function homeFor(me: Me): string {
  if (!me.space && me.notices.some((n) => n.kind === "space_closed")) return "/closed";
  if (!me.space) return "/new";
  if (me.space.status === "pending") return "/waiting";
  return "/space";
}

export function partnerOf(me: Me): Member | undefined {
  return me.space?.members.find((m) => m.id !== me.user.id);
}

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

export function formatDayTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function markNoticeSeen(id: string) {
  return api(`/notices/${id}/seen`, { body: {} });
}

/** "2 days ago", "just now": short and calm. */
export function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function timeIn(tz: string, at = new Date()): string {
  try {
    return at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: tz });
  } catch {
    return at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
}

export function cityOf(tz: string): string {
  const last = tz.split("/").pop() ?? tz;
  return last.replace(/_/g, " ");
}
