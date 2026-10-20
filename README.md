# Rex

A memory-first personal agent system, built incrementally on Pi's core libraries.

**Status: repository foundation.** This is not a ready-to-run assistant. Router, profiles, memory, sandboxing, and durable execution are planned, not implemented. The previous Hermes plugin is not part of the public source tree.

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

## Layout

| Path | Responsibility |
| --- | --- |
| `packages/` | Future TypeScript core libraries and Pi-specific adapters |
| `lab/` | Future reproducible sandbox definitions; no real credentials or state |
| `scripts/`, `tests/` | Repository privacy tooling and regression tests |
| `docs/`, `.github/`, `.githooks/` | Design, collaboration, and automated checks |

Read [AGENTS.md](AGENTS.md) for the always-on architecture and building-in-public rules. Feature and infrastructure details live under `docs/`; read [CONTRIBUTING.md](CONTRIBUTING.md) for the change workflow.

## Security and license

Report private information or vulnerabilities using [security documentation](docs/infra/security.md), not a public issue. A sandbox has not been built yet; do not treat this repository or a normal Pi session as isolated from the host.

Licensed under the [MIT License](LICENSE).
