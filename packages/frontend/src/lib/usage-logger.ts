/**
 * Centralised logging for the usage panel.
 *
 * The usage pipeline produces a mix of "expected" warnings (a usage
 * counter row for an older period, a scope prefix the frontend
 * doesn't know about, an enum value added in the DB that the
 * frontend hasn't picked up) and unexpected errors (RPC transport
 * failures, query shape drift). Separating them by level and
 * prepending `[usage]` keeps observability filters clean without
 * pulling in a logging library for two call sites.
 */

export type LogContext = Record<string, unknown>;

function format(msg: string, ctx?: LogContext): string {
  if (!ctx || Object.keys(ctx).length === 0) return msg;
  try {
    return `${msg} ${JSON.stringify(ctx)}`;
  } catch {
    return msg;
  }
}

export function usageWarn(msg: string, ctx?: LogContext): void {
  console.warn(`[usage] ${format(msg, ctx)}`);
}

function usageError(msg: string, ctx?: LogContext): void {
  console.error(`[usage] ${format(msg, ctx)}`);
}

function usageInfo(msg: string, ctx?: LogContext): void {
  console.info(`[usage] ${format(msg, ctx)}`);
}
