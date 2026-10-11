export type ContractTerms = {
  version: string;
  effectiveFrom: string | null;
  share: number;
  fixedEurMwh: number;
};

// These are the release defaults; persisted schedules use the same immutable versions.
export const LEGACY_CONTRACT: ContractTerms = {
  version: 'excerpt-10A-94pct-2.2',
  effectiveFrom: null,
  share: 0.94,
  fixedEurMwh: 2.2,
};
export const OCTOBER_CONTRACT: ContractTerms = {
  version: 'excerpt-10A-20261001-94pct-2.5',
  effectiveFrom: '2026-10-01',
  share: 0.94,
  fixedEurMwh: 2.5,
};
export const CONTRACT_SCHEDULE: readonly ContractTerms[] = [
  LEGACY_CONTRACT,
  OCTOBER_CONTRACT,
];
const deliveryDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Skopje',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function contractFor(
  delivery: string,
  contracts: readonly ContractTerms[] = CONTRACT_SCHEDULE,
): ContractTerms {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(delivery)
    ? delivery
    : deliveryDate.format(new Date(delivery));
  const contract = contracts
    .filter((c) => c.effectiveFrom === null || c.effectiveFrom <= date)
    .sort((a, b) =>
      (b.effectiveFrom ?? '').localeCompare(a.effectiveFrom ?? ''),
    )[0];
  if (!contract) throw Error('No contract for delivery date');
  return contract;
}

export function contractScheduleVersion(contracts: readonly ContractTerms[]) {
  return [...contracts]
    .sort((a, b) =>
      (a.effectiveFrom ?? '').localeCompare(b.effectiveFrom ?? ''),
    )
    .map((c) => c.version)
    .join('|');
}
