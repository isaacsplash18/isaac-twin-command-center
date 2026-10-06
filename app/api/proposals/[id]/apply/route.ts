import { NextRequest } from 'next/server';
import { handleAction } from '@/lib/route-helpers';
import { readJsonBody } from '@/lib/agent-api';
import { previewApplication,applyProposal } from '@/lib/training';
export const dynamic='force-dynamic';
export async function GET(_req:NextRequest,{params}:{params:Promise<{id:string}>}){return handleAction(async()=>previewApplication((await params).id));}
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){return handleAction(async()=>{const b=await readJsonBody(req,true);return applyProposal((await params).id,String(b.digest||''));});}
