import * as Sentry from "@sentry/react";
import {
  classifyEdgeFunctionError,
  type EdgeFunctionErrorType,
} from "../utils/edge-function-errors";

type SentrySource =
  | "uncaught"
  | "error-boundary"
  | "query"
  | "mutation"
  | "realtime";

export interface CaptureContext {
  source: SentrySource;
  queryKey?: readonly unknown[];
  mutationKey?: readonly unknown[];
  attemptCount?: number;
  fingerprint?: string[];
}

const LEVEL_BY_ERROR_TYPE: Record<EdgeFunctionErrorType, Sentry.SeverityLevel> =
  {
    "usage-limit": "info",
    auth: "warning",
    "forbidden-role": "warning",
    "forbidden-capability": "warning",
    network: "error",
    unknown: "warning",
  };

function readStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { status?: unknown; code?: unknown };
  if (typeof candidate.status === "number") return candidate.status;
  return undefined;
}

function levelByHttpStatus(status: number | undefined): Sentry.SeverityLevel {
  if (status === undefined) return "warning";
  if (status >= 500) return "error";
  if (status >= 400) return "warning";
  return "warning";
}

function classifySeverity(error: unknown): Sentry.SeverityLevel {
  const classified = classifyEdgeFunctionError(error);
  if (classified.type !== "unknown") {
    return LEVEL_BY_ERROR_TYPE[classified.type];
  }
  return levelByHttpStatus(readStatus(error));
}

function buildTags(
  source: SentrySource,
  error: unknown,
  ctx: CaptureContext
): Record<string, string> {
  const tags: Record<string, string> = { source };
  const classified = classifyEdgeFunctionError(error);
  tags.errorType = classified.type;
  const status = readStatus(error);
  if (status !== undefined) tags.httpStatus = String(status);
  if (ctx.attemptCount !== undefined) {
    tags.attemptCount = String(ctx.attemptCount);
  }
  if (ctx.queryKey) {
    tags.queryKey = JSON.stringify(ctx.queryKey);
  }
  if (ctx.mutationKey) {
    tags.mutationKey = JSON.stringify(ctx.mutationKey);
  }
  return tags;
}

function buildExtras(
  error: unknown,
  ctx: CaptureContext
): Record<string, unknown> {
  const extras: Record<string, unknown> = {};
  if (ctx.attemptCount !== undefined) extras.attemptCount = ctx.attemptCount;
  if (ctx.queryKey) extras.queryKey = ctx.queryKey;
  if (ctx.mutationKey) extras.mutationKey = ctx.mutationKey;
  if (error instanceof Error) {
    extras.errorName = error.name;
  }
  return extras;
}

function buildFingerprint(error: unknown, ctx: CaptureContext): string[] {
  if (ctx.fingerprint) return ctx.fingerprint;
  const classified = classifyEdgeFunctionError(error);
  if (classified.type !== "unknown") {
    return [classified.type, ctx.source];
  }
  const name = error instanceof Error ? error.name : "UnknownError";
  return [ctx.source, name];
}

function logToConsole(
  level: Sentry.SeverityLevel,
  error: unknown,
  tags: Record<string, string>,
  extras: Record<string, unknown>
): void {
  const tagString = Object.entries(tags)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  const label = `[sentry:${level}] ${tagString}`;
  if (level === "error") {
    console.error(label, error, extras);
  } else if (level === "warning") {
    console.warn(label, error, extras);
  } else if (level === "info") {
    console.info(label, error, extras);
  } else {
    console.debug(label, error, extras);
  }
}

export function captureError(error: unknown, context: CaptureContext): void {
  const level = classifySeverity(error);
  const tags = buildTags(context.source, error, context);
  const extras = buildExtras(error, context);
  const fingerprint = buildFingerprint(error, context);

  if (process.env.NODE_ENV !== "production") {
    logToConsole(level, error, tags, extras);
    return;
  }

  Sentry.withScope(scope => {
    scope.setLevel(level);
    scope.setTags(tags);
    scope.setExtras(extras);
    scope.setFingerprint(fingerprint);
    Sentry.captureException(error);
  });
}
