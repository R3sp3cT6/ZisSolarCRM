import { handleForecastGet, handleForecastPost } from '@/lib/forecast-server';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;
export const GET = () => handleForecastGet();
export const POST = (request: Request) => handleForecastPost(request);
