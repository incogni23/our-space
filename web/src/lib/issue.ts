/** "A new issue every monthsary": the space as a magazine, numbered from day one. */

const ROMAN: Array<[number, string]> = [
  [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];

export function roman(n: number): string {
  let out = "";
  for (const [v, s] of ROMAN) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return out || "I";
}

function addMonths(d: Date, m: number): Date {
  const day = d.getDate();
  const x = new Date(d.getFullYear(), d.getMonth() + m, 1, d.getHours(), d.getMinutes());
  const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
  x.setDate(Math.min(day, last));
  return x;
}

export type Issue = { vol: number; no: number; days: number; months: number; next: Date };

/** Issue numbers for a space that began at `since`. Nº 1 is the first month. */
export function issueOf(since: string | undefined, now = new Date()): Issue {
  const start = since ? new Date(since) : now;
  let months = (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth();
  if (addMonths(start, months) > now) months -= 1;
  months = Math.max(0, months);
  const days = Math.max(0, Math.floor((now.getTime() - start.getTime()) / 86_400_000));
  return { vol: Math.floor(months / 12) + 1, no: months + 1, days, months, next: addMonths(start, months + 1) };
}

/** Issue number of any day inside the space's life (for back issues). */
export function issueNoFor(since: string | undefined, day: string): number {
  return issueOf(since, new Date(day)).no;
}

/**
 * Day one of the magazine: the "where it started" memory if there is one (it can
 * predate the app), else the day the space opened.
 */
export function sinceOf(activatedAt: string | undefined, memories: Array<{ kind: string; happenedOn: string }>): string | undefined {
  const start = memories
    .filter((m) => m.kind === "start")
    .map((m) => `${m.happenedOn}T00:00:00`)
    .sort()[0];
  if (start && (!activatedAt || start < activatedAt)) return start;
  return activatedAt;
}
