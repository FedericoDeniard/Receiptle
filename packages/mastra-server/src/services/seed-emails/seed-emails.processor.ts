// Worker layer for seed-emails: pure processing logic.
// No HTTP, no Supabase client creation, no notifications.
// Takes a Supabase client + connection row as input, returns processing results.
import { analyzeDocumentForTransaction } from "../../lib/seed-shared/document-analysis";
import {
  GmailReconnectRequiredError,
  ensureFreshAccessToken,
  fetchGmailWithRecovery,
  type OAuthTokenRow,
} from "../../lib/seed-shared/gmail-auth";
import { createSystemNotification } from "../../lib/seed-shared/notifications";
import { flushLangfuse } from "../../lib/seed-shared/langfuse";
import { incrementGmailSyncUsage } from "../../../../../supabase/functions/_shared/lib/usage-counter";
import type { UserRole } from "../../lib/roles";
import {
  findExistingDiscarded,
  findExistingTransaction,
  getUserFullName,
  insertDiscarded,
  insertTransaction,
} from "./seed-emails.repository";
import type { SeedRow } from "./seed-emails.types";
import type { SupabaseClient } from "@supabase/supabase-js";

export const CHUNK_SIZE = 5;
export const CONCURRENCY = 2;
const MONTHS_TO_SEED = 3;

export interface ChunkResult {
  done: boolean;
  processed: number;
  transactions: number;
  total: number;
  skipped: number;
  aiProcessed: number;
}

interface ProcessorDeps {
  supabase: SupabaseClient;
  tokenData: OAuthTokenRow;
  userId: string;
  userRole: UserRole;
}

// --- Public API: process a single chunk ---

export async function processChunk(
  deps: ProcessorDeps,
  seed: SeedRow
): Promise<ChunkResult> {
  if (seed.status === "completed" || seed.status === "failed") {
    return {
      done: true,
      processed: seed.last_processed_index ?? 0,
      transactions: seed.transactions_found ?? 0,
      total: seed.total_emails ?? 0,
      skipped: seed.total_skipped ?? 0,
      aiProcessed: seed.emails_processed_by_ai ?? 0,
    };
  }

  const messageIds: string[] = seed.message_ids ?? [];
  const startIndex = seed.last_processed_index ?? 0;
  const endIndex = Math.min(startIndex + CHUNK_SIZE, messageIds.length);
  const chunk = messageIds.slice(startIndex, endIndex);

  if (chunk.length === 0) {
    return {
      done: true,
      processed: 0,
      transactions: 0,
      total: 0,
      skipped: seed.total_skipped ?? 0,
      aiProcessed: seed.emails_processed_by_ai ?? 0,
    };
  }

  await ensureFreshAccessToken(deps.supabase, deps.tokenData, "seed_chunk");

  const userFullName = await getUserFullName(deps.supabase, deps.userId);

  console.log(
    `[seed-processor] Processing chunk: messages ${startIndex}-${endIndex - 1} of ${messageIds.length}`
  );

  const { transactionsFound, processedCount, skippedCount, aiProcessedCount } =
    await processChunkBatch({
      supabase: deps.supabase,
      tokenData: deps.tokenData,
      userId: deps.userId,
      userRole: deps.userRole,
      tokenId: deps.tokenData.id,
      messageIds: chunk,
      userFullName,
      startingTransactionsFound: seed.transactions_found ?? 0,
    });

  const skipped = (seed.total_skipped ?? 0) + skippedCount;
  const aiProcessed = (seed.emails_processed_by_ai ?? 0) + aiProcessedCount;

  const newIndex = endIndex;
  const isDone = newIndex >= messageIds.length;

  console.log(
    `[seed-processor] Chunk done: ${processedCount} processed (${aiProcessedCount} by AI, ${skippedCount} skipped), ${transactionsFound} transactions, ${isDone ? "COMPLETED" : `${messageIds.length - newIndex} remaining`}`
  );

  if (isDone) {
    await createSystemNotification({
      typeKey:
        transactionsFound > 0
          ? "seed_completed_with_transactions"
          : "seed_completed_no_new",
      userId: deps.userId,
      actionPath: "/transactions",
      iconKey: "mail",
      i18nParams: {
        count: transactionsFound,
        totalEmails: messageIds.length,
      },
      metadata: {
        seedId: seed.id,
        totalEmails: messageIds.length,
        transactionsFound,
      },
      dedupeKey: `seed-completed-${seed.id}`,
      dedupeWindowMinutes: 60,
    });
  }

  return {
    done: isDone,
    processed: newIndex,
    transactions: transactionsFound,
    total: messageIds.length,
    skipped,
    aiProcessed,
  };
}

// --- Public API: fetch all Gmail message IDs ---

export async function fetchAllMessageIds(
  supabase: SupabaseClient,
  tokenData: OAuthTokenRow
): Promise<string[]> {
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - MONTHS_TO_SEED);
  const afterDate =
    threeMonthsAgo.toISOString().split("T")[0]?.replace(/-/g, "/") || "";
  const query = `after:${afterDate}`;

  const messageIds: string[] = [];
  let pageToken: string | undefined;

  while (true) {
    const url = `https://www.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}${pageToken ? `&pageToken=${pageToken}` : ""}`;

    const response = await fetchGmailWithRecovery(
      supabase,
      tokenData,
      url,
      { method: "GET" },
      "seed_list_messages"
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch messages: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      messages?: Array<{ id: string }>;
      nextPageToken?: string;
    };

    if (data.messages) {
      messageIds.push(...data.messages.map((msg: { id: string }) => msg.id));
    }

    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return messageIds;
}

// --- Internal: process a batch of messages in parallel ---

interface BatchDeps {
  supabase: SupabaseClient;
  tokenData: OAuthTokenRow;
  userId: string;
  userRole: UserRole;
  tokenId: string;
  messageIds: string[];
  userFullName: string | undefined;
  startingTransactionsFound: number;
}

interface ChunkBatchResult {
  transactionsFound: number;
  processedCount: number;
  skippedCount: number;
  aiProcessedCount: number;
}

async function processChunkBatch(deps: BatchDeps): Promise<ChunkBatchResult> {
  let transactionsFound = deps.startingTransactionsFound;
  let processedCount = 0;
  let skippedCount = 0;
  let aiProcessedCount = 0;

  for (let i = 0; i < deps.messageIds.length; i += CONCURRENCY) {
    const batch = deps.messageIds.slice(i, i + CONCURRENCY);

    const results = await Promise.all(
      batch.map(async messageId => {
        try {
          return await processSingleMessage({
            supabase: deps.supabase,
            tokenData: deps.tokenData,
            userId: deps.userId,
            userRole: deps.userRole,
            tokenId: deps.tokenId,
            messageId,
            userFullName: deps.userFullName,
          });
        } catch (error) {
          if (error instanceof GmailReconnectRequiredError) {
            throw error;
          }
          console.error(
            `[seed-processor] Error processing ${messageId}:`,
            error
          );
          return {
            transactionFound: false,
            skipped: false,
            aiProcessed: false,
          };
        }
      })
    );

    for (const result of results) {
      if (result.transactionFound) transactionsFound++;
      if (result.skipped) skippedCount++;
      if (result.aiProcessed) aiProcessedCount++;
      processedCount++;
    }
  }

  return { transactionsFound, processedCount, skippedCount, aiProcessedCount };
}

interface MessageDeps {
  supabase: SupabaseClient;
  tokenData: OAuthTokenRow;
  userId: string;
  userRole: UserRole;
  tokenId: string;
  messageId: string;
  userFullName: string | undefined;
}

interface MessageResult {
  transactionFound: boolean;
  skipped: boolean;
  aiProcessed: boolean;
}

async function processSingleMessage(deps: MessageDeps): Promise<MessageResult> {
  // Dedupe before fetching the full message: transactions and discarded_emails
  // are the record of emails already analyzed. Checking first avoids one Gmail
  // API call per already-processed email on every re-run.
  if (
    (await findExistingTransaction(
      deps.supabase,
      deps.tokenId,
      deps.messageId
    )) ||
    (await findExistingDiscarded(deps.supabase, deps.tokenId, deps.messageId))
  ) {
    return { transactionFound: false, skipped: true, aiProcessed: false };
  }

  const response = await fetchGmailWithRecovery(
    deps.supabase,
    deps.tokenData,
    `https://www.googleapis.com/gmail/v1/users/me/messages/${deps.messageId}?format=full`,
    { method: "GET" },
    "seed_fetch_message"
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch message: ${response.statusText}`);
  }

  const message = (await response.json()) as {
    id?: string;
    labelIds?: string[];
    payload?: {
      headers?: Array<{ name: string; value: string }>;
    };
  };
  const gmailId = message.id || deps.messageId;

  const labelIds: string[] = message.labelIds || [];
  if (
    !labelIds.includes("INBOX") ||
    labelIds.includes("SPAM") ||
    labelIds.includes("TRASH")
  ) {
    return { transactionFound: false, skipped: true, aiProcessed: false };
  }

  const headers = message.payload?.headers || [];
  const subject =
    headers.find((h: { name: string }) => h.name === "Subject")?.value || "";
  const fromHeader =
    headers.find((h: { name: string }) => h.name === "From")?.value || "";
  const dateHeader = headers.find(
    (h: { name: string }) => h.name === "Date"
  )?.value;
  const date = dateHeader
    ? new Date(dateHeader).toISOString()
    : new Date().toISOString();

  const fromEmailMatch =
    fromHeader.match(/<(.+?)>/) || fromHeader.match(/([^\s]+@[^\s]+)/);
  const fromEmail = fromEmailMatch
    ? fromEmailMatch[1] || fromEmailMatch[0]
    : fromHeader;

  const bodyText = extractBodyText(message.payload);

  try {
    const aiResult = await analyzeDocumentForTransaction({
      kind: "gmail",
      accessToken: deps.tokenData.access_token || "",
      messageId: gmailId,
      payload: message.payload,
      bodyText,
      userFullName: deps.userFullName,
      attachmentOptions: {
        fetchAttachmentData: async (
          targetMessageId: string,
          attachmentId: string
        ) => {
          const attachmentResponse = await fetchGmailWithRecovery(
            deps.supabase,
            deps.tokenData,
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${targetMessageId}/attachments/${attachmentId}`,
            { method: "GET" },
            "seed_fetch_attachment"
          );
          if (!attachmentResponse.ok) return null;
          return (await attachmentResponse.json()) as { data?: string };
        },
      },
    });

    if (aiResult.hasTransaction) {
      const { inserted, duplicate } = await insertTransaction(deps.supabase, {
        userId: deps.userId,
        tokenId: deps.tokenId,
        fromEmail,
        messageId: deps.messageId,
        date,
        transaction: aiResult.data,
        subject,
      });
      if (duplicate || !inserted) {
        return {
          transactionFound: false,
          skipped: duplicate,
          aiProcessed: true,
        };
      }
      // Counted AFTER successful insert (matches the export-report-pdf
      // pattern: only count when the work actually produced a row).
      // The helper fail-opens on RPC errors and surfaces a quota
      // exhausted flag we currently ignore — the email has already
      // landed, so rolling it back would be more surprising than
      // letting the user keep their last processed message.
      await incrementGmailSyncUsage(deps.supabase, deps.userId, deps.userRole, {
        messageId: deps.messageId,
      });
      return { transactionFound: true, skipped: false, aiProcessed: true };
    }

    await insertDiscarded(deps.supabase, {
      tokenId: deps.tokenId,
      messageId: deps.messageId,
      reason: aiResult.reason || "No transaction detected",
    });
    // Counted AFTER the discarded row is persisted — same rationale
    // as the transaction branch above. Only emails that produced a
    // row in the DB burn quota; spam labels, AI failures, and
    // duplicates are filtered earlier and never reach this point.
    await incrementGmailSyncUsage(deps.supabase, deps.userId, deps.userRole, {
      messageId: deps.messageId,
    });
  } catch (error) {
    console.error("[seed-processor] AI processing error:", error);
  }

  return { transactionFound: false, skipped: false, aiProcessed: true };
}

function extractBodyText(payload: unknown): string {
  const p = payload as {
    body?: { data?: string };
    parts?: Array<{
      mimeType?: string;
      body?: { data?: string };
      parts?: unknown[];
    }>;
  };
  let text = "";

  if (p.body?.data) {
    text = atob(p.body.data.replace(/-/g, "+").replace(/_/g, "/"));
  }

  if (p.parts) {
    for (const part of p.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        const plainText = atob(
          part.body.data.replace(/-/g, "+").replace(/_/g, "/")
        );
        if (plainText.trim()) {
          text = plainText;
          break;
        }
      }
      if (part.mimeType?.startsWith("multipart/") && part.parts) {
        const nestedText = extractBodyText(part);
        if (nestedText.trim()) {
          text = nestedText;
        }
      }
    }

    if (!text.trim()) {
      for (const part of p.parts) {
        if (part.mimeType === "text/html" && part.body?.data) {
          const htmlText = atob(
            part.body.data.replace(/-/g, "+").replace(/_/g, "/")
          );
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

export { flushLangfuse };
