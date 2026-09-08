import {env} from 'cloudflare:workers';
import {fusionConfigured,fusionOwner,syncFusion} from '@/lib/fusionsolar-server';
import {syncMemo} from '@/lib/solar-server';
import {localDate,validDate} from '@/lib/energy';
export const dynamic='force-dynamic';
// A scheduler needs both the Sites dispatch token and this separate server secret.
// This endpoint returns counts only. It never impersonates an interactive user.
export async function POST(request:Request){
 const key=request.headers.get('X-Solar-Sync-Key');
 if(!env.SOLAR_SYNC_KEY||!key||key.length!==env.SOLAR_SYNC_KEY.length)return new Response('Unauthorized',{status:401});
 const encoder=new TextEncoder();const expected=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(env.SOLAR_SYNC_KEY)));const actual=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(key)));let difference=0;for(let i=0;i<expected.length;i++)difference|=expected[i]^actual[i];if(difference)return new Response('Unauthorized',{status:401});
 if(!fusionConfigured())return Response.json({error:'Huawei не е конфигуриран.'},{status:503});
 const day=new URL(request.url).searchParams.get('date')??localDate();if(!validDate(day))return Response.json({error:'Невалиден датум.'},{status:400});
 try{const memo=await syncMemo(localDate());const fusion=await syncFusion(fusionOwner()!,day);return Response.json({memo,fusion},{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'Синхронизацијата не успеа.'},{status:502});}
}
