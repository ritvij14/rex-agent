# Sandbox experiment instructions

Scope: `lab/` and its descendants. Inherit the [root instructions](../AGENTS.md). The terminal-only experiment is implemented in `terminal/`; read its scoped guide before working there. These requirements also govern new experiments.

## Before an experiment runs

Create `lab/<experiment>/AGENTS.md` with the first runnable experiment. Its guide must specify:

1. Purpose, pinned runtime/image versions, and what the experiment is intended to verify.
2. Allowed mounts, network destinations, environment-variable names, tool permissions, and resource limits. State what must remain inaccessible; configuration separation alone is not evidence of isolation.
3. Exact start, verification, and stop commands that exist. Document any approval needed before host or account access; do not start services as a side effect of loading an extension or reading instructions.
4. Tests proving both allowed access and denied access, plus failure, restart, and retry behavior relevant to the experiment.
5. Private state/volume locations and cleanup commands. Distinguish stopping a process from deleting state; destructive cleanup needs explicit approval and must not affect unrelated experiments.

Store reproducible definitions and synthetic fixtures here, not runtime volumes, logs, snapshots, or login material. Record actual isolation-test results rather than assuming a container definition is safe. Necessary model inference QA through the existing proxy is covered by the root standing approval and low-cost model policy; it is not default CI. Account management or new external resources still require separate approval.

Shared helper folders do not need another guide when these rules already cover them. Add deeper instructions only if an actual experiment has a distinct boundary that its parent guide cannot describe correctly.
