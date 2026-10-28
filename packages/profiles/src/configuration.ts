import { ProfileError } from "./errors.ts";

export interface TurnLimits {
  readonly deadlineMs?: number;
  readonly maxRequests?: number;
  readonly maxHistoryBytes?: number;
}
export const DEFAULT_TURN_LIMITS = Object.freeze({
  deadlineMs: 90000,
  maxRequests: 12,
  maxHistoryBytes: 131072,
});

function turnLimits(value: unknown): TurnLimits {
  if (!isPlainObject(value))
    throw new ProfileError("INVALID_PROFILE_DEFINITION");
  const bounds = {
    deadlineMs: [100, 180000],
    maxRequests: [1, 64],
    maxHistoryBytes: [1024, 1048576],
  } as const;
  const parsed: Record<string, number> = {};
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(bounds, key))
      throw new ProfileError("INVALID_PROFILE_DEFINITION");
    const [min, max] = bounds[key as keyof typeof bounds];
    const limit = value[key];
    if (
      typeof limit !== "number" ||
      !Number.isSafeInteger(limit) ||
      limit < min ||
      limit > max
    )
      throw new ProfileError("INVALID_PROFILE_DEFINITION");
    parsed[key] = limit;
  }
  return Object.freeze(parsed);
}

export interface ResourceFile {
  readonly path: string;
  readonly text: string;
}
export interface ResourceConfiguration {
  readonly instructions?: readonly string[];
  readonly skills?: readonly string[];
  readonly prompts?: readonly string[];
  readonly references?: readonly string[];
  readonly workspaceInstructions?: readonly string[];
  readonly extensions?: readonly string[];
  readonly mcp?: readonly string[];
  readonly codemode?: boolean;
}

export function resourcePaths(
  resources?: ResourceConfiguration,
): readonly string[] {
  return [
    ...(resources?.instructions ?? []),
    ...(resources?.skills ?? []),
    ...(resources?.prompts ?? []),
    ...(resources?.references ?? []),
  ];
}

export function parseResourceConfiguration(
  value: unknown,
): ResourceConfiguration {
  if (
    !isPlainObject(value) ||
    Object.keys(value).length < 1 ||
    Object.keys(value).some(
      (key) =>
        ![
          "instructions",
          "skills",
          "prompts",
          "references",
          "workspaceInstructions",
          "extensions",
          "mcp",
          "codemode",
        ].includes(key),
    )
  )
    throw new ProfileError("INVALID_PROFILE_DEFINITION");
  const parsed: {
    instructions?: readonly string[];
    skills?: readonly string[];
    prompts?: readonly string[];
    references?: readonly string[];
    workspaceInstructions?: readonly string[];
    extensions?: readonly string[];
    mcp?: readonly string[];
    codemode?: boolean;
  } = {};
  if (Object.hasOwn(value, "codemode")) {
    if (typeof value.codemode !== "boolean")
      throw new ProfileError("INVALID_PROFILE_DEFINITION");
    parsed.codemode = value.codemode;
  }
  for (const key of ["extensions", "mcp"] as const) {
    if (!Object.hasOwn(value, key)) continue;
    const ids = value[key];
    if (
      !Array.isArray(ids) ||
      ids.length > 8 ||
      new Set(ids).size !== ids.length ||
      ids.some(
        (id) =>
          typeof id !== "string" ||
          id !== id.trim() ||
          id.length > 64 ||
          !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id),
      )
    )
      throw new ProfileError("INVALID_PROFILE_DEFINITION");
    parsed[key] = Object.freeze([...ids]);
  }
  for (const key of [
    "instructions",
    "skills",
    "prompts",
    "references",
    "workspaceInstructions",
  ] as const) {
    if (!Object.hasOwn(value, key)) continue;
    const paths = value[key];
    if (
      !Array.isArray(paths) ||
      paths.length > 8 ||
      paths.some(
        (path) =>
          typeof path !== "string" ||
          path.length > 200 ||
          path !== path.trim() ||
          !(key === "workspaceInstructions"
            ? /^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.md$/.test(path) &&
              !path.split("/").some((part) => part === "." || part === "..")
            : /^resources\/(?:[a-z0-9][a-z0-9-]*\/)*(?:[a-z0-9][a-z0-9-]*\.md|SKILL\.md)$/.test(
                path,
              )) ||
          (key === "skills" && !path.endsWith("/SKILL.md")),
      )
    )
      throw new ProfileError("INVALID_PROFILE_DEFINITION");
    parsed[key] = Object.freeze([...paths]);
  }
  const paths = [
    ...resourcePaths(parsed),
    ...(parsed.workspaceInstructions ?? []),
  ];
  if (paths.length > 8 || new Set(paths).size !== paths.length)
    throw new ProfileError("INVALID_PROFILE_DEFINITION");
  return Object.freeze(parsed);
}

export function validateResourceFiles(
  paths: readonly string[],
  files: unknown,
  workspace = false,
): readonly ResourceFile[] {
  parseResourceConfiguration(
    workspace ? { workspaceInstructions: paths } : { instructions: paths },
  );
  if (!Array.isArray(files) || files.length !== paths.length)
    throw new Error("Instruction resource is unavailable or invalid.");
  let total = 0;
  const result = files.map((file: unknown, index) => {
    if (
      !objectWithKeys(file, ["path", "text"]) ||
      file.path !== paths[index] ||
      typeof file.text !== "string" ||
      !file.text.trim() ||
      Buffer.byteLength(file.text) > 16384
    )
      throw new Error("Instruction resource is unavailable or invalid.");
    total += Buffer.byteLength(file.text);
    return Object.freeze({ path: file.path as string, text: file.text });
  });
  if (total > 65536)
    throw new Error("Instruction resource is unavailable or invalid.");
  return Object.freeze(result);
}

export interface ModelReference {
  readonly provider: string;
  readonly id: string;
  readonly overrides?: readonly string[];
  readonly fallbacks?: readonly string[];
  readonly thinking?: "off" | "minimal" | "low" | "medium" | "high";
}

export interface ToolPolicy {
  readonly whitelist: readonly string[];
  readonly blacklist: readonly string[];
}

export interface ProfileConfiguration {
  readonly instructions: string;
  readonly model: ModelReference;
  readonly tools: ToolPolicy;
  readonly limits?: TurnLimits;
  readonly resources?: ResourceConfiguration;
}

export type ProfileVersion = 2;

export interface ProfileDefinition {
  readonly id: string;
  readonly version?: ProfileVersion;
  readonly configuration?: ProfileConfiguration;
  readonly model?: ModelReference;
  readonly tools?: ToolPolicy;
  readonly limits?: TurnLimits;
  readonly resources?: ResourceConfiguration;
}

export interface CatalogModel {
  readonly id: string;
  readonly api:
    "openai-completions" | "openai-responses" | "anthropic-messages";
  readonly contextWindow: number;
  readonly maxOutputTokens: number;
  readonly reasoning: boolean;
}

export interface ExtensionCatalogEntry {
  readonly id: string;
  readonly sha256: string;
  readonly tools: readonly string[];
}

export interface SharedConfiguration {
  readonly version: ProfileVersion;
  readonly models?: readonly CatalogModel[];
  readonly extensionCatalog?: readonly ExtensionCatalogEntry[];
  readonly localMcpCatalog?: readonly LocalMcpServer[];
  readonly resourceFiles?: readonly ResourceFile[];
  readonly soul?: string;
  readonly model?: ModelReference;
  readonly tools?: ToolPolicy;
  readonly limits?: TurnLimits;
  readonly resources?: ResourceConfiguration;
  readonly mandatory?: {
    readonly tools?: { readonly blacklist: readonly string[] };
  };
}

export function validateProfileId(id: unknown): asserts id is string {
  if (
    typeof id !== "string" ||
    id.length > 64 ||
    id !== id.trim() ||
    id === "shared" ||
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)
  ) {
    throw new ProfileError("INVALID_PROFILE_ID");
  }
}

function objectWithKeys(
  value: unknown,
  keys: string[],
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

const toolName = /^[a-zA-Z_][a-zA-Z0-9_-]{0,127}$/;

function rules(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 64 &&
    value.every(
      (rule) =>
        typeof rule === "string" &&
        (rule === "*" || (rule === rule.trim() && toolName.test(rule))),
    )
  );
}

function toolPolicy(value: unknown): ToolPolicy {
  if (
    !objectWithKeys(value, ["whitelist", "blacklist"]) ||
    !rules(value.whitelist) ||
    !rules(value.blacklist)
  ) {
    throw new ProfileError("INVALID_PROFILE_DEFINITION");
  }
  return Object.freeze({
    whitelist: Object.freeze([...value.whitelist]),
    blacklist: Object.freeze([...value.blacklist]),
  });
}

function modelReference(value: unknown): ModelReference {
  if (
    !isPlainObject(value) ||
    !Object.hasOwn(value, "provider") ||
    !Object.hasOwn(value, "id") ||
    Object.keys(value).some(
      (key) =>
        !["provider", "id", "overrides", "fallbacks", "thinking"].includes(key),
    ) ||
    typeof value.provider !== "string" ||
    !/^[a-z][a-z0-9-]{0,63}$/.test(value.provider) ||
    typeof value.id !== "string" ||
    value.id !== value.id.trim() ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(value.id)
  ) {
    throw new ProfileError("INVALID_PROFILE_DEFINITION");
  }
  if (
    value.thinking !== undefined &&
    !["off", "minimal", "low", "medium", "high"].includes(
      value.thinking as string,
    )
  )
    throw new ProfileError("INVALID_PROFILE_DEFINITION");
  const lists: {
    overrides?: readonly string[];
    fallbacks?: readonly string[];
  } = {};
  for (const key of ["overrides", "fallbacks"] as const) {
    const ids = value[key];
    if (ids !== undefined) {
      if (
        !Array.isArray(ids) ||
        ids.length > (key === "fallbacks" ? 4 : 8) ||
        new Set(ids).size !== ids.length ||
        ids.some(
          (id) =>
            typeof id !== "string" ||
            id !== id.trim() ||
            !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(id) ||
            (key === "fallbacks" && id === value.id),
        )
      )
        throw new ProfileError("INVALID_PROFILE_DEFINITION");
      lists[key] = Object.freeze([...ids]);
    }
  }
  return Object.freeze({
    provider: value.provider,
    id: value.id,
    ...lists,
    ...(value.thinking !== undefined
      ? { thinking: value.thinking as ModelReference["thinking"] }
      : {}),
  });
}

const legacyConfiguration = (value: unknown): ProfileConfiguration => {
  if (
    !isPlainObject(value) ||
    !["instructions", "model", "tools"].every((key) =>
      Object.hasOwn(value, key),
    ) ||
    Object.keys(value).some(
      (key) =>
        !["instructions", "model", "tools", "limits", "resources"].includes(
          key,
        ),
    ) ||
    typeof value.instructions !== "string" ||
    !value.instructions.trim() ||
    value.instructions.length > 2000
  ) {
    throw new ProfileError("INVALID_PROFILE_DEFINITION");
  }
  return Object.freeze({
    instructions: value.instructions,
    ...(Object.hasOwn(value, "resources")
      ? { resources: parseResourceConfiguration(value.resources) }
      : {}),
    model: modelReference(value.model),
    tools: toolPolicy(value.tools),
    ...(Object.hasOwn(value, "limits")
      ? { limits: turnLimits(value.limits) }
      : {}),
  });
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function parseProfileDefinition(value: unknown): ProfileDefinition {
  if (!isPlainObject(value) || !Object.hasOwn(value, "id")) {
    throw new ProfileError("INVALID_PROFILE_DEFINITION");
  }
  try {
    validateProfileId(value.id);
  } catch {
    throw new ProfileError("INVALID_PROFILE_DEFINITION");
  }
  if (Object.hasOwn(value, "version")) {
    if (value.version !== 2) {
      throw new ProfileError("UNSUPPORTED_PROFILE_VERSION");
    }
    const keys = Object.keys(value);
    if (
      keys.length > 6 ||
      keys.some(
        (key) =>
          !(
            key === "id" ||
            key === "version" ||
            key === "model" ||
            key === "tools" ||
            key === "resources" ||
            key === "limits"
          ),
      )
    ) {
      throw new ProfileError("INVALID_PROFILE_DEFINITION");
    }
    const parsed: {
      id: string;
      version: ProfileVersion;
      model?: ModelReference;
      tools?: ToolPolicy;
      limits?: TurnLimits;
      resources?: ResourceConfiguration;
    } = { id: value.id as string, version: 2 };
    if (Object.hasOwn(value, "model"))
      parsed.model = modelReference(value.model);
    if (Object.hasOwn(value, "tools")) parsed.tools = toolPolicy(value.tools);
    if (Object.hasOwn(value, "limits"))
      parsed.limits = turnLimits(value.limits);
    if (Object.hasOwn(value, "resources"))
      parsed.resources = parseResourceConfiguration(value.resources);
    return Object.freeze(parsed);
  }
  if (Object.keys(value).length === 1) return Object.freeze({ id: value.id });
  if (
    Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, "configuration")
  ) {
    throw new ProfileError("INVALID_PROFILE_DEFINITION");
  }
  const config = legacyConfiguration(value.configuration);
  return Object.freeze({ id: value.id, configuration: config });
}

export function parseSharedConfiguration(value: unknown): SharedConfiguration {
  if (!isPlainObject(value) || value.version !== 2) {
    throw new ProfileError("INVALID_SHARED_CONFIGURATION");
  }
  const keys = Object.keys(value);
  if (
    keys.length > 9 ||
    keys.some(
      (key) =>
        !(
          key === "extensionCatalog" ||
          key === "localMcpCatalog" ||
          key === "resources" ||
          key === "limits" ||
          key === "models" ||
          key === "version" ||
          key === "model" ||
          key === "tools" ||
          key === "mandatory"
        ),
    )
  ) {
    throw new ProfileError("INVALID_SHARED_CONFIGURATION");
  }
  const parsed: {
    version: ProfileVersion;
    models?: readonly CatalogModel[];
    extensionCatalog?: readonly ExtensionCatalogEntry[];
    localMcpCatalog?: readonly LocalMcpServer[];
    model?: ModelReference;
    tools?: ToolPolicy;
    limits?: TurnLimits;
    resources?: ResourceConfiguration;
    mandatory?: { tools?: { blacklist: readonly string[] } };
  } = { version: 2 };
  try {
    if (Object.hasOwn(value, "localMcpCatalog"))
      parsed.localMcpCatalog = parseLocalMcpCatalog(value.localMcpCatalog);
    if (Object.hasOwn(value, "resources"))
      parsed.resources = parseResourceConfiguration(value.resources);
    if (Object.hasOwn(value, "model"))
      parsed.model = modelReference(value.model);
    if (Object.hasOwn(value, "tools")) parsed.tools = toolPolicy(value.tools);
    if (Object.hasOwn(value, "limits"))
      parsed.limits = turnLimits(value.limits);
  } catch {
    throw new ProfileError("INVALID_SHARED_CONFIGURATION");
  }
  if (Object.hasOwn(value, "extensionCatalog")) {
    const entries = value.extensionCatalog;
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > 16)
      throw new ProfileError("INVALID_SHARED_CONFIGURATION");
    const ids = new Set<string>();
    const tools = new Set<string>();
    parsed.extensionCatalog = Object.freeze(
      entries.map((entry: unknown) => {
        if (
          !objectWithKeys(entry, ["id", "sha256", "tools"]) ||
          typeof entry.id !== "string" ||
          entry.id !== entry.id.trim() ||
          entry.id.length > 64 ||
          !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(entry.id) ||
          ids.has(entry.id) ||
          typeof entry.sha256 !== "string" ||
          entry.sha256.length !== 64 ||
          !/^[a-f0-9]{64}$/.test(entry.sha256) ||
          !Array.isArray(entry.tools) ||
          entry.tools.length > 32 ||
          entry.tools.some(
            (name) =>
              typeof name !== "string" ||
              name !== name.trim() ||
              !toolName.test(name) ||
              tools.has(name),
          ) ||
          new Set(entry.tools).size !== entry.tools.length
        )
          throw new ProfileError("INVALID_SHARED_CONFIGURATION");
        ids.add(entry.id);
        for (const name of entry.tools) tools.add(name);
        return Object.freeze({
          id: entry.id,
          sha256: entry.sha256,
          tools: Object.freeze([...(entry.tools as string[])]),
        });
      }),
    );
  }
  const mcpNames = localMcpToolNames(parsed.localMcpCatalog ?? []);
  if (
    parsed.extensionCatalog?.some((entry) =>
      entry.tools.some((name) => mcpNames.includes(name)),
    )
  )
    throw new ProfileError("INVALID_SHARED_CONFIGURATION");
  if (Object.hasOwn(value, "models")) {
    const models = value.models;
    if (!Array.isArray(models) || models.length < 1 || models.length > 64)
      throw new ProfileError("INVALID_SHARED_CONFIGURATION");
    const seen = new Set<string>();
    parsed.models = Object.freeze(
      models.map((entry: unknown) => {
        if (
          !objectWithKeys(entry, [
            "id",
            "api",
            "contextWindow",
            "maxOutputTokens",
            "reasoning",
          ]) ||
          typeof entry.id !== "string" ||
          entry.id !== entry.id.trim() ||
          !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(entry.id) ||
          seen.has(entry.id) ||
          ![
            "openai-completions",
            "openai-responses",
            "anthropic-messages",
          ].includes(entry.api as string) ||
          typeof entry.contextWindow !== "number" ||
          !Number.isSafeInteger(entry.contextWindow) ||
          entry.contextWindow < 1 ||
          entry.contextWindow > 10000000 ||
          typeof entry.maxOutputTokens !== "number" ||
          !Number.isSafeInteger(entry.maxOutputTokens) ||
          entry.maxOutputTokens < 0 ||
          entry.maxOutputTokens > entry.contextWindow ||
          (entry.api === "anthropic-messages" && entry.maxOutputTokens === 0) ||
          typeof entry.reasoning !== "boolean"
        )
          throw new ProfileError("INVALID_SHARED_CONFIGURATION");
        seen.add(entry.id);
        return Object.freeze({
          id: entry.id,
          api: entry.api as CatalogModel["api"],
          contextWindow: entry.contextWindow,
          maxOutputTokens: entry.maxOutputTokens,
          reasoning: entry.reasoning,
        });
      }),
    );
  }
  if (Object.hasOwn(value, "mandatory")) {
    const mandatory = isPlainObject(value.mandatory)
      ? value.mandatory
      : undefined;
    const tools =
      mandatory &&
      Object.keys(mandatory).length === 1 &&
      Object.hasOwn(mandatory, "tools")
        ? mandatory.tools
        : undefined;
    const blacklist =
      isPlainObject(tools) &&
      Object.keys(tools).length === 1 &&
      Object.hasOwn(tools, "blacklist")
        ? tools.blacklist
        : undefined;
    if (!rules(blacklist)) {
      throw new ProfileError("INVALID_SHARED_CONFIGURATION");
    }
    parsed.mandatory = Object.freeze({
      tools: Object.freeze({
        blacklist: Object.freeze([...blacklist]),
      }),
    });
  }
  return Object.freeze(parsed);
}

export function resolveEffectiveProfile(
  profile: {
    readonly id: string;
    readonly home: string;
    readonly resourceFiles?: readonly ResourceFile[];
    readonly soul?: string;
    readonly configuration?: ProfileConfiguration;
    readonly model?: ModelReference;
    readonly tools?: ToolPolicy;
    readonly limits?: TurnLimits;
    readonly resources?: ResourceConfiguration;
  },
  shared?: SharedConfiguration,
) {
  const persona = profile.configuration?.instructions ?? profile.soul;
  const tools = profile.configuration?.tools ?? profile.tools;
  if (persona) {
    const model =
      profile.configuration?.model ?? profile.model ?? shared?.model;
    if (!model) throw new ProfileError("PROFILE_INCOMPLETE");
    const ownInstructionPaths =
      (profile.configuration?.resources ?? profile.resources)?.instructions ??
      [];
    const sharedInstructionPaths = shared?.resources?.instructions ?? [];
    const instructions = [
      shared?.soul,
      ...(shared?.resourceFiles
        ?.filter((file) => sharedInstructionPaths.includes(file.path))
        .map((file) => file.text) ?? []),
      persona,
      ...(profile.resourceFiles
        ?.filter((file) => ownInstructionPaths.includes(file.path))
        .map((file) => file.text) ?? []),
    ]
      .filter((text) => text !== undefined)
      .join("\n\n");
    const mcpServers = selectLocalMcpServers(shared?.localMcpCatalog, [
      ...(shared?.resources?.mcp ?? []),
      ...((profile.configuration?.resources ?? profile.resources)?.mcp ?? []),
    ]);
    const blacklist = [
      ...(tools?.blacklist ?? []),
      ...(shared?.tools?.blacklist ?? []),
      ...(shared?.mandatory?.tools?.blacklist ?? []),
    ];
    return Object.freeze({
      id: profile.id,
      home: profile.home,
      soul: profile.soul,
      ...(mcpServers.length ? { mcpServers } : {}),
      ...(shared?.resources?.codemode ||
      (profile.configuration?.resources ?? profile.resources)?.codemode
        ? { codemode: true as const }
        : {}),
      configuration: Object.freeze({
        instructions,
        model,
        ...((profile.configuration?.limits ?? profile.limits) || shared?.limits
          ? {
              limits: Object.freeze({
                ...DEFAULT_TURN_LIMITS,
                ...shared?.limits,
                ...(profile.configuration?.limits ?? profile.limits),
              }),
            }
          : {}),
        tools: Object.freeze({
          whitelist: Object.freeze([
            ...(tools?.whitelist ?? shared?.tools?.whitelist ?? []),
          ]),
          blacklist: Object.freeze([...new Set(blacklist)]),
        }),
      }),
    });
  }
  throw new ProfileError("PROFILE_INCOMPLETE");
}

export function isToolAllowed(policy: ToolPolicy, name: string): boolean {
  return (
    typeof name === "string" &&
    name === name.trim() &&
    toolName.test(name) &&
    (policy.whitelist.includes("*") || policy.whitelist.includes(name)) &&
    !policy.blacklist.includes("*") &&
    !policy.blacklist.includes(name)
  );
}

export function parseProfileRequest(input: string): {
  profileId: string;
  prompt: string;
} {
  if (typeof input !== "string" || Buffer.byteLength(input) > 65536) {
    throw new ProfileError("INVALID_PROFILE_REQUEST");
  }
  const newline = input.indexOf("\n");
  const first = input.slice(0, newline).replace(/\r$/, "");
  const prompt = input.slice(newline + 1).trim();
  if (newline < 0 || !first.startsWith("profile: ") || !prompt) {
    throw new ProfileError("INVALID_PROFILE_REQUEST");
  }
  const profileId = first.slice("profile: ".length);
  validateProfileId(profileId);
  return { profileId, prompt };
}

export function selectProfileModel(
  model: ModelReference,
  catalog?: readonly CatalogModel[],
  override?: string,
) {
  if (
    override !== undefined &&
    (!model.overrides?.includes(override) || !catalog)
  )
    throw new Error("Model override is not allowed for this profile.");
  const id = override ?? model.id;
  const metadata = catalog?.find((entry) => entry.id === id);
  if (catalog && !metadata)
    throw new Error("Profile model is absent from the operator catalog.");
  const thinking = model.thinking ?? "off";
  if (thinking !== "off" && !metadata?.reasoning)
    throw new Error("The selected catalog model does not support reasoning.");
  return Object.freeze({ provider: model.provider, id, metadata, thinking });
}

export function parseProfileArguments(args: readonly string[]) {
  const rest = [...args];
  let newSession = false;
  let maintain = false;
  let modelOverride: string | undefined;
  while (rest[0]?.startsWith("--")) {
    if (rest[0] === "--new-session" && !newSession) newSession = true;
    else if (rest[0] === "--maintain" && !maintain) maintain = true;
    else if (rest[0] === "--model" && modelOverride === undefined) {
      const id = rest[1];
      if (
        !id ||
        id !== id.trim() ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(id)
      )
        throw new Error("Invalid profile arguments.");
      modelOverride = id;
      rest.shift();
    } else throw new Error("Invalid profile arguments.");
    rest.shift();
  }
  if (rest.length > 1) throw new Error("Invalid profile arguments.");
  return {
    newSession,
    maintain,
    ...(modelOverride !== undefined ? { modelOverride } : {}),
    input: rest[0] ?? null,
  };
}

export interface LocalMcpServer {
  readonly id: string;
  readonly sha256: string;
  readonly tools: readonly string[];
  readonly args: readonly string[];
  readonly resources: boolean;
  readonly exposure?: "direct" | "codemode" | "deferred";
}

function mcpServerToolNames(entry: LocalMcpServer) {
  return entry.tools.map((tool) =>
    `mcp__${entry.id}__${tool}`.replace(/[^A-Za-z0-9_]/g, "_"),
  );
}

export function localMcpToolNames(catalog: readonly LocalMcpServer[]) {
  return Object.freeze([
    ...catalog.flatMap(mcpServerToolNames),
    ...(catalog.some((entry) => entry.resources)
      ? [
          "list_mcp_resources",
          "list_mcp_resource_templates",
          "read_mcp_resource",
        ]
      : []),
  ]);
}

export function parseLocalMcpCatalog(
  value: unknown,
): readonly LocalMcpServer[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8)
    throw new ProfileError("INVALID_MCP_CATALOG");
  const ids = new Set<string>();
  const names = new Set<string>();
  return Object.freeze(
    value.map((entry: unknown) => {
      if (
        !isPlainObject(entry) ||
        ["id", "sha256", "tools"].some((key) => !Object.hasOwn(entry, key)) ||
        Object.keys(entry).some(
          (key) =>
            ![
              "id",
              "sha256",
              "tools",
              "args",
              "resources",
              "exposure",
            ].includes(key),
        ) ||
        typeof entry.id !== "string" ||
        entry.id.length > 64 ||
        !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(entry.id) ||
        entry.id !== entry.id.trim() ||
        ids.has(entry.id) ||
        typeof entry.sha256 !== "string" ||
        entry.sha256.length !== 64 ||
        !/^[a-f0-9]{64}$/.test(entry.sha256) ||
        !Array.isArray(entry.tools) ||
        entry.tools.length > 32 ||
        entry.tools.some(
          (tool) =>
            typeof tool !== "string" ||
            tool !== tool.trim() ||
            !/^[A-Za-z_][A-Za-z0-9_-]{0,127}$/.test(tool),
        ) ||
        (Object.hasOwn(entry, "resources") &&
          typeof entry.resources !== "boolean") ||
        (Object.hasOwn(entry, "exposure") &&
          !["direct", "codemode", "deferred"].includes(
            entry.exposure as string,
          ))
      )
        throw new ProfileError("INVALID_MCP_CATALOG");
      const args = Object.hasOwn(entry, "args") ? entry.args : [];
      if (
        !Array.isArray(args) ||
        args.length > 16 ||
        args.some(
          (arg) =>
            typeof arg !== "string" ||
            Buffer.byteLength(arg) > 512 ||
            /[\x00-\x1f\x7f]/.test(arg),
        ) ||
        args.reduce((sum, arg: string) => sum + Buffer.byteLength(arg), 0) >
          4096
      )
        throw new ProfileError("INVALID_MCP_CATALOG");
      const parsed = Object.freeze({
        id: entry.id,
        sha256: entry.sha256,
        tools: Object.freeze([...(entry.tools as string[])]),
        args: Object.freeze([...(args as string[])]),
        resources: entry.resources === true,
        ...(Object.hasOwn(entry, "exposure")
          ? { exposure: entry.exposure as LocalMcpServer["exposure"] }
          : {}),
      });
      for (const name of mcpServerToolNames(parsed)) {
        if (name.length > 64 || names.has(name))
          throw new ProfileError("INVALID_MCP_CATALOG");
        names.add(name);
      }
      ids.add(parsed.id);
      return parsed;
    }),
  );
}

export function selectLocalMcpServers(
  catalog: readonly LocalMcpServer[] | undefined,
  ids: readonly string[],
) {
  const selected = [...new Set(ids)];
  if (selected.length > 8) throw new ProfileError("INVALID_MCP_CATALOG");
  return Object.freeze(
    selected.map((id) => {
      const entry = catalog?.find((entry) => entry.id === id);
      if (!entry) throw new ProfileError("INVALID_MCP_CATALOG");
      return entry;
    }),
  );
}

export function planProfileModels(
  model: ModelReference,
  catalog?: readonly CatalogModel[],
  override?: string,
) {
  const selected = selectProfileModel(model, catalog, override);
  if (override !== undefined || !model.fallbacks?.length)
    return Object.freeze([selected]);
  if (!catalog) throw new Error("Fallback models require an operator catalog.");
  return Object.freeze([
    selected,
    ...model.fallbacks.map((id) =>
      selectProfileModel(
        { provider: model.provider, id, thinking: model.thinking },
        catalog,
      ),
    ),
  ]);
}
