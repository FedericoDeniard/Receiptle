// Guardrail comparison harness: Gemini (legacy) vs the Decisions guardrails
// (JEV and gpt-6-luna-decisions, current defaults) over the shared labeled
// corpus.
//
// Observational eval, not a CI gate: it prints a report and only fails when a
// guardrail call breaks (infra/transport/parsing), so the numbers can be
// studied before any provider default changes. Every run spends real model
// calls: ~3 calls per case, and the Decisions calls are paid.
//
// Run with:
//   bun run test:guardrail:comparison
// or:
//   cd supabase && deno test --no-check --env-file="functions/.env" \
//     --allow-env --allow-sys=hostname --allow-net \
//     "functions/_shared/ai/guardrail-comparison.test.ts"
//
// Requires the local Supabase stack (both guardrails call OpenRouter through
// the public.http_post RPC) and OPENROUTER_API_KEY in functions/.env.
import { assertEquals } from "jsr:@std/assert";
import { runEmailGuardrail, shouldProcessEmail } from "./guardrail.ts";
import {
  shouldProcessImageEmailWithDecisions,
  shouldProcessTextEmailWithDecisions,
  type DecisionsGuardrailResult,
  type DecisionsImageGuardrailResult,
} from "./decisions-guardrail.ts";
import { transactionAgentCases } from "./fixtures/transaction-agent-cases.ts";
import { guardrailNegativeCases } from "./fixtures/guardrail-cases.ts";
import { guardrailImageCases } from "./fixtures/image-cases.ts";

const THRESHOLDS = [0.5, 0.7, 0.85];

interface ComparisonCase {
  name: string;
  emailContent: string;
  expectedHasTransaction: boolean;
  rationale?: string;
}

const comparisonCases: ComparisonCase[] = [
  ...transactionAgentCases.map(testCase => ({
    name: testCase.name,
    emailContent: testCase.emailContent,
    expectedHasTransaction: testCase.expectedHasTransaction,
    rationale: testCase.rationale,
  })),
  ...guardrailNegativeCases.map(testCase => ({
    name: testCase.name,
    emailContent: testCase.emailContent,
    expectedHasTransaction: false,
  })),
];

interface GeminiResult {
  shouldProcess: boolean;
  reason: string;
  latencyMs: number;
}

interface CaseRow {
  case: ComparisonCase;
  gemini: GeminiResult | null;
  geminiError: string | null;
  jev: DecisionsGuardrailResult;
  luna: DecisionsGuardrailResult;
}

async function runCase(testCase: ComparisonCase): Promise<CaseRow> {
  const startedAt = Date.now();
  let gemini: GeminiResult | null = null;
  let geminiError: string | null = null;
  try {
    const result = await shouldProcessEmail(testCase.emailContent, false);
    gemini = {
      shouldProcess: result.shouldProcess,
      reason: result.reason,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    geminiError = error instanceof Error ? error.message : String(error);
  }

  const jev = await shouldProcessTextEmailWithDecisions(testCase.emailContent, {
    provider: "jev",
  });
  const luna = await shouldProcessTextEmailWithDecisions(
    testCase.emailContent,
    {
      provider: "openai-decisions",
    }
  );

  return { case: testCase, gemini, geminiError, jev, luna };
}

function pad(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text.padEnd(width);
}

function fmtProbability(value: number | null): string {
  return value === null ? "?" : value.toFixed(2);
}

function fmtPair(a: number | null, b: number | null): string {
  return `${fmtProbability(a)}/${fmtProbability(b)}`;
}

function fmtCost(value: number | null): string {
  return value === null ? "?" : value.toFixed(6);
}

function scoreDecision(
  decision: boolean,
  expected: boolean
): "TP" | "FP" | "TN" | "FN" {
  if (decision && expected) return "TP";
  if (decision && !expected) return "FP";
  if (!decision && !expected) return "TN";
  return "FN";
}

interface Score {
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  mismatches: string[];
}

function newScore(): Score {
  return { tp: 0, fp: 0, tn: 0, fn: 0, mismatches: [] };
}

function addScore(
  score: Score,
  decision: boolean,
  expected: boolean,
  label: string
): void {
  const verdict = scoreDecision(decision, expected);
  score[verdict.toLowerCase() as "tp" | "fp" | "tn" | "fn"] += 1;
  if (verdict === "FP" || verdict === "FN") {
    score.mismatches.push(`${label} → ${verdict}`);
  }
}

function fmtScore(score: Score): string {
  const total = score.tp + score.fp + score.tn + score.fn;
  const correct = score.tp + score.tn;
  const pct = total === 0 ? "?" : `${((correct / total) * 100).toFixed(0)}%`;
  return `acc ${correct}/${total} (${pct})  TP ${score.tp}  FP ${score.fp}  TN ${score.tn}  FN ${score.fn}`;
}

function printCaseTable(rows: CaseRow[]): void {
  console.log(
    "\n-- Cases (markdown) ---------------------------------------------------"
  );
  console.log(
    "| case | exp | gem | jev t/c | luna t/c | ms g/j/l | cost j/l |"
  );
  console.log("| --- | --- | --- | --- | --- | --- | --- |");
  for (const row of rows) {
    console.log(
      `| ${row.case.name} ` +
        `| ${row.case.expectedHasTransaction ? "y" : "n"} ` +
        `| ${row.gemini ? (row.gemini.shouldProcess ? "y" : "n") : "ERR"} ` +
        `| ${fmtPair(row.jev.probability, row.jev.completedProbability)} ` +
        `| ${fmtPair(row.luna.probability, row.luna.completedProbability)} ` +
        `| ${row.gemini?.latencyMs ?? "?"}/${row.jev.latencyMs}/${row.luna.latencyMs} ` +
        `| ${fmtCost(row.jev.cost)}/${fmtCost(row.luna.cost)} |`
    );
  }
}

function printScores(rows: CaseRow[]): void {
  console.log("\n-- vs ground truth (label = completed transaction) --");
  console.log(
    "coarse rows (gemini shouldProcess, transactional) may legitimately pass\n" +
      "reminders and notices; completed rows are the ones that should match the label.\n"
  );

  const entries: Array<{ label: string; score: Score }> = [];

  const geminiScore = newScore();
  for (const row of rows) {
    if (row.gemini) {
      addScore(
        geminiScore,
        row.gemini.shouldProcess,
        row.case.expectedHasTransaction,
        row.case.name
      );
    }
  }
  entries.push({ label: "gemini shouldProcess", score: geminiScore });

  for (const model of ["jev", "luna"] as const) {
    for (const threshold of THRESHOLDS) {
      const completed = newScore();
      const transactional = newScore();
      for (const row of rows) {
        const expected = row.case.expectedHasTransaction;
        const result = row[model];
        addScore(
          completed,
          (result.completedProbability ?? 1) >= threshold,
          expected,
          row.case.name
        );
        addScore(
          transactional,
          (result.probability ?? 1) >= threshold,
          expected,
          row.case.name
        );
      }
      entries.push({
        label: `${model} completed>=${threshold}`,
        score: completed,
      });
      entries.push({
        label: `${model} transactional>=${threshold}`,
        score: transactional,
      });
    }
  }

  for (const entry of entries) {
    console.log(`${pad(entry.label, 26)} ${fmtScore(entry.score)}`);
    if (entry.score.mismatches.length > 0) {
      console.log(`  mismatches: ${entry.score.mismatches.join("; ")}`);
    }
  }
}

function printAgreement(rows: CaseRow[], threshold: number): void {
  console.log(
    `\n-- Agreement on the coarse gate (isTransactional >= ${threshold}) --`
  );
  let geminiJev = 0;
  let geminiLuna = 0;
  let jevLuna = 0;
  const disagreements: string[] = [];
  for (const row of rows) {
    if (!row.gemini) continue;
    const geminiGate = row.gemini.shouldProcess;
    const jevGate = (row.jev.probability ?? 1) >= threshold;
    const lunaGate = (row.luna.probability ?? 1) >= threshold;
    if (geminiGate === jevGate) geminiJev += 1;
    if (geminiGate === lunaGate) geminiLuna += 1;
    if (jevGate === lunaGate) jevLuna += 1;
    if (
      geminiGate !== jevGate ||
      geminiGate !== lunaGate ||
      jevGate !== lunaGate
    ) {
      disagreements.push(
        `${row.case.name} (gemini=${geminiGate ? "y" : "n"} jev=${jevGate ? "y" : "n"} luna=${lunaGate ? "y" : "n"})`
      );
    }
  }
  const total = rows.filter(row => row.gemini).length;
  console.log(`gemini vs jev:  ${geminiJev}/${total}`);
  console.log(`gemini vs luna: ${geminiLuna}/${total}`);
  console.log(`jev vs luna:    ${jevLuna}/${total}`);
  if (disagreements.length > 0) {
    console.log(`disagreements: ${disagreements.join("; ")}`);
  }
}

function printLatencyAndCost(rows: CaseRow[]): void {
  console.log("\n-- Latency (ms) and cost (USD) --");
  for (const model of ["gemini", "jev", "luna"] as const) {
    const latencies = rows
      .map(row =>
        model === "gemini" ? row.gemini?.latencyMs : row[model].latencyMs
      )
      .filter((value): value is number => typeof value === "number")
      .sort((a, b) => a - b);
    if (latencies.length === 0) continue;
    const median = latencies[Math.floor(latencies.length / 2)];
    const costs = rows
      .map(row => (model === "gemini" ? null : row[model].cost))
      .filter((value): value is number => typeof value === "number");
    const totalCost = costs.reduce((sum, value) => sum + value, 0);
    const modelId =
      model === "gemini"
        ? "google/gemini-2.5-flash-lite"
        : model === "jev"
          ? rows[0]?.jev.model
          : rows[0]?.luna.model;
    console.log(
      `${model} (${modelId}): median ${median}ms, range ${latencies[0]}-${latencies[latencies.length - 1]}ms, ` +
        (model === "gemini"
          ? "no metered cost"
          : `total $${totalCost.toFixed(6)}`)
    );
  }
}

interface ImageRow {
  case: (typeof guardrailImageCases)[number];
  result: DecisionsImageGuardrailResult;
}

async function runImageCase(
  imageCase: (typeof guardrailImageCases)[number]
): Promise<ImageRow> {
  const bytes = await Deno.readFile(
    new URL(`./fixtures/${imageCase.file}`, import.meta.url)
  );
  const result = await shouldProcessImageEmailWithDecisions([
    { data: bytes, mimeType: imageCase.mimeType, filename: imageCase.file },
  ]);
  return { case: imageCase, result };
}

function printImageReport(rows: ImageRow[]): void {
  console.log(
    "\n-- Image guardrail (openai/gpt-6-luna-decisions, chat-style image parts) --"
  );
  console.log("| case | expected | noul | decision@0.5 | ms | cost |");
  console.log("| --- | --- | --- | --- | --- | --- |");
  for (const row of rows) {
    const decision = (row.result.probability ?? 1) >= 0.5;
    console.log(
      `| ${row.case.name} ` +
        `| ${row.case.expectedIsTransactionImage ? "transaction" : "not-transaction"} ` +
        `| ${row.result.probability?.toFixed(2) ?? "?"} ` +
        `| ${decision ? "allow" : "reject"} ` +
        `| ${row.result.latencyMs} ` +
        `| ${row.result.cost?.toFixed(6) ?? "?"} |`
    );
  }

  for (const threshold of THRESHOLDS) {
    const score = newScore();
    for (const row of rows) {
      addScore(
        score,
        (row.result.probability ?? 1) >= threshold,
        row.case.expectedIsTransactionImage,
        row.case.name
      );
    }
    console.log(`luna-image noul>=${threshold}: ${fmtScore(score)}`);
    if (score.mismatches.length > 0) {
      console.log(`  mismatches: ${score.mismatches.join("; ")}`);
    }
  }

  // Baseline: current production behavior lets every image email through.
  const baseline = newScore();
  for (const row of rows) {
    addScore(
      baseline,
      true,
      row.case.expectedIsTransactionImage,
      row.case.name
    );
  }
  console.log(`baseline (current auto-pass):   ${fmtScore(baseline)}`);

  const costs = rows
    .map(row => row.result.cost)
    .filter((value): value is number => typeof value === "number");
  const latencies = rows.map(row => row.result.latencyMs).sort((a, b) => a - b);
  if (latencies.length > 0) {
    console.log(
      `luna-image latency: median ${latencies[Math.floor(latencies.length / 2)]}ms, ` +
        `range ${latencies[0]}-${latencies[latencies.length - 1]}ms, ` +
        `total $${costs.reduce((sum, value) => sum + value, 0).toFixed(6)}`
    );
  }
}

Deno.test({
  name: "guardrail comparison: gemini vs jev vs gpt-6-luna-decisions",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async t => {
    if (!Deno.env.get("OPENROUTER_API_KEY")) {
      throw new Error(
        "OPENROUTER_API_KEY is required to run the guardrail comparison suite."
      );
    }

    console.log(
      `\nGuardrail comparison — ${comparisonCases.length} text cases × 3 guardrails ` +
        `+ ${guardrailImageCases.length} image cases. ` +
        "Decisions calls are paid; output is a report, not a gate."
    );

    const rows: CaseRow[] = [];
    for (const testCase of comparisonCases) {
      await t.step(testCase.name, async () => {
        rows.push(await runCase(testCase));
      });
    }

    printCaseTable(rows);
    printScores(rows);
    printAgreement(rows, 0.5);
    printLatencyAndCost(rows);

    const imageRows: ImageRow[] = [];
    for (const imageCase of guardrailImageCases) {
      await t.step(`[image] ${imageCase.name}`, async () => {
        imageRows.push(await runImageCase(imageCase));
      });
    }

    printImageReport(imageRows);

    const broken = rows.filter(
      row =>
        row.geminiError !== null ||
        row.jev.error !== undefined ||
        row.luna.error !== undefined
    );
    const brokenImages = imageRows.filter(
      row => row.result.error !== undefined
    );
    assertEquals(
      broken.length + brokenImages.length,
      0,
      `Guardrail calls failed:\n${broken
        .map(
          row =>
            `- ${row.case.name}: gemini=${row.geminiError ?? "ok"} jev=${row.jev.error ?? "ok"} luna=${row.luna.error ?? "ok"}`
        )
        .concat(
          brokenImages.map(
            row => `- [image] ${row.case.name}: ${row.result.error}`
          )
        )
        .join("\n")}`
    );
  },
});

Deno.test({
  name: "text guardrail cascade: jev failure falls back to gemini",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    if (!Deno.env.get("OPENROUTER_API_KEY")) {
      throw new Error(
        "OPENROUTER_API_KEY is required to run the guardrail cascade test."
      );
    }

    const negativeCase = guardrailNegativeCases[0];
    if (!negativeCase) {
      throw new Error("guardrailNegativeCases fixture is empty");
    }

    // Force the JEV call to fail with a nonexistent model id so the cascade
    // must fall through to Gemini. The email is a plain non-transactional
    // case Gemini reliably rejects, so the verdict must be Gemini's.
    const previousModel = Deno.env.get("OPENROUTER_GUARDRAIL_TEXT_MODEL");
    try {
      Deno.env.set(
        "OPENROUTER_GUARDRAIL_TEXT_MODEL",
        "typesafe/this-model-does-not-exist"
      );

      const result = await runEmailGuardrail(negativeCase.emailContent);

      assertEquals(
        result.provider,
        "gemini",
        `Expected gemini fallback, got ${result.provider}. Reason: ${result.reason}`
      );
      assertEquals(result.fallbackFrom, "jev");
      assertEquals(
        result.shouldProcess,
        false,
        `Gemini should reject "${negativeCase.name}": ${result.reason}`
      );
    } finally {
      if (previousModel === undefined) {
        Deno.env.delete("OPENROUTER_GUARDRAIL_TEXT_MODEL");
      } else {
        Deno.env.set("OPENROUTER_GUARDRAIL_TEXT_MODEL", previousModel);
      }
    }
  },
});
