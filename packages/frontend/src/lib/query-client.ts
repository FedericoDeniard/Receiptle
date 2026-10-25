import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { captureError } from "./sentry";

// Convert times to milliseconds
const STALE_TIME = 5 * 60 * 1000; // 5 minutes for transaction data
const CACHE_TIME = 30 * 60 * 1000; // 30 minutes cache time

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      captureError(error, {
        source: "query",
        queryKey: query.queryKey,
        attemptCount: query.state.fetchFailureCount,
      });
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      captureError(error, {
        source: "mutation",
        mutationKey: mutation.options.mutationKey,
      });
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: STALE_TIME,
      gcTime: CACHE_TIME, // renamed from cacheTime in v5
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: (failureCount, error) => {
        // Don't retry on 4xx errors (client errors)
        if (error instanceof Error && "status" in error) {
          const status = (error as { status?: number }).status;
          if (status && status >= 400 && status < 500) {
            return false;
          }
        }
        // Retry up to 3 times for other errors
        return failureCount < 3;
      },
      retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
    mutations: {
      // Mutations don't retry by default, but we can add custom logic if needed
      retry: false,
    },
  },
});

// Query key factories for consistent key structure
export const queryKeys = {
  transactions: {
    all: ["transactions"] as const,
    lists: () => [...queryKeys.transactions.all, "list"] as const,
    list: (filters: Record<string, unknown>) =>
      [...queryKeys.transactions.lists(), filters] as const,
    details: () => [...queryKeys.transactions.all, "detail"] as const,
    detail: (id: string) => [...queryKeys.transactions.details(), id] as const,
  },
  transactionFilters: {
    all: ["transaction-filters"] as const,
    currencies: () =>
      [...queryKeys.transactionFilters.all, "currencies"] as const,
    emails: () => [...queryKeys.transactionFilters.all, "emails"] as const,
  },
  metrics: {
    all: ["metrics"] as const,
    data: (filters: Record<string, unknown>) =>
      [...queryKeys.metrics.all, "data", filters] as const,
  },
  subscriptions: {
    all: ["subscriptions"] as const,
    candidates: (params: Record<string, unknown>) =>
      [...queryKeys.subscriptions.all, "candidates", params] as const,
  },
  gmail: {
    all: ["gmail"] as const,
    status: (userId?: string) =>
      [...queryKeys.gmail.all, "status", userId] as const,
    watches: (userId?: string) =>
      [...queryKeys.gmail.all, "watches", userId] as const,
  },
  dashboard: {
    all: ["dashboard"] as const,
  },
  notifications: {
    all: ["notifications"] as const,
    list: (filters: Record<string, unknown>) =>
      [...queryKeys.notifications.all, "list", filters] as const,
  },
  notificationPreferences: {
    all: ["notification-preferences"] as const,
    list: () => [...queryKeys.notificationPreferences.all, "list"] as const,
  },
  serverConfig: {
    all: ["server-config"] as const,
  },
  chatThreads: {
    all: ["chat-threads"] as const,
    messages: (threadId: string) =>
      ["chat-threads", "messages", threadId] as const,
  },
  transactionAttachments: {
    all: ["transaction-attachments"] as const,
    list: (transactionId: string) =>
      [...queryKeys.transactionAttachments.all, "list", transactionId] as const,
  },
  tags: {
    all: ["tags"] as const,
    list: () => [...queryKeys.tags.all, "list"] as const,
  },
  transactionTags: {
    all: ["transaction-tags"] as const,
    list: (transactionId: string) =>
      [...queryKeys.transactionTags.all, "list", transactionId] as const,
  },
  payments: {
    all: ["payments"] as const,
    plans: () => [...queryKeys.payments.all, "plans"] as const,
    mySubscription: (userId?: string) =>
      [...queryKeys.payments.all, "my-subscription", userId] as const,
  },
  usage: {
    all: ["usage"] as const,
    /**
     * Cache key for the user's current-period usage panel data.
     * The key includes userId, role, and planKey so a subscription
     * change invalidates implicitly (the key changes, TanStack
     * treats it as a fresh query). The service layer reads the
     * latest plan from `useMySubscription` and passes it down.
     */
    list: (userId?: string, role?: string, planKey?: string) =>
      [...queryKeys.usage.all, "list", userId, role, planKey] as const,
  },
  reports: {
    all: ["reports"] as const,
    list: (status: string) =>
      [...queryKeys.reports.all, "list", status] as const,
    detail: (id: string) => [...queryKeys.reports.all, "detail", id] as const,
    transactions: (id: string) =>
      [...queryKeys.reports.detail(id), "transactions"] as const,
  },
  admin: {
    all: ["admin"] as const,
    users: (params: { search?: string; limit: number; offset: number }) =>
      [...queryKeys.admin.all, "users", params] as const,
    userDetail: (userId: string) =>
      [...queryKeys.admin.all, "user-detail", userId] as const,
    subscriptions: (params: {
      status?: string;
      limit: number;
      offset: number;
    }) => [...queryKeys.admin.all, "subscriptions", params] as const,
    paymentEvents: (limit: number) =>
      [...queryKeys.admin.all, "payment-events", limit] as const,
    seeds: (params: { status?: string; limit: number }) =>
      [...queryKeys.admin.all, "seeds", params] as const,
    stats: () => [...queryKeys.admin.all, "stats"] as const,
    revenue: () => [...queryKeys.admin.all, "revenue"] as const,
    usageLimits: () => [...queryKeys.admin.all, "usage-limits"] as const,
    userUsageSummary: (userId: string) =>
      [...queryKeys.admin.all, "user-usage-summary", userId] as const,
    usageTopConsumers: (params: {
      capability: string;
      periodStart: string;
      limit: number;
    }) =>
      [
        ...queryKeys.admin.all,
        "usage-top-consumers",
        params.capability,
        params.periodStart,
        params.limit,
      ] as const,
  },
} as const;
