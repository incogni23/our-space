"use client";

/** v2 colour families. One per space; either partner can change it. */
export const FAMILIES = [
  { id: "cherry", name: "Cherry", line: "the classic crush", ground: "#FCE4EA", petal: "#F9C9D6", accent: "#E0244A", second: "#23476E", tape: "#FFE9A8", text: "#151112" },
  { id: "lavender", name: "Lavender", line: "soft, dreamy, late", ground: "#ECE6F7", petal: "#D9CCF2", accent: "#7C4DDB", second: "#A3264F", tape: "#FFE9A8", text: "#151112" },
  { id: "matcha", name: "Matcha", line: "sunday in the park", ground: "#E8F0DF", petal: "#CFE3BE", accent: "#288445", second: "#B5452B", tape: "#FFE9A8", text: "#151112" },
  { id: "ocean", name: "Ocean", line: "salt air, long calls", ground: "#DDEEFA", petal: "#BFD9F2", accent: "#1E6FD9", second: "#C0163A", tape: "#FFE9A8", text: "#151112" },
  { id: "peach", name: "Peach", line: "golden hour, always", ground: "#FFE8DA", petal: "#FFCBAE", accent: "#D04316", second: "#23476E", tape: "#FFF1B8", text: "#151112" },
  { id: "midnight", name: "Midnight", line: "for the 2 am talks", ground: "#1C1719", petal: "#3A2F33", accent: "#FF6FA0", second: "#9FC6FF", tape: "#5A4A50", text: "#FFF6F0" },
] as const;

export type Family = (typeof FAMILIES)[number]["id"];
export type Ink = "accent" | "second" | "ink" | "pencil";

export const INKS: Array<{ id: Ink; label: string }> = [
  { id: "accent", label: "Family colour" },
  { id: "second", label: "Second colour" },
  { id: "ink", label: "Ink" },
  { id: "pencil", label: "Pencil grey" },
];

/** CSS colour for a person's handwriting ink. */
export function inkColor(ink: string | undefined): string {
  switch (ink) {
    case "second":
      return "var(--second)";
    case "ink":
      return "var(--text)";
    case "pencil":
      return "var(--muted)";
    default:
      return "var(--accent-ink)";
  }
}

export function familyName(id: string | undefined): string {
  return FAMILIES.find((f) => f.id === id)?.name ?? "Cherry";
}

function remember(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* private mode: the palette just isn't remembered between loads */
  }
}

export function applyFamily(f: string | undefined) {
  if (typeof document === "undefined" || !f) return;
  const fam = FAMILIES.find((x) => x.id === f);
  if (!fam) return;
  document.documentElement.dataset.family = f;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", fam.ground);
  remember("bu.family", f);
}

export function applyInk(i: string | undefined) {
  if (typeof document === "undefined" || !i) return;
  document.documentElement.dataset.ink = i;
  remember("bu.ink", i);
}

/** Back to the default look (sign-out, leaving). */
export function resetTheme() {
  applyFamily("cherry");
  applyInk("accent");
}
