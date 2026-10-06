import { NextRequest } from 'next/server';
import { agentRoute,agentJson,readJsonBody } from '@/lib/agent-api';
import { reportRun } from '@/lib/training';
export async function POST(req:NextRequest){return agentRoute(req,'training run',async()=>agentJson(await reportRun(await readJsonBody(req,true))));}
