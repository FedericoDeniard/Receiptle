import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { getSupabase } from "../lib/supabase";
import { captureError } from "../lib/sentry";
import { toast } from "sonner";
import { formatCurrency } from "../utils/currency";
import type { Transaction } from "../services/transactions.service";
import { useAuth } from "./useAuth";
import { getTransactionType } from "../utils/transactionUtils";
import { queryKeys } from "../lib/query-client";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.types";

export function useTransactionsRealtime() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const channelRef = useRef<RealtimeChannel | null>(null);
  const supabaseRef = useRef<SupabaseClient<Database> | null>(null);

  useEffect(() => {
    getSupabase().then(supabase => {
      supabaseRef.current = supabase;
    });
  }, []);

  // oxlint-disable-next-line react-doctor/effect-needs-cleanup
  useEffect(() => {
    let subscription: RealtimeChannel | null = null;

    if (channelRef.current && supabaseRef.current) {
      supabaseRef.current.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    if (user && supabaseRef.current) {
      const supabase = supabaseRef.current;

      const channel = supabase.channel(`transactions:${user.id}`, {
        config: { private: true },
      });

      channel
        .on(
          "broadcast",
          { event: "INSERT" },
          ({ payload }: { payload: { record: Transaction } }) => {
            const newTransaction = payload.record;

            queryClient.invalidateQueries({
              queryKey: queryKeys.transactions.all,
            });
            queryClient.invalidateQueries({ queryKey: queryKeys.metrics.all });

            const isIncome =
              newTransaction.transaction_type === "income" ||
              newTransaction.transaction_type === "ingreso";
            const { sign } = getTransactionType(
              newTransaction.transaction_type
            );
            const title = isIncome
              ? t("transactions.newIncomeReceived")
              : t("transactions.newExpenseReceived");

            toast.custom(
              id => (
                <button
                  type="button"
                  className="w-full rounded-xl shadow-lg border p-4 flex items-center gap-4 cursor-pointer hover:shadow-xl transition-shadow relative overflow-hidden group text-left appearance-none"
                  style={{
                    backgroundColor: "var(--bg-primary)",
                    borderColor: "var(--bg-secondary)",
                  }}
                  onClick={() => {
                    navigate(`/transactions?id=${newTransaction.id}`);
                    toast.dismiss(id);
                  }}
                >
                  <div
                    className="absolute left-0 top-0 bottom-0 w-1"
                    style={{
                      backgroundColor: isIncome
                        ? "var(--success)"
                        : "var(--error)",
                    }}
                  />
                  <div
                    className="p-2 rounded-full"
                    style={{
                      backgroundColor: isIncome
                        ? "rgba(16, 185, 129, 0.1)"
                        : "rgba(239, 68, 68, 0.1)",
                      color: isIncome ? "var(--success)" : "var(--error)",
                    }}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                    </svg>
                  </div>

                  <div className="flex-1 min-w-0">
                    <h4
                      className="font-semibold truncate"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {title}
                    </h4>
                    <p
                      className="text-sm truncate"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {newTransaction.merchant || newTransaction.name}
                    </p>
                  </div>

                  <div className="text-right">
                    <span
                      className="font-bold block"
                      style={{
                        color: isIncome ? "var(--success)" : "var(--error)",
                      }}
                    >
                      {sign}
                      {formatCurrency(
                        newTransaction.amount,
                        newTransaction.currency
                      )}
                    </span>
                    <span
                      className="text-xs"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {newTransaction.currency}
                    </span>
                  </div>
                </button>
              ),
              {
                duration: 5000,
              }
            );
          }
        )
        .subscribe((status, err) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            captureError(err ?? new Error(`Realtime channel ${status}`), {
              source: "realtime",
              fingerprint: ["realtime", status],
            });
          }
        });

      subscription = channel;
      channelRef.current = subscription;
    }

    return () => {
      subscription?.unsubscribe();
      channelRef.current = null;
    };
  }, [t, user, queryClient, navigate]);
}
