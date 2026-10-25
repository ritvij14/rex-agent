---
name: tdd
description: Reproduce a Rex bug with a focused failing-before regression check, then fix and rerun it. Use for explicit TDD/regression requests or bugs with an obvious inexpensive local reproduction; do not force elaborate test infrastructure.
---

# Focused failing-before regression

Read `../principle-test-behavior-not-implementation/SKILL.md`.

1. Identify intended behavior, current behavior and the smallest observable reproduction.
2. Choose an existing public test path close to the defect. Write the smallest assertion that would have caught it.
3. Run the check before changing production code. Confirm it fails for the defect, not a broken import, missing tool or unrelated setup error.
4. Make the smallest in-scope fix. Preserve nearby contracts and existing assertions.
5. Run the regression again, then relevant neighboring checks and `../verify-rex/SKILL.md`.

If a cheap deterministic test is impractical, use the closest useful executable reproduction and explain the gap. Do not build brittle mocks, broad fixtures or production-only infrastructure just to satisfy a slogan. Never label a test failing-before when it was only run after the fix.

For a flaky failure, first determine what changes between runs. Prefer an explicit state or controllable external response over sleeps and timing thresholds.

Report the failing-before observation, passing-after observation, commands and remaining limits. Retain the regression or reusable reproduction so the next change can rerun it.

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack); see `../../pstack-license.txt`.
