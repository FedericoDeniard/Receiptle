import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requirePublishableKey } from "./supabase-keys";

const URL = process.env.SUPABASE_URL!;
const ANON_KEY = requirePublishableKey();

export function supabaseFromToken(accessToken: string): SupabaseClient {
  return createClient(URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
