import { describe, expect, skip, test } from "bun:test";

describe("register E2E", () => {
  test.skip(
    "registro completo con confirmación de email",
    async () => {
      // -------------------------------------------------------------------------
      // Stagehand v3 → v4 migration note
      // -------------------------------------------------------------------------
      // Migrated to the v4 API surface. The original test drove the browser
      // via Stagehand's `act`/`extract` against xAI's Grok model. v4's
      // `modelName` enum only accepts openai/anthropic/google/groq/cerebras.
      //
      // To re-enable:
      //   1. Run against an OpenAI / Groq / Anthropic API key (set
      //      `OPENAI_API_KEY`) and adjust the `model` block below; or
      //   2. Plug a custom `generate` function in the Stagehand v4 model
      //      option that proxies to `createXai()` from `@ai-sdk/xai` (already
      //      installed in this workspace).
      //
      // CI does not run these tests. Leave skipped until a model provider is
      // decided. See PR description.
      // -------------------------------------------------------------------------

      const { Stagehand, localBrowser } =
        await import("@browserbasehq/stagehand");
      const { z } = await import("zod");

      if (!process.env.XAI_API_KEY && !process.env.OPENAI_API_KEY) {
        throw new Error(
          "Need XAI_API_KEY (with a custom generate) or OPENAI_API_KEY."
        );
      }

      const timestamp = Date.now();
      const newUser = {
        email: `test${timestamp}@test.com`,
        password: "TestPassword123!",
      };

      const browser = await localBrowser.launch();
      try {
        const stagehand = await Stagehand.create({
          browser,
          model: {
            apiKey: process.env.OPENAI_API_KEY ?? "",
            modelName: "openai/gpt-4o-mini",
          },
        });

        try {
          const initialPage = await browser.context.activePage();
          if (!initialPage) throw new Error("No active page");
          let page = initialPage;

          await page.goto("http://localhost:3000/register");
          await stagehand.act(
            `type '${newUser.email}' into the email input field`,
            { page }
          );
          await stagehand.act(
            `type '${newUser.password}' into the password input field`,
            { page }
          );
          await stagehand.act(
            `type '${newUser.password}' into the confirm password input field`,
            { page }
          );
          await stagehand.act("click the register or sign up button", { page });

          await page.waitForTimeout(2000);
          await page.goto("http://127.0.0.1:54324");
          await stagehand.act(`click on the email sent to ${newUser.email}`, {
            page,
          });

          const { data: emailData } = await stagehand.extract(
            "extract the confirmation code or verification link from the email",
            z.object({
              code: z.string().optional(),
              link: z.string().optional(),
            }),
            { page }
          );

          expect(emailData.code || emailData.link).toBeDefined();

          if (emailData.link) {
            const pagesBefore = (await browser.context.pages()).length;
            await stagehand.act(
              "click the confirmation link or verify button",
              {
                page,
              }
            );
            await page.waitForTimeout(3000);
            const pagesAfter = await browser.context.pages();
            if (pagesAfter.length > pagesBefore) {
              const newPage = pagesAfter[pagesAfter.length - 1];
              if (newPage) {
                await newPage.waitForLoadState("domcontentloaded");
                page = newPage;
              }
            } else {
              await page.goto("http://localhost:3000");
            }
          } else if (emailData.code) {
            await page.goto("http://localhost:3000/login");
            await stagehand.act(
              `type '${newUser.email}' into the email input field`,
              { page }
            );
            await stagehand.act(
              `type '${newUser.password}' into the password input field`,
              { page }
            );
            await stagehand.act("click the login button", { page });
          }

          await page.waitForTimeout(3000);
          const currentUrl = page.url?.() ?? "";
          expect(currentUrl).not.toContain("/login");
          expect(currentUrl).not.toContain("/register");

          const { data: loggedInData } = await stagehand.extract(
            "check if user is logged in by looking for user menu, logout button, or dashboard elements",
            z.object({ isLoggedIn: z.boolean() }),
            { page }
          );

          expect(loggedInData.isLoggedIn).toBe(true);
        } finally {
          await stagehand.close();
        }
      } finally {
        await browser.close();
      }
    },
    { timeout: 60000 }
  );
});
