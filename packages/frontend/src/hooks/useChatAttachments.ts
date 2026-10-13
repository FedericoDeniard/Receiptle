import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  uploadChatAttachments,
  deleteChatAttachments,
  type ChatAttachment,
} from "../services/chat-attachments.service";
import { queryKeys } from "../lib/query-client";

interface UploadVariables {
  threadId: string;
  files: File[];
}

/**
 * Mutation hook that uploads a batch of files to Supabase Storage and
 * persists metadata rows in public.chat_attachments.
 *
 * Returns the successful uploads (with signed URLs) so the caller can swap
 * blob URLs in the message stream for the persisted attachments.
 */
export function useUploadChatAttachments() {
  const queryClient = useQueryClient();
  return useMutation<ChatAttachment[], Error, UploadVariables>({
    mutationFn: ({ threadId, files }) => uploadChatAttachments(threadId, files),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.chatThreads.all });
    },
  });
}

/**
 * Mutation hook that removes a batch of uploaded attachments (storage
 * object + metadata row). Used to roll back a send when the model rejects
 * the request — e.g. text-only model receiving an image.
 */
export function useDeleteChatAttachments() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, ChatAttachment[]>({
    mutationFn: attachments => deleteChatAttachments(attachments),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.chatThreads.all });
    },
  });
}
