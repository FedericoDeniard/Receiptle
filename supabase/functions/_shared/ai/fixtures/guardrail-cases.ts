// Text-only emails with zero financial context. Shared by the Grok/Gemini
// integration suite (guardrail rejection) and the guardrail comparison
// harness (Gemini vs JEV vs gpt-6-luna-decisions).
export interface GuardrailNegativeCase {
  name: string;
  emailContent: string;
}

export const guardrailNegativeCases: GuardrailNegativeCase[] = [
  {
    name: "social media notification",
    emailContent: `Hi John,

Sarah liked your photo on Instagram.

Check out what other people are saying about your post.

View activity: https://instagram.com/p/abc123

— The Instagram Team`,
  },
  {
    name: "marketing newsletter",
    emailContent: `Subject: Summer Sale - Up to 50% Off!

Hey there!

Don't miss our biggest sale of the year. Get up to 50% off on selected items.

Shop now: https://shop.example.com/sale

Unsubscribe: https://shop.example.com/unsubscribe`,
  },
  {
    name: "password reset email",
    emailContent: `Hello,

We received a request to reset your password for your account.

Click the link below to reset your password:
https://example.com/reset-password?token=abc123xyz

If you didn't request this, please ignore this email.

Thanks,
The Example Team`,
  },
];
