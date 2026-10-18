"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** A phone-width column, centred on larger screens. */
export function Screen({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <main className="min-h-dvh bg-ground text-ink">
      <div className={cx("mx-auto flex min-h-dvh w-full max-w-[440px] flex-col gap-6 px-5 pb-8 pt-12", className)}>
        {children}
      </div>
    </main>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx("font-display text-[22px] tracking-[-0.01em]", className)} aria-label="Between Us">
      between
      <span
        aria-hidden="true"
        className="mx-[0.14em] inline-block h-[0.6em] w-[0.16em] rounded-[2px] bg-shared align-[-0.02em]"
      />
      us
    </span>
  );
}

export function Stamp({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx("font-stamp text-[11px] uppercase tracking-[0.1em] text-muted", className)}>{children}</span>
  );
}

const backIcon = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 6l-6 6 6 6" />
  </svg>
);

export function TopBar({ back, step, right }: { back?: string | (() => void); step?: string; right?: ReactNode }) {
  const router = useRouter();
  const cls = "-ml-2.5 flex size-11 items-center justify-center rounded-(--radius-control) text-ink";
  return (
    <div className="flex min-h-11 items-center justify-between">
      {typeof back === "string" ? (
        <Link href={back} aria-label="Back" className={cls}>
          {backIcon}
        </Link>
      ) : back ? (
        <button type="button" onClick={back} aria-label="Back" className={cls}>
          {backIcon}
        </button>
      ) : (
        <button type="button" onClick={() => router.back()} aria-label="Back" className={cls}>
          {backIcon}
        </button>
      )}
      {step ? <Stamp>{step}</Stamp> : right ?? <span />}
    </div>
  );
}

export function Title({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h1 className={cx("m-0 font-display text-[34px] font-normal leading-[1.08] tracking-[-0.015em]", className)}>
      {children}
    </h1>
  );
}

export function Lead({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("m-0 text-[15px] leading-[1.55] text-muted", className)}>{children}</p>;
}

type Variant = "primary" | "secondary" | "danger" | "text";

const variants: Record<Variant, string> = {
  primary: "bg-action text-action-text hover:bg-action-hover active:bg-action-pressed",
  secondary: "border border-line bg-surface text-ink hover:bg-sunken",
  danger: "bg-danger text-inverse hover:bg-danger-hover",
  text: "min-h-11 bg-transparent text-ink underline underline-offset-[3px]",
};

const base =
  "inline-flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-(--radius-card) px-4 text-base font-medium no-underline transition-colors duration-(--dur-quick) disabled:cursor-not-allowed disabled:opacity-55";

export function Button({
  variant = "primary",
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(base, variants[variant], className)}
    >
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = "primary",
  className,
  children,
}: {
  href: string;
  variant?: Variant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={cx(base, variants[variant], className)}>
      {children}
    </Link>
  );
}

export function Field({
  id,
  label,
  hint,
  className,
  inputClassName,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  inputClassName?: string;
}) {
  return (
    <div className={cx("flex flex-col gap-2", className)}>
      <label htmlFor={id} className="text-[13px] font-medium">
        {label}
      </label>
      <input
        id={id}
        {...rest}
        className={cx(
          "h-[52px] w-full rounded-(--radius-control) border border-line-control bg-surface px-3.5 text-[17px] text-ink placeholder:text-muted focus:border-2 focus:border-ink focus:outline-none",
          inputClassName,
        )}
      />
      {hint ? <span className="text-xs leading-[1.45] text-muted">{hint}</span> : null}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("rounded-(--radius-card) border border-line bg-surface px-4 py-3.5", className)}>{children}</div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="m-0 flex items-start gap-2 text-sm leading-[1.5] text-error">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="mt-0.5 flex-none" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5v5.5M12 16.2v.3" />
      </svg>
      <span>{children}</span>
    </p>
  );
}

export function CheckItem({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-center gap-2.5">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--status-ok-ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 12.5l4.5 4.5L19 7" />
      </svg>
      {children}
    </li>
  );
}

/** The overlap motif: two frames, the shared part filled. */
export function Frames({ size = 20, filled = true, dashedSecond = false }: { size?: number; filled?: boolean; dashedSecond?: boolean }) {
  const id = `ov-${size}-${filled ? 1 : 0}-${dashedSecond ? 1 : 0}`;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="flex-none">
      <clipPath id={id}>
        <rect x="3" y="4" width="16" height="20" rx="3" />
      </clipPath>
      {filled ? <rect x="13" y="8" width="16" height="20" rx="3" fill="var(--shared-tone)" clipPath={`url(#${id})`} /> : null}
      <rect x="3" y="4" width="16" height="20" rx="3" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <rect x="13" y="8" width="16" height="20" rx="3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeDasharray={dashedSecond ? "3 3" : undefined} />
    </svg>
  );
}

const tintClasses = {
  terracotta: "bg-terracotta-wash text-terracotta-ink",
  sage: "bg-sage-wash text-sage-ink",
  mauve: "bg-mauve-wash text-mauve-ink",
} as const;

export function Avatar({
  name,
  tint,
  size = 32,
  ring = false,
}: {
  name: string;
  tint: keyof typeof tintClasses;
  size?: number;
  ring?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      className={cx(
        "flex flex-none items-center justify-center rounded-full font-semibold",
        tintClasses[tint],
        ring && "shadow-[0_0_0_2px_var(--bg-ground)]",
      )}
    >
      {(name || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

export function Loading() {
  return (
    <Screen className="items-center justify-center">
      <span className="sr-only" role="status">
        Loading
      </span>
      <Frames size={40} />
    </Screen>
  );
}
