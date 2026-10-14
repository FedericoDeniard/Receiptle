import { describe, expect, skip, test } from "bun:test";

describe("login E2E", () => {
  test.skip(
    "login con credenciales inválidas debe mostrar error",
    async () => {
      // -------------------------------------------------------------------------
      // Stagehand v3 → v4 migration note
      // -------------------------------------------------------------------------
      // The original test was migrated to the v4 API surface but the
      // underlying model provider (`xai` / Grok) is not part of the v4 enum:
      // v4 `modelName` only accepts "openai/…", "anthropic/…",
      // "google/…", "groq/…", "cerebras/…".
      //
      // To re-enable:
      //   1. Run the test against an OpenAI / Groq / Anthropic API key by
      //      setting `OPENAI_API_KEY` (etc.) and uncomment the v4 block
      //      below.
      //   2. OR plug a custom `generate` function in the Stagehand v4 model
      //      option that proxies to `createXai()` from `@ai-sdk/xai` (already
      //      installed in this workspace as of the dependency upgrade).
      //
      // Both are dev-only tests; CI does not run them. Leave this skipped
      // until we pick a model provider. See PR description.
      // -------------------------------------------------------------------------

      const { Stagehand, localBrowser } =
        await import("@browserbasehq/stagehand");
      const { z } = await import("zod");

      if (!process.env.XAI_API_KEY && !process.env.OPENAI_API_KEY) {
        throw new Error(
          "Need XAI_API_KEY (with a custom generate) or OPENAI_API_KEY."
        );
      }

      const browser = await localBrowser.launch();
      try {
        const stagehand = await Stagehand.create({
          browser,
          // Placeholder model — replace with a custom generate that uses
          // `createXai` from `@ai-sdk/xai` to keep using Grok.
          model: {
            apiKey: process.env.OPENAI_API_KEY ?? "",
            modelName: "openai/gpt-4o-mini",
          },
        });

        try {
          const page = await browser.context.activePage();
          if (!page) throw new Error("No active page");

          const fakeUser = { email: "test@test.com", password: "password1234" };
          await page.goto("http://localhost:3000/login");

          await stagehand.act(
            `type '${fakeUser.email}' into the email input field`,
            { page }
          );
          await stagehand.act(
            `type '${fakeUser.password}' into the password input field`,
            { page }
          );
          await stagehand.act("click the login button", { page });

          const { data: errorData } = await stagehand.extract(
            "extract any error message displayed on the page",
            z.object({
              hasError: z.boolean(),
              errorMessage: z.string().optional(),
            }),
            { page }
          );

          expect(errorData.hasError).toBe(true);
          expect(errorData.errorMessage).toBeDefined();
          expect(errorData.errorMessage).not.toBe("");
        } finally {
          await stagehand.close();
        }
      } finally {
        await browser.close();
      }
    },
    { timeout: 30000 }
  );
});
