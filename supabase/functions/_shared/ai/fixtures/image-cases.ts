// Labeled image fixtures for the image guardrail evaluation. Generated with
// mmx image (MiniMax image-01) on 2026-10-14 — fully synthetic, no real user
// data. Labels are the visual ground truth: receipts must pass, promotional
// or notification graphics must be rejected.
export interface GuardrailImageCase {
  name: string;
  /** Path relative to this fixtures directory. */
  file: string;
  mimeType: string;
  expectedIsTransactionImage: boolean;
}

export const guardrailImageCases: GuardrailImageCase[] = [
  {
    name: "coffee shop paper receipt",
    file: "images/receipt-coffee.jpg",
    mimeType: "image/jpeg",
    expectedIsTransactionImage: true,
  },
  {
    name: "supermarket paper receipt",
    file: "images/receipt-supermarket.jpg",
    mimeType: "image/jpeg",
    expectedIsTransactionImage: true,
  },
  {
    name: "summer sale promotional banner",
    file: "images/promo-banner.jpg",
    mimeType: "image/jpeg",
    expectedIsTransactionImage: false,
  },
  {
    name: "social notifications UI mockup",
    file: "images/social-notification.jpg",
    mimeType: "image/jpeg",
    expectedIsTransactionImage: false,
  },
];
