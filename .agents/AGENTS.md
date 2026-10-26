# Project development skills

Scope: `.agents/` and descendants. These are project-local instructions for the agent developing Rex, not resources loaded into Rex's sandbox profiles. Inherit the root guide; skills grant no tools, permissions, host access, publication rights or approval to delegate.

Keep common principles separate from the runnable `verify-rex` recipe and the `bug-fix`, `feature` and `multi-phase-plan` workflows; workflows point to principles by path instead of restating them. Put existing user behavior in its feature map; do not describe planned modules as available. Generate new verification recipes only for real interfaces, and exercise them before calling them ready. Use `index.md`, not nested READMEs.

The skills adapt selected pstack ideas; retain attribution and `pstack-license.txt`. Do not import pstack's agent fanout, model routing, PR and review machinery, saved plan files, account copying or browser defaults. Keep scripts in the repository's TypeScript tooling rather than duplicating them in each skill. Skill changes must not weaken a failing product contract to match broken behavior.

When writing or changing a skill, keep only text that changes a decision. State the action and give a reason only when the rule is confusing without one. Point to other skills, docs and code by path. When the same correction recurs, prefer a check in repository tooling over more prose. Skill files are limited to `SKILL.md` plus Markdown in `features/` and `references/`, as enforced by `scripts/repo-check.ts`. Write the `description` as the trigger, because Pi lists it for automatic selection. Set `disable-model-invocation: true` only when the skill should run solely by explicit command or by the root guide's routing table.

Add each new skill to the skill-loading test in `tests/verification.test.ts` and to the routing table in the root `AGENTS.md`. The tests fail when a skill is missing from that table or names a file that does not exist. Execute the mapped checks. `npm run verify -- full` records source checks and disposable synthetic container acceptance; it is not evidence of paid-model compatibility, subjective skill quality or every possible application behavior. Raw evidence is local-only under ignored `.local/verification/`, a development holding area, not application state. Never commit logs, real prompts or account responses.

After changing skills, reload Pi's project resources with `/reload`. Global configuration and the sandbox's disabled skill discovery remain unchanged.
