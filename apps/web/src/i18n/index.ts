import { useIntl } from 'react-intl';
import en from './en.json';
import de from './de.json';

export const SUPPORTED_LOCALES = ['en', 'de'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const catalogs = { en, de };
export function initialLocale(): Locale {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem('sp-locale');
  } catch {
    /* Storage is optional for shell preferences. */
  }
  return saved === 'en' || saved === 'de'
    ? saved
    : navigator.languages.some((locale) => locale.startsWith('de'))
      ? 'de'
      : 'en';
}
export function useT() {
  const intl = useIntl();
  // Argument checking belongs to the generated per-ID map at this boundary;
  // React Intl's registered-ID generic overload cannot express this tuple.
  const format = intl.formatMessage as unknown as (
    descriptor: { id: keyof MessageArguments },
    values?: Record<string, string | number | Date>,
  ) => string;
  return <ID extends keyof MessageArguments>(
    id: ID,
    ...args: keyof MessageArguments[ID] extends never
      ? [values?: undefined]
      : [values: MessageArguments[ID]]
  ) => format({ id }, args[0]);
}
