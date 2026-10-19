/**
 * Decorative data for the hero mock window. It mirrors what the real app
 * renders (subscriptions + transactions) so the landing looks like the
 * product without shipping any of the app code.
 *
 * Relative dates are computed at build time — a rebuild refreshes them.
 */

const DAY_IN_MS = 86_400_000;

export interface MockSubscription {
  merchant: string;
  amount: number;
  currency: string;
  occurrences: number;
  nextOffsetDays: number;
  consistent: boolean;
  status: "active" | "inactive";
  confidence: number;
}

export const SUBSCRIPTIONS_MOCK: MockSubscription[] = [
  {
    merchant: "Netflix",
    amount: 15.99,
    currency: "USD",
    occurrences: 12,
    nextOffsetDays: 5,
    consistent: true,
    status: "active",
    confidence: 95,
  },
  {
    merchant: "Spotify",
    amount: 9.99,
    currency: "USD",
    occurrences: 24,
    nextOffsetDays: 12,
    consistent: true,
    status: "active",
    confidence: 98,
  },
  {
    merchant: "Amazon Web Services",
    amount: 45.2,
    currency: "USD",
    occurrences: 6,
    nextOffsetDays: -2,
    consistent: false,
    status: "inactive",
    confidence: 85,
  },
];

export interface MockTransaction {
  title: string;
  category: string;
  date: string;
  amount: string;
  currency: string;
  amountClass: string;
}

export const TRANSACTIONS_MOCK: MockTransaction[] = [
  {
    title: "Payment to Uber",
    category: "Transport • Uber",
    date: "Today",
    amount: "-$12.40",
    currency: "USD",
    amountClass: "text-rose-600",
  },
  {
    title: "CloudSafe annual plan",
    category: "Services • CloudSafe",
    date: "Feb 28",
    amount: "-$99",
    currency: "USD",
    amountClass: "text-rose-600",
  },
  {
    title: "Salary Deposit",
    category: "Income • Acme Corp",
    date: "Oct 24",
    amount: "+$3,200.00",
    currency: "USD",
    amountClass: "text-emerald-500",
  },
];

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  ARS: "$",
  MXN: "$",
  BRL: "R$",
};

export function formatCurrency(amount: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? "";
  return `${symbol}${amount.toFixed(2)}`;
}

export function formatShortDate(locale: string, offsetDays: number): string {
  const date = new Date(Date.now() + offsetDays * DAY_IN_MS);
  return date.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
  });
}

export function formatNextDate(locale: string, nextOffsetDays: number): string {
  return formatShortDate(locale, nextOffsetDays);
}
