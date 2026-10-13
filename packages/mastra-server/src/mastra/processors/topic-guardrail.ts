import type { Processor, ProcessInputArgs } from "@mastra/core/processors";
import type { MastraDBMessage } from "@mastra/core/memory";
import { generateText } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

const BLOCK_THRESHOLD = 0.85;
const MAX_REASON_LENGTH = 200;

const FALLBACK_REJECTION =
  "Solo puedo ayudarte con tus finanzas y transacciones en Receiptle. / I can only help you with your finances and transactions in Receiptle.";

const SYSTEM_PROMPT = `You are a strict topic classifier for "Receiptle", a personal finance assistant.

DOMAIN (the assistant only answers these):
- Personal finance: transactions, purchases, expenses, income, subscriptions, recurring charges, bills, budgets, saving, financial planning
- Usage of the Receiptle app itself (how to do X in the app)
- General small-talk about money or the user's finances

OFF-TOPIC (must be blocked):
- Code/programming requests (any language: JavaScript, Python, etc.)
- General knowledge (history, politics, geography, science, sports, entertainment)
- Anything unrelated to personal finance or Receiptle

INPUT FORMAT:
You receive "Recent conversation" (up to 4 most recent user/assistant messages) followed by "User's latest message".
The user's latest message may be in Spanish or English. Use the recent conversation to resolve follow-up references.

FOLLOW-UP RESOLUTION (important):
Short follow-up messages must be interpreted in the context of the conversation:
- "Por que?" / "Why?" / "Y?" / "And?" / "Como?" / "How?" → almost always ON-TOPIC if there's prior financial context. They are continuations, not new topics.
- "gracias" / "thanks" / "ok" / "dale" → ON-TOPIC.
- "que podes hacer?" / "what can you do?" → ON-TOPIC (asking about app capabilities).

CONFIDENCE:
- High confidence (>0.85): the latest message is unambiguously off-topic on its own, regardless of context.
- Low confidence (<0.85): ambiguous, follow-up, or could plausibly be on-topic. When in doubt, lean permissive (isOffTopic=false).

REASON FIELD:
"reason" is the actual short message the user will see as the rejection. Requirements:
- Maximum 1-2 short sentences, ≤200 chars.
- Written in the SAME language the user used (Spanish if user wrote in Spanish, English if in English).
- Polite tone, not robotic, not jailbreak-style.
- Briefly state that the assistant can only help with personal finance and the Receiptle app (transactions, subscriptions, spending, budgets, etc.).
- Example (Spanish): "Solo puedo ayudarte con tus finanzas y transacciones en Receiptle."
- Example (English): "I can only help you with your finances and transactions in Receiptle."

Respond ONLY with a JSON object:
{
  "isOffTopic": boolean,
  "confidence": number between 0 and 1,
  "reason": string (the short, polite rejection message in the user's language)
}`;

function stripCodeFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
}

function getTextFromMessage(msg: MastraDBMessage): string {
  const parts = msg.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .filter(p => p?.type === "text")
    .map(p => (p as { text?: string }).text ?? "")
    .join("\n")
    .trim();
}

export class TopicGuardrailProcessor implements Processor {
  readonly id = "topic-guardrail";
  private model;

  constructor() {
    const openrouter = createOpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY ?? "",
    });
    const modelName =
      process.env.OPENROUTER_GUARDRAIL_MODEL ?? "deepseek/deepseek-v4.1-flash";
    this.model = openrouter(modelName);
  }

  async processInput({
    messages,
    abort,
  }: ProcessInputArgs): Promise<MastraDBMessage[]> {
    let shouldAbort = false;
    let abortReason = "";
    const latestUserMsg = messages.filter(m => m.role === "user").at(-1);

    try {
      if (!latestUserMsg) {
        return messages;
      }

      const userText = getTextFromMessage(latestUserMsg);
      if (!userText.trim()) {
        return messages;
      }

      const recentContext = messages
        .filter(m => m.role === "user" || m.role === "assistant")
        .slice(-4)
        .map(m => `${m.role.toUpperCase()}: ${getTextFromMessage(m)}`)
        .join("\n");

      const prompt = recentContext
        ? `Recent conversation:\n${recentContext}\n\nUser's latest message: ${userText}`
        : `User's latest message: ${userText}`;

      const { text: responseText } = await generateText({
        model: this.model,
        system: SYSTEM_PROMPT,
        prompt,
        temperature: 0,
      });

      let parsed: {
        isOffTopic?: boolean;
        confidence?: number;
        reason?: string;
      };
      try {
        parsed = JSON.parse(stripCodeFences(responseText));
      } catch {
        return messages;
      }

      const isOffTopic = parsed.isOffTopic === true;
      const confidence =
        typeof parsed.confidence === "number"
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0;

      if (isOffTopic && confidence >= BLOCK_THRESHOLD) {
        shouldAbort = true;
        abortReason = parsed.reason ?? "";
      }
    } catch {
      // Fail-open: if anything goes wrong, let the main agent handle it.
    }

    if (shouldAbort) {
      // Use the classifier's reason directly if it's a valid short message;
      // otherwise fall back to the bilingual default so the user always sees
      // a clear explanation regardless of LLM verbosity.
      const trimmedReason = abortReason.trim();
      const rejectionMessage =
        trimmedReason.length > 0 && trimmedReason.length <= MAX_REASON_LENGTH
          ? trimmedReason
          : FALLBACK_REJECTION;

      // abort() throws a TripWire error that ends processing. The reason is
      // emitted as a `tripwire` chunk in the stream, which the @mastra/ai-sdk
      // adapter converts to a `data-tripwire` part on the client.
      abort(rejectionMessage, {
        metadata: {
          reason: abortReason,
          processorId: "topic-guardrail",
        },
      });
    }

    return messages;
  }
}
