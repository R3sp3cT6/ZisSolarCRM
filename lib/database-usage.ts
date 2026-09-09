import {AsyncLocalStorage} from 'node:async_hooks';
const usage=new AsyncLocalStorage<{queries:number}>();
export function countDatabaseQuery(){const current=usage.getStore();if(current)current.queries++;}
// Observability for verifying that cache hits (including authentication) never
// wake Neon. Only a count is exposed, never SQL, credentials or user identifiers.
export async function withDatabaseUsage(work:()=>Promise<Response>){
 return usage.run({queries:0},async()=>{const response=await work();response.headers.set('X-ZIS-Database-Queries',String(usage.getStore()!.queries));return response;});
}
