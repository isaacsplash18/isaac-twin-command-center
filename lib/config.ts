export type PlatformKey = "x" | "linkedin" | "substack" | "ig-story" | "ig-carousel";

export interface PlatformConfig {
  key: PlatformKey;
  label: string;
  dsEnv: string;
  /** The active publishing engine (Typefully or Buffer) auto-publishes these; IG platforms go to the manual lane. */
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
 *
 * Buffer is a second engine (lib/buffer.ts, selected via lib/publish-engine.ts).
 * PUBLISH_ENGINE picks which engine creates NEW posts (default "typefully" —
 * with it unset, every flag below resolves exactly as it did before Buffer
 * existed). With PUBLISH_ENGINE=buffer, a platform auto-publishes when
 * BUFFER_ACCESS_TOKEN and that platform's BUFFER_CHANNEL_* id are both set
 * (the channel id is the per-platform opt-in; TYPEFULLY_PLATFORMS is ignored).
 * PUBLISH_MODE=manual trumps everything.
 */
export const TYPEFULLY_ENABLED = !!process.env.TYPEFULLY_API_KEY && process.env.PUBLISH_MODE !== "manual";

export type PublishEngineKey = "typefully" | "buffer";

/**
 * Pure PUBLISH_ENGINE parser: unset/blank → "typefully"; a valid name (any
 * case) → that engine; anything else → null (invalid). Callers fail closed on
 * null — config treats it as manual, engineForNewPosts() throws.
 */
export function parsePublishEngine(raw: string | undefined): PublishEngineKey | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "") return "typefully";
  return v === "typefully" || v === "buffer" ? v : null;
}

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

/** Notion-stored id prefix marking a Buffer post in the "Typefully ID" property (see lib/publish-engine.ts). */
export const BUFFER_ID_PREFIX = "buffer:";

/** Per-platform Buffer channel id env vars (Buffer schedules per connected channel, unlike Typefully's social set). */
export const BUFFER_CHANNEL_ENVS: Partial<Record<PlatformKey, string>> = {
  x: "BUFFER_CHANNEL_X",
  linkedin: "BUFFER_CHANNEL_LINKEDIN",
  substack: "BUFFER_CHANNEL_SUBSTACK",
};

type EnvLike = Record<string, string | undefined>;

function bufferReady(key: string, env: EnvLike): boolean {
  const channelEnv = BUFFER_CHANNEL_ENVS[key as PlatformKey];
  return env.PUBLISH_MODE !== "manual" && !!env.BUFFER_ACCESS_TOKEN && !!channelEnv && !!env[channelEnv];
}

function typefullyReady(key: string, env: EnvLike): boolean {
  return (
    !!env.TYPEFULLY_API_KEY && env.PUBLISH_MODE !== "manual" && parseTypefullyPlatforms(env.TYPEFULLY_PLATFORMS).has(key)
  );
}

/**
 * Can the publisher CREATE new scheduled posts for this platform? Pure over
 * `env` so verify scripts can test the engine × env matrix. IG platforms are
 * hardcoded manual in ALL_PLATFORMS and never reach this.
 */
export function computeAutoPublish(key: string, env: EnvLike = process.env): boolean {
  const engine = parsePublishEngine(env.PUBLISH_ENGINE);
  if (engine === "typefully") return typefullyReady(key, env);
  if (engine === "buffer") return bufferReady(key, env);
  return false; // invalid PUBLISH_ENGINE → fail closed to manual
}

/**
 * Should the reconciler look at this platform's Queued items? Superset of
 * autoPublish: after an engine flip, items queued through the OTHER engine
 * (Typefully ids un-prefixed, Buffer ids `buffer:`-prefixed) must still be
 * reconciled to Posted, so a platform reconciles when EITHER engine is usable
 * for it. With no Buffer env set this equals computeAutoPublish exactly.
 */
export function computeReconciles(key: string, env: EnvLike = process.env): boolean {
  if (env.PUBLISH_MODE === "manual") return false;
  return computeAutoPublish(key, env) || typefullyReady(key, env) || bufferReady(key, env);
}

/** What the hermes export / agent state report as publisher.mode. Pure over `env`. */
export function computePublisherMode(env: EnvLike = process.env): "typefully" | "buffer" | "manual" {
  if (env.PUBLISH_MODE === "manual") return "manual";
  const engine = parsePublishEngine(env.PUBLISH_ENGINE);
  if (engine === "typefully") return env.TYPEFULLY_API_KEY ? "typefully" : "manual";
  if (engine === "buffer") {
    const anyChannel = Object.values(BUFFER_CHANNEL_ENVS).some((name) => !!name && !!env[name]);
    return env.BUFFER_ACCESS_TOKEN && anyChannel ? "buffer" : "manual";
  }
  return "manual";
}

/** Honest publisher mode for the machine-lane state endpoints: "typefully" | "buffer" | "manual". */
export const PUBLISHER_MODE = computePublisherMode();

/** Reconciler platform gate — see computeReconciles. */
export function platformReconciles(p: PlatformConfig): boolean {
  return p.autoPublish || (p.key !== "ig-story" && p.key !== "ig-carousel" && computeReconciles(p.key));
}

export const ALL_PLATFORMS: PlatformConfig[] = [
  { key: "x", label: "X", dsEnv: "DS_X", autoPublish: computeAutoPublish("x"), bodyInPageContent: true },
  {
    key: "linkedin",
    label: "LinkedIn",
    dsEnv: "DS_LINKEDIN",
    autoPublish: computeAutoPublish("linkedin"),
    bodyInPageContent: true,
  },
  {
    // Substack Notes. Observation-only notes mined from the Larger back
    // catalogue on rotation; Typefully v2 and Buffer both expose these as the
    // `substack` platform/service. Body lives in page content, same convention as X/LinkedIn.
    key: "substack",
    label: "Substack",
    dsEnv: "DS_SUBSTACK_NOTES",
    autoPublish: computeAutoPublish("substack"),
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

/**
 * Platforms hidden from the app. The Instagram engines were switched off on
 * 2026-07-29 (the drafting routines were removed; Isaac plans to rebuild the
 * IG system later). Everything below stays wired: the Notion databases, the
 * DS_IG_* env vars, the PlatformKey union, the Pipeline/Calibration event
 * names and the ALL_PLATFORMS entries are all intact. To bring a platform
 * back, delete its key from this array. Nothing else needs to change.
 */
export const HIDDEN_PLATFORM_KEYS: PlatformKey[] = ["ig-story", "ig-carousel"];

/** The platforms the app actually surfaces: tabs, KPIs, queue, publisher, Hermes. */
export const PLATFORMS: PlatformConfig[] = ALL_PLATFORMS.filter((p) => !HIDDEN_PLATFORM_KEYS.includes(p.key));

/** Resolves against ALL_PLATFORMS on purpose, so a hidden platform's config is still addressable by key. */
export function platform(key: string): PlatformConfig {
  const p = ALL_PLATFORMS.find((p) => p.key === key);
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
