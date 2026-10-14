import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.types";

interface ChatThread {
  id: string;
  resourceId: string;
  title: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  /** TIMESTAMPTZ mirror column. Use this in the UI instead of `updatedAt`
   *  (which is TIMESTAMP WITHOUT TIME ZONE) so the browser can convert
   *  the stored instant into the user's local timezone. */
  updatedAt: string;
  updatedAtZ: string | null;
}

export interface ChatMessage {
  id: string;
  thread_id: string;
  /** Mastra stores content as JSON (MastraMessageContentV2): { format: 2, parts: [...], content: "..." } */
  content: unknown;
  role: "user" | "assistant" | "system" | "tool";
  type: string | null;
  createdAt: string;
  resourceId: string | null;
}

/**
 * Returns true when the Supabase error is expected (table missing, JWT
 * issues, etc.) and we should silently return an empty result instead of
 * crashing the UI. Mastra's tables don't exist until the server has been
 * run at least once, so this is normal during local development.
 */
function isExpectedMissingTableError(
  error: { code?: string; message?: string } | null
): boolean {
  if (!error) return false;
  if (error.code === "PGRST301") return true; // JWT issue
  if (error.code === "PGRST116") return true; // row not found
  if (error.code === "42P01") return true; // undefined_table
  if (error.message?.includes("does not exist")) return true;
  return false;
}

class ChatThreadsService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async listThreads(): Promise<ChatThread[]> {
    // RLS filters by resourceId = auth.uid()::text automatically.
    // Cast to our local type because Mastra tables aren't in database.types yet.
    const { data, error } = await this.supabase
      .schema("ai")
      .from("mastra_threads" as never)
      .select("*")
      .order('"updatedAtZ"', { ascending: false, nullsFirst: false })
      .limit(50);

    if (error) {
      if (isExpectedMissingTableError(error)) {
        // Silently return empty — Mastra tables don't exist yet
        return [];
      }
      throw error;
    }
    return (data as unknown as ChatThread[]) ?? [];
  }

  async listMessages(threadId: string): Promise<ChatMessage[]> {
    const { data, error } = await this.supabase
      .schema("ai")
      .from("mastra_messages" as never)
      .select("*")
      .eq("thread_id", threadId)
      .order('"createdAt"', { ascending: true });

    if (error) {
      if (isExpectedMissingTableError(error)) {
        return [];
      }
      throw error;
    }
    return (data as unknown as ChatMessage[]) ?? [];
  }

  async deleteThread(threadId: string): Promise<void> {
    const { error } = await this.supabase
      .schema("ai")
      .from("mastra_threads" as never)
      .delete()
      .eq("id", threadId);
    if (error) {
      if (isExpectedMissingTableError(error)) {
        return;
      }
      throw error;
    }
  }
}

export function createChatThreadsService(supabase: SupabaseClient<Database>) {
  return new ChatThreadsService(supabase);
}
