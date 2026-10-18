"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { partnerOf } from "@/lib/api";
import { FAMILIES, familyName, inkColor } from "@/lib/theme";
import { useCachedMe } from "@/lib/use-me";
import { usePalette } from "./palette-picker";
import { HEART, cx } from "./ui";

const links: Array<{ href: string; label: string; match: string[] }> = [
  { href: "/space", label: "Our Space", match: ["/space"] },
  { href: "/boards", label: "Boards", match: ["/boards", "/pins", "/add"] },
  { href: "/plans", label: "Plans", match: ["/plans"] },
  { href: "/story", label: "Our Story", match: ["/story"] },
  { href: "/notes", label: "Little Things", match: ["/notes"] },
  { href: "/together", label: "Together", match: ["/together"] },
  { href: "/made", label: "Made by Us", match: ["/made"] },
];

/**
 * Desktop chrome (v2 Space-Desktop): the space's name, the two of you, every
 * section and the colours. Shown from 1024px; phones keep the pill bar.
 */
export function SideNav({ readOnly = false }: { readOnly?: boolean }) {
  const path = usePathname();
  const me = useCachedMe();
  const palette = usePalette(me?.space?.palette);
  const space = me?.space;
  const name = space?.name ?? me?.readOnlySpace?.name ?? "";
  const partner = me ? (space ? partnerOf(me) : me.readOnlySpace?.members.find((m) => m.id !== me.user.id)) : undefined;
  const people = me ? [{ p: me.user, ink: me.user.ink }, ...(partner ? [{ p: partner, ink: partner.ink ?? "second" }] : [])] : [];

  return (
    <aside className="bu-side fixed inset-y-0 left-0 z-(--z-nav) hidden w-[264px] flex-col gap-[26px] overflow-y-auto border-r border-ink bg-ground px-[22px] py-[30px] lg:flex">
      <div className="flex flex-col gap-2.5">
        <span className="font-display text-[34px] font-black italic leading-[0.9] tracking-[-0.02em]">{name}</span>
        <span className="flex items-center gap-2.5">
          <span className="flex">
            {people.map(({ p, ink }, i) => (
              <span
                key={p.id}
                className={cx("flex size-[30px] items-center justify-center rounded-full font-display text-[15px] font-bold italic text-[#FFFDF9] shadow-[0_0_0_2px_var(--ground)]", i > 0 && "-ml-[7px]")}
                style={{ background: inkColor(ink) }}
                aria-hidden="true"
              >
                {(p.displayName || "?").slice(0, 1).toUpperCase()}
              </span>
            ))}
          </span>
          <span className="font-type text-[10.5px] tracking-[0.14em] text-muted">{readOnly ? "CLOSED · READ ONLY" : "ONLY YOU TWO"}</span>
        </span>
      </div>

      <nav aria-label="Main" className="flex flex-col gap-0.5">
        {links.map((l) => {
          const on = l.match.some((m) => path === m || path.startsWith(`${m}/`));
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={on ? "page" : undefined}
              className={cx("flex min-h-11 items-center gap-3 rounded-[22px] px-3.5 text-[15px] no-underline", on ? "bg-ink font-semibold text-ground" : "text-ink hover:bg-paper")}
            >
              {l.href === "/space" ? (
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                  <path d={HEART} fill="var(--accent)" />
                </svg>
              ) : null}
              {l.label}
            </Link>
          );
        })}
      </nav>

      {!readOnly ? (
        <Link href="/add" className="flex min-h-12 items-center justify-center gap-2 rounded-3xl bg-accent text-[15px] font-medium text-on-accent no-underline">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Save something
        </Link>
      ) : null}

      {space?.status === "active" ? (
        <section aria-labelledby="ourcol" className="flex flex-col gap-2.5 rounded-[18px] bg-paper p-3.5 shadow-[0_12px_24px_-16px_rgba(0,0,0,0.4)]">
          <div className="flex items-baseline justify-between">
            <h2 id="ourcol" className="m-0 font-display text-[19px] font-bold italic">
              Our colours
            </h2>
            <Link href="/colours" className="text-xs text-accent-ink">
              More
            </Link>
          </div>
          <div role="radiogroup" aria-label="Colour family" className="grid grid-cols-3 gap-2">
            {FAMILIES.map((f) => {
              const on = f.id === space.palette;
              return (
                <button
                  key={f.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={f.name}
                  title={f.name}
                  onClick={() => void palette.pick(f.id)}
                  className="flex h-12 cursor-pointer items-center justify-center gap-[3px] rounded-xl"
                  style={{ background: f.ground, border: on ? `2.5px solid ${f.text}` : "1px solid rgba(0,0,0,0.12)" }}
                >
                  <span className="size-[11px] rounded-full" style={{ background: f.accent }} />
                  <span className="size-[11px] rounded-full" style={{ background: f.second }} />
                </button>
              );
            })}
          </div>
          <span className="font-hand text-xl leading-[1.05] text-accent-ink">
            {palette.error ?? `${familyName(space.palette)} · ${partner?.displayName || "they"} sees it too ♡`}
          </span>
        </section>
      ) : null}

      <div className="mt-auto flex items-center justify-between">
        <span className="font-type text-[10.5px] tracking-[0.14em] text-muted">BETWEEN US</span>
        <Link href="/settings" className="flex min-h-11 items-center text-[13px] text-ink">
          Settings
        </Link>
      </div>
    </aside>
  );
}
