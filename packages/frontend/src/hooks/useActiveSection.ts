import { useCallback, useEffect, useState } from "react";

/**
 * Track which section is currently in view using an
 * IntersectionObserver. The first section is active initially;
 * as the user scrolls, whichever section is in the top 30% of
 * the viewport becomes active.
 *
 * `setManual(id)` is called when the user clicks a nav link. It
 * locks the active id until the next real user scroll
 * (wheel/touchmove/keydown) — programmatic scrolls from the
 * anchor jump don't release the lock, so the clicked item stays
 * active while the page smooth-scrolls to it.
 */
export function useActiveSection(ids: string[]) {
  const [activeId, setActiveId] = useState<string>(ids[0] ?? "");
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    if (ids.length === 0) return;
    if (locked) return;

    const elements: HTMLElement[] = [];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) elements.push(el);
    }
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(entry => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          const id = visible[0].target.id;
          setActiveId(prev => (prev === id ? prev : id));
        }
      },
      {
        rootMargin: "-20% 0px -70% 0px",
        threshold: 0,
      }
    );

    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  }, [ids, locked]);

  // Release the lock only on real user-initiated scroll events.
  useEffect(() => {
    if (!locked) return;
    const release = () => setLocked(false);
    window.addEventListener("wheel", release, { passive: true });
    window.addEventListener("touchmove", release, { passive: true });
    const onKey = (e: KeyboardEvent) => {
      if (
        [
          "PageUp",
          "PageDown",
          "ArrowUp",
          "ArrowDown",
          "Home",
          "End",
          " ",
        ].includes(e.key)
      ) {
        release();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("wheel", release);
      window.removeEventListener("touchmove", release);
      window.removeEventListener("keydown", onKey);
    };
  }, [locked]);

  const setManual = useCallback((id: string) => {
    setLocked(true);
    setActiveId(id);
  }, []);

  return { activeId, setManual };
}
