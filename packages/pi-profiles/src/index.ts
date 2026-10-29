import { mkdir, open, unlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { Type } from "typebox";
import {
  createAgentSession,
  createCodemodeExtension,
  createToolSearchExtension,
  loadSkills,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_TURN_LIMITS,
  isToolAllowed,
  loadSharedConfiguration,
  loadWorkspaceInstructions,
  localMcpToolNames,
  parseProfileRequest,
  parseProfileDefinition,
  planProfileModels,
  ProfileError,
  ProfileRuntime,
  resolveEffectiveProfile,
  type LocalMcpServer,
  type SharedConfiguration,
} from "@rex/profiles";
import { createProposal } from "./proposals.ts";
import {
  narrowsTools,
  operatorToolNames,
  requireRunnable,
  TOOL_NAMES,
} from "./policy.ts";
export {
  createProposal,
  reviewProposal,
  approveProposal,
  bundleDigest,
  sharedConfigurationDigest,
} from "./proposals.ts";
import { loadInstalledExtensions } from "./installed-extensions.ts";
import { openMcpSession } from "./local-mcp.ts";
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
  modelOverride?: string;
  installedExtensionsRoot?: string;
  installedMcpRoot?: string;
  remoteMcpOrigin?: string;
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
  let remoteOrigin: string | undefined;
  if (options.remoteMcpOrigin !== undefined) {
    const remote = new URL(options.remoteMcpOrigin);
    if (
      remote.protocol !== "http:" ||
      remote.hostname !== "127.0.0.1" ||
      remote.username ||
      remote.password ||
      remote.search ||
      remote.hash ||
      (remote.pathname !== "/" && remote.pathname !== "")
    ) {
      throw new Error("Only the local MCP connector router is supported.");
    }
    remoteOrigin = remote.origin;
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
      const effective = resolveEffectiveProfile(profile, shared);
      const config = requireRunnable(
        effective.configuration,
        operatorToolNames(shared),
      );
      const limits = { ...DEFAULT_TURN_LIMITS, ...config.limits };
      const candidates = planProfileModels(
        config.model,
        shared?.models,
        options.modelOverride,
      );
      let selection = candidates[0]!;
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
      const deadline = setTimeout(
        () => controller.abort(new Error("Profile turn deadline reached.")),
        limits.deadlineMs,
      );
      deadline.unref();
      let mcp: Awaited<ReturnType<typeof openMcpSession>> | undefined;
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
          models: candidates.map((candidate) => ({
            id: candidate.id,
            name: candidate.id,
            api: candidate.metadata?.api ?? "openai-completions",
            baseUrl:
              candidate.metadata?.api === "anthropic-messages"
                ? origin.origin
                : origin.href,
            reasoning: candidate.metadata?.reasoning ?? false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: candidate.metadata?.contextWindow ?? 32768,
            // Zero leaves OpenAI output limits unset; Anthropic requires a catalog limit.
            maxTokens: candidate.metadata?.maxOutputTokens ?? 0,
          })),
        });
        const model = modelRuntime.getModel(selection.provider, selection.id);
        if (!model) throw new Error("Profile model is unavailable.");
        const settings = SettingsManager.inMemory({
          retry: {
            enabled: false,
            provider: {
              maxRetries: 0,
              timeoutMs: Math.min(60000, limits.deadlineMs),
            },
          },
          compaction: { enabled: false },
          cacheWarming: "off",
          transport: "sse",
          enableInstallTelemetry: false,
          enableAnalytics: false,
        });
        const ownResources =
          profile.configuration?.resources ?? profile.resources;
        const extensionIds = [
          ...new Set([
            ...(shared?.resources?.extensions ?? []),
            ...(ownResources?.extensions ?? []),
          ]),
        ];
        const installed = await loadInstalledExtensions(
          shared?.extensionCatalog,
          extensionIds,
          options.installedExtensionsRoot,
        );
        const indirectNames = new Set(
          (effective.mcpServers ?? [])
            .filter((entry) => entry.exposure && entry.exposure !== "direct")
            .flatMap((entry) =>
              localMcpToolNames([{ ...entry, resources: false }]),
            ),
        );
        const builtins = [
          ...(effective.codemode
            ? [
                {
                  name: "codemode",
                  factory: createCodemodeExtension({ models: false }),
                },
              ]
            : []),
          ...(indirectNames.size
            ? [{ name: "tool_search", factory: createToolSearchExtension() }]
            : []),
        ];
        const builtinNames = builtins.map((entry) => entry.name);
        const registeredExtensions = [...installed.tools, ...builtinNames];
        const availableNames: readonly string[] = [
          ...TOOL_NAMES.filter(
            (name) =>
              !["codemode", "tool_search"].includes(name) ||
              builtinNames.includes(name),
          ),
          ...installed.tools,
          ...localMcpToolNames(effective.mcpServers ?? []),
        ];
        const toolNames = availableNames.filter((name) =>
          isToolAllowed(config.tools, name),
        );
        const directNames = toolNames.filter(
          (name) => !indirectNames.has(name),
        );
        const visible = options.maintain
          ? [...directNames, "revise_profile"]
          : directNames;
        const workspacePaths = [
          ...new Set([
            ...(shared?.resources?.workspaceInstructions ?? []),
            ...(ownResources?.workspaceInstructions ?? []),
          ]),
        ];
        const workspaceInstructions = workspacePaths.length
          ? await loadWorkspaceInstructions(options.cwd.trim(), workspacePaths)
          : [];
        const instructions = [
          config.instructions,
          ...workspaceInstructions.map((file) => file.text),
        ].join("\n\n");
        const sharedHome = join(options.profilesRoot.trim(), "shared");
        const skillPaths = [
          ...(shared?.resources?.skills?.map((path) =>
            join(sharedHome, path),
          ) ?? []),
          ...(ownResources?.skills?.map((path) => join(profile.home, path)) ??
            []),
        ];
        const promptPaths = [
          ...(shared?.resources?.prompts?.map((path) =>
            join(sharedHome, path),
          ) ?? []),
          ...(ownResources?.prompts?.map((path) => join(profile.home, path)) ??
            []),
        ];
        const skills = loadSkills({
          cwd: options.cwd.trim(),
          agentDir,
          skillPaths,
          includeDefaults: false,
        });
        if (
          skills.diagnostics.length ||
          (skills.skills.length && !isToolAllowed(config.tools, "read"))
        )
          throw new Error(
            "Configured profile skills are invalid or unreadable under tool policy.",
          );
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
            if (!options.maintain)
              throw new Error("Tool denied by profile policy.");
            if (params.id !== profile.id) {
              throw new Error(
                "An existing profile may be updated only by a draft from the same profile.",
              );
            }
            const own = profile.configuration;
            const currentTools = own?.tools ?? profile.tools;
            const tools =
              params.whitelist || params.blacklist
                ? {
                    whitelist:
                      params.whitelist ??
                      currentTools?.whitelist ??
                      shared?.tools?.whitelist ??
                      [],
                    blacklist:
                      params.blacklist ?? currentTools?.blacklist ?? [],
                  }
                : currentTools;
            const model =
              params.model !== undefined
                ? { provider: "cli-proxy", id: params.model }
                : (own?.model ?? profile.model);
            const definition = parseProfileDefinition(
              own
                ? {
                    id: profile.id,
                    configuration: {
                      instructions: params.instructions ?? own.instructions,
                      model,
                      tools,
                      ...(own.limits ? { limits: own.limits } : {}),
                      ...(own.resources ? { resources: own.resources } : {}),
                    },
                  }
                : {
                    version: 2,
                    id: profile.id,
                    ...(model ? { model } : {}),
                    ...(tools ? { tools } : {}),
                    ...(profile.limits ? { limits: profile.limits } : {}),
                    ...(profile.resources
                      ? { resources: profile.resources }
                      : {}),
                  },
            );
            const soul = own
              ? undefined
              : (params.instructions ?? profile.soul);
            const next = {
              ...definition,
              home: profile.home,
              ...(soul !== undefined ? { soul } : {}),
              ...(profile.resourceFiles
                ? { resourceFiles: profile.resourceFiles }
                : {}),
            };
            const proposed = resolveEffectiveProfile(
              next,
              shared,
            ).configuration;
            if (
              !proposed ||
              !narrowsTools(
                config.tools,
                proposed.tools,
                operatorToolNames(shared),
              )
            ) {
              throw new Error("A profile revision cannot add tools.");
            }
            const proposal = await createProposal(
              options.profilesRoot,
              options.proposalsRoot,
              definition,
              { operation: "update", origin: profile.id },
              soul,
              profile.resourceFiles,
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
        let responseStarted = false;
        let lastStatus: number | undefined;
        const attempts: string[] = [];
        const streamSimple = modelRuntime.streamSimple.bind(modelRuntime);
        modelRuntime.streamSimple = (model, context, options) =>
          streamSimple(model, context, {
            ...options,
            fetch: async (...args) => {
              mcp?.assertReady();
              const response = await fetch(...args);
              lastStatus = response.status;
              return response;
            },
          });
        const loader = new DefaultResourceLoader({
          cwd: options.cwd.trim(),
          agentDir,
          settingsManager: settings,
          noExtensions: true,
          noSkills: true,
          noPromptTemplates: true,
          noThemes: true,
          noContextFiles: true,
          skillsOverride: () => skills,
          additionalPromptTemplatePaths: promptPaths,
          systemPrompt: "",
          appendSystemPrompt: [],
          systemPromptOverride: () => instructions,
          extensionFactories: [
            ...builtins.map((entry) => entry.factory),
            ...installed.factories,
            (pi) => {
              pi.on("tool_call", (event) => {
                runtime.current();
                responseStarted = true;
                try {
                  mcp?.assertReady();
                } catch {
                  return {
                    block: true,
                    reason:
                      "Local MCP connection is unavailable; earlier actions may have completed.",
                  };
                }
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
                  !availableNames.includes(event.toolName) ||
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
                lastStatus = undefined;
                runtime.current();
                if (++requests > limits.maxRequests)
                  controller.abort(
                    new Error("Profile turn request limit reached."),
                  );
              });
            },
          ],
        });
        await loader.reload();
        const prompts = loader.getPrompts();
        if (prompts.diagnostics.length)
          throw new Error("Configured prompt templates are invalid.");
        if (loader.getExtensions().errors.length)
          throw new Error("Profile policy could not load.");
        const manager = options.newSession
          ? SessionManager.create(options.cwd.trim(), sessions)
          : SessionManager.continueRecent(options.cwd.trim(), sessions);
        if (
          Buffer.byteLength(
            JSON.stringify(manager.buildSessionContext().messages),
          ) > limits.maxHistoryBytes
        ) {
          throw new Error(
            "Profile history limit reached; start a new session.",
          );
        }
        mcp = await openMcpSession(effective.mcpServers ?? [], {
          installedRoot: options.installedMcpRoot,
          remoteOrigin,
          cwd: options.cwd.trim(),
          agentDir,
          signal,
        });
        const { session } = await createAgentSession({
          cwd: options.cwd.trim(),
          agentDir,
          modelRuntime,
          model,
          thinkingLevel: selection.thinking,
          tools: [...visible],
          excludeTools: availableNames.filter(
            (name) => !toolNames.includes(name),
          ),
          customTools: [
            proposalTool,
            ...(options.maintain ? [revisionTool] : []),
            ...mcp.tools,
          ],
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
            event.type === "message_update" &&
            [
              "text_delta",
              "thinking_delta",
              "toolcall_start",
              "toolcall_delta",
            ].includes(event.assistantMessageEvent.type)
          ) {
            responseStarted = true;
          }
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
          const actualTools = loader
            .getExtensions()
            .extensions.flatMap((extension) => [...extension.tools.keys()]);
          if (
            actualTools.length !== registeredExtensions.length ||
            actualTools.some((name) => !registeredExtensions.includes(name))
          )
            throw new Error(
              "Installed extension tools do not match the operator catalog.",
            );
          signal.throwIfAborted();
          const startingLeaf = manager.getLeafId();
          for (let index = 0; index < candidates.length; index++) {
            selection = candidates[index]!;
            if (index > 0) {
              if (startingLeaf) manager.branch(startingLeaf);
              else manager.resetLeaf();
              session.refreshContext();
              const next = modelRuntime.getModel(
                selection.provider,
                selection.id,
              );
              if (!next) throw new Error("Fallback model is unavailable.");
              await session.setModel(next);
              session.setThinkingLevel(selection.thinking);
            }
            attempts.push(selection.id);
            const previous = session.messages.length;
            await session.prompt(request.prompt, {
              expandPromptTemplates: prompts.prompts.length > 0,
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
              if (
                !responseStarted &&
                installed.factories.length === 0 &&
                !effective.mcpServers?.length &&
                [429, 502, 503, 504].includes(lastStatus ?? 0) &&
                index + 1 < candidates.length
              )
                continue;
              throw new Error(
                "Profile inference failed; private provider diagnostics omitted.",
              );
            }
            return {
              profileId: profile.id,
              model: selection.id,
              attempts,
              toolNames: session.getActiveToolNames(),
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
          }
          throw new Error("Profile model candidates exhausted.");
        } finally {
          unsubscribe();
          signal.removeEventListener("abort", abort);
          session.dispose();
        }
      } finally {
        try {
          await mcp?.close();
        } finally {
          clearTimeout(deadline);
          await lock.close();
          await unlink(lockPath);
        }
      }
    },
    { signal },
  );
}
