export type PlatformKey = "x" | "linkedin" | "ig-story" | "ig-carousel";

export interface ContentItem {
  id: string;
  platform: PlatformKey;
  platformLabel: string;
  autoPublish: boolean;
  title: string;
  body: string;
  slides: string | null;
  status: string | null;
  notionUrl: string;
  createdTime: string;
  lastEditedTime: string;
  scheduledAt: string | null;
  approvedAt: string | null;
  editedBeforeApproval: boolean;
  typefullyId: string | null;
  inCanva: boolean;
}

export interface QueueData {
  drafts: ContentItem[];
  manual: ContentItem[];
  approved: ContentItem[];
  queued: ContentItem[];
  posted: ContentItem[];
  rejected: ContentItem[];
  fetchedAt: string;
  warning?: string;
}

export interface PlatformKpi {
  decisions: number;
  untouchedApprovalRate: number | null;
  editRate: number | null;
  rejectionRate: number | null;
}

export interface Kpis {
  windowDays: 7 | 28;
  overall: PlatformKpi & {
    draftsProduced: number;
    draftsPerWeek: number;
    medianTimeToApprovalHours: number | null;
    publishFailures: number;
  };
  perPlatform: Record<string, PlatformKpi>;
  dailyDecisions: number[];
  dailyApprovals: number[];
}

export interface LinkItem {
  id: string;
  title: string;
  url: string;
  meta?: string;
}

export interface PanelsData {
  positions: {
    total: number;
    activeCount: number;
    confidenceCounts: Record<string, number>;
    needsValidation: LinkItem[];
  };
  inbox: LinkItem[];
  wiki: LinkItem[];
  publishFailures: {
    id: string;
    platform: string | null;
    at: string | null;
    notes: string;
    itemUrl: string | null;
  }[];
}

export const PLATFORM_TABS: { key: PlatformKey | "all"; label: string }[] = [
  { key: "all", label: "ALL" },
  { key: "x", label: "X" },
  { key: "linkedin", label: "LINKEDIN" },
  { key: "ig-story", label: "IG STORY" },
  { key: "ig-carousel", label: "IG CAROUSEL" },
];

export function formatSgt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Singapore",
  }).format(d);
}

/** Fire a Twin Core reaction ("approve" pulse or "error" stutter). */
export function twinPulse(kind: "approve" | "error") {
  window.dispatchEvent(new CustomEvent("twin-pulse", { detail: kind }));
}
