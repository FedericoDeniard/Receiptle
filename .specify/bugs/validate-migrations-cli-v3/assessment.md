# Bug Assessment: Validate Migrations workflow fails on Supabase CLI v3 config incompatibility

- **Slug**: validate-migrations-cli-v3
- **Created**: 2026-11-09
- **Source**: pasted text — "Revisá porque falla el validate-migrations en las github actions"
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

User report: the `validate-migrations` GitHub Actions workflow is failing.

Actual failing run: [run 42736895580](https://github.com/FedericoDeniard/Receiptle/actions/runs/42736895580) — PR #219 (`staging` → `main`), 2026-11-10T01:36:32Z, conclusion `failure`, duration 19s.

Last successful run of the same workflow: run 40229517357, 2026-10-25T20:10:31Z. Every run in between is older than the failure; the regression window is 2026-10-25 → 2026-11-10.

Verbatim log from the failing step `Validar migraciones (dry-run)`:

```
[inbucket] in supabase/config.toml is no longer supported. Use [local_smtp] instead.
Try rerunning the command with --debug to troubleshoot the error.
##[error]Process completed with exit code 1.
```

The preceding step (`supabase link --project-ref $PROJECT_ID`) succeeded, so credentials and connectivity are fine — only the config parse fails.

## Symptom

`supabase db push --dry-run` in the `Validate Migrations` workflow exits 1 before doing any work, because the Supabase CLI refuses to load `supabase/config.toml` while it still contains the `[inbucket]` section. Expected: the workflow prints the pending migrations and exits 0 (or reports a real migration problem).

The same failure will hit `Deploy to Production` on the next push to `main`, because `deploy-production.yml` runs `supabase db push --include-all` against the same config file. The last deploy run (40229561827, 2026-10-25) still succeeded because it predates the CLI release.

## Reproduction

1. Keep `[inbucket]` at `supabase/config.toml:100`.
2. Install Supabase CLI ≥ 3.0.0 (`supabase/setup-cli@v1` with `version: latest`, or `npm install supabase`).
3. Run `supabase db push --dry-run` (or `supabase status`, or `supabase start`).

Observed on this machine with CLI 3.0.0, pointing at a copy of the repo config:

```
$ supabase status
{"linked_project":{...},"_tag":"Error","error":{"code":"StatusConfigLoadError",
 "message":"[inbucket] in supabase/config.toml is no longer supported. Use [local_smtp] instead."}}
```

After `sed -i 's/^\[inbucket\]/[local_smtp]/'`, the same command loads the config successfully (only unrelated `auth.email.enable_signup` deprecation warnings remain), which isolates the rename as the trigger.

## Suspected Code Paths

- `supabase/config.toml:100` — `[inbucket]` section. CLI v3 hard-fails on this key: "Deprecated commands, flags, config keys, and environment variables are removed… This includes the `[inbucket]` config section, which is now `[local_smtp]`."
- `.github/workflows/validate-migrations.yml:19-20` — `uses: supabase/setup-cli@v1` with `version: latest`. This is the drift source: the workflow silently upgraded from v2.x to v3.0.0 (released 2026-11-02) without any repo change.
- `.github/workflows/validate-migrations.yml:27` — `run: supabase db push --dry-run`. Fails at config load. Even after the rename, this is wrong under v3: `db push` now targets the **local** stack by default (`--help`: "TARGET: Local by default. Pass --remote for the linked project"), so it would fail again in CI where no local stack exists.
- `.github/workflows/deploy-production.yml:18-30` — same `version: latest`, and `supabase db push --include-all` with no `--remote`/`--yes`. Under v3 this is a silent no-op against production at best (it targets local) and a `HostedMutationConsentRequiredError` at worst.
- `Dockerfile.supabase-cli:6` — `npm install supabase` is unpinned (resolves to 3.1.0 today), so a rebuilt dev container also gets v3 and `supabase start` fails on the same `[inbucket]` key. The currently running stack predates the rebuild, which is why local dev still works.
- `package.json:25-27` — `supabase db reset --local`, `supabase migration up --local`, `supabase gen types --local`. Verified against v3.1: `--local` still works but prints `Warning: --local isn't needed (local is the default) and will be removed in v4`. Not broken today, but on the deprecation path.

## Root Cause Hypothesis

**Confidence: high.** The workflow installs the Supabase CLI at `latest`, and Supabase shipped v3.0.0 on 2026-11-02, which removed the `[inbucket]` config section (renamed `[local_smtp]` in v2.108.0, removed in v3). v3 validates `config.toml` strictly and aborts any command that loads it, so `supabase db push --dry-run` dies at startup with `[inbucket] ... is no longer supported`. Nothing in the repo changed to cause this; it is a pure external version drift amplified by the unpinned `version: latest`, and Supabase's own migration guide calls out precisely this failure mode: "A pipeline that installs the latest CLI without pinning a version already runs v3."

## Proposed Remediation

**Preferred**: Fix the config key and move the workflows to the v3 command contract in one change.

1. Rename the section in `supabase/config.toml`: `[inbucket]` → `[local_smtp]`. The keys inside are unchanged (`enabled`, `port`, and the commented `smtp_port`/`pop3_port`/`admin_email`/`sender_name`), so this stays compatible with CLI ≥ 2.108.0 and is the only config edit required.
2. Update `validate-migrations.yml` to `supabase db push --dry-run --remote` (add `--yes` as well for future-proofing; hosted mutations in v3 require it in CI and it is harmless on a dry run).
3. Update `deploy-production.yml` to `supabase db push --include-all --remote --yes`. Without `--remote`, v3 targets the local stack and the deploy step becomes a silent no-op — that is the dangerous half of this bug.
4. Pin the CLI: `version: "3.1.0"` (or `version: v3`) in both `supabase/setup-cli` steps, and pin `npm install supabase@3.1.0` in `Dockerfile.supabase-cli`. Pinning converts future breaking releases into a deliberate upgrade instead of an outage.
5. Add `workflow_dispatch:` to `validate-migrations.yml` so the fix can be verified on this branch without opening a throwaway PR.
6. Update the documented commands in `AGENTS.md:220` (and the mention at `.specify/memory/constitution.md:144`) so they match the v3 form and nobody copies the broken invocation.

**Alternatives**:

- **Pin to the last v2 (`version: "2.122.0"`)** and leave `[inbucket]` plus the command lines alone. Smallest diff, unblocks CI today, but kicks the migration down the road: v2 is the previous major and the `[inbucket]` key is already removed in v3. Only reasonable as a stopgap if the v3 consent/`--remote` semantics need verification first.
- **Drop `db push --dry-run` in favour of `supabase migration list --remote`** — read-only, no consent flag needed, and arguably a better "validate" signal (it shows divergence instead of what would be applied). Loses the "would this migration apply cleanly" check.

**Files likely to change**:

- `supabase/config.toml`
- `.github/workflows/validate-migrations.yml`
- `.github/workflows/deploy-production.yml`
- `Dockerfile.supabase-cli`
- `AGENTS.md`
- `.specify/memory/constitution.md` (optional, docs consistency)

**Tests to add or update**:

- Re-run `Validate Migrations` on this branch (via `workflow_dispatch`) and confirm it exits 0 and prints `Remote database is up to date.`
- Before merging, run `supabase db push --dry-run --remote` locally to confirm the `SUPABASE_ACCESS_TOKEN` in CI carries the `database_write` scope that v3 requires for `--remote` without `--password`.
- Add a guard step to the workflow that fails fast with a readable message if `supabase/config.toml` cannot be loaded, e.g. `supabase status > /dev/null` (config-only for the local stack) or `supabase migration list --remote > /dev/null`.
- No unit-test surface applies; this is CI configuration.

## Risks & Considerations

- **Production deploy is already broken, not just validation.** `deploy-production.yml` will fail with the same config error on the next push to `main`. Any hotfix merged right now does not reach production. Treat this as the primary impact, not the red PR check.
- **Silent no-op risk if only `[inbucket]` is renamed.** `db push` without `--remote` in v3 targets the local database. In a CI runner that means "no local stack" failure; if a local stack ever existed in the job, the deploy would report success without touching production. Both `--remote` and `--yes` are mandatory.
- **`db push --remote` may need DB credentials.** v3 documents that a scoped access token with `database_write` may be required when `--password` is absent. `supabase link` succeeding does not prove that scope. Verify on the dry run before trusting the deploy workflow.
- **Local dev breakage is deferred, not absent.** `Dockerfile.supabase-cli` installs `latest`; the next clean rebuild pulls a v3 CLI and `supabase start` (and therefore `docker:db:reset`, `docker:db:migration:up`, `docker:db:types`) fails on `[inbucket]`. Fixing the config key now prevents a confusing "works on my machine until you rebuild" incident.
- **Mutable `latest` tags in CI are the underlying defect.** Pinning the CLI is the durable part of the fix; the config rename alone leaves the same trap for the next major.
- **`--local` flags in `package.json` are deprecated in v3 and removed in v4.** Out of scope for this bug, but worth a follow-up ticket.
- No data risk: nothing in this fix touches migrations or the schema. `--dry-run` and `--remote` are read-only for validation.

## Open Questions

- [NEEDS CLARIFICATION: does the `SUPABASE_ACCESS_TOKEN` secret have the `database_write` scope required by v3 `db push --remote` without `--password`? Verify with the dry run.]
- [NEEDS CLARIFICATION: is `Validate Migrations` meant to be a required status check? `main` has no branch protection today, so the red check does not technically block merges — confirm whether that is intentional.]
