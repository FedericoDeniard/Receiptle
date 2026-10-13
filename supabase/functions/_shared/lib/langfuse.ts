import { LangfuseSpanProcessor } from "npm:@langfuse/otel@^5.13.1";
import {
  propagateAttributes,
  startActiveObservation,
  startObservation,
} from "npm:@langfuse/tracing@^5.13.1";
import { NodeSDK } from "npm:@opentelemetry/sdk-node@^0.223.0";

let processor: LangfuseSpanProcessor | null = null;
let sdk: NodeSDK | null = null;
let envLogged = false;

function logLangfuseEnvOnce() {
  if (envLogged) return;
  envLogged = true;

  try {
    const hasSecret = Boolean(process.env.LANGFUSE_SECRET_KEY);
    const hasPublic = Boolean(process.env.LANGFUSE_PUBLIC_KEY);
    const baseUrl = process.env.LANGFUSE_BASE_URL ?? "missing";

    console.log("[Langfuse]", {
      secretKey: hasSecret ? "✓" : "✗",
      publicKey: hasPublic ? "✓" : "✗",
      baseUrl,
    });
  } catch (error) {
    console.error("[Langfuse] Unable to read environment variables", error);
  }
}

function getProcessor(): LangfuseSpanProcessor {
  if (!processor) {
    const baseUrl = (
      process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com"
    ).replace(/\/+$/, "");

    processor = new LangfuseSpanProcessor({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY ?? "",
      secretKey: process.env.LANGFUSE_SECRET_KEY ?? "",
      baseUrl,
      flushAt: 15,
      // v5 takes seconds; v3's flushInterval was milliseconds (3000 ms).
      flushInterval: 3,
    });

    sdk = new NodeSDK({ spanProcessors: [processor] });
    sdk.start();
    logLangfuseEnvOnce();
  }
  return processor;
}

// For trace-level input, omit the messages array to keep it concise (just metadata).
function buildTraceInput(input: unknown): string | undefined {
  if (!input) return undefined;
  if (typeof input !== "object") return String(input);

  const { messages: _messages, ...meta } = input as { messages?: unknown };
  const hasMeta = Object.keys(meta).length > 0;
  return hasMeta ? JSON.stringify(meta) : JSON.stringify(input);
}

// If input has a messages array, pass it directly so Langfuse renders the
// chat view with system/user roles. Otherwise fall back to a plain string.
function buildGenerationInput(input: unknown): unknown {
  const messages = (input as { messages?: unknown } | undefined)?.messages;
  if (messages) return messages;
  if (!input) return undefined;
  return typeof input === "object" ? JSON.stringify(input) : String(input);
}

function buildUsageDetails(
  result: unknown
): { input: number; output: number; total: number } | undefined {
  if (!result || typeof result !== "object" || !("usage" in result)) {
    return undefined;
  }

  const usage = (result as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return undefined;

  const tokens = usage as {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  const inputTokens = tokens.inputTokens || 0;
  const outputTokens = tokens.outputTokens || 0;

  return {
    input: inputTokens,
    output: outputTokens,
    total: tokens.totalTokens || inputTokens + outputTokens,
  };
}

type EdgeRuntimeLike = {
  waitUntil?: (promise: Promise<unknown>) => void;
};

function getEdgeRuntime(): EdgeRuntimeLike | undefined {
  return (globalThis as { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime;
}

// Enhanced trace wrapper with generation tracking for token/cost
export async function traceOperation<T>(
  operationName: string,
  operation: () => Promise<T>,
  input?: unknown
): Promise<T> {
  getProcessor();
  const operationStartTime = new Date();

  const traceInput = buildTraceInput(input);
  const generationInput = buildGenerationInput(input);

  return await propagateAttributes({ traceName: operationName }, () =>
    startActiveObservation(operationName, async root => {
      root.update({ input: traceInput });

      try {
        const result = await operation();
        const serializedOutput =
          typeof result === "object" ? JSON.stringify(result) : String(result);
        const usageDetails = buildUsageDetails(result);

        const generation = startObservation(
          "ai-completion",
          {
            model: process.env.XAI_MODEL ?? "grok-4.6",
            input: generationInput,
            output: serializedOutput,
            ...(usageDetails ? { usageDetails } : {}),
          },
          { asType: "generation", startTime: operationStartTime }
        );
        generation.end();

        // Always persist output, even when usage is missing/null.
        root.update({ output: serializedOutput });

        if (usageDetails) {
          console.log("[Langfuse] Generation with usage tracked", {
            inputTokens: usageDetails.input,
            outputTokens: usageDetails.output,
            totalTokens: usageDetails.total,
          });
        }

        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        root.update({
          output: `Error: ${message}`,
          level: "ERROR",
          statusMessage: message,
        });
        throw error;
      }
    })
  );
}

// Optimized flush for serverless using EdgeRuntime.waitUntil
export async function flushLangfuse(): Promise<void> {
  const current = processor;
  if (!current) return;

  const flush = () => current.forceFlush();

  try {
    // Use EdgeRuntime.waitUntil for non-blocking async sending
    const edgeRuntime = getEdgeRuntime();
    if (edgeRuntime?.waitUntil) {
      edgeRuntime.waitUntil(
        flush().catch((error: unknown) =>
          console.error("[Langfuse] Flush error", error)
        )
      );
      console.log("[Langfuse] Flush scheduled with EdgeRuntime.waitUntil");
    } else {
      // Fallback for long-running processes
      await flush();
      console.log("[Langfuse] Flush completed (fallback)");
    }
  } catch (error) {
    console.error("[Langfuse] Flush error", error);
  }
}
