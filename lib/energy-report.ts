const energyFormat = new Intl.NumberFormat('mk-MK', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 5,
});

export function toMwh(kwh: number | null | undefined) {
  return kwh == null ? null : kwh / 1000;
}

export function formatMwh(kwh: number | null | undefined) {
  const mwh = toMwh(kwh);
  return mwh === null ? '—' : energyFormat.format(mwh);
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
    row.start, toMwh(row.productionKwh), toMwh(row.exportKwh),
    row.memo, row.sale, row.revenue, row.estimate, contractVersion, row.priceFetchedAt,
  ].map(value => value ?? '').join(','))].join('\n');
}
