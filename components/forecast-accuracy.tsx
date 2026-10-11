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
  if (comparison.status === 'unavailable' || !comparison.evaluations?.length)
    return (
      <span className="forecast-match-empty">
        {t('Часовна грешка — WAPE')} <strong>—</strong>
        <small>
          {t(
            comparison.status === 'unavailable'
              ? 'Споредбата моментално не е достапна.'
              : 'Нема споредливи мерења.',
          )}
        </small>
      </span>
    );

  return comparison.evaluations.map((score) => (
    <Popover key={score.kind}>
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
        <PopoverTitle>{t('Споредба со реалното производство')}</PopoverTitle>
        <p>
          {t(
            score.kind === 'backtest'
              ? 'Историска симулација со NOAA/GFS, пресметана накнадно.'
              : 'Првата зачувана прогноза пред почетокот на секој час.',
          )}
        </p>
        <dl>
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
  ));
}
