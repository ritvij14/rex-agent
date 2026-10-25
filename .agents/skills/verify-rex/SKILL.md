---
name: verify-rex
description: Run and review project-level testing, terminal QA and evidence for changes to Rex. Use before reporting implementation complete, for verification requests, and after changing profile/session/policy/sandbox behavior. Includes risk selection, real installed CLI acceptance and honest gap reporting.
---

# Verify Rex

This workflow is for the agent developing this repository, not an additional QA agent or a skill enabled inside Rex profiles. Resolve the repository root as `../../..` from this skill directory; run all commands there. Read the root instructions, the three quality skills and `features/index.md`. Follow only entries relevant to the change, plus neighboring journeys it can affect.

## Plan the observations

Take the user's intended result and allowed scope as given. Before implementation, state the observable acceptance checks and relevant risks: wrong permissions/profile, missing/invalid input, interruption, repeated or concurrent work, restart/persistence, unavailable dependencies and plausible-but-incomplete results. Select risks according to the task; do not ask the owner to design the tests or invent a fixed coverage target.

Use `../principle-test-behavior-not-implementation/SKILL.md` for tests and `../tdd/SKILL.md` for practical bug reproductions. Keep expected behavior independent of the implementation. Fix only within the approved scope and stop when a product decision, additional access or an unapproved resource is needed.

## Doctor and launch

Run `npm run verify -- doctor`. It checks Node 22, local tools and Docker without reading accounts or changing a running application. Docker must already be running; dependencies and scanner setup use the existing documented setup process, not an automatic repair.

Run `npm run verify -- full` for source checks and a newly built disposable synthetic container acceptance run. It reuses `npm run sandbox -- check`: a unique Compose project, fake inference, no host mounts/accounts, actual installed `rex` CLI, and cleanup of that run's containers/volumes. It does not refresh or reset the normal sandbox.

For a focused iteration, `npm run verify -- checks` runs source checks; `npm run verify -- sandbox` runs container acceptance only. Both report excluded coverage. Neither alone proves the other scope. Relevant targeted tests and task-specific QA are still required; full baseline is not a universal product certification.

## Drive and observe

Follow the feature map's exact checks. Use the actual user interface for application QA, then inspect files/history/definitions or other effects from a separate read-only view. Synthetic external responses prove integration and policy, not live model quality. A failed precondition or unsupported interface is BLOCKED/NOT RUN, never equivalent coverage through a convenient substitute.

For provider/API compatibility, tool use with a real model, generated results or other model-dependent behavior, perform a relevant live check through the existing proxy. This is standing-approved by the owner under the root QA policy; do not ask again or treat fake-provider success as an excuse to omit it. Prefer inexpensive adequate models such as the owner's 6.1 Luna or Haiku 5.5 examples, resolve their available IDs, and use the specific target model when the check depends on it. Use invented tasks and isolated histories/test definitions rather than changing active profile defaults. Record actual provider/model, expected versus observed results and live/synthetic coverage. Keep deterministic fault tests synthetic; stop to diagnose unavailable access rather than rerunning a blocked batch.

The checked-in container suite is the repeatable installed-artifact baseline. It cannot prove that a feature omitted from that suite works. Extend the relevant tests/recipe as capabilities are built; do not add fake success output or bypass the CLI to manufacture proof.

## Evidence and cleanup

The runner stores private development evidence under `.local/verification/run-*/`: per-command logs and `report.json` with selected scope, exact command arguments, exit codes, statuses and public-source SHA-256 before/after. It runs independent source checks even after a failure. Changed source during a run blocks a passing result. Logs are retained after disposable-container cleanup; do not commit or upload them. No evidence is stored in application histories.

Record task-specific observations using `references/report-template.md` in the same local run directory. Include expected versus actual outcomes and evidence references. The JSON baseline deliberately leaves exploratory QA, test sensitivity and live model behavior unverified; the agent must assess these, not infer them from a green command.

Cleanup is owned by the disposable acceptance command. If interrupted/killed, inspect the unique `rex-terminal-check-*` project named in that run's private log and confirm ownership before any cleanup; never reset `rex-terminal`, prune Docker, kill by process name or delete unrelated state. Preserve proof.

## Finish honestly

Read `../principle-prove-it-works/SKILL.md`. Report PASSED, FAILED, BLOCKED or NOT RUN per required observation, the tested source/build, proof location and remaining risks. Keep known failures visible and distinguish them from new defects. Source checks passing while a normal container still has an old image is not an installed fix.

After new behavior or an escaped bug, update the affected feature entry and reusable checks; use `../maintain-verification-skill/SKILL.md` for an audit. Live inference follows the root standing QA approval. Browsers, extra agents, new services and publication still require their own approval. Skills are instructions, not a security boundary or an automatic enforcement engine.
