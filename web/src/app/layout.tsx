import type { Metadata, Viewport } from "next";
import { Bodoni_Moda, Caveat, Courier_Prime, DM_Sans } from "next/font/google";
import { Pwa } from "@/components/pwa";
import "./globals.css";

const bodoni = Bodoni_Moda({ subsets: ["latin"], style: ["normal", "italic"], axes: ["opsz"], variable: "--font-bodoni" });
const caveat = Caveat({ subsets: ["latin"], variable: "--font-caveat" });
const courier = Courier_Prime({ subsets: ["latin"], weight: ["400", "700"], style: ["normal", "italic"], variable: "--font-courier" });
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans" });

export const metadata: Metadata = {
  title: "Between Us",
  description: "A little world for two.",
  applicationName: "Between Us",
  appleWebApp: { capable: true, title: "Between Us", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#FCE4EA",
};

// Paint the space's colour family before first render (remembered from the last
// /me), so a lavender space never flashes cherry.
const boot = `try{var f=localStorage.getItem("bu.family");if(f)document.documentElement.dataset.family=f;var i=localStorage.getItem("bu.ink");if(i)document.documentElement.dataset.ink=i}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      data-family="cherry"
      data-ink="accent"
      suppressHydrationWarning
      className={`${bodoni.variable} ${caveat.variable} ${courier.variable} ${dmSans.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: boot }} />
      </head>
      <body className="bg-ground text-ink antialiased">
        {children}
        <Pwa />
      </body>
    </html>
  );
}
