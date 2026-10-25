---
name: principle-prove-it-works
description: Verify the real result before reporting Rex work complete. Require actual user-path observations, correct build identity, persisted effects and rerunnable evidence rather than compilation, success messages or the agent's own claims.
---

# Prove the actual result

A passing check proves only what it observed. Read `../verify-rex/SKILL.md` and the feature entries affected by the task.

Verify the actual artifact: run the installed interface the user will use, not only a source helper. Identify the tested source/build and use isolated synthetic state. A stale image, old screenshot or successful SDK-only call is not proof of a changed installed CLI.

Capture the action and resulting state. Check the actual file, stored record, history or external request from a second read-only view when relevant. A status message or HTTP 200 is insufficient if the promised effect is absent or wrong. Do not bypass the user path with internal setters and call it end-to-end coverage.

Prefer a deterministic rerunnable check over a one-time observation. Record expected versus observed results, the exact command, tested version and local evidence location. Keep raw evidence private; publish only reviewed synthetic material. Preserve proof after cleanup.

Classify every required check as PASSED, FAILED, BLOCKED or NOT RUN. Missing tools, unavailable providers, partial output and skipped entry points are not passes. Separate environment failures from confirmed product defects. Re-check the observation method when evidence contradicts expectations; do not dismiss a failure merely because another check passed.

A baseline runner does not decide whether the task's scenarios are sufficient. Explicitly report exploratory QA and test-sensitivity gaps. Use standing-approved low-cost live inference when needed to establish real-model behavior; synthetic checks alone cannot prove it. Stop rather than silently expanding permissions, changing account settings or repairing unrelated product behavior.

Before completion, inspect the diff for unrelated changes and untested assumptions. Acknowledge pre-existing failures; never suppress them or rewrite the definition of success.

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack); see `../../pstack-license.txt`.
