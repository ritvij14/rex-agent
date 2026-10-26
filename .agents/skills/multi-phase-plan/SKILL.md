---
name: multi-phase-plan
description: Plan Rex work that spans several sessions, phases or many commits. Settle facts by experiment, write a checklist plan in chat where every box names its evidence, mirror it in the todo list and stop for the owner's go. Skip for one- or two-file changes with an obvious approach.
---

# Plan multi-phase work

The plan is the deliverable. Do not implement until the owner explicitly says go.

1. If the change touches one or two files with an obvious approach, skip the plan, say so and continue with `../feature/SKILL.md` or `../bug-fix/SKILL.md`.
2. Read the affected docs and code. Settle factual questions with small throwaway checks before writing, as in step 2 of `../feature/SKILL.md`, and keep each command and result for the plan's evidence appendix. Ask the owner only product or preference calls no run can settle, with options and a recommendation.
3. Split the work into units per `../principle-sequence-verifiable-units/SKILL.md`. One unit is one change with its own evidence and normally one commit.
4. Write the plan in chat using `references/plan-template.md`. Never save it to a tracked file; the owner keeps the roadmap outside the repository.
5. Mirror the units in the todo list: one item per unit, `blockedBy` for dependencies and the unit's evidence in its description. The todo list is the copy that survives compaction.
6. Stop. Post the plan and wait for the owner's go.

**Executing.** Run one unit at a time with the feature or bug-fix skill. Complete a unit only when its evidence exists: an observed test run, command output, installed-CLI result or commit SHA. Tests alone do not verify a unit whose behavior reaches the installed CLI or container; its acceptance box must also pass. When a unit shows a later unit is wrong, update the todos, restate the changed part of the plan and tell the owner before continuing.

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack); see `../../pstack-license.txt`.
