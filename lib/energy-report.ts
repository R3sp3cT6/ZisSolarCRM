import {getLocale} from './language';
import {convertMoney,getCurrency} from './currency';
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
  partial?: boolean;
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
  const header = `start_utc,production_mwh,export_mwh,memo_${getCurrency().toLowerCase()}_mwh,sale_${getCurrency().toLowerCase()}_mwh,revenue_${getCurrency().toLowerCase()},estimate_${getCurrency().toLowerCase()},contract_version,price_fetched_at`;
  // Exports are the archive: an unfinished live counter difference is not a
  // complete hourly measurement and must not later be re-imported as one.
  return [header, ...rows.filter(row=>!row.partial).map(row => [
    row.start, csvNumber(toMwh(row.productionKwh)), csvNumber(toMwh(row.exportKwh)),
    csvNumber(convertMoney(row.memo)), csvNumber(convertMoney(row.sale)), convertMoney(row.revenue), convertMoney(row.estimate), contractVersion, row.priceFetchedAt,
  ].map(value => value ?? '').join(','))].join('\n');
}
