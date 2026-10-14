import { z } from "npm:zod";
import { GUARDRAIL_SYSTEM_PROMPT } from "../prompts/guardrail-system.ts";
import { buildGuardrailUserPrompt } from "./guardrail-input.ts";
import type { ImageAttachment } from "../lib/attachment-extractor.ts";
import {
  shouldProcessImageEmailWithDecisions,
  shouldProcessTextEmailWithDecisions,
  type DecisionsTextProvider,
} from "./decisions-guardrail.ts";

export const GuardrailResponseSchema = z.object({
  shouldProcess: z
    .boolean()
    .describe(
      "Set to true only when the email confirms a completed financial transaction (money already moved: paid, charged, debited, credited, transferred, received, posted, completed, successful)."
    ),
  reason: z
    .string()
    .describe(
      "Brief explanation of why this email should or should not be processed."
    ),
});

export type GuardrailResponse = z.infer<typeof GuardrailResponseSchema>;

const GUARDRAIL_MODEL = "google/gemini-2.5-flash-lite";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export async function shouldProcessEmail(
  emailContent: string,
  hasAttachments = false
): Promise<GuardrailResponse> {
  if (hasAttachments) {
    console.log(
      "[guardrail] Allowed: email has attachments, cannot pre-filter"
    );
    return {
      shouldProcess: true,
      reason: "Email has attachments, skipping text-only guardrail",
    };
  }

  const apiKey = process.env.OPENROUTER_API_KEY || "";
  if (!apiKey) {
    console.warn("[guardrail] Missing OPENROUTER_API_KEY, allowing through");
    return {
      shouldProcess: true,
      reason: "Guardrail disabled: missing API key",
    };
  }

  try {
    const body = JSON.stringify({
      model: GUARDRAIL_MODEL,
      temperature: 0,
      max_tokens: 50,
      messages: [
        {
          role: "system",
          content: GUARDRAIL_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: buildGuardrailUserPrompt(emailContent),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "guardrail_response",
          strict: true,
          schema: {
            type: "object",
            properties: {
              shouldProcess: {
                type: "boolean",
                description:
                  "True only when the email confirms a completed financial transaction (money already moved).",
              },
              reason: {
                type: "string",
                description:
                  "Brief explanation of why this email should or should not be processed.",
              },
            },
            required: ["shouldProcess", "reason"],
            additionalProperties: false,
          },
        },
      },
    });

    const headers = [
      { field: "Authorization", value: `Bearer ${apiKey}` },
      { field: "Content-Type", value: "application/json" },
      { field: "HTTP-Referer", value: "https://receiptle.com" },
      { field: "X-Title", value: "Receiptle" },
    ];

    // Call via PostgreSQL http extension, bypassing Deno's TLS fingerprinting.
    // Using direct fetch to REST API to avoid supabase client serialization issues.
    const supabaseUrl = process.env.SUPABASE_URL || "";
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

    const rpcResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/http_post`, {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_url: OPENROUTER_URL,
        p_body: body,
        p_headers: headers,
      }),
    });

    if (!rpcResponse.ok) {
      const rpcError = await rpcResponse.text();
      console.warn("[guardrail] RPC error:", rpcResponse.status, rpcError);
      return {
        shouldProcess: true,
        reason: `Guardrail RPC error (${rpcResponse.status}), defaulting to allow`,
      };
    }

    const raw = (await rpcResponse.json()) as {
      status: number;
      content: string;
    } | null;
    if (!raw || raw.status !== 200) {
      console.warn("[guardrail] OpenRouter returned non-200:", raw);
      return {
        shouldProcess: true,
        reason: `Guardrail API error (${raw?.status ?? "unknown"}), defaulting to allow`,
      };
    }

    // Parse OpenAI-style response (with response_format the content is always valid JSON)
    let responseJson: Record<string, unknown>;
    try {
      responseJson = JSON.parse(raw.content);
    } catch {
      console.warn("[guardrail] Could not parse OpenRouter response JSON");
      return {
        shouldProcess: true,
        reason: "Guardrail response parse error, defaulting to allow",
      };
    }

    // Log OpenRouter token usage
    const usage = responseJson.usage as
      | {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        }
      | undefined;
    console.log(
      "[guardrail] Tokens — prompt:",
      usage?.prompt_tokens ?? "?",
      "completion:",
      usage?.completion_tokens ?? "?",
      "total:",
      usage?.total_tokens ?? "?"
    );

    const contentText =
      (responseJson.choices as Array<{ message?: { content?: string } }>)?.[0]
        ?.message?.content || "";

    let parsed: GuardrailResponse;
    try {
      parsed = GuardrailResponseSchema.parse(JSON.parse(contentText));
    } catch {
      console.warn("[guardrail] Could not parse guardrail content JSON");
      return {
        shouldProcess: true,
        reason: "Guardrail content parse error, defaulting to allow",
      };
    }

    console.log("[guardrail] Decision:", parsed);
    return parsed;
  } catch (error) {
    console.error("[guardrail] Error during classification:", error);
    return {
      shouldProcess: true,
      reason: "Guardrail error, defaulting to allow processing",
    };
  }
}

// ---------------------------------------------------------------------------
// Provider dispatch
// ---------------------------------------------------------------------------
// Text-only emails always run the same cascade: JEV → Gemini → allow.
// JEV is the primary; only an *error* falls through to Gemini (a rejection is
// final). Gemini fails open on its own, so if it errors too the email goes to
// the Grok extraction — the degraded mode is "no guardrail", never a lost
// email. There is deliberately no env switch between Gemini and JEV: the
// cascade is the configuration.
// Emails with image attachments always run gpt-6-luna-decisions → allow →
// Grok (Gemini has no vision, so it is not part of that chain).
// EMAIL_IMAGE_GUARDRAIL_PROVIDER=none is a kill-switch that restores the
// historical auto-pass for image emails.
// Emails with file (PDF) attachments always skip the guardrail — unchanged.

export type EmailGuardrailProvider = "gemini" | DecisionsTextProvider;
export type EmailImageGuardrailProvider = "none" | "openai-decisions";

export interface EmailGuardrailInput {
  images?: ImageAttachment[];
  /** True when the email carries PDF/file attachments (guardrail skipped). */
  hasFileAttachments?: boolean;
}

export interface EmailGuardrailResult extends GuardrailResponse {
  provider: EmailGuardrailProvider | EmailImageGuardrailProvider;
  /** Set when the primary decisions guardrail errored and Gemini answered. */
  fallbackFrom?: EmailGuardrailProvider;
  model?: string;
  probability?: number | null;
  completedProbability?: number | null;
  latencyMs?: number;
  cost?: number | null;
}

export function resolveEmailImageGuardrailProvider(): EmailImageGuardrailProvider {
  const value = (process.env.EMAIL_IMAGE_GUARDRAIL_PROVIDER ?? "")
    .trim()
    .toLowerCase();
  return value === "none" ? "none" : "openai-decisions";
}

// Text cascade: JEV (primary) → Gemini (on error) → allow (Gemini fails open).
// A rejection by JEV is final; only transport/parsing errors fall through.
async function runTextGuardrailChain(
  emailContent: string
): Promise<EmailGuardrailResult> {
  const primary = await shouldProcessTextEmailWithDecisions(emailContent, {
    provider: "jev",
  });
  if (primary.error === undefined) {
    return primary;
  }

  console.warn(
    "[guardrail] jev decisions guardrail failed, falling back to gemini",
    { error: primary.error }
  );
  const fallback = await shouldProcessEmail(emailContent, false);
  return { ...fallback, provider: "gemini", fallbackFrom: "jev" };
}

export async function runEmailGuardrail(
  emailContent: string,
  input: EmailGuardrailInput = {}
): Promise<EmailGuardrailResult> {
  if (input.hasFileAttachments) {
    console.log(
      "[guardrail] Allowed: email has file attachments, cannot pre-filter"
    );
    return {
      shouldProcess: true,
      reason: "Email has file attachments, skipping guardrail",
      provider: "none",
    };
  }

  const images = input.images ?? [];
  if (images.length > 0) {
    const imageProvider = resolveEmailImageGuardrailProvider();
    if (imageProvider === "none") {
      console.log(
        "[guardrail] Allowed: email has image attachments, image guardrail disabled"
      );
      return {
        shouldProcess: true,
        reason: "Email has image attachments, skipping guardrail",
        provider: "none",
      };
    }
    return shouldProcessImageEmailWithDecisions(images);
  }

  return runTextGuardrailChain(emailContent);
}
