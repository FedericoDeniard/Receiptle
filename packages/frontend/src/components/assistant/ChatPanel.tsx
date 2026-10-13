import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useChat, type UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
} from "../ai-elements/conversation";
import { Message, MessageContent } from "../ai-elements/message";
import { AssistantInput } from "./AssistantInput";
import { AnimatedMessage } from "./AnimatedMessage";
import { MessageParts } from "./MessageParts";
import { TypingIndicator } from "./TypingIndicator";
import { useDeleteChatAttachments } from "../../hooks/useChatAttachments";
import { toast } from "../../utils/toast";
import { getEdgeFunctionErrorMessage } from "../../utils/edge-function-errors";
import { getSupabase } from "../../lib/supabase";
import { queryKeys } from "../../lib/query-client";
import {
  clearLegacyPendingStorage,
  consumeAutoSend,
} from "../../lib/assistant-store";
import type { ChatAttachment } from "../../services/chat-attachments.service";

interface ChatPanelProps {
  apiUrl: string;
  accessToken: string;
  resourceId: string;
  threadId: string;
  initialMessages: UIMessage[];
  onMessageComplete: () => void;
  showHistory: boolean;
  onToggleHistory: () => void;
  onHardError: () => void;
  onGreetingImageError?: () => void;
}

function isUnsupportedImageMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("image input") ||
    lower.includes("does not support image") ||
    (lower.includes("vision") && lower.includes("support"))
  );
}

/**
 * Owns the useChat hook. Remounts whenever the threadId from the URL
 * changes (parent provides a new `key`), so each thread gets a fresh
 * Chat instance hydrated from initialMessages.
 */
export function ChatPanel({
  apiUrl,
  accessToken,
  resourceId,
  threadId,
  initialMessages,
  onMessageComplete,
  showHistory,
  onToggleHistory,
  onHardError,
  onGreetingImageError,
}: ChatPanelProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const deleteAttachments = useDeleteChatAttachments();

  // Snapshot DB messages at mount — useChat only reads `messages` in the constructor.
  // Parent must not refetch mid-session (would pass stale partial DB rows).
  const bootstrapMessagesRef = useRef(initialMessages);
  const initialMessageIdsRef = useRef<Set<string> | null>(null);
  if (initialMessageIdsRef.current === null) {
    initialMessageIdsRef.current = new Set(initialMessages.map(m => m.id));
  }
  // Track the most recent uploaded attachments so we can roll them back
  // (delete from storage + DB) if the model rejects the request.
  const pendingAttachmentsRef = useRef<ChatAttachment[]>([]);
  // Set to true only during the greeting auto-send (consumeAutoSend).
  // Error handler checks this to decide whether to navigate back to
  // greeting on image errors — bootstrapMessagesRef would not help
  // because it captures initialMessages at mount time and never updates.
  const isGreetingAutoSendRef = useRef(false);
  // Captures the last user message we sent so the error handler can
  // remove it from the local message list — otherwise the failed prompt
  // stays on screen, the next send replays the same broken history,
  // and the empty assistant reply piles on top.
  const lastSentUserIdRef = useRef<string | null>(null);
  const respondedApprovalIdsRef = useRef(new Set<string>());

  const keepaliveFetch = useCallback<typeof fetch>(
    (input, init) => fetch(input, { ...init, keepalive: true }),
    []
  );

  // Stable browser timezone (IANA identifier, e.g.
  // "America/Argentina/Buenos_Aires"). Computed once; the mastra-server
  // middleware reads it so tools like getCurrentDateTool and
  // getSpendingSummaryTool resolve dates in the user's local timezone.
  const userTimezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    []
  );

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: apiUrl,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-User-Timezone": userTimezone,
        },
        fetch: keepaliveFetch,
        prepareSendMessagesRequest: ({ messages }) => {
          const lastMessage = messages.at(-1);
          return {
            body: {
              // Mastra loads history from DB — send only the new message.
              // @see https://mastra.ai/guides/build-your-ui/ai-sdk-ui#using-mastra-memory
              messages: lastMessage ? [lastMessage] : [],
              memory: { thread: threadId, resource: resourceId },
            },
          };
        },
      }),
    [apiUrl, accessToken, resourceId, threadId, keepaliveFetch, userTimezone]
  );

  const handleAttachmentsUploaded = useCallback(
    (attachments: ChatAttachment[]) => {
      pendingAttachmentsRef.current = attachments;
    },
    []
  );

  const {
    messages,
    sendMessage,
    status,
    stop,
    error,
    setMessages,
    addToolApprovalResponse,
  } = useChat({
    id: threadId,
    transport,
    messages:
      bootstrapMessagesRef.current.length > 0
        ? bootstrapMessagesRef.current
        : undefined,
    // Auto-send a new request whenever a tool approval has been responded to
    // (state === "approval-responded"). Without this, `addToolApprovalResponse`
    // only updates the local part state and never makes a server request, so
    // the agent's paused run is never resumed and the spinner sticks on
    // "Guardando transacción…" forever.
    sendAutomaticallyWhen: ({ messages: msgs }) => {
      const last = msgs.at(-1);
      if (!last || last.role !== "assistant") return false;
      return last.parts.some(
        (p: { type?: string; state?: string }) =>
          typeof p.type === "string" &&
          p.type.startsWith("tool-") &&
          p.state === "approval-responded"
      );
    },
  });

  const handleToolResponse = useCallback(
    (id: string, approved: boolean) => {
      if (respondedApprovalIdsRef.current.has(id)) return;
      respondedApprovalIdsRef.current.add(id);
      addToolApprovalResponse({ id, approved });
    },
    [addToolApprovalResponse]
  );
  const handleApproveTool = useCallback(
    (id: string) => {
      handleToolResponse(id, true);
    },
    [handleToolResponse]
  );
  const handleRejectTool = useCallback(
    (id: string) => {
      handleToolResponse(id, false);
    },
    [handleToolResponse]
  );

  // React to error state changes. Wrapped in useEffect (not onError)
  // so we can read setMessages after the hook call without ref-mirroring.
  useEffect(() => {
    if (!error) return;
    const lastId = lastSentUserIdRef.current;
    const isGreeting = isGreetingAutoSendRef.current;
    const isUnsupported = isUnsupportedImageMessage(
      error instanceof Error ? error.message : String(error ?? "")
    );
    const err = error;

    // Drop the offending user message from local state.
    setMessages(prev => {
      if (lastId) {
        const idx = prev.findIndex(m => m.id === lastId);
        if (idx === -1) return prev;
        return prev.slice(0, idx);
      }
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].role === "user") {
          return prev.slice(0, i);
        }
      }
      return prev;
    });
    lastSentUserIdRef.current = null;

    if (isUnsupported) {
      const pending = pendingAttachmentsRef.current;
      if (pending.length > 0) {
        void deleteAttachments.mutateAsync(pending).catch(e => {
          console.error(
            "[Assistant] failed to roll back attachments after provider error",
            e
          );
        });
        pendingAttachmentsRef.current = [];
      }
      if (isGreeting) {
        isGreetingAutoSendRef.current = false;
        void (async () => {
          const supabase = await getSupabase();
          if (lastId) {
            const { error: delErr } = await supabase
              .from("mastra_messages")
              .delete()
              .eq("id", lastId);
            if (delErr) {
              console.error(
                "[Assistant] failed to delete message from Mastra memory",
                delErr
              );
            } else {
              await queryClient.invalidateQueries({
                queryKey: queryKeys.chatThreads.messages(threadId),
              });
            }
          }
          toast.error(t("assistant.imageNotSupported"));
          onGreetingImageError?.();
        })();
        return;
      }
      toast.error(t("assistant.imageNotSupported"));
      onHardError();
      return;
    }

    toast.error(getEdgeFunctionErrorMessage(err, t));
    // The chat route runs `check_and_increment_usage(ai_assistant)`
    // before opening the stream; an error after that point means
    // the counter was already incremented (no rollback unless
    // quota was exhausted). Invalidate so the usage panel refetches
    // on its next mount and reflects reality.
    queryClient.invalidateQueries({ queryKey: queryKeys.usage.all });
    onHardError();
  }, [
    error,
    setMessages,
    deleteAttachments,
    queryClient,
    threadId,
    t,
    onHardError,
    onGreetingImageError,
  ]);

  // useEffectEvent gives us a stable callback that always reads the
  // latest `messages` from useChat — no need to mirror it into a ref.
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const wrappedSendMessage = useCallback(
    (msg: Parameters<typeof sendMessage>[0]) => {
      sendMessage(msg);
      // Defer to next tick so the optimistic message is in `messages`.
      queueMicrotask(() => {
        const lastUser = [...messagesRef.current]
          .reverse()
          .find(m => m.role === "user");
        if (lastUser) {
          lastSentUserIdRef.current = lastUser.id;
        }
      });
    },
    [sendMessage]
  );

  // Drop the pending-attachments list once the assistant has successfully
  // responded to that user message — at that point the upload is "used".
  // Also clears the greeting-auto-send flag so subsequent image errors in
  // this thread are handled via the normal hard-error (remount) flow.
  useEffect(() => {
    if (status === "ready") {
      if (pendingAttachmentsRef.current.length > 0) {
        pendingAttachmentsRef.current = [];
        lastSentUserIdRef.current = null;
      }
      if (isGreetingAutoSendRef.current) {
        isGreetingAutoSendRef.current = false;
      }
    }
  }, [status, messages.length]);

  useEffect(() => {
    clearLegacyPendingStorage(threadId);

    // Auto-send once for brand-new threads (in-memory queue, cleared on F5).
    if (bootstrapMessagesRef.current.length > 0) return;
    const payload = consumeAutoSend(threadId);
    if (payload) {
      isGreetingAutoSendRef.current = true;
      if (payload.files.length > 0) {
        wrappedSendMessage({ text: payload.text, files: payload.files });
      } else if (payload.text) {
        wrappedSendMessage({ text: payload.text });
      }
    }
    // wrappedSendMessage is stable (depends only on sendMessage).
  }, [threadId, wrappedSendMessage]);

  // Refresh the thread list after a message completes
  const wasStreamingRef = useRef(false);
  useEffect(() => {
    if (status === "streaming" || status === "submitted") {
      wasStreamingRef.current = true;
      return;
    }
    if (status === "ready" && wasStreamingRef.current) {
      wasStreamingRef.current = false;
      onMessageComplete();
      // The mastra chat route increments ai_assistant BEFORE the
      // stream opens (resilient-chat-route.ts:179-198), so a
      // successful send has already moved the counter. Invalidate
      // so the next mount of the Settings usage panel shows the new
      // number.
      queryClient.invalidateQueries({ queryKey: queryKeys.usage.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.transactionTags.all,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.metrics.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
    }
  }, [status, onMessageComplete, queryClient]);

  const hasMessages = messages.length > 0;
  const isThinking = status === "submitted" || status === "streaming";
  const lastMessage = messages.at(-1);
  const streamingAssistantId =
    isThinking && lastMessage?.role === "assistant" ? lastMessage.id : null;
  const showStandaloneTyping = isThinking && lastMessage?.role === "user";

  return (
    <>
      <Conversation className="relative min-h-0 flex-1 overflow-hidden">
        <ConversationContent className="gap-3 p-0 px-4 pt-4 pb-4 lg:pt-0 justify-end">
          {hasMessages ? (
            messages.map(message => {
              const isUser = message.role === "user";
              const showDots = message.id === streamingAssistantId;
              const isNewMessage = !initialMessageIdsRef.current!.has(
                message.id
              );

              const messageContent = (
                <Message from={message.role} key={message.id}>
                  <MessageContent
                    className={
                      isUser
                        ? "group-[.is-user]:rounded-lg group-[.is-user]:bg-[var(--button-primary)] group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-white"
                        : "rounded-lg bg-[var(--accent)]/40 px-4 py-3 text-[var(--text-primary)]"
                    }
                  >
                    <MessageParts
                      parts={message.parts}
                      isUser={isUser}
                      onApproveTool={handleApproveTool}
                      onRejectTool={handleRejectTool}
                    />
                    {showDots && !isUser && <TypingIndicator />}
                  </MessageContent>
                </Message>
              );

              if (isNewMessage) {
                return (
                  <AnimatedMessage key={message.id}>
                    {messageContent}
                  </AnimatedMessage>
                );
              }

              return messageContent;
            })
          ) : (
            <ConversationEmptyState
              title={t("assistant.emptyChatHint")}
              className="text-[var(--text-secondary)]"
            />
          )}
          {showStandaloneTyping && (
            <Message from="assistant">
              <MessageContent className="rounded-lg bg-[var(--accent)]/40 px-4 py-3 text-[var(--text-primary)]">
                <TypingIndicator />
              </MessageContent>
            </Message>
          )}
        </ConversationContent>
      </Conversation>

      <AssistantInput
        resolveThreadId={() => threadId}
        onSend={({ text, files }) => {
          wrappedSendMessage(files.length > 0 ? { text, files } : { text });
        }}
        onAttachmentsUploaded={handleAttachmentsUploaded}
        status={status}
        stop={stop}
        showHistory={showHistory}
        onToggleHistory={onToggleHistory}
        placeholder={t("assistant.placeholder")}
      />

      {error && !isUnsupportedImageMessage(error.message ?? "") && (
        <p className="text-center text-sm text-red-500">
          {t("assistant.errorGeneric", {
            message: error.message || t("assistant.errorUnknown"),
          })}
        </p>
      )}
    </>
  );
}
