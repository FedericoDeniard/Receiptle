import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "../lib/supabase";
import { createTransactionsService } from "../services/transactions.service";
import { queryKeys } from "../lib/query-client";

/**
 * Dynamic filter options (currencies + recipient emails).
 *
 * Deliberately NOT suspense: this hook is consumed by page chrome — the
 * transactions filter card and the metrics `FilterBar`. Suspending here
 * threw past the page's own boundaries into the route-level fallback and
 * blanked the whole page (header included) on first paint. Consumers treat
 * the arrays as empty until the queries resolve.
 */
export function useTransactionFilters() {
  const { data: currencies, refetch: refetchCurrencies } = useQuery({
    queryKey: queryKeys.transactionFilters.currencies(),
    queryFn: async () => {
      const supabase = await getSupabase();
      const service = createTransactionsService(supabase);
      return await service.getAvailableCurrencies();
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const { data: emails, refetch: refetchEmails } = useQuery({
    queryKey: queryKeys.transactionFilters.emails(),
    queryFn: async () => {
      const supabase = await getSupabase();
      const service = createTransactionsService(supabase);
      return await service.getAvailableEmails();
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  return {
    currencies: currencies ?? [],
    emails: emails ?? [],
    refetch: () => {
      void refetchCurrencies();
      void refetchEmails();
    },
  };
}
