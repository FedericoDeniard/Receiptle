/**
 * This file is the entry point for the React app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 */

import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import { App } from "./App";
import { APP_VERSION } from "./lib/version";

document.title =
  process.env.NODE_ENV === "production" ? "Receiptle" : "Receiptle - Dev";

if (process.env.NODE_ENV !== "production") {
  import("react-grab");
}

if (process.env.NODE_ENV === "production") {
  Sentry.init({
    dsn: "https://f7412c2f69834bacbcb32d504da177b6@glitchtip-web-production-dbe1.up.railway.app/1",
    environment: "production",
    release: APP_VERSION,
    tracesSampleRate: 0.01,
    // Sentry v11 dropped `sendDefaultPii` in favor of a granular
    // `dataCollection` option whose v11 defaults are more permissive
    // (http bodies, user info, gen_ai inputs/outputs …). GlitchTip is the
    // ingest here, so keep the v10-like restrictive defaults to avoid
    // leaking auth tokens from request bodies.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: {
        request: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] },
        response: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] },
      },
      httpBodies: [],
      urlQueryParams: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
    },
    // GlitchTip implements a subset of Sentry's API and may not parse the
    // new `span` envelope items that span streaming produces. Keep the
    // legacy transaction-based pipeline so traces still render.
    traceLifecycle: "static",
    attachStacktrace: true,
    beforeSend(event) {
      const headers = event.request?.headers as
        | Record<string, string>
        | undefined;
      if (headers) {
        for (const key of Object.keys(headers)) {
          const lower = key.toLowerCase();
          if (
            lower === "authorization" ||
            lower === "cookie" ||
            lower === "apikey"
          ) {
            delete headers[key];
          }
        }
      }
      if (event.request?.cookies) {
        delete event.request.cookies;
      }
      return event;
    },
  });
}

function start() {
  const root = createRoot(document.getElementById("root")!);
  root.render(<App />);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
