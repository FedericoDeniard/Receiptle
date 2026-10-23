import { createClient } from "npm:@supabase/supabase-js@2";
import { requireSecretKey } from "./api-keys.ts";

const supabaseUrl = process.env.SUPABASE_URL!;
const serviceKey = requireSecretKey();

export const supabase = createClient(supabaseUrl, serviceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
