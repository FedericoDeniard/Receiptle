-- migration: admin_revenue
--
-- purpose:
--   the admin panel needs to show real earnings. webhook deliveries only
--   persisted the provider notification envelope (subscription_events.body),
--   so the amount, currency and status of each charge were lost. this
--   migration adds a dedicated ledger of payments and an rpc that aggregates
--   it for the admin panel.
--
-- new objects:
--   payments.payments                  (one row per provider charge)
--   payments.admin_revenue_summary(int)
--
-- replaced functions:
--   payments.admin_list_payment_events (adds charge amount/currency; drops the
--   stale one-argument overload left behind by the pagination migration)
--
-- notes:
--   - the ledger is written by payments-webhook with service_role. no policy
--     exists for authenticated/anon; the admin reads through the rpc.
--   - subscription status does NOT filter revenue: a cancelled subscription
--     that already paid still counts as collected. it only affects mrr.
--   - refunds/chargebacks are not reconciled in v1. a provider row whose
--     latest status is not approved/processed is simply excluded from the
--     collected totals.

-- ============================================================================
-- 1. payments.payments — one row per provider charge
-- ============================================================================
create table if not exists payments.payments (
  id                       uuid primary key default gen_random_uuid(),
  provider                 payments.provider_name not null,
  provider_payment_id      text not null,
  provider_charge_id       text,
  provider_subscription_id text,
  status                   text,
  status_detail            text,
  transaction_amount       numeric(12,2),
  currency_id              text,
  date_approved            timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint payments_provider_payment_id_key unique (provider, provider_payment_id)
);

comment on table payments.payments is
  'one row per provider charge, keyed by (provider, provider_payment_id). written by payments-webhook; admins read through payments.admin_revenue_summary.';
comment on column payments.payments.provider_payment_id is
  'provider id of the charge (mercadopago: authorized_payment id, the same id webhook events carry as payment_id).';
comment on column payments.payments.provider_charge_id is
  'provider id of the underlying payment when the provider exposes a separate one (mercadopago: payment_id).';

create index if not exists idx_payments_provider_subscription
  on payments.payments (provider, provider_subscription_id);

create index if not exists idx_payments_date_approved
  on payments.payments (date_approved desc);

alter table payments.payments enable row level security;

-- no policy for authenticated/anon: the table is service_role only.
revoke all on payments.payments from public, anon, authenticated;
grant select, insert, update, delete on payments.payments to service_role;

drop trigger if exists trg_payments_updated_at on payments.payments;
create trigger trg_payments_updated_at
  before update on payments.payments
  for each row execute function public.update_updated_at_column();

-- ============================================================================
-- 2. admin_list_payment_events — expose the charge amount/currency
-- ============================================================================
-- the return type changes, so the function has to be dropped and recreated
-- (create or replace cannot change the OUT columns). both overloads are
-- dropped: create or replace in the pagination migration left the original
-- one-argument version behind, and it still returns the old shape.
drop function if exists payments.admin_list_payment_events(int);
drop function if exists payments.admin_list_payment_events(int, int);

create function payments.admin_list_payment_events(
  p_limit  int default 50,
  p_offset int default 0
)
returns table (
  id                       bigint,
  received_at              timestamptz,
  topic                    text,
  action                   text,
  provider                 payments.provider_name,
  provider_subscription_id text,
  payment_id               bigint,
  user_id                  uuid,
  user_email               text,
  signature_valid          boolean,
  processing_status        text,
  processing_error         text,
  transaction_amount       numeric,
  currency_id              text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_is_admin boolean;
begin
  select exists(
    select 1 from public.user_roles
     where public.user_roles.user_id = auth.uid() and public.user_roles.role = 'admin'
  ) into caller_is_admin;

  if not caller_is_admin then
    raise exception 'forbidden: admin only' using errcode = '42501';
  end if;

  return query
    select
      e.id,
      e.received_at,
      e.topic,
      e.action,
      e.provider,
      e.provider_subscription_id,
      e.payment_id,
      s.user_id,
      u.email::text,
      e.signature_valid,
      e.processing_status,
      e.processing_error,
      p.transaction_amount,
      p.currency_id
    from payments.subscription_events e
    left join payments.subscriptions s
      on s.provider = e.provider
     and s.provider_subscription_id = e.provider_subscription_id
    left join public.users u on u.id = s.user_id
    left join payments.payments p
      on p.provider = e.provider
     and p.provider_payment_id = e.payment_id::text
   where e.payment_id is not null
   order by e.received_at desc nulls last
   limit p_limit
  offset p_offset;
end;
$$;

comment on function payments.admin_list_payment_events(int, int) is
  'admin: most-recent subscription_events rows that carry a payment_id (i.e. real payment deliveries, not heartbeat/ping). joins back to the owning user via subscriptions+users and to the charge ledger for amount/currency. guard: caller must have role=admin.';

grant execute on function payments.admin_list_payment_events(int, int) to authenticated;

-- ============================================================================
-- 3. admin_revenue_summary — collected revenue + mrr
-- ============================================================================
create or replace function payments.admin_revenue_summary(
  p_months int default 6
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_is_admin boolean;
  v_months        int := least(greatest(coalesce(p_months, 6), 1), 24);
  v_totals        jsonb;
  v_monthly       jsonb;
begin
  select exists(
    select 1 from public.user_roles
     where public.user_roles.user_id = auth.uid() and public.user_roles.role = 'admin'
  ) into caller_is_admin;

  if not caller_is_admin then
    raise exception 'forbidden: admin only' using errcode = '42501';
  end if;

  -- collected: approved charges, regardless of the subscription status. a
  -- cancelled subscription that already paid still counts here.
  with collected as (
    select
      currency_id,
      sum(transaction_amount) as collected_total,
      sum(transaction_amount) filter (
        where coalesce(date_approved, created_at) >= now() - interval '30 days'
      ) as collected_30d,
      count(*)::int as payments
    from payments.payments
    where status in ('approved', 'processed')
      and currency_id is not null
    group by currency_id
  ),
  -- mrr: only subscriptions that currently grant entitlements. a plan-less
  -- subscription has no capability grants, so it is not recurring revenue.
  mrr as (
    select
      currency_id,
      sum(transaction_amount) as mrr,
      count(*)::int as active_subs
    from payments.subscriptions
    where status in ('authorized', 'pending', 'paused', 'pending_cancellation')
      and currency_id is not null
      and plan_id is not null
    group by currency_id
  )
  select coalesce(jsonb_agg(row_to_json(t) order by t.currency_id), '[]'::jsonb)
    into v_totals
    from (
      select
        coalesce(c.currency_id, m.currency_id) as currency_id,
        coalesce(c.collected_total, 0) as collected_total,
        coalesce(c.collected_30d, 0) as collected_30d,
        coalesce(c.payments, 0) as payments,
        coalesce(m.mrr, 0) as mrr,
        coalesce(m.active_subs, 0) as active_subs
      from collected c
      full outer join mrr m on m.currency_id = c.currency_id
    ) t;

  -- zero-filled monthly series: every month in the window for every
  -- currency that has at least one charge in the ledger.
  with months as (
    select generate_series(
      date_trunc('month', now()) - ((v_months - 1) * interval '1 month'),
      date_trunc('month', now()),
      interval '1 month'
    ) as month_start
  ),
  currencies as (
    select distinct currency_id
      from payments.payments
     where currency_id is not null
  ),
  series as (
    select
      to_char(m.month_start, 'YYYY-MM') as month,
      c.currency_id,
      coalesce(sum(p.transaction_amount), 0) as collected,
      count(p.id)::int as payments
    from months m
    cross join currencies c
    left join payments.payments p
      on p.currency_id = c.currency_id
     and p.status in ('approved', 'processed')
     and date_trunc('month', coalesce(p.date_approved, p.created_at)) = m.month_start
    group by m.month_start, c.currency_id
  )
  select coalesce(jsonb_agg(row_to_json(s) order by s.month, s.currency_id), '[]'::jsonb)
    into v_monthly
    from series s;

  return jsonb_build_object(
    'totals', v_totals,
    'monthly', v_monthly,
    'generated_at', now()
  );
end;
$$;

comment on function payments.admin_revenue_summary(int) is
  'admin: collected revenue (approved/processed charges, subscription status ignored) and mrr (entitled subscriptions) per currency, plus a monthly collected series for the last p_months months. guard: caller must have role=admin.';

grant execute on function payments.admin_revenue_summary(int) to authenticated;
