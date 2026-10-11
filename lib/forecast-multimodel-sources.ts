import 'server-only';
import { createHash } from 'node:crypto';
import type { ForecastConfig } from './forecast-model';
import { addDays } from './forecast-model';
import { localDate, slotsForDay } from './energy';
import { cacheRead, cacheWrite, withCacheLock } from './shared-cache';
import {
  arpegeSolarMessages,
  decodeProviderSolar,
  type SolarField,
} from './forecast-provider-grib';
import { providerHours, type ProviderHour } from './forecast-provider-hours';

export type ProviderSource = {
  provider: 'arpege' | 'gfs';
  status: 'ready' | 'unavailable';
  runAt: string | null;
  fetchedAt: string;
  nativeResolutionHours: 1;
  hours: ProviderHour[];
  fields: SolarField[];
  files: {
    url: string;
    sha256: string;
    bytes: number;
    lastModified: string;
    byteRange?: string;
  }[];
};
const sha = (raw: Buffer) => createHash('sha256').update(raw).digest('hex');
async function bytes(
  url: string,
  limit: number,
  signal: AbortSignal,
  range?: string,
) {
  const response = await fetch(url, {
    cache: 'no-store',
    redirect: 'error',
    signal,
    headers: range ? { Range: 'bytes=' + range } : {},
  });
  if (
    !response.ok ||
    (range && response.status !== 206) ||
    Number(response.headers.get('content-length')) > limit
  ) {
    await response.body?.cancel();
    throw Error('Weather response unavailable');
  }
  if (
    range &&
    !response.headers.get('content-range')?.startsWith('bytes ' + range + '/')
  )
    throw Error('Unexpected weather byte range');
  const reader = response.body!.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw Error('Oversized weather response');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const raw = Buffer.concat(chunks),
    modified = response.headers.get('last-modified');
  if (
    range &&
    raw.length !== Number(range.split('-')[1]) - Number(range.split('-')[0]) + 1
  )
    throw Error('Incomplete weather byte range');
  return { raw, modified };
}
/** Once per shared cache expiry, bounded to 85 s. The primary forecast never
 * depends on these challenger sources. No SQL or credentials are used here. */
export async function fetchModelSource(
  provider: 'arpege' | 'gfs',
  c: ForecastConfig,
  now = new Date(),
): Promise<ProviderSource> {
  const empty: ProviderSource = {
    provider,
    status: 'unavailable',
    runAt: null,
    fetchedAt: now.toISOString(),
    nativeResolutionHours: 1,
    hours: [],
    fields: [],
    files: [],
  };
  if (c.latitude === null || c.longitude === null) return empty;
  const date = addDays(localDate(now), 1),
    slots = slotsForDay(date);
  const key = `model-source:v1:${provider}:${c.latitude}:${c.longitude}:${date}`;
  const saved = await cacheRead<{ expires: number; value: ProviderSource }>(
    key,
  );
  if (saved && saved.expires > now.getTime()) return saved.value;
  const locked = await withCacheLock(
    key,
    async () => {
      const recent = await cacheRead<{
        expires: number;
        value: ProviderSource;
      }>(key);
      if (recent && recent.expires > now.getTime()) return recent.value;
      const abort = new AbortController();
      try {
        const signal = AbortSignal.any([
            AbortSignal.timeout(85000),
            abort.signal,
          ]),
          source = {
            ...empty,
            fields: [] as SolarField[],
            files: [] as ProviderSource['files'],
          };
        let tasks: { url: string; lead?: number }[];
        if (provider === 'arpege') {
          const catalog = JSON.parse(
            (
              await bytes(
                'https://www.data.gouv.fr/api/1/datasets/paquets-arpege-resolution-0-1deg/',
                1500000,
                signal,
              )
            ).raw.toString(),
          ) as { resources: { url?: string }[] };
          const candidates = (catalog.resources ?? [])
            .flatMap((r) => {
              const match = r.url?.match(
                /^https:\/\/meteofrance-pnt\.s3\.rbx\.io\.cloud\.ovh\.net\/pnt\/(\d{4}-\d{2}-\d{2}T(?:00|06|12|18):00:00Z)\/arpege\/01\/SP1\/arpege__01__SP1__(\d{3})H(\d{3})H__\1\.grib2$/,
              );
              return match
                ? [
                    {
                      url: r.url!,
                      runAt: match[1],
                      first: Number(match[2]),
                      last: Number(match[3]),
                    },
                  ]
                : [];
            })
            .filter(
              (r) =>
                Date.parse(r.runAt) <= now.getTime() &&
                now.getTime() - Date.parse(r.runAt) <= 18 * 3600000,
            );
          const runAt = candidates
            .map((r) => r.runAt)
            .sort()
            .at(-1);
          if (!runAt) throw Error('No current ARPEGE package');
          source.runAt = runAt;
          const first =
              (Date.parse(slots[0].start) - Date.parse(runAt)) / 3600000,
            last =
              (Date.parse(slots.at(-1)!.start) - Date.parse(runAt)) / 3600000 +
              1;
          if (first < 0 || last > 48)
            throw Error('ARPEGE hourly horizon unavailable');
          tasks = candidates.filter(
            (r) =>
              r.runAt === runAt &&
              r.last >= Math.max(1, first) &&
              r.first <= last,
          );
        } else {
          // Native-hourly NOAA files become available progressively. A five-hour
          // publication allowance avoids selecting a partially disseminated run.
          const run =
            Math.floor((now.getTime() - 5 * 3600000) / (6 * 3600000)) *
            6 *
            3600000;
          source.runAt = new Date(run).toISOString();
          const date = source.runAt.slice(0, 10).replaceAll('-', ''),
            hour = source.runAt.slice(11, 13);
          const first = Math.max(
              1,
              (Date.parse(slots[0].start) - run) / 3600000,
            ),
            last = (Date.parse(slots.at(-1)!.start) - run) / 3600000 + 1;
          if (last > 48 || first > last)
            throw Error('GFS hourly horizon unavailable');
          tasks = Array.from({ length: last - first + 1 }, (_, i) => ({
            lead: first + i,
            url: `https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.${date}/${hour}/atmos/gfs.t${hour}z.pgrb2.0p25.f${String(first + i).padStart(3, '0')}`,
          }));
        }
        if (!tasks.length || tasks.length > 49)
          throw Error('Invalid source tasks');
        let index = 0;
        const outcomes = await Promise.allSettled(
          Array.from({ length: 2 }, async () => {
            try {
              while (index < tasks.length) {
                const task = tasks[index++];
                let range: string | undefined;
                if (provider === 'gfs') {
                  const list = (
                    await bytes(task.url + '.idx', 200000, signal)
                  ).raw
                    .toString()
                    .trim()
                    .split('\n')
                    .map((s) => s.split(':'));
                  const matched = list
                    .map((r, i) =>
                      r[3] === 'DSWRF' &&
                      r[4] === 'surface' &&
                      r[5]?.includes('ave fcst')
                        ? i
                        : -1,
                    )
                    .filter((i) => i >= 0);
                  if (matched.length !== 1 || !list[matched[0] + 1])
                    throw Error('GFS solar index unavailable');
                  const a = Number(list[matched[0]][1]),
                    b = Number(list[matched[0] + 1][1]) - 1;
                  if (
                    !Number.isSafeInteger(a) ||
                    !Number.isSafeInteger(b) ||
                    a < 0 ||
                    b < a ||
                    b - a >= 4000000
                  )
                    throw Error('Invalid GFS range');
                  range = `${a}-${b}`;
                }
                const { raw, modified } = await bytes(
                  task.url,
                  provider === 'arpege' ? 120000000 : 4000000,
                  signal,
                  range,
                );
                if (
                  !modified ||
                  !Number.isFinite(Date.parse(modified)) ||
                  Date.parse(modified) > Date.now()
                )
                  throw Error('Invalid weather publication time');
                source.files.push({
                  url: task.url,
                  sha256: sha(raw),
                  bytes: raw.length,
                  lastModified: modified,
                  ...(range ? { byteRange: range } : {}),
                });
                const frames =
                  provider === 'arpege' ? arpegeSolarMessages(raw) : [raw];
                for (const frame of frames) {
                  signal.throwIfAborted();
                  const field = await decodeProviderSolar(
                    frame,
                    c,
                    source.runAt!,
                    provider,
                  );
                  if (task.lead !== undefined && field.endLead !== task.lead)
                    throw Error('Unexpected GFS lead');
                  source.fields.push(field);
                }
              }
            } catch (error) {
              abort.abort();
              throw error;
            }
          }),
        );
        for (const result of outcomes)
          if (result.status === 'rejected') throw result.reason;
        source.fields.sort((a, b) => a.endLead - b.endLead);
        source.files.sort((a, b) => a.url.localeCompare(b.url));
        source.hours = providerHours(
          source.runAt!,
          source.fields,
          provider,
        ).filter((h) => localDate(h.start) === date);
        if (
          source.hours.length !== slots.length ||
          source.hours.some((h, i) => h.start !== slots[i].start)
        )
          throw Error('Incomplete model day');
        source.status = 'ready';
        source.fetchedAt = new Date().toISOString();
        await cacheWrite(
          key,
          { expires: now.getTime() + 3600000, value: source },
          86400,
        );
        return source;
      } catch (error) {
        abort.abort();
        console.warn(
          'Challenger source unavailable:',
          provider,
          error instanceof Error ? error.message : 'source failure',
        );
        await cacheWrite(
          key,
          { expires: now.getTime() + 900000, value: empty },
          1800,
        );
        return empty;
      }
    },
    100,
  );
  return locked.busy ? empty : locked.value;
}
