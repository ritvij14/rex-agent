---
name: feature
description: Build new or changed Rex behavior beyond a trivial edit. Settle factual questions by running checks, name the data shape before logic, define observable acceptance first, build in small verified units and report choices and open decisions.
---

# Build a feature

The owner sets direction. You own the design, implementation and proof inside the approved scope.

1. **Read the area.** Applicable `AGENTS.md` files, the relevant `docs/features/` document, the affected code, its callers and tests. Stop and report a contradiction between the request and the documented design.
2. **Settle facts by running, not asking.** When a question's answer is observable (behavior, output, timing, whether Pi or a provider accepts an input), answer it with the smallest throwaway check in ignored `.local/` scratch and let the result decide. Ask the owner only product, preference or direction calls and the approvals the root guide reserves; offer options with a recommendation.
3. **Name the data shape before logic.** State the core types and the structure that holds the domain rules: a state machine instead of scattered booleans or phases, a typed model instead of repeated shape assumptions, a table, registry or discriminated union instead of branches spread across files. Rules live in plain core packages; adapters translate. Do not force an abstraction when the current shape is clear, local and unlikely to grow. The warning signs are a new branch on an existing if/else chain or a second boolean that must stay in sync with the first.
4. **Define acceptance before code**, per "Plan the observations" in `../verify-rex/SKILL.md`: success, rejection, denied action and relevant failure cases.
5. **Build in units** per `../principle-sequence-verifiable-units/SKILL.md`: failing check, change, passing check, next unit. When a shared helper changes, verify every consumer.
6. **Verify the installed interface** per `../verify-rex/SKILL.md` and `../principle-prove-it-works/SKILL.md`. An inconclusive result or a substitute interface is not a pass. Use the standing live-inference approval when behavior depends on a real model.
7. **Update the feature document, verification map and decision record** for meaningful behavior or design changes.

Subagents stay off unless the owner approves a specific proposal under the global delegation rules.

Reply in this order: what the user can now do; the data shape and main choices with reasons, as a table when alternatives were weighed; PASSED, FAILED, BLOCKED or NOT RUN for each required check; open decisions for the owner. Label each claim as observed, inferred or guessed. Never hand the owner a check you could have run.

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack); see `../../pstack-license.txt`.
