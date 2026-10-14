import type { Database } from "./database.types";

export type ReportInsert = Database["public"]["Tables"]["reports"]["Insert"];

export type ReportStatus = "active" | "archived";

export interface Report {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  dateRangeStart: string | null;
  dateRangeEnd: string | null;
  status: ReportStatus;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportCurrencySummary {
  currency: string;
  transactionCount: number;
  totalIncome: number;
  totalExpenses: number;
  net: number;
}

export interface ReportSummary extends Report {
  perCurrency: ReportCurrencySummary[];
  totalCount: number;
}

export interface ReportTransactionListItem {
  id: string;
  name: string;
  merchant: string;
  amount: number;
  currency: string;
  transactionType: string;
  transactionDate: string;
  category: string;
}
