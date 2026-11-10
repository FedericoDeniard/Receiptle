# Bug Verification: Validate Migrations workflow fails on Supabase CLI v3 config incompatibility

- **Slug**: validate-migrations-cli-v3
- **Tested**: 2026-11-09T22:47:32-03:00
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

The config-load failure is gone: the repo's `supabase/config.toml` loads under CLI 3.0.0 and `supabase status` no longer returns `StatusConfigLoadError`; restoring `[inbucket]` in a scratch copy reproduces the exact CI error. The workflow is still not green, though: `SUPABASE_DB_PASSWORD` does not exist in the repository secrets, so `supabase db push --dry-run --remote --yes` still fails with `403` on the `cli/login-role` endpoint. The fix is also uncommitted, so no CI run has exercised it.

## Checks Performed

| Check                   | Command / Action                                                            | Result  | Notes                                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Reproduction (post-fix) | `supabase status` in repo, CLI 3.0.0                                        | pass    | No `StatusConfigLoadError`; only `auth.*.enable_signup` deprecation warnings plus `StatusDbInspectError` (no local stack running).          |
| Reproduction (control)  | Scratch copy with `[local_smtp]`→`[inbucket]`, `supabase status`            | pass    | Negative control reproduces the exact CI failure: `StatusConfigLoadError: [inbucket] ... no longer supported`.                              |
| New / updated tests     | Workflow guard: `grep -qE '^[[:space:]]*\[inbucket\]' supabase/config.toml` | pass    | `GUARD PASS` on the fixed config, `GUARD FAIL (expected)` on the scratch copy with `[inbucket]`.                                            |
| Workflow end-to-end     | `gh run list --workflow=validate-migrations.yml`; `workflow_dispatch`       | not-run | Changes are uncommitted on `staging`; the last run (42736895580) predates the fix. No CI execution of the new workflow exists.              |
| Credential path         | `supabase db push --dry-run --remote --yes`                                 | fail    | `DbConfigLoginRoleStatusError` / `403`. `gh secret list` shows no `SUPABASE_DB_PASSWORD` secret.                                            |
| Password escape hatch   | Same command with `SUPABASE_DB_PASSWORD=invalid-probe-password`             | pass    | Bypasses the login-role endpoint and reaches Postgres, failing on auth as expected — confirms the wiring is correct once the secret exists. |
| Command contract        | Both workflow command lines executed by CLI 3.0.0                           | pass    | `--remote --yes` accepted; the dry run resolved `project money-tracker (nswqfbakcbfaxuoguqhe) · production`.                                |
| Config syntax           | `python3 -c "tomllib.load(...)"`                                            | pass    | `config.toml` parses as valid TOML.                                                                                                         |
| Workflow syntax         | `js-yaml` parse of both workflow files                                      | pass    | Both parse; `jobs: validate` / `jobs: deploy` present.                                                                                      |
| Regression suite        | n/a                                                                         | skipped | No application code changed; no suite covers CI configuration.                                                                              |
| Lint / type-check       | n/a                                                                         | skipped | No JS/TS touched, so `bun run check` is not meaningful for this diff (fix.md says the same).                                                |

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

- **Nothing has run in CI.** All six files are uncommitted on `staging`. The workflow YAML parses, but GitHub Actions environment behavior (secret injection, `setup-cli` pin resolution) is unverified.
- **The primary impact remains.** `SUPABASE_DB_PASSWORD` is absent, so `Deploy to Production` still fails before applying migrations. Anything merged since the CLI v3 release is still not live in production.
- **Version gap.** Verification used CLI 3.0.0 (host install); the workflows pin 3.1.0. The `[local_smtp]` handling is the same, but the `--remote`/login-role behavior was not re-tested on 3.1.0.
- **Guard coverage is narrow.** The guard step only detects `[inbucket]`; any other config key removed in a future CLI release still fails at runtime.
- **Local dev container not rebuilt.** `Dockerfile.supabase-cli` was only statically verified (`npm install supabase@3.1.0`). No stack was running (`docker compose ps` empty), so `supabase start` / `docker:db:reset` were not exercised.
- **No dry run protects the deploy step.** `--yes` makes `db push` non-interactive, so a bad migration applies immediately. Correct for v3, but worth knowing.
- `package.json` still carries `--local` flags deprecated in v3 (documented follow-up, out of scope).

## Recommendation

Hold. The config rename and the v3 `--remote --yes` targeting change are verified and should be kept, but the workflow still fails end-to-end for a credentials reason, and no green CI run exists. Create the `SUPABASE_DB_PASSWORD` repository secret (the `postgres` password of `nswqfbakcbfaxuoguqhe`), commit and push the six modified files, run `Validate Migrations` via `workflow_dispatch`, then re-run this verification. Follow with a `Deploy to Production` run — clearing the production migration backlog is the impact that matters. Do not close the bug until that run is green.
