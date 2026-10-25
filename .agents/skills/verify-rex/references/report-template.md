# Task verification report

Save a filled copy beside the local baseline `report.json`; do not commit raw evidence. Empty fields are missing evidence, not passes.

- Intended user result and allowed scope:
- Changed behavior and principal risks:
- Tested source fingerprint/build and baseline report:

| User journey or contract | Starting state and action | Expected result | Observed result and evidence | Status |
| --- | --- | --- | --- | --- |

Use PASSED, FAILED, BLOCKED or NOT RUN. Distinguish source/SDK checks from installed CLI checks, fake-provider results from real-model behavior, and environment blocks from product defects.

## Test quality

List important new/changed assertions and the plausible defect each detects. For a bug, include the actual failing-before and passing-after runs. For a controlled broken variant, record what was changed in disposable state and the observed rejection. If sensitivity was only reasoned about, say so; do not invent a counterexample run.

## Cleanup and retained proof

Name the owned resources removed and the evidence files confirmed present afterward. Note any interrupted-run residue without deleting unrelated resources.

## Gaps and findings

List new defects, pre-existing failures, unexercised entry points and unapproved live checks. Do not turn a failed product contract into an updated expectation. State the next action and who must decide it.
