# Terminal sandbox and recovery

The terminal environment permits container work and fixed inference access while denying host mounts, privileged operations, direct external networking and proxy management access.

## Preconditions and entry points

Node 22, locked local dependencies, scanner setup and a running Docker engine are required. The normal sandbox is named `rex-terminal`; verification never starts, resets or reconfigures it. Read `lab/AGENTS.md`, `lab/terminal/AGENTS.md` and `docs/infra/terminal-sandbox.md` before changing this boundary.

## Repeatable checks

- Run `node --import tsx --test tests/sandbox.test.ts` for gateway routing/input rejection, credential stripping, configuration and launcher contracts.
- Run `npm run verify -- sandbox` for newly built containers in a unique `rex-terminal-check-*` project. The existing suite launches a fake inference service and uses no live proxy or model.

## Expected observations

Installed Pi and Rex run as intended; writable synthetic files are visible on a second read. Root/package/definition paths reject writes. Containers have no host bind mounts, published ports, capabilities or privilege escalation. Direct networking and management access remain denied. Stopping the test gateway produces the expected failure; restarting it recovers. Persistent files survive sandbox recreation, while temporary files do not. Resetting only the newly created test volumes removes synthetic persistent state.

The command's final cleanup removes its own containers and volumes. The outer verification runner retains logs and the source-fingerprinted report outside those containers. Confirm both cleanup and retained evidence; a successful final message alone is not proof of the changed boundary.

## Gotchas and coverage limits

Docker builds may need public registry access. Missing Docker, failed builds and unavailable dependencies block coverage rather than pass it. Never run Compose config/inspect output that exposes credentials, Docker prune, the normal reset command or broad process-name cleanup. If a run is killed, identify its exact unique project from its private log before proposing cleanup. Normal volumes and gateway authentication remain untouched. Synthetic inference proves wiring, not paid-provider availability or quality.
