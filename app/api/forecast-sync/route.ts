import { handleForecastCron } from '@/lib/forecast-server';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;
export const GET = (request: Request) => handleForecastCron(request);
