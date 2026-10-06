import { handleAction } from '@/lib/route-helpers';
import { trainingState } from '@/lib/training';
export const dynamic='force-dynamic';
export async function GET(){return handleAction(trainingState);}
