import { ChatPanel } from "./ChatPanel";
import { AssistantLayout } from "./AssistantLayout";
import { AssistantSkeleton } from "./AssistantSkeleton";
import { useAssistantShell } from "../../hooks/useAssistantShell";
import type { UIMessage } from "ai";

interface ChatFlowProps {
  threadId: string;
  apiUrl: string;
  accessToken: string;
  resourceId: string;
  initialMessages: UIMessage[] | null;
  onMessageComplete: () => void;
  onHardError: () => void;
  onGreetingImageError?: () => void;
  onSelectThread: (threadId: string) => void;
  onNewChat: () => void;
  /**
   * Bumped by the parent after a hard chat error so the ChatPanel remounts
   * with a fresh useChat instance. The hook keeps its own internal stream
   * history, so a setMessages call alone is not enough to stop it from
   * re-sending the failed file part on the next submission.
   */
  chatKey: string;
}

/**
 * Chat view shown when the URL is /assistant/:threadId. Renders the
 * shared AssistantLayout shell and mounts a ChatPanel inside it. The
 * disclaimer is rendered by the parent so it stays anchored at the
 * bottom of the page.
 */
export function ChatFlow({
  threadId,
  apiUrl,
  accessToken,
  resourceId,
  initialMessages,
  onMessageComplete,
  onHardError,
  onGreetingImageError,
  onSelectThread,
  onNewChat,
  chatKey,
}: ChatFlowProps) {
  const shell = useAssistantShell({ onSelectThread, onNewChat });

  return (
    <AssistantLayout activeThreadId={threadId} {...shell}>
      {initialMessages === null ? (
        <AssistantSkeleton />
      ) : (
        <ChatPanel
          key={chatKey}
          apiUrl={apiUrl}
          accessToken={accessToken}
          resourceId={resourceId}
          threadId={threadId}
          initialMessages={initialMessages}
          onMessageComplete={onMessageComplete}
          showHistory={shell.showHistory}
          onToggleHistory={shell.onToggleHistory}
          onHardError={onHardError}
          onGreetingImageError={onGreetingImageError}
        />
      )}
    </AssistantLayout>
  );
}
