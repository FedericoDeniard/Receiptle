import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Suggestion } from "../ai-elements/suggestion";
import { AssistantInput } from "./AssistantInput";
import { AssistantHeader } from "./AssistantHeader";
import { AssistantLayout } from "./AssistantLayout";
import { QuickQuestions } from "./QuickQuestions";
import { Skeleton } from "../ui/Skeleton";
import { useAssistantShell } from "../../hooks/useAssistantShell";
import { generateThreadId, queueAutoSend } from "../../lib/assistant-store";

const QUICK_QUESTIONS = [
  "topExpenses",
  "topIncome",
  "subscriptionsTotal",
  "savings",
] as const;

interface GreetingViewProps {
  onSelectThread: (threadId: string) => void;
  onNewChat: () => void;
  isReady: boolean;
}

export function GreetingView({
  onSelectThread,
  onNewChat,
  isReady,
}: GreetingViewProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const shell = useAssistantShell({ onSelectThread, onNewChat });

  return (
    <AssistantLayout activeThreadId={null} {...shell}>
      <AssistantHeader />

      <div className="w-full max-w-3xl mx-auto space-y-4 px-4 pb-4 lg:pb-8">
        <QuickQuestions>
          {QUICK_QUESTIONS.map(key => (
            <Suggestion
              key={key}
              suggestion={t(`assistant.quickQuestions.${key}`)}
              onClick={text => {
                const threadId = generateThreadId();
                queueAutoSend(threadId, { text, files: [] });
                navigate(`/assistant/${threadId}`);
              }}
              className="border-[var(--text-secondary)]/20 transition-colors hover:border-[var(--button-primary)] hover:bg-[var(--button-primary)]/5 hover:text-[var(--button-primary)]"
            />
          ))}
        </QuickQuestions>

        {!isReady ? (
          <Skeleton className="h-24 w-full rounded-2xl" />
        ) : (
          <AssistantInput
            resolveThreadId={generateThreadId}
            onSend={({ threadId, text, files }) => {
              queueAutoSend(threadId, { text, files });
              navigate(`/assistant/${threadId}`);
            }}
            showHistory={shell.showHistory}
            onToggleHistory={shell.onToggleHistory}
            placeholder={t("assistant.placeholder")}
          />
        )}
      </div>
    </AssistantLayout>
  );
}
