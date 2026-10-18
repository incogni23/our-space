"use client";

import Link from "next/link";
import { cx } from "./ui";

type Tab = "space" | "boards" | "plans" | "story" | "none";

const tabs: Array<{ id: Exclude<Tab, "none">; href: string; label: string; icon: React.ReactNode }> = [
  {
    id: "space",
    href: "/space",
    label: "Space",
    icon: (
      <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden="true">
        <rect x="3" y="4" width="16" height="20" rx="3" fill="none" stroke="currentColor" strokeWidth="2.4" />
        <rect x="13" y="8" width="16" height="20" rx="3" fill="none" stroke="currentColor" strokeWidth="2.4" />
      </svg>
    ),
  },
  {
    id: "boards",
    href: "/boards",
    label: "Boards",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true">
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
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true">
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
        "flex h-14 w-16 flex-col items-center justify-center gap-[3px] text-[11px] no-underline",
        on ? "font-semibold text-ink" : "font-medium text-muted",
      )}
    >
      {t.icon}
      <span>{t.label}</span>
      {on ? <span className="h-[3px] w-3.5 rounded-[2px] bg-shared" /> : null}
    </Link>
  );
}

/** Fixed bottom bar (4.4). Pages using it need bottom padding of ~120px. */
export function BottomNav({ current, readOnly = false }: { current: Tab; readOnly?: boolean }) {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-(--z-nav) border-t border-line bg-surface pb-[max(env(safe-area-inset-bottom),12px)] pt-1.5"
    >
      <div className="mx-auto flex max-w-[440px] items-center justify-around px-2.5">
        <TabLink t={tabs[0]} current={current} />
        <TabLink t={tabs[1]} current={current} />
        {readOnly ? (
          <span className="size-[52px]" aria-hidden="true" />
        ) : (
        <Link
          href="/add"
          aria-label="Save something"
          className="flex size-[52px] items-center justify-center rounded-2xl bg-action shadow-[0_8px_18px_-10px_rgba(68,53,62,0.7)]"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--action-primary-text)" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </Link>
        )}
        <TabLink t={tabs[2]} current={current} />
        <TabLink t={tabs[3]} current={current} />
      </div>
    </nav>
  );
}
