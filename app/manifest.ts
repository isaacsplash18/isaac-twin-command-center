import type { MetadataRoute } from "next";

/**
 * Served by Next at /manifest.webmanifest (not /manifest.json — that path is
 * a separate, unused exclusion left in the middleware matcher). Publicly
 * fetchable without a session cookie, see middleware.ts.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Isaac Twin — Command Center",
    short_name: "Nova",
    start_url: "/",
    display: "standalone",
    background_color: "#f2f2ef",
    theme_color: "#f2f2ef",
    icons: [
      {
        src: "/icons/diamond-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/diamond-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/diamond-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
