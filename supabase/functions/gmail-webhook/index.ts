// Gmail Webhook Edge Function - Processes real-time Gmail notifications
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { analyzeDocumentForTransaction } from "../_shared/lib/document-analysis.ts";
import { saveTransactionAttachments } from "../_shared/lib/transaction-attachments.ts";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { createSystemNotification } from "../_shared/notifications.ts";
import {
  type OAuthTokenRow,
  GmailReconnectRequiredError,
  ensureFreshAccessToken,
  fetchGmailWithRecovery,
} from "../_shared/lib/gmail-auth.ts";
import { decryptTokenRow } from "../_shared/lib/oauth-token-crypto.ts";
import { incrementGmailSyncUsage } from "../_shared/lib/usage-counter.ts";
import {
  GmailPubSubPayloadError,
  parseGmailPubSubPush,
  verifyGmailPubSubOidcToken,
} from "../_shared/lib/gmail-pubsub.ts";

Deno.serve(async req => {
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
    const oidcConfig = {
      audience: Deno.env.get("PUBSUB_OIDC_AUDIENCE") ?? "",
      serviceAccountEmail:
        Deno.env.get("PUBSUB_OIDC_SERVICE_ACCOUNT_EMAIL") ?? "",
      serviceAccountSubject:
        Deno.env.get("PUBSUB_OIDC_SERVICE_ACCOUNT_SUB") ?? "",
    };
    const expectedSubscription =
      Deno.env.get("PUBSUB_EXPECTED_SUBSCRIPTION") ?? "";

    if (
      !oidcConfig.audience ||
      !oidcConfig.serviceAccountEmail ||
      !oidcConfig.serviceAccountSubject ||
      !expectedSubscription
    ) {
      console.error("Pub/Sub OIDC configuration is incomplete");
      return new Response("Webhook authentication is not configured", {
        status: 503,
        headers: corsHeaders,
      });
    }

    try {
      await verifyGmailPubSubOidcToken(
        req.headers.get("authorization"),
        oidcConfig
      );
    } catch {
      console.warn("Rejected Gmail Pub/Sub push with invalid OIDC identity");
      return new Response("Unauthorized", {
        status: 401,
        headers: corsHeaders,
      });
    }

    let notification;
    try {
      notification = parseGmailPubSubPush(
        await req.text(),
        expectedSubscription
      );
    } catch (error) {
      if (error instanceof GmailPubSubPayloadError) {
        console.warn("Rejected invalid Gmail Pub/Sub payload", {
          status: error.status,
        });
        return new Response("Invalid Pub/Sub payload", {
          status: error.status,
          headers: corsHeaders,
        });
      }
      throw error;
    }

    const { gmailEmail, historyId } = notification;
    console.log("Processing notification", { gmailEmail });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Find ALL user tokens for this Gmail account. We select the encrypted
    // columns (not the plaintext ones, which are NULL after MON-18) and
    // decrypt them in memory before passing to ensureFreshAccessToken /
    // fetchGmailWithRecovery.
    const { data: allTokens, error: tokenError } = await supabase
      .from("user_oauth_tokens")
      .select(
        "id, user_id, gmail_email, access_token_encrypted, refresh_token_encrypted, expires_at, is_active, last_refresh_at, last_refresh_error"
      )
      .eq("gmail_email", gmailEmail)
      .eq("is_active", true);

    if (tokenError || !allTokens || allTokens.length === 0) {
      console.error("No active tokens found for", { gmailEmail });
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    console.log(`Found ${allTokens.length} active token(s) for ${gmailEmail}`);

    // Keep only tokens that can be refreshed/used.
    const validTokens: OAuthTokenRow[] = [];
    for (const tokenData of allTokens as OAuthTokenRow[]) {
      try {
        await decryptTokenRow(supabase, tokenData);
        await ensureFreshAccessToken(
          supabase,
          tokenData,
          "webhook_token_check"
        );
        validTokens.push(tokenData);
      } catch (error) {
        if (error instanceof GmailReconnectRequiredError) {
          console.warn(
            `Token deactivated for user ${tokenData.user_id} during webhook preflight`
          );
          continue;
        }
        console.error(`Error verifying token for user ${tokenData.user_id}`, {
          error,
        });
      }
    }

    if (validTokens.length === 0) {
      console.error("No valid tokens to process this email");
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    console.log(`${validTokens.length} valid token(s) found`);

    // Use the first valid token to read the message
    const firstToken = validTokens[0];

    // Get the last historyId saved
    const { data: watchData } = await supabase
      .from("gmail_watches")
      .select("history_id, topic_name")
      .eq("gmail_email", gmailEmail)
      .eq("is_active", true)
      .order("history_id", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!watchData?.history_id) {
      // No saved historyId — save current one so next notification works properly
      console.log("No saved historyId, initializing gmail_watches record");
      await supabase.from("gmail_watches").upsert(
        {
          user_id: firstToken.user_id,
          gmail_email: gmailEmail,
          history_id: historyId.toString(),
          is_active: true,
          topic_name:
            watchData?.topic_name ||
            "projects/unknown/topics/gmail-notifications",
          label_ids: ["INBOX"],
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,gmail_email" }
      );
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    // Use History API to find new INBOX messages since last processed historyId
    const historyUrl = `https://www.googleapis.com/gmail/v1/users/me/history?startHistoryId=${watchData.history_id}&historyTypes=messageAdded&labelId=INBOX`;

    let historyResponse: Response;
    try {
      historyResponse = await fetchGmailWithRecovery(
        supabase,
        firstToken,
        historyUrl,
        { method: "GET" },
        "webhook_history_fetch"
      );
    } catch (error) {
      if (error instanceof GmailReconnectRequiredError) {
        console.warn(
          `Token requires reconnect while fetching history for ${gmailEmail}`
        );
        return new Response("OK", { status: 200, headers: corsHeaders });
      }
      throw error;
    }

    if (!historyResponse.ok) {
      console.error("Failed to fetch history:", historyResponse.statusText);
      await createSystemNotification({
        typeKey: "gmail_sync_error",
        userId: firstToken.user_id,
        actionPath: "/settings",
        iconKey: "alert",
        i18nParams: {
          email: gmailEmail,
          reason: historyResponse.statusText,
        },
        metadata: {
          gmailEmail,
          stage: "history_fetch",
          status: historyResponse.status,
        },
        dedupeKey: `gmail-sync-error-${firstToken.user_id}-${gmailEmail}-history`,
        dedupeWindowMinutes: 180,
      });
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    const historyData = await historyResponse.json();
    const history = historyData.history;

    if (!history || history.length === 0) {
      // Update historyId even if no new messages (could be a draft/label event)
      await supabase
        .from("gmail_watches")
        .update({
          history_id: historyId.toString(),
          updated_at: new Date().toISOString(),
        })
        .eq("gmail_email", gmailEmail)
        .eq("is_active", true);
      console.log("No new INBOX messages (probably a draft/label/read event)");
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    const addedMessages = history
      .flatMap((h: any) => h.messagesAdded || [])
      .filter((m: any) => m.message?.labelIds?.includes("INBOX"));

    if (addedMessages.length === 0) {
      await supabase
        .from("gmail_watches")
        .update({
          history_id: historyId.toString(),
          updated_at: new Date().toISOString(),
        })
        .eq("gmail_email", gmailEmail)
        .eq("is_active", true);
      console.log("No new messages in INBOX");
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    const latestMessage = addedMessages[addedMessages.length - 1];
    const messageId = latestMessage?.message?.id;
    if (!messageId) {
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    console.log("Processing message", { messageId });

    // Update historyId in database
    await supabase
      .from("gmail_watches")
      .update({
        history_id: historyId.toString(),
        updated_at: new Date().toISOString(),
      })
      .eq("gmail_email", gmailEmail)
      .eq("is_active", true);

    // Get full message details
    let messageResponse: Response;
    try {
      messageResponse = await fetchGmailWithRecovery(
        supabase,
        firstToken,
        `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
        { method: "GET" },
        "webhook_message_fetch"
      );
    } catch (error) {
      if (error instanceof GmailReconnectRequiredError) {
        console.warn(
          `Token requires reconnect while fetching message for ${gmailEmail}`
        );
        return new Response("OK", { status: 200, headers: corsHeaders });
      }
      throw error;
    }

    if (!messageResponse.ok) {
      console.error("Failed to fetch message:", messageResponse.statusText);
      await createSystemNotification({
        typeKey: "gmail_sync_error",
        userId: firstToken.user_id,
        actionPath: "/settings",
        iconKey: "alert",
        i18nParams: {
          email: gmailEmail,
          reason: messageResponse.statusText,
        },
        metadata: {
          gmailEmail,
          stage: "message_fetch",
          status: messageResponse.status,
          messageId,
        },
        dedupeKey: `gmail-sync-error-${firstToken.user_id}-${gmailEmail}-message`,
        dedupeWindowMinutes: 180,
      });
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    const message = await messageResponse.json();

    // Verify that the email is in INBOX and not in SPAM
    const labelIds = message.labelIds || [];
    if (
      !labelIds.includes("INBOX") ||
      labelIds.includes("SPAM") ||
      labelIds.includes("TRASH")
    ) {
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    // Extract important headers
    const headers = message.payload?.headers || [];
    const subject = headers.find((h: any) => h.name === "Subject")?.value || "";
    const fromHeader = headers.find((h: any) => h.name === "From")?.value || "";
    const dateHeader = headers.find((h: any) => h.name === "Date")?.value;
    const date = dateHeader
      ? new Date(dateHeader).toISOString()
      : new Date().toISOString();

    // Extract sender email
    const fromEmailMatch =
      fromHeader.match(/<(.+?)>/) || fromHeader.match(/([^\s]+@[^\s]+)/);
    const fromEmail = fromEmailMatch
      ? fromEmailMatch[1] || fromEmailMatch[0]
      : fromHeader;

    // Extract body text
    const bodyText = extractBodyText(message.payload);

    // Get user context for AI
    let userFullName: string | undefined;
    if (validTokens.length > 0) {
      const { data: userData, error: userError } =
        await supabase.auth.admin.getUserById(validTokens[0].user_id);
      if (!userError && userData?.user?.user_metadata?.full_name) {
        userFullName = userData.user.user_metadata.full_name;
        console.log("User context for AI", { userFullName });
      }
    }

    // Look up user roles in one round-trip so the gmail_sync usage
    // counter can apply the admin bypass per user. Missing rows
    // (e.g. user created after the access-token hook write) default to
    // "user" — the conservative counter, no accidental bypass.
    const roleByUser = new Map<string, "user" | "tester" | "admin">();
    if (validTokens.length > 0) {
      const { data: roleRows } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in(
          "user_id",
          validTokens.map(t => t.user_id)
        );
      for (const row of roleRows ?? []) {
        if (
          row.role === "user" ||
          row.role === "tester" ||
          row.role === "admin"
        ) {
          roleByUser.set(row.user_id, row.role);
        }
      }
    }
    const roleFor = (userId: string): "user" | "tester" | "admin" =>
      roleByUser.get(userId) ?? "user";

    console.log("Analyzing email...", { bodyTextLength: bodyText.length });

    // Use shared document analysis pipeline (image/PDF extraction + AI).
    // The pipeline never throws on AI errors: it returns { aiError: true }
    // so we can run the keyword fallback with the already-extracted attachments.
    const aiResult = await analyzeDocumentForTransaction({
      kind: "gmail",
      accessToken: firstToken.access_token || "",
      messageId: message.id,
      payload: message.payload,
      bodyText,
      userFullName,
      attachmentOptions: {
        fetchAttachmentData: async (
          targetMessageId: string,
          attachmentId: string
        ) => {
          const attachmentResponse = await fetchGmailWithRecovery(
            supabase,
            firstToken,
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${targetMessageId}/attachments/${attachmentId}`,
            { method: "GET" },
            "webhook_fetch_attachment"
          );
          if (!attachmentResponse.ok) return null;
          return await attachmentResponse.json();
        },
      },
    });

    if (aiResult.hasTransaction) {
      console.log("Transaction detected by AI", { fromEmail, subject });
      const transaction = aiResult.data;

      // Create transaction for each user with valid token. Due to the UNIQUE
      // constraint on source_message_id only the first insert succeeds; the
      // rest are skipped as duplicates. Attachments are persisted once, linked
      // to the first successfully created transaction.
      let savedTransaction: { id: string; user_id: string } | null = null;

      for (const tokenData of validTokens) {
        const { data: inserted, error: insertError } = await supabase
          .from("transactions")
          .insert({
            user_id: tokenData.user_id,
            user_oauth_token_id: tokenData.id,
            source_email: fromEmail,
            source_message_id: message.id,
            date: date,
            amount: transaction.amount,
            currency: transaction.currency,
            transaction_type: transaction.type,
            name: transaction.name || subject,
            transaction_description: transaction.description,
            transaction_date: transaction.date || date.split("T")[0],
            merchant: transaction.merchant,
            category: transaction.category,
          })
          .select("id, user_id")
          .single();

        if (insertError) {
          if (insertError.code === "23505") {
            console.log(
              `Transaction already exists for user ${tokenData.user_id}`
            );
          } else {
            console.error(
              `Error saving transaction for user ${tokenData.user_id}`,
              { error: insertError }
            );
          }
        } else if (inserted && !savedTransaction) {
          savedTransaction = inserted;
          console.log(
            `AI transaction saved for user ${tokenData.user_id}: ${transaction.amount} ${transaction.currency}`
          );
        }
        // Count this email for the user's gmail_sync usage counter
        // regardless of whether their transaction insert succeeded.
        // The work (token refresh, history fetch, AI analysis) happened
        // for every user in validTokens; the duplicate path is the
        // common case when one Gmail address is connected by multiple
        // users in the same app — they all get billed +1. The helper
        // fails open on RPC errors and applies the admin bypass.
        await incrementGmailSyncUsage(
          supabase,
          tokenData.user_id,
          roleFor(tokenData.user_id),
          { messageId: message.id }
        );
      }

      if (savedTransaction && aiResult.attachments.length > 0) {
        await saveTransactionAttachments({
          supabase,
          transactionId: savedTransaction.id,
          userId: savedTransaction.user_id,
          attachments: aiResult.attachments,
        });
      }

      console.log(`AI transaction processed for ${validTokens.length} user(s)`);
    } else if (aiResult.aiError) {
      // AI pipeline failed unexpectedly — fall back to keyword detection using
      // the attachments that were already extracted before the error.
      console.error("AI processing failed, using keyword fallback", {
        reason: aiResult.reason,
      });

      const transactionKeywords = [
        "purchase",
        "payment",
        "charge",
        "debit",
        "credit",
        "invoice",
        "receipt",
        "$",
        "€",
        "£",
      ];
      const hasTransactionKeywords = transactionKeywords.some(
        keyword =>
          subject.toLowerCase().includes(keyword) ||
          bodyText.toLowerCase().includes(keyword)
      );

      if (hasTransactionKeywords) {
        console.log("Fallback: Transaction detected by keywords", {
          fromEmail,
          subject,
        });

        let savedTransaction: { id: string; user_id: string } | null = null;

        for (const tokenData of validTokens) {
          const { data: inserted, error: insertError } = await supabase
            .from("transactions")
            .insert({
              user_id: tokenData.user_id,
              user_oauth_token_id: tokenData.id,
              source_email: fromEmail,
              source_message_id: message.id,
              date: date,
              amount: 0,
              currency: "USD",
              transaction_type: "expense",
              name: subject,
              transaction_description: subject,
              transaction_date: date.split("T")[0],
              merchant: fromEmail,
              category: "uncategorized",
            })
            .select("id, user_id")
            .single();

          if (insertError) {
            if (insertError.code === "23505") {
              console.log(
                `Transaction already exists for user ${tokenData.user_id}`
              );
            } else {
              console.error(
                `Error saving transaction for user ${tokenData.user_id}`,
                { error: insertError }
              );
            }
          } else if (inserted && !savedTransaction) {
            savedTransaction = inserted;
            console.log(
              `Fallback transaction saved for user ${tokenData.user_id}`
            );
          }
          // Same rationale as the AI branch above: every user that
          // owned this Gmail address when the webhook fired counts as
          // +1 on their gmail_sync quota, regardless of which user
          // ended up winning the unique source_message_id race.
          await incrementGmailSyncUsage(
            supabase,
            tokenData.user_id,
            roleFor(tokenData.user_id),
            { messageId: message.id }
          );
        }

        if (savedTransaction && aiResult.attachments.length > 0) {
          await saveTransactionAttachments({
            supabase,
            transactionId: savedTransaction.id,
            userId: savedTransaction.user_id,
            attachments: aiResult.attachments,
          });
        }

        console.log(
          `Fallback transaction processed for ${validTokens.length} user(s)`
        );
      } else {
        console.log("No transaction detected - discarding");

        // Save in discarded_emails for each valid user
        for (const tokenData of validTokens) {
          const { error: discardError } = await supabase
            .from("discarded_emails")
            .insert({
              user_oauth_token_id: tokenData.id,
              message_id: message.id,
              reason: "No transaction detected (fallback)",
            });

          if (discardError && discardError.code !== "23505") {
            console.error(
              `Error saving discarded email for user ${tokenData.user_id}`,
              { error: discardError }
            );
          }
          // Count this email for every user's gmail_sync usage counter
          // — discarded_emails is a row we produced, so it represents
          // real work the user triggered. The unique constraint on
          // (user_oauth_token_id, message_id) makes the insert always
          // succeed per user, so we count unconditionally here.
          await incrementGmailSyncUsage(
            supabase,
            tokenData.user_id,
            roleFor(tokenData.user_id),
            { messageId: message.id }
          );
        }
      }
    } else {
      console.log("No transaction detected by AI - discarding");

      // Save in discarded_emails for each valid user
      for (const tokenData of validTokens) {
        const { error: discardError } = await supabase
          .from("discarded_emails")
          .insert({
            user_oauth_token_id: tokenData.id,
            message_id: message.id,
            reason: aiResult.reason || "No transaction detected",
          });

        if (discardError) {
          if (discardError.code === "23505") {
            console.log(
              `Email already discarded for user ${tokenData.user_id}`
            );
          } else {
            console.error(
              `Error saving discarded email for user ${tokenData.user_id}`,
              { error: discardError }
            );
          }
        }
        // Same rationale as the fallback-discard branch above: every
        // user in validTokens gets +1 on their gmail_sync quota. A
        // 23505 here means we already counted this message in a prior
        // webhook delivery and the helper short-circuits as no-op.
        await incrementGmailSyncUsage(
          supabase,
          tokenData.user_id,
          roleFor(tokenData.user_id),
          { messageId: message.id }
        );
      }
    }

    return new Response("OK", { status: 200, headers: corsHeaders });
  } catch (error) {
    if (error instanceof GmailReconnectRequiredError) {
      console.warn("Webhook token requires reconnect");
      return new Response("OK", { status: 200, headers: corsHeaders });
    }
    console.error("Error processing webhook", { error });
    return new Response("OK", { status: 500, headers: corsHeaders });
  }
});

function extractBodyText(payload: any): string {
  let text = "";

  if (payload.body?.data) {
    text = atob(payload.body.data.replace(/-/g, "+").replace(/_/g, "/"));
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        const plainText = atob(
          part.body.data.replace(/-/g, "+").replace(/_/g, "/")
        );
        if (plainText.trim()) {
          text = plainText;
          break;
        }
      }
      // If multipart, search recursively
      if (part.mimeType?.startsWith("multipart/")) {
        const nestedText = extractBodyText(part);
        if (nestedText.trim()) {
          text = nestedText;
        }
      }
    }

    // If no text/plain found, try text/html
    if (!text.trim()) {
      for (const part of payload.parts) {
        if (part.mimeType === "text/html" && part.body?.data) {
          const htmlText = atob(
            part.body.data.replace(/-/g, "+").replace(/_/g, "/")
          );
          // Extract basic text from HTML
          text = htmlText
            .replace(/<[^>]*>/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          if (text) break;
        }
      }
    }
  }

  return text;
}

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request with Gmail webhook payload:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/gmail-webhook' \
    --header 'Content-Type: application/json' \
    --data '{
      "message": {
        "data": "eyJlbWFpbEFkZHJlc3MiOiJ0ZXN0QGV4YW1wbGUuY29tIiwiaGlzdG9yeUlkIjoxMjM0NX0="
      }
    }'

*/
