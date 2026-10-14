import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { getSupabase } from "../lib/supabase";
import { createReportsService } from "../services/reports.service";
import { queryKeys } from "../lib/query-client";
import type {
  Report,
  ReportCurrencySummary,
  ReportSummary,
} from "../types/reports";

interface ReportFormInput {
  title: string;
  description?: string | null;
  dateRangeStart?: string | null;
  dateRangeEnd?: string | null;
}

interface ReportUpdateInput {
  title?: string;
  description?: string | null;
  dateRangeStart?: string | null;
  dateRangeEnd?: string | null;
}

interface AssignTransactionInput {
  transactionId: string;
  reportId: string | null;
}

interface AssignTransactionsInput {
  transactionIds: string[];
  reportId: string | null;
}

interface UseReportMutationsReturn {
  createReport: (input: ReportFormInput) => Promise<Report>;
  updateReport: (id: string, input: ReportUpdateInput) => Promise<Report>;
  archiveReport: (id: string) => Promise<Report>;
  unarchiveReport: (id: string) => Promise<Report>;
  deleteReport: (id: string) => Promise<string>;
  assignTransactionToReport: (input: AssignTransactionInput) => Promise<void>;
  assignTransactionsToReport: (input: AssignTransactionsInput) => Promise<void>;
  isCreating: boolean;
  isUpdating: boolean;
  isArchiving: boolean;
  isDeleting: boolean;
  isAssigning: boolean;
}

export function useReportMutations(): UseReportMutationsReturn {
  const queryClient = useQueryClient();

  const invalidateReportsAndTransactions = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all });
  };

  const createMutation = useMutation({
    mutationFn: async (input: ReportFormInput) => {
      const supabase = await getSupabase();
      return createReportsService(supabase).createReport({
        title: input.title,
        description: input.description ?? null,
        date_range_start: input.dateRangeStart ?? null,
        date_range_end: input.dateRangeEnd ?? null,
      });
    },
    onSuccess: invalidateReportsAndTransactions,
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id: string;
      input: ReportUpdateInput;
    }) => {
      const supabase = await getSupabase();
      return createReportsService(supabase).updateReport(id, {
        title: input.title,
        description: input.description ?? null,
        date_range_start: input.dateRangeStart ?? null,
        date_range_end: input.dateRangeEnd ?? null,
      });
    },
    onSuccess: invalidateReportsAndTransactions,
  });

  const archiveMutation = useMutation({
    mutationFn: async (id: string) => {
      const supabase = await getSupabase();
      return createReportsService(supabase).archiveReport(id);
    },
    onSuccess: invalidateReportsAndTransactions,
  });

  const unarchiveMutation = useMutation({
    mutationFn: async (id: string) => {
      const supabase = await getSupabase();
      return createReportsService(supabase).unarchiveReport(id);
    },
    onSuccess: invalidateReportsAndTransactions,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const supabase = await getSupabase();
      await createReportsService(supabase).deleteReport(id);
      return id;
    },
    onSuccess: invalidateReportsAndTransactions,
  });

  const assignSingle = useMutation({
    mutationFn: async ({ transactionId, reportId }: AssignTransactionInput) => {
      const supabase = await getSupabase();
      await createReportsService(supabase).assignTransactionToReport(
        transactionId,
        reportId
      );
    },
    onMutate: async ({ transactionId, reportId }) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.transactions.all,
      });
      await queryClient.cancelQueries({
        queryKey: queryKeys.reports.all,
      });

      const txSnapshots = queryClient.getQueriesData({
        queryKey: queryKeys.transactions.all,
      });
      const reportsSnapshots = queryClient.getQueriesData({
        queryKey: queryKeys.reports.all,
      });

      queryClient.setQueriesData<unknown>(
        { queryKey: queryKeys.transactions.all },
        (old: unknown) => {
          if (!old || typeof old !== "object") return old;
          return injectReportIdIntoCache(
            old as Record<string, unknown>,
            transactionId,
            reportId
          );
        }
      );

      const oldReportId = snapshotTransactionReportId(
        queryClient,
        transactionId
      );
      moveReportCount({
        queryClient,
        transactionId,
        fromReportId:
          oldReportId && oldReportId !== reportId ? oldReportId : null,
        toReportId: reportId,
      });

      return { txSnapshots, reportsSnapshots };
    },
    onError: (_err, _input, context) => {
      if (!context) return;
      if (context.txSnapshots) {
        for (const [key, value] of context.txSnapshots) {
          queryClient.setQueryData(key, value);
        }
      }
      if (context.reportsSnapshots) {
        for (const [key, value] of context.reportsSnapshots) {
          queryClient.setQueryData(key, value);
        }
      }
    },
    onSuccess: invalidateReportsAndTransactions,
  });

  const assignBulk = useMutation({
    mutationFn: async ({
      transactionIds,
      reportId,
    }: AssignTransactionsInput) => {
      const supabase = await getSupabase();
      await createReportsService(supabase).assignTransactionsToReport(
        transactionIds,
        reportId
      );
    },
    onSuccess: invalidateReportsAndTransactions,
  });

  return {
    createReport: createMutation.mutateAsync,
    updateReport: (id, input) => updateMutation.mutateAsync({ id, input }),
    archiveReport: archiveMutation.mutateAsync,
    unarchiveReport: unarchiveMutation.mutateAsync,
    deleteReport: deleteMutation.mutateAsync,
    assignTransactionToReport: assignSingle.mutateAsync,
    assignTransactionsToReport: assignBulk.mutateAsync,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isArchiving: archiveMutation.isPending || unarchiveMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isAssigning: assignSingle.isPending || assignBulk.isPending,
  };
}

// ─── Cache helpers ───────────────────────────────────────────────────────────

function injectReportIdIntoCache(
  old: Record<string, unknown>,
  transactionId: string,
  reportId: string | null
): Record<string, unknown> {
  const pages = old.pages;
  if (!Array.isArray(pages)) return old;

  return {
    ...old,
    pages: pages.map((page): Record<string, unknown> => {
      if (!page || typeof page !== "object") {
        return page as Record<string, unknown>;
      }
      const transactions = (page as { transactions?: unknown }).transactions;
      if (!Array.isArray(transactions)) {
        return page as Record<string, unknown>;
      }

      return {
        ...(page as Record<string, unknown>),
        transactions: transactions.map((t: unknown) => {
          if (
            !t ||
            typeof t !== "object" ||
            (t as { id?: unknown }).id !== transactionId
          ) {
            return t;
          }
          return {
            ...(t as Record<string, unknown>),
            // snake_case to match the PostgREST shape and what consumers
            // (TransactionDetail, ReportSelector) read.
            report_id: reportId,
          };
        }),
      };
    }),
  };
}

// Walks the transactions cache to find the current `report_id` of a
// transaction before it gets reassigned, so we can decrement the right
// bucket in the reports cache.
function snapshotTransactionReportId(
  queryClient: QueryClient,
  transactionId: string
): string | null {
  const entries = queryClient.getQueryCache().getAll();
  for (const entry of entries) {
    const key = entry.queryKey;
    if (key[0] !== "transactions") continue;
    const data = entry.state.data;
    if (!data || typeof data !== "object") continue;
    const pages = (data as { pages?: unknown }).pages;
    if (!Array.isArray(pages)) continue;
    for (const page of pages) {
      const txs = (page as { transactions?: unknown }).transactions;
      if (!Array.isArray(txs)) continue;
      for (const t of txs) {
        if (
          t &&
          typeof t === "object" &&
          (t as { id?: string }).id === transactionId
        ) {
          const reportId = (t as { report_id?: unknown }).report_id;
          return typeof reportId === "string" ? reportId : null;
        }
      }
    }
  }
  return null;
}

// Decrements the perCurrency totals on the source report (if any) and
// increments them on the destination report. Mirrors the RPC shape so
// the UI keeps rendering with consistent numbers until the onSuccess
// refetch lands.
function moveReportCount({
  queryClient,
  transactionId,
  fromReportId,
  toReportId,
}: {
  queryClient: QueryClient;
  transactionId: string;
  fromReportId: string | null;
  toReportId: string | null;
}) {
  if (fromReportId === toReportId) return;
  const tx = lookupTransactionInCache(queryClient, transactionId);
  if (!tx) return;

  const currency = typeof tx.currency === "string" ? tx.currency : null;
  if (!currency) return;

  const amount = Number(tx.amount ?? 0);
  const isIncome =
    tx.transaction_type === "income" || tx.transaction_type === "ingreso";

  queryClient.setQueriesData<unknown>(
    { queryKey: queryKeys.reports.all },
    (old: unknown) => {
      if (!Array.isArray(old)) return old;
      return old.map(entry =>
        shiftReportSummary(entry, {
          fromReportId,
          toReportId,
          currency,
          amount,
          isIncome,
        })
      );
    }
  );
}

function lookupTransactionInCache(
  queryClient: QueryClient,
  transactionId: string
): Record<string, unknown> | null {
  const entries = queryClient.getQueryCache().getAll();
  for (const entry of entries) {
    const key = entry.queryKey;
    if (key[0] !== "transactions") continue;
    const data = entry.state.data;
    if (!data || typeof data !== "object") continue;
    const pages = (data as { pages?: unknown }).pages;
    if (!Array.isArray(pages)) continue;
    for (const page of pages) {
      const txs = (page as { transactions?: unknown }).transactions;
      if (!Array.isArray(txs)) continue;
      for (const t of txs) {
        if (
          t &&
          typeof t === "object" &&
          (t as { id?: string }).id === transactionId
        ) {
          return t as Record<string, unknown>;
        }
      }
    }
  }
  return null;
}

function shiftReportSummary(
  entry: unknown,
  args: {
    fromReportId: string | null;
    toReportId: string | null;
    currency: string;
    amount: number;
    isIncome: boolean;
  }
): ReportSummary | unknown {
  if (
    !entry ||
    typeof entry !== "object" ||
    !("id" in entry) ||
    typeof (entry as { id: unknown }).id !== "string"
  ) {
    return entry;
  }
  const summary = entry as ReportSummary;
  if (summary.id !== args.fromReportId && summary.id !== args.toReportId) {
    return entry;
  }

  const direction = summary.id === args.toReportId ? 1 : -1;
  const sign = direction;

  const bucketExists = summary.perCurrency.some(
    b => b.currency === args.currency
  );

  let perCurrency = summary.perCurrency.map(b => {
    if (b.currency !== args.currency) return b;
    return {
      currency: b.currency,
      transactionCount: Math.max(0, b.transactionCount + sign),
      totalIncome: b.totalIncome + (args.isIncome ? sign * args.amount : 0),
      totalExpenses: b.totalExpenses + (args.isIncome ? 0 : sign * args.amount),
      net: b.net + sign * (args.isIncome ? args.amount : -args.amount),
    } as ReportCurrencySummary;
  });

  if (summary.id === args.toReportId && !bucketExists) {
    perCurrency = [
      ...perCurrency,
      {
        currency: args.currency,
        transactionCount: 1,
        totalIncome: args.isIncome ? args.amount : 0,
        totalExpenses: args.isIncome ? 0 : args.amount,
        net: args.isIncome ? args.amount : -args.amount,
      } as ReportCurrencySummary,
    ];
  }

  return {
    ...summary,
    perCurrency,
    totalCount: Math.max(0, summary.totalCount + sign),
  } as ReportSummary;
}
