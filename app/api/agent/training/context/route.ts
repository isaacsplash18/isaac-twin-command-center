import { NextRequest } from 'next/server';
import { agentRoute,agentJson,readJsonBody } from '@/lib/agent-api';
import { trainingContext } from '@/lib/training';
export async function POST(req:NextRequest){return agentRoute(req,'training context',async()=>{const b=await readJsonBody(req,true);return agentJson(await trainingContext(String(b.platform||''),String(b.topic||'').slice(0,1000)));});}
