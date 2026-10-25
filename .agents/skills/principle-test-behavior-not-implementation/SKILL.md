---
name: principle-test-behavior-not-implementation
description: Write and review meaningful Rex tests whenever adding, changing or retaining tests. Check observable behavior and whether assertions would catch a plausible defect without depending on private implementation details.
---

# Test behavior, not implementation

Use the user's intended result and allowed scope as the requirement. Challenge unexplained constraints before turning them into assertions; a rigorous test can still prove the wrong design.

Drive a public interface with concrete inputs. Assert returned values, meaningful errors, observable state, persisted effects or requests received by an external boundary. Derive expected values from the requirement, not by calling the same implementation again.

Judge important tests with two questions:

1. If the behavior were broken, omitted or duplicated, would this assertion fail?
2. If private helpers changed but the behavior stayed correct, would it still pass?

For a bug, demonstrate the first with the failing-before reproduction when practical. For a new critical test, try one relevant broken variant in disposable test state when cheap. Otherwise explain the concrete defect the assertion detects and disclose that sensitivity was not experimentally checked. Do not claim a counterexample run that was only imagined. Do not introduce a mutation-testing framework by default.

Test success and meaningful rejection/failure cases. Pair absence assertions with a positive case proving the check can observe the effect. An empty result is appropriate only when emptiness is the actual promise.

Replace external services at their established boundary, not the profile rules or state operations being tested. A fake provider receiving a real SDK request tests observable behavior. A mock of the function whose correctness is in question does not. Exact external payloads can be contracts; private helper call order usually is not.

Do not weaken assertions, update snapshots blindly or change requirements to get green results. Avoid timing guesses, expected values copied from current output, and arbitrary coverage/pass-count targets. Keep fixtures synthetic and relevant.

Continue with `../principle-prove-it-works/SKILL.md` before declaring completion.

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack); see `../../pstack-license.txt`.
