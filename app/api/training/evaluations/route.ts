import { NextRequest } from 'next/server';
import { handleAction } from '@/lib/route-helpers';
import { readJsonBody } from '@/lib/agent-api';
import { evaluationState,saveEvaluation } from '@/lib/training';
export const dynamic='force-dynamic';
export async function GET(){return handleAction(evaluationState);}
export async function POST(req:NextRequest){return handleAction(async()=>saveEvaluation(await readJsonBody(req,true)));}
