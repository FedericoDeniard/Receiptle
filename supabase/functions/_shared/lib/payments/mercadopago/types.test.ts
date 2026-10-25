import { assertEquals } from "jsr:@std/assert";
import {
  authorizedPaymentResponseSchema,
  paymentResponseSchema,
} from "./types.ts";

Deno.test("authorized payment keeps the charge amount and status", () => {
  const parsed = authorizedPaymentResponseSchema.parse({
    id: 7033235440,
    status: "processed",
    status_detail: "accredited",
    preapproval_id: "db15258e21bb470a90955564fbf6f96f",
    payment_id: 123456,
    external_reference: "user-id",
    transaction_amount: 15000,
    currency_id: "ARS",
    date_created: "2026-10-24T15:22:03.000Z",
    date_approved: "2026-10-24T15:22:04.000Z",
  });

  assertEquals(parsed.transaction_amount, 15000);
  assertEquals(parsed.currency_id, "ARS");
  assertEquals(parsed.status, "processed");
  assertEquals(parsed.status_detail, "accredited");
  assertEquals(parsed.date_approved, "2026-10-24T15:22:04.000Z");
});

Deno.test("authorized payment tolerates a missing amount", () => {
  const parsed = authorizedPaymentResponseSchema.parse({
    id: 1,
    status: "scheduled",
  });

  assertEquals(parsed.transaction_amount, undefined);
  assertEquals(parsed.currency_id, undefined);
});

Deno.test("payment keeps the charge amount and status", () => {
  const parsed = paymentResponseSchema.parse({
    id: 123456,
    status: "approved",
    status_detail: "accredited",
    transaction_amount: 15000,
    currency_id: "ARS",
    date_approved: "2026-10-24T15:23:00.000Z",
  });

  assertEquals(parsed.transaction_amount, 15000);
  assertEquals(parsed.currency_id, "ARS");
  assertEquals(parsed.status, "approved");
});
