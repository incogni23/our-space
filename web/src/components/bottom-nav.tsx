"use client";

import Link from "next/link";
import { SideNav } from "./side-nav";
import { cx } from "./ui";

type Tab = "space" | "boards" | "plans" | "story" | "none";

const tabs: Array<{ id: Exclude<Tab, "none">; href: string; label: string; icon: React.ReactNode }> = [
  {
    id: "space",
    href: "/space",
    label: "Us",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <path d="M12 20.5C5 15.6 2.5 12.4 2.5 8.9 2.5 6.2 4.6 4 7.3 4c1.8 0 3.5 1 4.7 2.6C13.2 5 14.9 4 16.7 4c2.7 0 4.8 2.2 4.8 4.9 0 3.5-2.5 6.7-9.5 11.6z" />
      </svg>
    ),
  },
  {
    id: "boards",
    href: "/boards",
    label: "Boards",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true">
        <rect x="3.5" y="3.5" width="7" height="10" rx="1.5" />
        <rect x="13.5" y="3.5" width="7" height="6" rx="1.5" />
        <rect x="13.5" y="12.5" width="7" height="8" rx="1.5" />
        <rect x="3.5" y="16.5" width="7" height="4" rx="1.5" />
      </svg>
    ),
  },
  {
    id: "plans",
    href: "/plans",
    label: "Plans",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
        <path d="M3.5 10h17M8 3v4M16 3v4" />
      </svg>
    ),
  },
  {
    id: "story",
    href: "/story",
    label: "Story",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true">
        <path d="M3.5 5.5c3-1.2 6-1 8.5 1v13c-2.5-1.8-5.5-2-8.5-1z" />
        <path d="M20.5 5.5c-3-1.2-6-1-8.5 1v13c2.5-1.8 5.5-2 8.5-1z" />
      </svg>
    ),
  },
];

function TabLink({ t, current }: { t: (typeof tabs)[number]; current: Tab }) {
  const on = t.id === current;
  return (
    <Link
      href={t.href}
      aria-current={on ? "page" : undefined}
      className={cx(
        "flex h-[52px] w-14 flex-col items-center justify-center gap-0.5 text-[10px] text-nav-text no-underline",
        on ? "font-semibold [&_svg]:fill-accent [&_svg]:stroke-accent" : "font-medium opacity-[0.72]",
      )}
    >
      {t.icon}
      <span>{t.label}</span>
    </Link>
  );
}

/** Floating pill bar (v2). Pages using it need bottom padding of ~120px. */
export function BottomNav({ current, readOnly = false }: { current: Tab; readOnly?: boolean }) {
  return (
    <>
    <SideNav readOnly={readOnly} />
    <nav
      aria-label="Main"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-(--z-nav) px-3.5 pb-[max(env(safe-area-inset-bottom),22px)] lg:hidden"
    >
      <div className="pointer-events-auto mx-auto flex h-[66px] max-w-[412px] items-center justify-around rounded-[33px] bg-nav px-1.5 text-nav-text shadow-[0_16px_30px_-12px_rgba(0,0,0,0.5)]">
        <TabLink t={tabs[0]} current={current} />
        <TabLink t={tabs[1]} current={current} />
        {readOnly ? (
          <span className="size-[52px]" aria-hidden="true" />
        ) : (
          <Link href="/add" aria-label="Save something" className="flex size-[52px] items-center justify-center rounded-full bg-accent text-on-accent">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </Link>
        )}
        <TabLink t={tabs[2]} current={current} />
        <TabLink t={tabs[3]} current={current} />
      </div>
    </nav>
    </>
  );
}
