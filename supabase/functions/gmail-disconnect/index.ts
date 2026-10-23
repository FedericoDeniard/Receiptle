// Gmail Disconnect Edge Function - Handles Gmail disconnection
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireMinRole, requireUserAuth } from "../_shared/auth.ts";
import { requireCapability } from "../_shared/capabilities.ts";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { requireSecretKey } from "../_shared/lib/api-keys.ts";
import { type OAuthTokenRow } from "../_shared/lib/gmail-auth.ts";
import { decryptTokenRow } from "../_shared/lib/oauth-token-crypto.ts";

const corsHeaderOverrides = {
  "Access-Control-Allow-Methods": "DELETE, OPTIONS",
};

Deno.serve(async req => {
  const preflightResponse = handleCorsPreflightRequest(
    req,
    corsHeaderOverrides
  );
  if (preflightResponse) {
    return preflightResponse;
  }
  const corsHeaders = getCorsHeaders(req, corsHeaderOverrides);

  try {
    // Only allow DELETE method
    if (req.method !== "DELETE") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get connection ID from URL
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/");
    const connectionId = pathParts[pathParts.length - 1];

    if (!connectionId) {
      return new Response(JSON.stringify({ error: "Missing connection ID" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const auth = await requireUserAuth(req, corsHeaders);
    if (auth instanceof Response) {
      return auth;
    }
    const { user } = auth;

    const roleCheck = requireMinRole(auth, "gmailConnect", corsHeaders);
    if (roleCheck instanceof Response) {
      return roleCheck;
    }

    const cap = await requireCapability(auth, "gmail_sync", corsHeaders);
    if (cap instanceof Response) {
      return cap;
    }

    // Use service role for DB operations
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      requireSecretKey()
    );

    // Get the token data first and verify ownership. Select the encrypted
    // columns (plaintext columns are NULL after MON-18) and decrypt in memory
    // to call gmail/v1/users/me/stop below.
    const { data, error: fetchError } = await supabase
      .from("user_oauth_tokens")
      .select(
        "id, user_id, gmail_email, access_token_encrypted, refresh_token_encrypted, expires_at, is_active"
      )
      .eq("id", connectionId)
      .eq("user_id", user.id)
      .single();

    if (fetchError || !data) {
      return new Response(
        JSON.stringify({ error: "Connection not found or unauthorized" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const tokenData = data as OAuthTokenRow;
    await decryptTokenRow(supabase, tokenData);

    // Check if there are other users with the same Gmail account
    const { data: otherTokens } = await supabase
      .from("user_oauth_tokens")
      .select("id")
      .eq("gmail_email", tokenData.gmail_email)
      .eq("is_active", true)
      .neq("id", connectionId);

    const hasOtherUsers = otherTokens && otherTokens.length > 0;

    // Only stop the Gmail watch if this is the last user with this account
    if (!hasOtherUsers) {
      try {
        const accessToken = tokenData.access_token;
        await fetch("https://www.googleapis.com/gmail/v1/users/me/stop", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        console.log(`Watch stopped for ${tokenData.gmail_email} (last user)`);
      } catch (error) {
        console.warn("Could not stop watch (may not exist)", error);
      }

      // Delete ALL Gmail watches for this email
      await supabase
        .from("gmail_watches")
        .delete()
        .eq("gmail_email", tokenData.gmail_email);
    } else {
      console.log(
        `Not stopping watch for ${tokenData.gmail_email} (${otherTokens.length} other user(s) still connected)`
      );

      // Only delete watches for THIS user
      await supabase
        .from("gmail_watches")
        .delete()
        .eq("gmail_email", tokenData.gmail_email)
        .eq("user_id", user.id);
    }

    // Soft delete: Mark token as inactive instead of deleting
    const { error: updateError } = await supabase
      .from("user_oauth_tokens")
      .update({
        is_active: false,
        expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", connectionId)
      .eq("user_id", user.id);

    if (updateError) {
      console.error("Error deactivating token:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to disconnect Gmail" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(
      `Token deactivated for user ${user.id}, transactions preserved`
    );

    return new Response(
      JSON.stringify({
        success: true,
        message: "Gmail disconnected successfully",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Gmail disconnect error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
