import 'server-only';
import { db } from '../db/index';
import { cacheRead, cacheWrite, withCacheLock } from './shared-cache';
import type { ContractTerms } from './contracts';

export const CONTRACT_CACHE_KEY = 'contracts:20261001:v1';
export async function readContracts(): Promise<ContractTerms[]> {
  const cached = await cacheRead<ContractTerms[]>(CONTRACT_CACHE_KEY);
  if (cached?.length) return cached;
  const loaded = await withCacheLock(CONTRACT_CACHE_KEY, async () => {
    const restored = await cacheRead<ContractTerms[]>(CONTRACT_CACHE_KEY);
    if (restored?.length) return restored;
    const { results } = await db()
      .prepare(
        'SELECT version,effective_from::text AS "effectiveFrom",share::double precision AS share,fixed_eur_mwh::double precision AS "fixedEurMwh" FROM contract_versions ORDER BY effective_from NULLS FIRST',
      )
      .all<ContractTerms>();
    if (
      results.filter((c) => c.effectiveFrom === null).length !== 1 ||
      results.some(
        (c) =>
          !c.version ||
          !Number.isFinite(c.share) ||
          c.share <= 0 ||
          c.share > 1 ||
          !Number.isFinite(c.fixedEurMwh) ||
          c.fixedEurMwh < 0,
      )
    )
      throw Error('Invalid persisted contract schedule');
    await cacheWrite(CONTRACT_CACHE_KEY, results, 7 * 86400);
    return results;
  });
  if (loaded.busy) {
    const restored = await cacheRead<ContractTerms[]>(CONTRACT_CACHE_KEY);
    if (restored?.length) return restored;
    throw Error('Contract schedule is loading');
  }
  return loaded.value;
}
