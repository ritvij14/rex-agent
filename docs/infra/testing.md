# Testing

## Goal

Test what Rex must do and what it must refuse. A green test suite is not useful if it never checks privacy failures, denied actions, wrong-profile data, or interruptions. Use synthetic data. Default tests must run without credentials, accounts, a live proxy, paid model calls, a browser, or access to the developer's private application state.

## Current checks

| Check | Command | What it verifies |
| --- | --- | --- |
| Strict TypeScript | `npm run typecheck` | Scripts, tests, terminal sandbox, and workspace packages checked with `noEmit` |
| Repository regression tests | `npm test` | TypeScript through tsx and Node's built-in runner; repository safeguards, gateway rejection, profile schema/scope/policy, and real Pi SDK/tool/session/admission tests against synthetic inference |
| Candidate privacy and secrets | `npm run privacy:check` | Existing eligible working files and new non-ignored public files |
| Formatting | `npm run format:check` | Supported eligible text files only |
| Container acceptance | `npm run sandbox -- check` | Real isolation, resource limits, synthetic Pi inference, recovery, persistence, and reset; requires Docker, not accounts |
| Full local history | `npm run release:check` | Reachable commit trees, author/committer emails, messages, and secrets |

Run `npm ci` and `npm run setup` before tests. `npm run check` combines the typecheck, regression tests, privacy/secret scan, and formatting. The root check includes deterministic sandbox tests and types without requiring Docker. CI additionally runs the real container acceptance command against a fake proxy, never the host's live proxy. Both profile workspaces are included in strict types/tests and have no emitted build. The Pi adapter uses a separate strict Bundler/DOM config for published provider declarations, with their optional declaration dependency pinned; core/repository code remains NodeNext, and declaration checking is not skipped. `npm run test:profiles` runs its focused tests. No memory tests exist yet; add real checks with that implementation, not placeholder successes.

## Project verification workflow

Project-local Pi skills live in `.agents/skills/`; no global configuration or sandbox skill loading is changed. Reload project resources with `/reload`. The agent reads matching skills itself through the routing table in the root `AGENTS.md`; the owner can also invoke one directly, such as `/skill:verify-rex`, `/skill:create-verification-skill` or `/skill:maintain-verification-skill`. The test-behavior, focused TDD and prove-it-works skills apply throughout implementation. The `bug-fix`, `feature` and `multi-phase-plan` workflows route that work through `principle-sequence-verifiable-units`: tests before code, one verified unit at a time. The skill-loading tests also fail when a skill names a missing file or is absent from the root routing table. They adapt selected [pstack skills](https://github.com/cursor/plugins/tree/main/pstack); the retained license is `.agents/pstack-license.txt`.

`npm run verify -- doctor` checks Node 22, local tools and Docker without modifying a running app. `npm run verify -- checks` runs types, tests, privacy and formatting independently so one failure does not hide the other results. `npm run verify -- sandbox` runs the existing newly built, disposable synthetic container suite. `npm run verify -- full` runs both scopes; it does not use or reset the normal sandbox, call paid models, install dependencies or launch another agent.

Each non-doctor run retains command logs and `report.json` in a new ignored `.local/verification/run-*` development directory. The report identifies selected scope, command arguments, exit codes, per-check statuses, unverified areas and a SHA-256 of eligible public source before/after. Changed source, missing tools, terminated processes and incomplete selected checks cannot yield a passing baseline. Evidence survives the container suite's owned-resource cleanup; interrupted runs may require investigation of their unique disposable project. Do not publish raw reports/logs, and do not mistake this development holding area for an application database.

The [feature map](../../.agents/skills/verify-rex/features/index.md) links implemented user goals to actual test commands and records gaps between SDK and installed-CLI coverage. For each change, add expected versus observed user-path evidence using the skill's report template. Baseline command success alone does not establish scenario sufficiency, live-provider behavior, test sensitivity or improved model judgment. No independent agent/baseline comparison is performed by these checks. Review a real future task before claiming the skills improve autonomous QA quality.

## For each new behavior

1. Write the expected successful result, invalid inputs, and denied actions.
2. Cover state conflicts, retries, interruption, and external service failure where relevant.
3. Test real package boundaries and real temporary storage. Replace only external providers/transports; do not mock away the rule being tested.
4. Ensure failure output does not reveal private inputs. Check observable outcomes, not just a model's claim that an action succeeded.
5. Keep discovered bugs as regression cases and document any untested behavior.

Use small unit tests for deterministic decisions, integration tests for adapters and persistence, and multi-step tests for critical workflows. No fixed test-count ratio or coverage target replaces checking the actual failure cases.

## Required cases before future modules can ship

| Area | Acceptance cases |
| --- | --- |
| Router | Allowed/unknown profile, malformed model response, explicit override, exhausted/unavailable candidates, no permission escalation |
| Profiles | Tool denial, scope separation, no cross-profile state access |
| Memory | Bounded context, one-hour inactivity rule, approved admission, recall quality, deletion/expiry, no chat-history fallback on failure |
| Sandbox | Denied host paths, credential and privileged proxy access denied, allowed model access works, resource limits behave as documented |
| Durable adapter | Restart resumes approved work, denied work stays denied, approval survives, repeated external writes are prevented |

The current [profile mechanism](../features/profiles.md) checks lookup/schema/scopes and tool-name authorization, not operating-system access control between profile files. Tests cover real permitted writes/reads, forged denied calls without side effects, separate/resumed histories, no resource autodiscovery, lock/cancellation cleanup, a twelve-request loop bound, provider failure redaction, and digest-bound non-overwriting admission. Temporary invented profiles, local fake inference and synthetic child-process environments require no private application state.

Container profile acceptance additionally exercises the installed `rex` command, three synthetic model/profile runs, cap-free wire requests, CLI truncation rejection/recovery, filtered package contexts, read-only active definitions, a networkless operator helper without agent/inference resources, draft approval, and persistence across recreation. A loopback response-check mode uses owned temporary state and can also be run inside a refreshed normal container without paid inference or normal-history writes. Source regressions cover truncated text/empty output/tool arguments, no automatic retry, completed earlier tool effects and lock release.

The terminal container acceptance checks cover read-only paths, forbidden direct networking and management routes, stripped client credentials, process-limit rejection, configured CPU/memory/swap limits, gateway interruption and recovery, persistent state across recreation, and deletion of newly created synthetic test state only. The gateway process limit includes headroom for concurrent Node health checks and diagnostics; a regression probe exercises this case. See [terminal sandbox operations](terminal-sandbox.md) for the execution boundary and untested limits.

The owner has standing-approved necessary live inference QA through the existing proxy; do not ask again per run. Prefer inexpensive adequate models such as 6.1 Luna or Haiku 5.5 when available, resolving actual IDs before use. When behavior depends on a specific model, verify that model rather than substitute a cheaper one that cannot establish the result. Use invented tasks and isolated test state, not active profile-default changes. Live checks are required when synthetic responses cannot establish the requested model-dependent behavior, but remain separate from deterministic default checks/CI. Record provider/model and live versus synthetic evidence; never print credentials, real memories or account responses. Account/proxy changes and other external access retain their existing approval requirements.
