-- Restrict OAuth token access to trusted server code.
--
-- Problem: decrypt_secret was executable by PUBLIC/anon/authenticated, and
-- authenticated could SELECT the encrypted token columns and write token rows.
-- A stolen user JWT (for example via XSS) could therefore read its own
-- ciphertext, call decrypt_secret and obtain the long-lived Google refresh
-- token. The frontend only needs token metadata, never ciphertext or writes.

revoke execute on function public.encrypt_secret(text) from public, anon, authenticated;
revoke execute on function public.decrypt_secret(bytea) from public, anon, authenticated;
revoke execute on function public.encrypt_text(text, text) from public, anon, authenticated;
revoke execute on function public.decrypt_text(bytea, text) from public, anon, authenticated;

grant execute on function public.encrypt_secret(text) to service_role;
grant execute on function public.decrypt_secret(bytea) to service_role;
grant execute on function public.encrypt_text(text, text) to service_role;
grant execute on function public.decrypt_text(bytea, text) to service_role;

-- Users may read token metadata, but not the encrypted access/refresh tokens.
-- They also may not write token rows: Edge Functions own token lifecycle via
-- service_role. The existing "Block user * to tokens" policies stay in place;
-- with DML revoked they are no longer reachable.
revoke select, insert, update, delete on table public.user_oauth_tokens from anon, authenticated;

grant select (
  id,
  user_id,
  token_type,
  expires_at,
  scope,
  gmail_email,
  created_at,
  updated_at,
  is_active,
  last_refresh_at,
  last_refresh_error
) on table public.user_oauth_tokens to authenticated;
