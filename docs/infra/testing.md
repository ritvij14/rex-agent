# Testing

## Goal

Test what Rex must do and what it must refuse. A green test suite is not useful if it never checks privacy failures, denied actions, wrong-profile data, or interruptions. Use synthetic data. Default tests must run without credentials, accounts, a live proxy, paid model calls, a browser, or access to the developer's private application state.

## Current checks

| Check | Command | What it verifies |
| --- | --- | --- |
| Strict TypeScript | `npm run typecheck` | Scripts and tests checked with `noEmit`; no generated JavaScript |
| Repository regression tests | `npm test` | TypeScript through tsx and Node's built-in runner; Git/privacy/scanner behavior plus root README and workspace instruction placement |
| Candidate privacy and secrets | `npm run privacy:check` | Existing eligible working files and new non-ignored public files |
| Formatting | `npm run format:check` | Supported eligible text files only |
| Full local history | `npm run release:check` | Reachable commit trees, author/committer emails, messages, and secrets |

Run `npm ci` and `npm run setup` before tests. `npm run check` combines the typecheck, regression tests, privacy/secret scan, and formatting. There is no application package build, sandbox test, or memory test yet, because those implementations do not exist. Add those commands to the root check and CI when adding their first actual implementation; do not create placeholder successes.

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

Live acceptance tests must be separately approved and clearly marked. They are never part of default CI and must not print credentials, real memories, or account responses.
