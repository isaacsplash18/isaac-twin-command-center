import { NextRequest } from 'next/server';
import { handleAction } from '@/lib/route-helpers';
import { readJsonBody } from '@/lib/agent-api';
import { saveExample } from '@/lib/training';
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){return handleAction(async()=>saveExample((await params).id,await readJsonBody(req,true)));}
