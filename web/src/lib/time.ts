// Time across two clocks (canvas 5.4): render each viewer's local time, add the
// other person's, and label the date when it differs. Never show offsets.

export function fmt(at: Date | string, tz: string, opts: Intl.DateTimeFormatOptions): string {
  const d = typeof at === "string" ? new Date(at) : at;
  try {
    return d.toLocaleString(undefined, { ...opts, timeZone: tz });
  } catch {
    return d.toLocaleString(undefined, opts);
  }
}

export const timeOnly = (at: Date | string, tz: string) => fmt(at, tz, { hour: "numeric", minute: "2-digit" });
export const dayShort = (at: Date | string, tz: string) => fmt(at, tz, { weekday: "short", day: "numeric", month: "short" });
export const dayLong = (at: Date | string, tz: string) => fmt(at, tz, { weekday: "long", day: "numeric", month: "long" });

/** YYYY-MM-DD of an instant in a zone. */
export function dayKey(at: Date | string, tz: string): string {
  const d = typeof at === "string" ? new Date(at) : at;
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: tz }).format(d);
  return parts; // en-CA formats as YYYY-MM-DD
}

/** The other person's view of an instant, with a day label only when the day differs. */
export function theirTime(at: Date | string, myTz: string, theirTz: string): { text: string; sameDay: boolean; sameZoneTime: boolean } {
  const sameDay = dayKey(at, myTz) === dayKey(at, theirTz);
  const t = timeOnly(at, theirTz);
  const sameZoneTime = sameDay && t === timeOnly(at, myTz);
  return { text: sameDay ? t : `${t} ${dayShort(at, theirTz)}`, sameDay, sameZoneTime };
}

/** Whole days from today to the instant's day, in the viewer's zone. */
export function daysUntil(at: Date | string, tz: string): number {
  const a = new Date(`${dayKey(new Date(), tz)}T00:00:00Z`).getTime();
  const b = new Date(`${dayKey(at, tz)}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function relDay(n: number): string {
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n < 0) return "Earlier";
  return `In ${n} days`;
}

/** "2026-11-28" and "08:00" for <input type=date/time>, from an instant in a zone. */
export function toInputs(at: Date | string, tz: string): { date: string; time: string } {
  const d = typeof at === "string" ? new Date(at) : at;
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).format(d);
  return { date: dayKey(d, tz), time };
}

/**
 * The instant for wall-clock date+time in a zone (client preview only; the server
 * does the authoritative conversion).
 */
export function instantFor(date: string, time: string, tz: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const guess = new Date(`${date}T${time}:00Z`);
  for (let i = 0; i < 3; i++) {
    const shown = toInputs(guess, tz);
    const diff = new Date(`${date}T${time}:00Z`).getTime() - new Date(`${shown.date}T${shown.time}:00Z`).getTime();
    if (diff === 0) break;
    guess.setTime(guess.getTime() + diff);
  }
  return guess;
}

function icsStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** A one-event .ics for "Add to my phone's calendar". Weekly plans repeat in their anchor zone. */
export function icsFor(p: { id: string; title: string; place: string; notes: string; startsAt: string; anchorTz: string; repeat: string; kind: string }): string {
  const start = new Date(p.startsAt);
  const local = toInputs(start, p.anchorTz);
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  const durationMin = p.kind === "call" ? 60 : 90;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Between Us//Plans//EN",
    "BEGIN:VEVENT",
    `UID:${p.id}@betweenus`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART;TZID=${p.anchorTz}:${local.date.replace(/-/g, "")}T${local.time.replace(":", "")}00`,
    `DURATION:PT${durationMin}M`,
    `SUMMARY:${esc(p.title)}`,
    p.place ? `LOCATION:${esc(p.place)}` : "",
    p.notes ? `DESCRIPTION:${esc(p.notes)}` : "",
    p.repeat === "weekly" ? "RRULE:FREQ=WEEKLY" : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return lines.join("\r\n");
}
