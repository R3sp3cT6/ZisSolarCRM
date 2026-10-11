import { handleForecastCron } from '@/lib/forecast-server';
import { runTrial } from '@/lib/forecast-trial-server';
import { runModels } from '@/lib/forecast-multimodel-server';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;
export const GET = async (request: Request) => {
  const started = Date.now();
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
    try {
      // Leave the primary result enough time to return within this route's
      // 300-second limit if an earlier source was unusually slow.
      if (Date.now() - started < 150000)
        await runModels(process.env.FUSIONSOLAR_OWNER);
    } catch {
      console.warn('Multi-model collection deferred');
    }
  }
  return result;
};
