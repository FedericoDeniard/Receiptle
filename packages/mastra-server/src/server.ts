// Standalone Hono server for the mastra-server package.
//
// Architecture:
//   - This file is the entrypoint (`bun src/server.ts`).
//   - Hono handles all HTTP, middleware, and routing.
//   - Mastra is mounted via @mastra/hono adapter and only owns AI
//     agent routes (`/api/agents/*`).
//   - Our own API routes (seed-emails, etc.) live on the same Hono
//     app, registered explicitly. They don't go through Mastra's
//     server middleware.
//
// IMPORTANT: `./env-loader` MUST be the FIRST import. Its top-level
// code runs before any other module is evaluated, populating
// process.env so that downstream modules (e.g. financial-agent.ts
// instantiating an OpenRouter client at module load time) see the
// correct env vars even under pnpm, which strips env before forking.
import "./env-loader";
import { Hono } from "hono";
import { MastraServer } from "@mastra/hono";
import { corsMiddleware } from "./middleware/cors";
import { authMiddleware } from "./middleware/auth";
import { seedEmailsHandler } from "./mastra/routes/seed-emails-route";
import { chatHandler } from "./mastra/routes/resilient-chat-route";
import { mastra } from "./mastra";

const app = new Hono();

app.use("*", corsMiddleware);
app.use("*", authMiddleware);

app.get("/health", c => c.json({ status: "ok" }));

app.post("/api/seed-emails", seedEmailsHandler);
app.post("/chat/:agentId", chatHandler);

const server = new MastraServer({ app, mastra });
await server.init();

const port = Number(process.env.MASTRA_PORT) || 4111;
console.log(`[server] Listening on http://localhost:${port}`);

export default {
  port,
  // Bun.serve closes connections that go 10s without bytes in either
  // direction — including mid-stream. Chat responses can be quiet
  // longer than that before the first byte lands (auth, guardrail,
  // first provider token), so raise the ceiling. The SSE heartbeat in
  // resilient-chat-route.ts keeps mid-stream gaps short on its own.
  idleTimeout: 255,
  fetch: app.fetch,
};
