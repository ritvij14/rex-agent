# Terminal sandbox

Status: implemented and verified with synthetic container acceptance, an approved baseline Pi request, and separately approved live GLM profile checks through the existing proxy. Coding wrote an invented file, research read it unchanged, and profile-builder produced a validated inactive draft. These checks verify the tested model/API only, not every advertised model or protocol. This is a terminal-only development environment for building Rex, not Pi Durable, a website, or a second CLI Proxy API installation.

## Runtime and boundary

`lab/terminal/Dockerfile` pins Node.js 22.23.1 by image digest. Its independent npm lockfile pins Pi 1.3.0, tsx 4.23.15, TypeScript 7.0.2, and transitive dependencies. The main context and two package contexts allow only explicitly named runtime sources, manifests and generic starting definitions. They never upload the full checkout, `.env`, personal settings, tests or previous work. Locked local file dependencies install `@rex/profiles` and `@rex/pi-profiles`; source contexts do not include runtime state. Installs disable lifecycle scripts. Changing installed tools requires rebuilding the image, not granting the running agent public registry access.

The `sandbox` service runs Pi, its shell commands, and experimental Rex code as UID/GID 1000. It has no external network interface, host mounts, published ports, Docker socket, Linux capabilities, or privilege escalation. Its root filesystem is read-only. Application files and Pi state use separate writable named volumes; `/tmp` is a 64 MiB temporary filesystem. Docker also supplies ordinary container-local devices and shared memory. The limits are 2 CPUs, 1 GiB memory, no swap, and 128 processes/threads.

The separate `gateway` service has networking but accepts requests only through a Unix socket. The sandbox mounts the socket's volume read-only: it can connect but cannot replace the socket or change the gateway program. A container-local HTTP relay gives Pi its usual loopback HTTP endpoint. Editing or bypassing that relay does not bypass gateway enforcement, and the sandbox still has no external network interface.

The gateway runs without root, capabilities, host mounts, published ports, or a writable root filesystem. Its limits are 0.5 CPUs, 256 MiB memory, no swap, 64 processes/threads, and a 64 MiB temporary filesystem. The process allowance includes Node/tsx threads and concurrent health checks; a 32-process setting caused a diagnostic process to abort during local verification and was corrected with a regression check.

## Model access

The gateway's fixed destination is the existing CLI Proxy API through Docker Desktop's host connection. The proxy is not reconfigured, restarted, or copied. The allowed requests are `GET /v1/models` and JSON `POST` requests to `/v1/chat/completions`, `/v1/responses`, and `/v1/messages` (including the exact `?beta=true` variant). Other methods, paths, queries, absolute URLs, management APIs, login routes, CONNECT, and WebSocket upgrades are rejected before upstream access.

The gateway strips client authorization, API keys, cookies, forwarding headers, and unapproved headers. An operator-supplied inference/client key, when required, is injected at the gateway only. Never supply a management key. Request bodies are bounded at 4 MiB, active requests at two, and upstream inactivity at five minutes. The gateway neither retries requests nor follows redirects. Upstream error bodies, cookies, redirect headers, and raw connection diagnostics are not returned to Pi. Successful inference bodies are private application data.

The gateway is trusted enforcement code, not an agent tool or a general internet proxy. It shares the existing proxy's provider accounts and usage limits. This environment does not isolate spending, guarantee identical provider metadata, or prove compatibility with a model that has not been tested. Only the explicitly configured model/API is selected initially; no host model configuration or authentication store is imported.

## Operating it

Run commands from the repository root with Docker Desktop already running on macOS. No command launches Docker Desktop or changes its settings. The default live connection uses Docker Desktop networking; Linux live-host networking has not been verified. CI is configured to run synthetic checks on Linux without host access; that remote run has not been observed locally.

| Command | Effect |
| --- | --- |
| `npm run sandbox -- build` | Build the single shared image using locked dependencies |
| `npm run sandbox -- start` | Build, then start the gateway and sandbox; no model request |
| `npm run sandbox -- refresh` | Rebuild and recreate only sandbox; require/preserve the running authenticated gateway and volumes |
| `npm run sandbox -- shell` | Open Bash inside `/workspace` |
| `npm run sandbox -- configure MODEL_ID API` | Explicitly replace sandbox-local model/default settings with one model |
| `npm run sandbox -- pi` | Open the unprofiled baseline Pi TUI using its private configuration |
| `npm run sandbox -- rex [--new-session] PROMPT` | Run one profile-selected Pi SDK request, or read the prompt from stdin |
| `npm run sandbox -- review-profile ID` | Privately review a proposed definition and its digest |
| `npm run sandbox -- approve-profile ID DIGEST` | Explicitly activate that reviewed draft through the operator helper |
| `npm run sandbox -- stop` | Remove this experiment's containers/network; retain volumes |
| `npm run sandbox -- reset --confirm` | Remove Compose services and declared volumes, retaining dynamic profile/legacy volumes; requires explicit approval |
| `npm run sandbox -- check` | Run account-free acceptance in a unique disposable Compose project |

`API` must be `openai-completions`, `openai-responses`, or `anthropic-messages`. Use a real model ID and verified API from the existing proxy, not the synthetic test model. Automatic catalog updates and telemetry are disabled. The Pi launcher disables automatic extension, skill, prompt, and theme loading; explicit experimental resources remain inside the same container boundary. No services start merely because an extension or instructions are loaded.

If the proxy requires a client key, supply `REX_PROXY_API_KEY` from your terminal environment when running `start`. A silent terminal read keeps the literal value out of shell history and chat:

```sh
read -r -s REX_PROXY_API_KEY; export REX_PROXY_API_KEY; npm run sandbox -- start; unset REX_PROXY_API_KEY
```

Run that line, paste the inference key when the terminal waits, and press Enter. Never paste it into agent chat or save it in the repository. Do not run this with shell tracing enabled. The gateway receives the value; the sandbox does not. Docker administrators can inspect container environments, so Docker remains trusted. Supply the key again whenever running `start`; omitting it recreates the gateway without authentication. `stop` removes the container holding the key. The command helper explicitly disables automatic `.env` loading; it never sources the host's environment files. Use `refresh`, not `start`, to install code while preserving a running gateway when the key is no longer in your terminal environment.

## Profile-selected runs and approval

The operator-side `rex` command launches a separate, short-lived worker container for the explicitly selected profile. The initial public templates remain `coding`, `research` and `profile-builder` on `glm-5.3-flash-cloud`, but the launcher accepts any validated, provisioned ID without adding a Compose service. Missing/unknown profiles fail before inference; input is bounded whether supplied as an argument or stdin. Host Pi settings/authentication are never loaded.

```sh
npm run sandbox -- rex $'profile: research\nList the local workspace files.'
```

`--new-session` starts a new conversation without deleting older sessions. Workers have the same unprivileged identity, networkless/read-only root and CPU/memory/process limits as the baseline. Each receives separate workspace/state/proposal volumes and a read-only snapshot containing only its selected profile and shared configuration. A networkless operator helper validates and stages that snapshot, copies only supported definition/persona files, rejects symlinks, and initializes writable volume ownership using only `CHOWN`. The master is initialized once from public image templates; existing definitions are never overwritten by image rebuilds. The worker's `/profiles` mount disables Docker's default image copy (`nocopy`).

Shared `REX_SOUL.md`, tool defaults and mandatory denials apply to legacy and SOUL profiles; a minimal SOUL-only profile additionally inherits its model from shared configuration. No profile sees the master, another profile's snapshots/state/drafts, the host, Docker control or provider credentials. A shell can affect its own container and data, not another profile's. The unprofiled baseline has no active-definition or proposal mount and rejects the profile CLI; ordinary Pi remains an unprofiled development interface.

An exclusive operator lock in the host temporary directory covers provisioning and the full worker lifetime; the deterministic `<project>-rex-<id>` Docker container name separately excludes orphan workers. Before releasing a lock, the launcher removes that exact remaining container after failure/timeout. A killed operator can leave a lock or worker; inspect that exact profile before manual recovery. The adapter's own `turn.lock` remains a secondary guard and may also require recovery after abrupt termination. Never reset histories to repair locks. Requests retain the 90-second deadline, twelve-inference-request bound, disabled retries and history admission limit.

Profile-builder can call `propose_profile` into its private proposal volume but cannot inspect or modify other active profiles. `review-profile` and `approve-profile` run an operator-only helper against the fixed builder volume; a claimed origin or update operation in model-writable metadata cannot select another source or grant self-maintenance. The helper has no network, capabilities, inference socket, credentials, host/workspace/state mounts or writable root; temporary storage is bounded. It snapshots the read-only draft, validates the exact bundle digest, and activates only unused IDs. Source drafts remain for inspection; replay fails on the existing destination. Installed self-update commands are not implemented yet. See [the profile contract](../features/profiles.md) for the library admission API and limitations.

## State and cleanup

The baseline retains `rex-terminal_workspace`, `rex-terminal_agent-state` and `rex-terminal_inference-socket`. The operator owns `rex-terminal_profile-definitions`. Every profile adds `rex-terminal_rex-profile-<id>-workspace`, `-state`, `-proposals` and `-defs` volumes outside the clone. Sessions remain under `/state/profiles/<id>/` inside that profile's state volume; future memory files stored there inherit its separation, but no memory engine exists.

Old shared histories, workspace and detached legacy proposal volumes are neither mounted into workers nor automatically migrated or deleted. A profile's first isolated workspace/history begins empty. Migration requires explicit mapping and approval, not a refresh. `stop` stops the Compose services, not active independently launched workers; their bounded turns may still finish or need specific operator cancellation. `reset --confirm` removes only Compose-declared volumes and retains dynamically named profile/legacy volumes. Never prune volumes or treat a reset as complete deletion of every profile. There is no automatic export or promotion of private state into the host or repository.

Docker service logs are disabled. Interactive terminal output and Pi's private session files can still contain prompts and model responses; do not publish them. The gateway has no request logger. Avoid unrestricted Compose configuration or container-environment inspection because those can expose the gateway's key.

## Verification and limits

`npm run check` includes gateway/configuration tests and strict TypeScript checks without Docker, proxy access, or credentials. `npm run sandbox -- check` creates uniquely named test resources, overrides the upstream with a synthetic fixture and blank authentication, verifies isolation settings and denied accesses, exercises the real process limit, performs a tools-disabled synthetic Pi exchange and profile SDK/command runs, verifies read-only definitions and the restricted operator helper, drives the actual builder tool and activates its digest-bound invented draft, exercises worker privacy/concurrency and real shell/read denials, rejects profile CLI use in the shared baseline, interrupts/restarts the gateway, verifies persistent recreation, then verifies a fresh reset. It deletes only the synthetic resources it created, even on failure. It never resets the normal `rex-terminal` project. CI runs the same synthetic command with read-only repository permissions and no secrets; no logs or volumes are uploaded.

The initial baseline live acceptance confirmed authenticated model listing and one tools-disabled Pi request. Subsequent operator-approved profile acceptance exercised three GLM 5.3 Flash Cloud tasks with real write/read/proposal tools and private per-profile histories. The existing authenticated gateway container was verified unchanged during the targeted sandbox refresh; no credential store was read or copied and no active profile was added by the live builder test. Only invented workspace evidence and an inactive draft remain in private Docker volumes. Raw prompts/responses, keys and account metadata are not recorded here. These earlier live checks used the former shared layout, not isolated workers. Necessary live model/protocol QA follows the root standing approval; no live call is needed to establish the deterministic filesystem boundary. The worker tests do not refresh the normal installation or migrate old state.

CPU/memory/swap settings are checked through actual container cgroups; CPU saturation and memory exhaustion are not stress-tested. Named-volume disk usage has no per-experiment quota. Requests can still consume the existing account's model allowance. Docker Desktop, its Linux VM/kernel, and host terminal are trusted; this is not a proof against container escapes, malicious terminal control sequences, or denial of service against shared infrastructure. No browser, app-quality check, deployment, package publication, or durable execution is included.
