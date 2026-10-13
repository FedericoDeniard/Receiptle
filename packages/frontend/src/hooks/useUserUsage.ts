/**
 * Hook layer for the usage panel.
 *
 * Wraps `usageService.listForUser` in a TanStack Query. The query
 * key includes userId, role, and planKey so that a subscription
 * change (which can flip the role override from `default` to `plan:foo`)
 * implicitly invalidates by producing a different key.
 *
 * `staleTime: 0` and `refetchOnMount: "always"` keep the panel
 * accurate without polling — every mount of the Settings page
 * fetches fresh data. The 30-day refetch interval that the ticket
 * mentions as "unnecessary" is omitted entirely.
 */
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./useAuth";
import { useMySubscription } from "./useMySubscription";
import { usageService, type UsageRow } from "../services/usage.service";
import { queryKeys } from "../lib/query-client";

interface UseUserUsageReturn {
  rows: UsageRow[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
  hasActivePlan: boolean;
}

export function useUserUsage(): UseUserUsageReturn {
  const { user, role } = useAuth();
  const userId = user?.id;
  // Always call the hook (rules of hooks); the service skips when
  // userId is undefined.
  const subscriptionQuery = useMySubscription(userId);
  const planKey = subscriptionQuery.data?.plan?.plan_key ?? null;
  const hasActivePlan = planKey !== null;

  const query = useQuery<UsageRow[]>({
    queryKey: queryKeys.usage.list(
      userId,
      role ?? undefined,
      planKey ?? undefined
    ),
    queryFn: () =>
      usageService.listForUser({
        userId: userId ?? "",
        role: role ?? null,
        planKey,
        subscription: subscriptionQuery.data ?? null,
      }),
    enabled: !!userId,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  return {
    rows: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: () => {
      void query.refetch();
    },
    hasActivePlan,
  };
}
