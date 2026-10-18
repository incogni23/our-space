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
  previewStatus: "none" | "pending" | "done" | "failed";
  previewSite?: string;
  previewDescription?: string;
  previewMediaId?: string;
};

export type PlanStatus = "proposed" | "confirmed" | "declined" | "cancelled";

export type Plan = {
  id: string;
  createdBy: string;
  pinId?: string;
  kind: "plan" | "call";
  title: string;
  place: string;
  notes: string;
  startsAt: string;
  anchorTz: string;
  repeat: "none" | "weekly";
  status: PlanStatus;
  suggestedStartsAt?: string;
  suggestedBy?: string;
  respondedBy?: string;
  createdAt: string;
  occurrences?: string[];
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

export type ReadOnlySpace = { id: string; name: string; until: string; members: Member[] };

export type Me = {
  user: User;
  space: Space | null;
  newSpaceAvailableAt?: string;
  notices: Notice[];
  /** A closed space still inside its read-only window. */
  readOnlySpace?: ReadOnlySpace;
};

export const EXPORT_URL = "/api/v1/export";

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

export type Photo = { id: string; width: number; height: number; takenAt?: string; uploadedBy?: string };

export type MemoryKind = "moment" | "trip" | "change" | "start";

export type Memory = {
  id: string;
  createdBy: string;
  kind: MemoryKind;
  title: string;
  caption: string;
  place: string;
  happenedOn: string;
  endsOn?: string;
  photoCount: number;
  coverId?: string;
  photos?: Photo[];
  createdAt: string;
};

export const photoUrl = (id: string, variant: "thumb" | "full" = "thumb") => `/api/v1/media/${id}/${variant}`;

const KEEP_ORIGINAL_BYTES = 8 * 1024 * 1024;

/** Shrinks big photos on the device (the server still strips metadata from everything). */
async function prepare(file: File): Promise<Blob> {
  if (file.size <= KEEP_ORIGINAL_BYTES || typeof createImageBitmap === "undefined") return file;
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, 2560 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", 0.9));
}

export async function uploadPhoto(file: File): Promise<Photo> {
  const body = new FormData();
  body.append("file", await prepare(file), file.name || "photo.jpg");
  const res = await fetch("/api/v1/media", { method: "POST", body, headers: { "X-BU-Upload": "1" }, credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiError(res.status, e.code ?? "unknown", e.message ?? "That photo didn’t upload. Try again.");
  }
  return data.photo as Photo;
}
