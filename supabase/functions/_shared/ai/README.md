# Transaction Agent Integration Tests

This folder includes an integration suite that calls the real Grok model through the same production module (`extractTransactionFromEmail`).

## Prerequisite

- `XAI_API_KEY` must be set in your environment.

## Run only this suite

```bash
cd supabase
deno test --no-check --env-file="functions/.env" --allow-env --allow-net "functions/_shared/ai/transaction-agent.integration.test.ts"
```

## Notes

- These tests are integration tests: they are slower and consume model tokens.
- Fixtures are defined in `functions/_shared/ai/fixtures/transaction-agent-cases.ts`.

## Guardrail comparison harness

`functions/_shared/ai/guardrail-comparison.test.ts` runs the three email
guardrails — Gemini (legacy), JEV and `gpt-6-luna-decisions` (both via
OpenRouter's Decisions API, current defaults) — over the shared labeled corpus
and prints a comparison report: per-case probabilities, accuracy against the
manual labels, agreement between guardrails and a threshold sweep.

```bash
# from the repo root (requires the local Supabase stack + OPENROUTER_API_KEY)
bun run test:guardrail:comparison
```

It is an observational eval, not a CI gate: it fails only when a guardrail call
breaks. Every Decisions call is paid. The suite also scores the image guardrail
(`gpt-6-luna-decisions` with the synthetic image fixtures) against its labels,
using the current auto-pass behavior as the baseline.

The email pipeline runs a fixed guardrail cascade: text-only emails go
JEV → Gemini (only on JEV errors; a rejection is final) → allow, and image
emails go `gpt-6-luna-decisions` → allow. `EMAIL_IMAGE_GUARDRAIL_PROVIDER=none`
is the kill-switch that restores the historical auto-pass for image emails.
Emails with file (PDF) attachments always skip the guardrail.

### Image guardrail and the decisions image shape

The Decisions endpoint accepts images inside `state` only as
chat-completions-style parts:

```json
"state": [
  { "type": "text", "text": "Image attachment(s) from the email." },
  { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,..." } }
]
```

Responses-style `input_image` parts are NOT converted by the router: they are
tokenized as text (usage scales with base64 length, verdicts are unstable). JEV
rejects images (HTTP 400); the image guardrail always uses
`openai/gpt-6-luna-decisions` (`EMAIL_IMAGE_GUARDRAIL_PROVIDER=openai-decisions`,
the default).

## Refresh fixtures from Langfuse export

1. Export dataset items from Langfuse.
2. Generate the fixture file:

```bash
cd supabase
deno run --allow-read --allow-write "functions/_shared/ai/fixtures/import-langfuse-dataset.ts" "/absolute/path/to/lf-dataset_items-export.json"
```

3. Update manual labels in `functions/_shared/ai/fixtures/transaction-agent-labels.ts`.
4. Run the integration test suite again.
