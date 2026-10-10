import { NextRequest } from 'next/server';
import { handleAction } from '@/lib/route-helpers';
import { readJsonBody } from '@/lib/agent-api';
import { judgeComparison, forgetComparisonPreference } from '@/lib/comparisons';
export async function POST(req: NextRequest, {params}: {params: Promise<{id:string}>}) {
  return handleAction(async () => judgeComparison((await params).id, await readJsonBody(req, true)));
}
export async function DELETE(_req: NextRequest, {params}: {params: Promise<{id:string}>}) {
  return handleAction(async () => forgetComparisonPreference((await params).id));
}
