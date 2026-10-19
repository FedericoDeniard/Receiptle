import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { LazyMotion, m, AnimatePresence, domAnimation } from "framer-motion";
import { useAuth } from "../hooks/useAuth";
import { useConfig } from "../hooks/useConfig";
import { useChatThreads, useThreadMessages } from "../hooks/useChatThreads";
import { chatMessagesToUIMessages } from "../lib/mastra-messages";
import { useChatErrorRecovery } from "../hooks/useChatErrorRecovery";
import { ChatFlow } from "../components/assistant/ChatFlow";
import { GreetingView } from "../components/assistant/GreetingView";
import { AssistantDisclaimer } from "../components/assistant/AssistantDisclaimer";
import { AssistantSkeleton } from "../components/assistant/AssistantSkeleton";

export function Assistant() {
  const navigate = useNavigate();
  const { threadId: threadIdParam } = useParams<{ threadId: string }>();
  const { user, session, loading: authLoading } = useAuth();
  const { data: config, isLoading: configLoading } = useConfig();
  const { chatInstance, trigger: triggerHardError } = useChatErrorRecovery();
  const { data: historyMessages, isFetched: messagesFetched } =
    useThreadMessages(threadIdParam ?? null);
  const { refetch: refetchThreads } = useChatThreads();

  const resourceId = user?.id ?? "anonymous";

  const initialMessages = useMemo(() => {
    if (!threadIdParam || !messagesFetched) {
      return null;
    }
    const seenIds = new Set<string>();
    const deduped = (historyMessages ?? []).filter(m => {
      if (!m.id || seenIds.has(m.id)) return false;
      seenIds.add(m.id);
      return true;
    });
    return chatMessagesToUIMessages(deduped);
    // chatMessagesToUIMessages is referentially stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadIdParam, historyMessages, messagesFetched]);

  const isReady =
    !authLoading &&
    !configLoading &&
    !!config?.mastraServerUrl &&
    !!session?.access_token;

  // Navigate back to the greeting view when the greeting auto-send fails
  // on an unsupported image. Mastra caches the message asynchronously and
  // would re-send it on every subsequent request from the same thread.
  const handleGreetingImageError = () => {
    navigate("/assistant");
  };

  // Shared navigation callbacks for both views. Each view wraps these
  // with the useAssistantShell hook to also close the history sidebar.
  const handleSelectThread = (id: string) => {
    navigate(`/assistant/${id}`);
  };
  const handleNewChat = () => {
    navigate("/assistant");
  };

  // Show a centered spinner while we wait for the auth/config that the
  // chat view needs before mounting the ChatPanel.
  if (threadIdParam && !isReady) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <AssistantSkeleton />
      </div>
    );
  }

  const viewKey = threadIdParam ? `chat-${threadIdParam}` : "greeting";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <LazyMotion features={domAnimation} strict>
        <AnimatePresence mode="wait" initial={false}>
          <m.div
            key={viewKey}
            initial={{ opacity: 0, y: 24, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -24, filter: "blur(8px)" }}
            transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
            className="relative flex flex-1 min-h-0 flex-col"
          >
            {threadIdParam ? (
              <ChatFlow
                threadId={threadIdParam}
                apiUrl={`${config.mastraServerUrl}/chat/financial-agent`}
                accessToken={session.access_token}
                resourceId={resourceId}
                initialMessages={initialMessages}
                onMessageComplete={() => {
                  void refetchThreads();
                }}
                onHardError={triggerHardError}
                onGreetingImageError={handleGreetingImageError}
                onSelectThread={handleSelectThread}
                onNewChat={handleNewChat}
                chatKey={`${threadIdParam}-${chatInstance}`}
              />
            ) : (
              <GreetingView
                onSelectThread={handleSelectThread}
                onNewChat={handleNewChat}
                isReady={isReady}
              />
            )}
          </m.div>
        </AnimatePresence>
      </LazyMotion>
      <AssistantDisclaimer />
    </div>
  );
}
