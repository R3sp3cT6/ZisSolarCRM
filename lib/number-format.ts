/** Deterministic separators, including browsers without a Macedonian ICU locale.
 * Keeping server and client text identical avoids React hydration recovery. */
export function formatNumber(
  value: number | null | undefined,
  digits = 2,
  language: 'mk' | 'en' = 'mk',
) {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-GB', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
    .formatToParts(value)
    .map((part) =>
      language === 'mk' && part.type === 'decimal'
        ? ','
        : language === 'mk' && part.type === 'group'
          ? '.'
          : part.value,
    )
    .join('');
}
