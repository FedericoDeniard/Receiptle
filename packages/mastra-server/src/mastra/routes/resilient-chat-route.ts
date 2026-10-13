import type { Context } from "hono";
import { handleChatStream } from "@mastra/ai-sdk";
import { RequestContext } from "@mastra/core/request-context";
import { randomUUID } from "node:crypto";
import { requireCapability } from "../../lib/capabilities";
import { withSseHeartbeats } from "../../lib/sse-heartbeat";
import { mastra } from "../index";

/**
 * Replacement for the default `chatRoute` from `@mastra/ai-sdk` that
 * does NOT propagate the Hono request's abort signal to the agent.
 *
 * The default route does:
 *
 *   params: { ...params, abortSignal: c.req.raw.signal }
 *
 * which reaches the LLM call as `fetch(..., { signal })`. When the
 * client closes the tab the signal fires, the in-flight fetch to
 * OpenRouter is aborted, and the agent throws before persisting the
 * assistant message — so the user sees their prompt in the DB but
 * the AI's reply is gone.
 *
 * Our variant: run the agent end-to-end so the assistant message
 * gets saved to `mastra_messages` regardless of client state. The
 * response stream is still wired to the HTTP response so a live
 * client keeps getting chunks in real time; a disconnected client
 * just stops receiving them while the LLM keeps working in the
 * background. When the user reopens the thread the response is
 * already in the DB.
 *
 * We can't reuse `createUIMessageStreamResponse` from `@mastra/ai-sdk`
 * because it's not exported, so we replicate its transform pipeline
 * (JSON chunk -> SSE `data: ...\n\n` + terminal `data: [DONE]\n\n`)
 * inline below.
 */
class JsonToSseTransformStream extends TransformStream<unknown, string> {
  constructor() {
    super({
      transform(part, controller) {
        controller.enqueue(`data: ${JSON.stringify(part)}\n\n`);
      },
      flush(controller) {
        controller.enqueue(`data: [DONE]\n\n`);
      },
    });
  }
}

const UI_MESSAGE_STREAM_HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache, no-transform",
  "x-accel-buffering": "no",
} as const;

interface PendingToolApprovalPart {
  toolCallId?: unknown;
  state?: unknown;
  approval?: { approved?: boolean; reason?: string };
}

interface UIMessageLike {
  id?: string;
  role?: string;
  parts?: unknown[];
}

function isStaleApprovalResumeError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const id = (err as { id?: unknown }).id;
  if (
    id === "AGENT_RESUME_NO_SNAPSHOT_FOUND" ||
    id === "AGENT_RESUME_TOOL_CALL_NOT_SUSPENDED"
  ) {
    return true;
  }
  const message = (err as { message?: unknown }).message;
  return (
    typeof message === "string" &&
    (message.includes("could not find a suspended run") ||
      (message.includes("cannot resume tool call") &&
        message.includes("because it is not suspended")))
  );
}

/**
 * Builds a synthetic UI message stream that mirrors what
 * `handleChatStream` would have emitted if the agent had run:
 *  - a `start` part carrying the existing assistant messageId so
 *    the AI SDK reducer treats the parts as an in-place update of
 *    the message that already has the tool in
 *    `approval-responded` state;
 *  - a `tool-output-denied` part for every tool the user denied;
 *  - a `tool-output-error` part for every tool the user approved
 *    (the agent can't run, so we surface an error rather than
 *    silently no-op);
 *  - a `finish` terminator.
 *
 * The stream emits plain part objects, exactly like the real
 * one, so the existing `JsonToSseTransformStream` pipes it
 * through unchanged.
 */
function synthesizeApprovalOutcomeStream(
  params: { messages?: UIMessageLike[] } | undefined
): ReadableStream<unknown> {
  const messages = Array.isArray(params?.messages) ? params.messages : [];
  const lastAssistant = [...messages]
    .reverse()
    .find(m => m && m.role === "assistant");
  const lastMessageId =
    lastAssistant && typeof lastAssistant.id === "string"
      ? lastAssistant.id
      : undefined;

  const parts: unknown[] = [
    { type: "start", ...(lastMessageId ? { messageId: lastMessageId } : {}) },
  ];

  if (lastAssistant && Array.isArray(lastAssistant.parts)) {
    for (const rawPart of lastAssistant.parts) {
      const part = rawPart as PendingToolApprovalPart;
      if (part?.state !== "approval-responded") continue;
      if (typeof part.toolCallId !== "string") continue;
      if (part.approval?.approved === true) {
        parts.push({
          type: "tool-output-error",
          toolCallId: part.toolCallId,
          errorText:
            "The agent's run expired before this action was approved. Please try again.",
        });
      } else {
        parts.push({
          type: "tool-output-denied",
          toolCallId: part.toolCallId,
        });
      }
    }
  }

  parts.push({ type: "finish" });

  let index = 0;
  return new ReadableStream<unknown>({
    pull(controller) {
      if (index < parts.length) {
        controller.enqueue(parts[index++]);
      } else {
        controller.close();
      }
    },
  });
}

export const chatHandler = async (c: Context) => {
  const userId = c.get("userId");
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Capability gate. We check `ai_assistant` before opening the SSE
  // stream because once a stream starts the client has already begun
  // reading chunks and we can't change the HTTP status code. Reject
  // here with a plain-text body so the AI SDK useChat hook sees a
  // non-streaming error and sets `error.message` to our literal
  // string — the frontend's `getEdgeFunctionErrorMessage` classifier
  // pattern-matches the `Requires capability:` prefix and substitutes
  // the localized "premium feature" toast.
  const supabaseToken = c.get("supabaseToken");
  if (!supabaseToken) {
    return c.text("Missing supabase token", 401);
  }
  const userRole = c.get("userRole") ?? "user";
  const cap = await requireCapability(
    { userId, supabaseToken, role: userRole },
    "ai_assistant"
  );
  if (!cap.allowed) {
    return c.text("Requires capability: ai_assistant", 403);
  }

  // Usage cap. admin bypasses the cap entirely (effectively
  // unlimited); everyone else — including tester — is counted
  // against the per-period budget in payments.usage_limits. We
  // check-and-increment in the same pre-stream window as the
  // capability gate so a 429 reaches the client before any LLM
  // tokens are spent. The body matches the prefix the frontend
  // classifier matches on to surface the "usage limit" toast.
  if (userRole !== "admin") {
    const { supabaseFromToken } = await import("../../lib/supabase-from-token");
    const supabase = supabaseFromToken(supabaseToken);
    const { data: usage, error: usageError } = await supabase
      .schema("payments")
      .rpc("check_and_increment_usage", {
        target_user_id: userId,
        cap: "ai_assistant",
      });
    if (usageError) {
      // fail-open: a counter bug should not break the app for paying
      // users. log so we notice in observability.
      console.error(
        "[chatHandler] usage check failed; failing open",
        usageError
      );
    } else if (!usage?.[0]?.allowed) {
      return c.text("Usage limit exceeded: ai_assistant", 429);
    }
  }

  const params = await c.req.json();

  // Build the Mastra RequestContext from the Hono variables populated
  // by `authMiddleware`. Tools declare their expected keys via
  // `requestContextSchema` and read them via `ctx.requestContext.get(...)`
  // or `ctx.requestContext!.all.<key>`. Today the keys we propagate are:
  //   - userId / supabaseToken (consumed by every data tool)
  //   - userTimezone (consumed by get-current-date)
  //   - userRole (consumed by tools that branch on tier / staff status)
  // A client-supplied `requestContext` in the body is merged on top so
  // callers can still override individual keys when they need to (used
  // by tests; production paths leave it empty).
  const serverRequestContext = new RequestContext();
  const userTimezone = c.get("userTimezone");
  if (supabaseToken) serverRequestContext.set("supabaseToken", supabaseToken);
  if (userTimezone) serverRequestContext.set("userTimezone", userTimezone);
  serverRequestContext.set("userRole", userRole);
  serverRequestContext.set("userId", userId);

  const clientRequestContext =
    (params.requestContext as Record<string, unknown> | undefined) ?? undefined;
  if (clientRequestContext) {
    for (const [key, value] of Object.entries(clientRequestContext)) {
      serverRequestContext.set(key, value);
    }
  }

  const agentId = c.req.param("agentId");
  if (!agentId) {
    return c.json({ error: "Agent ID is required" }, 400);
  }

  const queryVersionId = c.req.query("versionId");
  const rawStatus = c.req.query("status");
  if (queryVersionId && rawStatus) {
    return c.json(
      {
        error:
          'Query parameters "versionId" and "status" are mutually exclusive',
      },
      400
    );
  }
  if (rawStatus && rawStatus !== "draft" && rawStatus !== "published") {
    return c.json(
      { error: 'Query parameter "status" must be "draft" or "published"' },
      400
    );
  }

  const effectiveAgentVersion = queryVersionId
    ? { versionId: queryVersionId }
    : rawStatus
      ? { status: rawStatus as "draft" | "published" }
      : undefined;

  const uiMessageStream = await handleChatStream({
    mastra,
    agentId,
    agentVersion: effectiveAgentVersion,
    params: {
      ...params,
      requestContext: serverRequestContext,
    },
    version: "v6",
    sendStart: true,
    sendFinish: true,
    sendReasoning: false,
    sendSources: false,
  }).catch((err: unknown) => {
    if (isStaleApprovalResumeError(err)) {
      console.warn(
        "[chatHandler] stale agent approval; synthesizing approval outcome stream"
      );
      return synthesizeApprovalOutcomeStream(params);
    }
    throw err;
  });

  const sseStream = withSseHeartbeats(
    (uiMessageStream as ReadableStream<unknown>).pipeThrough(
      new JsonToSseTransformStream()
    )
  );

  return new Response(sseStream.pipeThrough(new TextEncoderStream()), {
    headers: { ...UI_MESSAGE_STREAM_HEADERS },
  });
};
