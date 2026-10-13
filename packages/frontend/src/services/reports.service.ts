import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.types";
import type {
  Report,
  ReportCurrencySummary,
  ReportInsert,
  ReportStatus,
  ReportSummary,
  ReportTransactionListItem,
} from "../types/reports";

interface RpcSummaryRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  date_range_start: string | null;
  date_range_end: string | null;
  status: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  currency: string;
  transaction_count: number;
  total_income: number;
  total_expenses: number;
}

function mapReportRow(row: {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  date_range_start: string | null;
  date_range_end: string | null;
  status: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}): Report {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description,
    dateRangeStart: row.date_range_start,
    dateRangeEnd: row.date_range_end,
    status: row.status === "archived" ? "archived" : "active",
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function groupRowsByReport(rows: RpcSummaryRow[]): ReportSummary[] {
  const byId = new Map<string, ReportSummary>();

  for (const row of rows) {
    const count = Number(row.transaction_count ?? 0);
    const existing = byId.get(row.id);
    const base = mapReportRow(row);

    if (!existing) {
      byId.set(row.id, {
        ...base,
        perCurrency: [],
        totalCount: 0,
      });
    }

    // The RPC LEFT JOINs transactions so a report with zero transactions
    // still yields one row with `currency = null`. Skip those phantom rows
    // but DO keep the report entry (a report appears in the list even
    // when empty, with "0 transactions" in the footer).
    if (count === 0 || !row.currency) {
      continue;
    }

    const target = byId.get(row.id)!;
    const perCurrency: ReportCurrencySummary = {
      currency: row.currency,
      transactionCount: count,
      totalIncome: Number(row.total_income ?? 0),
      totalExpenses: Number(row.total_expenses ?? 0),
      net: Number(row.total_income ?? 0) - Number(row.total_expenses ?? 0),
    };
    target.perCurrency.push(perCurrency);
    target.totalCount += count;
  }

  return Array.from(byId.values());
}

class ReportsService {
  constructor(private supabase: SupabaseClient<Database>) {}

  async listReports(status: ReportStatus): Promise<ReportSummary[]> {
    const { data, error } = await this.supabase.rpc("get_report_summaries", {
      p_status: status,
    });

    if (error) {
      throw new Error(`Failed to load reports: ${error.message}`);
    }

    return groupRowsByReport((data ?? []) as unknown as RpcSummaryRow[]);
  }

  async getReportById(id: string): Promise<ReportSummary | null> {
    const [summaries, archived] = await Promise.all([
      this.listReports("active"),
      this.listReports("archived"),
    ]);
    const all = [...summaries, ...archived];
    return all.find(r => r.id === id) ?? null;
  }

  async createReport(
    input: Omit<ReportInsert, "user_id" | "status" | "archived_at">
  ): Promise<Report> {
    const {
      data: { user },
    } = await this.supabase.auth.getUser();
    if (!user?.id) {
      throw new Error("User not authenticated");
    }

    const { data, error } = await this.supabase
      .from("reports")
      .insert({
        title: input.title.trim(),
        description: input.description ?? null,
        date_range_start: input.date_range_start ?? null,
        date_range_end: input.date_range_end ?? null,
        user_id: user.id,
      })
      .select("*")
      .single();

    if (error) {
      throw new Error(`Failed to create report: ${error.message}`);
    }

    return mapReportRow(data);
  }

  async updateReport(
    id: string,
    updates: Partial<Omit<ReportInsert, "user_id">>
  ): Promise<Report> {
    const patch: Record<string, unknown> = {};
    if (updates.title !== undefined) patch.title = updates.title.trim();
    if (updates.description !== undefined)
      patch.description = updates.description;
    if (updates.date_range_start !== undefined)
      patch.date_range_start = updates.date_range_start;
    if (updates.date_range_end !== undefined)
      patch.date_range_end = updates.date_range_end;

    const { data, error } = await this.supabase
      .from("reports")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      throw new Error(`Failed to update report: ${error.message}`);
    }

    return mapReportRow(data);
  }

  async archiveReport(id: string): Promise<Report> {
    const { data, error } = await this.supabase
      .from("reports")
      .update({ status: "archived", archived_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      throw new Error(`Failed to archive report: ${error.message}`);
    }

    return mapReportRow(data);
  }

  async unarchiveReport(id: string): Promise<Report> {
    const { data, error } = await this.supabase
      .from("reports")
      .update({ status: "active", archived_at: null })
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      throw new Error(`Failed to restore report: ${error.message}`);
    }

    return mapReportRow(data);
  }

  async deleteReport(id: string): Promise<void> {
    const { error } = await this.supabase.from("reports").delete().eq("id", id);

    if (error) {
      throw new Error(`Failed to delete report: ${error.message}`);
    }
  }

  async getTransactionsForReport(
    reportId: string,
    pagination?: { from: number; to: number }
  ): Promise<{ items: ReportTransactionListItem[]; total: number }> {
    let query = this.supabase
      .from("transactions")
      .select(
        "id, name, merchant, amount, currency, transaction_type, transaction_date, category",
        { count: "exact" }
      )
      .eq("report_id", reportId)
      .eq("discarded", false);

    if (pagination) {
      query = query.range(pagination.from, pagination.to);
    }

    const { data, error, count } = await query.order("transaction_date", {
      ascending: false,
    });

    if (error) {
      throw new Error(`Failed to load report transactions: ${error.message}`);
    }

    const items: ReportTransactionListItem[] = (
      (data ?? []) as Array<Record<string, unknown>>
    ).map(row => ({
      id: String(row.id),
      name: String(row.name ?? ""),
      merchant: String(row.merchant ?? ""),
      amount: Number(row.amount ?? 0),
      currency: String(row.currency ?? "USD"),
      transactionType: String(row.transaction_type ?? ""),
      transactionDate: String(row.transaction_date ?? ""),
      category: String(row.category ?? ""),
    }));

    return { items, total: count ?? 0 };
  }

  async assignTransactionToReport(
    transactionId: string,
    reportId: string | null
  ): Promise<void> {
    const { error } = await this.supabase
      .from("transactions")
      .update({ report_id: reportId })
      .eq("id", transactionId);

    if (error) {
      throw new Error(
        `Failed to assign transaction to report: ${error.message}`
      );
    }
  }

  async assignTransactionsToReport(
    transactionIds: string[],
    reportId: string | null
  ): Promise<void> {
    if (transactionIds.length === 0) return;

    const { error } = await this.supabase
      .from("transactions")
      .update({ report_id: reportId })
      .in("id", transactionIds);

    if (error) {
      throw new Error(
        `Failed to bulk-assign transactions to report: ${error.message}`
      );
    }
  }

  /**
   * Triggers a server-side PDF render of a report. The Edge Function
   * enforces the `report_pdf_export` capability and a per-period
   * usage counter; errors propagate as `Error.message` so the hook's
   * `classifyEdgeFunctionError` can route 403/429 to the right toast.
   *
   * `responseType: "blob"` is the supabase-js 2.45+ way of asking for
   * a raw binary response (the default is JSON parsing). The Edge
   * Function responds with `Content-Type: application/pdf` and the
   * hook uses this Blob to trigger a download.
   */
  async exportReportPdf(reportId: string, locale: "en" | "es"): Promise<Blob> {
    const { data, error } = await this.supabase.functions.invoke<Blob>(
      `export-report-pdf?reportId=${encodeURIComponent(
        reportId
      )}&lang=${locale}`,
      { method: "GET", responseType: "blob" }
    );
    if (error) {
      // Error messages follow the same "Requires capability: X" /
      // "Usage limit exceeded: X" prefixes the frontend classifier
      // already understands.
      throw error;
    }
    if (!(data instanceof Blob)) {
      throw new Error(
        "Failed to export PDF: edge function did not return a Blob"
      );
    }
    return data;
  }
}

export function createReportsService(supabase: SupabaseClient<Database>) {
  return new ReportsService(supabase);
}
