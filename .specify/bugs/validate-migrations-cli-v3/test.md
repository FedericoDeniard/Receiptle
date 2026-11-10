# Bug Verification: Validate Migrations workflow fails on Supabase CLI v3 config incompatibility

- **Slug**: validate-migrations-cli-v3
- **Tested**: 2026-11-09T22:50:52-03:00
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: pass

## Summary

The config-load failure is gone and the fix is now exercised end to end in CI: run [42738450575](https://github.com/FedericoDeniard/Receiptle/actions/runs/42738450575) on commit `ce1166b` (PR #219) is green, including `Validar migraciones (dry-run)`. The earlier local `403` on the Management API `cli/login-role` endpoint was a local access-token privilege issue, not a missing secret: in CI, with `SUPABASE_DB_PASSWORD` empty, the CLI initialised the login role with `SUPABASE_ACCESS_TOKEN` and reported `Remote database is up to date`.

## Checks Performed

| Check                   | Command / Action                                                            | Result  | Notes                                                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Reproduction (post-fix) | `supabase status` in repo, CLI 3.0.0                                        | pass    | No `StatusConfigLoadError`; only `auth.*.enable_signup` deprecation warnings plus `StatusDbInspectError` (no local stack running).              |
| Reproduction (control)  | Scratch copy with `[local_smtp]`→`[inbucket]`, `supabase status`            | pass    | Negative control reproduces the exact CI failure: `StatusConfigLoadError: [inbucket] ... no longer supported`.                                  |
| New / updated tests     | Workflow guard: `grep -qE '^[[:space:]]*\[inbucket\]' supabase/config.toml` | pass    | `GUARD PASS` on the fixed config, `GUARD FAIL (expected)` on the scratch copy with `[inbucket]`.                                                |
| Workflow end-to-end     | `gh run list --workflow=validate-migrations.yml`; run 42738450575           | pass    | Green on commit `ce1166b` (PR #219); `Validar migraciones (dry-run)` completed with `Remote database is up to date`.                            |
| Credential path         | `supabase db push --dry-run --remote --yes`                                 | pass    | Local `403` on `cli/login-role` was token scope. In CI the same command succeeds with `SUPABASE_ACCESS_TOKEN` and empty `SUPABASE_DB_PASSWORD`. |
| Password escape hatch   | Same command with `SUPABASE_DB_PASSWORD=invalid-probe-password`             | pass    | Bypasses the login-role endpoint and reaches Postgres, failing on auth as expected — confirms the wiring is correct once the secret exists.     |
| Command contract        | Both workflow command lines executed by CLI 3.0.0                           | pass    | `--remote --yes` accepted; the dry run resolved `project money-tracker (nswqfbakcbfaxuoguqhe) · production`.                                    |
| Config syntax           | `python3 -c "tomllib.load(...)"`                                            | pass    | `config.toml` parses as valid TOML.                                                                                                             |
| Workflow syntax         | `js-yaml` parse of both workflow files                                      | pass    | Both parse; `jobs: validate` / `jobs: deploy` present.                                                                                          |
| Regression suite        | n/a                                                                         | skipped | No application code changed; no suite covers CI configuration.                                                                                  |
| Lint / type-check       | n/a                                                                         | skipped | No JS/TS touched, so `bun run check` is not meaningful for this diff (fix.md says the same).                                                    |

## Output Excerpts

Fixed config (`supabase status`, repo):

```
WARN: auth.email.enable_signup is deprecated and will be removed in v4, use auth.email.enabled instead.
{"linked_project":{...},"_tag":"Error","error":{"code":"StatusDbInspectError",
 "message":"failed to inspect container health: ... No such container: supabase_db_receiptle"}}
```

Negative control (scratch copy with `[inbucket]`):

```
{"linked_project":null,"_tag":"Error","error":{"code":"StatusConfigLoadError",
 "message":"[inbucket] in supabase/config.toml is no longer supported. Use [local_smtp] instead."}}
```

`supabase db push --dry-run --remote --yes`:

```
Target: project money-tracker (nswqfbakcbfaxuoguqhe) · production
Initialising login role...
{"target":{...,"environment":"production"},"_tag":"Error","error":{"code":"DbConfigLoginRoleStatusError",
 "message":"unexpected login role status 403: {\"message\":\"Your account does not have the necessary privileges to access this endpoint...\"}"}}
```

With a (deliberately invalid) password set:

```
DRY RUN: migrations will *not* be pushed to the database.
{"_tag":"Error","error":{"code":"DbConnectError","message":"failed to connect to postgres: ... FATAL: password authentication failed for user \"postgres\""}}
```

`gh secret list -R FedericoDeniard/Receiptle`:

```
SUPABASE_ACCESS_TOKEN	2026-01-18T13:55:38Z
SUPABASE_PROJECT_ID	2026-01-18T13:53:54Z
```

## Residual Risks

- **Deploy to Production not re-run yet.** The validate workflow is green, but `Deploy to Production` has not run since the fix; it will execute on the next push to `main` (merging PR #219).
- **Version gap.** Local verification used CLI 3.0.0; CI ran the pinned 3.1.0, so the `[local_smtp]` and `--remote` behavior is confirmed on the pinned version.
- **Guard coverage is narrow.** The guard step only detects `[inbucket]`; any other config key removed in a future CLI release still fails at runtime.
- **Local dev container not rebuilt.** `Dockerfile.supabase-cli` was only statically verified (`npm install supabase@3.1.0`). No stack was running (`docker compose ps` empty), so `supabase start` / `docker:db:reset` were not exercised.
- **No dry run protects the deploy step.** `--yes` makes `db push` non-interactive, so a bad migration applies immediately. Correct for v3, but worth knowing.
- `package.json` still carries `--local` flags deprecated in v3 (documented follow-up, out of scope).

## Recommendation

Close the bug once `Deploy to Production` runs green on the next `main` push. The validate workflow already passes end to end; no `SUPABASE_DB_PASSWORD` secret is needed because the CI token can initialise the login role.
