---
name: create-verification-skill
description: Create or extend a project-local verification workflow when a real Rex interface lacks repeatable user-level QA. Discover launch, isolated state, driving, observations and cleanup from the repository, then execute the resulting recipe.
disable-model-invocation: true
---

# Create a real verification workflow

Work in this project only. Read the root instructions and `.agents/AGENTS.md`. Inspect `../verify-rex/SKILL.md` first: extend that workflow for a new Rex capability rather than generating a competing copy. Create another recipe only for a genuinely different runnable interface.

Interview the repository before asking the owner: identify the real user interface, actual start/build commands, readiness, dependencies, synthetic preconditions, available automation, observable effects and ownership of state/processes. Ask only for product expectations or approvals that cannot be discovered. Do not infer requirements solely from today's implementation. If the checkout does not build or start, fix that within scope or report it precisely first; a recipe written against a broken base teaches wrong steps.

Build the recipe with these parts:

1. **Launch and doctor:** exact commands, correct source/build identity, usable readiness, isolated data and what remains inaccessible. A catalog listing is not proof that paid inference is usable. When the safe path is a fake provider, loopback or dry-run mode, observe what it actually skips (files, network, histories) instead of trusting its name.
2. **Drive:** normal CLI/API/TUI actions or other explicitly approved interfaces; use existing automation before introducing dependencies. No browser, host-account copying or subagents by default.
3. **Feature map:** begin with the relevant existing behaviors, not planned modules. Use an `index.md` and small feature entries with user goal, preconditions, entry points, exact checks, expected visible/persisted outcomes and gotchas.
4. **Evidence:** record trigger, expected/observed state, version, commands and gaps. Keep deterministic checks synthetic and add live model checks when required by the behavior; these follow the root standing approval and low-cost model policy without another per-run request. Retain raw proof in ignored local development storage. Recordings and other new access still need approval.
5. **Cleanup:** remove only resources the verification created, including failed attempts; never prune shared state or remove the evidence.

Read `references/feature-template.md` for the entry shape. Include success, rejection, interruption, persistence and repeated/concurrent-operation cases where the change can affect them. Choose relevant risks, not every combination. Missing preconditions are blocked coverage, not a reason to weaken expectations.

Run the resulting instructions once end to end: prepare, doctor, drive one actual mapped path, inspect effects, clean up, then confirm proof still exists. A real product defect may make the correct result FAILED; demonstrate at least one successful drive separately. State exactly what was and was not exercised. When the run used a stand-in, such as a disposable container instead of the eventual host, list each setup step the stand-in performed that the real target will not; those stay unverified. An unexecuted recipe is a draft.

Point to `../maintain-verification-skill/SKILL.md` for subsequent changes. Do not install a scheduler, planner or automatic publication step.

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack); see `../../pstack-license.txt`.
