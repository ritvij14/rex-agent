---
name: bug-fix
description: Fix a reported Rex defect, failing check or unexpected behavior. Reproduce it on the interface where it appeared, find the root cause by ruling out hypotheses with runtime evidence, fix it there and prove the original reproduction now passes.
---

# Fix a bug from evidence

Every shipped line traces to runtime evidence. A change that "might help" is a hypothesis and does not ship. When evidence refutes a hypothesis, revert what it motivated. Ship the smallest change the evidence justifies.

1. **Reproduce it yourself** on the interface where it was reported: installed `rex` CLI, container, SDK call or script, per `../verify-rex/SKILL.md`. Do not ask the owner to reproduce what you can run. If it does not fire, tighten the conditions, synthesize the trigger or add instrumentation until it does. Ask only when reproduction needs access or approval you lack, and name it.
2. **Write the failing check before code.** Use `../tdd/SKILL.md` when a cheap test path exists; otherwise keep the closest executable reproduction. Observe it fail for the reported reason.
3. **Narrow the cause.** List candidate causes. Each round, make the observation that rules out the most candidates and discard what it contradicts. When state is unclear, add temporary logging or read the actual files, histories and definitions while the code runs. Do not guess. Confirm the surviving mechanism with runtime evidence before planning the fix, then remove temporary instrumentation.
4. **Fix the root cause**, the first place the system did something wrong, not where the symptom surfaced.
   - Ask whether the triggering state is legitimate. If the system may be in that state, the code that broke on it is at fault; handle it there. If the state should never exist, a guard where it broke hides the bug; find what produced it. Guards, retries, swallowed errors, clamped values and discarded state are the usual hiding places.
   - When something fails only after a restart or recreation, suspect persisted state first: histories, profile definitions, locks, volumes and caches.
   - Search for the same fault elsewhere. Fix instances inside the task's scope and report the rest.
   - A workaround that needs a paragraph of justification means the code is wrong.
   - If the deciding fact took a deep dig, propose the cheap always-on signal that would have shown it, such as a doctor check or a clearer public error.
5. **Attack the premise after two failures.** When two fixes resting on the same belief fail the same check, stop. Write the belief as one sentence, find an observation that would differ if it were false and run it before another fix. If it is false, look for what the failures share that the belief did not predict. Remove the condition rather than adding code that compensates for it.
6. **Verify on the same interface.** The original reproduction passes, the regression passes and neighboring checks pass, per `../principle-prove-it-works/SKILL.md`. An inconclusive result or a different interface is not a pass. Unit tests show branch behavior, not bug absence. Commit test and fix together only afterwards, per `../principle-sequence-verifiable-units/SKILL.md`.

Reply with what the user saw, the root cause, the fix, failing-before and passing-after output verbatim (trimmed to the relevant lines), what remains unverified and any same-fault instances left for the owner.

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack); see `../../pstack-license.txt`.
