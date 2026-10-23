import { serve } from "bun";
import { readFileSync, existsSync, statSync } from "fs";
import { join } from "path";
import devIndex from "./index.html";

// Log environment variables on startup
const supabasePublishableKey =
  process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
console.log("Environment variables loaded:");
console.log("SUPABASE_URL:", process.env.SUPABASE_URL ? "✓" : "✗");
console.log("SUPABASE_PUBLISHABLE_KEY:", supabasePublishableKey ? "✓" : "✗");
console.log("VAPID_PUBLIC_KEY:", process.env.VAPID_PUBLIC_KEY ? "✓" : "✗");
console.log(
  "Edge Functions URL:",
  `${(process.env.SUPABASE_URL || "").replace(/\/+$/, "")}/functions/v1`
);

const isProd = process.env.NODE_ENV === "production";

// Resolve the dist directory (where the built app lives in production)
const distDir = join(import.meta.dir, "..", "dist");
// Resolve the public directory (static assets: manifest, icons)
const publicDir = join(import.meta.dir, "..", "public");
// Astro landing build output (`bun run build:landing`)
const landingDir = join(import.meta.dir, "..", "..", "landing", "dist");
// Dev only: proxy landing requests to `astro dev` so the landing keeps its
// own dev loop. The HMR websocket connects to that port directly (see
// `server.hmr.clientPort` in packages/landing/astro.config.mjs).
const landingDevUrl = process.env.LANDING_DEV_URL?.replace(/\/+$/, "") ?? null;

// Derive the Mastra server origin from MASTRA_SERVER_URL so the CSP
// allows XHR/fetch/SSE connections to it. The env var may include a
// path (we only want the origin). Falls back to localhost in dev.
function getMastraOrigin(): string | null {
  const raw = process.env.MASTRA_SERVER_URL;
  if (!raw) return null;
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withProto).origin;
  } catch {
    return null;
  }
}

const mastraOrigin = getMastraOrigin();

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https: blob:",
    "font-src 'self' data:",
    "connect-src 'self' blob: https://*.supabase.co wss://*.supabase.co https://*.trycloudflare.com https://accounts.google.com https://oauth2.googleapis.com https://cloudflareinsights.com https://glitchtip-web-production-dbe1.up.railway.app http://localhost:4111 http://localhost:3000" +
      (mastraOrigin ? ` ${mastraOrigin}` : ""),
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; "),
};

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Conditional-request check. `If-None-Match` wins over `If-Modified-Since`
 * (RFC 9110): when the client sent an ETag we only trust that.
 */
function isNotModified(
  req: Request,
  etag: string,
  lastModified: Date
): boolean {
  const ifNoneMatch = req.headers.get("if-none-match");
  if (ifNoneMatch) {
    return ifNoneMatch.split(",").some(candidate => {
      const value = candidate.trim();
      return value === "*" || value === etag;
    });
  }

  const ifModifiedSince = req.headers.get("if-modified-since");
  if (!ifModifiedSince) return false;
  const since = Date.parse(ifModifiedSince);
  // HTTP dates have second resolution, so allow the same second.
  return !Number.isNaN(since) && lastModified.getTime() - since < 1000;
}

function serveStaticFile(
  req: Request,
  filePath: string,
  contentType: string
): Response {
  if (!existsSync(filePath)) {
    return withSecurityHeaders(new Response("Not found", { status: 404 }));
  }

  const stat = statSync(filePath);
  // Weak validator: mtime + size. Good enough for build artifacts, and cheap
  // (no content hashing on every request).
  const etag = `W/"${stat.mtimeMs.toString(16)}-${stat.size.toString(16)}"`;
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    ETag: etag,
    "Last-Modified": stat.mtime.toUTCString(),
  };

  if (isNotModified(req, etag, stat.mtime)) {
    return withSecurityHeaders(new Response(null, { status: 304, headers }));
  }

  const content = readFileSync(filePath);
  return withSecurityHeaders(new Response(content, { headers }));
}

const MIME_TYPES: Record<string, string> = {
  js: "application/javascript",
  css: "text/css",
  map: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  ico: "image/x-icon",
  html: "text/html",
  webmanifest: "application/manifest+json",
  json: "application/json",
  txt: "text/plain",
  xml: "application/xml",
  woff2: "font/woff2",
  mp4: "video/mp4",
  webm: "video/webm",
};

function getMimeType(filePath: string): string {
  const ext = (filePath.split(".").pop() ?? "").toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

/**
 * Extensions that are never SPA routes. A request for one of these that no
 * file satisfies is a real 404, not a client-side route.
 */
const NON_SPA_EXTENSIONS = new Set([
  ...Object.keys(MIME_TYPES),
  "jsonld",
  "webmanifest",
  "woff",
  "ttf",
  "eot",
]);

/**
 * Paths the Astro dev server owns while it runs behind the dev proxy. The
 * SPA serves its own modules from `/src/...` and `/frontend.tsx`, so only the
 * landing's stylesheet entry point is proxied out of `/src/`.
 */
function isLandingDevPath(pathname: string): boolean {
  if (
    pathname === "/" ||
    pathname === "/en" ||
    pathname === "/en/" ||
    pathname === "/es" ||
    pathname === "/es/"
  ) {
    return true;
  }
  return [
    "/_astro/",
    "/@vite",
    "/@fs/",
    "/@id/",
    "/node_modules/",
    "/src/styles/",
  ].some(prefix => pathname.startsWith(prefix));
}

/**
 * `/es` is an alias of the Spanish landing: `/` stays the canonical URL
 * (default locale, `prefixDefaultLocale: false`) but the explicit locale path
 * works for anyone who types it.
 */
const LANDING_ALIASES: Record<string, string> = {
  "/es": "/",
  "/es/": "/",
};

/**
 * Map a request path to a file inside the Astro landing build. Returns null
 * when the path does not belong to the landing, so the caller serves the SPA.
 */
function resolveLandingFile(pathname: string): string | null {
  const resolved = LANDING_ALIASES[pathname] ?? pathname;
  const relative = resolved.replace(/^\/+/, "");
  const candidates =
    relative === "" || relative.endsWith("/")
      ? [join(relative, "index.html")]
      : [relative, join(relative, "index.html")];

  for (const candidate of candidates) {
    const filePath = join(landingDir, candidate);
    if (!filePath.startsWith(landingDir)) continue;
    if (existsSync(filePath) && statSync(filePath).isFile()) return filePath;
  }

  return null;
}

/** Serve the Astro landing, or null when the path belongs to the SPA. */
function serveLanding(req: Request, pathname: string): Response | null {
  const filePath = resolveLandingFile(pathname);
  if (!filePath) return null;

  const response = serveStaticFile(req, filePath, getMimeType(filePath));

  // Astro content-hashes everything under /_astro. The HTML is revalidated on
  // every visit so a deploy is picked up immediately; the rest (robots.txt,
  // llms.txt, sitemap.xml, logo.svg) can live in the cache for a day.
  const cacheControl = pathname.startsWith("/_astro/")
    ? "public, max-age=31536000, immutable"
    : filePath.endsWith(".html")
      ? "public, max-age=0, must-revalidate"
      : "public, max-age=86400, must-revalidate";
  response.headers.set("Cache-Control", cacheControl);

  return response;
}

/**
 * Production SPA handling: a real file from `dist/` when it exists, otherwise
 * the SPA shell so React Router can resolve the route.
 */
function serveSpa(req: Request): Response {
  const pathname = new URL(req.url).pathname;

  if (pathname !== "/" && pathname !== "") {
    const filePath = join(distDir, pathname.slice(1));
    if (existsSync(filePath)) {
      return serveStaticFile(req, filePath, getMimeType(filePath));
    }
  }

  // Missing machine-readable files must 404 instead of returning the SPA
  // shell: agents (and browsers) that ask for `/ai-catalog.json`,
  // `/.well-known/*`, a missing asset, etc. would otherwise read 200 + HTML.
  const extension = (pathname.split(".").pop() ?? "").toLowerCase();
  if (isNonSpaPath(pathname) || NON_SPA_EXTENSIONS.has(extension)) {
    return withSecurityHeaders(
      new Response("Not found", {
        status: 404,
        headers: { "Content-Type": "text/plain" },
      })
    );
  }

  return serveStaticFile(req, join(distDir, "index.html"), "text/html");
}

/**
 * Paths that can never be SPA routes: dotfiles outside `/.well-known/`
 * (`/.env`, `/.git/config`) and the well-known namespace itself.
 */
function isNonSpaPath(pathname: string): boolean {
  if (pathname === "/.well-known" || pathname.startsWith("/.well-known/")) {
    return true;
  }
  return pathname
    .split("/")
    .some(segment => segment.startsWith(".") && segment.length > 1);
}

/** Proxy a landing request to the Astro dev server (dev only). */
async function proxyLandingDev(
  req: Request,
  pathname: string
): Promise<Response | null> {
  if (!landingDevUrl || !isLandingDevPath(pathname)) return null;

  try {
    const url = new URL(req.url);
    // Astro's dev server only knows the canonical routes, so aliases (`/es`)
    // are rewritten before forwarding — same result as production.
    const upstreamPath = LANDING_ALIASES[pathname] ?? url.pathname;
    const target = new URL(`${upstreamPath}${url.search}`, landingDevUrl);
    const upstream = await fetch(target, {
      headers: { accept: req.headers.get("accept") ?? "*/*" },
      signal: AbortSignal.timeout(5000),
    });
    const headers = new Headers(upstream.headers);
    // Bun already decompressed the body — the encoding headers would lie.
    headers.delete("content-encoding");
    headers.delete("content-length");
    return withSecurityHeaders(
      new Response(upstream.body, { status: upstream.status, headers })
    );
  } catch {
    // Astro dev server is not running — fall back to the static build.
    return null;
  }
}

/**
 * Handler for the routes the landing owns (`/`, `/en/`, its `/_astro` assets).
 * They are declared as their own routes instead of living in the catch-all
 * because Bun only accepts the SPA's dev HTMLBundle as the catch-all *value* —
 * a handler can only return Responses.
 */
async function handleLanding(req: Request): Promise<Response> {
  const pathname = new URL(req.url).pathname;

  const proxied = await proxyLandingDev(req, pathname);
  if (proxied) return proxied;

  const landing = serveLanding(req, pathname);
  if (landing) return landing;

  // Nothing to serve: in production fall back to the SPA exactly as the
  // pre-migration server did, in dev say what is missing.
  if (isProd) return serveSpa(req);

  return withSecurityHeaders(
    new Response(
      "Landing unavailable: start `astro dev` in packages/landing " +
        "(bun run dev) or build it with `bun run build:landing`.",
      { status: 503, headers: { "Content-Type": "text/plain" } }
    )
  );
}

if (!isProd && !landingDevUrl && !existsSync(join(landingDir, "index.html"))) {
  console.warn(
    "⚠️  Landing build not found. Run `bun run build:landing` " +
      "(or set LANDING_DEV_URL=http://localhost:4321) — the SPA answers at /."
  );
}

const server = serve({
  port: process.env.PORT || 3000,
  hostname: "0.0.0.0", // Listen on all network interfaces for Railway

  routes: {
    // API endpoint to expose public config (including VAPID public key for push)
    "/api/config": () => {
      const config = {
        supabase: {
          url: (process.env.SUPABASE_URL || "").replace(/\/+$/, ""),
          anonKey: supabasePublishableKey,
        },
        backendUrl: `${(process.env.SUPABASE_URL || "").replace(/\/+$/, "")}/functions/v1`,
        // Standalone Mastra server URL (chat / agents).
        // Falls back to localhost:4111 in dev. Auto-prefixes https://
        // when the env var is missing the protocol so the browser
        // doesn't treat it as a relative path.
        mastraServerUrl: process.env.MASTRA_SERVER_URL
          ? /^https?:\/\//i.test(process.env.MASTRA_SERVER_URL)
            ? process.env.MASTRA_SERVER_URL
            : `https://${process.env.MASTRA_SERVER_URL}`
          : "http://localhost:4111",
        // Public VAPID key for Web Push subscription — safe to expose
        vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? null,
        // Chat/assistant feature flag — defaults to enabled
        chatEnabled: process.env.CHAT_ENABLED !== "false",
        // Public URL of this app (no trailing slash). Used to build
        // absolute redirect targets (e.g. the post-payment back_url for
        // MercadoPago). Falls back to the request origin when unset so
        // local dev works out of the box.
        appUrl: (process.env.APP_URL || "").replace(/\/+$/, "") || null,
      };

      if (!config.supabase.url || !config.supabase.anonKey) {
        console.error("Missing environment variables!");
        return new Response("Server configuration error", { status: 500 });
      }

      return withSecurityHeaders(Response.json(config));
    },

    // Service worker — served from the compiled dist/ in production,
    // or from src/ in dev mode (Bun bundles it on the fly)
    "/sw.js": (req: Request) => {
      const prodPath = join(distDir, "sw.js");
      if (existsSync(prodPath)) {
        return serveStaticFile(req, prodPath, "application/javascript");
      }
      // In dev mode the SW is not pre-built — return a minimal stub so the
      // browser can register a SW without error. The real SW is built on `bun run build`.
      return withSecurityHeaders(
        new Response(
          '// Dev mode: run "bun run build" to generate the full service worker\n',
          { headers: { "Content-Type": "application/javascript" } }
        )
      );
    },

    // PWA Web App Manifest
    "/manifest.webmanifest": (req: Request) =>
      serveStaticFile(
        req,
        join(publicDir, "manifest.webmanifest"),
        "application/manifest+json"
      ),

    // PWA icons
    "/logo192.png": (req: Request) =>
      serveStaticFile(req, join(publicDir, "logo192.png"), "image/png"),
    "/logo512.png": (req: Request) =>
      serveStaticFile(req, join(publicDir, "logo512.png"), "image/png"),

    // Landing routes: `/` (Spanish), `/en/` (English), its hashed `/_astro`
    // assets and the `@vite` dev paths the proxy forwards. Declared as their
    // own routes — see `handleLanding` for why they are not in the catch-all.
    // In production the catch-all also serves any landing file (robots.txt,
    // sitemap.xml, …); add the route here only so dev matches.
    "/": handleLanding,
    "/en": handleLanding,
    "/en/": handleLanding,
    "/es": handleLanding,
    "/es/": handleLanding,
    "/_astro/*": handleLanding,
    "/logo.svg": handleLanding,
    "/robots.txt": handleLanding,
    "/sitemap.xml": handleLanding,
    "/llms.txt": handleLanding,
    "/@vite/*": handleLanding,
    "/@fs/*": handleLanding,
    "/@id/*": handleLanding,
    "/node_modules/*": handleLanding,
    "/src/styles/*": handleLanding,

    // Catch-all: in production serve static files from dist/ with SPA fallback.
    // In dev use the HTML module import so Bun's HMR works.
    "/*": isProd
      ? (req: Request) => {
          const pathname = new URL(req.url).pathname;

          // Landing first, so any file it ships (robots.txt, sitemap.xml,
          // future OG images) is served without a dedicated route. Anything
          // the landing does not have falls through to the SPA.
          const landing = serveLanding(req, pathname);
          if (landing) return landing;

          return serveSpa(req);
        }
      : devIndex,
  },

  development: !isProd && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
