import { Skeleton, SkeletonCircle, SkeletonRegion } from "../ui/Skeleton";

type AssistantSkeletonVariant = "conversation" | "history";

const HISTORY_ROWS = [0, 1, 2, 3, 4, 5];

interface AssistantSkeletonProps {
  variant?: AssistantSkeletonVariant;
}

/**
 * Assistant placeholders: `conversation` mirrors the chat transcript plus
 * input bar, `history` mirrors the thread list rows.
 */
export function AssistantSkeleton({
  variant = "conversation",
}: AssistantSkeletonProps) {
  if (variant === "history") {
    return (
      <SkeletonRegion className="space-y-1 p-2">
        {HISTORY_ROWS.map(i => (
          <div key={i} className="flex items-center gap-3 rounded-lg p-2">
            <Skeleton className="size-8 shrink-0 rounded-md" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-40 max-w-[70%]" />
              <Skeleton className="h-2.5 w-24 max-w-[40%]" />
            </div>
          </div>
        ))}
      </SkeletonRegion>
    );
  }

  return (
    <SkeletonRegion className="flex min-h-0 flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
        <div className="flex items-start gap-3">
          <SkeletonCircle className="size-8 shrink-0" />
          <div className="w-full max-w-md space-y-2">
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        </div>

        <div className="flex justify-end">
          <Skeleton className="h-14 w-64 max-w-[70%] rounded-2xl" />
        </div>

        <div className="flex items-start gap-3">
          <SkeletonCircle className="size-8 shrink-0" />
          <Skeleton className="h-28 w-full max-w-md rounded-2xl" />
        </div>
      </div>

      <div className="border-t border-[var(--text-secondary)]/20 p-4">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2 rounded-2xl border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] p-3">
          <Skeleton className="h-5 flex-1" />
          <Skeleton className="size-8 rounded-lg" />
        </div>
      </div>
    </SkeletonRegion>
  );
}
