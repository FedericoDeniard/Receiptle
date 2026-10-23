// Repository layer for seed-emails: pure Supabase queries.
// No business logic, no error handling, no notifications — just data access.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { decryptTokenRow } from "../../lib/seed-shared/oauth-token-crypto";
import { requireSecretKey } from "../../lib/supabase-keys";
import type { ConnectionRow, SeedRow } from "./seed-emails.types";

export function createServiceClient(): SupabaseClient {
  return createClient(process.env.SUPABASE_URL!, requireSecretKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function findActiveConnection(
  supabase: SupabaseClient,
  connectionId: string,
  userId: string
): Promise<ConnectionRow | null> {
  // Plaintext columns are NULL after MON-18; select the encrypted columns
  // and decrypt in memory so the caller receives a fully-populated
  // ConnectionRow with access_token / refresh_token in plaintext.
  const { data, error } = await supabase
    .from("user_oauth_tokens")
    .select(
      "id, user_id, gmail_email, access_token_encrypted, refresh_token_encrypted, expires_at, is_active"
    )
    .eq("id", connectionId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .single();

  if (error || !data) return null;
  await decryptTokenRow(supabase, data as ConnectionRow);
  return data as ConnectionRow;
}

export async function findActiveSeedByConnection(
  supabase: SupabaseClient,
  connectionId: string
): Promise<{ id: string; status: string } | null> {
  const { data } = await supabase
    .from("seeds")
    .select("id, status")
    .eq("user_oauth_token_id", connectionId)
    .in("status", ["pending", "processing"])
    .maybeSingle();

  return data;
}

export async function createSeed(
  supabase: SupabaseClient,
  data: {
    userId: string;
    connectionId: string;
    messageIds: string[];
  }
): Promise<SeedRow | null> {
  const { data: seed, error } = await supabase
    .from("seeds")
    .insert({
      user_id: data.userId,
      user_oauth_token_id: data.connectionId,
      status: "processing",
      message_ids: data.messageIds,
      total_emails: data.messageIds.length,
      last_processed_index: 0,
    })
    .select()
    .single();

  if (error) {
    console.error("[seed-repo] createSeed failed:", error);
    return null;
  }
  return seed as SeedRow;
}

export async function getSeedById(
  supabase: SupabaseClient,
  seedId: string
): Promise<SeedRow | null> {
  const { data, error } = await supabase
    .from("seeds")
    .select("*")
    .eq("id", seedId)
    .single();

  if (error || !data) return null;
  return data as SeedRow;
}

export async function updateSeedProgress(
  supabase: SupabaseClient,
  seedId: string,
  update: {
    status: "processing" | "completed" | "failed";
    lastProcessedIndex: number;
    transactionsFound: number;
  }
): Promise<void> {
  const { error } = await supabase
    .from("seeds")
    .update({
      status: update.status,
      last_processed_index: update.lastProcessedIndex,
      emails_processed_by_ai: update.lastProcessedIndex,
      transactions_found: update.transactionsFound,
      updated_at: new Date().toISOString(),
    })
    .eq("id", seedId);

  if (error) {
    console.error("[seed-repo] updateSeedProgress failed:", error);
  }
}

export async function markSeedFailed(
  supabase: SupabaseClient,
  seedId: string,
  errorMessage: string
): Promise<void> {
  const { error } = await supabase
    .from("seeds")
    .update({
      status: "failed",
      error_message: errorMessage,
      updated_at: new Date().toISOString(),
    })
    .eq("id", seedId);

  if (error) {
    console.error("[seed-repo] markSeedFailed failed:", error);
  }
}

export async function getUserFullName(
  supabase: SupabaseClient,
  userId: string
): Promise<string | undefined> {
  const { data } = await supabase.auth.admin.getUserById(userId);
  return data?.user?.user_metadata?.full_name;
}

export async function findExistingTransaction(
  supabase: SupabaseClient,
  tokenId: string,
  messageId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("transactions")
    .select("id")
    .eq("user_oauth_token_id", tokenId)
    .eq("source_message_id", messageId)
    .maybeSingle();
  return data !== null;
}

export async function findExistingDiscarded(
  supabase: SupabaseClient,
  tokenId: string,
  messageId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("discarded_emails")
    .select("id")
    .eq("user_oauth_token_id", tokenId)
    .eq("message_id", messageId)
    .maybeSingle();
  return data !== null;
}

export async function insertTransaction(
  supabase: SupabaseClient,
  data: {
    userId: string;
    tokenId: string;
    fromEmail: string;
    messageId: string;
    date: string;
    transaction: {
      amount: number;
      currency: string;
      type: string;
      name?: string;
      description?: string;
      date?: string;
      merchant?: string;
      category?: string;
    };
    subject: string;
  }
): Promise<{ inserted: boolean; duplicate: boolean }> {
  const { error } = await supabase.from("transactions").insert({
    user_id: data.userId,
    user_oauth_token_id: data.tokenId,
    source_email: data.fromEmail,
    source_message_id: data.messageId,
    date: data.date,
    amount: data.transaction.amount,
    currency: data.transaction.currency,
    transaction_type: data.transaction.type,
    name: data.transaction.name || data.subject,
    transaction_description: data.transaction.description,
    transaction_date: data.transaction.date || data.date.split("T")[0],
    merchant: data.transaction.merchant,
    category: data.transaction.category,
  });

  if (error) {
    if (error.code === "23505") {
      return { inserted: false, duplicate: true };
    }
    console.error("[seed-repo] insertTransaction failed:", error);
    return { inserted: false, duplicate: false };
  }
  return { inserted: true, duplicate: false };
}

export async function insertDiscarded(
  supabase: SupabaseClient,
  data: { tokenId: string; messageId: string; reason: string }
): Promise<void> {
  const { error } = await supabase.from("discarded_emails").insert({
    user_oauth_token_id: data.tokenId,
    message_id: data.messageId,
    reason: data.reason,
  });

  if (error && error.code !== "23505") {
    console.error("[seed-repo] insertDiscarded failed:", error);
  }
}
