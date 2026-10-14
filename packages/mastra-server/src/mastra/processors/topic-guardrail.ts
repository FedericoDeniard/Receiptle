import type { Processor, ProcessInputArgs } from "@mastra/core/processors";
import type { MastraDBMessage } from "@mastra/core/memory";
import { topicClassifier } from "../classifiers/topic";

const BLOCK_THRESHOLD = 0.85;

// JEV never returns generated text, so the rejection message is a fixed
// template picked by the classifier's language answer. The bilingual
// fallback (used when anything goes wrong before a language is known) says
// the same thing in both supported languages.
const REJECTION_MESSAGES = {
  es: "Solo puedo ayudarte con tus finanzas y transacciones en Receiptle.",
  en: "I can only help you with your finances and transactions in Receiptle.",
};

const FALLBACK_REJECTION =
  "Solo puedo ayudarte con tus finanzas y transacciones en Receiptle. / I can only help you with your finances and transactions in Receiptle.";

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

  async processInput({
    messages,
    abort,
  }: ProcessInputArgs): Promise<MastraDBMessage[]> {
    let shouldAbort = false;
    let rejectionMessage: string = FALLBACK_REJECTION;
    let probability = 0;

    try {
      const latestUserMsg = messages.filter(m => m.role === "user").at(-1);
      if (!latestUserMsg) {
        return messages;
      }

      const userText = getTextFromMessage(latestUserMsg);
      if (!userText.trim()) {
        return messages;
      }

      const recentConversation = messages
        .filter(
          m =>
            (m.role === "user" || m.role === "assistant") && m !== latestUserMsg
        )
        .slice(-4)
        .map(m => ({ role: m.role, text: getTextFromMessage(m) }))
        .filter(entry => entry.text.length > 0);

      // Both questions are decided against the same state in one JEV call.
      const { answers } = await topicClassifier.decide({
        state: {
          recentConversation,
          latestMessage: userText,
        },
      });

      probability = answers.outOfScopeRequest.probability;
      if (probability >= BLOCK_THRESHOLD) {
        shouldAbort = true;
        rejectionMessage =
          REJECTION_MESSAGES[answers.language.choice] ?? FALLBACK_REJECTION;
      }
    } catch {
      // Fail-open: if the classifier call fails, let the main agent handle it.
    }

    if (shouldAbort) {
      // abort() throws a TripWire error that ends processing. The reason is
      // emitted as a `tripwire` chunk in the stream, which the @mastra/ai-sdk
      // adapter converts to a `data-tripwire` part on the client.
      abort(rejectionMessage, {
        metadata: {
          processorId: "topic-guardrail",
          probability,
          threshold: BLOCK_THRESHOLD,
        },
      });
    }

    return messages;
  }
}
