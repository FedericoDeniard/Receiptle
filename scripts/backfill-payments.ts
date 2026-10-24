// backfill payments.payments from the provider.
//
// usage (after the admin_revenue migration ships):
//   deno run --allow-env --allow-net --env-file=supabase/functions/.env \
//     scripts/backfill-payments.ts
//
// required env:
//   SUPABASE_URL, SUPABASE_SECRET_KEY  target project (uses the payments schema)
//   MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET, MP_NOTIFICATION_URL
//                                      getMPConfig validates all three
//
// the script is idempotent: it upserts by (provider, provider_payment_id),
// the same key payments-webhook uses going forward.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { getProvider } from "../supabase/functions/_shared/lib/payments/index.ts";
import type {
  AuthorizedPaymentDetails,
  PaymentDetails,
} from "../supabase/functions/_shared/lib/payments/types.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const secretKey = Deno.env.get("SUPABASE_SECRET_KEY");
if (!supabaseUrl || !secretKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required");
}

const provider = getProvider("mercadopago");
if (!provider) throw new Error("mercadopago provider is not registered");

const client = provider as unknown as {
  getAuthorizedPayment?: (
    id: string | number
  ) => Promise<AuthorizedPaymentDetails | null>;
  getPayment?: (id: string | number) => Promise<PaymentDetails | null>;
};
if (typeof client.getAuthorizedPayment !== "function") {
  throw new Error("provider has no getAuthorizedPayment implementation");
}

const supabase = createClient(supabaseUrl, secretKey, {
  db: { schema: "payments" },
});

interface EventRow {
  id: number;
  payment_id: number | null;
  provider: string;
  provider_subscription_id: string | null;
  received_at: string | null;
}

const PAGE_SIZE = 1000;

async function fetchPaymentEvents(): Promise<EventRow[]> {
  const rows: EventRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("subscription_events")
      .select("id, payment_id, provider, provider_subscription_id, received_at")
      .eq("provider", "mercadopago")
      .not("payment_id", "is", null)
      .order("received_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as EventRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

const byPayment = new Map<number, EventRow>();
for (const row of await fetchPaymentEvents()) {
  if (row.payment_id == null) continue;
  const existing = byPayment.get(row.payment_id);
  if (!existing) {
    byPayment.set(row.payment_id, row);
  } else if (
    !existing.provider_subscription_id &&
    row.provider_subscription_id
  ) {
    existing.provider_subscription_id = row.provider_subscription_id;
  }
}

let upserted = 0;
let skipped = 0;
let failed = 0;

for (const [paymentId, event] of byPayment) {
  try {
    const authPayment = await client.getAuthorizedPayment(paymentId);
    if (!authPayment) {
      skipped += 1;
      console.warn("[backfill-payments] provider returned 404", { paymentId });
      continue;
    }

    let payment: PaymentDetails | null = null;
    if (authPayment.paymentId && typeof client.getPayment === "function") {
      try {
        payment = await client.getPayment(authPayment.paymentId);
      } catch (error) {
        console.warn("[backfill-payments] getPayment failed", {
          paymentId,
          chargeId: authPayment.paymentId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const providerSubscriptionId =
      authPayment.preapprovalId ?? event.provider_subscription_id;

    const row: Record<string, unknown> = {
      provider: "mercadopago",
      provider_payment_id: String(paymentId),
      provider_charge_id: authPayment.paymentId
        ? String(authPayment.paymentId)
        : null,
      provider_subscription_id: providerSubscriptionId,
      status: payment?.status,
      status_detail: payment?.statusDetail,
      transaction_amount:
        payment?.transactionAmount ?? authPayment.transactionAmount,
      currency_id: payment?.currencyId ?? authPayment.currencyId,
      date_approved:
        payment?.dateApproved ?? authPayment.dateApproved ?? event.received_at,
    };
    for (const column of Object.keys(row)) {
      if (row[column] === undefined || row[column] === null) delete row[column];
    }

    const { error } = await supabase
      .from("payments")
      .upsert(row, { onConflict: "provider,provider_payment_id" });
    if (error) throw new Error(error.message);
    upserted += 1;
  } catch (error) {
    failed += 1;
    console.error("[backfill-payments] failed", {
      paymentId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

console.info("[backfill-payments] done", {
  total: byPayment.size,
  upserted,
  skipped,
  failed,
});

if (failed > 0) Deno.exit(1);
