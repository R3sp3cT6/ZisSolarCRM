import { handleTrialGet, handleTrialPost } from '@/lib/forecast-trial-server';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 180;
export const GET = () => handleTrialGet();
export const POST = (request: Request) => handleTrialPost(request);
