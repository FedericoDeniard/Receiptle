/**
 * Formats an ISO timestamp as a localized short date+time string.
 * Falls back to the raw string if the input is missing or unparseable
 * — admin pages should never crash on a bad timestamp.
 *
 * The `locale` defaults to the runtime's default (usually the browser
 * locale) when omitted. Components that want the active i18n language
 * should pass `i18n.language` from `useTranslation`.
 */
export function formatDateSafe(
  value: string | null | undefined,
  locale?: string
): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(locale, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Formats an ISO timestamp as a localized date without the time part.
 * Same fallback contract as formatDateSafe: missing values render as an
 * em dash and unparseable input is returned verbatim.
 */
export function formatDateOnly(
  value: string | null | undefined,
  locale?: string
): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

const monthYearFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * Formats a `YYYY-MM` month key as a short localized month + 2-digit year
 * (e.g. "oct 26"). Formatters are cached per locale.
 */
export function formatMonthShort(month: string, locale?: string): string {
  const key = locale ?? "";
  let formatter = monthYearFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      month: "short",
      year: "2-digit",
      timeZone: "UTC",
    });
    monthYearFormatters.set(key, formatter);
  }
  return formatter.format(new Date(`${month}-01T00:00:00Z`));
}
