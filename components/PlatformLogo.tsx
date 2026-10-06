import { PlatformKey } from "./types";

// Brand vectors: Simple Icons 13.21.0 (CC0), vendored to avoid remote asset requests.
// https://github.com/simple-icons/simple-icons/tree/13.21.0/icons
const paths = {
  x: "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z",
  linkedin:
    "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z",
  substack:
    "M22.539 8.242H1.46V5.406h21.08v2.836zM1.46 10.812V24L12 18.11 22.54 24V10.812H1.46zM22.54 0H1.46v2.836h21.08V0z",
};
const colors = { x: "#111111", linkedin: "#0A66C2", substack: "#FF6719" };

/** Decorative mark paired with a visible platform name. */
export function PlatformLogo({ platform }: { platform: PlatformKey | "all" }) {
  if (!(platform in paths)) return null;
  const key = platform as keyof typeof paths;
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white ring-1 ring-black/5"
    >
      <svg
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill={colors[key]}
        focusable="false"
      >
        <path d={paths[key]} />
      </svg>
    </span>
  );
}
