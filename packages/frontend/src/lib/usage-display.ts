/**
 * Display-time configuration for the usage panel.
 *
 * `USAGE_DISPLAY_ORDER` is hand-rolled (not derived from the enum)
 * because the visual order is a product decision, not a technical
 * one. The order below roughly tracks: "things you used this month"
 * → "things related to a subscription" → "free-tier conveniences".
 * When a new capability is added, the developer adds it in the
 * right position here explicitly.
 */
import type { Capability } from "./capabilities";

const USAGE_DISPLAY_ORDER: readonly Capability[] = [
  "ai_assistant",
  "process_documents",
  "report_pdf_export",
  "gmail_sync",
  "push_notifications",
] as const;

/**
 * Sort `rows` by `USAGE_DISPLAY_ORDER`. Capabilities not in the
 * display list (drift case) are appended at the end so the panel
 * still renders them.
 */
export function sortByDisplayOrder<T extends { capability: Capability }>(
  rows: T[]
): T[] {
  const order = new Map<Capability, number>();
  USAGE_DISPLAY_ORDER.forEach((cap, idx) => order.set(cap, idx));
  return rows.toSorted((a, b) => {
    const ai = order.get(a.capability) ?? Number.MAX_SAFE_INTEGER;
    const bi = order.get(b.capability) ?? Number.MAX_SAFE_INTEGER;
    return ai - bi;
  });
}
