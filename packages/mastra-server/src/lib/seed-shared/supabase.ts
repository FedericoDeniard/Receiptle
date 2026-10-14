// Lazy Supabase client. The original edge function version created
// the client at module import time, which broke standalone processes
// (like our Hono server) when SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY
// weren't set yet. The Proxy defers creation until first use.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _serviceClient: SupabaseClient | null = null;

function getServiceClient(): SupabaseClient {
  if (_serviceClient) return _serviceClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to use the Supabase client"
    );
  }
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
