import { createClient, type User } from "jsr:@supabase/supabase-js@2";
import {
  FEATURES,
  VALID_ROLES,
  hasMinRole,
  type FeatureKey,
  type UserRole,
} from "./features.ts";

type JsonHeaders = Record<string, string>;

function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;

  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) return null;

  return token;
}

function unauthorized(corsHeaders: JsonHeaders, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function forbidden(corsHeaders: JsonHeaders, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status: 403,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getUserFromToken(token: string): Promise<User | null> {
  const supabase = createClient(
    // Use process.env (Node/Bun compat) instead of Deno.env so the same
    // shared module works in Supabase Edge Functions (Deno) and the
    // mastr-server (Bun). Deno supports process.env via Node compat.
    process.env.SUPABASE_URL ?? "",
    process.env.SUPABASE_ANON_KEY ?? ""
  );

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) {
    return null;
  }

  return user;
}

/**
 * Decode the payload of a Supabase access token.
 *
 * The token was already validated upstream (e.g. by `getUser`), so we only
 * need the base64-decoded payload to read custom claims such as `user_role`
 * that the custom_access_token_auth_hook injected. We do not verify the
 * signature here — and must not, because we do not have the signing key.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const payload = parts[1];
  if (!payload) return null;

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const json = atob(padded);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Read the user's role from the JWT. The custom access token hook always
 * sets `user_role` to one of the enum values; if the claim is missing or
 * malformed (e.g. an older token issued before the hook was deployed) we
 * fall back to `user` so the caller always has a valid role to branch on.
 */
export function getRoleFromToken(token: string): UserRole {
  const payload = decodeJwtPayload(token);
  const claim = payload?.user_role;
  if (typeof claim === "string" && VALID_ROLES.has(claim)) {
    return claim as UserRole;
  }
  return "user";
}

export async function requireUserToken(
  token: string,
  corsHeaders: JsonHeaders
): Promise<{ user: User; role: UserRole } | Response> {
  if (!token) {
    return unauthorized(corsHeaders, "Missing authentication token");
  }

  const user = await getUserFromToken(token);
  if (!user) {
    return unauthorized(corsHeaders, "Invalid or expired token");
  }

  return { user, role: getRoleFromToken(token) };
}

export async function requireUserAuth(
  req: Request,
  corsHeaders: JsonHeaders
): Promise<{ user: User; token: string; role: UserRole } | Response> {
  const token = getBearerToken(req);
  if (!token) {
    return unauthorized(corsHeaders, "Missing or invalid authorization header");
  }

  const user = await getUserFromToken(token);
  if (!user) {
    return unauthorized(corsHeaders, "Invalid or expired token");
  }

  return { user, token, role: getRoleFromToken(token) };
}

/**
 * Convenience helper: run after `requireUserAuth` (or `requireUserToken`)
 * to enforce role-based gating. The caller passes the feature key (one of
 * the FEATURES map entries); the helper looks up the required role from
 * `_shared/features.ts#FEATURES` and checks `auth.role` against it.
 *
 * Today every FEATURES value is `"user"` so the helper accepts everyone,
 * which means every call site is effectively a no-op. The moment any
 * FEATURES value is raised to `"tester"` or `"admin"`, the corresponding
 * edge functions start rejecting non-qualifying callers with a 403 and
 * the error message `"Requires role '<required>'"`. The frontend
 * classifier (`packages/frontend/src/utils/edge-function-errors.ts`)
 * pattern-matches that prefix to surface a "premium feature" toast
 * instead of the raw message.
 *
 * The capability gate (`requireCapability` in _shared/capabilities.ts)
 * is a separate orthogonal concept: roles come from `public.user_roles`,
 * capabilities come from `payments.plan_capabilities`. Both gates can
 * run in series on the same request without interfering.
 *
 * Why pass `featureKey` instead of the role literal: the role is the
 * server-enforced outcome, but the frontend already maps each feature
 * to a required role via the FEATURES map. Passing the key (and having
 * the helper do the lookup) keeps the backend in sync with the
 * frontend — flipping `FEATURES.seed` to `"tester"` in BOTH copies
 * activates the gate end-to-end with no other changes.
 */
export function requireMinRole<T extends { role: UserRole }>(
  ctx: T,
  featureKey: FeatureKey,
  corsHeaders: JsonHeaders
): T | Response {
  const required = FEATURES[featureKey];
  if (hasMinRole(ctx.role, required)) {
    return ctx;
  }
  return forbidden(corsHeaders, `Requires role '${required}'`);
}

export function requireInternalAuth(
  req: Request,
  corsHeaders: JsonHeaders
): { token: string } | Response {
  const token = getBearerToken(req);
  if (!token) {
    return unauthorized(corsHeaders, "Missing or invalid authorization header");
  }

  const internalSecret = process.env.INTERNAL_FUNCTIONS_SECRET;
  if (!internalSecret || token !== internalSecret) {
    return unauthorized(corsHeaders, "Invalid internal authorization token");
  }

  return { token };
}
