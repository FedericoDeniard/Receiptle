// OAuth Callback Edge Function - Handles Google OAuth callback
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCorsPreflightRequest } from "../_shared/cors.ts";
import {
  requirePublishableKey,
  requireSecretKey,
} from "../_shared/lib/api-keys.ts";
import { encryptSecret } from "../_shared/lib/oauth-token-crypto.ts";

Deno.serve(async req => {
  const preflightResponse = handleCorsPreflightRequest(req);
  if (preflightResponse) {
    return preflightResponse;
  }

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    // Debug logs
    console.log("OAuth Callback Debug:");
    console.log("  URL:", req.url);
    console.log("  Code:", code ? "present" : "missing");
    console.log("  State:", state ? "present" : "missing");
    console.log("  Error:", error || "none");
    console.log("  Expected redirect_uri:", Deno.env.get("OAUTH_REDIRECT_URI"));

    // Handle OAuth errors
    if (error) {
      console.error("OAuth error:", error);
      const frontendUrl =
        Deno.env.get("FRONTEND_URL") || "http://localhost:3000";
      return Response.redirect(
        `${frontendUrl}/settings?error=oauth_failed&reason=${error}`,
        302
      );
    }

    if (!code) {
      console.error("Missing authorization code");
      const frontendUrl =
        Deno.env.get("FRONTEND_URL") || "http://localhost:3000";
      return Response.redirect(
        `${frontendUrl}/settings?error=oauth_failed&reason=no_code`,
        302
      );
    }

    if (!state) {
      console.error("Missing state parameter");
      const frontendUrl =
        Deno.env.get("FRONTEND_URL") || "http://localhost:3000";
      return Response.redirect(
        `${frontendUrl}/settings?error=oauth_failed&reason=no_state`,
        302
      );
    }

    // State contains the Supabase JWT token - extract user_id from it
    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      requirePublishableKey()
    );
    const {
      data: { user: authUser },
      error: authError,
    } = await supabaseAuth.auth.getUser(state);

    if (authError || !authUser) {
      console.error("Failed to verify state token:", authError);
      const frontendUrl =
        Deno.env.get("FRONTEND_URL") || "http://localhost:3000";
      return Response.redirect(
        `${frontendUrl}/settings?error=oauth_failed&reason=invalid_state`,
        302
      );
    }

    const userId = authUser.id;
    console.log("Authenticated user:", userId);

    // Exchange code for tokens
    const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
    const redirectUri =
      Deno.env.get("OAUTH_REDIRECT_URI") ||
      "http://127.0.0.1:54321/functions/v1/auth-callback";

    if (!clientId || !clientSecret) {
      console.error("Missing OAuth credentials");
      const frontendUrl =
        Deno.env.get("FRONTEND_URL") || "http://localhost:3000";
      return Response.redirect(
        `${frontendUrl}/settings?error=oauth_failed&reason=missing_credentials`,
        302
      );
    }

    // Exchange authorization code for tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("Token exchange failed:", errorText);
      const frontendUrl =
        Deno.env.get("FRONTEND_URL") || "http://localhost:3000";
      return Response.redirect(
        `${frontendUrl}/settings?error=oauth_failed&reason=token_exchange_failed`,
        302
      );
    }

    const tokens = await tokenResponse.json();

    // Get Gmail profile
    const profileResponse = await fetch(
      "https://www.googleapis.com/gmail/v1/users/me/profile",
      {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
        },
      }
    );

    if (!profileResponse.ok) {
      console.error("Failed to get Gmail profile");
      const frontendUrl =
        Deno.env.get("FRONTEND_URL") || "http://localhost:3000";
      return Response.redirect(
        `${frontendUrl}/settings?error=oauth_failed&reason=profile_failed`,
        302
      );
    }

    const profile = await profileResponse.json();
    const gmailEmail = profile.emailAddress;

    if (!gmailEmail) {
      console.error("Could not retrieve Gmail email address");
      const frontendUrl =
        Deno.env.get("FRONTEND_URL") || "http://localhost:3000";
      return Response.redirect(
        `${frontendUrl}/settings?error=oauth_failed&reason=no_email`,
        302
      );
    }

    // Hold tokens in memory for the Gmail watch setup call below; the
    // values are never persisted in plaintext (see the encrypted INSERT
    // / UPDATE further down).
    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token || null;

    // Calculate token expiration
    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null;

    // Save to database
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      requireSecretKey()
    );

    // Encrypt the new tokens before persistence. The encryption key never
    // leaves Postgres — we only ever call the encrypt_secret / decrypt_secret
    // RPCs (see supabase/migrations/20260708164517_add_oauth_token_encryption.sql).
    const newAccessEncrypted = await encryptSecret(supabase, accessToken);
    const newRefreshEncrypted = refreshToken
      ? await encryptSecret(supabase, refreshToken)
      : null;

    // Check if token already exists
    const { data: existingToken } = await supabase
      .from("user_oauth_tokens")
      .select("id, is_active, refresh_token_encrypted")
      .eq("user_id", userId)
      .eq("gmail_email", gmailEmail)
      .maybeSingle();

    if (existingToken) {
      // Update existing token
      const { error: updateError } = await supabase
        .from("user_oauth_tokens")
        .update({
          access_token_encrypted: newAccessEncrypted,
          // Persist the new encrypted refresh_token if Google rotated it;
          // otherwise keep the existing encrypted value untouched.
          refresh_token_encrypted:
            newRefreshEncrypted || existingToken.refresh_token_encrypted,
          token_type: tokens.token_type || "Bearer",
          expires_at: expiresAt,
          scope: tokens.scope || null,
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingToken.id);

      if (updateError) {
        console.error("Error updating token:", updateError);
        const frontendUrl =
          Deno.env.get("FRONTEND_URL") || "http://localhost:3000";
        return Response.redirect(
          `${frontendUrl}/settings?error=oauth_failed&reason=token_update_failed`,
          302
        );
      }

      console.log(`Reactivated existing token for ${gmailEmail}`);
    } else {
      // Create new token
      const { error: insertError } = await supabase
        .from("user_oauth_tokens")
        .insert({
          user_id: userId,
          access_token_encrypted: newAccessEncrypted,
          refresh_token_encrypted: newRefreshEncrypted,
          token_type: tokens.token_type || "Bearer",
          expires_at: expiresAt,
          scope: tokens.scope || null,
          gmail_email: gmailEmail,
          is_active: true,
        });

      if (insertError) {
        console.error("Error saving tokens:", insertError);
        const frontendUrl =
          Deno.env.get("FRONTEND_URL") || "http://localhost:3000";
        return Response.redirect(
          `${frontendUrl}/settings?error=oauth_failed&reason=token_save_failed`,
          302
        );
      }

      console.log(`Created new token for ${gmailEmail}`);
    }

    // Set up Gmail watch for real-time notifications
    const projectId = Deno.env.get("GOOGLE_PROJECT_ID");
    const pubsubTopic = Deno.env.get("PUBSUB_TOPIC") || "gmail-notifications";

    if (projectId) {
      try {
        const topicName = `projects/${projectId}/topics/${pubsubTopic}`;
        const watchResponse = await fetch(
          "https://www.googleapis.com/gmail/v1/users/me/watch",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              labelIds: ["INBOX"],
              topicName,
              labelFilterAction: "include",
            }),
          }
        );

        if (watchResponse.ok) {
          const watchData = await watchResponse.json();
          const watchExpiration = watchData.expiration
            ? new Date(parseInt(watchData.expiration)).toISOString()
            : null;

          const { error: watchError } = await supabase
            .from("gmail_watches")
            .upsert(
              {
                user_id: userId,
                gmail_email: gmailEmail,
                watch_id: watchData.historyId || null,
                topic_name: topicName,
                label_ids: ["INBOX"],
                expiration: watchExpiration,
                history_id: watchData.historyId || null,
                is_active: true,
                updated_at: new Date().toISOString(),
              },
              {
                onConflict: "user_id,gmail_email",
              }
            );

          if (watchError) {
            console.error("Error saving watch:", watchError);
          } else {
            console.log("Gmail watch configured for", gmailEmail);
          }
        } else {
          console.error(
            "Failed to set up Gmail watch:",
            await watchResponse.text()
          );
        }
      } catch (watchErr) {
        console.error("Error setting up Gmail watch:", watchErr);
      }
    } else {
      console.warn("GOOGLE_PROJECT_ID not set, skipping Gmail watch setup");
    }

    console.log(
      "Gmail OAuth completed successfully for user:",
      userId,
      "email:",
      gmailEmail
    );

    // Redirect to frontend with success
    const frontendUrl = Deno.env.get("FRONTEND_URL") || "http://localhost:3000";
    return Response.redirect(
      `${frontendUrl}/settings?success=true&email=${encodeURIComponent(gmailEmail)}`,
      302
    );
  } catch (error) {
    console.error("OAuth callback error:", error);
    const frontendUrl = Deno.env.get("FRONTEND_URL") || "http://localhost:3000";
    return Response.redirect(
      `${frontendUrl}/settings?error=oauth_failed&reason=internal_error`,
      302
    );
  }
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request GET 'http://127.0.0.1:54321/functions/v1/auth-callback?code=...&state=...'

*/
