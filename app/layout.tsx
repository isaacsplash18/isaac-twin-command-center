import type { Metadata, Viewport } from "next";
import { Inter, Newsreader } from "next/font/google";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

// Legibility pass: Inter replaces Schibsted Grotesk and Geist Mono replaces
// IBM Plex Mono — both are drawn with a taller x-height and open apertures for
// small on-screen sizes, which is where this UI lives (mono carries ~90% of the
// chrome). Newsreader is untouched: it's the reading face for draft bodies.
// Only the weights actually used are loaded (400 body, 600 for font-semibold).
const inter = Inter({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-inter" });
const newsreader = Newsreader({ subsets: ["latin"], variable: "--font-newsreader", style: ["normal", "italic"] });

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
    <html lang="en-GB" className={`${inter.variable} ${newsreader.variable} ${GeistMono.variable}`}>
      {/* overflow-x-hidden guards against the Nova full-bleed trick
          (w-screen + -translate-x-1/2 in CommandCenter) tripping a 1px
          horizontal scrollbar on desktop browsers where 100vw includes the
          scrollbar gutter. */}
      <body className="bg-ground text-ink font-sans antialiased min-h-screen overflow-x-hidden titanium">
        {children}
      </body>
    </html>
  );
}
