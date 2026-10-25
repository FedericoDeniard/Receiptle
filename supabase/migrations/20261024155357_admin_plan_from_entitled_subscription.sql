-- migration: admin_plan_from_entitled_subscription
--
-- purpose:
--   `admin_list_users` and `admin_get_user` exposed the plan of the latest
--   subscription by `updated_at` regardless of its status. a cancelled
--   subscription therefore kept showing its plan as if it were still active,
--   and an expired row could shadow a newer active one (the expiry job bumps
--   `updated_at`).
--
--   both rpcs now prefer an entitled subscription and expose `plan_key` only
--   when the chosen row is entitled. terminal rows still drive
--   `sub_status` / `sub_updated_at` so the panel keeps showing the last
--   known status for users without a current subscription.
--
-- affected functions (replaced, same signatures):
--   payments.admin_list_users(text, int, int)
--   payments.admin_get_user(uuid)
--
-- notes:
--   - the entitled status set mirrors `payments.user_capabilities_v` and
--     `packages/frontend/src/lib/subscription-status.ts`. keep them in sync.
--   - no signature change, so no types regeneration is needed.

-- ============================================================================
-- 1. admin_list_users — paginated user list with role + current subscription
-- ============================================================================
create or replace function payments.admin_list_users(
  p_search text default null,
  p_limit  int  default 50,
  p_offset int  default 0
)
returns table (
  user_id        uuid,
  email          text,
  name           text,
  created_at     timestamptz,
  role           public.app_role,
  active_plan_key text,
  sub_status     text,
  sub_updated_at timestamptz
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
      u.id,
      u.email::text,
      u.name::text,
      u.created_at,
      ur.role,
      p.plan_key,
      s.status,
      s.updated_at
    from public.users u
    left join public.user_roles ur on ur.user_id = u.id
    left join lateral (
      select s2.status, s2.updated_at, s2.plan_id
        from payments.subscriptions s2
       where s2.user_id = u.id
       order by
         -- an entitled row is always "the" current subscription; terminal
         -- rows go last so an expired cancellation never shadows a newer
         -- active subscription.
         case
           when s2.status in ('authorized', 'pending', 'paused', 'pending_cancellation')
             then 0
           else 1
         end,
         s2.updated_at desc
       limit 1
    ) s on true
    left join payments.plans p
      on p.id = s.plan_id
     and s.status in ('authorized', 'pending', 'paused', 'pending_cancellation')
   where p_search is null
      or u.email ilike '%' || p_search || '%'
      or u.name  ilike '%' || p_search || '%'
   order by u.created_at desc
   limit p_limit
  offset p_offset;
end;
$$;

comment on function payments.admin_list_users(text, int, int) is
  'admin: paginated list of users joined with their role and their current subscription (entitled rows first; plan_key only when entitled). guard: caller must have role=admin in public.user_roles; otherwise 42501.';

grant execute on function payments.admin_list_users(text, int, int) to authenticated;

-- ============================================================================
-- 2. admin_get_user — single user detail
-- ============================================================================
create or replace function payments.admin_get_user(p_user_id uuid)
returns table (
  user_id        uuid,
  email          text,
  name           text,
  created_at     timestamptz,
  role           public.app_role,
  active_plan_key text,
  sub_status     text,
  sub_updated_at timestamptz,
  has_gmail      boolean
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
      u.id,
      u.email::text,
      u.name::text,
      u.created_at,
      ur.role,
      p.plan_key,
      s.status,
      s.updated_at,
      exists(select 1 from public.user_oauth_tokens t
              where t.user_id = u.id and t.is_active = true)
    from public.users u
    left join public.user_roles ur on ur.user_id = u.id
    left join lateral (
      select s2.status, s2.updated_at, s2.plan_id
        from payments.subscriptions s2
       where s2.user_id = u.id
       order by
         -- an entitled row is always "the" current subscription; terminal
         -- rows go last so an expired cancellation never shadows a newer
         -- active subscription.
         case
           when s2.status in ('authorized', 'pending', 'paused', 'pending_cancellation')
             then 0
           else 1
         end,
         s2.updated_at desc
       limit 1
    ) s on true
    left join payments.plans p
      on p.id = s.plan_id
     and s.status in ('authorized', 'pending', 'paused', 'pending_cancellation')
   where u.id = p_user_id;
end;
$$;

comment on function payments.admin_get_user(uuid) is
  'admin: single user row with role, current subscription (entitled rows first; plan_key only when entitled) and gmail-connected flag. guard: caller must have role=admin.';

grant execute on function payments.admin_get_user(uuid) to authenticated;
