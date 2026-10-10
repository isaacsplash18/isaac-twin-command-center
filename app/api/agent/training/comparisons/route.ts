import { NextRequest } from 'next/server';
import { agentRoute, agentJson, readJsonBody } from '@/lib/agent-api';
import { createComparison } from '@/lib/comparisons';
export async function POST(req: NextRequest) {
  return agentRoute(req, 'create training comparison', async () => agentJson(await createComparison(await readJsonBody(req, true)), 201));
}
