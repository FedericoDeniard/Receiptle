import { useTranslation } from "react-i18next";
import { History, Plus, Trash2 } from "lucide-react";
import { useChatThreads, useDeleteThread } from "../../hooks/useChatThreads";
import { AssistantSkeleton } from "./AssistantSkeleton";
import { cn } from "../../lib/utils";

interface HistoryListProps {
  activeThreadId: string | null;
  onSelect: (threadId: string) => void;
  onNewChat: () => void;
  className?: string;
}

function formatRelativeDate(
  iso: string,
  locale: string,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  const date = new Date(iso);
  const now = new Date();

  // Compare local calendar days so the bucket is stable across the
  // day boundary in the user's timezone, not the server's.
  const startOfDay = (d: Date): number =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.floor((startOfDay(now) - startOfDay(date)) / 86400000);

  if (diffDays === 0) {
    return date.toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (diffDays === 1) return t("assistant.yesterday");
  if (diffDays < 7) return t("assistant.daysAgo", { count: diffDays });
  return date.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
  });
}

export function HistoryList({
  activeThreadId,
  onSelect,
  onNewChat,
  className,
}: HistoryListProps) {
  const { t, i18n } = useTranslation();
  const { data: threads, isLoading } = useChatThreads();
  const { mutate: deleteThread } = useDeleteThread();

  return (
    <div
      className={cn(
        "flex w-full max-w-3xl flex-col md:rounded-2xl md:border md:border-[var(--text-secondary)]/20 md:bg-[var(--bg-primary)] md:shadow-sm h-full",
        className
      )}
    >
      <div className="flex items-center justify-between border-b border-[var(--text-secondary)]/10 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
          <History className="size-4" />
          <span>{t("assistant.history")}</span>
        </div>
        <button
          type="button"
          onClick={onNewChat}
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--text-secondary)]/20 px-3 py-1 text-xs text-[var(--text-primary)] transition-colors hover:border-[var(--button-primary)] hover:text-[var(--button-primary)]"
        >
          <Plus className="size-3.5" />
          <span>{t("assistant.newChat")}</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {isLoading && <AssistantSkeleton variant="history" />}

        {!isLoading && threads?.length === 0 && (
          <div className="px-3 py-6 text-center text-sm text-[var(--text-secondary)]">
            {t("assistant.historyEmpty")}
          </div>
        )}

        {!isLoading &&
          threads?.map(thread => {
            const isActive = thread.id === activeThreadId;
            return (
              <div
                key={thread.id}
                className={cn(
                  "group flex items-center gap-2 rounded-lg px-3 py-2 transition-colors",
                  isActive
                    ? "bg-[var(--button-primary)]/10 text-[var(--button-primary)]"
                    : "hover:bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(thread.id)}
                  className="flex-1 truncate text-left text-sm"
                >
                  <div className="truncate font-medium">
                    {thread.title ?? t("assistant.untitledThread")}
                  </div>
                  <div className="truncate text-xs text-[var(--text-secondary)]">
                    {formatRelativeDate(
                      thread.updatedAtZ ?? thread.updatedAt,
                      i18n.language,
                      t
                    )}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    if (window.confirm(t("assistant.deleteThreadConfirm"))) {
                      deleteThread(thread.id);
                    }
                  }}
                  className="opacity-0 transition-opacity group-hover:opacity-100 text-[var(--text-secondary)] hover:text-red-500"
                  aria-label={t("assistant.deleteThread")}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            );
          })}
      </div>
    </div>
  );
}
