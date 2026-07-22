import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Newsreader, Schibsted_Grotesk } from "next/font/google";
import "./globals.css";

const grotesk = Schibsted_Grotesk({ subsets: ["latin"], variable: "--font-grotesk" });
const newsreader = Newsreader({ subsets: ["latin"], variable: "--font-newsreader", style: ["normal", "italic"] });
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "Isaac Twin — Command Center",
  description: "Approval and publishing surface for Isaac's content twin.",
  robots: { index: false, follow: false },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Nova",
  },
};

export const viewport: Viewport = {
  themeColor: "#f2f2ef",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${grotesk.variable} ${newsreader.variable} ${plexMono.variable}`}>
      {/* overflow-x-hidden guards against the Nova full-bleed trick
          (w-screen + -translate-x-1/2 in CommandCenter) tripping a 1px
          horizontal scrollbar on desktop browsers where 100vw includes the
          scrollbar gutter. */}
      <body className="bg-ground text-ink font-sans antialiased min-h-screen overflow-x-hidden scanlines">
        {children}
      </body>
    </html>
  );
}
