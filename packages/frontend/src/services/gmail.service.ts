import { getSupabase } from "../lib/supabase";
import { getConfig } from "../config";
import type { Database } from "../types/database.types";

// Helper to get edge functions base URL from supabase config
async function getEdgeFunctionsUrl(): Promise<string> {
  const config = await getConfig();
  return `${config.supabase.url.replace(/\/+$/, "")}/functions/v1`;
}

export interface GmailConnection {
  id: string;
  gmail_email: string;
  connected_at: string;
  expires_at?: string;
  is_active: boolean;
  status: "connected" | "needs_reconnect" | "disconnected";
}

export interface GmailStatus {
  connections: GmailConnection[];
  total: number;
  activeTotal: number;
  connectedTotal: number;
  needsReconnectTotal: number;
  disconnectedTotal: number;
}

export interface GmailWatch {
  id: string;
  gmail_email: string;
  watch_id: string;
  topic_name: string;
  expiration: string;
  is_active: boolean;
}

const GMAIL_STATUS_TTL_MS = 60 * 1000;
const gmailStatusCache = new Map<
  string,
  { status: GmailStatus; expiresAt: number }
>();
const gmailStatusInFlight = new Map<string, Promise<GmailStatus>>();
type UserOauthTokenRow =
  Database["public"]["Tables"]["user_oauth_tokens"]["Row"];

export const gmailService = {
  clearConnectionStatusCache(userId?: string): void {
    if (userId) {
      gmailStatusCache.delete(userId);
      gmailStatusInFlight.delete(userId);
      return;
    }

    gmailStatusCache.clear();
    gmailStatusInFlight.clear();
  },

  async getConnectionStatus(userId: string): Promise<GmailStatus> {
    const now = Date.now();
    const cached = gmailStatusCache.get(userId);
    if (cached && cached.expiresAt > now) {
      return cached.status;
    }

    const inFlight = gmailStatusInFlight.get(userId);
    if (inFlight) {
      return inFlight;
    }

    const request = (async () => {
      const supabase = await getSupabase();

      const { data, error } = await supabase
        .from("user_oauth_tokens")
        .select("id, gmail_email, created_at, expires_at, is_active")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error checking Gmail status:", error);
        return {
          connections: [],
          total: 0,
          activeTotal: 0,
          connectedTotal: 0,
          needsReconnectTotal: 0,
          disconnectedTotal: 0,
        };
      }

      const tokenRows = ((data || []) as UserOauthTokenRow[]).filter(
        item => !!item.gmail_email
      );

      const connections: GmailConnection[] = tokenRows.map(item => {
        const expiresAt = item.expires_at ?? undefined;
        // Manual disconnect flow sets expires_at to null.
        const status: GmailConnection["status"] = item.is_active
          ? "connected"
          : expiresAt == null
            ? "disconnected"
            : "needs_reconnect";

        return {
          id: item.id,
          gmail_email: item.gmail_email!,
          connected_at: item.created_at ?? "",
          expires_at: expiresAt,
          is_active: Boolean(item.is_active),
          status,
        };
      });

      const connectedTotal = connections.filter(
        c => c.status === "connected"
      ).length;
      const needsReconnectTotal = connections.filter(
        c => c.status === "needs_reconnect"
      ).length;
      const disconnectedTotal = connections.filter(
        c => c.status === "disconnected"
      ).length;
      const activeTotal = connectedTotal + needsReconnectTotal;

      const status = {
        connections,
        total: connections.length,
        activeTotal,
        connectedTotal,
        needsReconnectTotal,
        disconnectedTotal,
      };

      gmailStatusCache.set(userId, {
        status,
        expiresAt: Date.now() + GMAIL_STATUS_TTL_MS,
      });

      return status;
    })();

    gmailStatusInFlight.set(userId, request);
    try {
      return await request;
    } finally {
      gmailStatusInFlight.delete(userId);
    }
  },

  async getWatches(userId: string): Promise<GmailWatch[]> {
    const supabase = await getSupabase();

    const { data, error } = await supabase
      .from("gmail_watches")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true);

    if (error) {
      console.error("Error fetching Gmail watches:", error);
      return [];
    }

    return data || [];
  },

  async connectGmail(): Promise<void> {
    const [supabase, edgeFunctionsUrl] = await Promise.all([
      getSupabase(),
      getEdgeFunctionsUrl(),
    ]);

    // Get the current session token
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();

    if (error || !session?.access_token) {
      throw new Error(
        "No active session. Please refresh the page and try again."
      );
    }

    // Verify we can get the user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(session.access_token);

    if (userError || !user) {
      throw new Error(
        "Could not get user. Please refresh the page and try again."
      );
    }

    // Redirect to Supabase Edge Function auth endpoint
    window.location.href = `${edgeFunctionsUrl}/auth-start?token=${session.access_token}`;
  },

  async disconnectGmail(
    connectionId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const supabase = await getSupabase();
      const edgeFunctionsUrl = await getEdgeFunctionsUrl();

      // Get the current session token
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("No active session");
      }

      // Call the gmail-disconnect Edge Function (uses path param for connectionId)
      const config = await getConfig();
      const response = await fetch(
        `${edgeFunctionsUrl}/gmail-disconnect/${connectionId}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: config.supabase.anonKey,
          },
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData?.error || "Failed to disconnect Gmail");
      }

      return { success: true };
    } catch (error) {
      console.error("Error disconnecting Gmail:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
};
