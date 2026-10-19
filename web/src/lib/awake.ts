import { timeOnly } from "./time";

/** "7 am", "noon", "midnight". */
export function hourLabel(h: number): string {
  if (h === 0 || h === 24) return "midnight";
  if (h === 12) return "noon";
  return h < 12 ? `${h} am` : `${h - 12} pm`;
}

export function hourIn(tz: string, at: Date): number {
  try {
    return Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(at));
  } catch {
    return at.getHours();
  }
}

/** Is hour h (0–23) inside a "usually awake" span? to < from wraps past midnight. */
export function awakeAt(h: number, from: number, to: number): boolean {
  return from < to ? h >= from && h < to : h >= from || h < to;
}

/** Half-hour steps from now, so zones like India (+5:30) land on the right time. */
function* steps(now: Date): Generator<Date> {
  const t = new Date(now);
  t.setSeconds(0, 0);
  t.setMinutes(t.getMinutes() < 30 ? 30 : 60);
  for (let i = 0; i < 48; i++) {
    yield new Date(t.getTime() + i * 1_800_000);
  }
}

type Person = { timeZone: string; awakeFrom: number; awakeTo: number };

/**
 * A line for Our Space: when you're both usually awake. Only ever a suggestion
 * from the hours you each gave; never says anyone is online.
 */
export function bothAwakeLine(me: Person, them: Person, now: Date): string | null {
  const both = (t: Date) => awakeAt(hourIn(me.timeZone, t), me.awakeFrom, me.awakeTo) && awakeAt(hourIn(them.timeZone, t), them.awakeFrom, them.awakeTo);
  if (both(now)) {
    for (const t of steps(now)) {
      if (!both(t)) return `you’re both usually up until ${timeOnly(t.toISOString(), me.timeZone)}, your time`;
    }
    return "you’re both usually up around now";
  }
  for (const t of steps(now)) {
    if (both(t)) return `you’re both usually up from ${timeOnly(t.toISOString(), me.timeZone)}, your time`;
  }
  return "your awake hours don’t overlap today. a letter can wait for them";
}
