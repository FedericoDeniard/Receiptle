-- migration: add_subscription_access_until
--
-- purpose:
--   keep a cancelled subscriber's access alive until the end of the period
--   they already paid for. until now the payments-webhook copied the
--   provider status verbatim, so a mp cancellation (which is immediate and
--   has no "cancel at period end" mode) dropped capabilities on the spot.
--
-- affected tables:
--   payments.subscriptions — new column `access_until`
--
-- new objects:
--   payments.expire_pending_cancellations() — flip expired rows to cancelled
--   cron job `expire-pending-cancellations`  — every 15 minutes
--
-- replaced functions:
--   payments.admin_cancel_subscription — sets access_until = now() when the
--   admin revokes immediately.
--
-- notes:
--   - no backfill: rows already cancelled stay cancelled. the new behaviour
--     applies to cancellations observed after this migration ships.
--   - `pending_cancellation` is already treated as an entitled status by
--     payments.user_capabilities_v, custom_access_token_hook, the usage
--     resolver and the frontend. the only missing piece was writing it.
--   - the provider keeps reporting `cancelled`; the local status diverges on
--     purpose while the paid period is still running. the provider truth is
--     preserved in payments.subscriptions.raw->>'status'.

-- ── 1. column ────────────────────────────────────────────────────────────────

alter table payments.subscriptions
  add column if not exists access_until timestamptz;

comment on column payments.subscriptions.access_until is
  'end of the period the subscriber has already paid for. refreshed from the provider on every active subscription event; when a provider reports cancelled with access_until in the future the row is stored as pending_cancellation and keeps entitlements until this timestamp.';

-- partial index used by the expiry job. only pending rows are scanned.
create index if not exists idx_subscriptions_access_until_pending
  on payments.subscriptions (access_until)
  where status = 'pending_cancellation';

-- ── 2. expiry job ────────────────────────────────────────────────────────────

create or replace function payments.expire_pending_cancellations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expired integer;
begin
  -- pending_cancellation means "cancelled at the provider, still inside the
  -- paid period". once that period ends, move the row to the terminal state.
  -- the updated_at trigger fires the subscription_status_changed
  -- notification for the new status.
  update payments.subscriptions
     set status = 'cancelled',
         updated_at = now()
   where status = 'pending_cancellation'
     and access_until is not null
     and access_until <= now();

  get diagnostics v_expired = row_count;
  return v_expired;
end;
$$;

comment on function payments.expire_pending_cancellations() is
  'flip pending_cancellation subscriptions whose access_until has passed to cancelled. run by pg_cron every 15 minutes. returns the number of expired rows.';

revoke all on function payments.expire_pending_cancellations() from public;
grant execute on function payments.expire_pending_cancellations() to service_role;

-- register the cron job (idempotent: recreate only if the definition drifted).
do $$
declare
  desired_schedule text := '*/15 * * * *';
  desired_command text := 'SELECT payments.expire_pending_cancellations()';
  existing_job_id bigint;
  existing_schedule text;
  existing_command text;
begin
  select
    jobid,
    schedule,
    regexp_replace(command, '\s+', ' ', 'g')
  into
    existing_job_id,
    existing_schedule,
    existing_command
  from cron.job
  where jobname = 'expire-pending-cancellations'
  limit 1;

  if existing_job_id is null then
    perform cron.schedule(
      'expire-pending-cancellations',
      desired_schedule,
      desired_command
    );
    raise log 'Created cron job expire-pending-cancellations: schedule=%, command=%', desired_schedule, desired_command;
    return;
  end if;

  if existing_schedule <> desired_schedule
    or trim(existing_command) <> desired_command then
    perform cron.unschedule(existing_job_id);
    perform cron.schedule(
      'expire-pending-cancellations',
      desired_schedule,
      desired_command
    );
    raise log 'Recreated cron job expire-pending-cancellations: old_job_id=%, schedule=%, command=%', existing_job_id, desired_schedule, desired_command;
  else
    raise log 'Cron job expire-pending-cancellations already configured correctly';
  end if;
end $$;

-- ── 3. admin cancellation revokes immediately ────────────────────────────────

create or replace function payments.admin_cancel_subscription(
  p_user_id     uuid,
  p_target_status text default 'pending_cancellation'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_is_admin boolean;
  sub_id          uuid;
begin
  select exists(
    select 1 from public.user_roles
     where public.user_roles.user_id = auth.uid() and public.user_roles.role = 'admin'
  ) into caller_is_admin;

  if not caller_is_admin then
    raise exception 'forbidden: admin only' using errcode = '42501';
  end if;

  if p_target_status not in ('cancelled', 'paused', 'pending_cancellation') then
    raise exception 'invalid target status: %', p_target_status using errcode = '22023';
  end if;

  -- prefer an entitled row over a terminal one: expiring a
  -- pending_cancellation bumps its updated_at and would otherwise shadow a
  -- newer active subscription.
  select s.id into sub_id
    from payments.subscriptions s
   where s.user_id = p_user_id
   order by
     case
       when s.status in ('authorized', 'pending', 'paused', 'pending_cancellation')
         then 0
       else 1
     end,
     s.updated_at desc
   limit 1;

  if sub_id is null then
    raise exception 'no subscription for user %', p_user_id using errcode = 'P0002';
  end if;

  -- local status update only. the provider-side reconciliation is the
  -- payments-webhook job. an immediate cancellation also closes the paid
  -- period so a retried cancelled webhook cannot re-open access.
  update payments.subscriptions
     set status = p_target_status,
         access_until = case
           when p_target_status = 'cancelled' then now()
           else access_until
         end,
         updated_at = now()
   where id = sub_id;

  return sub_id;
end;
$$;

comment on function payments.admin_cancel_subscription(uuid, text) is
  'admin: locally flip a user''s most-recent subscription to cancelled/paused/pending_cancellation. cancelled also sets access_until = now(). the provider-side reconciliation is the payments-webhook job; this update is best-effort UX. guard: caller must have role=admin.';
