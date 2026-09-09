import {handleMemoCron} from '@/lib/memo-day-ahead';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export const maxDuration=240;
export const GET=(request:Request)=>handleMemoCron(request);
// Authenticated manual recovery uses the same collector without its clock gate.
export const POST=(request:Request)=>handleMemoCron(request,false);
