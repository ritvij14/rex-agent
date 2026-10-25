# Project verification skills

Scope: `.agents/` and descendants. These are project-local instructions for the agent developing Rex, not resources loaded into Rex's sandbox profiles. Inherit the root guide; skills grant no tools, permissions, host access, publication rights or approval to delegate.

Keep common test-quality principles separate from the runnable `verify-rex` recipe. Put existing user behavior in its feature map; do not describe planned modules as available. Generate new verification recipes only for real interfaces, and exercise them before calling them ready. Use `index.md`, not nested READMEs.

The skills adapt selected pstack ideas; retain attribution and `pstack-license.txt`. Do not import pstack's agent fanout, account copying, automatic PRs or browser defaults. Keep scripts in the repository's TypeScript tooling rather than duplicating them in each skill. Skill changes must not weaken a failing product contract to match broken behavior.

Validate discovery with the project skill-loading test and execute the mapped checks. `npm run verify -- full` records source checks and disposable synthetic container acceptance; it is not evidence of paid-model compatibility, subjective skill quality or every possible application behavior. Raw evidence is local-only under ignored `.local/verification/`, a development holding area, not application state. Never commit logs, real prompts or account responses.

After changing skills, reload Pi's project resources with `/reload`. Global configuration and the sandbox's disabled skill discovery remain unchanged.
