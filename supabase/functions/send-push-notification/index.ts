// Send Push Notification Edge Function
// Triggered by the dispatch_push_notification SQL trigger after each
// INSERT on public.notifications. Reads user preferences and sends
// Web Push messages to all subscribed devices for that user.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  ApplicationServer,
  importVapidKeys,
  PushMessageError,
  type ExportedVapidKeys,
} from "jsr:@negrel/webpush@0.5";
import { requireInternalAuth } from "../_shared/auth.ts";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { requireSecretKey } from "../_shared/lib/api-keys.ts";

// ─── i18n resolution ─────────────────────────────────────────────────────────
// The notification rows store i18n keys (e.g. "notifications.templates.seed_completed_with_transactions.title").
// The service worker has no access to the app's translation system, so we
// resolve the English text here before sending the push payload.

const TEMPLATES: Record<string, { title: string; body: string }> = {
  seed_completed_with_transactions: {
    title: "Import completed",
    body: "{{count}} new transaction(s) found while processing {{totalEmails}} emails.",
  },
  seed_completed_no_new: {
    title: "Import completed",
    body: "No new transactions found after processing {{totalEmails}} emails.",
  },
  seed_failed: {
    title: "Import failed",
    body: "We couldn't process your emails. Reason: {{reason}}.",
  },
  gmail_reconnect_required: {
    title: "Reconnect your Gmail account",
    body: "The account {{email}} requires reconnection to continue syncing.",
  },
  gmail_watch_expiring: {
    title: "Gmail subscription expiring soon",
    body: "The subscription for {{email}} is close to expiration.",
  },
  gmail_watch_renew_failed: {
    title: "Could not renew Gmail subscription",
    body: "Automatic renewal for {{email}} failed.",
  },
  gmail_watch_renewed: {
    title: "Gmail watch renewed",
    body: "The subscription for {{email}} was automatically renewed.",
  },
  gmail_sync_error: {
    title: "Gmail sync error",
    body: "There was an error syncing {{email}}. {{reason}}",
  },
  new_transaction: {
    title: "New transaction",
    body: "{{merchant}} · {{currency}} {{amount}}",
  },
};

/**
 * Extracts the notification type key from an i18n key like:
 * "notifications.templates.seed_completed_with_transactions.title" → "seed_completed_with_transactions"
 */
function extractTypeKey(i18nKey: string): string {
  // Key format: notifications.templates.<type_key>.title|body
  const parts = i18nKey.split(".");
  const templatesIdx = parts.indexOf("templates");
  if (templatesIdx !== -1 && parts[templatesIdx + 1]) {
    return parts[templatesIdx + 1];
  }
  return "";
}

/**
 * Interpolates {{variable}} placeholders in a template string.
 */
function interpolate(
  template: string,
  params: Record<string, unknown>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    params[key] !== undefined ? String(params[key]) : `{{${key}}}`
  );
}

/**
 * Resolves the human-readable title and body from i18n keys + params.
 * Falls back to the raw key if no template is found.
 */
function resolveText(
  titleKey: string,
  bodyKey: string,
  params: Record<string, unknown>
): { title: string; body: string } {
  const typeKey = extractTypeKey(titleKey);
  const template = TEMPLATES[typeKey];

  if (!template) {
    return { title: titleKey, body: bodyKey };
  }

  return {
    title: interpolate(template.title, params),
    body: interpolate(template.body, params),
  };
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface RequestPayload {
  notification_id: string;
  user_id: string;
}

interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface NotificationRow {
  id: string;
  user_id: string;
  title_i18n_key: string;
  body_i18n_key: string;
  i18n_params: Record<string, unknown>;
  action_path: string | null;
  notification_types: {
    id: string;
    key: string;
  } | null;
}

interface UserPreferenceRow {
  is_enabled: boolean;
  is_muted: boolean;
  muted_until: string | null;
}

// ─── VAPID helpers ────────────────────────────────────────────────────────────

// Module-level singleton so we only import the keys once per function cold start
let appServerInstance: ApplicationServer | null = null;

/**
 * Decodes a base64url string to a Uint8Array.
 */
function decodeBase64Url(input: string): Uint8Array {
  // Convert base64url to standard base64
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(
    base64.length + ((4 - (base64.length % 4)) % 4),
    "="
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

/**
 * Encodes a Uint8Array to a base64url string.
 */
function encodeBase64Url(input: Uint8Array): string {
  return btoa(String.fromCharCode(...input))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Builds a CryptoKeyPair from raw base64url VAPID key strings.
 * The public key is an uncompressed P-256 point (65 bytes: 0x04 || x || y).
 * The private key is the 32-byte scalar.
 */
async function buildVapidKeyPair(
  publicKeyBase64url: string,
  privateKeyBase64url: string
): Promise<CryptoKeyPair> {
  const rawPublic = decodeBase64Url(publicKeyBase64url);

  // Extract x and y from the uncompressed point (skip the 0x04 prefix byte)
  const x = encodeBase64Url(rawPublic.slice(1, 33));
  const y = encodeBase64Url(rawPublic.slice(33, 65));

  const keys: ExportedVapidKeys = {
    publicKey: { kty: "EC", crv: "P-256", x, y },
    privateKey: { kty: "EC", crv: "P-256", x, y, d: privateKeyBase64url },
  };

  return importVapidKeys(keys, { extractable: false });
}

/**
 * Returns (and caches) the ApplicationServer singleton.
 */
async function getAppServer(): Promise<ApplicationServer> {
  if (appServerInstance) return appServerInstance;

  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const email = Deno.env.get("VAPID_EMAIL") ?? "mailto:fededeniard@gmail.com";

  if (!publicKey || !privateKey) {
    throw new Error("VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set");
  }

  const keyPair = await buildVapidKeyPair(publicKey, privateKey);
  appServerInstance = await ApplicationServer.new({
    vapidKeys: keyPair,
    contactInformation: email,
  });
  return appServerInstance;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async req => {
  const preflightResponse = handleCorsPreflightRequest(req);
  if (preflightResponse) return preflightResponse;

  const corsHeaders = getCorsHeaders(req);

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Only accept calls from the internal trigger (via INTERNAL_FUNCTIONS_SECRET)
  const auth = requireInternalAuth(req, corsHeaders);
  if (auth instanceof Response) return auth;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    requireSecretKey()
  );

  try {
    const { notification_id, user_id } = (await req.json()) as RequestPayload;

    if (!notification_id || !user_id) {
      return new Response(
        JSON.stringify({ error: "notification_id and user_id are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ── 1. Fetch the notification with its type ──────────────────────────────
    const { data: notification, error: notifError } = await supabase
      .from("notifications")
      .select(`
        id,
        user_id,
        title_i18n_key,
        body_i18n_key,
        i18n_params,
        action_path,
        notification_types (
          id,
          key
        )
      `)
      .eq("id", notification_id)
      .eq("user_id", user_id)
      .maybeSingle<NotificationRow>();

    if (notifError || !notification) {
      console.error("[send-push-notification] Notification not found", {
        notification_id,
        user_id,
        notifError,
      });
      return new Response(JSON.stringify({ error: "Notification not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 2. Check user preferences ────────────────────────────────────────────
    // If the user has explicitly disabled this notification type, skip push.
    // Default is to deliver (true) when no preference row exists.
    if (notification.notification_types?.id) {
      const { data: preference } = await supabase
        .from("user_notification_preferences")
        .select("is_enabled, is_muted, muted_until")
        .eq("user_id", user_id)
        .eq("notification_type_id", notification.notification_types.id)
        .maybeSingle<UserPreferenceRow>();

      if (preference) {
        const isEnabled = preference.is_enabled;
        const isMuted = preference.is_muted;
        const mutedUntil = preference.muted_until
          ? new Date(preference.muted_until)
          : null;
        const hasMuteWindow = mutedUntil
          ? mutedUntil.getTime() > Date.now()
          : false;
        const mutedIndefinitely = isMuted && !mutedUntil;

        if (!isEnabled || mutedIndefinitely || hasMuteWindow) {
          console.info("[send-push-notification] Skipped by user preference", {
            notification_id,
            user_id,
          });
          return new Response(
            JSON.stringify({ success: true, status: "skipped_by_preference" }),
            {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
      }
    }

    // ── 3. Fetch all push subscriptions for this user ────────────────────────
    const { data: subscriptions, error: subError } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", user_id);

    if (subError) {
      console.error("[send-push-notification] Error fetching subscriptions", {
        user_id,
        subError,
      });
      return new Response(
        JSON.stringify({ error: "Failed to fetch push subscriptions" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!subscriptions || subscriptions.length === 0) {
      // User has no push subscriptions — nothing to do
      return new Response(
        JSON.stringify({ success: true, status: "no_subscriptions" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ── 4. Build the push payload ────────────────────────────────────────────
    // Resolve i18n keys to human-readable English text before sending,
    // since the service worker has no access to the app's translation system.
    const { title, body } = resolveText(
      notification.title_i18n_key,
      notification.body_i18n_key,
      (notification.i18n_params ?? {}) as Record<string, unknown>
    );

    const pushPayload = JSON.stringify({
      title,
      body,
      url: notification.action_path ?? "/",
    });

    // ── 5. Send to all subscriptions in parallel ─────────────────────────────
    const appServer = await getAppServer();
    const expiredEndpoints: string[] = [];
    let sent = 0;
    let failed = 0;

    await Promise.allSettled(
      (subscriptions as PushSubscriptionRow[]).map(async sub => {
        try {
          const subscriber = appServer.subscribe({
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          });
          await subscriber.pushTextMessage(pushPayload, {});
          sent++;
        } catch (err) {
          // @negrel/webpush throws PushMessageError with an empty `message`
          // and no top-level `status`; the push service response lives at
          // `err.response`. Read the status from there (and use toString(),
          // which includes status + statusText) so expired subscriptions are
          // actually detected and 4xx failures are debuggable.
          if (err instanceof PushMessageError) {
            const status = err.response.status;
            if (status === 410 || status === 404) {
              // Subscription is expired or gone — queue for cleanup
              expiredEndpoints.push(sub.endpoint);
            } else {
              console.error("[send-push-notification] Push delivery error", {
                endpoint: sub.endpoint,
                status,
                statusText: err.response.statusText,
                error: err.toString(),
              });
              failed++;
            }
          } else {
            const msg = err instanceof Error ? err.message : String(err);
            console.error("[send-push-notification] Push delivery error", {
              endpoint: sub.endpoint,
              error: msg,
            });
            failed++;
          }
        }
      })
    );

    // ── 6. Clean up expired subscriptions ───────────────────────────────────
    if (expiredEndpoints.length > 0) {
      const { error: cleanupError } = await supabase
        .from("push_subscriptions")
        .delete()
        .in("endpoint", expiredEndpoints);

      if (cleanupError) {
        console.error(
          "[send-push-notification] Failed to clean up expired subscriptions",
          cleanupError
        );
      } else {
        console.info(
          "[send-push-notification] Cleaned up expired subscriptions",
          {
            count: expiredEndpoints.length,
          }
        );
      }
    }

    console.info("[send-push-notification] Done", {
      notification_id,
      user_id,
      sent,
      failed,
      expired: expiredEndpoints.length,
    });

    return new Response(
      JSON.stringify({
        success: true,
        sent,
        failed,
        expired: expiredEndpoints.length,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[send-push-notification] Unhandled error", msg);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
