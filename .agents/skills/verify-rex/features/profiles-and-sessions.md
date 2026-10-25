# Profiles and sessions

Users select a profile in the first line of a request, perform permitted work and return to that profile's conversation without automatically mixing another profile's history.

## Preconditions and entry points

The normal user entry is `npm run sandbox -- rex` with an input beginning `profile: <id>` and a nonempty task; `--new-session` requests a fresh conversation. Normal sandbox calls may use paid models. Deterministic checks use invented fixtures and the disposable synthetic stack; model-dependent QA uses real inference under the root standing approval and low-cost model policy. Select QA models in isolated test configuration/state rather than changing active profile defaults.

## Repeatable checks

- Run `npm run test:profiles` for validated lookup, malformed/missing profiles, immutable concurrent scopes and cancellation.
- Run `node --import tsx --test packages/pi-profiles/tests/adapter.test.ts packages/pi-profiles/tests/boundaries.test.ts` for actual SDK tool effects, forged denied calls, separate/resumed/new histories, locks, failures and cancellation.
- Run `npm run verify -- sandbox` to build and exercise the installed `rex --new-session` command under synthetic inference, including selector rejection, cap-free requests, truncation reported on stderr with exit 1 and no partial stdout, and a successful resumed request. The suite also checks installed SDK response handling through a private loopback fake provider and asserts Pi's installed version and read-only runtime/package boundaries.

## Expected observations

A coding write produces the exact file contents; research reads the evidence but denied tools cannot change files. A resumed profile sees its own earlier marker, not the other profile's marker. New-session retains old history without loading it. Same-profile contention makes no second model call; independent profiles retain their own identity. Cancellation and ordinary failure release the turn lock.

Requests must not include a blanket output-token cap. A provider-truncated answer rejects with `IncompleteProfileResponseError`, not successful partial output. Truncated tool arguments must not execute or trigger another inference request. A truncated final summary does not roll back earlier completed tool actions or automatically repeat them; the public message warns about those effects. The lock must be released and a subsequent user request must recover. Keep these cases as regressions, including empty length-stopped output.

## Gotchas and coverage limits

The installed CLI acceptance currently proves a synthetic text request and selector rejection; richer write/history/cancellation scenarios are exercised through the real SDK tests, not every installed CLI entry point. For changes to CLI parsing, stdin, session flags or output, add and drive the affected CLI path before claiming it verified. Synthetic text is not evidence of real-model reasoning or useful generated code. Shared filesystem access is not profile confidentiality. Never break a normal user's lock or delete their history to make a test pass.
