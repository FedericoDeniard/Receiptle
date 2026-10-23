---
name: commit
description: Conventional Commits
---

Write a commit message with the current changes following the format below, in English. Finally use the terminal to write the commit.

# Before committing

**Always** run the `code-review` skill before writing the commit message. There is no opt-out: it applies to every commit, including small, one-line, config, skill and documentation-only changes.

1. Stage the intended files first (`git add ...`) so the review sees new files, since `git diff HEAD` ignores untracked paths.
2. Load the `code-review` skill with `HEAD` as the fixed point and the uncommitted tree as the diff: `git diff HEAD` (staged plus unstaged) and `git status --short` for the file list. Do not use its `git diff <fixed-point>...HEAD` form here, which is empty because the changes are not committed yet.
3. Spec source: the issue, ticket or request that motivated the change. If none exists, let the Spec axis report "no spec available" instead of stopping.
4. Standards sources: whatever the `code-review` skill finds in its own step 3, plus the smell baseline it defines.

Then report the findings and commit. Never commit silently over an unreported review, and never fix, expand or rerank findings on your own: they are reported, not applied, unless the user asks. If the user asks to commit without a review, run it anyway and report what it flagged before committing.

Keep the review summary in the final reply to the user. Then write the commit message.

# Conventional Commits

Follow the [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) standard to create consistent and readable commit messages.

## Format

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

## Main Types

- `feat`: A new feature or functionality
- `fix`: A bug fix
- `docs`: Documentation changes
- `style`: Formatting changes (whitespace, semicolons, etc.) without affecting code behavior
- `refactor`: Code refactoring without changing functionality
- `perf`: Performance improvements
- `test`: Adding or correcting tests
- `build`: Changes to the build system or dependencies
- `ci`: Changes to CI/CD configuration
- `chore`: General maintenance tasks

## Scope (Optional)

The scope provides additional context about which part of the codebase was affected:

```
feat(auth): add login with Google
fix(api): resolve timeout issue
docs(readme): update installation steps
```

## Breaking Changes

For changes that break compatibility, use `!` or the `BREAKING CHANGE:` footer:

```
feat!: remove support for legacy API
```

Or:

```
feat: update authentication flow

BREAKING CHANGE: old auth tokens are no longer valid
```

## Examples

### Simple Example

```
feat: add user profile page
```

### With Scope

```
fix(database): resolve connection timeout
```

### With Body

```
feat: implement dark mode

Add dark mode toggle in settings panel.
Update all components to support theme switching.
```

### With Footer

```
fix: prevent memory leak in video player

Close all streams properly on component unmount.

Refs: #123
```

### Breaking Change

```
feat(api)!: change response format for user endpoints

BREAKING CHANGE: API now returns user data in snake_case instead of camelCase
```

## Best Practices

1. Use the imperative mood in the description: "add" not "added" or "adds"
2. Don't capitalize the first letter of the description
3. Don't use a period at the end of the description
4. Keep the description brief (maximum 50-72 characters)
5. Use the body to explain the "what" and "why", not the "how"
6. One commit = one logical change
