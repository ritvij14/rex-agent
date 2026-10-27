# Rex: project instructions

## Purpose and current state

Rex is a memory-first personal agent system built on Pi's core libraries. This repository has two jobs: version our reusable Pi customizations and hold the definitions needed to run their sandbox. Publish the implementation, not the owner's accounts, conversations, memories, or machine state.

Current stage: repository foundation, the terminal-only Docker sandbox in `lab/terminal/`, profile core in `packages/profiles/`, and the minimal Pi SDK adapter in `packages/pi-profiles/`. The adapter provides explicit profile-selected runs, SOUL/shared configuration, separate histories, tool-name whitelist/blacklist enforcement, and operator-approved profile drafts. The operator launcher runs profiles in separate networkless containers with private workspace/state/drafts and selected-only read-only definitions; only those workers, not the plain SDK, establish filesystem isolation. Synthetic container acceptance, a baseline live Pi request, and separately approved GLM profile checks (coding write, research read, inactive builder draft) have passed; other live model/API acceptance remains separate and requires inference authentication. Explicit same-profile maintenance drafts and digest-bound next-launch approval are implemented. Operator model catalogs, allowed per-request overrides, and pre-response temporary-failure fallback are implemented. Catalog-checked reasoning controls are implemented. Bounded configurable turn limits and explicit digest-bound shared/profile instruction files are implemented. Direct local MCP tools use explicitly selected integrity-checked installed programs, minimal child environments and owned cleanup; explicitly authorized local MCP resource reads are supported, while indirect discovery modes and remote transport are not yet enabled. Router, memory engine, and durable service do not exist. Worker isolation has synthetic installed-container acceptance and isolated live Haiku MCP checks; the earlier live GLM checks used the former shared layout. Normal installation refresh and migration of old shared state remain separate, explicit operations. The previous Hermes implementation and private research are local-only material, not active modules. Never describe planned features as working.

Do not maintain a repository roadmap; the owner tracks it separately. Do not create a standalone examples directory. If demand emerges after the system works, write setup documentation for coding agents with exact steps, private configuration requirements, and verification.

## Context and documentation

Read this file fully at the start of every session. Its architecture and building-in-public rules apply to every task, not only architecture or publishing changes. Before reading or changing files in a subtree, discover and read each applicable ancestor `AGENTS.md` from the root down to the target directory; do not assume the harness loaded them automatically. Read only the relevant documents under `docs/features/` or `docs/infra/`; documentation follows this root guide and needs no separate scoped guide. Read [testing](docs/infra/testing.md) before changing behavior and [security](docs/infra/security.md) for private reporting or incidents. Before starting any task, match it against the [project skills](#project-skills-and-verification) table and read each matching skill yourself; do not wait for the owner to name it. `CLAUDE.md` must contain only `@AGENTS.md` and a final newline.

## Scoped AGENTS.md: required placement

Each `AGENTS.md` governs its own directory and descendants. Parent instructions remain in force; a child adds local requirements, never weakens root architecture, privacy, approvals, or verification. Stop and resolve contradictions rather than choosing the more permissive rule.

**Add or update a scoped file in the same change whenever any of these is true:**

1. A workspace package receives its first implementation or `package.json`: add `packages/<name>/AGENTS.md` documenting its responsibility, public API, actual commands, and test requirements.
2. A runnable sandbox experiment is introduced: add `lab/<experiment>/AGENTS.md` documenting its execution boundary, approved resources, actual start/check/stop commands, and cleanup limits before running it.
3. A real subtree introduces different permissions, data handling, dependency/import restrictions, generated-file ownership, or build/test commands that inherited instructions do not cover. Put the rule at the narrowest directory shared by the affected files.
4. A parent guide accumulates instructions that apply only to one existing child area: move those local details to that child's guide. Keep project-wide architecture and building-in-public rules here.
5. An existing boundary or its commands/contracts change: update its current guide rather than adding a second instruction file.

**Do not add scoped files:**

- Merely because a directory exists, is deeply nested, or is named `src`, `tests`, `utils`, `features`, or `infra`. Size or file count alone is not a trigger.
- For empty/planned package or experiment directories, guessed commands, or placeholder text. The existing `packages/` and `lab/` guides govern creation of those boundaries; individual child guides wait for real implementation.
- To repeat parent rules, provide a directory listing, or describe ordinary code that already has clear names. A scoped guide must explain a concrete local constraint and how to verify work there.
- In generated, dependency, build-output, vendored, or private/runtime folders. Record ownership and regeneration rules in the nearest maintained ancestor instead.
- As a second feature manual or local `CLAUDE.md`. Keep reference/design material in focused docs and link to it; root `CLAUDE.md` remains the only compatibility entry point.

Keep one root `README.md` for the public introduction. Do not create nested READMEs unless the owner explicitly requests one for an external distribution requirement. Use exact `AGENTS.md` filenames for scoped working rules, remove stale guides when boundaries disappear, and update links when moving them. Applicable local guides currently exist in `.agents/`, `packages/`, `packages/profiles/`, `packages/pi-profiles/`, `lab/`, and `lab/terminal/`.

## Architecture

Pi supplies the agent engine; Rex owns routing, profiles, memory, policy, and their integration. Profile core rules and their minimal Pi SDK adapter implement the first application boundary; the remaining application boundaries are design requirements, and the terminal sandbox is development infrastructure.

- **Core libraries:** put reusable router, profile, and memory rules in plain TypeScript packages under `packages/`, without imports from Pi, Pi Durable, or provider SDKs. Expose cross-package access through declared public exports, never internal files. Create a package only when real code justifies the boundary.
- **Adapters:** connect core rules to Pi, Pi Durable, and providers through explicit inputs/outputs. Validate external inputs and keep provider calls replaceable in tests. Do not duplicate business rules in adapters or assume Pi and Pi Durable have the same extension format.
- **Policy and profiles:** start with coding-related profiles. Keep each profile's tools and memory separate; routing to a profile never grants more permissions. Enforce authorization outside the model. Require explicit approval for host execution, remote bodies, publication, and account-affecting actions. Only approved requests, schedules, or events may create autonomous work; doing nothing must be valid.
- **Memory:** specify and test bounded context, one-hour inactivity behavior, admission, expiry, isolation, recall quality, and failure before implementation. Proposed writes go through admission rules, not unrestricted agent edits. Failed recall must not silently restore full chat history or another profile's data. Specify concurrency/retry behavior; durable retries must not duplicate external writes or lose approval state.
- **Sandbox and promotion:** keep reproducible, version-pinned experiments in `lab/`. Separate settings alone are not isolation. Never mount the home directory, Docker socket, credential stores, or proxy management credentials. Test permitted and denied access. Promote the exact tested package version by installation, not by copying runtime state.

Intended request flow: validate the request, authorize the action, select an allowed profile/model, assemble bounded context, run the agent, admit proposed memory changes, then save private state/results outside the clone. Public diagnostics must not include raw prompts, credentials, or account responses.

## Building in public

### Keep private data out of the repository

- Publish source, lockfiles, sanitized decisions, reproducible lab definitions, and invented examples only. Never commit or attach credentials, personal settings/prompts, memories/embeddings, transcripts, traces, account/chat IDs, quota readings, client data, private URLs, or personal screenshots/recordings. This applies equally to code, commit messages, issues, PRs, demos, releases, CI logs, and artifacts.
- Keep real runtime state outside the clone, such as `~/.rex/`. The profile core takes an explicit profiles root; automatic application-home discovery and runtime state loading are not implemented. `.local/` is an ignored development/transition holding folder, not the application's database. Never upload it or the old work as a backup branch, tag, archive, or artifact.
- Do not read `.env`, authentication stores, host settings, or `.local/previous-work/` just to write docs or run checks. Read specific previous source only when a task needs it; write a sanitized replacement rather than copying personal material and hoping redaction is complete. Repository checks need no accounts or credentials.
- Use synthetic email domains `example.com`, `example.org`, or `example.net`, named fake account IDs, and blank credential templates. Optional `.local/privacy-terms.txt` holds extra private names/phrases, never credentials; it stays local and is not available to CI. Binary attachments need explicit privacy review.
- Never use `git add .`, `git add -A`, force-add ignored files, bypass hooks, or weaken scanner rules to hide a finding. Stage named, reviewed files. Use the author/committer identity the owner intends to publish; the owner approves using their own email and does not require a noreply address. Email addresses are also allowed in commit-message subjects, bodies and trailers; secret scanning and all other message privacy checks remain active. File contents and filenames retain the synthetic-email policy. Review display names and messages too. No AI co-author trailers or automatic commits/pushes.

### Check before sharing

Run `npm run check` before completing changes and `npm run release:check` before publication. Commit hooks inspect the exact staged bytes, not just working files; release checks inspect reachable historical commits and metadata. A clean working tree or new ignore rule does not remove previously committed private data.

Human review of the public file list, staged diff, metadata, and example context remains mandatory. Scanners cannot recognize every private fact; local hooks can be bypassed, and CI runs after upload. Never treat passing checks as permission to publish or as a guarantee of privacy. Missing tools and failed checks must block, not count as success. See [repository safeguards](docs/features/repository-safeguards.md) for command behavior and limits.

### Publication and GitHub settings

History replacement, force-pushes, visibility/protection changes, releases, and package publication require the user's approval of the specific operation. The initial public history must contain only reviewed new work, with no old-code rollback refs. Before making the repo public, check remote branches/tags, PR refs, releases, logs, and artifacts—not just local files or `main`. Use a precisely scoped lease-protected push for an approved replacement; never a blind force-push or mirror-push. GitHub may retain cached/referenced objects; a history rewrite does not guarantee erasure. Handle leaks through [the security procedure](docs/infra/security.md), including revoking exposed credentials.

Keep workflows read-only, actions pinned, installs locked with lifecycle scripts disabled, and repository secrets unavailable to untrusted PR code. Never use `pull_request_target` to execute submitted code. Dependency updates are proposals, not approval to merge. Do not add automatic deployment or package publication.

Use the direct-main workflow below rather than requiring PRs or server-side pre-merge status checks by default. Keep local verification/privacy hooks and CI on every `main` push; a failing post-push check still requires investigation, not a declaration of success. Block force-push/deletion and retain administrator enforcement for the remaining protections. Enable available secret scanning/push protection and private vulnerability reporting. Changes to GitHub protection settings still require approval of the specific operation and verification afterward. The project uses the MIT license in `LICENSE`.

## Development and verification

Use Node.js 22 LTS, npm with the committed lockfile, and system `tar` on macOS/Linux. Prefer TypeScript for logic, scripts, and tests; another language needs a concrete benefit. Pinned `tsx` runs `.ts` files, Node's built-in runner runs tests, and strict `tsc --noEmit` checks types without generating source-tree JavaScript. Future distributable packages may need their own builds. Pi CLI 1.3.0 is pinned in the terminal experiment's own manifest and lockfile, not installed as a root dependency. Keep runtime versions and their checks explicit when adding other experiments.

1. Inspect the actual code and callers and state assumptions. Answer questions that running something can settle (behavior, output, timing, compatibility) with the smallest check instead of asking. Ask the owner only product, preference or direction calls and the approvals this guide reserves.
2. Reproduce bugs first. Define success, invalid inputs, denied actions, and relevant failure/retry cases before new behavior.
3. Make the smallest complete change. No unrelated cleanup, speculative abstractions, mandatory subagents, or background processes started by extension loading.
4. Run the checks and report exact results, skipped checks, and remaining risks. Do not weaken acceptance criteria for a green result.
5. Update the affected feature docs and decision record with meaningful behavior or design changes. Do not create duplicate policy docs or move planning back into the repo.

Use kebab-case paths without whitespace. TypeScript/JSON/YAML use two spaces. Comments explain non-obvious constraints only. Keep regression tests with synthetic fixtures. Markdown uses one source line per paragraph with no fixed line-length limit; the roughly 80-character target applies to code, not prose.

## Project skills and verification

The project skills under `.agents/skills/` define how Rex is built. Read a skill when its trigger applies, whether or not the owner names it, and again when the task moves into a new row. Several rows usually apply at once: a bug fix reads the bug-fix workflow, the test principle, the unit principle and both completion skills. Only the owner can waive a matching skill, except that a trivial edit with an obvious approach needs no workflow skill; it still ends with verification. Skills grant no permissions and do not override the task's allowed scope or the approvals in this guide.

| When | Read |
| --- | --- |
| A reported defect, failing check, regression or unexpected behavior | `.agents/skills/bug-fix/SKILL.md` |
| A bug with an obvious inexpensive local reproduction, or a request for TDD or a regression test | `.agents/skills/tdd/SKILL.md` |
| New or changed behavior beyond a trivial edit | `.agents/skills/feature/SKILL.md` |
| Work spanning several sessions, phases or many commits, or a request for a plan | `.agents/skills/multi-phase-plan/SKILL.md` |
| Any multi-step change, and before every commit | `.agents/skills/principle-sequence-verifiable-units/SKILL.md` |
| Writing, changing, reviewing or retaining a test | `.agents/skills/principle-test-behavior-not-implementation/SKILL.md` |
| Before reporting implementation complete, or a verification or QA request | `.agents/skills/verify-rex/SKILL.md`, then `.agents/skills/principle-prove-it-works/SKILL.md` |
| A real interface has no repeatable user-level QA recipe | `.agents/skills/create-verification-skill/SKILL.md` |
| Verification instructions drifted, a bug escaped the checks, or a verification audit is requested | `.agents/skills/maintain-verification-skill/SKILL.md` |
| Creating or editing a skill | `.agents/AGENTS.md`, and add the skill to this table |

Plans live in chat and the todo list, never in tracked files. Work tests before code, one verified unit at a time; a test and its fix are committed together only after verification. Derive observable checks from the user's intended result, select relevant failure risks and exercise the actual installed interface for runtime changes.

Extend the verification feature map and reusable checks when behavior changes. Start with the main agent, not automatic reviewers or swarms. `npm run verify -- full` retains source-fingerprinted evidence for the existing account-free checks and disposable container acceptance. Report task-specific QA and sensitivity observations separately; a green baseline is not proof of every feature. Keep raw development evidence in ignored `.local/verification/`, never application histories or public artifacts. See [testing](docs/infra/testing.md) for commands and limits. These project skills are not enabled inside sandbox profiles.

### Live-provider QA

The owner has given standing approval for inference calls through the existing model proxy when needed to verify requested Rex work; do not ask again per run or substitute synthetic-only evidence for behavior that needs a real model. Prefer inexpensive suitable models, with 6.1 Luna or Haiku 5.5 as the owner's examples. Resolve actual available model IDs rather than inventing aliases or assuming availability/prices; test the specific target model when compatibility or behavior depends on it. Use the smallest useful set of calls, not arbitrary output caps that compromise the test.

Keep deterministic tests and CI synthetic and account-free. Live QA uses invented tasks and isolated test configuration/state, does not silently change active profile models, and records the tested provider/model plus live versus synthetic coverage. This approval does not cover credential-store access, account/proxy management, new services, publication, browsers or subagents. Missing configured access is a blocker to diagnose, not permission to read secrets or retry a failing batch blindly.

Work on and push directly to `main` by default for this solo-maintained project. Use branches when genuinely parallel work needs separate worktrees. For any other reason to avoid `main`, explain the concrete reason and use `ask_user_question` to obtain the owner's verdict before creating or using a branch. Do not turn risk, task size or a generic review workflow into automatic branch creation. This does not waive verification, privacy review, publication approval, or the prohibition on unapproved force-pushes and protection changes. Use `feat:`, `fix:`, `chore:`, `test:`, or `docs:` commits. Changes to `.githooks/`, `.github/`, `scripts/repo-check.ts`, `scripts/check-commit.ts`, scanner installation/checksums, `.gitignore`, or publication policy must explain the security impact and include relevant rejection tests. These safeguards do not replace runtime authorization or a sandbox.

Tool references: [Node.js 22 APIs](https://nodejs.org/docs/latest-v22.x/api/), [TypeScript 7.0.2](https://github.com/microsoft/TypeScript/tree/v7.0.2), and [tsx 4.23.15](https://www.npmjs.com/package/tsx/v/4.23.15). Exact dependency versions live in `package.json` and the lockfile.
