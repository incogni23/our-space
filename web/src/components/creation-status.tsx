"use client";

import type { CreationStatus } from "@/lib/api";
import { cx } from "./ui";

export function statusLabel(s: CreationStatus, partnerName: string, mine: boolean): string {
  switch (s) {
    case "draft":
      return "Draft";
    case "private":
      return "Kept between you";
    case "solo":
      return mine ? "Just for you" : "Just for them";
    case "awaiting":
      return mine ? `Waiting for ${partnerName}` : "Your answer";
    case "change_requested":
      return mine ? `${partnerName} suggested a change` : "You suggested a change";
    case "declined":
      return "Staying between you";
    case "approved":
      return "Approved by both";
  }
}

export function StatusChip({ status, partnerName, mine }: { status: CreationStatus; partnerName: string; mine: boolean }) {
  const tone =
    status === "approved"
      ? "bg-ok-wash text-ok-ink"
      : status === "declined" || status === "private"
        ? "bg-shared-wash text-shared-ink"
        : status === "awaiting" && !mine
          ? "bg-shared-wash text-shared-ink"
          : status === "change_requested"
            ? "bg-time-wash text-time-ink"
            : "bg-sunken text-ink";
  return <span className={cx("inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[13px] font-semibold", tone)}>{statusLabel(status, partnerName, mine)}</span>;
}
