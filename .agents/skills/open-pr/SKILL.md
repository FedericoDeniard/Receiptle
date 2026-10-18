---
name: open-pr
description: Open, create, or submit a pull request (PR) via GitHub CLI (gh) — never the web UI. Trigger on any request to open/create/submit/make a PR/pull request, "mandalo a review", "abrí un PR", "subí esto como PR", or when the user says the branch/work is ready and expects it pushed for review.
allowed-tools: Bash(gh pr create *) Bash(gh pr view *) Bash(gh pr edit *) Bash(git push *) Bash(git status *) Bash(git log *) Bash(git diff *)
---

# Open a pull request

Create PRs using GitHub CLI (`gh`), never the web UI.

## Base branch

Target `staging` by default. Only target another branch (e.g. `main`) if the user explicitly says so.

## Draft mode

Always open as a draft PR (`--draft`), unless the user explicitly asks for a ready-for-review PR.

## PR template

Look for a PR template, in this order:

1. `.github/pull_request_template.md`
2. `docs/pull_request_template.md`
3. `pull_request_template.md` (repo root)
4. `.github/PULL_REQUEST_TEMPLATE/*.md` (if multiple, ask the user which to use)

If found, fill in each section based on the actual diff and commits — don't leave placeholder comments in the body.

If no template exists, invoke the `commit` skill and follow its Conventional Commits format for the PR title and body.

## Linear Issue section

Branch names usually match the Linear issue identifier (e.g. `feat/COU-86-description`). Extract the identifier from the branch name, then use the Linear MCP (`get_issue`) to fetch that issue's URL and fill the section as a markdown hyperlink: `[COU-86](<url>)`.

If the Linear MCP is unavailable or the lookup fails, fall back to plain text (just the identifier, e.g. `COU-86`) as before.

## Steps

1. Check `git status` and `git log` to confirm the branch is pushed and up to date. Push if needed.
2. Look for a PR template (see above) and build the body accordingly.
3. Resolve the Linear Issue section per above.
4. Run:
   ```bash
   gh pr create --draft --base staging --title "<title>" --body "<body>"
   ```
5. Return the PR URL.
6. Ask the user (`AskUserQuestion`) whether they want to attach screenshots or a demo
   video to the PR. If yes, use the `pr-image-upload` skill for screenshots or the
   `pr-demo-video` skill for a recorded browser demo — both attach via `gh pr edit
   --attach`, which renders inline in the PR body.

## Notes

- Never force-push or rewrite history to open a PR.
- If `staging` doesn't exist in this repo, ask the user which branch to target instead.
