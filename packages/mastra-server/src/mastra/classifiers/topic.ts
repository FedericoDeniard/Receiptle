import { Classifier } from "@mastra/core/classifier";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

// JEV (typesafe/jev-*) is a decision model, not a chat model: it answers
// typed questions with probabilities instead of generating text. OpenRouter
// serves it through its Decisions API, billed to the same OpenRouter key, so
// no additional provider or API key is required. The provider factory stays
// `evaluationModel()` (the legacy alias of `decisionModel()`); Mastra wraps it
// in a MastraDecisionModel that falls back to `doEvaluate()`.
//
// Question design follows TypeSafe's "How to build with System One" guide:
// atomic, literal question; structured criteria with the same field names on
// both sides (`what` / `not_for` / `examples`) so the boundary is contrastive;
// examples on both sides of the decision boundary; backticked state paths.
const JEV_MODEL = process.env.OPENROUTER_TOPIC_MODEL ?? "typesafe/jev-1.13";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY ?? "",
});

export const topicClassifier = new Classifier({
  id: "topic-guardrail",
  model: openrouter.evaluationModel(JEV_MODEL),
  questions: {
    outOfScopeRequest: {
      type: "boolean",
      instructions: {
        question:
          "Does the message in `latestMessage` ask or tell the assistant to perform a task outside the assistant's scope?",
        inspect: "`latestMessage`",
        context:
          "Use `recentConversation` only to interpret `latestMessage` when it is short or refers back to something earlier.",
        scope: [
          "The user's personal finance: transactions, purchases, expenses, income, subscriptions, recurring charges, bills, budgets, saving, financial planning",
          "Conversation about the user's money or finances",
          "The Receiptle app: how to use it, its features, its settings, exports",
        ],
        always_in_scope: [
          'Greetings, pleasantries, acknowledgements and casual remarks: "hola", "buenas", "hey", "hi", "hello", "que tal?", "hola, como estas?", "gracias", "thanks", "ok", "dale", "jajaja"',
          'Short follow-ups and continuations: "por que?", "why?", "y?", "and?", "como?", "how?" — these refer to `recentConversation`',
          "Questions about what the assistant can do or how to use Receiptle",
          'Money questions in general, including ones the assistant cannot answer with live data, for example "como esta el dolar hoy?"',
          "Incomplete, vague, ambiguous or typo-heavy messages",
          'A message that merely mentions a non-financial topic without asking the assistant to act on it, for example "me gusta el futbol"',
        ],
        out_of_scope_requests: [
          "Generate, write, fix, explain or review code or scripts in any language",
          "Search for or report news, current events, or anything happening in the world",
          "Answer general knowledge: history, politics, geography, science, sports, entertainment, trivia",
          "Do unrelated work: recipes, travel plans, homework, translations, summaries, emails, posts, essays, creative writing (poems, stories, jokes), roleplay",
          "Recommend movies, books, music or other entertainment",
          "Give advice or help outside personal finance",
        ],
        decision_rule:
          "Answer true only when `latestMessage` is a clear request for something outside the scope above. If `latestMessage` could plausibly be answered with the user's finances, the user's money, or the Receiptle app in mind, or it is vague or ambiguous, answer false.",
      },
      criteria: {
        true: {
          what: "A clear request or instruction for a task outside the assistant's scope",
          not_for:
            "Greetings, acknowledgements, casual remarks, follow-ups, vague or ambiguous messages, and in-scope finance or app requests",
          examples: [
            "Write me a Python script to rename files",
            "buscame las noticias de hoy",
            "Who won the 2026 World Cup?",
            "pasame una receta de milanesas",
          ],
        },
        false: {
          what: "In scope: about the user's finances, money or the Receiptle app; or a greeting, acknowledgement, casual remark, follow-up or vague message",
          not_for: "Clear requests for tasks outside the assistant's scope",
          examples: [
            "hola, como estas?",
            "gracias!",
            "cuanto gaste este mes?",
            "how do I export my transactions?",
            "por que?",
            "me gusta el futbol",
          ],
        },
      },
    },
    language: {
      type: "choice",
      instructions:
        "Which language is the message in `latestMessage` written in? Use `recentConversation` only when `latestMessage` is too short to tell.",
      criteria: {
        es: "Spanish (or predominantly Spanish)",
        en: "English (or predominantly English)",
      },
    },
  },
});
