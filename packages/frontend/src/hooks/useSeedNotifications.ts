import { useEffect } from "react";
import { getSupabase } from "../lib/supabase";
import { toast } from "../utils/toast";
import { useTranslation } from "react-i18next";

interface Seed {
  id: string;
  user_id: string;
  user_oauth_token_id: string;
  status: "pending" | "completed" | "failed";
  error_message?: string;
  total_emails?: number;
  transactions_found?: number;
  total_skipped?: number;
  emails_processed_by_ai?: number;
  created_at: string;
  updated_at: string;
}

export function useSeedNotifications(userId: string | undefined) {
  const { t } = useTranslation();

  // oxlint-disable-next-line react-doctor/effect-needs-cleanup
  useEffect(() => {
    if (!userId) return;

    let channel: ReturnType<Awaited<ReturnType<typeof getSupabase>>["channel"]>;

    const setupRealtimeSubscription = async () => {
      const supabase = await getSupabase();

      channel = supabase
        .channel("seed-updates")
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "seeds",
            filter: `user_id=eq.${userId}`,
          },
          payload => {
            const newSeed = payload.new as Seed;
            const oldSeed = payload.old as Seed;

            // Only notify if status changed
            if (newSeed.status !== oldSeed.status) {
              if (newSeed.status === "completed") {
                const transactionsFound = newSeed.transactions_found || 0;
                const totalEmails = newSeed.total_emails || 0;
                const totalSkipped = newSeed.total_skipped || 0;

                if (transactionsFound > 0) {
                  // Found new transactions
                  toast.success(
                    t("settings.seedCompletedWithTransactions", {
                      count: transactionsFound,
                    }) ||
                      `¡Importación completada! Se ${transactionsFound === 1 ? "encontró" : "encontraron"} ${transactionsFound} ${transactionsFound === 1 ? "transacción nueva" : "transacciones nuevas"}.`,
                    t("settings.seedCompletedDescription") ||
                      "Revisa tus transacciones para ver los nuevos movimientos."
                  );
                } else if (totalEmails === totalSkipped) {
                  // All emails were already processed
                  toast.info(
                    t("settings.seedCompletedNoNew") ||
                      "¡Importación completada!",
                    t("settings.seedCompletedAllProcessed", {
                      count: totalEmails,
                    }) ||
                      `Se revisaron ${totalEmails} correos pero todos ya habían sido procesados anteriormente.`
                  );
                } else {
                  // No transactions found in new emails
                  toast.info(
                    t("settings.seedCompletedNoTransactions") ||
                      "Importación completada.",
                    t("settings.seedCompletedNoTransactionsDescription", {
                      count: totalEmails,
                    }) ||
                      `Se analizaron ${totalEmails} correos pero no se encontraron transacciones nuevas.`
                  );
                }
              } else if (newSeed.status === "failed") {
                toast.error(
                  t("settings.seedFailedError") || "La importación falló.",
                  newSeed.error_message ||
                    t("settings.seedFailedDescription") ||
                    "Hubo un error al procesar los correos. Intenta de nuevo."
                );
              }
            }
          }
        )
        .subscribe();
    };

    setupRealtimeSubscription();

    // Cleanup
    return () => {
      if (channel) {
        channel.unsubscribe();
      }
    };
  }, [userId, t]);
}
