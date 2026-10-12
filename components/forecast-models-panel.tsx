'use client';
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useLanguage } from './language-switch';
import { getLanguage } from '@/lib/language';
import { formatNumber } from '@/lib/number-format';
import type { ModelsView, ModelKey } from '@/lib/forecast-multimodel';
const l = (mk: string, en: string) => (getLanguage() === 'en' ? en : mk);
const n = (value: number | null, d = 2) =>
  formatNumber(value, d, getLanguage());
const time = (value: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Skopje',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
export function ForecastModelsPanel({ canManage }: { canManage: boolean }) {
  useLanguage();
  const [view, setView] = useState<ModelsView | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    fetch('/api/forecast-models', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((v) => {
        if (alive) setView(v);
      })
      .catch(() => {
        if (alive)
          setError(
            l(
              'Споредбата моментално не е достапна.',
              'Comparison is currently unavailable.',
            ),
          );
      });
    return () => {
      alive = false;
    };
  }, []);
  async function refresh() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/forecast-models', {
        method: canManage ? 'POST' : 'GET',
        cache: 'no-store',
      });
      if (!response.ok) throw Error();
      setView(await response.json());
    } catch {
      setError(
        l(
          'Преземањето не успеа. Претходната споредба е зачувана.',
          'Collection failed. The previous comparison is retained.',
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  const names: Record<ModelKey, string> = {
    icon: 'ICON-EU',
    gfs: 'GFS',
    arpege: 'ARPEGE Europe',
    mean: l('Просек на трите', 'Three-model mean'),
    median: l('Медијана на трите', 'Three-model median'),
    learned: l('Научена комбинација', 'Learned blend'),
  };
  const keys: ModelKey[] = [
    'icon',
    'gfs',
    'arpege',
    'mean',
    'median',
    ...(view?.selection.weights ? ['learned' as const] : []),
  ];
  const total = (key: ModelKey) =>
    view?.hours.length && view.hours.every((h) => h.values[key] !== null)
      ? view.hours.reduce((s, h) => s + h.values[key]!, 0) / 1000
      : null;
  return (
    <section className="panel forecast-trial forecast-models" aria-busy={busy}>
      <div className="forecast-toolbar">
        <div>
          <h2>
            {l('Споредба на временските модели', 'Weather model comparison')}
          </h2>
          <p>
            {l(
              'Пробни прогнози за ден однапред · вистински часовни извори',
              'Day-ahead challengers · native hourly sources',
            )}
          </p>
        </div>
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() => void refresh()}
        >
          <RefreshCw size={16} className={busy ? 'spinning' : ''} />
          {busy
            ? l('Се презема…', 'Collecting…')
            : canManage
              ? l('Освежи модели', 'Refresh models')
              : l('Освежи приказ', 'Refresh view')}
        </button>
      </div>
      {error && (
        <p role="alert" className="form-feedback error">
          {error}
        </p>
      )}
      {view ? (
        <>
          <p className="forecast-fine">
            {l('За', 'For')} <strong>{view.date}</strong> ·{' '}
            {l('Зачувано', 'Saved')} {time(view.issuedAt)}
          </p>
          <table
            className="model-comparison-table"
            aria-label={l(
              'Прогнози и измерена часовна грешка',
              'Forecasts and measured hourly error',
            )}
          >
            <thead>
              <tr className="model-comparison-row model-comparison-head">
                <th scope="col">{l('Модел', 'Model')}</th>
                <th scope="col">MWh</th>
                <th scope="col">WAPE ↓</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => {
                const source =
                    key in view.sources
                      ? view.sources[key as keyof typeof view.sources]
                      : null,
                  score = view.scores[key];
                return (
                  <tr className="model-comparison-row" key={key}>
                    <td>
                      <strong>{names[key]}</strong>
                      {source && (
                        <small>
                          {source.status === 'ready' && source.runAt
                            ? `${l('Циклус', 'Run')} ${time(source.runAt)}`
                            : l('Изворот е недостапен', 'Source unavailable')}
                        </small>
                      )}
                      {source?.retainedAfterFailure && source.fetchedAt && (
                        <small>
                          {l(
                            'Освежувањето не успеа · користиме зачувана прогноза од',
                            'Refresh failed · using forecast fetched',
                          )}{' '}
                          {time(source.fetchedAt)}
                        </small>
                      )}
                    </td>
                    <td>
                      <strong>{n(total(key), 3)}</strong>
                    </td>
                    <td>
                      <strong>
                        {score.wape === null ? '—' : n(score.wape, 1) + '%'}
                      </strong>
                      <small>
                        {score.hours} {l('споредени часа', 'matched hours')}
                      </small>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {view.siteLearning && (
            <div className="forecast-site-learning">
              <h3>
                {l(
                  'Нов модел за одзивот на централата',
                  'New plant-response model',
                )}
              </h3>
              <p className="forecast-fine">
                {l(
                  'Учи од часовното зрачење и измереното производство на ЗИС Солар.',
                  'Learns from hourly irradiance and measured ZIS Solar production.',
                )}{' '}
                {view.siteLearning.trainingDays}{' '}
                {l('дена за обука', 'training days')} ·{' '}
                {view.siteLearning.method === 'catboost'
                  ? 'CatBoost'
                  : view.siteLearning.method === 'ridge'
                    ? 'Ridge'
                    : l('Временски аналози', 'Weather analogues')}
              </p>
              <table
                className="model-comparison-table"
                aria-label={l(
                  'Нов модел спореден со v3.2',
                  'New model compared with v3.2',
                )}
              >
                <thead>
                  <tr className="model-comparison-row model-comparison-head">
                    <th scope="col">{l('Модел', 'Model')}</th>
                    <th scope="col">MWh</th>
                    <th scope="col">WAPE ↓</th>
                  </tr>
                </thead>
                <tbody>
                  {(['candidate', 'baseline'] as const).map((key) => {
                    const trial = view.siteLearning!;
                    const field =
                      key === 'candidate' ? 'productionKwh' : 'baselineKwh';
                    const complete =
                      trial.hours.length > 0 &&
                      trial.hours.every(
                        (h) => h[field] !== null && Number.isFinite(h[field]),
                      );
                    const total = complete
                      ? trial.hours.reduce((s, h) => s + h[field]!, 0) / 1000
                      : null;
                    const wape =
                      key === 'candidate'
                        ? trial.score.candidateWape
                        : trial.score.baselineWape;
                    return (
                      <tr className="model-comparison-row" key={key}>
                        <td>
                          <strong>
                            {key === 'candidate'
                              ? l(
                                  'Локално научен модел · проба',
                                  'Site-trained model · trial',
                                )
                              : 'v3.2'}
                          </strong>
                        </td>
                        <td>
                          <strong>{n(total, 3)}</strong>
                        </td>
                        <td>
                          <strong>
                            {wape === null ? '—' : n(wape, 1) + '%'}
                          </strong>
                          <small>
                            {trial.score.hours}{' '}
                            {l('исти споредени часа', 'same matched hours')}
                          </small>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="forecast-fine">
                {l(
                  'Историскиот тест сè уште не покажа подобра вкупна точност.',
                  'Historical testing has not yet shown better overall accuracy.',
                )}{' '}
                {view.siteLearning.status === 'model-unavailable'
                  ? l(
                      'Пробниот модел треба повторно да се обучи. Официјалната прогноза продолжува да работи.',
                      'The trial model needs retraining. The official forecast continues to run.',
                    )
                  : view.siteLearning.status === 'source-unavailable'
                    ? l(
                        'Се чека целосна часовна GFS прогноза. Новата проба ќе се зачува со постојното освежување.',
                        'Waiting for a complete hourly GFS forecast. The new trial will be saved by the existing refresh schedule.',
                      )
                    : l(
                        'Ова е однапред зачувана проба. Грешката ќе се појави кога ќе пристигнат вистинските мерења.',
                        'This trial was saved before observations. Error is shown once actual measurements arrive.',
                      )}{' '}
                {l(
                  'Оценката е одделна од историските симулации.',
                  'Scoring is separate from historical simulations.',
                )}
              </p>
            </div>
          )}
          <p className="forecast-fine">
            {l(
              'MWh е прогнозата за датумот прикажан погоре. WAPE е грешката на претходните однапред зачувани прогнози, за исти измерени часови. Помал процент е подобро.',
              'MWh is the forecast for the date shown above. WAPE measures earlier forecasts saved before observations, over the same measured hours. Lower is better.',
            )}
          </p>
          <p>
            {view.selection.status === 'collecting'
              ? l(
                  `Собираме резултати: ${view.selection.days}/28 дена и ${view.selection.hours} споредени часа. Тежините сè уште не се избрани.`,
                  `Collecting results: ${view.selection.days}/28 days and ${view.selection.hours} matched hours. Weights have not been selected yet.`,
                )
              : view.selection.status === 'not-better'
                ? l(
                    'Научената комбинација не го помина тестот против најдобриот поединечен модел.',
                    'The learned blend did not pass validation against the strongest individual model.',
                  )
                : l(
                    'Комбинацијата ја помина историската проверка и сега се тестира на нови денови.',
                    'The blend passed historical validation and is now being tested on new days.',
                  )}
          </p>
          {!view.complete && (
            <p className="forecast-fine">
              {l(
                'Недостига еден извор. Комбинираната прогноза се прескокнува за оваа проба.',
                'One source is missing. The combined forecast is skipped for this trial.',
              )}
            </p>
          )}
        </>
      ) : (
        <p>
          {l(
            'Првата споредба ќе се зачува при освежување на моделите.',
            'The first comparison will be saved when the models refresh.',
          )}
        </p>
      )}
      <p className="forecast-fine">
        {l(
          'Официјалната прогноза останува v3.2. Изворите се преземаат со постојното освежување и се споделуваат преку кеш.',
          'The official forecast remains v3.2. Sources are collected with the existing refresh schedule and shared through cache.',
        )}{' '}
        <a
          href="https://www.data.gouv.fr/datasets/paquets-arpege-resolution-0-1deg"
          target="_blank"
          rel="noreferrer"
        >
          Météo-France · Open Licence 2.0
        </a>
      </p>
    </section>
  );
}
