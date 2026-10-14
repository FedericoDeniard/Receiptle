import { z } from "zod";

const VALID_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "CNY",
  "INR",
  "AUD",
  "CAD",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
  "HUF",
  "RON",
  "BGN",
  "HRK",
  "RUB",
  "TRY",
  "MXN",
  "ARS",
  "CLP",
  "COP",
  "PEN",
  "UYU",
  "BOB",
  "PYG",
  "ILS",
  "KRW",
  "THB",
  "VND",
  "IDR",
  "MYR",
  "PHP",
  "SGD",
  "HKD",
  "NZD",
  "ZAR",
  "NGN",
  "GHS",
  "KES",
  "EGP",
  "MAD",
  "TND",
  "DZD",
  "LBP",
  "JOD",
  "IQD",
  "BHD",
  "KWD",
  "QAR",
  "SAR",
  "AED",
  "OMR",
] as const;

export const TransactionSchema = z.object({
  amount: z.number().describe("The monetary amount of the transaction"),
  currency: z
    .enum(VALID_CURRENCIES)
    .describe(
      'Currency code (e.g., USD, ARS, EUR, GBP, JPY). Use only the 3-letter ISO 4217 currency code, NOT symbols like "$" or "US$".'
    ),
  type: z.enum(["income", "expense"]).describe("Type of transaction"),
  name: z
    .string()
    .describe(
      'Short title for the transaction, e.g. "June 2026 salary" or "Coffee at Starbucks". Used as the headline in the list. Keep it concise (under ~60 characters).'
    ),
  description: z
    .string()
    .describe("Longer description of what the transaction is for"),
  date: z
    .string()
    .nullable()
    .optional()
    .describe("Date of the transaction in YYYY-MM-DD format if mentioned"),
  merchant: z.string().describe("Merchant or source of the transaction"),
  category: z
    .enum([
      "salary",
      "entertainment",
      "investment",
      "food",
      "transport",
      "services",
      "health",
      "education",
      "housing",
      "clothing",
      "taxes",
      "other",
    ])
    .describe("Category of the transaction"),
});

export const TransactionResponseSchema = z.discriminatedUnion(
  "hasTransaction",
  [
    z.object({
      hasTransaction: z.literal(true),
      data: TransactionSchema,
    }),
    z.object({
      hasTransaction: z.literal(false),
      reason: z.string(),
    }),
  ]
);

export type TransactionResponse = z.infer<typeof TransactionResponseSchema>;
