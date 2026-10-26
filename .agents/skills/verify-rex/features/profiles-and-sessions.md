# Profiles and sessions

Users select a profile in the first line of a request, perform permitted work and return to that profile's conversation without automatically mixing another profile's history.

## Preconditions and entry points

The normal user entry is `npm run sandbox -- rex` with an input beginning `profile: <id>` and a nonempty task; `--new-session` requests a fresh conversation. Normal sandbox calls may use paid models. Deterministic checks use invented fixtures and the disposable synthetic stack; model-dependent QA uses real inference under the root standing approval and low-cost model policy. Select QA models in isolated test configuration/state rather than changing active profile defaults.

## Repeatable checks

- Run `npm run test:profiles` for validated lookup, malformed/missing profiles, shared configuration/SOUL composition (including mandatory policy on legacy profiles), immutable concurrent scopes and cancellation.
- Run `node --import tsx --test tests/profile-provisioning.test.ts tests/sandbox.test.ts` for selected-only snapshots, symlink rejection and host launcher contracts.
- Run `node --import tsx --test packages/pi-profiles/tests/adapter.test.ts packages/pi-profiles/tests/boundaries.test.ts` for actual SDK tool effects, shared-default SOUL profiles, forced denied calls, separate/resumed/new histories, locks, failures and cancellation.
- Run `npm run verify -- sandbox` to build and exercise the installed `rex --new-session` command under synthetic inference, including selector rejection, cap-free requests, truncation reported on stderr with exit 1 and no partial stdout, and a successful resumed request. The suite also checks installed SDK response handling through a private loopback fake provider and asserts Pi's installed version and read-only runtime/package boundaries.

## Expected observations

A coding write produces the exact file contents and persists across workers. Research cannot read the coding profile's configuration or workspace: each worker gets only its own volumes and selected read-only snapshot. The fake provider verifies actual tool results, not a model claim of success. A resumed profile sees its own earlier marker, not the other profile's marker. New-session retains old history without loading it. Same-profile contention makes no second model call; independent profiles retain their own identity. Cancellation and ordinary failure release the turn lock.

Requests must not include a blanket output-token cap. A provider-truncated answer rejects with `IncompleteProfileResponseError`, not successful partial output. Truncated tool arguments must not execute or trigger another inference request. A truncated final summary does not roll back earlier completed tool actions or automatically repeat them; the public message warns about those effects. The lock must be released and a subsequent user request must recover. Keep these cases as regressions, including empty length-stopped output.

## Gotchas and coverage limits

Installed worker acceptance now covers real writes, shell/read cross-profile denials, separate volumes and process namespaces, simultaneous worker containers, host-lock/container-name contention, truncation/recovery, persistence and minimal SOUL profiles. The unprofiled baseline rejects the profile CLI. SDK-only calls do not establish filesystem isolation, and synthetic inference does not establish live-model quality. The normal master still does not seed shared defaults automatically; acceptance provisions invented shared configuration in its own master. Old shared data is not migrated. Abrupt operator or SDK termination can leave locks requiring specific recovery; never delete histories or auto-break locks. The explicit CLI guard was observed failing before implementation (the shared baseline returned status 0 instead of rejecting), then passing after the guard.
