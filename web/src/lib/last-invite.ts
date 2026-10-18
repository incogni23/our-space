// The invite link is only returned once by the API. Keep it for this tab so the
// waiting screen can offer "Copy link" again. Never persisted beyond the session.
const KEY = "bu_last_invite";

export type LastInvite = { url: string; expiresAt: string; inviteeName: string };

export function saveLastInvite(v: LastInvite) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(v));
  } catch {}
}

export function readLastInvite(): LastInvite | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LastInvite) : null;
  } catch {
    return null;
  }
}
