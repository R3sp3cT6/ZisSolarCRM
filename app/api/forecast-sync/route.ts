import { handleForecastCron } from '@/lib/forecast-server';
import { runTrial } from '@/lib/forecast-trial-server';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;
export const GET = async (request: Request) => {
  const result = await handleForecastCron(request);
  if (
    result.ok &&
    (await result.clone().json()).ok &&
    process.env.FUSIONSOLAR_OWNER
  ) {
    try {
      await runTrial(process.env.FUSIONSOLAR_OWNER);
    } catch {
      console.warn('Forecast trial refresh deferred');
    }
  }
  return result;
};
