# Decisions

## 001: Public implementation, private application data

**Decision:** reusable code and synthetic examples belong in Git. Real memories, credentials, profile instructions, transcripts, and account state belong outside the clone.

**Reason:** reproducible development does not require publishing the owner's data. Ignore rules alone cannot protect already-tracked files or Git history.

**Tradeoff:** personal setup must be loaded separately once a runtime exists. Public checks cannot reproduce private account behavior and must not claim to do so.

**Revisit:** only for a concrete data requirement, never to make publication easier.

## 002: A clean Pi-focused starting point, not a public Hermes archive

**Decision:** previous source and original notes are preserved locally in an ignored holding folder. New GitHub history should start with reviewed new work, not include rollback branches, tags, or snapshots of the previous implementation.

**Reason:** this repo should version Rex's new development, not expose historical personal material or maintain an unused compatibility layer.

**Tradeoff:** replacing existing history is destructive and requires a separate reviewed operation. Moving local files alone does not make the existing remote safe to publish.

**Revisit:** importing a specific old algorithm requires a sanitized, tested port, not uploading the old folder or its history.

## 003: Plain TypeScript libraries with runtime adapters

**Decision:** future router, profiles, and memory use ordinary TypeScript with no Pi imports. Separate adapters connect the same rules to Pi Coding Agent and Pi Durable.

**Reason:** those runtimes have different extension contracts. Memory should not need a rewrite when the execution engine changes.

**Tradeoff:** adapters need integration tests. Do not build abstractions or choose runtime dependencies until the first actual package needs them.

**Revisit:** after a working coding experiment reveals a boundary that does not fit.

## 004: Small explicit development tools, installed deliberately

**Decision:** use npm workspaces, exact tool versions and a lockfile; disable lifecycle scripts. Use TypeScript/Node tooling for snapshot/privacy checks, pinned Gitleaks for secrets, Prettier for supported text, and explicit local Git hooks plus read-only CI. The initial Python implementation was replaced by the TypeScript approach in decision 006.

**Reason:** reuse the template's clear documentation and testing workflow without copying Claude-only hooks, unrelated web-app layers, mandatory subagents, or unimplemented checks.

**Tradeoff:** hooks need installation in every clone; scanners cannot recognize every private fact. Repository checks do not replace future application package typing/linting/tests.

**Revisit:** when actual package code or measured tool limits justify more tooling.

## 005: Setup documentation when needed, not a separate examples folder

**Decision:** this repo houses Pi customization code and sandbox definitions. Do not maintain a standalone examples directory. Once the system works and demand justifies it, add a setup manual under `docs/` written so a coding agent can follow the exact steps.

**Reason:** the actual implementation and sandbox configuration are the reproducible setup. Separate demonstration files would add duplication before there is anything useful to demonstrate.

**Tradeoff:** no end-to-end installation manual is promised at this foundation stage. Future instructions must distinguish public configuration from private values and include verification and permission boundaries.

**Revisit:** when a working system and a concrete setup need exist.

## 006: TypeScript tooling without emitted JavaScript

**Decision:** prefer TypeScript for scripts and tests as well as application code. Execute through pinned `tsx`, test with Node's built-in runner, and run strict TypeScript checks with `noEmit`. Keep shell only for tiny Git entry points and Gitleaks for specialized secret detection.

**Reason:** Node is already required for Rex. Python offered convenient standard-library tools but no project-specific benefit sufficient to justify another runtime. The owner prefers TypeScript when it serves the same purpose.

**Tradeoff:** TypeScript execution and typechecking are separate commands. `tsx` adds a locked dependency and an ignored temporary transform cache, not generated `.js` files in the source tree. Scanner installation uses system `tar` rather than adding an archive library. Future published packages may still need their own builds.

**Verification requirement:** retain every privacy rejection case, actual-hook coverage, and fresh-setup verification. A language migration must not weaken staged-content/history checks, checksum validation, or diagnostic redaction.

**Revisit:** when a concrete use case is materially better served by another language, not merely for convenience.

## 007: Always-on rules in AGENTS.md, operational detail in docs

**Decision:** keep concise architecture and building-in-public requirements directly in `AGENTS.md` so they apply in every session. Keep security reporting and incident handling in `docs/infra/security.md`. Project planning is tracked separately by the owner, not maintained as a repository document.

**Reason:** architectural and privacy constraints must not depend on an agent deciding to open another document. Feature and infrastructure docs remain for implementation details, testing, and procedures, rather than competing copies of core rules.

**Tradeoff:** `AGENTS.md` is longer, but always contains the essential constraints. Keep it concise, avoid duplicated policies, and update references whenever documents move.

**Revisit:** if operational detail starts obscuring the mandatory rules; shorten or relocate that detail without hiding the rules themselves.

## 008: Scoped AGENTS.md at real working boundaries

**Decision:** retain one public root README and use `AGENTS.md` for directory-specific working rules. The current workspace-container and sandbox-container guides live in `packages/` and `lab/`. Documentation follows the root instructions without its own scoped guide. New package or runnable experiment implementations require their own local guide; other directories need one only when a concrete constraint differs from inherited instructions.

**Reason:** agents need the rules that apply to their target files without reading repeated directory introductions. Root architecture and privacy requirements remain always applicable, while local commands, ownership, and execution boundaries belong near the affected work.

**Tradeoff:** agents must discover and read ancestor guides explicitly; do not assume every harness loads them. Child files supplement parents and cannot relax root safety rules. Structural checks can enforce README/package-guide placement, but judging whether a deeper boundary warrants instructions still requires review.

**Revisit:** when real package or experiment boundaries change. Remove stale guides rather than adding instructions to every directory or creating placeholders.

## 009: Public commit email by choice; MIT license

**Decision:** the owner approves using their own email in public Git metadata; noreply is optional, not mandatory. Identity metadata remains secret-scanned, while repository content and commit messages retain personal-data checks. The project uses the MIT license.

**Reason:** a deliberately public author identity is not a private account credential. This approval does not permit publishing other people's personal data or authentication material.

**Verification:** a personal-email commit and clean history must pass, but credential-shaped identity data must still fail without printing the match.
