import type { MapNode } from "./types";

// Tuned for the dark map field, not the light app ground: the app's oxblood and
// amber tokens are too dark to read as light sources at this scale.
export const DOMAIN_COLOR = "#f2f2ef";
export const CAPTURE_COLOR = "#7d8083";
export const POSITION_DEFAULT_COLOR = "#a7a395";
export const CORPUS_DEFAULT_COLOR = "#8fb8bf";

export const CONFIDENCE_COLORS: Record<string, string> = {
  Confirmed: "#f3dca2",
  Predicted: "#b39556",
  Contested: "#d8433b",
};

export const CORPUS_COLORS: Record<string, string> = {
  Idea: "#7fd0d8",
  Evidence: "#86c29d",
  Counterpoint: "#d98fa3",
  "Thinker / Source": "#9eabe8",
  "Open question": "#bba6e3",
  Trend: "#6faccf",
};

export const EVIDENCE_LINK_COLOR = "127,208,216";

export function mapNodeColor(n: Pick<MapNode, "kind" | "confidence" | "nodeType">): string {
  switch (n.kind) {
    case "domain":
      return DOMAIN_COLOR;
    case "position":
      return (n.confidence && CONFIDENCE_COLORS[n.confidence]) || POSITION_DEFAULT_COLOR;
    case "corpus":
      return (n.nodeType && CORPUS_COLORS[n.nodeType]) || CORPUS_DEFAULT_COLOR;
    default:
      return CAPTURE_COLOR;
  }
}

export function mapNodeRadius(n: Pick<MapNode, "kind" | "domains">): number {
  switch (n.kind) {
    case "domain":
      return 7;
    case "position":
      return 3.4 + 0.5 * Math.min(Math.max((n.domains?.length ?? 1) - 1, 0), 4);
    case "corpus":
      return 2.6;
    default:
      return 1.8;
  }
}

export const KIND_LABELS: Record<MapNode["kind"], string> = {
  domain: "Domain",
  position: "Position",
  corpus: "Source corpus",
  capture: "Inbox capture",
};
