/**
 * Integration test for the gmail_sync usage counter wire-up
 * (MON-24). Exercises `incrementGmailSyncUsage` end-to-end against a
 * real local Supabase instance: the helper takes a service-role
 * Supabase client (matching the production path in
 * `packages/mastra-server/src/services/seed-emails/seed-emails.repository.ts:7`),
 * and the RPC lives in `payments.check_and_increment_usage`
 * (see supabase/migrations/20260705163606_add_usage_limits_and_counters.sql).
 *
 * Why Deno and not bun: this runs against the Supabase local stack
 * (the mastra-server uses Bun but the SQL functions and RLS are in
 * the Supabase container). The test reads SUPABASE_URL and
 * SUPABASE_SECRET_KEY from `supabase/functions/.env` via the
 * `--env-file` flag, mirroring the existing
 * `transaction-agent.integration.test.ts` runner.
 *
 * Required env vars (already in functions/.env):
 *   - SUPABASE_URL
 *   - SUPABASE_SECRET_KEY
 *
 * The helper under test is the same one imported by the
 * mastra-server seed processor (`seed-emails.processor.ts`) and by
 * the `gmail-webhook` edge function, so the test cannot drift from
 * production semantics. Co-locating the helper in
 * `_shared/lib/usage-counter.ts` lets the Deno edge function runtime
 * and the Bun mastra-server both import it without duplication.
 */
import { assert, assertEquals } from "jsr:@std/assert";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { incrementGmailSyncUsage } from "./lib/usage-counter.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SECRET_KEY = Deno.env.get("SUPABASE_SECRET_KEY");
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  throw new Error(
    "SUPABASE_URL and SUPABASE_SECRET_KEY are required to run the seed-emails usage integration tests."
  );
}

function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL!, SUPABASE_SECRET_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function ephemeralUserId(): string {
  return crypto.randomUUID();
}

/**
 * Compute the same `period_start` the RPC uses internally
 * (`date_trunc('month', now())` in UTC). We can't read the value
 * back from the DB without first creating a row, so we compute it
 * client-side — the storage layer treats `period_start` as a black
 * box, the helper just passes it through.
 */
async function currentMonthStart(): Promise<string> {
  // No-op RPC round-trip to ensure connection is healthy before the
  // test deletes any state.
  await serviceClient().schema("payments").rpc("resolve_usage_limit", {
    target_user_id: "00000000-0000-0000-0000-000000000000",
    cap: "gmail_sync",
  });
  return new Date(
    Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)
  ).toISOString();
}

async function counterFor(userId: string): Promise<number> {
  const supabase = serviceClient();
  const periodStart = await currentMonthStart();
  const { data } = await supabase
    .schema("payments")
    .from("usage_counters")
    .select("count")
    .eq("user_id", userId)
    .eq("capability", "gmail_sync")
    .eq("period_start", periodStart)
    .maybeSingle();
  return data?.count ?? 0;
}

async function setUsageLimit(
  supabase: SupabaseClient,
  role: "user" | "tester" | "admin",
  maxCount: number
): Promise<() => Promise<void>> {
  // Inserts a row into `payments.usage_limits_role` — the typed table
  // for role-scoped overrides. The PK (capability, role, period)
  // guarantees uniqueness; typos in the role literal are rejected
  // by the enum (no more "Tester"/"testr" silently accepted).
  //
  // Read the current value first: the seed ships a gmail_sync row for
  // role:tester, and the cleanup must put it back rather than delete it
  // (usage-schema asserts on the seeded row).
  const { data: prior } = await supabase
    .schema("payments")
    .from("usage_limits_role")
    .select("max_count")
    .eq("capability", "gmail_sync")
    .eq("role", role)
    .eq("period", "month")
    .maybeSingle();

  const { error } = await supabase
    .schema("payments")
    .from("usage_limits_role")
    .upsert(
      {
        capability: "gmail_sync",
        role,
        period: "month",
        max_count: maxCount,
      },
      { onConflict: "capability,role,period" }
    );
  if (error) {
    throw new Error(
      `setup: failed to upsert usage_limits_role: ${error.message}`
    );
  }
  return async () => {
    if (prior) {
      await supabase.schema("payments").from("usage_limits_role").upsert(
        {
          capability: "gmail_sync",
          role,
          period: "month",
          max_count: prior.max_count,
        },
        { onConflict: "capability,role,period" }
      );
      return;
    }
    await supabase
      .schema("payments")
      .from("usage_limits_role")
      .delete()
      .eq("capability", "gmail_sync")
      .eq("role", role)
      .eq("period", "month");
  };
}

/**
 * Create a minimal auth.users row + a public.user_roles row so the
 * `resolve_usage_limit` RPC reads the role override. Without an
 * auth.users row, the FK on user_roles fails. We use the admin auth
 * API to create the user (PostgREST doesn't expose auth.users).
 */
async function setUserRole(
  userId: string,
  role: "user" | "tester" | "admin"
): Promise<() => Promise<void>> {
  const supabase = serviceClient();
  const { error: userErr } = await supabase.auth.admin.createUser({
    id: userId,
    email: `${userId}@test.local`,
    email_confirm: true,
  });
  // Idempotent re-run: supabase-js returns an error envelope even on
  // uniqueness conflicts. Treat the email-already-registered case as
  // a soft success.
  const msg = userErr?.message ?? "";
  if (userErr && !/already.*registered|already been registered/i.test(msg)) {
    throw new Error(`setup: failed to create auth user: ${msg}`);
  }

  const { error: roleErr } = await supabase.from("user_roles").insert({
    user_id: userId,
    role,
  });
  if (roleErr && roleErr.code !== "23505") {
    throw new Error(`setup: failed to insert user_roles: ${roleErr.message}`);
  }

  return async () => {
    await supabase.from("user_roles").delete().eq("user_id", userId);
    // Leave auth.users in place; it's harmless and cheaper than
    // orchestrating the cascade. Other tests that pick up the same
    // UUID will get the same role from the surviving user_roles row.
  };
}

async function clearCounter(userId: string): Promise<void> {
  await serviceClient()
    .schema("payments")
    .from("usage_counters")
    .delete()
    .eq("user_id", userId)
    .eq("capability", "gmail_sync");
}

Deno.test({
  name: "seed-emails usage: admin bypasses counter",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const supabase = serviceClient();
    const userId = ephemeralUserId();
    const cleanup = await setUsageLimit(supabase, "admin", 5);
    try {
      // Even though the role-scoped limit is set to 5, admin must
      // not increment. The helper short-circuits before the RPC.
      for (let i = 0; i < 5; i++) {
        const r = await incrementGmailSyncUsage(supabase, userId, "admin", {
          messageId: `m${i}`,
        });
        assertEquals(r.counted, false, `admin call ${i} should not count`);
        assertEquals(r.quotaExhausted, false);
      }
      assertEquals(
        await counterFor(userId),
        0,
        "admin must not produce a usage_counters row"
      );
    } finally {
      await cleanup();
      await clearCounter(userId);
    }
  },
});

Deno.test({
  name: "seed-emails usage: default user increments and respects cap",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const supabase = serviceClient();
    const userId = ephemeralUserId();
    const cleanupLimit = await setUsageLimit(supabase, "user", 3);
    const cleanupRole = await setUserRole(userId, "user");
    try {
      // 3 calls succeed.
      for (let i = 0; i < 3; i++) {
        const r = await incrementGmailSyncUsage(supabase, userId, "user", {
          messageId: `m${i}`,
        });
        assertEquals(r.counted, true);
        assertEquals(r.quotaExhausted, false);
      }
      assertEquals(await counterFor(userId), 3);

      // 4th call: quota exhausted, counter does not exceed the cap.
      const blocked = await incrementGmailSyncUsage(supabase, userId, "user", {
        messageId: "m3",
      });
      assertEquals(blocked.counted, false);
      assertEquals(blocked.quotaExhausted, true);
      assertEquals(
        await counterFor(userId),
        3,
        "counter must not exceed limit even after a blocked call"
      );
    } finally {
      await cleanupLimit();
      await cleanupRole();
      await clearCounter(userId);
    }
  },
});

Deno.test({
  name: "seed-emails usage: tester IS counted (regression guard)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    // The capability gate in `supabase/functions/_shared/capabilities.ts`
    // bypasses BOTH admin and tester; the usage counter bypass is
    // narrower and only covers admin. If a future refactor widens the
    // counter bypass to include tester, this test breaks.
    const supabase = serviceClient();
    const userId = ephemeralUserId();
    const cleanupLimit = await setUsageLimit(supabase, "tester", 5);
    const cleanupRole = await setUserRole(userId, "tester");
    try {
      const r = await incrementGmailSyncUsage(supabase, userId, "tester", {
        messageId: "m0",
      });
      assertEquals(r.counted, true);
      assertEquals(await counterFor(userId), 1);
    } finally {
      await cleanupLimit();
      await cleanupRole();
      await clearCounter(userId);
    }
  },
});

Deno.test({
  name: "seed-emails usage: fails open when RPC errors",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    // Build a service client that points at an unreachable URL so
    // every RPC call fails. The helper must NOT throw — it must
    // return { counted: false, quotaExhausted: false } so the
    // processor keeps going. This mirrors the production
    // fail-open contract documented in the helper's file header.
    const broken = createClient("http://127.0.0.1:1", "broken-key", {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const userId = ephemeralUserId();
    let result;
    let threw: unknown = null;
    try {
      result = await incrementGmailSyncUsage(broken, userId, "user", {
        messageId: "m0",
      });
    } catch (err) {
      threw = err;
    }
    assert(threw === null, `helper must not throw on RPC error; got ${threw}`);
    assert(result !== undefined, "result must be defined");
    assertEquals(result!.counted, false);
    assertEquals(result!.quotaExhausted, false);
  },
});
