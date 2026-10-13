import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  paymentsService,
  type CheckoutLinkResponse,
  type ProviderName,
} from "../services/payments.service";
import { queryKeys } from "../lib/query-client";

interface CreateCheckoutLinkInput {
  planId: string;
  provider: ProviderName;
}

export function useCreateCheckoutLink() {
  const invalidatePayments = useInvalidatePaymentsQueries();
  return useMutation<CheckoutLinkResponse, Error, CreateCheckoutLinkInput>({
    mutationFn: ({ planId, provider }) =>
      paymentsService.createCheckoutLink(planId, provider),
    onSuccess: () => invalidatePayments(),
  });
}

/**
 * Invalidate every payment-related query (plans, mySubscription)
 * AND the usage panel cache. A successful checkout can change both
 * the plan_key (which affects resolveUsageLimit precedence) and the
 * plan_capabilities set (which determines which rows the panel
 * shows). `useInvalidateUsageQueries` would be redundant here since
 * the usage query key already changes when planKey changes — but we
 * invalidate eagerly so the next mount doesn't show stale data
 * during the brief window before the key-based lookup catches up.
 */
export function useInvalidatePaymentsQueries() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.payments.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.usage.all });
  };
}
