# Profile mechanism instructions

Scope: this core package resolves explicitly selected profiles and binds one profile to an asynchronous turn. It is not a router, Pi adapter, model fallback engine, authorization service, or filesystem sandbox. Inherit the root and `packages/` instructions.

## Public API and dependencies

`@rex/profiles` exports only `src/index.ts` through its package manifest. Consumers use that public export, not internal paths. The supported API is `lookupProfile`, `ProfileRuntime`, `ProfileError`, definition/request/ID validation, `isToolAllowed`, and their exported types. `src/configuration.ts` owns the pure schema/selector/policy rules; `src/errors.ts` owns fixed diagnostics. The implementation owns filesystem reads and `AsyncLocalStorage`; it must not write profile state, inspect environment variables, change the working directory, or import Pi, Pi Durable, or provider SDKs. Only Node built-ins are required.

The caller supplies an absolute, trusted profiles root. A validated ID maps directly to its child directory; aliases and symlinked homes/definitions are rejected. `profile.json` accepts the matching `id` and an optional complete `configuration` with literal instructions, a model reference and tool whitelist/blacklist. The original ID-only format remains valid for core scopes; the Pi adapter requires configuration. Do not silently accept configuration the package cannot enforce. Detailed behavior and limitations are in [the profile feature document](../../docs/features/profiles.md).

## Turn lifetime

Each runtime has independent asynchronous storage. `run` performs lookup itself so callers cannot supply a forged home. The profile record is frozen and cannot change within the turn. Nested turns on the same runtime are rejected. `current` must fail outside a turn, after its callback settles, and after its abort signal fires. Cancellation is cooperative: the callback must settle before `run` settles, and the package must not claim to terminate arbitrary work or revoke paths already obtained by a caller.

## Checks

Run these commands from the repository root:

- `npm run test:profiles` runs the package's tests through its public workspace export.
- `npm run typecheck` includes package sources and tests in the root strict no-emit check.
- `npm run check` includes the package tests, repository tests, privacy checks, and formatting; CI uses this command too.

Execution/typecheck tools are declared and invoked by the root package. This private source-only workspace has no standalone build, generated files, migrations, external services, or extra package dependencies. npm owns workspace links and lockfile updates.

Build contexts use a deny-by-default `.dockerignore` listing runtime sources/manifests explicitly; update it with real source ownership changes, never include tests, private state or arbitrary directories. Tool policy accepts exact names or the whole `*` rule, with blacklist precedence and no implicit grants; the adapter must enforce execution and host-approved tool availability.

Required regressions cover schema, mandatory first-line selectors and wildcard/blacklist precedence; valid and missing definitions; malformed/mismatched/unsupported configuration; invalid and traversal IDs; directory/definition symlinks; bounded regular-file reads; redacted errors; concurrent profile-specific file reads; missing/closed/nested scopes; exceptions and cancellation; and unchanged process environment/working directory. Use temporary synthetic profiles only, never real profile or account state.
