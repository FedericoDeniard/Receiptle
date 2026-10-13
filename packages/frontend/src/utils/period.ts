export type MetricPeriod =
  | { kind: "rolling"; days: 30 | 90 | 365 }
  | { kind: "month"; yearMonth: string };

export interface DateRange {
  startDate: string;
  endDate: string;
  previousStartDate: string;
  previousEndDate: string;
}

export function currentYearMonth(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function isValidYearMonth(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value);
}

// toIsoDate + parseYearMonth are only used internally (inside
// getDateRange / formatMonthLabel) — keep them module-private so the
// public API of this file matches what consumers actually use.
function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseYearMonth(value: string): { year: number; month: number } {
  const [year, month] = value.split("-").map(Number);
  return { year, month };
}

const monthFormatters = new Map<string, Intl.DateTimeFormat>();

function getMonthFormatter(locale: string): Intl.DateTimeFormat {
  let formatter = monthFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      month: "long",
      year: "numeric",
    });
    monthFormatters.set(locale, formatter);
  }
  return formatter;
}

export function formatMonthLabel(yearMonth: string, locale: string): string {
  const { year, month } = parseYearMonth(yearMonth);
  const date = new Date(year, month - 1, 1);
  return getMonthFormatter(locale).format(date);
}

export function getDateRange(
  period: MetricPeriod,
  now: Date = new Date()
): DateRange {
  if (period.kind === "rolling") {
    const end = new Date(now);
    const start = new Date(now.getTime() - period.days * 24 * 60 * 60 * 1000);
    const previousEnd = new Date(start);
    const previousStart = new Date(
      start.getTime() - period.days * 24 * 60 * 60 * 1000
    );
    return {
      startDate: toIsoDate(start),
      endDate: toIsoDate(end),
      previousStartDate: toIsoDate(previousStart),
      previousEndDate: toIsoDate(previousEnd),
    };
  }
  const { year, month } = parseYearMonth(period.yearMonth);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  const previousStart = new Date(year, month - 2, 1);
  const previousEnd = new Date(year, month - 1, 0);
  return {
    startDate: toIsoDate(start),
    endDate: toIsoDate(end),
    previousStartDate: toIsoDate(previousStart),
    previousEndDate: toIsoDate(previousEnd),
  };
}
