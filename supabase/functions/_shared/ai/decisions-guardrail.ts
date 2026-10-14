// Decisions-based email guardrail (text-only).
//
// JEV (typesafe/jev-*) and OpenAI's gpt-6-luna-decisions are decision models:
// instead of generating text they answer typed questions with probabilities.
// OpenRouter serves both through its Decisions API (alpha) and bills them to
// the same OpenRouter key, so no additional provider or API key is required.
//
// The request goes through the public.http_post RPC for the same reason as the
// Gemini guardrail: Deno's edge runtime TLS fingerprinting gets blocked by some
// providers when calling them directly from the function runtime.
//
// Images (verified 2026-10 against openai/gpt-6-luna-decisions): the endpoint
// accepts images inside `state` as chat-completions-style parts —
// `{ type: "image_url", image_url: { url: "data:image/jpeg;base64,..." } }` —
// with proper image token accounting (~1k tokens/image, ~$0.0001/call, stable
// verdicts across runs). Responses-style `input_image` parts are NOT converted:
// they are tokenized as text (usage scales with base64 length) and answers
// become unreliable — do not use that shape. JEV rejects image payloads
// (HTTP 400), so the image guardrail always runs on gpt-6-luna-decisions.
//
// Fail-open by design: any transport or parsing error allows the email through
// so the Grok extraction still runs. Mirrors the Gemini guardrail contract.
import type { GuardrailResponse } from "./guardrail.ts";
import type { ImageAttachment } from "../lib/attachment-extractor.ts";
import { prepareEmailForGuardrail } from "./guardrail-input.ts";

const DECISIONS_API_URL = "https://openrouter.ai/api/alpha/decisions";
const DEFAULT_DECISIONS_THRESHOLD = 0.5;
const MAX_GUARDRAIL_IMAGES = 3;
// Total image bytes cap: the payload travels as text through the http_post
// RPC, so keep it well under request-size limits. Larger emails fail open.
const MAX_IMAGE_GUARDRAIL_TOTAL_BYTES = 3 * 1024 * 1024;

export const DECISIONS_TEXT_MODELS = {
  jev: "typesafe/jev-1.13",
  "openai-decisions": "openai/gpt-6-luna-decisions",
} as const;

export type DecisionsTextProvider = keyof typeof DECISIONS_TEXT_MODELS;

export const DECISIONS_IMAGE_MODEL_DEFAULT = "openai/gpt-6-luna-decisions";

export interface DecisionsGuardrailResult extends GuardrailResponse {
  provider: DecisionsTextProvider;
  model: string;
  /** Probability that the email is transactional-ish (gates shouldProcess). */
  probability: number | null;
  /** Probability that a money movement already happened (observed, not gating). */
  completedProbability: number | null;
  latencyMs: number;
  cost: number | null;
  error?: string;
}

// Question design follows the same contrastive style already in production for
// the chat topic guardrail (mastra-server classifiers/topic.ts): literal
// question, explicit decision rule, examples on both sides of the boundary.
const TEXT_QUESTIONS = {
  isTransactional: {
    type: "noul",
    instructions: {
      question:
        "Does the email in `email` relate to a financial transaction or money movement?",
      inspect: "`email`",
      decision_rule:
        "Answer true when the email is related to payments, transfers, charges, debits, credits, invoices, receipts, bank statements, loans, insurance, investments, salary or purchases. Answer false for social notifications, newsletters, promotions, password resets, welcome emails, spam, or anything with zero financial context. When in doubt, answer true.",
    },
    criteria: {
      true: {
        what: "The email relates to money, payments, or a financial product",
        examples: [
          "Payment or transfer confirmation",
          "Card charge or debit alert",
          "Invoice or receipt",
          "Bank statement, loan or insurance notice",
          "Salary or investment notification",
        ],
      },
      false: {
        what: "The email has zero financial context",
        examples: [
          "Social media notification",
          "Marketing newsletter or promotion",
          "Password reset or account security email",
          "Welcome email or spam",
        ],
      },
    },
  },
  isCompletedTransaction: {
    type: "noul",
    instructions: {
      question:
        "Does the email in `email` confirm that a money movement has already happened?",
      inspect: "`email`",
      decision_rule:
        "Answer true only when the email confirms the money movement already happened (paid, charged, debited, credited, transferred, received, posted, completed, successful). Answer false for reminders, due-date notices, upcoming or scheduled payments, autopay notices, payment requests, invoices to pay, authorization holds, or failed and cancelled operations. If completion is unclear, answer false.",
    },
    criteria: {
      true: {
        what: "The email confirms a completed money movement",
        examples: [
          "Transfer sent confirmation",
          "Purchase approved and charged",
          "Payment received notification",
        ],
      },
      false: {
        what: "The money movement has not happened yet or is unclear",
        examples: [
          "Upcoming payment or due-date reminder",
          "Invoice to pay",
          "Authorization hold",
          "Failed or cancelled operation",
        ],
      },
    },
  },
} as const;

const IMAGE_QUESTIONS = {
  isTransactionImage: {
    type: "noul",
    instructions: {
      question:
        "Does the image attached to the email show a receipt, invoice, or payment confirmation?",
      inspect: "the attached image",
      decision_rule:
        "Answer true when the image is a receipt, invoice, payment confirmation, or any document that confirms a money movement. Answer false for promotional banners, marketing graphics, notifications, photos unrelated to a purchase, or any image with no financial or transactional content.",
    },
    criteria: {
      true: {
        what: "A document that confirms a purchase or money movement",
        examples: [
          "Paper or digital receipt",
          "Invoice",
          "Payment or transfer confirmation screenshot",
        ],
      },
      false: {
        what: "An image with no transactional content",
        examples: [
          "Promotional banner or marketing graphic",
          "App notification or UI mockup",
          "Photo unrelated to a purchase",
        ],
      },
    },
  },
} as const;

interface DecisionsApiAnswer {
  type?: string;
  noul?: number;
}

interface DecisionsApiResponse {
  id?: string;
  model?: string;
  provider?: string;
  answers?: Record<string, DecisionsApiAnswer>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cost?: number;
  };
}

type DecisionsCallResult =
  | { ok: true; data: DecisionsApiResponse }
  | { ok: false; status?: number; error: string };

function resolveDecisionsThreshold(): number {
  const raw = process.env.EMAIL_GUARDRAIL_THRESHOLD;
  if (!raw) return DEFAULT_DECISIONS_THRESHOLD;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : DEFAULT_DECISIONS_THRESHOLD;
}

function resolveImageDetail(): "low" | "high" | "auto" | undefined {
  const raw = (process.env.OPENROUTER_GUARDRAIL_IMAGE_DETAIL ?? "")
    .trim()
    .toLowerCase();
  if (raw === "low" || raw === "high" || raw === "auto") {
    return raw;
  }
  return undefined;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function callDecisionsApi(body: unknown): Promise<DecisionsCallResult> {
  const apiKey = process.env.OPENROUTER_API_KEY || "";
  if (!apiKey) {
    return { ok: false, error: "missing OPENROUTER_API_KEY" };
  }

  const supabaseUrl = process.env.SUPABASE_URL || "";
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!supabaseUrl || !supabaseKey) {
    return { ok: false, error: "missing Supabase RPC configuration" };
  }

  const headers = [
    { field: "Authorization", value: `Bearer ${apiKey}` },
    { field: "Content-Type", value: "application/json" },
    { field: "HTTP-Referer", value: "https://receiptle.com" },
    { field: "X-Title", value: "Receiptle" },
  ];

  let rpcResponse: Response;
  try {
    rpcResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/http_post`, {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_url: DECISIONS_API_URL,
        p_body: JSON.stringify(body),
        p_headers: headers,
      }),
    });
  } catch (error) {
    return {
      ok: false,
      error: `RPC fetch failed: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }

  if (!rpcResponse.ok) {
    return {
      ok: false,
      status: rpcResponse.status,
      error: `RPC HTTP ${rpcResponse.status}`,
    };
  }

  const raw = (await rpcResponse.json()) as {
    status?: number;
    content?: string;
  } | null;
  if (
    !raw ||
    typeof raw.status !== "number" ||
    typeof raw.content !== "string"
  ) {
    return { ok: false, error: "malformed RPC response" };
  }
  if (raw.status !== 200) {
    return {
      ok: false,
      status: raw.status,
      error: `Decisions API HTTP ${raw.status}: ${raw.content.slice(0, 300)}`,
    };
  }

  try {
    return { ok: true, data: JSON.parse(raw.content) as DecisionsApiResponse };
  } catch {
    return { ok: false, error: "could not parse Decisions API response JSON" };
  }
}

function failOpen(
  provider: DecisionsTextProvider,
  model: string,
  latencyMs: number,
  error: string
): DecisionsGuardrailResult {
  return {
    shouldProcess: true,
    reason: `Decisions guardrail error (${error}), defaulting to allow`,
    provider,
    model,
    probability: null,
    completedProbability: null,
    latencyMs,
    cost: null,
    error,
  };
}

/**
 * Replaces the Gemini text guardrail with a Decisions API call.
 *
 * `isTransactional` gates `shouldProcess` (same coarse semantics as the
 * current guardrail, "when in doubt allow"). `isCompletedTransaction` is
 * answered in the same call for observation only — it is not used to gate
 * yet, so the comparison harness can score it against ground truth first.
 */
export async function shouldProcessTextEmailWithDecisions(
  emailContent: string,
  options: {
    provider?: DecisionsTextProvider;
    model?: string;
    threshold?: number;
  } = {}
): Promise<DecisionsGuardrailResult> {
  const provider = options.provider ?? "jev";
  const model =
    options.model ??
    process.env.OPENROUTER_GUARDRAIL_TEXT_MODEL ??
    DECISIONS_TEXT_MODELS[provider];
  const threshold = options.threshold ?? resolveDecisionsThreshold();

  const startedAt = Date.now();
  const state = { email: prepareEmailForGuardrail(emailContent) };

  try {
    const call = await callDecisionsApi({
      model,
      state,
      questions: TEXT_QUESTIONS,
    });
    const latencyMs = Date.now() - startedAt;

    if (!call.ok) {
      console.warn("[guardrail:decisions] call failed, defaulting to allow", {
        model,
        error: call.error,
      });
      return failOpen(provider, model, latencyMs, call.error);
    }

    const transactional = call.data.answers?.isTransactional?.noul;
    if (typeof transactional !== "number") {
      console.warn(
        "[guardrail:decisions] missing isTransactional answer, defaulting to allow",
        { model, answers: call.data.answers }
      );
      return failOpen(
        provider,
        model,
        latencyMs,
        "missing isTransactional answer"
      );
    }

    const completed = call.data.answers?.isCompletedTransaction?.noul;
    const shouldProcess = transactional >= threshold;
    const completedText =
      typeof completed === "number"
        ? `, isCompletedTransaction=${completed.toFixed(2)}`
        : "";

    console.log(
      `[guardrail:decisions] ${model} — isTransactional=${transactional.toFixed(2)}${completedText} ` +
        `threshold=${threshold} → ${shouldProcess ? "allow" : "reject"} ` +
        `(${latencyMs}ms, cost=${call.data.usage?.cost ?? "?"})`
    );

    return {
      shouldProcess,
      reason: `Decisions ${model}: isTransactional=${transactional.toFixed(2)}${completedText} (threshold ${threshold})`,
      provider,
      model,
      probability: transactional,
      completedProbability: typeof completed === "number" ? completed : null,
      latencyMs,
      cost: call.data.usage?.cost ?? null,
    };
  } catch (error) {
    console.error(
      "[guardrail:decisions] unexpected error, defaulting to allow",
      error
    );
    return failOpen(
      provider,
      model,
      Date.now() - startedAt,
      error instanceof Error ? error.message : "unknown error"
    );
  }
}

export interface DecisionsImageGuardrailResult extends GuardrailResponse {
  provider: "openai-decisions";
  model: string;
  /** Probability that an attached image shows a transaction document. */
  probability: number | null;
  imageCount: number;
  latencyMs: number;
  cost: number | null;
  error?: string;
}

function imageFailOpen(
  model: string,
  latencyMs: number,
  error: string,
  imageCount: number
): DecisionsImageGuardrailResult {
  return {
    shouldProcess: true,
    reason: `Decisions image guardrail error (${error}), defaulting to allow`,
    provider: "openai-decisions",
    model,
    probability: null,
    imageCount,
    latencyMs,
    cost: null,
    error,
  };
}

/**
 * Image guardrail: decides whether an email carrying image attachments shows
 * a transaction document (receipt/invoice/confirmation) before paying for the
 * full Grok extraction. Images travel as chat-completions-style parts inside
 * `state` — the only shape the Decisions endpoint converts to real image
 * inputs today (see the module header). Fails open on any error or on
 * oversized payloads.
 */
export async function shouldProcessImageEmailWithDecisions(
  images: ImageAttachment[],
  options: { model?: string; threshold?: number } = {}
): Promise<DecisionsImageGuardrailResult> {
  const model =
    options.model ??
    process.env.OPENROUTER_GUARDRAIL_IMAGE_MODEL ??
    DECISIONS_IMAGE_MODEL_DEFAULT;
  const threshold = options.threshold ?? resolveDecisionsThreshold();
  const startedAt = Date.now();
  const capped = (images ?? []).slice(0, MAX_GUARDRAIL_IMAGES);

  if (capped.length === 0) {
    return imageFailOpen(model, 0, "no images to inspect", 0);
  }

  const totalBytes = capped.reduce((sum, image) => sum + image.data.length, 0);
  if (totalBytes > MAX_IMAGE_GUARDRAIL_TOTAL_BYTES) {
    console.warn(
      `[guardrail:decisions] image payload too large (${totalBytes} bytes), defaulting to allow`
    );
    return imageFailOpen(model, 0, "image payload too large", capped.length);
  }

  const detail = resolveImageDetail();
  const state = [
    {
      type: "text",
      text: "Image attachment(s) from the email. Inspect the attached image content.",
    },
    ...capped.map(image => ({
      type: "image_url",
      image_url: {
        url: `data:${image.mimeType};base64,${uint8ToBase64(image.data)}`,
        ...(detail ? { detail } : {}),
      },
    })),
  ];

  try {
    const call = await callDecisionsApi({
      model,
      state,
      questions: IMAGE_QUESTIONS,
    });
    const latencyMs = Date.now() - startedAt;

    if (!call.ok) {
      console.warn(
        "[guardrail:decisions] image call failed, defaulting to allow",
        { model, error: call.error }
      );
      return imageFailOpen(model, latencyMs, call.error, capped.length);
    }

    const probability = call.data.answers?.isTransactionImage?.noul;
    if (typeof probability !== "number") {
      console.warn(
        "[guardrail:decisions] missing isTransactionImage answer, defaulting to allow",
        { model, answers: call.data.answers }
      );
      return imageFailOpen(
        model,
        latencyMs,
        "missing isTransactionImage answer",
        capped.length
      );
    }

    const shouldProcess = probability >= threshold;
    console.log(
      `[guardrail:decisions:image] ${model} — isTransactionImage=${probability.toFixed(2)} ` +
        `images=${capped.length} threshold=${threshold} → ${shouldProcess ? "allow" : "reject"} ` +
        `(${latencyMs}ms, cost=${call.data.usage?.cost ?? "?"})`
    );

    return {
      shouldProcess,
      reason: `Decisions image ${model}: isTransactionImage=${probability.toFixed(2)} (threshold ${threshold})`,
      provider: "openai-decisions",
      model,
      probability,
      imageCount: capped.length,
      latencyMs,
      cost: call.data.usage?.cost ?? null,
    };
  } catch (error) {
    console.error(
      "[guardrail:decisions] unexpected image error, defaulting to allow",
      error
    );
    return imageFailOpen(
      model,
      Date.now() - startedAt,
      error instanceof Error ? error.message : "unknown error",
      capped.length
    );
  }
}
