import { useEffect, useId } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "../lib/supabase";
import { queryKeys } from "../lib/query-client";
import { createChatThreadsService } from "../services/chat-threads.service";

async function getService() {
  const supabase = await getSupabase();
  return createChatThreadsService(supabase);
}

/**
 * Subscribes to UPDATE events on mastra_threads and invalidates the
 * sidebar's threads query only when the title column actually changes.
 *
 * Mastra's `generateTitle` (configured on the financial agent) runs
 * asynchronously after the first user message is committed, then
 * UPDATEs the thread's title from "" to the generated string. Without
 * this hook the sidebar keeps showing the empty title until the user
 * manually refreshes.
 *
 * The channel name is suffixed with `useId()` so concurrent mounts
 * (React Strict Mode, multiple consumers of useChatThreads, or a
 * stale channel from a previous HMR bundle) don't collide on the
 * realtime socket. Supabase's Postgres Changes spec rejects `.on()`
 * calls after `.subscribe()` and refuses to register a second
 * channel with the same name while the first is live, so unique
 * names per mount sidestep both.
 */
function useMastraThreadTitleRealtime() {
  const queryClient = useQueryClient();
  const channelId = useId();

  // oxlint-disable-next-line react-doctor/effect-needs-cleanup
  useEffect(() => {
    let channel: Awaited<ReturnType<typeof getSupabase>>["channel"] | null =
      null;
    let cancelled = false;

    const setup = async () => {
      const supabase = await getSupabase();
      if (cancelled) return;
      channel = supabase
        .channel(`mastra-threads-titles:${channelId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "ai",
            table: "mastra_threads",
          },
          payload => {
            const newTitle = (payload.new as { title?: string | null })?.title;
            const oldTitle = (payload.old as { title?: string | null })?.title;
            if (newTitle !== oldTitle) {
              queryClient.invalidateQueries({
                queryKey: queryKeys.chatThreads.all,
              });
            }
          }
        )
        .subscribe();
    };

    void setup();

    return () => {
      cancelled = true;
      if (channel) {
        void channel.unsubscribe();
      }
    };
  }, [queryClient, channelId]);
}

export function useChatThreads() {
  useMastraThreadTitleRealtime();
  return useQuery({
    queryKey: queryKeys.chatThreads.all,
    queryFn: async () => {
      const service = await getService();
      return service.listThreads();
    },
    staleTime: 30 * 1000,
  });
}

export function useThreadMessages(threadId: string | null) {
  return useQuery({
    queryKey: threadId
      ? queryKeys.chatThreads.messages(threadId)
      : ["chat-threads", "messages", "disabled"],
    queryFn: async () => {
      if (!threadId) return [];
      const service = await getService();
      return service.listMessages(threadId);
    },
    enabled: !!threadId,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export function useDeleteThread() {
  const queryClient = useQueryClient();
  return {
    mutate: async (threadId: string) => {
      const service = await getService();
      await service.deleteThread(threadId);
      queryClient.invalidateQueries({ queryKey: queryKeys.chatThreads.all });
    },
  };
}
