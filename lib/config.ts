export type PlatformKey = "x" | "linkedin" | "ig-story" | "ig-carousel";

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

export const PLATFORMS: PlatformConfig[] = [
  { key: "x", label: "X", dsEnv: "DS_X", autoPublish: true, bodyInPageContent: true },
  { key: "linkedin", label: "LinkedIn", dsEnv: "DS_LINKEDIN", autoPublish: true, bodyInPageContent: true },
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
  "ig-story": "IG Story",
  "ig-carousel": "IG Carousel",
};

export const STATUSES = ["Draft", "Approved", "Queued", "Posted", "Rejected"] as const;
export type Status = (typeof STATUSES)[number];
