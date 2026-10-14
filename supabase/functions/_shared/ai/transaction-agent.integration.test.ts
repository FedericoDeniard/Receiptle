import { assert, assertEquals } from "jsr:@std/assert";
import { TransactionSchema, type TransactionResponse } from "./schemas.ts";
import { extractTransactionFromEmail } from "./transaction-agent.ts";
import { shouldProcessEmail } from "./guardrail.ts";
import { transactionAgentCases } from "./fixtures/transaction-agent-cases.ts";
import { guardrailNegativeCases } from "./fixtures/guardrail-cases.ts";

function assertPositiveResponse(
  result: TransactionResponse,
  expectations: {
    expectedAmount?: number;
    expectedCurrency?: string;
    expectedType?: "income" | "expense";
  }
) {
  assert(result.hasTransaction, "Expected hasTransaction=true");
  const parsed = TransactionSchema.safeParse(result.data);
  assert(
    parsed.success,
    `Expected data to satisfy TransactionSchema. Data: ${JSON.stringify(result.data)}`
  );
  assert(
    result.data.amount > 0,
    `Expected amount > 0. Got: ${result.data.amount}`
  );
  assert(
    result.data.merchant.trim().length > 0,
    "Expected merchant to be non-empty"
  );

  if (expectations.expectedAmount !== undefined) {
    assertEquals(
      result.data.amount,
      expectations.expectedAmount,
      `Expected amount=${expectations.expectedAmount} from email ground truth`
    );
  }
  if (expectations.expectedCurrency !== undefined) {
    assertEquals(
      result.data.currency,
      expectations.expectedCurrency,
      `Expected currency=${expectations.expectedCurrency}`
    );
  }
  if (expectations.expectedType !== undefined) {
    assertEquals(
      result.data.type,
      expectations.expectedType,
      `Expected type=${expectations.expectedType}`
    );
  }
}

function assertNegativeResponse(result: TransactionResponse) {
  assert(!result.hasTransaction, "Expected hasTransaction=false");
  assert(
    result.reason.trim().length > 0,
    "Expected reason to be non-empty for no-transaction responses"
  );
}

Deno.test({
  name: "transaction-agent integration with real Grok",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async t => {
    if (!Deno.env.get("XAI_API_KEY")) {
      throw new Error(
        "XAI_API_KEY is required to run this integration test suite."
      );
    }

    for (const testCase of transactionAgentCases) {
      await t.step(testCase.name, async () => {
        const result = await extractTransactionFromEmail(
          testCase.emailContent,
          testCase.userFullName,
          undefined,
          undefined,
          undefined,
          testCase.userLocale
        );

        assertEquals(
          result.hasTransaction,
          testCase.expectedHasTransaction,
          [
            `Case: ${testCase.name}`,
            `Dataset item: ${testCase.datasetItemId ?? "n/a"}`,
            `Source observation: ${testCase.sourceObservationId ?? "n/a"}`,
            `Rationale: ${testCase.rationale ?? "n/a"}`,
            `Expected hasTransaction=${testCase.expectedHasTransaction}`,
            `Actual response: ${JSON.stringify(result)}`,
          ].join("\n")
        );

        if (testCase.expectedHasTransaction) {
          assertPositiveResponse(result, {
            expectedAmount: testCase.expectedAmount,
            expectedCurrency: testCase.expectedCurrency,
            expectedType: testCase.expectedType,
          });
        } else {
          assertNegativeResponse(result);
        }
      });
    }
  },
});

Deno.test({
  name: "transaction-agent rejects non-transactional email via guardrail",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    if (!Deno.env.get("XAI_API_KEY")) {
      throw new Error(
        "XAI_API_KEY is required to run this integration test suite."
      );
    }

    const result = await extractTransactionFromEmail(
      `Hi Alex,

You have a new follower on Twitter: @tech_guru.

They started following you after you posted about the latest JavaScript framework.

View profile: https://twitter.com/tech_guru

— Twitter Team`,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    );

    assertEquals(
      result.hasTransaction,
      false,
      `Expected hasTransaction=false for social notification. Actual: ${JSON.stringify(result)}`
    );
    assert(
      result.reason.includes("Guardrail") ||
        result.reason.includes("guardrail"),
      `Expected rejection reason to mention guardrail. Got: ${result.reason}`
    );
  },
});

Deno.test({
  name: "guardrail rejects clearly non-transactional emails",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async t => {
    for (const testCase of guardrailNegativeCases) {
      await t.step(testCase.name, async () => {
        const result = await shouldProcessEmail(testCase.emailContent, false);
        assertEquals(
          result.shouldProcess,
          false,
          `Guardrail should reject non-transactional email: ${testCase.name}\nReason: ${result.reason}`
        );
      });
    }
  },
});
