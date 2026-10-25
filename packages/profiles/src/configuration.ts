import { ProfileError } from "./errors.ts";

export interface ToolPolicy {
  readonly whitelist: readonly string[];
  readonly blacklist: readonly string[];
}

export interface ProfileConfiguration {
  readonly instructions: string;
  readonly model: { readonly provider: string; readonly id: string };
  readonly tools: ToolPolicy;
}

export interface ProfileDefinition {
  readonly id: string;
  readonly configuration?: ProfileConfiguration;
}

export function validateProfileId(id: unknown): asserts id is string {
  if (
    typeof id !== "string" ||
    id.length > 64 ||
    id !== id.trim() ||
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

export function parseProfileDefinition(value: unknown): ProfileDefinition {
  if (
    !objectWithKeys(value, ["id"]) &&
    !objectWithKeys(value, ["id", "configuration"])
  ) {
    throw new ProfileError("INVALID_PROFILE_DEFINITION");
  }
  try {
    validateProfileId(value.id);
  } catch {
    throw new ProfileError("INVALID_PROFILE_DEFINITION");
  }
  if (!Object.hasOwn(value, "configuration"))
    return Object.freeze({ id: value.id });
  const config = value.configuration;
  if (
    !objectWithKeys(config, ["instructions", "model", "tools"]) ||
    typeof config.instructions !== "string" ||
    !config.instructions.trim() ||
    config.instructions.length > 2000 ||
    !objectWithKeys(config.model, ["provider", "id"]) ||
    typeof config.model.provider !== "string" ||
    !/^[a-z][a-z0-9-]{0,63}$/.test(config.model.provider) ||
    typeof config.model.id !== "string" ||
    config.model.id !== config.model.id.trim() ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(config.model.id) ||
    !objectWithKeys(config.tools, ["whitelist", "blacklist"]) ||
    !rules(config.tools.whitelist) ||
    !rules(config.tools.blacklist)
  ) {
    throw new ProfileError("INVALID_PROFILE_DEFINITION");
  }
  return Object.freeze({
    id: value.id,
    configuration: Object.freeze({
      instructions: config.instructions,
      model: Object.freeze({
        provider: config.model.provider,
        id: config.model.id,
      }),
      tools: Object.freeze({
        whitelist: Object.freeze([...config.tools.whitelist]),
        blacklist: Object.freeze([...config.tools.blacklist]),
      }),
    }),
  });
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
