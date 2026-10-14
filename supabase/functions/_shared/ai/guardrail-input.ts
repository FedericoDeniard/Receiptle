// Shared input preparation for the email guardrails (Gemini and Decisions).
// Both guardrails must see exactly the same text so their verdicts are
// comparable: HTML/CSS stripped, whitespace collapsed, first 1500 chars.
import { stripHtml } from "npm:string-strip-html";

export const GUARDRAIL_MAX_CHARS = 1500;

export function prepareEmailContent(emailContent: string): string {
  // Step 1: Remove <style> blocks (tag + content)
  let cleaned = emailContent.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ");
  // Step 2: Remove <script> blocks (tag + content)
  cleaned = cleaned.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ");
  // Step 3: Remove loose CSS rules (selector { ... }) and @media blocks
  cleaned = cleaned.replace(/@media[^{]*\{[\s\S]*?\}\s*\}/gi, " ");
  cleaned = cleaned.replace(/[^{}\n]+\{[^{}]*\}/g, " ");
  // Step 4: Strip remaining HTML tags
  cleaned = stripHtml(cleaned).result;
  // Step 5: Collapse whitespace
  return cleaned.replace(/\s+/g, " ").trim();
}

export function prepareEmailForGuardrail(emailContent: string): string {
  return prepareEmailContent(emailContent).slice(0, GUARDRAIL_MAX_CHARS);
}

export function buildGuardrailUserPrompt(emailContent: string): string {
  return `Email content (first ${GUARDRAIL_MAX_CHARS} chars of cleaned text):
${prepareEmailForGuardrail(emailContent)}`;
}
