// Lazy Supabase client. The original edge function version created
// the client at module import time, which broke standalone processes
// (like our Hono server) when the Supabase URL/secret key weren't set yet.
// The Proxy defers creation until first use.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireSecretKey } from "../supabase-keys";

let _serviceClient: SupabaseClient | null = null;

function getServiceClient(): SupabaseClient {
  if (_serviceClient) return _serviceClient;
  const url = process.env.SUPABASE_URL;
  if (!url) {
    throw new Error("SUPABASE_URL must be set to use the Supabase client");
  }
  const key = requireSecretKey();
  _serviceClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _serviceClient;
}

// Proxy preserves the existing `supabase.from(...)` call sites without
// forcing every consumer to switch to a function call.
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getServiceClient(), prop, receiver);
  },
}) as SupabaseClient;
