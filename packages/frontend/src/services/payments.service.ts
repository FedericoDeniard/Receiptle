import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.types";
import { getSupabase } from "../lib/supabase";
import { isActiveSubscriptionStatus } from "../lib/subscription-status";
import { getConfig } from "../config";

type PlanRow = Database["payments"]["Tables"]["plans"]["Row"];
type PlanProviderVariantRow =
  Database["payments"]["Tables"]["plan_provider_variants"]["Row"];
type SubscriptionRow = Database["payments"]["Tables"]["subscriptions"]["Row"];

export type ProviderName = Database["payments"]["Enums"]["provider_name"];

export interface PlanWithVariants extends PlanRow {
  plan_provider_variants: PlanProviderVariantRow[];
}

export interface MySubscription extends Omit<SubscriptionRow, "access_until"> {
  plan: PlanRow | null;
  // added by 20261024144828_add_subscription_access_until. `Omit` keeps this
  // override valid once the generated types are refreshed with
  // `bun run docker:db:types` (the column becomes required there).
  access_until?: string | null;
}

export interface CheckoutLinkResponse {
  providerPlanId: string;
  initPoint: string;
  status: string;
  mode: string;
  planId: string;
}

async function getEdgeFunctionsUrl(): Promise<string> {
  const config = await getConfig();
  return `${config.supabase.url.replace(/\/+$/, "")}/functions/v1`;
}

async function getUserAccessToken(
  supabase: SupabaseClient<Database>
): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("No active session");
  }
  return session.access_token;
}

export const paymentsService = {
  async getAvailablePlans(): Promise<PlanWithVariants[]> {
    const supabase = await getSupabase();
    const { data, error } = await supabase
      .schema("payments")
      .from("plans")
      .select("*, plan_provider_variants(*)")
      .eq("is_active", true)
      .order("display_name", { ascending: true });

    if (error) {
      throw error;
    }

    return (data ?? []) as PlanWithVariants[];
  },

  async getMySubscription(userId: string): Promise<MySubscription | null> {
    const supabase = await getSupabase();
    const { data, error } = await supabase
      .schema("payments")
      .from("subscriptions")
      .select("*, plan:plans(*)")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });

    if (error) {
      throw error;
    }

    const rows = (data ?? []) as MySubscription[];
    // the current plan is the most recent entitled row. an expired
    // pending_cancellation row must not shadow a newer active
    // subscription (expiring it bumps its updated_at).
    return (
      rows.find(row => isActiveSubscriptionStatus(row.status)) ??
      rows[0] ??
      null
    );
  },

  async createCheckoutLink(
    planId: string,
    provider: ProviderName
  ): Promise<CheckoutLinkResponse> {
    const [supabase, edgeFunctionsUrl, config] = await Promise.all([
      getSupabase(),
      getEdgeFunctionsUrl(),
      getConfig(),
    ]);
    const accessToken = await getUserAccessToken(supabase);

    const response = await fetch(`${edgeFunctionsUrl}/create-subscription`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        apikey: config.supabase.anonKey,
      },
      body: JSON.stringify({
        plan_id: planId,
        provider,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to create checkout link");
    }
    const payload = await response.json();
    return payload as CheckoutLinkResponse;
  },

  async cancelMySubscription(): Promise<{
    status: string;
    accessUntil?: string | null;
  }> {
    const [supabase, edgeFunctionsUrl, config] = await Promise.all([
      getSupabase(),
      getEdgeFunctionsUrl(),
      getConfig(),
    ]);
    const accessToken = await getUserAccessToken(supabase);

    const response = await fetch(`${edgeFunctionsUrl}/cancel-subscription`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        apikey: config.supabase.anonKey,
      },
    });

    if (!response.ok) {
      throw new Error("Failed to cancel subscription");
    }
    const payload = await response.json();
    return payload;
  },
};
