// Global auth middleware. Extracts the Supabase JWT from the Authorization
// header, validates it, and populates the Hono request context with:
//   - userId: the authenticated user's UUID
//   - supabaseToken: the raw JWT (used by some tools to talk to Supabase
//     with the user's identity)
//   - userTimezone: the client's IANA timezone (for date-sensitive tools)
//   - userRole: the user's role (user|tester|admin) — used by tools/agents
//     that branch on it (e.g. per-role rate limits, tier-specific tool
//     restrictions, different system prompts). The role is decoded from
//     the JWT where the custom_access_token_auth_hook injected it; see
//     supabase/migrations/20260625125528_add_user_roles_and_access_token_hook.sql.
//
// Routes that need an authenticated user read c.get("userId"); routes
// that need the role read c.get("userRole"). Routes that don't care
// about auth can ignore these.
import { createClient } from "@supabase/supabase-js";
import type { MiddlewareHandler } from "hono";
import { getRoleFromToken, type UserRole } from "../lib/roles";
import { requirePublishableKey } from "../lib/supabase-keys";

declare module "hono" {
  interface ContextVariableMap {
    userId?: string;
    supabaseToken?: string;
    userTimezone?: string;
    userRole?: UserRole;
  }
}

let supabaseClient: ReturnType<typeof createClient> | null = null;

function getSupabaseClient() {
  if (!supabaseClient) {
    supabaseClient = createClient(
      process.env.SUPABASE_URL!,
      requirePublishableKey()
    );
  }
  return supabaseClient;
}

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const authHeader = c.req.header("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");

  if (token) {
    const supabase = getSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser(token);
    if (user?.id) {
      c.set("userId", user.id);
    }
    c.set("supabaseToken", token);
    c.set("userRole", getRoleFromToken(token));

    const timezone = c.req.header("x-user-timezone");
    if (timezone) {
      c.set("userTimezone", timezone);
    }
  }

  await next();
};
