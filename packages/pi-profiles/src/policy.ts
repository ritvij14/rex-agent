import {
  isToolAllowed,
  localMcpToolNames,
  type ProfileConfiguration,
  type ToolPolicy,
  type SharedConfiguration,
} from "@rex/profiles";

export const TOOL_NAMES = [
  "read",
  "bash",
  "edit",
  "write",
  "ls",
  "propose_profile",
  "codemode",
  "tool_search",
] as const;

export function operatorToolNames(
  shared?: SharedConfiguration,
): readonly string[] {
  return [
    ...new Set<string>([
      ...TOOL_NAMES,
      ...(shared?.extensionCatalog?.flatMap((entry) => [...entry.tools]) ?? []),
      ...localMcpToolNames(shared?.localMcpCatalog ?? []),
      ...localMcpToolNames(shared?.remoteMcpCatalog ?? []),
    ]),
  ];
}

export function narrowsTools(
  current: ToolPolicy,
  proposed: ToolPolicy,
  names: readonly string[] = TOOL_NAMES,
) {
  return names.every(
    (name) => !isToolAllowed(proposed, name) || isToolAllowed(current, name),
  );
}

export function requireRunnable(
  config?: ProfileConfiguration,
  names: readonly string[] = TOOL_NAMES,
) {
  if (
    !config ||
    config.model.provider !== "cli-proxy" ||
    [...config.tools.whitelist, ...config.tools.blacklist].some(
      (name) => name !== "*" && !names.includes(name),
    )
  ) {
    throw new Error("Profile configuration is not supported by this adapter.");
  }
  return config;
}
