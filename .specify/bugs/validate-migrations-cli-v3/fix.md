# Bug Fix: Validate Migrations workflow fails on Supabase CLI v3 config incompatibility

- **Slug**: validate-migrations-cli-v3
- **Fixed**: 2026-11-09
- **Assessment**: ./assessment.md
- **Status**: partial

## Summary

Renamed the removed `[inbucket]` config section to `[local_smtp]` so the Supabase CLI v3 can load `supabase/config.toml`, and moved both workflows to the v3 `db push` contract (`--remote --yes`) with the CLI pinned to `3.1.0`. Local verification confirmed the config fix and the targeting fix, but surfaced one blocker the assessment had only flagged as an open question: `--remote` without a database password POSTs to the Management API `cli/login-role` endpoint and returns `403`, so the workflows stay red until a `SUPABASE_DB_PASSWORD` repository secret exists.

## Changes

| File                                        | Change   | Notes                                                                                                                                                             |
| ------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/config.toml`                      | modified | `[inbucket]` → `[local_smtp]`; inner keys untouched.                                                                                                              |
| `.github/workflows/validate-migrations.yml` | modified | CLI pinned to `3.1.0`, added `workflow_dispatch`, added v3 config guard step, `db push --dry-run` → `--dry-run --remote --yes`, added `SUPABASE_DB_PASSWORD` env. |
| `.github/workflows/deploy-production.yml`   | modified | CLI pinned to `3.1.0`, `db push --include-all` → `--include-all --remote --yes`, added `SUPABASE_DB_PASSWORD` env.                                                |
| `Dockerfile.supabase-cli`                   | modified | `npm install supabase` → `npm install supabase@3.1.0`.                                                                                                            |
| `AGENTS.md`                                 | modified | Production deploy section documents the v3 commands, the `--remote` requirement and the pin.                                                                      |
| `.specify/memory/constitution.md`           | modified | Production bullet updated to the v3 command form and the pin.                                                                                                     |

## Diff Highlights

Config rename — the only required config edit, since the keys inside the section did not change:

```diff
-[inbucket]
+[local_smtp]
 enabled = true
```

Validation workflow — pin, guard, and v3 target:

```diff
+  workflow_dispatch:
...
-          version: latest
+          version: "3.1.0"
+
+      - name: Verificar config.toml compatible con CLI v3
+        run: |
+          if grep -qE '^[[:space:]]*\[inbucket\]' supabase/config.toml; then
+            echo "::error file=supabase/config.toml::La sección [inbucket] fue eliminada en Supabase CLI v3. Renombrala a [local_smtp]."
+            exit 1
+          fi
...
-        run: supabase db push --dry-run
+        run: supabase db push --dry-run --remote --yes
```

Production deploy — prevents `db push` from silently targeting the local stack:

```diff
-        run: supabase db push --include-all
+        run: supabase db push --include-all --remote --yes
         env:
           SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
+          SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}
```

## Tests Added or Updated

This bug has no unit-test surface; the verification is the workflow itself. Added a guard step instead of a test file:

- `.github/workflows/validate-migrations.yml` → `Verificar config.toml compatible con CLI v3` — fails fast with a file-annotated message if `[inbucket]` reappears or an old branch reintroduces it.
- `workflow_dispatch` added to the same workflow so the fix can be exercised from the Actions tab without opening a throwaway PR.

## Local Verification

- `supabase status` on the repo before the change → `StatusConfigLoadError: [inbucket] in supabase/config.toml is no longer supported. Use [local_smtp] instead.` (reproduces the CI failure exactly).
- `supabase status` after the rename → config loads; only unrelated `auth.email.enable_signup` / `auth.sms.enable_signup` deprecation warnings remain (deprecated, removed in v4, not fatal in v3).
- `supabase db push --help` (CLI 3.0.0) → confirms `TARGET: Local by default. Pass --remote for the linked project`, and that `--yes` is accepted as a global flag. Both workflow command lines were parsed successfully by the CLI.
- `supabase db push --dry-run --remote --yes` → `Target: project money-tracker (nswqfbakcbfaxuoguqhe) · production` then `DbConfigLoginRoleStatusError` / `403` on `POST https://api.supabase.com/v1/projects/<ref>/cli/login-role`. **Blocking**, see Deviations.
- `SUPABASE_DB_PASSWORD="invalid-probe-password" supabase db push --dry-run --remote --yes` → the CLI skips the login-role endpoint entirely and goes straight to Postgres (`DbConnectError`, `password authentication failed`, suggestion: `SUPABASE_DB_PASSWORD`). Confirms the password path is the correct escape hatch.
- `SUPABASE_DB_PASSWORD=""` with the same command → falls back to the login-role endpoint, i.e. an unset secret reproduces today's failure and does not regress anything.
- Guard step logic exercised against both the fixed config (`guard passes`) and a copy with `[inbucket]` (`GUARD FAIL (expected)`).
- Rejected guard candidates, tested empirically: `supabase status > /dev/null` exits `1` even with a valid config when no local stack is running, and `supabase services` exits `0` even with a broken config, so neither can gate the workflow.
- No JavaScript/TypeScript changed, so `bun run check` and the test suites were not run.

## Deviations from Assessment

1. **The guard step proposed in the assessment does not work.** `supabase status > /dev/null` (suggested as "config-only for the local stack") exits `1` with a valid config whenever no local stack is running, which is always the case in a CI runner; `supabase services` was also tried and exits `0` even when the config fails to load. Replaced with a static check for the `[inbucket]` section, which is deterministic and pins the exact regression this bug introduced.
2. **`--remote --yes` alone is not sufficient — this answers Open Question 1.** The assessment asked whether `SUPABASE_ACCESS_TOKEN` has the scope required by v3 `db push --remote` without `--password`. Verification with the locally stored access token says no: the CLI prints `No database password found; using a temporary login role...` and `POST /v1/projects/<ref>/cli/login-role` returns `403`. The failure is identical for `db push` and for `migration list --remote`, so the assessment's "drop dry-run for `migration list --remote`" alternative does not sidestep it either. Because the 403 is an account/endpoint privilege rather than a token scope, the workflows were wired to `SUPABASE_DB_PASSWORD`, which the CLI reads automatically and which bypasses the endpoint. The CI secret itself could not be exercised from here, so this remains unverified end-to-end.
3. **`deploy-production.yml` was confirmed broken before the change, not just at risk.** In v3 `db push` without `--remote` targets the local stack, so the previous `supabase db push --include-all` would have failed in the runner (no local stack) and, if one ever existed, would have reported success without touching production. The `--remote` addition is therefore the security-relevant half of this fix, not cosmetic.

No re-run of `/speckit.bug.assess` is needed: the root cause, the config rename and the v3 targeting change are all confirmed. Only the credential half needs a repo-level action.

## Follow-ups

- **Create the `SUPABASE_DB_PASSWORD` repository secret** (the `postgres` password of project `nswqfbakcbfaxuoguqhe`) and re-run `Validate Migrations` via `workflow_dispatch`. Until then the workflow fails at `cli/login-role` with `403` and the status here stays `partial`. Alternatively grant the CI account the privilege the login-role endpoint requires, but the password path is simpler and is what v3 documents.
- **Re-run `Deploy to Production`** via `workflow_dispatch` after the secret exists, and confirm migrations actually apply. This is the impact that matters: production deploys have been failing since the CLI v3 release, so anything merged in the last week is not live.
- **Decide whether `Validate Migrations` should be a required status check.** `main` has no branch protection today, so the red check does not block merges. This is Open Question 2 from the assessment and is still unanswered.
- **Remove the now-redundant `--local` flags** in `package.json` (`docker:db:reset`, `docker:db:migration:up`, `docker:db:types`). v3 treats local as the default and warns that `--local` is removed in v4; out of scope here, as the assessment noted.
- Consider a scheduled check that compares the pinned CLI against the latest release, so the next major is a deliberate upgrade rather than an outage.
