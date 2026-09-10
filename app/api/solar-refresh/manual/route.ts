import {withDatabaseUsage} from '@/lib/database-usage';
import {handleManualRefresh} from '@/lib/manual-refresh';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export const maxDuration=240;
export async function POST(request:Request){
 return withDatabaseUsage(()=>handleManualRefresh(request));
}
