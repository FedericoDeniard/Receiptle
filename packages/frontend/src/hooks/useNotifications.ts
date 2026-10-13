import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "../lib/supabase";
import { queryKeys } from "../lib/query-client";
import {
  createNotificationsService,
  type NotificationImportance,
  type NotificationListFilters,
} from "../services/notifications.service";
import { useAuth } from "./useAuth";

async function getService() {
  const supabase = await getSupabase();
  return createNotificationsService(supabase);
}

export function useNotifications(filters: NotificationListFilters = {}) {
  return useQuery({
    queryKey: queryKeys.notifications.list(filters),
    queryFn: async () => {
      const service = await getService();
      return service.listNotifications(filters);
    },
    staleTime: 30 * 1000,
  });
}

export function useUnreadNotificationsCount() {
  return useQuery({
    queryKey: [...queryKeys.notifications.all, "unread-count"],
    queryFn: async () => {
      const service = await getService();
      return service.getUnreadCount();
    },
    staleTime: 30 * 1000,
  });
}

type BulkActionPayload = {
  ids: string[];
};

export function useNotificationActions() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
  };

  const markAsRead = useMutation({
    mutationFn: async ({ ids }: BulkActionPayload) => {
      const service = await getService();
      await service.markAsRead(ids);
    },
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({
        queryKey: queryKeys.notificationPreferences.all,
      });
    },
  });

  const markAsUnread = useMutation({
    mutationFn: async ({ ids }: BulkActionPayload) => {
      const service = await getService();
      await service.markAsUnread(ids);
    },
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({
        queryKey: queryKeys.notificationPreferences.all,
      });
    },
  });

  const archive = useMutation({
    mutationFn: async ({ ids }: BulkActionPayload) => {
      const service = await getService();
      await service.archive(ids);
    },
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({
        queryKey: queryKeys.notificationPreferences.all,
      });
    },
  });

  const mute = useMutation({
    mutationFn: async ({ ids }: BulkActionPayload) => {
      const service = await getService();
      await service.mute(ids);
    },
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({
        queryKey: queryKeys.notificationPreferences.all,
      });
    },
  });

  const setImportance = useMutation({
    mutationFn: async ({
      ids,
      importance,
    }: BulkActionPayload & { importance: NotificationImportance }) => {
      const service = await getService();
      await service.setImportance(ids, importance);
    },
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({
        queryKey: queryKeys.notificationPreferences.all,
      });
    },
  });

  const remove = useMutation({
    mutationFn: async ({ ids }: BulkActionPayload) => {
      const service = await getService();
      await service.delete(ids);
    },
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({
        queryKey: queryKeys.notificationPreferences.all,
      });
    },
  });

  return {
    markAsRead,
    markAsUnread,
    archive,
    mute,
    setImportance,
    remove,
  };
}

export function useNotificationsRealtime() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // oxlint-disable-next-line react-doctor/effect-needs-cleanup
  useEffect(() => {
    if (!user?.id) return;

    let channel: ReturnType<
      Awaited<ReturnType<typeof getSupabase>>["channel"]
    > | null = null;

    const setup = async () => {
      const supabase = await getSupabase();
      channel = supabase
        .channel("notifications-changes")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${user.id}`,
          },
          () => {
            queryClient.invalidateQueries({
              queryKey: queryKeys.notifications.all,
            });
          }
        )
        .subscribe();
    };

    setup();
    return () => {
      if (channel) channel.unsubscribe();
    };
  }, [queryClient, user?.id]);
}
