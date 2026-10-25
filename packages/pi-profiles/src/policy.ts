import { type ProfileDefinition } from "@rex/profiles";

export const TOOL_NAMES = [
  "read",
  "bash",
  "edit",
  "write",
  "ls",
  "propose_profile",
] as const;

export function requireRunnable(definition: ProfileDefinition) {
  const config = definition.configuration;
  if (
    !config ||
    config.model.provider !== "cli-proxy" ||
    [...config.tools.whitelist, ...config.tools.blacklist].some(
      (name) => name !== "*" && !TOOL_NAMES.some((tool) => tool === name),
    )
  ) {
    throw new Error("Profile configuration is not supported by this adapter.");
  }
  return config;
}
