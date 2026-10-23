// @ts-nocheck
import { z } from "zod";
import { stripHtml } from "string-strip-html";
import { GUARDRAIL_SYSTEM_PROMPT } from "./prompts/guardrail-system";
import { getSecretKey, isLegacyJwtKey } from "../supabase-keys";

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

function prepareEmailContent(emailContent: string): string {
  // Step 1: Remove <style> blocks (tag + content)
  let cleaned = emailContent.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ");
  // Step 2: Remove <script> blocks (tag + content)
  cleaned = cleaned.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ");
  // Step 3: Remove loose CSS rules (selector { ... }) and @media blocks
  cleaned = cleaned.replace(/@media[^{]*\{[\s\S]*?\}\s*\}/gi, " ");
  cleaned = cleaned.replace(/[^{}\n]+\{[^{}]*\}/g, " ");
  // Step 4: Strip remaining HTML tags
  cleaned = stripHtml(cleaned).result;
  // Step 5: Collapse whitespace
  return cleaned.replace(/\s+/g, " ").trim();
}

function buildGuardrailUserPrompt(emailContent: string): string {
  const prepared = prepareEmailContent(emailContent).slice(0, 1500);
  return `Email content (first 1500 chars of cleaned text):
${prepared}`;
}

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
    const supabaseKey = getSecretKey();

    if (!supabaseUrl || !supabaseKey) {
      return {
        shouldProcess: true,
        reason: "Missing Supabase guardrail configuration, defaulting to allow",
      };
    }

    const rpcResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/http_post`, {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        ...(isLegacyJwtKey(supabaseKey)
          ? { Authorization: `Bearer ${supabaseKey}` }
          : {}),
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
