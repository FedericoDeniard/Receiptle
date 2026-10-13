/**
 * Display-time configuration for the usage panel.
 *
 * `USAGE_DISPLAY_ORDER` is hand-rolled (not derived from the enum)
 * because the visual order is a product decision, not a technical
 * one. The order below roughly tracks: "things you used this month"
 * → "things related to a subscription" → "free-tier conveniences".
 * When a new capability is added, the developer adds it in the
 * right position here explicitly.
 *
 * `resolveScopeLabel` maps a stored scope (`role:tester`,
 * `plan:lite_monthly`, `default`) to a localized label via
 * `t()`. Unknown prefixes get the raw scope as the fallback so the
 * panel never shows an empty tooltip if a new prefix ships in the
 * DB before we add a translation.
 */
import { usageWarn } from "./usage-logger";
import type { Translator } from "../utils/edge-function-errors";
import type { Capability } from "./capabilities";

export const USAGE_DISPLAY_ORDER: readonly Capability[] = [
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

/**
 * Human-readable label for a resolved scope. Takes the typed
 * `scopeKind` + `scopeValue` pair (rather than a colon-joined string)
 * so the frontend doesn't have to parse strings. Unknown kinds
 * fall back to a stringified `scopeValue ?? scopeKind` with a
 * `[usage]` warning so the tooltip stays informative without
 * crashing.
 */
function resolveScopeLabel(
  scopeKind: "role" | "plan" | "default" | "team" | "org",
  scopeValue: string | null,
  t: Translator
): string {
  if (scopeKind === "default") return t("settings.usage.scope.default");
  if (scopeKind === "role") {
    return t("settings.usage.scope.roleTest", { role: scopeValue ?? "" });
  }
  if (scopeKind === "plan") {
    return t("settings.usage.scope.plan", { planKey: scopeValue ?? "" });
  }
  // Forward-compat: 'team' / 'org' ship later. Don't crash the panel;
  // just show the qualifier and log.
  usageWarn("unhandled scope_kind in tooltip", { scopeKind, scopeValue });
  return scopeValue ?? scopeKind;
}
