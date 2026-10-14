// Application role hierarchy. Mirrors the `public.app_role` enum defined
// in supabase/migrations/20260625125528_add_user_roles_and_access_token_hook.sql.
// Hierarchy: user(0) < tester(1) < admin(2). `hasMinRole(actual, required)`
// returns true when `actual >= required`, so a `tester` minimum also
// admits `admin`. To promote a user you must write to `public.user_roles`
// via a service-role-backed context (the user cannot change their own
// role).
export type UserRole = "user" | "tester" | "admin";

const ROLE_LEVEL: Readonly<Record<UserRole, number>> = Object.freeze({
  user: 0,
  tester: 1,
  admin: 2,
});

export function roleLevel(role: UserRole): number {
  return ROLE_LEVEL[role];
}

export function hasMinRole(actual: UserRole, required: UserRole): boolean {
  return roleLevel(actual) >= roleLevel(required);
}

// exposed for `getRoleFromToken` in _shared/auth.ts to validate the
// `user_role` claim before casting. not part of the public API —
// callers should branch on the UserRole union directly.
export const VALID_ROLES: ReadonlySet<string> = new Set<UserRole>([
  "user",
  "tester",
  "admin",
]);

/**
 * The set of features that are gated by role. THIS MAP IS THE SINGLE
 * SWITCH for role-based gating on the backend (Deno edge functions).
 *
 * This is a duplicate of `packages/frontend/src/lib/features.ts#FEATURES`.
 * The two copies must stay in sync — the public.app_role enum in
 * Postgres is the authority on the role vocabulary, but there is no
 * authority for the FEATURES map itself; keep this file in lockstep
 * with the frontend copy whenever a feature is added or its required
 * role is changed.
 *
 * The values here are consulted by `requireMinRole` in `_shared/auth.ts`:
 * every user-facing edge function calls `requireMinRole(auth, "<key>", ...)`
 * and the helper looks up the required role from this map.
 *
 * Today every value is `"user"` so the middleware accepts every caller.
 * The moment a value is raised to `"tester"` or `"admin"`:
 *
 *   - every edge function that calls `requireMinRole(auth, "<key>", ...)`
 *     starts returning 403 for callers below that role, with the
 *     error message "Requires role '<required>'".
 *   - the frontend classifier (`utils/edge-function-errors.ts`)
 *     substitutes the localized "This is a premium feature" toast.
 *
 * No other code changes are needed to gate a feature — flip the value
 * in BOTH this file and the frontend copy, commit, deploy.
 */
export const FEATURES = {
  seed: "user",
  chat: "user",
  metrics: "user",
  transactions: "user",
  subscriptions: "user",
  settings: "user",
  processDocument: "user",
  gmailConnect: "user",
} as const satisfies Record<string, UserRole>;

export type FeatureKey = keyof typeof FEATURES;

/**
 * Capability vocabulary used by `payments.plan_capabilities`. Mirrors
 * `packages/frontend/src/lib/capabilities.ts#CAPABILITIES` and
 * `packages/mastra-server/src/lib/capabilities.ts#CAPABILITIES`. The
 * `payments.capability` enum (see
 * supabase/migrations/20260705031212_add_plan_capabilities.sql) is
 * the authoritative guard against drift between these copies; adding
 * a new value requires `alter type payments.capability add value '<name>'`
 * (must run outside a transaction block in production) plus updating
 * all three copies here.
 */
export const CAPABILITIES = {
  gmail_sync: "gmail_sync",
  ai_assistant: "ai_assistant",
  push_notifications: "push_notifications",
  process_documents: "process_documents",
  report_pdf_export: "report_pdf_export",
} as const;

export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

/**
 * Type guard for runtime values (e.g. read from the JWT claim or from
 * a PostgREST row).
 */
export function isCapability(x: unknown): x is Capability {
  return typeof x === "string" && x in CAPABILITIES;
}
