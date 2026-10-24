export const getCurrencySymbol = (currency: string): string => {
  const symbols: Record<string, string> = {
    USD: "$",
    EUR: "€",
    GBP: "£",
    JPY: "¥",
    CNY: "¥",
    INR: "₹",
    AUD: "A$",
    CAD: "C$",
    CHF: "CHF",
    SEK: "kr",
    NOK: "kr",
    DKK: "kr",
    PLN: "zł",
    CZK: "Kč",
    HUF: "Ft",
    RON: "lei",
    BGN: "лв",
    HRK: "kn",
    RUB: "₽",
    TRY: "₺",
    MXN: "$",
    ARS: "$",
    CLP: "$",
    COP: "$",
    PEN: "S/",
    UYU: "$",
    BOB: "Bs",
    PYG: "₲",
    ILS: "₪",
    KRW: "₩",
    THB: "฿",
    VND: "₫",
    IDR: "Rp",
    MYR: "RM",
    PHP: "₱",
    SGD: "S$",
    HKD: "HK$",
    NZD: "NZ$",
    ZAR: "R",
    NGN: "₦",
    GHS: "₵",
    KES: "KSh",
    EGP: "E£",
    MAD: "DH",
    TND: "DT",
    DZD: "DA",
    LBP: "ل.ل",
    JOD: "JD",
    IQD: "ع.د",
    BHD: "BD",
    KWD: "KD",
    QAR: "QR",
    SAR: "SR",
    AED: "DH",
    OMR: "RO",
  };

  return symbols[currency] || currency + " ";
};

export const formatCurrency = (amount: number, currency: string): string => {
  const symbol = getCurrencySymbol(currency);
  return `${symbol}${amount.toFixed(2)}`;
};

const currencyCodeFormatters = new Map<string, Intl.NumberFormat>();

/**
 * Formats an amount with its ISO currency code (e.g. "ARS 15,000.00"),
 * localized to `locale`. Formatters are cached per (locale, currency)
 * because constructing `Intl.NumberFormat` is expensive.
 */
export const formatCurrencyCode = (
  amount: number,
  currency: string,
  locale?: string
): string => {
  const key = `${locale ?? ""}:${currency}`;
  let formatter = currencyCodeFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "code",
    });
    currencyCodeFormatters.set(key, formatter);
  }
  return formatter.format(amount);
};
