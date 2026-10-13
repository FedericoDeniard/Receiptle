import { useEffect, useRef, useState, useCallback } from "react";

/**
 * Registers the service worker and detects pending updates.
 * The browser checks for a new SW automatically on navigation — no polling needed.
 */
export function useAppUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const waitingWorker = useRef<ServiceWorker | null>(null);
  // Only reload when the user explicitly triggered the update via applyUpdate().
  // This prevents an automatic reload on first-time SW installation (clients.claim()
  // also fires controllerchange, but we don't want to reload in that case).
  const isUpdating = useRef(false);

  // oxlint-disable-next-line react-doctor/effect-needs-cleanup
  useEffect(() => {
    if (
      !("serviceWorker" in navigator) ||
      process.env.NODE_ENV === "development"
    )
      return;

    let cancelled = false;
    let reg: ServiceWorkerRegistration | null = null;
    let newWorker: ServiceWorker | null = null;
    const onStateChange = () => {
      if (
        newWorker &&
        newWorker.state === "installed" &&
        navigator.serviceWorker.controller
      ) {
        waitingWorker.current = newWorker;
        setUpdateAvailable(true);
      }
    };
    const onUpdateFound = () => {
      const worker = reg?.installing;
      if (!worker) return;
      newWorker = worker;
      worker.addEventListener("statechange", onStateChange);
    };
    const onControllerChange = () => {
      if (!isUpdating.current) return;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange
    );

    void (async () => {
      try {
        const r = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });
        if (cancelled) return;
        reg = r;
        if (r.waiting) {
          waitingWorker.current = r.waiting;
          setUpdateAvailable(true);
          return;
        }
        r.addEventListener("updatefound", onUpdateFound);
      } catch (err) {
        console.error("[sw] Registration failed:", err);
      }
    })();

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange
      );
      reg?.removeEventListener("updatefound", onUpdateFound);
      newWorker?.removeEventListener("statechange", onStateChange);
    };
  }, []);

  const applyUpdate = useCallback(() => {
    isUpdating.current = true;
    waitingWorker.current?.postMessage({ type: "SKIP_WAITING" });
  }, []);

  return { updateAvailable, applyUpdate };
}
