export type PlatformKey = "x" | "linkedin" | "substack" | "ig-story" | "ig-carousel";

export interface PlatformConfig {
  key: PlatformKey;
  label: string;
  dsEnv: string;
  /** Typefully auto-publishes these; IG platforms go to the manual lane. */
  autoPublish: boolean;
  /** Body lives in page content (blocks), not a property. */
  bodyInPageContent: boolean;
  /** Rich-text property holding the body, when not in page content (verified against live schemas). */
  bodyProp?: string;
  /** Secondary rich-text property shown read-only (IG Carousel slide texts). */
  slidesProp?: string;
}

/**
 * Publishing mode: with no TYPEFULLY_API_KEY (or PUBLISH_MODE=manual) every
 * platform uses the manual copy-paste lane — Approve → COPY → Mark Posted.
 * Setting a Typefully key re-enables zero-touch publishing, scoped to the
 * platforms listed in TYPEFULLY_PLATFORMS (default X only — LinkedIn stays
 * manual until Isaac explicitly opts it in).
 */
export const TYPEFULLY_ENABLED = !!process.env.TYPEFULLY_API_KEY && process.env.PUBLISH_MODE !== "manual";

/** Pure so verify scripts can exercise the parsing without mutating process.env. */
export function parseTypefullyPlatforms(raw: string | undefined): Set<string> {
  if (!raw || !raw.trim()) return new Set(["x"]);
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

export const TYPEFULLY_PLATFORMS = parseTypefullyPlatforms(process.env.TYPEFULLY_PLATFORMS);

export const PLATFORMS: PlatformConfig[] = [
  { key: "x", label: "X", dsEnv: "DS_X", autoPublish: TYPEFULLY_ENABLED && TYPEFULLY_PLATFORMS.has("x"), bodyInPageContent: true },
  {
    key: "linkedin",
    label: "LinkedIn",
    dsEnv: "DS_LINKEDIN",
    autoPublish: TYPEFULLY_ENABLED && TYPEFULLY_PLATFORMS.has("linkedin"),
    bodyInPageContent: true,
  },
  {
    // Substack Notes. Observation-only notes mined from the Larger back
    // catalogue on rotation; Typefully v2 exposes these as the `substack`
    // platform. Body lives in page content, same convention as X/LinkedIn.
    key: "substack",
    label: "Substack",
    dsEnv: "DS_SUBSTACK_NOTES",
    autoPublish: TYPEFULLY_ENABLED && TYPEFULLY_PLATFORMS.has("substack"),
    bodyInPageContent: true,
  },
  {
    key: "ig-story",
    label: "IG Story",
    dsEnv: "DS_IG_STORY",
    autoPublish: false,
    bodyInPageContent: false,
    bodyProp: "IG Story Copy",
  },
  {
    key: "ig-carousel",
    label: "IG Carousel",
    dsEnv: "DS_IG_CAROUSEL",
    autoPublish: false,
    bodyInPageContent: false,
    bodyProp: "Caption",
    slidesProp: "Slide Texts",
  },
];

export function platform(key: string): PlatformConfig {
  const p = PLATFORMS.find((p) => p.key === key);
  if (!p) throw new Error(`Unknown platform: ${key}`);
  return p;
}

export function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

export function dataSourceId(p: PlatformConfig): string {
  return requiredEnv(p.dsEnv);
}

/** Platform display names used in the Pipeline Events DB. */
export const PLATFORM_EVENT_NAMES: Record<PlatformKey, string> = {
  x: "X",
  linkedin: "LinkedIn",
  substack: "Substack",
  "ig-story": "IG Story",
  "ig-carousel": "IG Carousel",
};

export const STATUSES = ["Draft", "Approved", "Queued", "Posted", "Rejected"] as const;
export type Status = (typeof STATUSES)[number];
