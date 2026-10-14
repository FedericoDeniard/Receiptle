/**
 * Application role helpers used by the Mastra server.
 *
 * The role is injected into the JWT by the Supabase custom access token
 * hook (see supabase/migrations/20260625125528_add_user_roles_and_access_token_hook.sql).
 * The mastra-server reads it from the access token in its middleware and
 * stores it in the `RequestContext` so tools and agents can branch on it
 * via `ctx.requestContext.get("userRole")`.
 *
 * Mirrors the frontend helpers in packages/frontend/src/lib/features.ts
 * and the edge function helpers in supabase/functions/_shared/auth.ts.
 */
export type UserRole = "user" | "tester" | "admin";

const VALID_ROLES: ReadonlySet<string> = new Set<UserRole>([
  "user",
  "tester",
  "admin",
]);

/**
 * Decode the payload of a Supabase access token. The mastra auth provider
 * already validated the signature via `getAuthenticatedUser`; we only
 * need the payload to read custom claims.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const payload = parts[1];
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

export function getRoleFromToken(token: string): UserRole {
  const payload = decodeJwtPayload(token);
  const claim = payload?.user_role;
  if (typeof claim === "string" && VALID_ROLES.has(claim)) {
    return claim as UserRole;
  }
  return "user";
}
