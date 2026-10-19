// Loads .env and .env.local from the current working directory into
// process.env SYNCHRONOUSLY, blocking the event loop until done.
// .env.local wins over .env, matching Bun's own precedence.
// Worktree checkouts get .env.local from scripts/sync-env-from-main.sh.
//
// WHY THIS EXISTS:
// Bun auto-loads .env when invoked directly (bun src/server.ts),
// but pnpm strips env vars from the parent process before forking
// Bun, so process.env.OPENROUTER_API_KEY etc. arrive as undefined.
//
// WHY A SEPARATE FILE:
// ES module imports run in order of appearance. By making this the
// FIRST import in server.ts, the .env is loaded before any other
// module's top-level code (e.g. financial-agent.ts instantiates an
// OpenRouter client at module load time reading process.env).
//
// WHY SYNCHRONOUS:
// The previous async version yielded the event loop with await,
// allowing downstream imports (financial-agent → topic-guardrail)
// to evaluate while env-loading was in progress. They then read
// undefined keys and stored them. The async version also reported
// "loaded 0 vars" under bun because Bun had already auto-loaded
// the same vars, masking whether the loader actually worked.
//
// Using fs.readFileSync blocks the event loop entirely, so no
// downstream import can run until this loader finishes.
//
// Do NOT import env vars from here — just side-effect-loads the file.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const envFileNames = [".env", ".env.local"];
const parsed = new Map<string, string>();
const foundFiles: string[] = [];

for (const name of envFileNames) {
  const envPath = join(process.cwd(), name);
  if (!existsSync(envPath)) continue;
  foundFiles.push(name);
  const text = readFileSync(envPath, "utf-8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed.set(key, value);
  }
}

let loaded = 0;
for (const [key, value] of parsed) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
    loaded++;
  }
}

const origin = foundFiles.join(", ");

if (foundFiles.length === 0) {
  console.warn(`[env-loader] no .env or .env.local found at ${process.cwd()}`);
} else if (process.env.OPENROUTER_API_KEY) {
  console.log(
    `[env-loader] loaded ${loaded} vars from ${origin}; OPENROUTER_API_KEY prefix=${process.env.OPENROUTER_API_KEY.substring(0, 15)}, length=${process.env.OPENROUTER_API_KEY.length}`
  );
} else {
  console.warn(
    `[env-loader] loaded ${loaded} vars from ${origin} but OPENROUTER_API_KEY is still missing!`
  );
}
