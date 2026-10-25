---
name: maintain-verification-skill
description: Audit and improve Rex's verification recipes, feature map and checks after behavior changes or an escaped bug. Distinguish outdated instructions, automation gaps and actual product defects; keep expectations honest.
disable-model-invocation: true
---

# Maintain verification without hiding regressions

Read `../verify-rex/SKILL.md` and its feature index. Run in the main agent; do not launch reviewers or workers without approval.

For a focused feature change, inspect its affected entries and neighboring journeys. For an explicit full audit, inspect and drive every mapped feature. A focused pass is not full coverage. Find missing user-facing behavior from actual source, not speculation.

Compare the intended behavior, current implementation and verification instructions. Classify discrepancies:

- **Recipe drift:** the product is correct but documented commands or preconditions are outdated.
- **Automation gap:** the behavior works but the check cannot exercise or observe it.
- **Product defect:** actual behavior violates the intended result. Report it; do not rewrite the map to make it expected.

Edit only the verification workflow, map and its tests during a maintenance-only request. Product fixes require the appropriate task scope. For escaped bugs, identify what the previous check missed and add a focused regression or stronger observation without broad unrelated cleanup.

Run doctor, exercise the affected real user paths and re-run any changed verification script. After unexpected behavior, check the instance/build/state again before trusting further observations. Clean up only owned resources and verify retained evidence still exists.

Check that important assertions reject a relevant wrong result and do not just restate fixture data. If that sensitivity was not run, disclose it. Skill parsing and a plausible checklist are not proof of improved model behavior; use a reviewed future task to evaluate that claim.

Return **CLEAN**, **CHANGED** or **BLOCKED**, with feature coverage, observed failures, proof locations and omissions. Product failures remain visible even if the recipe correction succeeded. Do not create PRs, commit, publish or schedule another run automatically.

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack); see `../../pstack-license.txt`.
