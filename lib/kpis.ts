/**
 * KPIs computed from the Pipeline Events DB (and content DBs for
 * drafts-produced + time-to-approval), trailing 7/28 days. PRD §7.3.
 */

import { PLATFORMS, dataSourceId } from "./config";
import { queryDataSource, queryEvents, readDateProp, readSelectProp } from "./notion";

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
  /** Daily decision counts (oldest → newest) for sparklines. */
  dailyDecisions: number[];
  dailyApprovals: number[];
}

function rate(n: number, d: number): number | null {
  return d === 0 ? null : n / d;
}

export async function computeKpis(windowDays: 7 | 28): Promise<Kpis> {
  const now = Date.now();
  const since = new Date(now - windowDays * 86400_000);
  const sinceIso = since.toISOString();

  const events = await queryEvents(sinceIso);

  const tally = (evts: typeof events): PlatformKpi => {
    let approved = 0,
      edited = 0,
      rejected = 0;
    for (const e of evts) {
      const kind = readSelectProp(e, "Event");
      if (kind === "Approved") approved++;
      else if (kind === "Approved-with-edits") edited++;
      else if (kind === "Rejected") rejected++;
    }
    const decisions = approved + edited + rejected;
    return {
      decisions,
      untouchedApprovalRate: rate(approved, decisions),
      editRate: rate(edited, decisions),
      rejectionRate: rate(rejected, decisions),
    };
  };

  const perPlatform: Record<string, PlatformKpi> = {};
  for (const p of PLATFORMS) {
    perPlatform[p.key] = tally(events.filter((e) => readSelectProp(e, "Platform") === p.label));
  }

  const publishFailures = events.filter((e) => readSelectProp(e, "Event") === "Publish-failed").length;

  // Daily buckets for sparklines
  const dailyDecisions = new Array<number>(windowDays).fill(0);
  const dailyApprovals = new Array<number>(windowDays).fill(0);
  for (const e of events) {
    const ts = readDateProp(e, "Timestamp");
    if (!ts) continue;
    const kind = readSelectProp(e, "Event");
    const idx = Math.floor((new Date(ts).getTime() - since.getTime()) / 86400_000);
    if (idx < 0 || idx >= windowDays) continue;
    if (kind === "Approved" || kind === "Approved-with-edits" || kind === "Rejected") {
      dailyDecisions[idx]++;
      if (kind !== "Rejected") dailyApprovals[idx]++;
    }
  }

  // Drafts produced + median time-to-approval from the content DBs
  let draftsProduced = 0;
  const approvalLagsMs: number[] = [];
  for (const p of PLATFORMS) {
    try {
      const pages = await queryDataSource(dataSourceId(p), {
        filter: { timestamp: "created_time", created_time: { on_or_after: sinceIso } },
        sorts: [{ timestamp: "created_time", direction: "descending" }],
      });
      draftsProduced += pages.length;
      for (const page of pages) {
        const approvedAt = readDateProp(page, "Approved At");
        if (approvedAt) {
          approvalLagsMs.push(new Date(approvedAt).getTime() - new Date(page.created_time).getTime());
        }
      }
    } catch {
      // A platform DS being unavailable shouldn't zero out the whole panel.
    }
  }
  approvalLagsMs.sort((a, b) => a - b);
  const median =
    approvalLagsMs.length === 0
      ? null
      : approvalLagsMs[Math.floor(approvalLagsMs.length / 2)] / 3600_000;

  return {
    windowDays,
    overall: {
      ...tally(events),
      draftsProduced,
      draftsPerWeek: draftsProduced / (windowDays / 7),
      medianTimeToApprovalHours: median,
      publishFailures,
    },
    perPlatform,
    dailyDecisions,
    dailyApprovals,
  };
}

/** Publish-failed events in the last 24h from Pipeline Events (shared by the hermes export and /api/agent/state). */
export async function publishFailures24h(): Promise<number> {
  const events = await queryEvents(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  return events.filter((e) => readSelectProp(e, "Event") === "Publish-failed").length;
}
