-- Migration: subscription_status_changed notification type + trigger on payments.subscriptions
-- Purpose: Notify the user (in-app + push) whenever their subscription changes
--          status, and when a subscription is first linked to them (the
--          payments-webhook links user_id after the row already exists, so
--          the link is the user's first "authorized" signal).
-- Affected tables: public.notification_types (insert),
--                  payments.subscriptions (trigger added)
-- New objects:
--   payments.notify_subscription_status_change() — trigger function
--   on_subscription_status_change_notify       — trigger on payments.subscriptions
-- Notes:
--   - One notification type (one preference toggle), but the row's
--     title/body keys are picked per status so the copy can be specific.
--     send-push-notification resolves push text by the segment after
--     "templates", so each per-status key needs a template there too.
--   - Webhook re-upserts with the same status do not notify (status and
--     user_id unchanged).

-- ── 1. Register the notification type ────────────────────────────────────────

insert into public.notification_types (
  category_id,
  key,
  label_i18n_key,
  description_i18n_key,
  title_i18n_key,
  body_i18n_key,
  default_importance,
  is_active
)
select
  id,
  'subscription_status_changed',
  'notifications.types.subscription_status_changed.label',
  'notifications.types.subscription_status_changed.description',
  'notifications.templates.subscription_status_changed.title',
  'notifications.templates.subscription_status_changed.body',
  'normal',
  true
from public.notification_categories
where key = 'system'
on conflict (key) do nothing;

-- ── 2. Trigger function ───────────────────────────────────────────────────────

create or replace function payments.notify_subscription_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type_id    uuid;
  v_template   text;
  v_importance text;
begin
  -- unlinked subscriptions have nobody to notify yet
  if new.user_id is null then
    return new;
  end if;

  -- only a status change or a fresh link is worth a notification
  if tg_op = 'UPDATE'
    and old.status is not distinct from new.status
    and old.user_id is not distinct from new.user_id then
    return new;
  end if;

  select id
  into v_type_id
  from public.notification_types
  where key = 'subscription_status_changed'
    and is_active = true
  limit 1;

  if v_type_id is null then
    return new;
  end if;

  -- respect an explicit opt-out (default: enabled)
  if exists (
    select 1
    from public.user_notification_preferences
    where user_id = new.user_id
      and notification_type_id = v_type_id
      and (
        is_enabled = false
        or (is_muted and (muted_until is null or muted_until > now()))
      )
  ) then
    return new;
  end if;

  v_template := case new.status
    when 'authorized' then 'subscription_authorized'
    when 'pending' then 'subscription_pending'
    when 'paused' then 'subscription_paused'
    when 'pending_cancellation' then 'subscription_pending_cancellation'
    when 'cancelled' then 'subscription_cancelled'
    else 'subscription_status_changed'
  end;

  v_importance := case
    when new.status in ('paused', 'cancelled') then 'high'
    else 'normal'
  end;

  -- insert the notification — this cascades to the push trigger
  insert into public.notifications (
    user_id,
    notification_type_id,
    title_i18n_key,
    body_i18n_key,
    i18n_params,
    metadata,
    action_path,
    icon_key,
    importance,
    dedupe_key
  ) values (
    new.user_id,
    v_type_id,
    'notifications.templates.' || v_template || '.title',
    'notifications.templates.' || v_template || '.body',
    jsonb_build_object(
      'plan',   coalesce(new.reason, ''),
      'status', new.status
    ),
    jsonb_build_object(
      'subscriptionId',         new.id,
      'provider',               new.provider,
      'providerSubscriptionId', new.provider_subscription_id,
      'previousStatus',         case when tg_op = 'UPDATE' then old.status end,
      'status',                 new.status
    ),
    '/account/billing',
    'credit-card',
    v_importance::public.notification_importance,
    'subscription-' || new.id || '-' || new.status
  );

  return new;
exception
  when others then
    -- never block the subscription write
    raise log 'notify_subscription_status_change: error for subscription % user %: %',
      new.id, new.user_id, sqlerrm;
    return new;
end;
$$;

comment on function payments.notify_subscription_status_change() is
  'Trigger: inserts a subscription_status_changed notification when a linked '
  'subscription changes status or is first linked to a user.';

-- ── 3. Attach trigger ─────────────────────────────────────────────────────────

create trigger on_subscription_status_change_notify
  after insert or update of status, user_id
  on payments.subscriptions
  for each row
  execute function payments.notify_subscription_status_change();

comment on trigger on_subscription_status_change_notify on payments.subscriptions is
  'Fires after a subscription insert or status/user_id update to notify the '
  'linked user of the new status.';
