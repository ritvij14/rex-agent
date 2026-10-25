# Workspace package instructions

Scope: `packages/` and its descendants. Inherit the [root instructions](../AGENTS.md). The core library `profiles/` implements profile lookup/scope/configuration/policy, and `pi-profiles/` connects it to Pi SDK sessions and operator-approved drafts. Read each scoped guide before working there. Other package boundaries require real implementations, not placeholders.

## Creating a package

Create `packages/<name>/AGENTS.md` with its first implementation or package manifest. Its local guide must identify:

1. The package's responsibility, whether it is core logic or an adapter, and which files own its public API and side effects.
2. Supported exports and allowed dependencies, including which external services or runtimes it connects to, if any.
3. Exact typecheck/test/build commands that actually exist, and how they participate in root checks and CI.
4. Required successful, rejected, and failure cases, including permission or data-isolation boundaries where relevant.
5. Any local generation or migration procedure and its limits. Do not invent commands or add a guide for an empty future package.

## Package integration

Keep new manifests `private: true` until publication is approved. Declare exports and dependencies explicitly; do not depend on undeclared root tools or another workspace's internal files. Add exact versions through npm and update the shared lockfile using npm, not hand edits.

`npm run typecheck` checks core/repository code with root NodeNext and the Pi adapter with its strict package-specific Bundler/DOM configuration; neither skips declaration checking. Root tests include `packages/*/tests/*.test.ts`; CI runs both through `npm run check`. Put tests for new packages under their own `tests/` directory and import their public exports. Add any additional real package checks when its implementation requires them; do not report a package as verified merely because repository tooling passes. If a package needs emitted distribution files, document that build separately and keep generated output out of source control.

Avoid guides in ordinary `src/`, helper, or test subfolders when the package guide already covers them. Split instructions only at a real additional boundary under the root placement rules.
