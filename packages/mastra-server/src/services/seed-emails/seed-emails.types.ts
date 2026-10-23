// Custom errors for the seed-emails flow. The controller maps these to
// HTTP status codes; the service throws them; everything else throws
// plain Errors which become 500s.

export class SeedValidationError extends Error {
  statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "SeedValidationError";
  }
}

export class SeedNotFoundError extends Error {
  statusCode = 404;
  constructor(message: string) {
    super(message);
    this.name = "SeedNotFoundError";
  }
}

export class SeedConflictError extends Error {
  statusCode = 409;
  constructor(
    message: string,
    public readonly context: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "SeedConflictError";
  }
}

// DTOs

import type { UserRole } from "../../lib/roles";

export interface StartSeedInput {
  userId: string;
  connectionId: string;
  /**
   * The caller's role, decoded from the JWT by the mastra auth
   * middleware (see packages/mastra-server/src/middleware/auth.ts).
   * Used by the per-email processor to decide whether to bypass the
   * `gmail_sync` usage counter (only `admin` bypasses; `tester` is
   * counted). See `lib/seed-shared/usage-counter.ts` for the
   * rationale.
   */
  userRole: UserRole;
}

export interface StartSeedResult {
  seedId: string;
  status: "processing";
  totalMessages: number;
}

export interface ConnectionRow {
  id: string;
  user_id: string;
  gmail_email: string | null;
  // Plaintext in memory after findActiveConnection runs decryptTokenRow.
  // Never read from the DB after MON-18 (the DB only stores *_encrypted).
  access_token: string | null;
  refresh_token: string | null;
  // base64 BYTEA as returned by PostgREST; decrypted by decryptTokenRow.
  access_token_encrypted?: string | null;
  refresh_token_encrypted?: string | null;
  expires_at: string | null;
  is_active: boolean | undefined;
}

export interface SeedRow {
  id: string;
  user_id: string;
  user_oauth_token_id: string;
  status: "pending" | "processing" | "completed" | "failed";
  message_ids: string[] | null;
  total_emails: number | null;
  last_processed_index: number | null;
  transactions_found: number | null;
  total_skipped: number | null;
  emails_processed_by_ai: number | null;
  error_message: string | null;
  updated_at: string | null;
}
