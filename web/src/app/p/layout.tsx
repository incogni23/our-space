import type { Metadata } from "next";

// Preview links (F4) are unlisted: never indexed, never followed.
export const metadata: Metadata = {
  title: "Shared from Between Us",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
};

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return children;
}
