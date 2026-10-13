import { getSupabase } from "../lib/supabase";
import { getConfig } from "../config";

export interface StartSeedResponse {
  seedId?: string;
  status: string;
  message: string;
}

export const seedService = {
  /**
   * Start a seed to import historical emails.
   * Routes to the mastra server, which runs the job as a long-lived
   * background task (no Supabase edge function CPU/wall-clock limits).
   */
  async startSeed(connectionId: string): Promise<StartSeedResponse> {
    const [supabase, config] = await Promise.all([getSupabase(), getConfig()]);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      throw new Error("No active session");
    }

    const response = await fetch(
      `${config.mastraServerUrl.replace(/\/+$/, "")}/api/seed-emails`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ connectionId }),
      }
    );

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      const error = new Error(
        errorPayload?.error || "Failed to start seed job"
      ) as Error & {
        code?: string;
      };
      error.code = errorPayload?.code;
      throw error;
    }

    const payload = await response.json();

    return payload;
  },
};
