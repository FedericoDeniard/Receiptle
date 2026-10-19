import { useEffect, useRef, useCallback } from "react";

interface UseInfiniteScrollOptions {
  onLoadMore: () => void;
  hasMore: boolean;
  isLoading: boolean;
  threshold?: number; // Distance from bottom in pixels to trigger load
}

export function useInfiniteScroll({
  onLoadMore,
  hasMore,
  isLoading,
  threshold = 200,
}: UseInfiniteScrollOptions): React.RefObject<HTMLDivElement> {
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [target] = entries;
      if (target.isIntersecting && hasMore && !isLoading) {
        onLoadMore();
      }
    },
    [hasMore, isLoading, onLoadMore]
  );

  useEffect(() => {
    const options = {
      root: null,
      rootMargin: `${threshold}px`,
      threshold: 0.1,
    };

    // The observer lives in this effect's closure so the cleanup
    // deterministically disconnects the instance this effect created.
    const observer = new IntersectionObserver(handleObserver, options);

    if (sentinelRef.current) {
      observer.observe(sentinelRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [handleObserver, threshold]);

  return sentinelRef;
}
