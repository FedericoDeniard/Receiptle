/**
 * Pure functions for the usage panel.
 *
 * Everything in this file is testable with bun:test without any
 * browser or Supabase. The service layer composes these primitives;
 * components consume their typed outputs.
 */
import type { Capability } from "../lib/capabilities";
import { usageWarn } from "../lib/usage-logger";

/**
 * Mirrors `payments.usage_scope_kind` in the database. Kept in sync
 * with the enum so the TypeScript layer catches drift at build time
 * (an INSERT/UPDATE with an unknown value would fail at the DB layer
 * regardless). If a new prefix is added to the enum, this union must
 * grow.
 */
type UsageScopeKind = "role" | "plan" | "default" | "team" | "org";

/**
 * Mirrors `payments.usage_period`. Today the panel only renders monthly
 * counters, so other periods are filtered out at the resolver level.
 */
type UsagePeriod = "month" | "day" | "hour";

// ---------- Limit resolution ----------

export interface UsageLimitRow {
  capability: Capability;
  scopeKind: UsageScopeKind;
  /** NULL only for `scopeKind === "default"` rows (per DB CHECK). */
  scopeValue: string | null;
  period: UsagePeriod;
  maxCount: number;
}

export interface ResolvedLimit {
  value: number;
  scopeKind: UsageScopeKind;
  scopeValue: string | null;
}

/**
 * Walk the role → plan → default chain for a single capability and
 * return the first matching row, plus the scope that matched (for
 * the tooltip).
 *
 * `role` and `planKey` may be null (free user with no subscription).
 * Period filter keeps the resolver fast on tables that mix month/day
 * rows. Returns `null` if no row matches at any scope — the panel
 * then skips the capability entirely (no usage bar to draw).
 *
 * The lookup is plain `.find` over an in-memory array because the
 * panel already has the full `usage_limits` table cached and the
 * alternative (one RPC per capability) is the N+1 anti-pattern.
 */
export function resolveUsageLimit(
  role: string | null,
  planKey: string | null,
  capability: Capability,
  limits: UsageLimitRow[]
): ResolvedLimit | null {
  const candidates: ReadonlyArray<{
    scopeKind: UsageScopeKind;
    scopeValue: string | null;
  }> = [
    { scopeKind: "role", scopeValue: role },
    { scopeKind: "plan", scopeValue: planKey },
    { scopeKind: "default", scopeValue: null },
  ];

  for (const c of candidates) {
    // Skip candidates that don't have the value the row needs.
    // 'default' always has a value of null and matches any default row.
    // 'role' / 'plan' need a non-null value from the caller.
    if (c.scopeKind !== "default" && !c.scopeValue) continue;
    const row = limits.find(
      l =>
        l.capability === capability &&
        l.period === "month" &&
        l.scopeKind === c.scopeKind &&
        l.scopeValue === c.scopeValue
    );
    if (row) {
      return {
        value: row.maxCount,
        scopeKind: row.scopeKind,
        scopeValue: row.scopeValue,
      };
    }
  }

  return null;
}

// ---------- Period math (UTC) ----------

/**
 * Return the ISO timestamp for the first instant of the current
 * calendar month in UTC. Matches `date_trunc('month', now())` in
 * Postgres when the session timezone is UTC (which is the local
 * stack's default).
 */
export function startOfMonthUtc(now: Date = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)
  ).toISOString();
}

/**
 * Add `n` calendar months to an ISO timestamp, returning a new ISO
 * timestamp. Handles month-end edge cases (Jan 31 → Feb 28/29) and
 * year boundaries (Dec → Jan) via `Date.setUTCDate(0)` which rolls
 * over to the last day of the previous month when the target month
 * doesn't have enough days.
 */
export function addMonthsIso(iso: string, n: number): string {
  const d = new Date(iso);
  const targetMonth = d.getUTCMonth() + n;
  const targetYear = d.getUTCFullYear() + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(
    Date.UTC(targetYear, normalizedMonth + 1, 0)
  ).getUTCDate();
  const day = Math.min(d.getUTCDate(), lastDayOfTargetMonth);
  return new Date(
    Date.UTC(
      targetYear,
      normalizedMonth,
      day,
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
      d.getUTCMilliseconds()
    )
  ).toISOString();
}

/**
 * Format a period_start ISO string as `YYYY-MM-DD` for the reset
 * line. Stable across locales (we render the resolved date, not a
 * relative format).
 */
export function formatResetDate(iso: string): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Compute `resets_at` from a `period_start`. For monthly periods,
 * returns the same day one calendar month later. Year boundaries
 * (Dec → Jan) are handled by `addMonthsIso`.
 */
export function computeResetsAt(periodStart: string): string {
  return addMonthsIso(periodStart, 1);
}

// ---------- Threshold classification ----------

export type UsageRowStatus = "ok" | "warn" | "exceeded";

/**
 * Pick the colour bucket for the progress bar based on percentage of
 * limit consumed.
 *
 * Thresholds (from MON-23 acceptance criteria):
 *   - 0–79%  → "ok"      (var(--success))
 *   - 80–99% → "warn"    (var(--warning))
 *   - ≥100%  → "exceeded" (var(--error))
 *
 * A limit of zero is "exceeded" regardless of `used` (the gate
 * rejects every call; we render the row accordingly).
 */
export function getUsageRowStatus(used: number, limit: number): UsageRowStatus {
  if (limit <= 0) return "exceeded";
  const pct = (used / limit) * 100;
  if (pct >= 100) return "exceeded";
  if (pct >= 80) return "warn";
  return "ok";
}

// ---------- Counter row parsing ----------

export interface UsageCounterRow {
  capability: Capability;
  count: number;
  period_start: string;
}

/**
 * Find the counter row for a single capability in the current period.
 * If no row exists, returns `null` (the caller should default `used`
 * to 0 and use the client-computed start-of-month as the period).
 *
 * The service already filters counters via
 * `.gte("period_start", clientPeriodStart)` so every row it returns
 * is from the current period. We compare via Date timestamp (not raw
 * string equality) because Postgres serializes timestamptz as
 * `2026-07-01T00:00:00+00:00` while JS `toISOString()` produces
 * `2026-07-01T00:00:00.000Z` — semantically the same instant, but the
 * strings don't match.
 */
export function findCurrentPeriodCounter(
  capability: Capability,
  counters: UsageCounterRow[],
  clientPeriodStart: string = startOfMonthUtc()
): UsageCounterRow | null {
  const clientMs = Date.parse(clientPeriodStart);
  for (const row of counters) {
    if (row.capability !== capability) continue;
    if (Date.parse(row.period_start) === clientMs) return row;
    // Different period start than expected (e.g. counter created
    // mid-period with a non-truncated timestamp). The service's gte
    // filter caught it but the date string differs — log and use it
    // as ground truth anyway.
    usageWarn("counter period mismatch", {
      capability,
      serverPeriodStart: row.period_start,
      clientPeriodStart,
    });
    return row;
  }
  return null;
}
