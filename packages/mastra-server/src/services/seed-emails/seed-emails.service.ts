// Service layer for seed-emails: orchestrates the seed flow.
// The controller calls startSeed; the service handles validation,
// creates the seed row, and spawns a background job to process chunks.
import type { UserRole } from "../../lib/roles";
import { createSystemNotification } from "../../lib/seed-shared/notifications";
import {
  GmailReconnectRequiredError,
  ensureFreshAccessToken,
} from "../../lib/seed-shared/gmail-auth";
import {
  createSeed,
  createServiceClient,
  findActiveConnection,
  findActiveSeedByConnection,
  getSeedById,
  markSeedFailed,
  updateSeedProgress,
} from "./seed-emails.repository";
import {
  type ConnectionRow,
  type SeedRow,
  type StartSeedInput,
  type StartSeedResult,
  SeedConflictError,
  SeedNotFoundError,
  SeedValidationError,
} from "./seed-emails.types";
import {
  type ChunkResult,
  fetchAllMessageIds,
  flushLangfuse,
  processChunk,
} from "./seed-emails.processor";

// --- Public API ---

export async function startSeed(
  input: StartSeedInput
): Promise<StartSeedResult> {
  if (!input.userId) {
    throw new SeedValidationError("Missing userId");
  }
  if (!input.connectionId) {
    throw new SeedValidationError("Missing connectionId parameter");
  }

  const supabase = createServiceClient();
  const connection = await findActiveConnection(
    supabase,
    input.connectionId,
    input.userId
  );

  if (!connection) {
    throw new SeedNotFoundError("Connection not found or unauthorized");
  }

  const existing = await findActiveSeedByConnection(
    supabase,
    input.connectionId
  );
  if (existing) {
    throw new SeedConflictError("A seed is already in progress", {
      seedId: existing.id,
    });
  }

  const messageIds = await fetchMessageIdsOrThrow(supabase, connection);
  if (messageIds.length === 0) {
    console.log(
      `[seed-service] No messages found for ${connection.gmail_email}`
    );
    return {
      seedId: "",
      status: "processing",
      totalMessages: 0,
    };
  }

  const seed = await createSeed(supabase, {
    userId: input.userId,
    connectionId: input.connectionId,
    messageIds,
  });

  if (!seed) {
    throw new Error("Failed to create seed row");
  }

  console.log("[seed-service] Seed created", {
    seedId: seed.id,
    userId: input.userId,
    gmailEmail: connection.gmail_email,
    totalMessages: messageIds.length,
  });

  runBackgroundJob({
    supabase,
    userId: input.userId,
    userRole: input.userRole,
    connectionId: input.connectionId,
    tokenData: connection,
    seedId: seed.id,
  });

  return {
    seedId: seed.id,
    status: "processing",
    totalMessages: messageIds.length,
  };
}

// --- Background job ---

interface BackgroundJobInput {
  supabase: ReturnType<typeof createServiceClient>;
  userId: string;
  userRole: UserRole;
  connectionId: string;
  tokenData: ConnectionRow;
  seedId: string;
}

async function runBackgroundJob(input: BackgroundJobInput): Promise<void> {
  const { supabase, userId, userRole, tokenData, seedId } = input;

  try {
    let isDone = false;
    let lastResult: ChunkResult | null = null;

    while (!isDone) {
      const seed = await getSeedById(supabase, seedId);
      if (!seed) {
        console.error("[seed-service] Seed disappeared mid-job");
        return;
      }

      try {
        lastResult = await processChunk(
          { supabase, tokenData, userId, userRole },
          seed
        );
        isDone = lastResult.done;

        await updateSeedProgress(supabase, seedId, {
          status: isDone ? "completed" : "processing",
          lastProcessedIndex: lastResult.processed,
          transactionsFound: lastResult.transactions,
          totalSkipped: lastResult.skipped,
          emailsProcessedByAi: lastResult.aiProcessed,
        });
      } catch (chunkError) {
        await handleChunkFailure(supabase, seed, userId, chunkError);
        return;
      }
    }

    await flushLangfuse();
    console.log(
      `[seed-service] Background job finished for seed ${lastResult?.processed ?? 0}/${lastResult?.total ?? 0}`
    );
  } catch (err) {
    console.error("[seed-service] Background job failed:", err);
  }
}

// --- Helpers ---

async function fetchMessageIdsOrThrow(
  supabase: ReturnType<typeof createServiceClient>,
  connection: ConnectionRow
): Promise<string[]> {
  try {
    await ensureFreshAccessToken(supabase, connection, "seed_start");
    return await fetchAllMessageIds(supabase, connection);
  } catch (err) {
    if (err instanceof GmailReconnectRequiredError) {
      await createSystemNotification({
        typeKey: "seed_failed",
        userId: connection.user_id,
        actionPath: "/settings",
        iconKey: "alert",
        i18nParams: { reason: err.message },
        metadata: { connectionId: connection.id, stage: "fetch_messages" },
        dedupeKey: `seed-failed-fetch-${connection.id}`,
        dedupeWindowMinutes: 60,
      });
    }
    throw err;
  }
}

async function handleChunkFailure(
  supabase: ReturnType<typeof createServiceClient>,
  seed: SeedRow,
  userId: string,
  chunkError: unknown
): Promise<void> {
  const errorMessage =
    chunkError instanceof Error ? chunkError.message : "Seed processing failed";

  await markSeedFailed(supabase, seed.id, errorMessage);

  if (chunkError instanceof GmailReconnectRequiredError) {
    await createSystemNotification({
      typeKey: "seed_failed",
      userId,
      actionPath: "/settings",
      iconKey: "alert",
      i18nParams: { reason: chunkError.message },
      metadata: { seedId: seed.id, stage: "chunk" },
      dedupeKey: `seed-failed-${seed.id}`,
      dedupeWindowMinutes: 60,
    });
  }
}
