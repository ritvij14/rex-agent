import { ProfileError } from "./errors.ts";

export interface ModelReference {
  readonly provider: string;
  readonly id: string;
}

export interface ToolPolicy {
  readonly whitelist: readonly string[];
  readonly blacklist: readonly string[];
}

export interface ProfileConfiguration {
  readonly instructions: string;
  readonly model: ModelReference;
  readonly tools: ToolPolicy;
}

export type ProfileVersion = 2;

export interface ProfileDefinition {
  readonly id: string;
  readonly version?: ProfileVersion;
  readonly configuration?: ProfileConfiguration;
  readonly model?: ModelReference;
  readonly tools?: ToolPolicy;
}

export interface SharedConfiguration {
  readonly version: ProfileVersion;
  readonly soul?: string;
  readonly model?: ModelReference;
  readonly tools?: ToolPolicy;
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
    !objectWithKeys(value, ["provider", "id"]) ||
    typeof value.provider !== "string" ||
    !/^[a-z][a-z0-9-]{0,63}$/.test(value.provider) ||
    typeof value.id !== "string" ||
    value.id !== value.id.trim() ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(value.id)
  ) {
    throw new ProfileError("INVALID_PROFILE_DEFINITION");
  }
  return Object.freeze({ provider: value.provider, id: value.id });
}

const legacyConfiguration = (value: unknown): ProfileConfiguration => {
  if (
    !objectWithKeys(value, ["instructions", "model", "tools"]) ||
    typeof value.instructions !== "string" ||
    !value.instructions.trim() ||
    value.instructions.length > 2000
  ) {
    throw new ProfileError("INVALID_PROFILE_DEFINITION");
  }
  return Object.freeze({
    instructions: value.instructions,
    model: modelReference(value.model),
    tools: toolPolicy(value.tools),
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
      keys.length > 4 ||
      keys.some(
        (key) =>
          !(
            key === "id" ||
            key === "version" ||
            key === "model" ||
            key === "tools"
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
    } = { id: value.id as string, version: 2 };
    if (Object.hasOwn(value, "model"))
      parsed.model = modelReference(value.model);
    if (Object.hasOwn(value, "tools")) parsed.tools = toolPolicy(value.tools);
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
    keys.length > 4 ||
    keys.some(
      (key) =>
        !(
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
    model?: ModelReference;
    tools?: ToolPolicy;
    mandatory?: { tools?: { blacklist: readonly string[] } };
  } = { version: 2 };
  try {
    if (Object.hasOwn(value, "model"))
      parsed.model = modelReference(value.model);
    if (Object.hasOwn(value, "tools")) parsed.tools = toolPolicy(value.tools);
  } catch {
    throw new ProfileError("INVALID_SHARED_CONFIGURATION");
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
    readonly soul?: string;
    readonly configuration?: ProfileConfiguration;
    readonly model?: ModelReference;
    readonly tools?: ToolPolicy;
  },
  shared?: SharedConfiguration,
) {
  const persona = profile.configuration?.instructions ?? profile.soul;
  const tools = profile.configuration?.tools ?? profile.tools;
  if (persona) {
    const model =
      profile.configuration?.model ?? profile.model ?? shared?.model;
    if (!model) throw new ProfileError("PROFILE_INCOMPLETE");
    const instructions = shared?.soul
      ? `${shared.soul}\n\n${persona}`
      : persona;
    const blacklist = [
      ...(tools?.blacklist ?? []),
      ...(shared?.tools?.blacklist ?? []),
      ...(shared?.mandatory?.tools?.blacklist ?? []),
    ];
    return Object.freeze({
      id: profile.id,
      home: profile.home,
      soul: profile.soul,
      configuration: Object.freeze({
        instructions,
        model,
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
