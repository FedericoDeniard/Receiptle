#!/usr/bin/env bash
# Copies the primary checkout's env files into the current worktree as
# `.env.local` files, so a fresh worktree is runnable without duplicating
# secrets by hand:
#
#   packages/frontend/.env      -> packages/frontend/.env.local
#   packages/mastra-server/.env -> packages/mastra-server/.env.local
#   supabase/functions/.env     -> supabase/functions/.env.local
#
# Why .env.local: Bun auto-loads it with precedence over .env, and
# packages/mastra-server/src/env-loader.ts reads .env then .env.local.
# Edge Functions don't auto-load .env.local, pass it explicitly:
#   supabase functions serve --env-file supabase/functions/.env.local
#
# Usage: scripts/sync-env-from-main.sh [--force] [--dry-run] [relative/.env ...]

set -euo pipefail

force=0
dry_run=0
extra_paths=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -f | --force) force=1 ;;
    -n | --dry-run) dry_run=1 ;;
    -h | --help)
      cat <<'USAGE'
Usage: scripts/sync-env-from-main.sh [options] [relative/path/.env ...]

Copies env files from the repository's primary checkout into the current
worktree as `<dir>/.env.local`. Extra paths are copied the same way.

Options:
  -f, --force    overwrite existing .env.local files
  -n, --dry-run  print what would happen without writing
  -h, --help     show this help
USAGE
      exit 0
      ;;
    -*)
      printf 'error: unknown flag %s\n' "$1" >&2
      exit 2
      ;;
    *) extra_paths+=("$1") ;;
  esac
  shift
done

if ! checkout_root="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  printf 'error: not inside a git worktree\n' >&2
  exit 1
fi

common_dir="$(git rev-parse --path-format=absolute --git-common-dir)"
primary_root="$(dirname "$common_dir")"

if [[ "$checkout_root" == "$primary_root" ]]; then
  printf 'Already in the primary checkout (%s); nothing to sync.\n' "$primary_root"
  exit 0
fi

env_paths=(
  packages/frontend/.env
  packages/mastra-server/.env
  supabase/functions/.env
)
env_paths+=("${extra_paths[@]+"${extra_paths[@]}"}")

copied=0
skipped=0
missing=0

for rel in "${env_paths[@]}"; do
  src="$primary_root/$rel"
  rel_dest="$(dirname "$rel")/.env.local"
  dest="$checkout_root/$rel_dest"

  if [[ ! -f "$src" ]]; then
    printf 'warn: %s missing in %s, skipping\n' "$rel" "$primary_root" >&2
    missing=$((missing + 1))
    continue
  fi

  if [[ -d "$dest" ]]; then
    printf 'error: %s is a directory, refusing to replace it\n' "$rel_dest" >&2
    missing=$((missing + 1))
    continue
  fi

  if [[ -e "$dest" && "$force" -eq 0 ]]; then
    printf 'skip: %s already exists (use --force to overwrite)\n' "$rel_dest"
    skipped=$((skipped + 1))
    continue
  fi

  if [[ "$dry_run" -eq 1 ]]; then
    printf 'would copy: %s -> %s\n' "$rel" "$rel_dest"
    copied=$((copied + 1))
    continue
  fi

  mkdir -p "$(dirname "$dest")"
  cp -- "$src" "$dest"
  chmod 600 "$dest"
  printf 'copied: %s -> %s\n' "$rel" "$rel_dest"
  copied=$((copied + 1))
done

if [[ "$dry_run" -eq 1 ]]; then
  printf '\n%s would be copied, %s skipped, %s missing (primary checkout: %s)\n' \
    "$copied" "$skipped" "$missing" "$primary_root"
else
  printf '\n%s copied, %s skipped, %s missing (primary checkout: %s)\n' \
    "$copied" "$skipped" "$missing" "$primary_root"
fi

if [[ "$copied" -gt 0 && "$dry_run" -eq 0 ]]; then
  printf 'Restart dev processes (bun dev) so they load the new files.\n'
fi
