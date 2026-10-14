import { createSystemNotification } from "../notifications.ts";
import { getGoogleOAuthConfig } from "./config.ts";
import { encryptSecret } from "./oauth-token-crypto.ts";

export type OAuthTokenRow = {
  id: string;
  user_id: string;
  gmail_email: string | null;
  // Plaintext in memory after decryptTokenRow; never read from the DB
  // (the DB only stores *_encrypted).
  access_token: string | null;
  refresh_token: string | null;
  // base64 BYTEA as returned by PostgREST; decrypted by decryptTokenRow.
  access_token_encrypted?: string | null;
  refresh_token_encrypted?: string | null;
  expires_at: string | null;
  is_active?: boolean;
  last_refresh_at?: string | null;
  last_refresh_error?: string | null;
};

export class GmailReconnectRequiredError extends Error {
  code = "GMAIL_RECONNECT_REQUIRED" as const;
}

export async function deactivateTokenAndNotify(
  supabase: any,
  tokenData: OAuthTokenRow,
  reason: string,
  stage: string
) {
  console.info(
    `[gmail-auth] deactivateTokenAndNotify called for email=${tokenData.gmail_email} reason=${reason} stage=${stage}`
  );

  // Insert audit log FIRST — before any other operation — so we always have
  // a persistent record of why and where the token was deactivated,
  // even if subsequent steps fail. Edge function logs expire; this table doesn't.
  const { error: logError } = await supabase
    .from("token_deactivation_log")
    .insert({
      token_id: tokenData.id,
      user_id: tokenData.user_id,
      gmail_email: tokenData.gmail_email,
      reason,
      stage,
    });

  if (logError) {
    console.info(
      `[gmail-auth] WARNING: Failed to insert token_deactivation_log for ${tokenData.gmail_email}: ${JSON.stringify(logError)}`
    );
  } else {
    console.info(
      `[gmail-auth] token_deactivation_log inserted for ${tokenData.gmail_email}`
    );
  }

  const { error: deactivateError } = await supabase
    .from("user_oauth_tokens")
    .update({
      is_active: false,
      last_refresh_error: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", tokenData.id)
    .eq("user_id", tokenData.user_id);

  if (deactivateError) {
    console.info(
      `[gmail-auth] Error deactivating token for ${tokenData.gmail_email}: ${JSON.stringify(deactivateError)}`
    );
  } else {
    console.info(
      `[gmail-auth] Token deactivated successfully for ${tokenData.gmail_email}`
    );
  }

  try {
    await createSystemNotification({
      typeKey: "gmail_reconnect_required",
      userId: tokenData.user_id,
      actionPath: "/settings",
      iconKey: "mail",
      i18nParams: { email: tokenData.gmail_email || "Gmail" },
      metadata: {
        gmailEmail: tokenData.gmail_email,
        reason,
        stage,
        tokenId: tokenData.id,
      },
      dedupeKey: `gmail-reconnect-required-${tokenData.user_id}-${tokenData.gmail_email || tokenData.id}`,
      dedupeWindowMinutes: 360,
      importance: "high",
    });
    console.info(
      `[gmail-auth] Notification sent for deactivated token ${tokenData.gmail_email}`
    );
  } catch (notifError) {
    console.info(
      `[gmail-auth] WARNING: Failed to send reconnect notification for ${tokenData.gmail_email}: ${notifError instanceof Error ? notifError.message : String(notifError)}`
    );
  }
}

export async function refreshAccessToken(
  supabase: any,
  tokenData: OAuthTokenRow
): Promise<{ ok: true } | { ok: false; reason: string }> {
  console.info(
    `[gmail-auth] refreshAccessToken called for email=${tokenData.gmail_email} tokenId=${tokenData.id}`
  );

  if (!tokenData.refresh_token) {
    console.info(
      `[gmail-auth] No refresh_token found for ${tokenData.gmail_email}`
    );
    const reason = "missing_refresh_token";
    await supabase
      .from("user_oauth_tokens")
      .update({
        last_refresh_error: reason,
        updated_at: new Date().toISOString(),
      })
      .eq("id", tokenData.id);
    return { ok: false, reason };
  }

  const oauthConfig = getGoogleOAuthConfig();
  if (!oauthConfig.clientId || !oauthConfig.clientSecret) {
    console.info(
      `[gmail-auth] Missing Google OAuth config: clientId=${!!oauthConfig.clientId} clientSecret=${!!oauthConfig.clientSecret}`
    );
    const reason = "missing_google_oauth_config";
    await supabase
      .from("user_oauth_tokens")
      .update({
        last_refresh_error: reason,
        updated_at: new Date().toISOString(),
      })
      .eq("id", tokenData.id);
    return { ok: false, reason };
  }

  console.info(
    `[gmail-auth] Sending refresh token request to Google for ${tokenData.gmail_email}`
  );
  const refreshResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: oauthConfig.clientId,
      client_secret: oauthConfig.clientSecret,
      refresh_token: tokenData.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!refreshResponse.ok) {
    const reason = await refreshResponse.text();
    console.info(
      `[gmail-auth] Token refresh FAILED for ${tokenData.gmail_email}: status=${refreshResponse.status} body=${reason}`
    );
    await supabase
      .from("user_oauth_tokens")
      .update({
        last_refresh_error: `refresh_failed:${reason}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", tokenData.id);
    return { ok: false, reason: `refresh_failed:${reason}` };
  }

  const refreshData = await refreshResponse.json();
  const newExpiresAt = refreshData.expires_in
    ? new Date(Date.now() + refreshData.expires_in * 1000).toISOString()
    : null;
  const now = new Date().toISOString();

  console.info(
    `[gmail-auth] Token refresh SUCCESS for ${tokenData.gmail_email}: new_expires_at=${newExpiresAt} has_access_token=${!!refreshData.access_token} has_new_refresh_token=${!!refreshData.refresh_token}`
  );

  const newAccessEncrypted = await encryptSecret(
    supabase,
    refreshData.access_token
  );
  const newRefreshEncrypted = refreshData.refresh_token
    ? await encryptSecret(supabase, refreshData.refresh_token)
    : null;

  const { error: updateError } = await supabase
    .from("user_oauth_tokens")
    .update({
      access_token_encrypted: newAccessEncrypted,
      // Persist rotated refresh_token if Google returned one; keep existing otherwise.
      ...(newRefreshEncrypted && {
        refresh_token_encrypted: newRefreshEncrypted,
      }),
      expires_at: newExpiresAt,
      is_active: true,
      last_refresh_at: now,
      last_refresh_error: null,
      updated_at: now,
    })
    .eq("id", tokenData.id);

  if (updateError) {
    console.info(
      `[gmail-auth] Error updating token in DB for ${tokenData.gmail_email}: ${JSON.stringify(updateError)}`
    );
  }

  tokenData.access_token = refreshData.access_token;
  if (refreshData.refresh_token) {
    tokenData.refresh_token = refreshData.refresh_token;
  }
  tokenData.access_token_encrypted = newAccessEncrypted;
  if (newRefreshEncrypted) {
    tokenData.refresh_token_encrypted = newRefreshEncrypted;
  }
  tokenData.expires_at = newExpiresAt;
  tokenData.is_active = true;
  tokenData.last_refresh_at = now;
  tokenData.last_refresh_error = null;
  return { ok: true };
}

export async function ensureFreshAccessToken(
  supabase: any,
  tokenData: OAuthTokenRow,
  stage: string
) {
  const now = new Date();
  const expiresAt = tokenData.expires_at
    ? new Date(tokenData.expires_at)
    : null;

  console.info(
    `[gmail-auth] ensureFreshAccessToken for ${tokenData.gmail_email}: stage=${stage} has_access_token=${!!tokenData.access_token} expires_at=${tokenData.expires_at} now=${now.toISOString()} expired=${expiresAt ? now >= expiresAt : "no_expiry"}`
  );

  if (!tokenData.access_token || (expiresAt && now >= expiresAt)) {
    console.info(
      `[gmail-auth] Token needs refresh for ${tokenData.gmail_email} (no_token=${!tokenData.access_token} expired=${expiresAt ? now >= expiresAt : false})`
    );
    const refreshed = await refreshAccessToken(supabase, tokenData);
    if (!refreshed.ok) {
      console.info(
        `[gmail-auth] Refresh failed for ${tokenData.gmail_email}: ${refreshed.reason} — will deactivate and throw GmailReconnectRequiredError`
      );
      await deactivateTokenAndNotify(
        supabase,
        tokenData,
        refreshed.reason,
        stage
      );
      throw new GmailReconnectRequiredError(
        "Gmail authentication expired. Reconnect your account."
      );
    }
    console.info(
      `[gmail-auth] Token refreshed successfully for ${tokenData.gmail_email}`
    );
  } else {
    console.info(
      `[gmail-auth] Token still valid for ${tokenData.gmail_email}, no refresh needed`
    );
  }
}

export async function fetchGmailWithRecovery(
  supabase: any,
  tokenData: OAuthTokenRow,
  input: string,
  init: RequestInit,
  stage: string
) {
  console.info(
    `[gmail-auth] fetchGmailWithRecovery: url=${input} stage=${stage} email=${tokenData.gmail_email}`
  );

  await ensureFreshAccessToken(supabase, tokenData, `${stage}_preflight`);

  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${tokenData.access_token}`);

  console.info(`[gmail-auth] Making initial Gmail API request to ${input}`);
  let response = await fetch(input, { ...init, headers });
  console.info(`[gmail-auth] Initial response: status=${response.status}`);

  if (response.status !== 401) return response;

  console.info(
    `[gmail-auth] Got 401, attempting token refresh for ${tokenData.gmail_email}`
  );
  const refreshed = await refreshAccessToken(supabase, tokenData);
  if (!refreshed.ok) {
    console.info(
      `[gmail-auth] Refresh after 401 FAILED for ${tokenData.gmail_email}: ${refreshed.reason}`
    );
    await deactivateTokenAndNotify(
      supabase,
      tokenData,
      refreshed.reason,
      stage
    );
    throw new GmailReconnectRequiredError(
      "Gmail authentication expired. Reconnect your account."
    );
  }

  headers.set("Authorization", `Bearer ${tokenData.access_token}`);
  console.info(`[gmail-auth] Retrying Gmail API request after refresh`);
  response = await fetch(input, { ...init, headers });
  console.info(`[gmail-auth] Retry response: status=${response.status}`);

  if (response.status === 401) {
    console.info(
      `[gmail-auth] Still 401 after refresh for ${tokenData.gmail_email} — deactivating token`
    );
    await deactivateTokenAndNotify(
      supabase,
      tokenData,
      "unauthorized_after_refresh",
      stage
    );
    throw new GmailReconnectRequiredError(
      "Gmail authentication expired. Reconnect your account."
    );
  }

  return response;
}
