import { useMutation, useQueryClient } from "@tanstack/react-query";
import { paymentsService } from "../services/payments.service";
import { queryKeys } from "../lib/query-client";

export function useCancelSubscription() {
  const queryClient = useQueryClient();
  return useMutation<
    { status: string; accessUntil?: string | null },
    Error,
    void
  >({
    mutationFn: () => paymentsService.cancelMySubscription(),
    onSuccess: () => {
      // After cancellation, the active plan can disappear (or move
      // to `pending_cancellation` which still counts as active but
      // is time-bounded). Either way the scope resolution for usage
      // limits can flip, so we invalidate both caches.
      queryClient.invalidateQueries({ queryKey: queryKeys.payments.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.usage.all });
    },
  });
}
