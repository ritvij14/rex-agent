# Profiles

## Implemented boundary

`@rex/profiles` provides validated profile lookup, immutable per-turn asynchronous scope, a versioned configuration schema with `SOUL.md` persona files, shared operator defaults, prompt-selector parsing and pure tool-policy evaluation. It uses Node built-ins only. `@rex/pi-profiles` separately connects that contract to Pi 1.3.0 through a one-request SDK command in the terminal sandbox.

The command requires the first line `profile: <id>`, followed by a nonempty task. There is no natural-language guessing or default profile. Model fallback is limited to explicitly configured pre-response temporary failures. The Jev router, memory engine, MCP configuration and Pi Durable are not implemented. The existing Pi TUI remains an unprofiled baseline; `rex` is the profile-selected interface.

## Shared configuration and minimal SOUL profiles

A profiles root may contain an operator-owned `shared/` directory. `shared` is a reserved profile ID. The directory holds an optional `REX_SOUL.md` persona applied to both legacy and version-2 profiles and a required `configuration.json` with `{ "version": 2, ... }` and any of `model`, `tools`, and `mandatory.tools.blacklist`. Model and tool rules follow the same validation as profile definitions. Anything the shared directory misparses fails closed with `INVALID_SHARED_CONFIGURATION`; a missing root fails with `SHARED_CONFIGURATION_UNAVAILABLE`.

The minimal runnable profile is one file: `<profiles-root>/<id>/SOUL.md` (a regular non-symlink file of at most 16384 bytes with non-whitespace content). No `profile.json` is needed; the shared model and tool defaults apply. An optional `<id>/profile.json` with `{ "version": 2, "id": "<same-id>", "model"?, "tools"? }` replaces shared defaults field-by-field. Overrides follow two deliberate rules: a configured whitelist replaces the shared whitelist (grants are replaced), while blacklists are unioned with the profile's list, the shared list and the mandatory blacklist in that order, so neither the profile nor the shared defaults can weaken mandatory denials. Whitelists and blacklists are still bounded to 64 rules each.

`resolveEffectiveProfile(profile, shared)` produces the frozen effective `{ instructions, model, tools }`: shared `REX_SOUL.md` and profile `SOUL.md` are concatenated (`shared + "\n\n" + own`), the model resolves profile-override-first, and tool policy resolves as above. Resolution fails with `PROFILE_INCOMPLETE` when no model can be determined or when a legacy `{ "id" }`-only profile is resolved. Instructions remain literal text, never executable resources, and permission enforcement stays outside the model; `SOUL.md` cannot grant tools.

Version 2 definitions reject inline `instructions` together with `SOUL.md` (contradictory sources are invalid) and any field outside `id`/`version`/`model`/`tools`/`limits`/`resources`. A version field other than 2 fails with `UNSUPPORTED_PROFILE_VERSION`. Resource files remain future units. Model references may include overrides, ordered fallbacks, and thinking settings as described below.

## Operator model catalog

The optional shared `models` array supplies metadata for models served by the existing `cli-proxy` relay. Each entry contains exactly `id`, `api`, `contextWindow`, `maxOutputTokens`, and `reasoning`. Supported APIs are `openai-completions`, `openai-responses`, and `anthropic-messages`. IDs are unique, the catalog contains 1–64 entries, context windows are positive integers at most 10000000, and output limits are nonnegative integers no larger than the context window. Anthropic requires a positive output limit. Zero leaves OpenAI output limits unset. No catalog entry can supply an endpoint, headers, or credentials.

When a catalog exists, a selected model missing from it is rejected before inference. Without a catalog, existing profiles retain the original OpenAI-compatible metadata. Catalogs are operator-owned shared settings, copied into the selected worker snapshot and included in the shared approval digest. They declare tested metadata; loading them does not contact a provider or independently verify advertised capabilities. Turn limits are configured separately from catalog metadata. A model reference may configure `thinking` as `off`, `minimal`, `low`, `medium`, or `high` (default `off`). Non-off thinking requires catalog reasoning capability on every candidate before inference; unsupported selections fail closed. The configured level is reapplied when falling back. Catalog capability is an operator declaration, not proof of model reasoning quality.

## Per-request model choice

A model reference can include an optional `overrides` array of up to eight unique model IDs. `rex --model ID` selects one only for the current request, and the SDK accepts the equivalent `modelOverride`. The requested ID must be in that reference's allowlist and the shared operator catalog; without a catalog, request overrides fail closed. A catalog entry alone does not authorize selection for every profile. Selection does not rewrite definitions, personas, tools, or the default used by the following request. CLI output and persisted Pi model selection identify the actual model used. Flags may precede the profile input in either order; duplicate, missing, and unknown flags are rejected. Model override is a trusted caller argument, never extracted from task text.

## Safe fallback

A model reference may declare up to four unique `fallbacks` IDs in order, excluding the primary. Every candidate must exist in the operator catalog before inference begins. An explicit `--model` selects that model alone and disables fallback. Temporary failures qualify only for structured HTTP status 429, 502, 503, or 504 before any text, thinking, or tool-call content has streamed and before any tool call starts. Authentication/validation errors, transport failures with no status, truncation, cancellations, failures after tool activity, and turns with installed executable extensions do not qualify. There is no automatic replay of side effects.

All attempts share one profile lock, deadline, request budget, and tool policy. Before trying the next candidate, Pi branches away from the failed attempt and rebuilds context before resubmitting the same user request. The active history contains the request once; abandoned attempt records remain private. The SDK returns ordered `attempts`, and the CLI prints `model-attempts` when fallback occurred. The next request starts from the configured primary again, retaining the successful conversation. No fallback runs after the candidate list is exhausted.

## Selected skills and templates

`resources` may contain `instructions`, `skills`, and `prompts` path arrays; the combined maximum is eight unique Markdown files per shared/profile bundle. Skill paths end in `/SKILL.md`. Skills need valid name/description frontmatter. Shared skills and prompts are always included; same-name metadata collisions fail before inference rather than silently shadowing a shared entry. Malformed metadata and skills without an allowed read tool also fail closed.

Only selected skills are advertised by description; their bodies stay out of context until the read tool or explicit `/skill:name` invocation loads them. Only selected prompts become `/name` commands with Pi argument expansion. Skills, prompt files and their bytes are included in the same resource digest/snapshot rules as instructions. The adapter passes explicit skill paths with includeDefaults false and explicit template paths while default discovery stays off. No host/project skills, templates, packages or executable helpers are discovered. Skill text and allowed-tools frontmatter cannot grant tool authority; the execution policy still blocks denied calls.

## Operator-installed executable extensions

Shared `extensionCatalog` lists 1–16 entries with exactly `id`, `sha256`, and `tools`. IDs are bounded lowercase kebab-case, integrity is an exact 64-character lowercase SHA-256, and each entry declares up to 32 unique tool names. Duplicate IDs/tools are rejected. Shared or profile `resources.extensions` explicitly selects up to eight IDs; shared selections remain required. No entry may supply a path, URL, command, environment or package-install request.

The SDK caller supplies trusted `installedExtensionsRoot`; the CLI fixes it to `/opt/rex/operator-extensions`. The operator installs immutable `<id>.mjs` files there, not inside profile definitions or the workspace. Selected entries must exist, be regular non-symlink files of at most 65536 bytes, and match the catalog. All selected hashes/metadata are preflighted before any module is imported. Unselected files are never scanned/imported. Modules export a Pi extension factory; their registered tool names must exactly match the catalog and cannot replace built-ins or revise_profile. This experiment ships an invented fixture module for acceptance, but no normal profile selects it automatically.

Tool-name whitelist/blacklist enforcement includes registered custom tools and nested ctx.executeTool calls. Approval refuses added custom-tool grants. Reviewing a draft validates its shape/provider; approval and execution validate operator tool availability. Extension references and catalog integrity participate in bundle/shared approval digests. Code bytes are not copied into a persona draft. No download, installation, dynamic resource discovery or background service is started by Rex loading a selection.

**Trust limit:** an installed extension is trusted executable code with the process's OS authority, not a sandboxed instruction file. The operator must review its code and pinned dependencies, prohibit factory-time background services, and keep its installed root immutable. Entry-point SHA-256 does not seal transitive imports. In workers, read-only image code and private mounts supply isolation; plain SDK callers have no OS sandbox. Managed-agent turn limits do not constrain arbitrary direct requests/side effects from trusted code or an allowed shell. Cancellation of such code is cooperative; the independent worker deadline remains the hard process boundary. Automatic fallback is disabled when installed executable extensions are selected, because their lifecycle hooks may already have side effects before an HTTP failure.

## Own-workspace instruction opt-in

`resources.workspaceInstructions` explicitly names relative Markdown files such as `AGENTS.md` in the selected profile's workspace. Shared and own lists are unioned, preserving order and removing duplicates. There is no ancestor search or automatic loading of AGENTS, SYSTEM, .pi, or .agents files. A missing selected file, absolute/traversing path, symlinked file/ancestor, whitespace-bearing reference, blank/nonregular file, or exceeded file/text bound rejects the turn before inference. Paths allow common project Markdown names, but never `.` or `..` segments. At most eight unique workspace files are read, 16384 bytes each and 65536 bytes combined.

Text is read once after the profile lock is acquired and appended to the effective instructions. Changing the workspace file during a turn does not change that turn's frozen instructions; the next turn rereads it. Tool policy remains independent. Approval hashes the configured path opt-in, not mutable workspace contents: these are dynamic project files, not active-definition bundle files. The SDK caller must supply the correct trusted workspace; operator-launched workers mount only their own workspace, with no new host mounts or cross-profile reads.

## Turn limits

Optional `limits` fields are `deadlineMs` (100–180000), `maxRequests` (1–64), and `maxHistoryBytes` (1024–1048576), all integers. The defaults remain 90000 ms, 12 requests, and 131072 admitted history bytes. Shared `limits` supplies defaults. Version-2 profile `limits`, or legacy `configuration.limits`, overrides them field by field. These are not provider output-token caps. Unknown fields and out-of-range values fail closed.

The SDK deadline starts after profile selection and lock acquisition and includes session setup and all inference/tool/fallback attempts. Caller cancellation may end a turn sooner. The host worker still has a separate 240-second execution bound. Exhausting requests or the deadline aborts the turn and releases its ordinary lock; completed tools are not rolled back. History admission checks the UTF-8 JSON size of loaded messages before the new prompt; excess history requires a new session, not silent truncation. Profile limits survive provisioning, SOUL revision, digest review, and activation. The self-maintenance tool does not edit limits.

## Explicit shared and profile text resources

`loadInstructionResources(root, id, paths)` validates the selected profile first, then reads only the named Markdown paths in order. Paths must start with `resources/`, use lowercase kebab-case directories, and end in a lowercase `.md` filename or `SKILL.md`. At most eight unique paths of at most 200 characters are accepted. Each file is a regular, non-symlink, nonempty file of at most 16384 bytes; combined loaded text is bounded to 65536 bytes. Symlinked ancestors, traversal, absolute paths, missing files and invalid references fail with a fixed diagnostic. No neighboring file is discovered or loaded.

Configure `resources: { "instructions": ["resources/checks.md"] }` in shared configuration, a version-2 manifest, or legacy `configuration`. The referenced files live below that same shared/profile directory. Effective instructions combine shared REX_SOUL, shared files, own SOUL/inline persona, then own files in declared order. Shared files are always included; a profile cannot remove them by supplying an empty own list. References do not grant tools or enable host/project discovery.

Lookup reads and freezes only selected files. Provisioning copies those bytes, not arbitrary neighboring files, into the read-only worker snapshot. Whole-bundle approval digests include the profile references and content; the shared digest also includes shared file content. A changed resource invalidates review or a stale update. Maintenance preserves resource references/content without editing them. The trusted `createProposal` API accepts validated resource-file records as its sixth argument (after optional SOUL); the builder tool does not author resource files yet. The operator helper snapshots and activates the same resource bundle. The operator must keep definitions immutable while reading; the worker snapshot remains the filesystem isolation boundary. Profile-authored executable helper files are not supported; executable code must be operator-installed as described below.

## Definitions and lookup

The caller supplies an absolute profiles root. A validated ID maps directly to `<profiles-root>/<profile-id>/`, with no profile aliases or custom per-profile paths. IDs contain 1–64 lowercase ASCII letters/digits and single separating hyphens, starting with a letter. Root paths are trimmed/canonicalized; IDs are not corrected. Missing, mismatched, malformed or symlinked homes/definitions fail without substitution. Definitions must be regular files of at most 4096 bytes, including whitespace. Lookup failures use fixed codes/messages rather than echoing input or filesystem diagnostics.

The original `{ "id": "coding" }` definition remains valid for core scope tests but is not runnable through Pi. A runnable, synthetic version-1 definition is:

```json
{
  "id": "coding",
  "configuration": {
    "instructions": "Help with coding tasks in this container.",
    "model": { "provider": "cli-proxy", "id": "glm-5.3-flash-cloud" },
    "tools": { "whitelist": ["*"], "blacklist": ["propose_profile"] }
  }
}
```

Configuration requires all three fields: literal instructions (1–2000 characters with non-whitespace content), a provider/model ID, and whitelist/blacklist arrays. Each rule array has at most 64 entries. Unknown fields, incomplete configuration, command-like model IDs, unsupported tool patterns and invalid rule types are rejected. Configuration and copied rule arrays are deeply frozen. Instructions are literal text, never file references or executable resources.

Lookup reads only this definition and metadata; it creates no state or directories and never reads another profile's sessions or a credential store. The Pi adapter owns its explicit private session/proposal writes.

## Public core API

Import through `@rex/profiles`, never internal files. Root tooling runs this private source-only workspace through pinned `tsx`; no emitted distribution build exists.

| API | Contract |
| --- | --- |
| `loadInstructionResources(root, id, paths)` | Read only explicitly selected `resources/*.md` files beneath a validated profile; ordered frozen results, no discovery |
| `lookupProfile(root, id)` | Return frozen `{ id, home, configuration?, soul?, model?, tools? }` after validation |
| `loadSharedConfiguration(sharedRoot)` | Validate and freeze configuration from the explicitly supplied shared directory |
| `resolveEffectiveProfile(profile, shared?)` | Pure composition of shared defaults, SOUL personas, overrides and mandatory denials |
| `new ProfileRuntime(root)` | Own independent asynchronous turn storage |
| `runtime.run(id, work, { signal? })` | Look up the selected ID and run the complete callback under its fixed profile |
| `runtime.current()` | Return the current profile; reject missing, closed or cancelled scopes |
| `parseProfileDefinition`, `parseSharedConfiguration`, `parseProfileRequest`, `isToolAllowed` | Validate data, require the selector, and evaluate tool rules without Pi |

`validateProfileId`, `ProfileError`/`ProfileErrorCode` and the profile/configuration/policy/run-option types are also exported. Definitions are revalidated for every turn; a running turn keeps its frozen selection. The runtime accepts an ID, not a caller-fabricated home.

Concurrent turns retain their own profile through asynchronous operations created inside their callbacks. Ending/failing one turn does not close another; separate runtime instances cannot read each other's scope. Nested turns on the same runtime are rejected. Once work settles, retained asynchronous operations see a closed context, not a subsequent turn's profile, and cannot start another turn from that retained scope. The core never changes environment variables or the working directory.

Cancellation is cooperative. Pre-aborted work never starts; a signal is checked again after lookup, by `current`, and after the callback returns. `run` waits for the callback to settle. It does not terminate arbitrary detached JavaScript or revoke paths already returned. Callback exceptions and abort reasons propagate unchanged; adapters must keep private diagnostics out of public output. Context does not automatically cross unrelated event callbacks, processes, threads or restarts.

## Tool rules and the shipped profiles

Rules are exact, case-sensitive tool names or the whole rule `*`; partial globs and path/command rules are not supported. A tool needs a whitelist match and no blacklist match. An empty whitelist denies everything; a blacklist `*` denies everything. A wildcard covers only the adapter's installed, operator-approved catalog, never arbitrary Pi resources.

| Profile | Whitelist | Blacklist |
| --- | --- | --- |
| `coding` | `*` | `propose_profile` |
| `research` | `read`, `ls` | `bash`, `write`, `edit`, `propose_profile` |
| `qa` | `read`, `ls`, `bash` | `write`, `edit`, `propose_profile` |
| `profile-builder` | `read`, `ls`, `propose_profile` | `bash`, `write`, `edit` |

All four use `cli-proxy/glm-5.3-flash-cloud`. The initial catalog is `read`, `bash`, `edit`, `write`, `ls`, and `propose_profile`. Pi's `grep`/`find` tools require additional downloaded binaries, so they are not exposed; coding can use the container's ordinary shell commands instead. Research is local-document research, not internet browsing. `qa` can run local checks through the shell, but its write, edit, and profile-creation tools stay denied. A shell can still change files inside its own container; it cannot see another profile's storage.

The adapter filters model-visible tools and checks policy in Pi's execution hook. Unsupported names are rejected before inference; forged denied calls cannot invoke a tool. Automatic resource discovery, Codemode, MCP and user-shell shortcuts are not exposed by this command. No model instruction can override tool policy.

Tool-name policy alone is not filesystem confinement: an allowed `bash` can perform file operations without Pi's `write` tool. The operator-side `rex` launcher now supplies the filesystem boundary through separate networkless worker containers. Each worker mounts only its own workspace, state, drafts and read-only definition snapshot, plus the inference socket. The snapshot contains only the selected profile and shared operator configuration; `/profiles` uses Docker's `nocopy` option so a new snapshot cannot inherit all image templates. Provisioning copies validated definition/persona data, not arbitrary files or symlinks. Other profiles' paths, histories and private storage are not mounted, even when shell tools are allowed.

The unprofiled baseline no longer mounts aggregate definitions or drafts; the profile CLI rejects a definitions root containing multiple profiles. The plain SDK and core remain libraries, not sandboxes. Docker and the kernel are trusted; the boundary does not claim protection against runtime exploits or operator-controlled copying. Memory remains unimplemented, but any future memory files stored in the profile's private state inherit the same filesystem separation.

## Pi sessions and limits

The adapter wraps the entire SDK prompt/tool loop in `ProfileRuntime.run`. It supplies an explicit relay-only model runtime, in-memory settings, literal profile instructions and profile-specific session storage. It loads no host authentication/settings or project instructions/extensions/skills/templates. Sessions resume only under `/state/profiles/<id>/sessions`; `--new-session` starts another history without deleting prior sessions.

An operator-owned exclusive lock in the host temporary directory covers provisioning and the worker lifetime. A deterministic Docker container name independently prevents a new turn from overlapping an orphan worker after a client crash; the operator removes only that exact worker during cleanup before releasing the lock. Neither the host lock nor Docker control is exposed to the model. Different profiles may run concurrently. The adapter's existing `turn.lock` remains a second history guard. An abrupt crash can leave a stale host/adapter lock or worker; an operator must confirm no turn is running before recovering it. Never automatically break a lock or delete profile history.

The command has a 90-second deadline, a maximum of 12 inference requests per turn, disabled retries/automatic compaction/cache warming, and a 128 KiB serialized-history admission limit. Start a new session when that limit is reached. The adapter retains conservative 32768-token context metadata but sends no `max_tokens` or `max_completion_tokens` output limit; response limits are chosen by the proxy/provider, subject to the selected model's capabilities. Pi 1.3.0 requires numeric output metadata, so this OpenAI-compatible adapter uses zero to omit that request field rather than inventing a universal response cap. Provider pricing is not configured; zero SDK catalog costs do not imply free inference.

A provider response ending with `stopReason: "length"` aborts the turn with the exported `IncompleteProfileResponseError`. The CLI exits with status 1, prints a fixed truncation message to stderr and does not print the partial answer as successful output. This also stops automatic continuation after truncated tool arguments. The lock is released and the next user request can resume normally. Complete tool actions from earlier responses are not rolled back or repeated; the error explicitly warns that they may already have completed. Inspect resulting state before deciding what to request next. Removing the client output cap does not prevent the provider from reaching its own limit.

The installed response-check command uses a private loopback fake provider and temporary test state: `node --import /opt/rex/node_modules/tsx/dist/loader.mjs /opt/rex/packages/pi-profiles/src/verify.ts responses` inside the container. It checks all three profiles, lock cleanup, recovery, refusal of truncated tool calls and absence of output-limit request fields without using the gateway or normal histories. Disposable acceptance additionally drives the actual CLI through synthetic truncation and recovery.

## Drafts and operator approval

The generic starting definitions live in `lab/terminal/profiles/` and seed a private named volume on first creation. Each agent mounts only its selected snapshot at `/profiles` read-only; active definitions are never model-writable. Rebuilding an image does not overwrite existing volume contents.

`propose_profile` accepts a new ID, instructions and tool rules; it inherits the builder's configured model. It validates the complete definition and saves a new draft under `/proposals/<id>/profile.json` together with a provenance record (`provenance.json`) initially written by Rex: operation (`create` or `update`), the originating profile ID, the digest of the active bundle an update amends, and the digest of the shared configuration at draft time. Existing profiles/drafts cannot be overwritten. The worker cannot check other active IDs; the operator checks the master for collisions. The operator selects the builder's private source volume independently and rejects origin or operation metadata claiming another writer or an update. Metadata alone is not trusted authority.

The admission digest covers the whole bundle, not just the manifest: for version-1 definitions it hashes the canonical `{ kind, id, configuration }`; for persona bundles it hashes the manifest fields **and** the `SOUL.md` text. Only the operator runs `review-profile ID` (which now shows the provenance) and then `approve-profile ID DIGEST`. The helper revalidates the draft, verifies the exact digest, and applies the checks matching the provenance operation:

- **Create** requires an unused destination.
- **Update** requires the origin to be the target profile itself, the recorded active-bundle digest to still match (stale or replayed proposals are rejected and the running revision is preserved), and the shared configuration digest to be unchanged.

Activation is atomic per profile: the new bundle is staged beside the destination and swapped in by directory rename, so an interrupted approval never leaves a mixed manifest/persona pair; at worst the profile is briefly unavailable with the previous revision intact for operator recovery. The writable-root API consumes the admitted draft. The installed helper instead snapshots the read-only source into its private temporary storage before calling that API; it consumes the snapshot but retains the original builder draft. Replaying a create approval still fails because the active destination already exists.

A failed activation may leave an unavailable destination requiring operator investigation. Each profile can access its own draft storage, but not another profile's. The operator locks the builder while reviewing or approving its source, snapshots the reviewed contents, checks their digest, and never accepts a model-specified source volume or self-update operation through the builder helper.

The helper is a separate on-demand, networkless container: it mounts definitions writable and drafts read-only, but has no workspace, agent-state volume, inference socket, provider key, Docker socket, capabilities or writable root filesystem. Its root UID is limited to these container filesystems; it is not host execution. The ordinary agent cannot run it or write the active-definition mount. No draft activates merely because the model asks. `rex --maintain` is the only way to expose `revise_profile`. A profile file cannot grant that tool. It drafts a change only for the running profile, and it cannot add tools or edit shared operator files. `review-update ID` and `approve-update ID DIGEST` read only that profile's draft volume, lock that profile, and activate the exact digest into the master. A running turn is not edited; the next launch copies the new revision. A busy profile, wrong digest, expanded tool list, or builder-forged update leaves the active profile unchanged. Maintenance supports both legacy and SOUL profiles. Revising a SOUL profile changes its own `SOUL.md`, preserves omitted model/tool overrides so shared defaults continue to apply, and binds approval to the whole bundle. Blank or oversized SOUL text is rejected before writing the draft.

See [sandbox operations](../infra/terminal-sandbox.md) for exact commands and storage ownership. Real definitions, proposals and sessions stay outside the clone. Worker volume separation protects draft/session storage from other profiles; digest review protects the exact version being approved.

## Verification

`npm run test:profiles` covers core lookup, immutable scopes, shared configuration, SOUL personas, override/mandatory composition and schema/policy/selector rules. `npm test` additionally runs real Pi SDK sessions/tools against a local synthetic endpoint: permitted writes/reads, forced denied calls, separate/resumed/new histories, no inherited executable resources, minimal SOUL profiles resolving shared defaults (and failing closed without them), cancellation/lock cleanup, bounded tool loops, provider failure handling, drafts, provenance-bound admission (create/update/stale/replay/shared-change) and whole-bundle digest admission. No accounts or real private state are needed.

`npm run typecheck` uses strict NodeNext for the core/repository and a separate strict Bundler/DOM configuration for the Pi adapter, because Pi's published declarations include JSON imports and web-provider types. The adapter pins the optional MCP SDK as a development-only declaration dependency required by Google's types; it does not enable an MCP service. Declaration checking remains enabled; no vendored declarations are patched or ignored.

`npm run sandbox -- check` verifies installation through filtered build contexts, the `rex` command, three synthetic profile/model runs, read-only active definitions, operator-helper restrictions, digest-bound activation and persistence across recreation, alongside the existing host/network/resource checks. It uses and removes only its own invented disposable resources. Live model acceptance is separate from CI and follows the root standing approval for necessary low-cost inference QA; it does not require another per-run request. Separately approved live GLM 5.3 Flash Cloud checks exercised coding writes, research reads of that invented evidence, and builder draft creation without activation. The authenticated gateway was preserved during installation. The worker suite additionally exercises real CLI shell/read denials, the `qa` shell isolation and denied write, independent concurrent containers, per-profile data persistence, a minimal SOUL profile with shared defaults, and builder-to-operator admission. It establishes the tested Docker filesystem boundary, not router quality, model fallback or live-provider behavior. The earlier live GLM checks used the former shared layout; they do not constitute live acceptance of these new workers. No normal installation refresh or state migration is performed by the tests.
