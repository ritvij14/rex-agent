# Contributing to Rex

Rex is early-stage work. Read the architecture, building-in-public, and scoped-instruction placement rules in [AGENTS.md](AGENTS.md), then all applicable ancestor guides and relevant feature or infrastructure docs. Discuss a design change before implementing it. Do not post real memories, credentials, account IDs, transcripts, or personal settings.

## Local setup

Use Node.js 22 LTS, npm, Git, and system `tar` on macOS/Linux. Python is not required. Run `npm ci`, `npm run setup`, and `npm run check`. Dependencies and the scanner are pinned. `npm ci` does not run third-party lifecycle scripts; do not re-enable them globally to fix an install. Scripts/tests execute as TypeScript through pinned `tsx` and Node's built-in test runner. `npm run typecheck` checks types without emitting JavaScript and is included in `npm run check`. No build step is needed for repository tooling. Use the Git name and email you intend to make public; a noreply address is optional. Check both author and committer identities before committing. A GitHub login and an intentional public commit display name are visible by design.

## Change workflow

1. Work on `main` by default. Use branches for parallel work needing worktrees; for any other exception, explain the reason and use `ask_user_question` for the owner's verdict first. Document the expected behavior and rejected cases.
2. Write a reproduction or failing test, then the smallest implementation.
3. Run `npm run check`; update the affected feature doc and decision record.
4. Stage explicit public filenames, inspect `git diff --cached --stat`, and review the staged diff locally. Do not paste an unsafe diff into an issue or agent chat.
5. After publication approval, commit with a sanitized message and push directly to `main`. Before pushing, run `npm run release:check`. Never skip a hook to get around a privacy finding. Use the PR checklist when a branch/PR exception is approved.

A privacy failure is a reason to inspect and fix the input, not add a broad exception. Do not run raw grep/cat against credential files. Scanner failures deliberately do not print matched content. Use invented, non-working tokens and names in tests; construct secret-shaped fixtures at test runtime so they never live in public Git blobs.

## Packages and tests

New reusable code goes into a clearly scoped `packages/<name>/` workspace. Core libraries must not import Pi; adapters connect them to Pi or Pi Durable. Add exact runtime/tool versions, package exports, a typecheck, and behavior tests when the first package is implemented. Keep packages `private: true` until publication is approved. Do not create empty services, forced abstractions, or CI checks that claim to test code which does not exist yet.

Use the [testing rules](docs/infra/testing.md): behavior and rejected cases, external services replaced at the boundary, no credentials or paid calls in default tests. Review third-party code before adding it, record its license, and commit lockfile changes. No mandatory AI review agents or automatic agent-generated commits are required.

For an engine bug, reproduce it first. Prefer a supported extension change before a small version-pinned patch, and a fork only when needed. Reviewed source patches may live in `patches/`; scan their context too. Never store a complete old installation there. Record why each patch exists, its regression test, and when to remove it.

## Before publication

Local checks must pass and a human must review changes to privacy checks, permissions, actions, new network calls, or dependencies. This solo-maintained project permits direct main pushes without mandatory PRs or server-side pre-merge status checks. Local hooks remain required but can be bypassed by a client; they are not equivalent to a server-side gate. CI runs on every main push, and a failure must be investigated before reporting success. Keep force-push/deletion protection and administrator enforcement for the remaining protections. Change remote protection settings only with explicit approval and verify their actual state.
