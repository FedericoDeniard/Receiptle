-- Seed type: payments demo plans
-- Creates a baseline plan + MercadoPago variant for the local dev
-- environment. Admin-only seed: writes to payments.* are only allowed
-- via service_role (see 20260629023955_grant_dml_to_service_role_on_payments.sql).

-- 1) Plan concept: "Lite" (matches the `reason` exposed by the MP plan)
insert into payments.plans (
    plan_key,
    display_name,
    internal_tier,
    frequency,
    frequency_type,
    trial_days,
    is_active
  )
  values (
    'lite_monthly',
    'Lite',
    'lite',
    1,
    'months',
    0,
    true
  )
  on conflict (plan_key) do nothing;

-- 2) MercadoPago variant for that plan.
--    provider_plan_id is the preapproval_plan_id exposed by MP
--    (https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=...)
insert into payments.plan_provider_variants (
    plan_id,
    provider,
    provider_plan_id,
    amount,
    currency,
    is_active
  )
  select
    p.id,
    'mercadopago',
    'd89dfb7bdad34e6ca30e2927c6831fdd',
    15000,
    'ARS',
    true
  from payments.plans p
  where p.plan_key = 'lite_monthly'
  on conflict (plan_id, provider) do nothing;

-- 3) Feature list for the pricing card.
--    Must run AFTER section 1 because feature_keys is on payments.plans.
--    Each entry is an i18n key whose value lives in
--    packages/frontend/src/i18n/locales/{en,es}.json under
--    accountBilling.pricing.dbPlanFeatures.lite.<key>.
--    The original migration that introduced the column
--    (supabase/migrations/20260704003857_add_plan_feature_keys.sql)
--    attempted this update, but it ran before the seed inserted the
--    plan row so the update affected 0 rows; this section is the single
--    source of truth for the demo feature list.
update payments.plans
   set feature_keys = jsonb_build_array(
         'accountBilling.pricing.dbPlanFeatures.lite.everythingInFree',
         'accountBilling.pricing.dbPlanFeatures.lite.gmailSync',
         'accountBilling.pricing.dbPlanFeatures.lite.aiAssistant',
         'accountBilling.pricing.dbPlanFeatures.lite.pushNotifications',
         'accountBilling.pricing.dbPlanFeatures.lite.advancedReports'
       )
 where plan_key = 'lite_monthly'
   and feature_keys = '[]'::jsonb;

-- 4) Capability grants.
--    Same ordering constraint as section 3: must run AFTER section 1.
--    lite_monthly is the only paid plan in the demo, so it gets all
--    basic capabilities from the payments.capability enum (gmail_sync,
--    ai_assistant, push_notifications,
--    process_documents). process_documents was added after the first
--    cut to gate the receipt/image upload path independently from the
--    chat assistant (ai_assistant) — they share the same underlying
--    LLM but are separately sellable.
--    The migration that introduced the table
--    (supabase/migrations/20260705031212_add_plan_capabilities.sql)
--    attempted this grant, but it ran before the seed inserted the
--    plan row so the insert affected 0 rows; this section is the
--    single source of truth for the demo capability map.
--    The `where not exists` makes the seed idempotent: re-running it
--    does not duplicate (plan_id, capability) pairs (the primary key
--    would block duplicates anyway, but the explicit guard keeps the
--    intent clear and avoids spurious errors when re-running locally).
insert into payments.plan_capabilities (plan_id, capability)
select p.id, c.capability
  from payments.plans p
 cross join unnest(array[
       'gmail_sync',
       'ai_assistant',
       'push_notifications',
       'process_documents'
     ]::payments.capability[]) as c(capability)
 where p.plan_key = 'lite_monthly'
   and not exists (
     select 1
       from payments.plan_capabilities pc
      where pc.plan_id = p.id
        and pc.capability = c.capability
   );
