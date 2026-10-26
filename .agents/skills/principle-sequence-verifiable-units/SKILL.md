---
name: principle-sequence-verifiable-units
description: Order multi-step Rex work as small units that each end in an observed check. Use for features, bug fixes, migrations, runs of similar edits and plans; verify each unit before starting the next and commit only verified work.
---

# Sequence work into verifiable units

Break the work into small units. Each unit starts from a known-good state, makes one change and ends with a check whose result you observe. Do not start the next unit until the current check passes. A break caught at the unit that caused it is cheap to locate; a break caught after a batch is buried under work built on it.

**Start from a real baseline.** Before the first unit, run the relevant checks on the current tree and record any that already fail. A pre-existing failure stays visible; do not attribute it to a unit or hide it.

**Choose the check before the change.** For new or changed behavior, write the test or executable reproduction first and observe it fail for the intended reason (`../tdd/SKILL.md`, `../principle-test-behavior-not-implementation/SKILL.md`). Then change the code and rerun it. A unit with no behavior change, such as a removal, rename or doc edit, ends with the narrowest existing check that would catch a mistake. When a script makes the edits, still run the per-unit check.

**Order units so the sequence argues for itself.** Removal before reshape, scaffold before feature, baseline capture before the change compared against it, failing check before the fix.

**Commit verified work only.** Tests come before code while working, but a commit reaches `main` only after its unit passes and the change meets `../verify-rex/SKILL.md`. A regression test and its fix share one commit; record the failing-before observation in the report instead of committing a red state. Each commit stands alone, passes `npm run check` and names one change. Committing and pushing still follow the owner's request.

When a check fails, stay in that unit and diagnose it with `../bug-fix/SKILL.md` rather than building the next change on a broken base.

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack); see `../../pstack-license.txt`.
