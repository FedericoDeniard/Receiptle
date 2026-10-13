/**
 * Admin service layer.
 *
 * Every method here calls a SECURITY DEFINER RPC in the `payments` schema.
 * Each RPC starts with an admin guard that confirms the caller has
 * `role = 'admin'` in `public.user_roles`; non-admin callers receive
 * 42501 (insufficient_privilege). The frontend surfaces this as a 401
 * from postgrest and the admin routes redirect non-admins to /dashboard
 * at the route layer (defense in depth).
 *
 * All methods return `null` (or empty arrays) on RPC error and log with
 * the `[admin-rpc]` prefix, matching the convention in
 * `lib/payments-rpc.ts`. The admin panel calls `invalidateQueries` on
 * mutation success; read queries refetch via TanStack Query's normal
 * lifecycle.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.types";
import { getSupabase } from "../lib/supabase";

type DbClient = SupabaseClient<Database>;
type Capability = Database["payments"]["Enums"]["capability"];
type AppRole = Database["public"]["Enums"]["app_role"];

export interface AdminUserRow {
  user_id: string;
  email: string | null;
  name: string | null;
  created_at: string;
  role: AppRole | null;
  active_plan_key: string | null;
  sub_status: string | null;
  sub_updated_at: string | null;
}

export interface AdminUserDetail extends AdminUserRow {
  has_gmail: boolean;
}

export interface AdminSubscriptionRow {
  subscription_id: string;
  user_id: string | null;
  user_email: string | null;
  provider: Database["payments"]["Enums"]["provider_name"];
  provider_subscription_id: string;
  status: string;
  plan_key: string | null;
  transaction_amount: number | null;
  currency_id: string | null;
  updated_at: string | null;
}

export interface AdminPaymentEventRow {
  id: number;
  received_at: string | null;
  topic: string;
  action: string | null;
  provider: Database["payments"]["Enums"]["provider_name"];
  provider_subscription_id: string | null;
  payment_id: number;
  user_id: string | null;
  user_email: string | null;
  signature_valid: boolean | null;
  processing_status: string;
  processing_error: string | null;
}

export interface AdminSeedRow {
  id: string;
  user_id: string;
  user_email: string | null;
  user_oauth_token_id: string;
  gmail_email: string | null;
  status: string;
  total_emails: number | null;
  transactions_found: number | null;
  total_skipped: number | null;
  emails_processed_by_ai: number | null;
  last_processed_index: number | null;
  error_message: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface AdminStats {
  mrr: Array<{
    provider: Database["payments"]["Enums"]["provider_name"];
    currency: string;
    mrr_amount: number;
    subs: number;
  }>;
  active_subscriptions: number;
  churn_30d_pct: number;
  cancelled_30d: number;
  generated_at: string;
}

export interface AdminUsageLimitRow {
  capability: Capability;
  scope_kind: Database["payments"]["Enums"]["usage_scope_kind"];
  scope_value: string | null;
  period: Database["payments"]["Enums"]["usage_period"];
  max_count: number;
  affected_users: number;
}

export interface AdminUserUsageSummaryRow {
  capability: Capability;
  period: Database["payments"]["Enums"]["usage_period"];
  resolved_limit: number;
  current_count: number;
  scope_kind: string;
  scope_value: string | null;
}

export interface AdminTopConsumerRow {
  user_id: string;
  user_email: string | null;
  count: number;
}

async function rpc<T>(
  name: string,
  args: Record<string, unknown>
): Promise<T | null> {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .schema("payments")
    .rpc(name as never, args as never);
  if (error) {
    console.error(`[admin-rpc] ${name} failed:`, error);
    return null;
  }
  return data as T;
}

export const adminService = {
  listUsers(params: {
    search?: string;
    limit: number;
    offset: number;
  }): Promise<AdminUserRow[] | null> {
    return rpc<AdminUserRow[]>("admin_list_users", {
      p_search: params.search ?? null,
      p_limit: params.limit,
      p_offset: params.offset,
    });
  },

  countUsers(search?: string): Promise<number | null> {
    return rpc<number>("admin_count_users", { p_search: search ?? null });
  },

  getUser(userId: string): Promise<AdminUserDetail[] | null> {
    return rpc<AdminUserDetail[]>("admin_get_user", { p_user_id: userId });
  },

  setUserRole(userId: string, role: AppRole): Promise<null> {
    return rpc<null>("admin_set_user_role", {
      p_user_id: userId,
      p_role: role,
    });
  },

  listSubscriptions(params: {
    status?: string;
    limit: number;
    offset: number;
  }): Promise<AdminSubscriptionRow[] | null> {
    return rpc<AdminSubscriptionRow[]>("admin_list_subscriptions", {
      p_status: params.status ?? null,
      p_limit: params.limit,
      p_offset: params.offset,
    });
  },

  countSubscriptions(status?: string): Promise<number | null> {
    return rpc<number>("admin_count_subscriptions", {
      p_status: status ?? null,
    });
  },

  cancelSubscription(
    userId: string,
    targetStatus:
      | "cancelled"
      | "paused"
      | "pending_cancellation" = "pending_cancellation"
  ): Promise<string | null> {
    return rpc<string>("admin_cancel_subscription", {
      p_user_id: userId,
      p_target_status: targetStatus,
    });
  },

  listPaymentEvents(
    limit: number,
    offset: number
  ): Promise<AdminPaymentEventRow[] | null> {
    return rpc<AdminPaymentEventRow[]>("admin_list_payment_events", {
      p_limit: limit,
      p_offset: offset,
    });
  },

  countPaymentEvents(): Promise<number | null> {
    return rpc<number>("admin_count_payment_events", {});
  },

  listSeeds(params: {
    status?: string;
    limit: number;
    offset: number;
  }): Promise<AdminSeedRow[] | null> {
    return rpc<AdminSeedRow[]>("admin_list_seeds", {
      p_status: params.status ?? null,
      p_limit: params.limit,
      p_offset: params.offset,
    });
  },

  countSeeds(status?: string): Promise<number | null> {
    return rpc<number>("admin_count_seeds", { p_status: status ?? null });
  },

  retrySeed(seedId: string): Promise<
    | {
        seed_id: string;
        connection_id: string;
        user_id: string;
      }[]
    | null
  > {
    return rpc<{ seed_id: string; connection_id: string; user_id: string }[]>(
      "admin_retry_seed",
      { p_seed_id: seedId }
    );
  },

  getStats(): Promise<AdminStats | null> {
    return rpc<AdminStats>("admin_stats", {});
  },

  listUsageLimits(): Promise<AdminUsageLimitRow[] | null> {
    return rpc<AdminUsageLimitRow[]>("admin_usage_limits", {});
  },

  getUserUsageSummary(
    userId: string
  ): Promise<AdminUserUsageSummaryRow[] | null> {
    return rpc<AdminUserUsageSummaryRow[]>("admin_user_usage_summary", {
      p_user_id: userId,
    });
  },

  getUsageTopConsumers(params: {
    capability: Capability;
    periodStart: string;
    limit: number;
  }): Promise<AdminTopConsumerRow[] | null> {
    return rpc<AdminTopConsumerRow[]>("admin_usage_top_consumers", {
      p_capability: params.capability,
      p_period_start: params.periodStart,
      p_limit: params.limit,
    });
  },
};

// Re-export the type so the rest of the app doesn't have to import it from
// database.types.ts just to cast the role enum.
export type { AppRole, Capability };

// Internal helper kept for tests; production callers should go through
// adminService.* so the schema("payments") wrapper isn't duplicated.
async function adminRpcRaw<T>(
  name: string,
  args: Record<string, unknown>,
  client?: DbClient
): Promise<T | null> {
  const c = client ?? (await getSupabase());
  const { data, error } = await c
    .schema("payments")
    .rpc(name as never, args as never);
  if (error) {
    console.error(`[admin-rpc] ${name} failed:`, error);
    return null;
  }
  return data as T;
}
