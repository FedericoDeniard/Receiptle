import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.types";
import { getSupabase } from "../lib/supabase";
import { getConfig } from "../config";

type PlanRow = Database["payments"]["Tables"]["plans"]["Row"];
type PlanProviderVariantRow =
  Database["payments"]["Tables"]["plan_provider_variants"]["Row"];
type SubscriptionRow = Database["payments"]["Tables"]["subscriptions"]["Row"];

export type ProviderName = Database["payments"]["Enums"]["provider_name"];

export interface PlanWithVariants extends PlanRow {
  plan_provider_variants: PlanProviderVariantRow[];
}

export interface MySubscription extends SubscriptionRow {
  plan: PlanRow | null;
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
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return (data ?? null) as MySubscription | null;
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

  async cancelMySubscription(): Promise<{ status: string }> {
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
