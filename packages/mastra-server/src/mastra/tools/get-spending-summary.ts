import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { supabaseFromToken } from "../../lib/supabase-from-token";

const PRESET_VALUES = [
  "this_month",
  "last_month",
  "this_year",
  "last_30_days",
  "last_90_days",
  "last_365_days",
] as const;

const GROUP_BY_VALUES = ["category", "merchant", "month"] as const;

const DEFAULT_TIMEZONE = "UTC";

/**
 * Returns the local Y/M/D for `now` in the given IANA timezone. Falls back
 * to UTC when the timezone is missing or invalid. Mirrors the approach in
 * get-current-date.ts so calendar presets ("this month", "this year") are
 * resolved in the user's local time, not server UTC.
 */
function localYMD(
  timezone: string | undefined,
  now: Date = new Date()
): { year: number; month: number; day: number; ymd: string } {
  const tz = timezone ?? DEFAULT_TIMEZONE;
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = dtf.formatToParts(now);
    const map = new Map<string, string>();
    for (const p of parts) {
      if (p.type !== "literal") map.set(p.type, p.value);
    }
    const year = Number(map.get("year") ?? "1970");
    const month = Number(map.get("month") ?? "01") - 1;
    const day = Number(map.get("day") ?? "01");
    return {
      year,
      month,
      day,
      ymd: `${map.get("year") ?? "1970"}-${map.get("month") ?? "01"}-${
        map.get("day") ?? "01"
      }`,
    };
  } catch {
    return {
      year: now.getUTCFullYear(),
      month: now.getUTCMonth(),
      day: now.getUTCDate(),
      ymd: now.toISOString().slice(0, 10),
    };
  }
}

function ymdFrom(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(
    2,
    "0"
  )}`;
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function resolveRange(
  preset: (typeof PRESET_VALUES)[number] | undefined,
  from: string | undefined,
  to: string | undefined,
  timezone: string | undefined,
  now: Date = new Date()
): { rangeFrom: string; rangeTo: string } {
  if (from && to) {
    return { rangeFrom: from, rangeTo: to };
  }
  const { year, month, ymd: todayYmd } = localYMD(timezone, now);
  if (from) {
    return { rangeFrom: from, rangeTo: todayYmd };
  }
  if (to) {
    return { rangeFrom: "1970-01-01", rangeTo: to };
  }

  switch (preset) {
    case "this_month":
      return {
        rangeFrom: ymdFrom(year, month, 1),
        rangeTo: ymdFrom(year, month, lastDayOfMonth(year, month)),
      };
    case "last_month": {
      const lm = month - 1;
      const lmYear = lm < 0 ? year - 1 : year;
      const lmNorm = lm < 0 ? 11 : lm;
      return {
        rangeFrom: ymdFrom(lmYear, lmNorm, 1),
        rangeTo: ymdFrom(lmYear, lmNorm, lastDayOfMonth(lmYear, lmNorm)),
      };
    }
    case "this_year":
      return {
        rangeFrom: ymdFrom(year, 0, 1),
        rangeTo: ymdFrom(year, 11, 31),
      };
    case "last_30_days":
      return { rangeFrom: addDays(todayYmd, -29), rangeTo: todayYmd };
    case "last_90_days":
      return { rangeFrom: addDays(todayYmd, -89), rangeTo: todayYmd };
    case "last_365_days":
      return { rangeFrom: addDays(todayYmd, -364), rangeTo: todayYmd };
    default:
      return { rangeFrom: "1970-01-01", rangeTo: todayYmd };
  }
}

interface RawRow {
  transaction_type: string;
  amount: number;
  category: string | null;
  merchant: string | null;
  transaction_date: string;
}

interface Group {
  label: string;
  income: number;
  expense: number;
  net: number;
  count: number;
}

function groupLabel(
  row: RawRow,
  groupBy: (typeof GROUP_BY_VALUES)[number]
): string {
  switch (groupBy) {
    case "category":
      return row.category ?? "uncategorized";
    case "merchant":
      return row.merchant?.trim() || "unknown";
    case "month":
      return row.transaction_date.slice(0, 7);
  }
}

export const getSpendingSummaryTool = createTool({
  id: "get-spending-summary",
  description:
    "Get an aggregated financial summary for a time range: total income, total expense, net balance, transaction count, and a breakdown grouped by category, merchant, or month. Use this whenever the user asks about totals, sums, how much they spent or earned, spending breakdown, top categories, or any aggregate question (e.g. 'how much did I spend this month', 'my top spending categories', 'total income this year'). This is much more reliable than listing transactions and doing math yourself. The agent does not reliably know today's date, so prefer the 'preset' field for relative ranges ('this_month', 'last_month', 'this_year', 'last_30_days', 'last_90_days', 'last_365_days'). Use explicit 'from'/'to' only when the user names exact dates.",
  inputSchema: z
    .object({
      preset: z
        .enum(PRESET_VALUES)
        .optional()
        .describe(
          "Predefined range resolved server-side. Use for relative questions like 'this month', 'last month', 'this year', 'last 30/90/365 days'."
        ),
      from: z
        .string()
        .date()
        .optional()
        .describe(
          "Start date YYYY-MM-DD inclusive. Overrides preset. Use only when the user gives an exact start date."
        ),
      to: z
        .string()
        .date()
        .optional()
        .describe(
          "End date YYYY-MM-DD inclusive. Overrides preset. Use only when the user gives an exact end date."
        ),
      currency: z
        .string()
        .length(3)
        .toUpperCase()
        .optional()
        .describe("ISO 4217 currency code. Omit to sum across all currencies."),
      group_by: z
        .enum(GROUP_BY_VALUES)
        .default("category")
        .describe(
          "How to group the breakdown. 'category' (default), 'merchant', or 'month' (YYYY-MM)."
        ),
      report_ids: z
        .array(z.string().uuid())
        .min(1)
        .max(50)
        .optional()
        .describe(
          "Optional list of 1-50 report UUIDs. Restricts the summary to transactions whose `report_id` matches one of these reports. Resolve report UUIDs first by calling listReportsTool. Mutually exclusive with `without_report`."
        ),
      without_report: z
        .boolean()
        .optional()
        .describe(
          "When true, restricts the summary to transactions that are not assigned to any report (report_id is null). Mutually exclusive with `report_ids`."
        ),
    })
    .refine(d => !(d.report_ids && d.without_report), {
      message:
        "report_ids and without_report are mutually exclusive; pass only one.",
      path: ["report_ids"],
    }),
  outputSchema: z.object({
    rangeFrom: z.string(),
    rangeTo: z.string(),
    currency: z.string().nullable(),
    groupBy: z.string(),
    totalIncome: z.number(),
    totalExpense: z.number(),
    netBalance: z.number(),
    transactionCount: z.number().int().nonnegative(),
    groups: z.array(
      z.object({
        label: z.string(),
        income: z.number(),
        expense: z.number(),
        net: z.number(),
        count: z.number().int().nonnegative(),
      })
    ),
    topExpenseGroup: z.string().nullable(),
    topIncomeGroup: z.string().nullable(),
  }),
  requestContextSchema: z.object({
    userId: z.string(),
    supabaseToken: z.string(),
    userTimezone: z.string().optional(),
  }),
  execute: async (input, ctx) => {
    const { supabaseToken, userTimezone } = ctx.requestContext!.all;
    const supabase = supabaseFromToken(supabaseToken);

    const { rangeFrom, rangeTo } = resolveRange(
      input.preset,
      input.from,
      input.to,
      userTimezone
    );
    const groupBy = input.group_by;

    // Fetch only the columns needed for aggregation, paginated to avoid
    // Supabase's default 1000-row cap. Matches the frontend's
    // useMetricsData approach (fetch all pages, aggregate client-side).
    const rows: RawRow[] = [];
    const pageSize = 1000;
    let offset = 0;
    let page: RawRow[] = [];

    do {
      let q = supabase
        .from("transactions")
        .select(
          "transaction_type, amount, category, merchant, transaction_date"
        )
        .eq("discarded", false)
        .gte("transaction_date", rangeFrom)
        .lte("transaction_date", rangeTo)
        .order("transaction_date", { ascending: true })
        .range(offset, offset + pageSize - 1);

      if (input.currency) q = q.eq("currency", input.currency);
      if (input.report_ids && input.report_ids.length > 0) {
        q = q.in("report_id", input.report_ids);
      } else if (input.without_report) {
        q = q.is("report_id", null);
      }

      const { data, error } = await q;
      if (error) {
        throw new Error(
          `Failed to fetch transactions for summary: ${error.message}`
        );
      }

      page = (data ?? []) as unknown as RawRow[];
      rows.push(...page);
      offset += pageSize;
    } while (page.length === pageSize);

    let totalIncome = 0;
    let totalExpense = 0;
    let topExpenseGroup: string | null = null;
    let topExpenseAmount = -Infinity;
    let topIncomeGroup: string | null = null;
    let topIncomeAmount = -Infinity;

    const groupsMap = new Map<string, Group>();

    for (const row of rows) {
      const amount = Number(row.amount) || 0;
      const type = row.transaction_type;
      const isIncome = type === "income";
      const label = groupLabel(row, groupBy);

      let group = groupsMap.get(label);
      if (!group) {
        group = {
          label,
          income: 0,
          expense: 0,
          net: 0,
          count: 0,
        };
        groupsMap.set(label, group);
      }

      if (isIncome) {
        totalIncome += amount;
        group.income += amount;
        if (group.income > topIncomeAmount) {
          topIncomeAmount = group.income;
          topIncomeGroup = label;
        }
      } else {
        totalExpense += amount;
        group.expense += amount;
        if (group.expense > topExpenseAmount) {
          topExpenseAmount = group.expense;
          topExpenseGroup = label;
        }
      }

      group.net = group.income - group.expense;
      group.count += 1;
    }

    if (topExpenseAmount === -Infinity) topExpenseGroup = null;
    if (topIncomeAmount === -Infinity) topIncomeGroup = null;

    // Sort groups by total activity (income + expense) descending so the
    // most relevant groups come first.
    const groups = Array.from(groupsMap.values()).sort(
      (a, b) => b.income + b.expense - (a.income + a.expense)
    );

    return {
      rangeFrom,
      rangeTo,
      currency: input.currency ?? null,
      groupBy,
      totalIncome,
      totalExpense,
      netBalance: totalIncome - totalExpense,
      transactionCount: rows.length,
      groups,
      topExpenseGroup,
      topIncomeGroup,
    };
  },
});
