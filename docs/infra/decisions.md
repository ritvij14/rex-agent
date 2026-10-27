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

## 010: Terminal-only sandbox with the existing model proxy

**Decision:** start with an empty Pi coding workspace in Docker, without a browser, demonstration application, Pi Durable, or copied host configuration. Pin the image and tools. Give the agent no external network interface; permit model requests through a read-only Unix-socket connection to a separate fixed-destination inference gateway. Reuse the Mac's existing CLI Proxy API rather than rebuilding its account/model service.

**Reason:** the sandbox is for developing Rex's harness. Its first acceptance criteria are permitted workspace execution and denied host/network access, not application quality. A host address or internal Docker bridge alone would not enforce an inference-only exception. Gateway restrictions apply even if the agent changes its local relay.

**Tradeoff:** the gateway is trusted code and Docker remains trusted infrastructure. Inference consumes the existing accounts' limits. Live acceptance needs separately supplied client authentication and approval; synthetic success does not prove live model compatibility. Workspace volumes are persistent but do not have individual disk quotas. Additional runtime dependencies require an explicit image change.

**Verification:** deterministic tests reject management routes, URL overrides, credential/forwarding headers, malformed or oversized bodies, redirects, CONNECT, upgrades, and excess concurrency. Real synthetic container checks verify mounts, privileges, resource settings, process-limit rejection, Pi inference, interruption/recovery, persistent recreation, and isolated reset. The CI change adds account-free Docker execution with no repository secrets, new permissions, or uploaded artifacts; rejected access is tested against the actual boundary. See [terminal sandbox operations](terminal-sandbox.md).

## 011: Explicit per-turn profile identity, not process-wide activation

**Decision:** implement the first profile core as a Pi-independent TypeScript package. Every turn supplies an explicit profile ID. Resolve it directly under a caller-supplied absolute profiles root, require a minimal matching `profile.json`, and bind a frozen identity/home through `AsyncLocalStorage`. Missing/invalid profiles never fall back. Reject nested turns on the same runtime and deny context lookup after completion or cancellation, without changing environment variables or the working directory.

**Reason:** a long-running process must support independent concurrent profiles. Changing a process-wide home/current-profile value would allow unrelated turns to affect one another. Keeping lookup/scope independent lets the router later supply the same ID without embedding selection rules in execution.

**Tradeoff:** this is logical context, not an operating-system sandbox or permission system. Provisioning must control the profiles root and definitions; lookup rejects symlinks but does not protect against concurrent hostile directory replacement. Cancellation is cooperative, and previously obtained paths cannot be revoked. Process/thread/restart boundaries require explicit identity transfer by adapters.

**Original boundary:** automatic selection belongs to the future Jev-based router, with user-forced profile/model choices supported separately. The first slice implemented identity/scope only. Decision 012 extends it with minimal configuration and a Pi adapter; primary/ordered fallback models and memory remain separate. See [the implemented profile contract](../features/profiles.md).

**Verification:** public-export tests use real temporary synthetic homes for valid/rejected/bounded lookup, immutable identity, overlapping asynchronous reads, independent runtimes, nested/closed scopes, failure/cancellation, and unchanged synthetic process environment/working directory. Root typechecking and CI include package sources/tests without new runtime dependencies in the core.

## 012: Minimal Pi profile runs, tool policy and operator-approved drafts

**Decision:** connect the profile core through a separate pinned Pi SDK adapter, not by changing a global profile or sharing a session while swapping prompts. Require an exact first-line `profile: <id>` selector until the router exists. Start with generic coding/research/profile-builder definitions on GLM 5.3 Flash Cloud, literal instructions, one model reference and tool whitelist/blacklist. Allow exact names or `*`, with blacklist precedence and default deny, bounded by the adapter's installed tool catalog.

**Reason:** the owner wants working small profiles that evolve with the package. A wildcard avoids exhaustively listing coding capabilities; execution-time checks ensure denied tools cannot be enabled by model instructions. The minimal SDK command makes the whole model/tool loop profile-scoped and preserves separate histories without deeply modifying Pi's TUI.

**Approval boundary:** profile-builder writes validated drafts only. Active definitions are a read-only named volume for the agent. A separate operator-triggered, networkless helper mounts only active definitions and read-only proposals, checks an exact reviewed canonical digest, and creates a new profile without overwriting. Its root UID has no host mounts, Docker socket, inference socket/auth, capabilities or writable root filesystem. A model cannot approve its own permission changes.

**Tradeoff:** permissions cover tool names, not arbitrary files, shell commands or model endpoints. An allowed shell can access shared container files; separate session loading is not filesystem confidentiality. Research initially reads local documents only. Runtime/context/history limits bound this prototype; provider response limits apply as clarified in decision 014; fallback, model overrides, additional resources and existing-profile updates are not implemented. Profile volume contents survive image rebuilds rather than being overwritten by defaults.

**Verification:** core and real SDK tests use synthetic data/providers. Container acceptance covers package-context filtering, the command, all three profile/model selections, read-only definitions, operator-helper restrictions, admission and persistence. Refresh recreates only the sandbox with `--no-deps`, preserving the authenticated gateway. Live GLM tests are separately approved, never CI. Strict adapter-only Bundler/DOM checking accommodates Pi's published provider declarations without `skipLibCheck` or dependency patches; the core remains strict NodeNext.

## 013: Project-local, repeatable verification before broader autonomy

**Decision:** adapt the test-behavior, focused TDD, prove-it-works, verification-creation and maintenance ideas from pstack into project-local Pi skills. Keep one Rex verification recipe and a small map of implemented user journeys. Reuse existing source checks and disposable synthetic container acceptance through a thin evidence runner. The main agent remains the executor; this does not add a QA agent, planner, global installation, browser workflow or automatic publication.

**Reason:** confidence should come from meaningful assertions, actual user-path observations and retained rerunnable evidence, not agent self-reports or more generic instruction text. Project instructions explicitly route implementation work through the skills; simply installing Markdown would not ensure they are used.

**Tradeoff:** skills require judgment and do not enforce authorization or guarantee QA expertise. The runner reports only selected baseline checks; task-specific exploration and sensitivity must be recorded separately. Raw logs stay in an ignored local development holding area and must not be published. Existing failures remain failures; a maintenance pass cannot rewrite product expectations to hide them. Sandbox profiles still do not load project skills.

**Publication impact:** admit only project skill Markdown, the scoped guide and retained attribution license under `.agents/`, not the directory wholesale. Agent settings, executable helpers and runtime data stay denied; all existing private-path/content/link/secret checks remain in force. No ignore rules, hooks, CI permissions or scanner settings are weakened.

**Verification:** validate real Pi skill discovery, actual process success/failure/missing-tool handling, stale/empty/partial-result rejection and retained non-overwriting evidence. Exercise the real installed CLI with the existing fake-provider Docker suite, preserving normal runtime state. Skill effectiveness on future autonomous tasks remains a human-reviewed question, not a claim inferred from parser tests.

## 014: Provider-owned output limits and explicit incomplete-response failure

**Decision:** remove the adapter's arbitrary 1024-token response ceiling rather than replace it with a different universal cap. With pinned Pi 1.3.0 and the OpenAI-compatible API, zero numeric output metadata omits `max_tokens` and `max_completion_tokens`. The provider chooses its output limits. When a finalized response reports `length`, abort the turn and reject with the fixed public `IncompleteProfileResponseError`; the CLI fails explicitly without printing a partial answer as success.

**Reason:** a test budget should not silently restrict ordinary coding responses, and removing that budget does not eliminate provider truncation. Observing the finalized response also stops the SDK from automatically reissuing failed partial tool calls.

**Tradeoff:** this is not unlimited output or atomic execution. Earlier complete tool actions may already have taken effect; they are neither rolled back nor automatically repeated. The public error warns about them. Model defaults, context/history/request/deadline limits and permission rules are unchanged. Installing the change uses a sandbox-only refresh, not a reset or gateway recreation.

**Verification:** regressions demonstrate failing-before and passing-after for partial/empty text, truncated tool arguments and a cut-off final summary after a completed write. Real installed CLI acceptance checks exit status, stderr, suppressed partial stdout and recovery. The installed loopback response check verifies all three profiles and cap-free payloads without paid calls or normal state. Refresh acceptance checks the unchanged gateway and volumes plus persistent synthetic markers and existing history/definition metadata.

## 015: Standing approval for necessary low-cost live QA

**Decision:** live inference through the existing proxy is authorized during requested Rex development/verification when needed; the agent should perform it without another per-run approval request. Prefer inexpensive adequate models, with 6.1 Luna and Haiku 5.5 as the owner's examples, after resolving available IDs. Verify the specific target model when the result depends on it. Do not change active profile defaults merely to select a QA model.

**Reason:** synthetic providers make faults reproducible but cannot establish actual provider compatibility or model behavior. Avoiding all paid calls would leave those claims unverified and shift QA back to the owner.

**Boundary:** this changes the earlier task-by-task inference-approval policy, not credential, account/proxy-management, publication, browser or delegation permissions. CI and deterministic default checks remain synthetic/account-free; live tests use invented inputs and isolated state with private evidence. This is a selection policy, not a claim that the example models are available or a new automatic model-routing implementation.

## 016: Allow email addresses in commit messages, retain other safeguards

**Decision:** the owner permits email addresses in commit-message subjects, bodies and trailers, not just author/committer metadata. The commit hook and historical message check explicitly opt into that allowance. File contents and filenames retain their existing synthetic-email rules.

**Reason:** CI fetches remote Dependabot proposals whose standard signed-off trailers contain a public bot email. The previous general non-example-email rule classified those messages as private content even though local checks on the feature/main refs passed. The owner chose to allow message emails generally rather than add a bot-specific exception.

**Security impact:** only email classification changes in message context. The full unmodified message still reaches Gitleaks; credentials, personal home paths, long account/chat-like numbers, local private phrases, size and encoding checks remain active. No refs are excluded or deleted, no secret patterns are relaxed, and no hooks or CI protections are bypassed.

**Verification:** real installed-hook and history tests accept ordinary emails and bot trailers while rejecting secrets and other private content in email-containing messages. Default file checks still reject non-example emails. Fetch the previously unseen remote proposal refs and scan their complete history before relying on local release results; rerun PR CI before merging.

## 017: Major-only dependency proposals with exact pins

**Decision:** keep exact dependency versions, committed lockfiles and action commit pins. Configure weekly Dependabot version-update PRs for major changes only across the root npm workspace, terminal sandbox and GitHub Actions. Ignore Node type versions 23 and above until the Node 22 runtime is deliberately upgraded.

**Reason:** avoid routine minor/patch update noise and unnecessary churn in a working system. Take smaller upgrades when a concrete bug or security issue warrants them. Closing one unsuitable PR is not a lasting version policy.

**Security impact:** vulnerability alerts remain enabled independently of version-update scheduling; this change does not alter repository security settings, workflow permissions or scanning. Ignored versions may constrain automated security fixes, so alerts still require review. No dependency is updated or automatically merged by this policy.

**Verification:** static configuration regressions check both ecosystems' wildcard minor/patch exclusions without excluding all majors, both npm lockfile directories and the runtime-aligned Node-types exception. GitHub's actual scheduling and PR generation require the configuration on the default branch; local checks do not prove service execution.

## 018: Patch external undici without upgrading Pi or claiming a bundled CLI fix

**Decision:** retain Pi Coding Agent 1.3.0 and override only its external undici dependency to exact version 8.12.2 in the root and terminal installs. Regenerate both lockfiles using npm and verify actual installed resolution, not just override declarations.

**Reason:** Pi pins vulnerable undici 8.10.2 exactly; the checked latest Pi 1.4.0 also retains that pin. Candidate 8.12.2 passed synthetic HTTP/proxy/stream/upload/cancellation checks and the existing SDK integration suite before adoption. A narrow override avoids an unrelated Pi upgrade.

**Security impact:** the external dependency is patched, but the separately embedded implementation in Pi's published CLI is unchanged. Do not equate cleared dependency alerts with a fully patched CLI. No TLS checks, network restrictions, credentials, scanner rules or profile permissions are relaxed. The changed NO_PROXY wildcard semantics require attention in deployments that explicitly use them; no private host configuration is imported or changed.

**Verification and revisit:** regressions fail on the previous lockfiles/host install and check the fixed external version in both locks and actual host/container resolution while retaining Pi 1.3.0. Run full synthetic container acceptance before installation. Revisit the override when the Pi maintainers release a patched and rebuilt distribution; any removal or replacement requires the same installed-interface checks.

## 019: Direct-main publication for solo work

**Decision:** work on and push directly to main by default. Branches are for genuinely parallel work needing worktrees. Any other reason to avoid main must be explained through `ask_user_question`, with the owner deciding before a branch is created or used. The owner explicitly approved removing GitHub's mandatory PR and pre-merge status-check requirements to support this workflow.

**Reason:** a mandatory branch/PR cycle adds overhead for a solo-maintained project without parallel work. The owner wants exceptions decided explicitly, not imposed by a generic agent workflow.

**Security impact:** GitHub no longer blocks publication pending PR CI; CI runs after main pushes. Local verification, staged-content and history privacy checks, publication approval, read-only CI, and force-push/deletion protection remain required. Local hooks can be bypassed by a client, so this removes a server-side pre-publication gate rather than providing equivalent enforcement. Administrator enforcement remains enabled for the retained branch protections. No scanner or hook is weakened.

**Verification:** inspect GitHub protection after the specifically approved removals, retain secret/private-content rejection coverage in the real installed-hook tests, run repository/history checks before pushing, then observe main CI. This supersedes the earlier mandatory-PR policy, not the other publication safeguards.

## 020: Evidence-driven build workflows from pstack

**Decision:** add project-local `bug-fix`, `feature`, `multi-phase-plan` and `principle-sequence-verifiable-units` skills adapted from pstack's poteto-mode playbooks and principles, and extend the existing testing skills with pstack's remaining hollow-test, sibling-fault and stand-in verification rules. The agent settles questions that running something can answer and asks the owner only product, preference or direction calls plus reserved approvals. Plans live in chat and the agent's todo list, not tracked files. Work proceeds test before code; a regression test and its fix land in one commit after verification. The root guide's routing table maps task triggers to every skill by full path, so the agent reads matching skills without the owner naming them.

**Reason:** the owner sets direction and the agent implements. Fewer avoidable questions, root causes proven by runtime evidence and small verified units shorten the loop without lowering the proof standard of decision 013.

**Tradeoff:** pstack's subagent delegation, model routing, multi-agent verification, PR and review automation and saved plan files are excluded; they conflict with opt-in delegation, direct-main work and the no-roadmap rule. A chat plan is lost on compaction except for its todo mirror. Failing-before evidence lives in the task report rather than a red commit on `main`. Skills remain instructions, not enforcement.

**Publication impact:** only skill Markdown under the existing admitted `.agents/skills/` paths is added. No ignore rules, hooks, CI permissions or scanner settings change.

**Verification:** the skill-loading test requires Pi to discover all ten skills without diagnostics and fails when any skill names a missing file; a synthetic skill with planted broken references proves the check detects them. A further test fails when the root guide does not route to a skill by an existing path, observed failing before the table existed. Whether the workflows make real tasks faster remains for owner review on future work.

## 021: SOUL personas, shared defaults and one-file minimal profiles

**Decision:** each profile's persona and instructions live in `SOUL.md` (owner-chosen naming; the shared all-profiles persona file is named `REX_SOUL.md`), and the minimal profile is a single `SOUL.md` under its ID directory with no `profile.json`. The operator owns a reserved `shared/` directory with an optional shared `REX_SOUL.md` and a version-2 `configuration.json` supplying default model/tool settings plus a mandatory blacklist that no profile or override can remove. Versioned profile manifests (currently version 2 with optional `model`/`tools` overrides) may later add skills, MCP servers and other resources progressively. Whitelists replace shared grants; blacklists union across profile, shared defaults and mandatory denials. Mixed sources (inline instructions plus `SOUL.md`, or version-2 fields beyond the schema) fail closed.

**Reason:** the owner wants an open-ended set of file-defined profiles with high customization control but minimal setup cost, and shared settings that apply to every profile. `SOUL.md` keeps the persona in one obvious file; the reserved shared directory keeps defaults and mandatory policy operator-owned rather than editable by any single profile.

**Tradeoff:** shared defaults are enforced per worker only when the execution boundary supplies them; until worker isolation (a later unit), the adapter treats a missing shared configuration as a version-1-only environment and fails closed for SOUL profiles without it. Lists have asymmetric merge semantics (replace vs union) that must stay documented. Instructions still are not permission enforcement.

**Verification:** core tests cover shared validation/failure codes, minimal one-file profiles, override/union composition, mandatory denials, mixed-source and unknown-field rejection, reserved `shared`, and frozen outputs. Adapter tests drive a minimal SOUL profile through real Pi sessions with shared defaults and prove SOUL profiles fail closed before inference without shared configuration.

## 022: Provenance-bound, revision-aware admission

**Decision:** every draft carries an operator-checkable provenance record written by Rex code, never by the model: operation (`create`/`update`), originating profile ID, the digest of the active bundle an update amends, and the shared-configuration digest at draft time. The approval digest covers the whole bundle (manifest plus `SOUL.md` persona text). Create approval requires an unused destination; update approval requires the same-profile origin, an unchanged active base digest (rejecting stale and replayed proposals while preserving the running revision), and an unchanged shared configuration. Activation stages the new bundle and swaps it in by directory rename; approval consumes the draft.

**Reason:** the owner requires that existing profiles change only through that profile's own explicitly requested self-maintenance and that no profile can expand its own or another's permissions. Binding drafts to an originating identity and a specific starting revision lets the operator verify both who proposed the change and what version it was written against, independently of any model claim.

**Tradeoff:** provenance is trustworthy only while the proposals store is not agent-writable by hostile profiles; the sandbox currently shares that directory across profiles, so digest review protects the approved version but not the proposal directory from tampering between draft and review — per-profile worker isolation (a later unit) closes this. Directory-rename activation can briefly leave a profile unavailable if interrupted, which is fail-closed and recoverable. Consuming drafts on approval means a rejected-then-reapproved flow requires recreating the proposal.

**Verification:** admission tests cover provenance validation/failure, create/update distinction, origin mismatch, digest coverage of SOUL bundles, stale-base and replay rejection with prior revision preserved, shared-configuration change rejection, consumption on success, and staged activation. The adapter's proposal tool records the builder profile as origin; self-update tool wiring arrives with the maintenance unit.

## 023: Operator-launched private profile workers

**Decision:** the host operator launcher, not the model, selects one validated profile and starts a short-lived networkless Docker worker. Each profile owns separate workspace, state, proposal and definition-snapshot volumes. Trusted provisioning reads the master but copies only validated selected configuration and shared operator settings; the worker never sees the master or arbitrary sibling files. Disable Docker's image-copy behavior on `/profiles`. Shared persona and mandatory denials also apply to legacy definitions. The unprofiled baseline no longer mounts active definitions or drafts, and its profile CLI fails closed.

**Reason:** separate histories and tool-name rules did not stop a shell from reading another profile's configuration or state. Private mounts and process namespaces make that data unavailable even to filesystem-capable tools. A fixed source volume and operation guard also prevent an agent from forging provenance text to select another profile or use builder approval as self-maintenance.

**Authority and recovery:** an operator-owned host lock covers provisioning and execution; a deterministic Docker name separately reserves profile identity if the client dies. Cleanup targets that exact worker before releasing the lock. Stale operator/SDK locks require deliberate recovery after checking no turn runs. The provisioning helper has only `CHOWN` to initialize selected volume roots; seed/approval helpers have no capabilities. All helpers have bounded resources, no network or inference credentials, and no host/control mounts. Approval reads only the builder's source, snapshots it into bounded temporary storage, checks the exact digest, and accepts creation only. It retains the original read-only draft; existing-destination rejection prevents replay. Library update admission is not yet an installed self-maintenance command.

**Compatibility:** generic definitions seed new master volumes once, never overwrite existing ones. Old shared histories/workspace/drafts are not mounted, copied or deleted by worker execution. Compose stop/reset do not remove dynamic profile volumes. Installing the boundary in an existing normal sandbox and migrating old state remain separately approved operations. Docker/kernel exploits, operator-driven data sharing and resource denial-of-service against shared infrastructure are outside this boundary. No memory engine or live-provider compatibility is implied.

**Verification:** core regression failed before shared policy applied to legacy profiles; the installed shared-baseline CLI regression failed with status 0 before rejection was added. Disposable acceptance drives the real Pi CLI/tool loop for coding writes, shell/read cross-profile denials, minimal SOUL/shared configuration, truncation/recovery, private persistence, concurrent workers, reserved container-name contention and actual builder-to-operator approval, including forged update provenance rejection. It inspects worker mounts, process/network modes and resource limits. Node/CommonJS startup and entrypoint handling are exercised by the installed image, not inferred from host typechecking.

## 024: Add a qa template without replacing the existing roster

**Decision:** keep `coding`, `research`, and `profile-builder`. Add `qa` as a fourth public template. It may read, list, and run shell checks. It may not use `write`, `edit`, or `propose_profile`. Its instruction is one short fixture sentence, not a persona to author. Adding the file does not refresh or migrate an existing normal sandbox volume.

**Reason:** the owner wants the existing writer and reader to stay, and wants one more profile that can run checks while the package is tested. Profile text for real use comes later, from the owner.

**Verification:** the shipped-profile adapter test failed with a missing `qa` file before the template existed. Disposable acceptance runs `qa`, rejects its write tool, and checks that its shell sees only its own configuration snapshot.

## 025: Same-profile maintenance is an explicit host flag

**Decision:** `rex --maintain` is the only way to expose `revise_profile`. Profile files cannot grant it. The tool drafts an update only for the running profile. It may change instructions or model, and it may only remove tools. `approve-update` locks that profile, reads only its proposal volume, rejects tool expansion, and writes the master. The running container is not edited. The next launch copies the new revision.

**Reason:** an existing profile must be able to propose its own change without being able to edit another profile, shared settings, or its own permissions. The operator still approves the exact digest.

**Verification:** a forced call without the flag writes nothing. A foreign id and an added tool are rejected. Approval of an added tool fails and preserves the active profile. Disposable acceptance drafts a coding revision, rejects a wrong digest and a busy profile, activates the exact digest, and sees the new instruction on a new session.

**SOUL maintenance correction:** the initial maintenance implementation accepted only legacy inline configurations. Version-2 maintenance now writes and hashes the profile's own SOUL text while preserving omitted model/tool overrides. The regression failed because no draft existed after the tool call; SDK approval/fresh-session and installed-worker checks cover the corrected path.

## 026: Operator-owned relay model metadata

**Decision:** an optional shared `models` catalog declares exact model IDs, supported relay API, context window, per-model output limit, and reasoning capability. Unknown catalog models fail before inference. Do not accept endpoints, headers, credentials, or arbitrary Pi settings. Existing profiles without a catalog retain compatibility defaults. Reasoning capability does not enable thinking by itself.

**Reason:** a model ID alone cannot tell the adapter which protocol or limits to use. Per-model metadata avoids treating every model as OpenAI chat completions without imposing one universal output cap. Anthropic needs an explicit positive output limit and an origin base URL; OpenAI uses the `/v1` base URL.

**Verification:** a core catalog parse failed before the schema change; the adapter limit assertion failed before metadata was used. SDK tests inspect actual output limits and missing-model refusal, plus real Anthropic SSE handling and request path. Container acceptance provisions the catalog into isolated workers. Override selection and safe fallback are subsequent U5 units, not claims of this catalog change.

## 027: Request model overrides require two approvals in configuration

**Decision:** a request may select a model only when its ID is in both the selected model reference's bounded `overrides` list and the operator-owned shared catalog. CLI `--model` and SDK `modelOverride` do not change the next request's default or a draft's inherited model. Host and worker CLI flags share one parser. No model is selected from prompt text.

**Reason:** the catalog describes available metadata, not permission for every profile to select every model. A one-turn choice must not become a persistent profile change.

**Verification:** schema/flag tests failed before overrides existed. SDK checks inspect the actual wire ID, unchanged definition bytes, denial before inference, and return to the default. Installed worker acceptance checks allowed selection, denial of another catalog model, and the subsequent default. Fallback remains a separate behavior.

## 028: Fall back only before a response or tool action

**Decision:** permit up to four ordered catalog-approved fallback IDs for a configured primary. An explicit request override disables fallback. Qualifying failures are structured HTTP 429/502/503/504 only, before text/thinking/tool-call content or any tool execution. A per-runtime injected fetch observes status even when Pi's successful-response hook does not fire for an error. Never parse private error bodies to authorize retries.

**State:** each candidate shares policy, lock, cancellation, deadline, and total request budget. Branch the session manager back to the pre-request leaf, refresh context, and record the next model before retrying. This avoids a duplicated prompt or failed assistant message in active context. Return/print ordered attempts; next request uses the primary with retained successful context.

**Verification:** the regression first failed schema validation, then inference on the initial 503, then passed after retry wiring. A temporary diagnostic showed Pi's response hook omitted the failed HTTP status; injected fetch corrected the observation and the diagnostic was removed. Tests prohibit fallback after a real write, authentication errors, truncation, explicit override failure, or exhausted candidates. Installed acceptance checks a local 503 and selected model/attempt order. Live QA uses a controlled local failure followed by actual Haiku, not a claimed live provider outage.

## 029: Reasoning controls require catalog capability

**Decision:** model references may configure thinking off/minimal/low/medium/high, default off. Every selected/fallback candidate must declare reasoning capability for non-off levels; reject unsupported plans before inference. Pass the configured level to Pi and reapply it after fallback model selection. Do not infer capability from an ID or enable thinking because metadata merely says it is available.

**Verification:** configured-thinking regression failed before the schema accepted the field. Core tests reject unsupported levels/capabilities; SDK assertions inspect low reasoning_effort on primary and fallback requests; installed SOUL acceptance checks the same field. Haiku live QA checks accepted request/tool/fresh-session behavior, not hidden provider reasoning or quality.

## 030: Per-turn limits are bounded configuration

**Decision:** shared limits provide fieldwise defaults; profile limits override them (legacy configuration.limits, version-2 top-level limits). Preserve the previous defaults. Hard bounds: deadline 100–180000 ms, requests 1–64, loaded-history JSON bytes 1024–1048576. The SDK timer includes setup/inference/tools/fallback after lock acquisition; external cancellation may stop it sooner. The host worker keeps its separate 240-second bound. Limits are digest-covered and not exposed as self-maintenance tool parameters.

**Verification:** schema merge failed before limits were supported; a tool-loop limit test failed with missing rejection before runtime enforcement. Source checks prove bounded writes/request abortion, stalled-provider cancellation, history refusal before inference, lock recovery, snapshot preservation and limits digest sensitivity. Installed acceptance observes a one-request worker abort after a completed write, inspects the file, and starts a fresh successful session. No rollback of completed actions is claimed.

## 031: Instruction references bind selected text to approval

**Decision:** shared and per-profile resources.instructions contains ordered bounded resources/*.md references relative to its own directory. Core lookup loads/freeze only selected files, rejecting traversal and symlinks. Effective order is shared persona, required shared files, own persona, own files. Provisioning copies only validated selected text. Manifest references and file content participate in whole-bundle digests; shared content participates in stale-update checks. Maintenance preserves references/content, not concatenated instructions or a discovered directory.

**Writing:** trusted createProposal callers supply resource text records as a separate sixth argument; validate exact ordered reference matches before any write. The public adapter proposals subpath shares instruction-file writing between activation, operator snapshots, and provisioning, whose destinations are new/cleared operator-controlled directories. The model tool does not create arbitrary resource paths or executable code.

**Verification:** SDK regression failed shared schema validation before wiring, then passed shared/own prompt composition, ignored-neighbor exclusion, maintenance, changed-resource digest rejection and exact activation. Shared-file changes invalidate an update. Installed acceptance exercises resource snapshots and resource-bearing SOUL approval. Live Haiku verifies real maintenance and preserved files in an isolated disposable container. Skills/prompts/extensions are not implied by instruction-file support.

## 032: Skills and templates use explicit digest-bound Markdown

**Decision:** resources.skills and resources.prompts join explicit instruction refs under one bounded text bundle. Skills require SKILL.md metadata and an allowed read tool. Supply only selected skill paths with includeDefaults false, and explicit template paths with default discovery disabled. Advertise skill metadata lazily, support explicit skill commands and selected template argument expansion. Shared names cannot be silently shadowed; malformed/colliding metadata fails closed. Keep execution policy authoritative over skill text.

**Verification:** selected-skill regression failed schema validation before support. SDK tests distinguish metadata from lazy body, actual read results, ignored neighbor/workspace resources, template arguments and denied write actions. Invalid/colliding metadata stops inference. Installed worker drives selected skill read and template expansion with copied resource snapshots. Live Haiku evidence inspects a successful read tool result plus exact skill/template output. This slice does not install packages or executable skill helpers.

## 033: Workspace instructions require explicit path opt-in

**Decision:** resources.workspaceInstructions names bounded relative Markdown files in the selected own workspace. Shared refs remain required; union them with own refs and read once under the turn lock. No ancestor discovery or implicit conventional filenames. Freeze text for that turn; later turns may see changed project files. Reject links, traversal, whitespace references and missing/invalid files. Reuse bounded text validation and redact path diagnostics.

**Approval boundary:** workspace instruction references are part of the approved manifest digest, but mutable workspace content is not an active-definition bundle. This is an explicit dynamic-context opt-in, not authority to execute code or grant tools. Operator-launched workers provide own-workspace isolation; the SDK does not sandbox arbitrary caller paths.

**Verification:** opt-in regression initially failed schema validation; it now proves absence before configuration, selected system text, immutability across a real write in the current turn, and refresh on the next turn. Core negatives cover traversal/symlinks/whitespace/missing files. Installed worker and isolated live Haiku use an invented own-workspace file, not host project instructions.

## 034: Executable extensions are operator-installed integrity references

**Decision:** shared extensionCatalog binds bounded IDs to SHA-256 and tool names. Explicit shared/profile resources.extensions selects only those IDs. SDK installedExtensionsRoot is trusted caller input; CLI fixes the immutable image root. Preflight every selected regular bounded module and digest before importing any native MJS factory. Do not scan profile/workspace code, install packages, accept URLs/commands, or replace reserved tools. Actual registered names must match the operator catalog. Custom and nested tool calls retain execution policy; update approval cannot expand custom-tool grants.

**Trust:** installed code has process authority and may have side effects outside model tool dispatch. Review and pin dependencies and keep code immutable; entry hash does not seal transitive imports. Worker OS mounts provide profile isolation, not the SDK. Rex starts no service merely by loading a reference; trusted extensions must obey the same factory lifecycle rule. Disable fallback with executable extensions, since their request hooks may have performed side effects before any model content appears.

**Verification:** schema regression failed before catalog support. SDK observes denied/allowed custom tool effects, hash mutation refusal, missing root, symlink, full-preflight-before-import, registration mismatch and nested blacklist denial. A hook-replay regression failed missing rejection, then passed with one HTTP request and one hook write. Installed fixture and real Haiku produce an inspected marker and a failed nested write without a target file. No normal profile/module selection or gateway configuration is changed.

## 035: Skill support Markdown is explicitly selected and lazy

**Decision:** resources.references adds explicit supporting Markdown to the existing bounded resource bundle. Count/path/size/type checks, immutable loaded records, approval digests, activation and selected-only worker snapshots are shared with other text files. Support files do not become eager instructions, skill advertisements or prompt commands. A skill may name its relative sibling reference, which requires an explicit read. No directory scan or executable asset installation is introduced.

**Verification:** lookup and admission regressions failed INVALID_PROFILE_DEFINITION before references support. Afterwards they prove frozen selected support, absent eager text, invalid path/type/count/duplicate/symlink refusal, tamper-invalidated approval and exact activation. SDK observes a successful support read after initial omission; disposable installed CLI reads the copied support and rejects eager text or missing tool results. Unselected neighbors stay outside worker snapshots. Existing read-tool/provider behavior is unchanged; this is deterministic bundle/copy integration, not a claim about live model judgment.

## 036: Local MCP metadata uses exact names and no command configuration

**Decision:** the pure parseLocalMcpCatalog API validates bounded installed-code ID/hash metadata, declared raw tools, literal arguments and a resource opt-in. localMcpToolNames derives canonical names; reject normalization collisions or names Pi would shorten/hash so permission rules cannot silently address a different tool. Deep-freeze copied metadata. Do not accept executable paths, shell commands, URLs, environment/config expansion, credentials or caller-selected working directories.

**Boundary:** this utility does not connect, install code, or enable MCP in shared/profile manifests. Existing configuration parsers still reject MCP fields. No runtime lifecycle, provider compatibility or isolation claim follows from schema validation.

**Verification:** public API tests failed because the parser was absent, then passed valid/default/literal/frozen metadata, malformed inputs, duplicate/colliding/oversized names, argument controls/UTF-8/total bounds, unknown execution/auth fields and manifest refusal. A further prototype-only metadata case failed missing rejection before required own-property checks were added. This unit has no Pi/provider/process imports or runtime side effects.

## 037: Required direct local MCP connections belong to the requested profile turn

**Decision:** enable shared localMcpCatalog and explicit shared/own resources.mcp selections. Resolve required shared IDs in core, preserve references/catalog in existing bundle/shared hashes and worker snapshots, and reject unknown IDs and extension-name collisions. Installed immutable MJS entry points use the shared bounded integrity reader. Runtime uses fixed Node and literal argv with no inherited environment, private temporary HOME/TMPDIR and own cwd. No discovery, auth-store import, package install or remote transport.

**Adapter choice:** use the public pinned Pi MCP client/stdio transport and ordinary Pi tools, not the built-in MCP extension's background/optional startup and auth/config management. Await initialization and exact catalog tool sets before inference. Normal tool policy and execution hooks apply; unregistered/denied calls cannot reach a server. Keep direct tools only; resource opt-ins fail until their execution path exists. Tool results use Pi's public content conversion and explicit bounded-result failure, not a provider-output cap.

**Lifetime:** start only during a requested locked turn, never extension import. Close transports and clients, remove owned temporary state, then release the lock. Cancel pending setup/tool requests on the turn signal. Mark dropped/list-changed connections, protocol errors and invalid/oversized results unusable rather than reconnecting, continuing inference or replaying. Disable model fallback with local MCP. Update approval cannot add connected servers even under existing wildcard policy; that regression failed missing rejection before the additional admission check.

**Verification:** SDK regressions failed shared schema validation first. Actual subprocess/tool effects now prove minimal environment, literal arguments, allowed writes, denied call errors without target files, exact PID exit, missing-root/hash/tool-set refusal before inference, startup/tool deadline cleanup, dropped-call no-replay and explicit recovery. A protocol-failure continuation regression failed missing rejection before invalidation was added; protocol/oversized/malformed variants now observe exactly one effect and no next model call. Positive MCP maintenance/approval/fresh-turn coverage preserves selections and usable tools. macOS adds __CF_USER_TEXT_ENCODING even with an explicitly empty child environment, verified independently; tests allow only that known platform addition. Installed CLI mcp-check inspects selected-only filesystem views, minimal environment, actual file effects and graceful exit/temp cleanup. Live Haiku executes the real installed worker tool once and a separate read-only probe inspects its history/files and isolated definitions. A preliminary plain-SDK live check exposed public image templates, as documented for SDK-only use; it was not accepted as isolation evidence and was replaced with actual worker QA. No normal definitions, defaults or histories are changed.
