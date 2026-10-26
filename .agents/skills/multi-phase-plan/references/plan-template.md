# Plan template

Fill every placeholder from observed facts. Write `n/a: <reason>` for a block that does not apply rather than dropping it. Add one unit section per change.

```markdown
# <Change> plan

<Under ten lines: what changes, for whom, the rule it enforces and the unit ids in order.>

## How to read this

One box is one unit of work. Every box names the evidence that checks it. Check a box only when that evidence exists. Execution starts on the owner's go.

## Approvals needed

- [ ] <Host execution, publication, account-affecting action, new service or subagents; otherwise None.>

## <Unit as a verb phrase> (U1)

**Depends on.** <Unit id or None.>

**Files.**

- [ ] Edit `<path>`.

**Build.**

- [ ] <One change, naming the symbol and file.>

**You see.**

- [ ] <One observable result: exact CLI output, stored state or rejection.>

**Verify.**

- [ ] Test. `<test file>` gains `<case>`, observed failing before the change. Run `<command>`.
- [ ] Acceptance. <Installed CLI, container or live-model check from verify-rex, with its pass condition.>
- [ ] Perf. <Metric, baseline measured first and the failing threshold, only when the unit claims a speed or resource change.>
- [ ] `npm run check` passes.

## Close

- [ ] Every box above is checked with its evidence.
- [ ] Feature docs, verification map and decision record updated.
- [ ] Task report written per `.agents/skills/verify-rex/references/report-template.md`.

## Appendix A. Experiment evidence

<Each question a throwaway check answered, with the command and observed result. Each question still unproven.>

## Appendix B. Alternatives rejected

<Each approach weighed and why it lost.>

## Appendix C. Risks

<Each risk, the unit it lands in and what to watch.>
```
