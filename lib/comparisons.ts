import { createHash, randomInt } from 'node:crypto';
import { ActionError } from './actions';
import { requiredEnv } from './config';
import { getPage, notionFetch, readSelectProp, richTextValue } from './notion';
import { record, records, readTrainingPayload } from './training';
import { EVALUATION_CASES } from './training-metrics';

export type ComparisonChoice = 'A' | 'B' | 'both' | 'neither';
type Comparison = {
  id: string; createdAt: string; caseId: string; title: string; platform: string;
  baseline: string; candidate: string; baselineVersion: string; candidateVersion: string;
  aIs: 'baseline' | 'candidate'; status: 'pending' | 'completed';
  sourceSnapshot: string; sourceUrl: string; limitations: string; comparisonKey: string;
  choice?: ComparisonChoice; winner?: 'baseline' | 'candidate' | 'both' | 'neither';
  reason?: string; scope?: 'once' | 'always'; preference?: string; judgedAt?: string;
};
const norm = (s: string) => s.replace(/-/g, '').toLowerCase();
const idPattern = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
function field(value: unknown, max: number, required = true): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new ActionError('Missing or invalid comparison text', 400);
  return value.trim();
}
function valid(r: any): r is Comparison {
  return r && EVALUATION_CASES.some(c => c.id === r.caseId) && ['pending', 'completed'].includes(r.status)
    && ['baseline', 'candidate'].includes(r.aIs) && ['baseline', 'candidate', 'title', 'platform', 'baselineVersion', 'candidateVersion', 'sourceSnapshot', 'sourceUrl', 'limitations', 'comparisonKey'].every(k => typeof r[k] === 'string')
    && r.baseline.trim() && r.candidate.trim()
    && (r.status === 'pending' || (['A', 'B', 'both', 'neither'].includes(r.choice) && ['once', 'always'].includes(r.scope) && typeof r.reason === 'string' && typeof r.preference === 'string'));
}
async function allComparisons(): Promise<Comparison[]> {
  return (await records('comparison')).filter(valid);
}
export function comparisonDigest(c: Comparison): string {
  return createHash('sha256').update(JSON.stringify([c.caseId, c.title, c.platform, c.baseline, c.candidate, c.baselineVersion, c.candidateVersion, c.aIs, c.sourceSnapshot, c.sourceUrl, c.limitations])).digest('hex');
}
function present(c: Comparison) {
  // Pending responses intentionally omit strategy labels, mapping and generator notes.
  const result = { id: c.id, caseId: c.caseId, title: c.title, platform: c.platform,
    A: c[c.aIs], B: c[c.aIs === 'baseline' ? 'candidate' : 'baseline'],
    sourceSnapshot: c.sourceSnapshot, sourceUrl: /^https:\/\/www\.notion\.so\//.test(c.sourceUrl) ? c.sourceUrl : '',
    digest: comparisonDigest(c), createdAt: c.createdAt };
  return c.status === 'pending' ? result : { ...result, choice: c.choice, winner: c.winner, reason: c.reason, scope: c.scope, preference: c.preference, judgedAt: c.judgedAt, baselineVersion: c.baselineVersion, candidateVersion: c.candidateVersion, aIs: c.aIs, limitations: c.limitations };
}
export async function comparisonState() {
  const comparisons = await allComparisons();
  return { pending: comparisons.filter(c => c.status === 'pending').reverse().map(present),
    completed: comparisons.filter(c => c.status === 'completed').map(present) };
}
export async function createComparison(body: Record<string, unknown>) {
  const testCase = EVALUATION_CASES.find(c => c.id === body.caseId);
  if (!testCase) throw new ActionError('Unknown evaluation case', 400);
  const values = {
    caseId: testCase.id, platform: testCase.platform, title: field(body.title, 200),
    baseline: field(body.baseline, 20000), candidate: field(body.candidate, 20000),
    baselineVersion: field(body.baselineVersion, 200), candidateVersion: field(body.candidateVersion, 200),
    sourceSnapshot: field(body.sourceSnapshot, 30000), sourceUrl: field(body.sourceUrl ?? '', 300, false),
    limitations: field(body.limitations ?? '', 3000, false),
  };
  if (values.baseline === values.candidate) throw new ActionError('The two drafts must differ', 400);
  const comparisonKey = createHash('sha256').update(JSON.stringify(values)).digest('hex');
  const existing = (await allComparisons()).find(c => c.comparisonKey === comparisonKey);
  if (existing) return { id: existing.id, alreadyExists: true };
  const saved = await record('comparison', { ...values, comparisonKey, status: 'pending', aIs: randomInt(2) ? 'baseline' : 'candidate' });
  return { id: saved.id };
}
async function loadComparison(id: string): Promise<Comparison> {
  if (!idPattern.test(id)) throw new ActionError('Invalid comparison ID', 400);
  const p = await getPage(id);
  if (norm(p.parent?.data_source_id || '') !== norm(requiredEnv('DS_TRAINING')) || readSelectProp(p, 'Kind') !== 'comparison' || p.archived || p.in_trash) throw new ActionError('Not a training comparison', 400);
  const value = await readTrainingPayload(p);
  if (!valid(value)) throw new ActionError('Malformed comparison', 422);
  return { ...value, id, createdAt: p.created_time };
}
async function persist(c: Comparison) {
  const { id, createdAt, ...payload } = c;
  await notionFetch(`/pages/${id}`, { method: 'PATCH', body: JSON.stringify({ properties: { Payload: richTextValue(JSON.stringify(payload)) } }) });
}
export async function judgeComparison(id: string, body: Record<string, unknown>) {
  const c = await loadComparison(id);
  if (!['A', 'B', 'both', 'neither'].includes(String(body.choice))) throw new ActionError('Choose A, B, both good, or neither', 400);
  if (!['once', 'always'].includes(String(body.scope))) throw new ActionError('Choose a feedback scope', 400);
  const reason = field(body.reason ?? '', 4000, false);
  const preference = body.scope === 'always' ? field(body.preference, 2000) : '';
  if (c.status === 'completed') {
    if (c.choice === body.choice && c.scope === body.scope && c.reason === reason && c.preference === preference) return { ok: true, result: present(c), alreadySaved: true };
    throw new ActionError('This comparison was already answered. Refresh to see the saved result.', 409);
  }
  if (body.digest !== comparisonDigest(c)) throw new ActionError('This comparison changed. Refresh before choosing.', 409);
  const choice = body.choice as ComparisonChoice;
  const winner = choice === 'A' ? c.aIs : choice === 'B' ? (c.aIs === 'baseline' ? 'candidate' : 'baseline') : choice;
  const updated: Comparison = { ...c, status: 'completed', choice, winner, reason, scope: body.scope as 'once' | 'always', preference, judgedAt: new Date().toISOString() };
  // Judgment and explicit preference persist in one Notion record, so retries do not create duplicate memories.
  await persist(updated);
  return { ok: true, result: present(updated) };
}
export async function forgetComparisonPreference(id: string) {
  const c = await loadComparison(id);
  if (c.status !== 'completed') throw new ActionError('Comparison has not been judged', 409);
  await persist({ ...c, scope: 'once' });
  return { ok: true };
}
export async function comparisonPreferences(platform: string) {
  return (await allComparisons()).filter(c => c.status === 'completed' && c.scope === 'always' && c.preference?.trim() && c.platform === platform)
    .slice(0, 20).map(c => ({ id: c.id, preference: c.preference!, platform: c.platform, revision: c.judgedAt }));
}
