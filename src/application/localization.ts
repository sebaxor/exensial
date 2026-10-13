/** A runtime localization entry. Keys address stable API/UI metadata, not source code. */
export interface LocalizationEntry {
  locale: string;
  key: string;
  value: string;
}

export function localizedValue(entries: LocalizationEntry[], locale: string, key: string, fallback?: Record<string, string>): string | undefined {
  return entries.find((entry) => entry.locale === locale && entry.key === key)?.value
    ?? fallback?.[locale]
    ?? fallback?.en
    ?? Object.values(fallback ?? {})[0];
}
