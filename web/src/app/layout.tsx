import type { Metadata, Viewport } from "next";
import { DM_Mono, DM_Sans, Newsreader } from "next/font/google";
import "./globals.css";

const newsreader = Newsreader({ subsets: ["latin"], style: ["normal", "italic"], variable: "--font-newsreader" });
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans" });
const dmMono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-dm-mono" });

export const metadata: Metadata = {
  title: "Between Us",
  description: "A little world for two.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F2EA" },
    { media: "(prefers-color-scheme: dark)", color: "#231C21" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${newsreader.variable} ${dmSans.variable} ${dmMono.variable}`}>
      <body className="bg-ground text-ink antialiased">{children}</body>
    </html>
  );
}
