import { mkdir, open, unlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { Type } from "typebox";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  isToolAllowed,
  loadSharedConfiguration,
  parseProfileRequest,
  ProfileError,
  ProfileRuntime,
  resolveEffectiveProfile,
  type SharedConfiguration,
} from "@rex/profiles";
import { createProposal } from "./proposals.ts";
import { narrowsTools, requireRunnable, TOOL_NAMES } from "./policy.ts";
export {
  createProposal,
  reviewProposal,
  approveProposal,
  bundleDigest,
  sharedConfigurationDigest,
} from "./proposals.ts";
export { TOOL_NAMES } from "./policy.ts";

export class IncompleteProfileResponseError extends Error {
  constructor() {
    super(
      "Profile response was truncated at the provider output limit. Earlier tool actions may already have completed.",
    );
    this.name = "IncompleteProfileResponseError";
  }
}

export interface ProfileRequestOptions {
  profilesRoot: string;
  stateRoot: string;
  proposalsRoot: string;
  cwd: string;
  input: string;
  baseUrl: string;
  newSession?: boolean;
  maintain?: boolean;
  signal?: AbortSignal;
}

export async function runProfileRequest(options: ProfileRequestOptions) {
  const request = parseProfileRequest(options.input);
  for (const path of [options.stateRoot, options.proposalsRoot, options.cwd]) {
    if (typeof path !== "string" || !isAbsolute(path.trim()))
      throw new Error("Explicit absolute adapter paths are required.");
  }
  const origin = new URL(options.baseUrl);
  if (
    origin.protocol !== "http:" ||
    origin.hostname !== "127.0.0.1" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/v1" ||
    origin.search ||
    origin.hash
  ) {
    throw new Error("Only the local inference relay is supported.");
  }
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  const runtime = new ProfileRuntime(options.profilesRoot);
  let shared: SharedConfiguration | undefined;
  try {
    shared = await loadSharedConfiguration(
      join(options.profilesRoot.trim(), "shared"),
    );
  } catch (error) {
    if (
      !(error instanceof ProfileError) ||
      error.code !== "SHARED_CONFIGURATION_UNAVAILABLE"
    ) {
      throw error;
    }
  }
  return runtime.run(
    request.profileId,
    async () => {
      const profile = runtime.current();
      const config = requireRunnable(
        resolveEffectiveProfile(profile, shared).configuration,
      );
      const state = join(options.stateRoot.trim(), profile.id);
      await mkdir(state, { recursive: true, mode: 0o700 });
      const lockPath = join(state, "turn.lock");
      let lock;
      try {
        lock = await open(lockPath, "wx", 0o600);
      } catch {
        throw new Error(
          "Profile is busy or its turn lock needs operator recovery.",
        );
      }
      try {
        const agentDir = join(state, "agent");
        const sessions = join(state, "sessions");
        await mkdir(agentDir, { recursive: true, mode: 0o700 });
        await mkdir(sessions, { recursive: true, mode: 0o700 });
        const modelRuntime = await ModelRuntime.create({
          authPath: join(agentDir, "unused-auth.json"),
          modelsPath: null,
          modelsStorePath: join(agentDir, "model-cache.json"),
          refreshOnCreate: false,
          allowModelNetwork: false,
        });
        modelRuntime.registerProvider("cli-proxy", {
          baseUrl: origin.href,
          api: "openai-completions",
          apiKey: "sandbox-placeholder",
          models: [
            {
              id: config.model.id,
              name: config.model.id,
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 32768,
              // Pi requires a number; zero omits the OpenAI output-token cap.
              maxTokens: 0,
            },
          ],
        });
        const model = modelRuntime.getModel(
          config.model.provider,
          config.model.id,
        );
        if (!model) throw new Error("Profile model is unavailable.");
        const settings = SettingsManager.inMemory({
          retry: {
            enabled: false,
            provider: { maxRetries: 0, timeoutMs: 60000 },
          },
          compaction: { enabled: false },
          cacheWarming: "off",
          transport: "sse",
          enableInstallTelemetry: false,
          enableAnalytics: false,
        });
        const toolNames = TOOL_NAMES.filter((name) =>
          isToolAllowed(config.tools, name),
        );
        const visible = options.maintain
          ? [...toolNames, "revise_profile"]
          : toolNames;
        const denied: string[] = [];
        const proposalParameters = Type.Object(
          {
            id: Type.String(),
            instructions: Type.String(),
            whitelist: Type.Array(Type.String()),
            blacklist: Type.Array(Type.String()),
          },
          { additionalProperties: false },
        );
        const proposalTool: ToolDefinition<typeof proposalParameters> = {
          name: "propose_profile",
          label: "Propose profile",
          description:
            "Save a NEW profile draft for operator review. Never activates a profile. Model is inherited. Use exact tool names or '*' in whitelist/blacklist; blacklist wins.",
          parameters: proposalParameters,
          async execute(_id, params, signal) {
            signal?.throwIfAborted();
            runtime.current();
            if (!isToolAllowed(config.tools, "propose_profile"))
              throw new Error("Tool denied by profile policy.");
            const proposal = await createProposal(
              options.profilesRoot,
              options.proposalsRoot,
              {
                id: params.id,
                configuration: {
                  instructions: params.instructions,
                  model: config.model,
                  tools: {
                    whitelist: params.whitelist,
                    blacklist: params.blacklist,
                  },
                },
              },
              {
                operation: "create",
                origin: profile.id,
              },
            );
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    ...proposal,
                    status: "draft-requires-approval",
                  }),
                },
              ],
              details: proposal,
            };
          },
        };
        const revisionParameters = Type.Object(
          {
            id: Type.String(),
            instructions: Type.Optional(Type.String()),
            model: Type.Optional(Type.String()),
            whitelist: Type.Optional(Type.Array(Type.String())),
            blacklist: Type.Optional(Type.Array(Type.String())),
          },
          { additionalProperties: false },
        );
        const revisionTool: ToolDefinition<typeof revisionParameters> = {
          name: "revise_profile",
          label: "Revise profile",
          description:
            "Draft a change to this profile only. The operator must approve it. It cannot add tools or edit shared settings.",
          parameters: revisionParameters,
          async execute(_id, params, signal) {
            signal?.throwIfAborted();
            runtime.current();
            if (!options.maintain || !profile.configuration)
              throw new Error("Tool denied by profile policy.");
            if (params.id !== profile.id) {
              throw new Error(
                "An existing profile may be updated only by a draft from the same profile.",
              );
            }
            const tools = {
              whitelist: params.whitelist ?? [
                ...profile.configuration.tools.whitelist,
              ],
              blacklist: params.blacklist ?? [
                ...profile.configuration.tools.blacklist,
              ],
            };
            const next = {
              id: profile.id,
              home: profile.home,
              configuration: {
                instructions:
                  params.instructions ?? profile.configuration.instructions,
                model: params.model
                  ? { provider: "cli-proxy" as const, id: params.model }
                  : profile.configuration.model,
                tools,
              },
            };
            const proposed = resolveEffectiveProfile(
              next,
              shared,
            ).configuration;
            if (!proposed || !narrowsTools(config.tools, proposed.tools)) {
              throw new Error("A profile revision cannot add tools.");
            }
            const proposal = await createProposal(
              options.profilesRoot,
              options.proposalsRoot,
              {
                id: next.id,
                configuration: next.configuration,
              },
              { operation: "update", origin: profile.id },
            );
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    ...proposal,
                    status: "draft-requires-approval",
                  }),
                },
              ],
              details: proposal,
            };
          },
        };
        let requests = 0;
        const loader = new DefaultResourceLoader({
          cwd: options.cwd.trim(),
          agentDir,
          settingsManager: settings,
          noExtensions: true,
          noSkills: true,
          noPromptTemplates: true,
          noThemes: true,
          noContextFiles: true,
          systemPrompt: "",
          appendSystemPrompt: [],
          systemPromptOverride: () => config.instructions,
          extensionFactories: [
            (pi) => {
              pi.on("tool_call", (event) => {
                runtime.current();
                if (event.toolName === "revise_profile") {
                  if (!options.maintain) {
                    denied.push(event.toolName);
                    return {
                      block: true,
                      reason: "Tool denied by profile policy.",
                    };
                  }
                  return;
                }
                if (
                  !TOOL_NAMES.some((name) => name === event.toolName) ||
                  !isToolAllowed(config.tools, event.toolName)
                ) {
                  denied.push(event.toolName);
                  return {
                    block: true,
                    reason: "Tool denied by profile policy.",
                  };
                }
              });
              pi.on("before_provider_request", () => {
                runtime.current();
                if (++requests > 12)
                  controller.abort(
                    new Error("Profile turn request limit reached."),
                  );
              });
            },
          ],
        });
        await loader.reload();
        if (loader.getExtensions().errors.length)
          throw new Error("Profile policy could not load.");
        const manager = options.newSession
          ? SessionManager.create(options.cwd.trim(), sessions)
          : SessionManager.continueRecent(options.cwd.trim(), sessions);
        if (
          Buffer.byteLength(
            JSON.stringify(manager.buildSessionContext().messages),
          ) > 131072
        ) {
          throw new Error(
            "Profile history limit reached; start a new session.",
          );
        }
        const { session } = await createAgentSession({
          cwd: options.cwd.trim(),
          agentDir,
          modelRuntime,
          model,
          thinkingLevel: "off",
          tools: [...visible],
          excludeTools: TOOL_NAMES.filter((name) => !toolNames.includes(name)),
          customTools: options.maintain
            ? [proposalTool, revisionTool]
            : [proposalTool],
          resourceLoader: loader,
          settingsManager: settings,
          sessionManager: manager,
        });
        const abort = () => {
          void session.abort();
        };
        signal.addEventListener("abort", abort, { once: true });
        const unsubscribe = session.subscribe((event) => {
          if (
            event.type === "message_end" &&
            event.message.role === "assistant" &&
            event.message.stopReason === "length"
          ) {
            controller.abort(new IncompleteProfileResponseError());
          }
        });
        try {
          await session.bindExtensions({});
          signal.throwIfAborted();
          const previous = session.messages.length;
          await session.prompt(request.prompt, {
            expandPromptTemplates: false,
          });
          signal.throwIfAborted();
          const answers = session.messages
            .slice(previous)
            .filter((message) => message.role === "assistant");
          if (
            answers.some(
              (message) =>
                message.stopReason === "error" ||
                message.stopReason === "aborted",
            )
          ) {
            throw new Error(
              "Profile inference failed; private provider diagnostics omitted.",
            );
          }
          return {
            profileId: profile.id,
            model: config.model.id,
            toolNames: visible,
            denied,
            sessionFile: session.sessionFile,
            output: answers
              .flatMap((message) =>
                message.content
                  .filter((block) => block.type === "text")
                  .map((block) => block.text),
              )
              .join("\n"),
          };
        } finally {
          unsubscribe();
          signal.removeEventListener("abort", abort);
          session.dispose();
        }
      } finally {
        await lock.close();
        await unlink(lockPath);
      }
    },
    { signal },
  );
}
