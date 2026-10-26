# Rex

A memory-first personal agent system, built incrementally on Pi's core libraries.

**Status: repository foundation, terminal sandbox, and minimal Pi profiles.** This is not a ready-to-run assistant. The sandbox includes explicit profile-selected Pi SDK runs, separate histories, tool whitelist/blacklist enforcement, and draft creation with operator approval. Synthetic container acceptance and separately approved live GLM profile checks have passed: coding wrote a synthetic file, research read it, and profile-builder produced an inactive draft. Other model/API combinations require their own acceptance. Router, model overrides/fallback, memory, and durable execution are not implemented. The previous Hermes plugin is not part of the public source tree.

## What belongs here

Reusable agent code, safe configuration examples, tests with invented data, and design decisions. Personal memories, account access, conversations, and machine configuration do not belong here. The implementation can be public without making anyone's personal assistant data public.

## Get the development checks running

Requirements: Git, Node.js 22 LTS, npm, system `tar`, and macOS/Linux on ARM64 or x64. Python is not required. Internet access is needed to download locked tools. No model account or API key is needed for these repository checks.

```sh
npm ci
npm run setup
npm run check
```

`setup` downloads a checksum-verified Gitleaks binary into ignored `.tools/` and installs this clone's Git hooks. npm lifecycle scripts are disabled deliberately; setup is explicit. Every contributor must run it; hooks do not install themselves.

| Command | Purpose |
| --- | --- |
| `npm run check` | No-emit typecheck, tests, public-file privacy/secret checks, and formatting |
| `npm run typecheck` | Strict TypeScript checks without generating JavaScript |
| `npm run format` | Format eligible public files only |
| `npm run privacy:check` | Scan the candidate working tree, including new public files |
| `npm run release:check` | Check every commit reachable from local refs, including metadata |

Scripts and tests run directly from `.ts` files through pinned `tsx`; Node's built-in test runner runs the tests. TypeScript checks types separately with `noEmit`, so no build step or generated JavaScript files are needed. Future distributable packages may define their own builds.

A working-tree pass does **not** mean old Git history is safe to publish. The release check is separate and intentionally rejects retained private history.

## Profile core

`@rex/profiles` resolves and carries an explicit profile through one asynchronous turn without changing the process environment. `@rex/pi-profiles` runs that turn through Pi with its own instructions, model, tools and history. Three minimal profiles—`coding`, `research`, and `profile-builder`—use GLM 5.3 Flash Cloud. Tool rules allow exact names or `*`, with blacklist precedence. The operator launches each profile in a separate networkless container with its own workspace, state, drafts and read-only configuration snapshot; other profiles' storage is not mounted. The plain SDK does not enforce this boundary by itself. Synthetic container acceptance covers the new workers; earlier live checks used the former shared layout. See [the profile contract and limits](docs/features/profiles.md).

With the authenticated sandbox running, execute a prompt containing its selector:

```sh
npm run sandbox -- rex $'profile: research\nList the local workspace files.'
```

New workers use the built image and private per-profile volumes. Existing shared histories/workspace are not automatically migrated; do not infer that refreshing moves or isolates old state. `npm run sandbox -- refresh` recreates only the unprofiled baseline while preserving the authenticated gateway and existing volumes. Drafts require a separate `review-profile` / digest-bound `approve-profile` operator action; they never activate automatically. Live runs use the existing model allowance. Account-free tests run through `npm run check` and `npm run sandbox -- check`.

## Terminal sandbox

With Docker Desktop running on macOS, `npm run sandbox -- start` starts a separate Pi environment with an empty workspace and private Docker-managed state. It exposes no application ports and mounts no host folders. Its only external connection is an inference-only forwarding service to the existing local CLI Proxy API; no provider accounts or host Pi settings are copied.

Run `npm run sandbox -- shell` to enter the workspace. Real Pi model use requires operator-supplied inference authentication and an explicit model configuration. `npm run sandbox -- check` verifies the container boundary and Pi inference against a synthetic endpoint without credentials or model quota. See [terminal sandbox operations and limits](docs/infra/terminal-sandbox.md).

## Layout

| Path | Responsibility |
| --- | --- |
| `packages/` | Pi-independent profile core and a separate Pi SDK adapter |
| `lab/` | Terminal-only Pi sandbox definitions and synthetic checks; no real credentials or state |
| `scripts/`, `tests/` | Repository privacy tooling and regression tests |
| `docs/`, `.github/`, `.githooks/` | Design, collaboration, and automated checks |

Read [AGENTS.md](AGENTS.md) for the always-on architecture and building-in-public rules. Feature and infrastructure details live under `docs/`; read [CONTRIBUTING.md](CONTRIBUTING.md) for the change workflow.

## Security and license

Report private information or vulnerabilities using [security documentation](docs/infra/security.md), not a public issue. The terminal experiment's boundary applies only to processes launched inside it; this repository and normal host Pi sessions are not isolated from the host. Live model compatibility is not established by synthetic tests.

Licensed under the [MIT License](LICENSE).
