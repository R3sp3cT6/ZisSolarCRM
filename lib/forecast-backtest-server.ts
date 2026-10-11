import 'server-only';
import { db } from '../db/index';
import { cacheRead, cacheWrite, withCacheLock } from './shared-cache';
import type { BacktestPayload } from './forecast-backtest';
export const backtestKey = (owner: string) => 'forecast-backtest:v1:' + owner;
type Stored = { owner: string; backtest: BacktestPayload | null };
export async function readBacktest(
  owner: string,
): Promise<BacktestPayload | null> {
  const key = backtestKey(owner),
    cached = await cacheRead<Stored>(key);
  if (cached?.owner === owner) return cached.backtest;
  const result = await withCacheLock(key, async () => {
    const restored = await cacheRead<Stored>(key);
    if (restored?.owner === owner) return restored.backtest;
    const row = await db()
      .prepare(
        'SELECT payload FROM forecast_backtests WHERE owner=? ORDER BY created_at DESC,id DESC LIMIT 1',
      )
      .bind(owner)
      .first<{ payload: BacktestPayload }>();
    const backtest = row?.payload ?? null;
    await cacheWrite(key, { owner, backtest }, 7 * 86400);
    return backtest;
  });
  if (result.busy) throw Error('Historical comparison is loading');
  return result.value;
}
