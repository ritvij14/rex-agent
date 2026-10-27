const messages = {
  UNSUPPORTED_PROFILE_VERSION: "Profile definition version is not supported.",
  INVALID_SHARED_CONFIGURATION: "Shared profile configuration is invalid.",
  INVALID_MCP_CATALOG: "Local MCP catalog is invalid.",
  SHARED_CONFIGURATION_UNAVAILABLE:
    "Shared profile configuration is unavailable.",
  PROFILE_INCOMPLETE: "Profile configuration is incomplete.",
  INVALID_PROFILES_ROOT: "An absolute profiles root is required.",
  INVALID_PROFILE_ID: "A valid explicit profile ID is required.",
  PROFILE_UNAVAILABLE: "The selected profile is unavailable.",
  INVALID_PROFILE_DEFINITION: "The selected profile definition is invalid.",
  INVALID_PROFILE_REQUEST:
    "Start with 'profile: <id>' on its own line, followed by a task.",
  NO_PROFILE_SCOPE: "No profile turn is active in this context.",
  CLOSED_PROFILE_SCOPE: "This profile turn has ended.",
  NESTED_PROFILE_SCOPE: "A profile turn cannot start inside another turn.",
} as const;

export type ProfileErrorCode = keyof typeof messages;

export class ProfileError extends Error {
  constructor(readonly code: ProfileErrorCode) {
    super(messages[code]);
    this.name = "ProfileError";
  }
}
