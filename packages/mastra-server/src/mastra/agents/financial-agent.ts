import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  FINANCIAL_AGENT_INSTRUCTIONS,
  THREAD_TITLE_INSTRUCTIONS,
} from "./prompts";
import { TopicGuardrailProcessor } from "../processors/topic-guardrail";
import { listTransactionsTool } from "../tools/list-transactions";
import { listSubscriptionsTool } from "../tools/list-subscriptions";
import { calculateTool } from "../tools/calculate";
import { createTransactionTool } from "../tools/create-transaction";
import { getSpendingSummaryTool } from "../tools/get-spending-summary";
import { updateTransactionTool } from "../tools/update-transaction";
import { deleteTransactionTool } from "../tools/delete-transaction";
import { getCurrentDateTool } from "../tools/get-current-date";
import { listTagsTool } from "../tools/list-tags";
import { listReportsTool } from "../tools/list-reports";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const FINANCIAL_AGENT_MODEL =
  process.env.OPENROUTER_FINANCIAL_AGENT_MODEL ??
  "deepseek/deepseek-v4.1-flash";
const THREAD_TITLE_MODEL =
  process.env.OPENROUTER_THREAD_TITLE_MODEL ?? "deepseek/deepseek-v4.1-flash";

export const financialAgent = new Agent({
  id: "financial-agent",
  name: "Financial Assistant",
  instructions: FINANCIAL_AGENT_INSTRUCTIONS,
  model: openrouter(FINANCIAL_AGENT_MODEL),
  memory: new Memory({
    options: {
      lastMessages: 50,
      workingMemory: { enabled: true },
      generateTitle: {
        model: openrouter(THREAD_TITLE_MODEL),
        instructions: THREAD_TITLE_INSTRUCTIONS,
      },
    },
  }),
  tools: {
    listTransactionsTool,
    listSubscriptionsTool,
    calculateTool,
    createTransactionTool,
    getSpendingSummaryTool,
    updateTransactionTool,
    deleteTransactionTool,
    getCurrentDateTool,
    listTagsTool,
    listReportsTool,
  },
  inputProcessors: [
    // Single guardrail: TopicGuardrailProcessor classifies every message
    // on-topic vs off-topic with the JEV decision model (via OpenRouter's
    // Decisions API). Was previously preceded by PromptInjectionDetector
    // but it added ~3-7s of latency per request (full LLM call before the
    // main agent) and produced false positives on legitimate financial
    // queries like "edit my last transaction". TopicGuardrail's strict
    // instructions and threshold already block real prompt injection
    // attempts when combined with the model's own safety training.
    new TopicGuardrailProcessor(),
  ],
});
