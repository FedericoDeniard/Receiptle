import { Mastra } from "@mastra/core";
import { CompositeAuth, SimpleAuth } from "@mastra/core/server";
import { PostgresStore } from "@mastra/pg";
import { MastraAuthSupabase } from "@mastra/auth-supabase";
import { financialAgent } from "./agents/financial-agent";
import { topicClassifier } from "./classifiers/topic";

const supabaseDbUrl = process.env.SUPABASE_DB_URL;
if (supabaseDbUrl) {
  try {
    const parsed = new URL(supabaseDbUrl);
    console.log(
      `[mastra] SUPABASE_DB_URL -> user="${parsed.username}" host="${parsed.hostname}" port="${parsed.port}" db="${parsed.pathname.replace(/^\//, "")}"`
    );
  } catch {
    console.log(`[mastra] SUPABASE_DB_URL (unparseable) -> "${supabaseDbUrl}"`);
  }
} else {
  console.log("[mastra] SUPABASE_DB_URL -> <undefined>");
}

const storage = new PostgresStore({
  id: "mastra-storage",
  schemaName: "ai",
  connectionString: supabaseDbUrl!,
});

// Mastra is now used purely as an AI provider. The HTTP server (Hono)
// lives in src/server.ts. The only `server` config we keep is `auth`,
// which the @mastra/hono adapter reads to protect its own routes
// (/api/agents/*). All other middleware/CORS/port is handled by Hono.
//
// Note: userId and userRole are populated by the Hono auth middleware
// (src/middleware/auth.ts). Tools/agents that read them should call
// `ctx.requestContext.get("userId")` / `ctx.requestContext.get("userRole")`.
export const mastra = new Mastra({
  agents: { financialAgent },
  classifiers: { topicClassifier },
  storage,
  server: {
    auth: new CompositeAuth([
      new SimpleAuth({
        tokens: {
          [process.env.STUDIO_DEV_TOKEN!]: {
            id: "studio-dev",
            name: "Studio Dev User",
          },
        },
      }),
      new MastraAuthSupabase({
        url: process.env.SUPABASE_URL!,
        anonKey: process.env.SUPABASE_ANON_KEY!,
        authorizeUser: async () => true,
        mapUserToResourceId: user => user.id,
        protected: ["/api/agents/*", "/chat/*"],
        public: [["/api/*", "GET"]],
      }),
    ]),
  },
});

// Schema and RLS for the mastra_* tables are owned by a Supabase migration
// (see supabase/migrations/20260618010249_mastra_schema_and_rls.sql and
// 20260625022751_move_mastra_tables_to_ai_schema.sql). The migration creates
// all 35 tables in the `ai` schema with ENABLE ROW LEVEL SECURITY, attaches
// the per-user policies to the 5 tables the frontend reads, and installs an
// event trigger that auto-enables RLS on any future mastra_* table Mastra
// may add. There is intentionally no runtime hook here: deploy order is
// irrelevant — whichever side lands first, the tables end up locked down.
