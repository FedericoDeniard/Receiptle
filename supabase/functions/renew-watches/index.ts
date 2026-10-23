// Gmail Watch Renewal Edge Function - Renews expiring Gmail watches + proactive token health check
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireInternalAuth } from "../_shared/auth.ts";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { requireSecretKey } from "../_shared/lib/api-keys.ts";
import { createSystemNotification } from "../_shared/notifications.ts";
import {
  type OAuthTokenRow,
  GmailReconnectRequiredError,
  ensureFreshAccessToken,
  fetchGmailWithRecovery,
} from "../_shared/lib/gmail-auth.ts";
import { decryptTokenRow } from "../_shared/lib/oauth-token-crypto.ts";

Deno.serve(async req => {
  console.info("[renew-watches] Function invoked");

  const preflightResponse = handleCorsPreflightRequest(req);
  if (preflightResponse) {
    return preflightResponse;
  }
  const corsHeaders = getCorsHeaders(req);

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    console.info("[renew-watches] Checking internal auth...");
    const internalAuth = requireInternalAuth(req, corsHeaders);
    if (internalAuth instanceof Response) {
      console.info("[renew-watches] Internal auth FAILED, returning early");
      return internalAuth;
    }
    console.info("[renew-watches] Internal auth OK");

    // Initialize Supabase with the secret key
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    console.info(`[renew-watches] Supabase URL=${supabaseUrl}`);

    const supabase = createClient(supabaseUrl, requireSecretKey());

    // -----------------------------------------------------------------------
    // PHASE 1: Proactive token health check
    // Touch every active OAuth token so:
    //   - Tokens never go 6 months without use (Google revokes idle refresh tokens).
    //   - Revoked/expired tokens are detected early (not only when an email arrives).
    //   - Any new refresh_token Google rotates is captured and persisted.
    // -----------------------------------------------------------------------
    console.info(
      "[renew-watches] === PHASE 1: Proactive token health check ==="
    );

    const { data: allActiveTokens, error: tokenFetchError } = await supabase
      .from("user_oauth_tokens")
      .select(
        "id, user_id, gmail_email, access_token_encrypted, refresh_token_encrypted, expires_at, is_active, last_refresh_at, last_refresh_error"
      )
      .eq("is_active", true);

    if (tokenFetchError) {
      console.info(
        `[renew-watches] Error fetching active tokens: ${JSON.stringify(tokenFetchError)}`
      );
    } else {
      console.info(
        `[renew-watches] Found ${allActiveTokens?.length ?? 0} active token(s) to health-check`
      );

      for (const tokenRow of (allActiveTokens ?? []) as OAuthTokenRow[]) {
        try {
          // Decrypt the *_encrypted columns into the plaintext access_token /
          // refresh_token fields that ensureFreshAccessToken expects.
          await decryptTokenRow(supabase, tokenRow);
          await ensureFreshAccessToken(
            supabase,
            tokenRow,
            "proactive_token_refresh"
          );
          console.info(
            `[renew-watches] Token OK for ${tokenRow.gmail_email} (user=${tokenRow.user_id})`
          );
        } catch (error) {
          if (error instanceof GmailReconnectRequiredError) {
            // deactivateTokenAndNotify was already called inside ensureFreshAccessToken.
            console.info(
              `[renew-watches] Token deactivated for ${tokenRow.gmail_email} during health check`
            );
          } else {
            const msg = error instanceof Error ? error.message : String(error);
            console.info(
              `[renew-watches] Unexpected error during health check for ${tokenRow.gmail_email}: ${msg}`
            );
          }
        }
      }
    }

    console.info("[renew-watches] === PHASE 1 complete ===");

    // -----------------------------------------------------------------------
    // PHASE 2: Renew expiring Gmail watches
    // -----------------------------------------------------------------------

    // Get watches that expire in the next 48 hours
    const fortyEightHoursFromNow = new Date(
      Date.now() + 48 * 60 * 60 * 1000
    ).toISOString();
    console.info(
      `[renew-watches] Looking for active watches expiring before ${fortyEightHoursFromNow}`
    );

    const { data: expiringWatches, error: fetchError } = await supabase
      .from("gmail_watches")
      .select("*")
      .eq("is_active", true)
      .lt("expiration", fortyEightHoursFromNow);

    if (fetchError) {
      console.info(
        `[renew-watches] Error fetching expiring watches: ${JSON.stringify(fetchError)}`
      );
      console.error("Error fetching expiring watches:", fetchError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch expiring watches" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.info(
      `[renew-watches] Found ${expiringWatches?.length ?? 0} expiring watches`
    );

    if (!expiringWatches || expiringWatches.length === 0) {
      return new Response(
        JSON.stringify({ message: "No watches to renew", renewed: 0 }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Log all watches found
    for (const w of expiringWatches) {
      console.info(
        `[renew-watches] Watch: id=${w.id} email=${w.gmail_email} user=${w.user_id} expiration=${w.expiration} topic=${w.topic_name} is_active=${w.is_active}`
      );
    }

    let renewedCount = 0;
    let failedCount = 0;
    const results: {
      email: string;
      status: string;
      expiration?: string;
      error?: string;
    }[] = [];

    for (const watch of expiringWatches) {
      console.info(
        `[renew-watches] --- Processing watch for ${watch.gmail_email} (id=${watch.id}) ---`
      );

      try {
        console.info(
          `[renew-watches] Creating expiring notification for ${watch.gmail_email}`
        );
        try {
          await createSystemNotification({
            typeKey: "gmail_watch_expiring",
            userId: watch.user_id,
            actionPath: "/settings",
            iconKey: "mail",
            i18nParams: { email: watch.gmail_email },
            metadata: {
              gmailEmail: watch.gmail_email,
              expiration: watch.expiration,
            },
            dedupeKey: `watch-expiring-${watch.user_id}-${watch.gmail_email}`,
            dedupeWindowMinutes: 360,
            importance: "normal",
          });
          console.info(
            `[renew-watches] Notification created for ${watch.gmail_email}`
          );
        } catch (notifError) {
          const notifMsg =
            notifError instanceof Error
              ? notifError.message
              : String(notifError);
          console.info(
            `[renew-watches] WARNING: Failed to create expiring notification for ${watch.gmail_email} (non-fatal): ${notifMsg}`
          );
        }

        // Get user tokens
        console.info(
          `[renew-watches] Fetching OAuth tokens for user=${watch.user_id} email=${watch.gmail_email}`
        );
        const { data: tokenData, error: tokenError } = await supabase
          .from("user_oauth_tokens")
          .select(
            "id, user_id, gmail_email, access_token_encrypted, refresh_token_encrypted, expires_at, is_active, last_refresh_at, last_refresh_error"
          )
          .eq("user_id", watch.user_id)
          .eq("gmail_email", watch.gmail_email)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();

        if (tokenError) {
          console.info(
            `[renew-watches] Error fetching token for ${watch.gmail_email}: ${JSON.stringify(tokenError)}`
          );
        }

        if (!tokenData) {
          console.info(
            `[renew-watches] No active OAuth token found for ${watch.gmail_email}`
          );
          await createSystemNotification({
            typeKey: "gmail_watch_renew_failed",
            userId: watch.user_id,
            actionPath: "/settings",
            iconKey: "mail",
            i18nParams: { email: watch.gmail_email },
            metadata: {
              gmailEmail: watch.gmail_email,
              reason: "No active OAuth tokens found",
            },
            dedupeKey: `watch-renew-failed-${watch.user_id}-${watch.gmail_email}-no-token`,
            dedupeWindowMinutes: 180,
          });

          results.push({
            email: watch.gmail_email,
            status: "no_tokens",
            error: "No active OAuth tokens found",
          });
          failedCount++;
          continue;
        }

        // Decrypt the *_encrypted columns into the plaintext access_token /
        // refresh_token fields that ensureFreshAccessToken expects.
        const oauthToken = tokenData as OAuthTokenRow;
        await decryptTokenRow(supabase, oauthToken);

        console.info(
          `[renew-watches] Token found: tokenId=${oauthToken.id} has_access_token=${!!oauthToken.access_token} has_refresh_token=${!!oauthToken.refresh_token} expires_at=${oauthToken.expires_at} is_active=${oauthToken.is_active}`
        );

        console.info(
          `[renew-watches] Ensuring fresh access token for ${watch.gmail_email}`
        );
        await ensureFreshAccessToken(
          supabase,
          oauthToken,
          "renew_watch_preflight"
        );
        console.info(
          `[renew-watches] Access token is fresh for ${watch.gmail_email}`
        );

        const watchRequestBody = {
          labelIds: ["INBOX"],
          topicName: watch.topic_name,
          labelFilterAction: "include",
        };
        console.info(
          `[renew-watches] Calling Gmail watch API for ${watch.gmail_email} with body: ${JSON.stringify(watchRequestBody)}`
        );

        const watchResponse = await fetchGmailWithRecovery(
          supabase,
          oauthToken,
          "https://www.googleapis.com/gmail/v1/users/me/watch",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(watchRequestBody),
          },
          "renew_watch"
        );

        console.info(
          `[renew-watches] Gmail watch API response status: ${watchResponse.status}`
        );

        if (!watchResponse.ok) {
          const errorText = await watchResponse.text();
          console.info(
            `[renew-watches] Gmail API error for ${watch.gmail_email}: status=${watchResponse.status} body=${errorText}`
          );
          throw new Error(
            `Gmail watch API failed (${watchResponse.status}): ${errorText}`
          );
        }

        const watchData = await watchResponse.json();
        console.info(
          `[renew-watches] Gmail watch API success for ${watch.gmail_email}: ${JSON.stringify(watchData)}`
        );

        // Update watch in database
        const watchExpiration = watchData.expiration
          ? new Date(parseInt(watchData.expiration)).toISOString()
          : null;

        console.info(
          `[renew-watches] Updating watch in DB for ${watch.gmail_email}: expiration=${watchExpiration} historyId=${watchData.historyId}`
        );

        const { error: updateError } = await supabase
          .from("gmail_watches")
          .update({
            watch_id: watchData.historyId || null,
            expiration: watchExpiration,
            history_id: watchData.historyId || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", watch.id);

        if (updateError) {
          console.info(
            `[renew-watches] Error updating watch in DB: ${JSON.stringify(updateError)}`
          );
          throw updateError;
        }

        console.info(
          `[renew-watches] Watch renewed successfully for ${watch.gmail_email}`
        );

        try {
          await createSystemNotification({
            typeKey: "gmail_watch_renewed",
            userId: watch.user_id,
            actionPath: null,
            iconKey: "mail",
            i18nParams: { email: watch.gmail_email },
            metadata: {
              gmailEmail: watch.gmail_email,
              expiration: watchExpiration,
            },
            dedupeKey: `watch-renewed-${watch.user_id}-${watch.gmail_email}`,
            dedupeWindowMinutes: 360,
            importance: "low",
          });
          console.info(
            `[renew-watches] Renewed notification created for ${watch.gmail_email}`
          );
        } catch (notifError) {
          const notifMsg =
            notifError instanceof Error
              ? notifError.message
              : String(notifError);
          console.info(
            `[renew-watches] WARNING: Failed to create renewed notification for ${watch.gmail_email} (non-fatal): ${notifMsg}`
          );
        }

        renewedCount++;
        results.push({
          email: watch.gmail_email,
          status: "renewed",
          expiration: watchExpiration || undefined,
        });
      } catch (error) {
        if (error instanceof GmailReconnectRequiredError) {
          console.info(
            `[renew-watches] GmailReconnectRequired for ${watch.gmail_email}: credentials expired, deleting watch and disconnecting.`
          );
          const { error: deleteWatchError } = await supabase
            .from("gmail_watches")
            .delete()
            .eq("user_id", watch.user_id)
            .eq("gmail_email", watch.gmail_email);

          if (deleteWatchError) {
            console.info(
              `[renew-watches] Error deleting watch: ${JSON.stringify(deleteWatchError)}`
            );
            console.error(
              `Failed to delete watch for ${watch.gmail_email}:`,
              deleteWatchError
            );
          }

          results.push({
            email: watch.gmail_email,
            status: "disconnected",
            error:
              "Invalid Gmail credentials. Account disconnected; user must reconnect.",
          });
          failedCount++;
          continue;
        }

        const errorMsg = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        const errorName = error instanceof Error ? error.name : typeof error;
        console.info(
          `[renew-watches] CATCH ERROR for ${watch.gmail_email}: name=${errorName} message=${errorMsg}`
        );
        if (errorStack) {
          console.info(`[renew-watches] Stack trace: ${errorStack}`);
        }
        // Log the raw error object in case it has non-standard properties
        try {
          console.info(
            `[renew-watches] Raw error serialized: ${JSON.stringify(error)}`
          );
        } catch {
          console.info(
            `[renew-watches] Raw error (not serializable): ${String(error)}`
          );
        }
        console.error(`Failed to renew watch for ${watch.gmail_email}:`, error);
        await createSystemNotification({
          typeKey: "gmail_watch_renew_failed",
          userId: watch.user_id,
          actionPath: "/settings",
          iconKey: "mail",
          i18nParams: { email: watch.gmail_email },
          metadata: {
            gmailEmail: watch.gmail_email,
            reason: error instanceof Error ? error.message : "Unknown error",
          },
          dedupeKey: `watch-renew-failed-${watch.user_id}-${watch.gmail_email}`,
          dedupeWindowMinutes: 180,
          importance: "high",
        });

        results.push({
          email: watch.gmail_email,
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown error",
        });
        failedCount++;
      }
    }

    console.info(
      `[renew-watches] ===== SUMMARY: token_health_check=${allActiveTokens?.length ?? 0} checked | watches: ${renewedCount} renewed, ${failedCount} failed =====`
    );
    for (const r of results) {
      console.info(
        `[renew-watches] RESULT: email=${r.email} status=${r.status} error=${r.error ?? "none"} expiration=${r.expiration ?? "n/a"}`
      );
    }
    console.info(
      `[renew-watches] Full results JSON: ${JSON.stringify(results)}`
    );

    return new Response(
      JSON.stringify({
        message: "Watch renewal completed",
        token_health_check: allActiveTokens?.length ?? 0,
        renewed: renewedCount,
        failed: failedCount,
        results,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.info(`[renew-watches] TOP-LEVEL CATCH ERROR: ${errorMsg}`);
    if (errorStack) {
      console.info(`[renew-watches] Stack trace: ${errorStack}`);
    }
    console.error("Watch renewal error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
