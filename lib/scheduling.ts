/**
 * Publish-slot computation. All cadence logic in SGT (Asia/Singapore,
 * UTC+8, no DST — safe to do fixed-offset arithmetic).
 *
 *  - X: one per day, 08:30 SGT.
 *  - LinkedIn: Mon/Wed/Fri, 09:00 SGT.
 *  - Substack Notes: one per day, 21:00 SGT (09:00 US Eastern, where most
 *    of the Substack readership actually is).
 */

const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;
/** Don't schedule into a slot less than 10 minutes away. */
const LEAD_MS = 10 * 60 * 1000;

function sgtParts(date: Date): { y: number; m: number; d: number; weekday: number } {
  const t = new Date(date.getTime() + SGT_OFFSET_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(), weekday: t.getUTCDay() };
}

/** UTC Date for a given SGT calendar day + time. */
function sgtDate(y: number, m: number, d: number, hour: number, minute: number): Date {
  return new Date(Date.UTC(y, m, d, hour, minute) - SGT_OFFSET_MS);
}

function normalizeTaken(takenIso: string[]): Set<number> {
  return new Set(takenIso.map((s) => new Date(s).getTime()).filter((n) => !Number.isNaN(n)));
}

export type SchedulablePlatform = "x" | "linkedin" | "substack";

const CADENCE: Record<SchedulablePlatform, { days: number[]; hour: number; minute: number }> = {
  x: { days: [0, 1, 2, 3, 4, 5, 6], hour: 8, minute: 30 },
  linkedin: { days: [1, 3, 5], hour: 9, minute: 0 }, // Mon/Wed/Fri
  substack: { days: [0, 1, 2, 3, 4, 5, 6], hour: 21, minute: 0 },
};

/**
 * Next free publish slot for a platform, as an ISO UTC string.
 * `takenIso` = Scheduled At values of items already Queued (plus slots
 * assigned earlier in the same publisher run).
 */
export function nextFreeSlot(platform: SchedulablePlatform, now: Date, takenIso: string[]): string {
  const { days, hour, minute } = CADENCE[platform];
  const taken = normalizeTaken(takenIso);
  const start = sgtParts(now);
  for (let offset = 0; offset < 90; offset++) {
    const probe = new Date(Date.UTC(start.y, start.m, start.d + offset));
    const slot = sgtDate(probe.getUTCFullYear(), probe.getUTCMonth(), probe.getUTCDate(), hour, minute);
    if (!days.includes(sgtParts(slot).weekday)) continue;
    if (slot.getTime() < now.getTime() + LEAD_MS) continue;
    if (taken.has(slot.getTime())) continue;
    return slot.toISOString();
  }
  throw new Error(`No free ${platform} slot found in the next 90 days`);
}

/** British-style compact SGT rendering for the UI, e.g. "Fri 4 Jul, 09:00". */
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
