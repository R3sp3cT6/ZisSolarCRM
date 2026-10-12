'use client';

import { Info } from 'lucide-react';
import { useLanguage } from './language-switch';
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from './ui/popover';
import { t, getLanguage } from '@/lib/language';
import { formatNumber } from '@/lib/number-format';
import type { getDashboard } from '@/lib/solar-server';

type Comparison = Awaited<
  ReturnType<typeof getDashboard>
>['forecastComparison'];

export function ForecastAccuracy({ comparison }: { comparison: Comparison }) {
  useLanguage();
  const number = (value: number | null, digits = 1) =>
    formatNumber(value, digits, getLanguage());
  const mwh = (value: number | null) =>
    number(value === null ? null : value / 1000, 3);
  if (comparison.status === 'unavailable')
    return (
      <span className="forecast-match-empty">
        {t('Точност · ден однапред')} <strong>—</strong>
        <small>
          {t(
            comparison.status === 'unavailable'
              ? 'Споредбата моментално не е достапна.'
              : 'Нема споредливи мерења.',
          )}
        </small>
      </span>
    );

  const renderScore = (
    score: Comparison['dayAheadScore'] | Comparison['evaluations'][number],
  ) => {
    const dayAhead = score.kind === 'day-ahead';
    const satellite =
      score.kind === 'backtest' &&
      comparison.backtestMethod === 'satellite-hour-ahead';
    const match =
      score.matchPercent !== null && Number.isFinite(score.matchPercent)
        ? Math.max(0, Math.min(100, score.matchPercent))
        : null;
    const source = t(
      dayAhead
        ? 'Прогноза ден однапред'
        : satellite
          ? 'Сателитска симулација · 1 час'
          : score.kind === 'backtest'
            ? 'Историска симулација'
            : 'Зачувана прогноза',
    );
    return (
      <div className="forecast-comparison-item" key={score.kind}>
        <div className="forecast-accuracy-summary">
          <div className="forecast-accuracy-heading">
            <span>
              {t(dayAhead ? 'Точност · ден однапред' : 'Совпаѓање со линијата')}
            </span>
            <strong>
              {number(match)}
              {match !== null && '%'}
            </strong>
          </div>
          {match !== null ? (
            <>
              <meter
                className="sr-only"
                aria-label={`${t('Часовно совпаѓање')} · ${source}`}
                min={0}
                max={100}
                value={match}
                aria-valuetext={`${number(match)}% · ${score.hours} ${t('споредени часови')}`}
              />
              <span className="forecast-accuracy-track" aria-hidden="true">
                <span
                  className="forecast-accuracy-fill"
                  style={{ width: `${match}%` }}
                />
              </span>
            </>
          ) : (
            <span className="forecast-accuracy-track" aria-hidden="true" />
          )}
          <span className="forecast-accuracy-ticks" aria-hidden="true">
            <span>0%</span>
            <span>50%</span>
            <span>100%</span>
          </span>
          <span className="forecast-accuracy-source">
            {source} ·{' '}
            {t(
              match === null ? 'Нема споредливи мерења.' : 'Часовно совпаѓање',
            )}
          </span>
          {dayAhead && (
            <span className="forecast-accuracy-source">
              {score.pairedHours}/{score.completedHours}{' '}
              {t('завршени часа со прогноза и мерење')}
            </span>
          )}
        </div>
        <Popover>
          <PopoverTrigger className="forecast-match-trigger">
            <span className="forecast-match-label">
              {t(
                score.kind === 'backtest'
                  ? 'Предвидено · симулација'
                  : 'Предвидено · прогноза',
              )}{' '}
              <strong>{mwh(score.predictedKwh)} MWh</strong>
            </span>
            <span className="forecast-match-value">
              {t('Разлика во збирот')}{' '}
              <strong>
                {score.totalDifferenceKwh !== null &&
                  score.totalDifferenceKwh > 0 &&
                  '+'}
                {mwh(score.totalDifferenceKwh)} MWh
              </strong>
              <span>
                (
                {score.totalDifferencePercent !== null &&
                  score.totalDifferencePercent > 0 &&
                  '+'}
                {number(score.totalDifferencePercent)}
                {score.totalDifferencePercent !== null && '%'})
              </span>
            </span>
            <span className="forecast-match-value forecast-wape">
              {t('Часовна грешка — WAPE')}{' '}
              <strong>
                {number(score.wapePercent)}
                {score.wapePercent !== null && '%'}
              </strong>
              <Info size={14} aria-hidden="true" />
            </span>
            <small>
              {score.hours > 0
                ? `${t('Реално во споредбата')}: ${mwh(score.actualKwh)} MWh · ${score.hours} ${t('споредени часови')} · ${t('Помал WAPE е подобро.')}`
                : t('Нема споредливи мерења.')}
            </small>
          </PopoverTrigger>
          <PopoverContent
            className="forecast-match-popover"
            align="end"
            sideOffset={10}
          >
            <PopoverTitle>
              {t('Споредба со реалното производство')}
            </PopoverTitle>
            <p>
              {t(
                dayAhead
                  ? 'Последната зачувана прогноза од претходниот ден, издадена до 18:00 UTC (20:00 летно / 19:00 зимско време во Ресен). Се користи една верзија за целиот ден. Подоцнежните корекции и симулации не влегуваат во оваа оценка.'
                  : satellite
                    ? 'v3.2 + LSA SAF: историска симулација за следниот час, со претходни сателитски набљудувања. Не е прогноза издадена ден однапред.'
                    : score.kind === 'backtest'
                      ? 'Историска симулација со NOAA/GFS, пресметана накнадно.'
                      : 'Првата зачувана прогноза пред почетокот на секој час.',
              )}
            </p>
            {satellite && (
              <p>
                {t(
                  'Без валиден сателитски запис се користи основата v3.2. Историската достапност е претпоставена: создавање на датотеката + 2 минути. Целосниот ICON/Huawei модел не е реконструиран за овие денови.',
                )}
              </p>
            )}
            <dl>
              <div>
                <dt>{t('Точност на моделот')}</dt>
                <dd>
                  {number(match)}
                  {match !== null && '%'}
                </dd>
              </div>
              <div>
                <dt>{t('Реално производство')}</dt>
                <dd>{mwh(score.actualKwh)} MWh</dd>
              </div>
              <div>
                <dt>{t('Предвидено производство')}</dt>
                <dd>{mwh(score.predictedKwh)} MWh</dd>
              </div>
              <div>
                <dt>{t('Разлика во збирот')}</dt>
                <dd>
                  {score.totalDifferenceKwh !== null &&
                    score.totalDifferenceKwh > 0 &&
                    '+'}
                  {mwh(score.totalDifferenceKwh)} MWh
                </dd>
              </div>
              <div>
                <dt>{t('Просечно отстапување по час')}</dt>
                <dd>{mwh(score.maeKwh)} MWh</dd>
              </div>
              <div>
                <dt>{t('Часовна грешка — WAPE')}</dt>
                <dd>
                  {number(score.wapePercent)}
                  {score.wapePercent !== null && '%'}
                </dd>
              </div>
            </dl>
            <p>
              {t(
                'Точност = max(0, 100 − WAPE). Скала од 0% до 100% за споредените часови во избраниот период, не гаранција за идната точност. При WAPE над 100%, оценката е 0%.',
              )}
            </p>
            <p>
              {t(
                'Само споредени завршени часови од избраниот период. Недостасувачките мерења, тековниот час и ноќните двојни нули се исклучени.',
              )}
            </p>
            <p>
              {t(
                'Разликата во збирот е предвидено − реално; процентот е во однос на реалното. Плус значи повеќе предвидено, минус помалку. Се споредуваат истите часови, па збирот може да се разликува од тековниот Huawei бројач.',
              )}
            </p>
            <p>
              {t(
                'WAPE = збир на |предвидено − реално| за секој час / збир на реалното × 100. Утринските и пладневните грешки не се поништуваат. Целта е помал часовен WAPE, не само близок дневен збир.',
              )}
            </p>
            {score.wapePercent === null && (
              <p>
                {t(
                  'Процентот се прикажува кога има споредливи часови со вкупно реално производство над нула.',
                )}
              </p>
            )}
          </PopoverContent>
        </Popover>
      </div>
    );
  };
  return (
    <>
      {renderScore(comparison.dayAheadScore)}
      {comparison.evaluations.length > 0 && (
        <details className="forecast-secondary-scores">
          <summary>{t('Други споредби · прикажаната линија')}</summary>
          {comparison.evaluations.map(renderScore)}
        </details>
      )}
    </>
  );
}
