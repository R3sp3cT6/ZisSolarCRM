import {getLocale} from './language';
const energyFormat = () => new Intl.NumberFormat(getLocale(), {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const csvFormat = new Intl.NumberFormat('en-US', {
  useGrouping: false,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const csvNumber = (value: number | null) => value === null ? '' : csvFormat.format(value);

export function toMwh(kwh: number | null | undefined) {
  return kwh == null ? null : kwh / 1000;
}

export function formatMwh(kwh: number | null | undefined) {
  const mwh = toMwh(kwh);
  return mwh === null ? '—' : energyFormat().format(mwh);
}

type ReportRow = {
  start: string;
  productionKwh: number | null;
  exportKwh: number | null;
  memo: number | null;
  sale: number | null;
  revenue: number | null;
  estimate: number | null;
  priceFetchedAt: string | null;
};

export function energyReportCsv(rows: ReportRow[], contractVersion: string) {
  const header = 'start_utc,production_mwh,export_mwh,memo_eur_mwh,sale_eur_mwh,revenue_eur,estimate_eur,contract_version,price_fetched_at';
  return [header, ...rows.map(row => [
    row.start, csvNumber(toMwh(row.productionKwh)), csvNumber(toMwh(row.exportKwh)),
    csvNumber(row.memo), csvNumber(row.sale), row.revenue, row.estimate, contractVersion, row.priceFetchedAt,
  ].map(value => value ?? '').join(','))].join('\n');
}
