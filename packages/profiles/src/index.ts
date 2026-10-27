import { AsyncLocalStorage } from "node:async_hooks";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import {
  parseProfileDefinition,
  parseResourceConfiguration,
  resourcePaths,
  validateResourceFiles,
  parseSharedConfiguration,
  validateProfileId,
  type ExtensionCatalogEntry,
  type CatalogModel,
  type ModelReference,
  type ProfileConfiguration,
  type ProfileDefinition,
  type SharedConfiguration,
  type ToolPolicy,
  type TurnLimits,
  type ResourceConfiguration,
  type ResourceFile,
} from "./configuration.ts";
import { ProfileError } from "./errors.ts";
export { ProfileError, type ProfileErrorCode } from "./errors.ts";
export {
  parseLocalMcpCatalog,
  localMcpToolNames,
  selectLocalMcpServers,
  type LocalMcpServer,
  DEFAULT_TURN_LIMITS,
  validateResourceFiles,
  resourcePaths,
  isToolAllowed,
  parseProfileDefinition,
  parseProfileArguments,
  selectProfileModel,
  planProfileModels,
  parseProfileRequest,
  parseSharedConfiguration,
  resolveEffectiveProfile,
  validateProfileId,
  type ExtensionCatalogEntry,
  type CatalogModel,
  type ModelReference,
  type ProfileConfiguration,
  type ProfileDefinition,
  type ProfileVersion,
  type SharedConfiguration,
  type ToolPolicy,
  type TurnLimits,
  type ResourceConfiguration,
  type ResourceFile,
} from "./configuration.ts";

const DEFINITION_LIMIT = 4096;
const SOUL_LIMIT = 16384;

export interface Profile {
  readonly id: string;
  readonly home: string;
  readonly soul?: string;
  readonly configuration?: ProfileConfiguration;
  readonly model?: ModelReference;
  readonly tools?: ToolPolicy;
  readonly limits?: TurnLimits;
  readonly resources?: ResourceConfiguration;
  readonly resourceFiles?: readonly ResourceFile[];
}

function validateRoot(root: string): string {
  if (typeof root !== "string" || !isAbsolute(root.trim())) {
    throw new ProfileError("INVALID_PROFILES_ROOT");
  }
  return root.trim();
}

async function readBounded(
  path: string,
  limit: number,
): Promise<string | undefined> {
  let handle: FileHandle;
  try {
    handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) {
      throw new ProfileError("INVALID_PROFILE_DEFINITION");
    }
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        length,
        buffer.length - length,
        length,
      );
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > limit) {
      throw new ProfileError("INVALID_PROFILE_DEFINITION");
    }
    return buffer.subarray(0, length).toString("utf8");
  } finally {
    await handle.close();
  }
}

export async function lookupProfile(
  profilesRoot: string,
  id: string,
): Promise<Profile> {
  const root = validateRoot(profilesRoot);
  validateProfileId(id);
  try {
    const home = join(await realpath(root), id);
    if (!(await lstat(home)).isDirectory()) {
      throw new ProfileError("PROFILE_UNAVAILABLE");
    }
    let parsed: ProfileDefinition | undefined;
    try {
      const text = await readBounded(
        join(home, "profile.json"),
        DEFINITION_LIMIT,
      );
      if (text !== undefined) parsed = parseProfileDefinition(JSON.parse(text));
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ProfileError("INVALID_PROFILE_DEFINITION");
      }
      throw error;
    }
    if (parsed && parsed.id !== id) {
      throw new ProfileError("INVALID_PROFILE_DEFINITION");
    }
    const soulText = await readBounded(join(home, "SOUL.md"), SOUL_LIMIT);
    if (soulText !== undefined && !soulText.trim()) {
      throw new ProfileError("INVALID_PROFILE_DEFINITION");
    }
    if (parsed?.version === 2 && !soulText) {
      throw new ProfileError("INVALID_PROFILE_DEFINITION");
    }
    if (parsed?.configuration && soulText) {
      throw new ProfileError("INVALID_PROFILE_DEFINITION");
    }
    if (!parsed && !soulText) {
      throw new ProfileError("PROFILE_UNAVAILABLE");
    }
    const resources = parsed?.configuration?.resources ?? parsed?.resources;
    const resourceFiles = resources
      ? await readInstructionResources(home, resourcePaths(resources))
      : undefined;
    const soul = soulText;
    return Object.freeze({
      id,
      home,
      ...(parsed?.configuration ? { configuration: parsed.configuration } : {}),
      ...(parsed?.model ? { model: parsed.model } : {}),
      ...(parsed?.tools ? { tools: parsed.tools } : {}),
      ...(parsed?.limits ? { limits: parsed.limits } : {}),
      ...(parsed?.resources ? { resources: parsed.resources } : {}),
      ...(resourceFiles ? { resourceFiles } : {}),
      ...(soul ? { soul } : {}),
    });
  } catch (error) {
    if (error instanceof ProfileError) throw error;
    throw new ProfileError("PROFILE_UNAVAILABLE");
  }
}

export async function loadSharedConfiguration(
  sharedRoot: string,
): Promise<SharedConfiguration> {
  const root = validateRoot(sharedRoot);
  try {
    const home = await realpath(root);
    if (!(await lstat(home)).isDirectory()) {
      throw new ProfileError("INVALID_SHARED_CONFIGURATION");
    }
    let text: string | undefined;
    try {
      text = await readBounded(
        join(home, "configuration.json"),
        DEFINITION_LIMIT,
      );
    } catch (error) {
      if (error instanceof ProfileError) {
        throw new ProfileError("INVALID_SHARED_CONFIGURATION");
      }
      throw error;
    }
    if (text === undefined) {
      throw new ProfileError("INVALID_SHARED_CONFIGURATION");
    }
    let parsed: SharedConfiguration | undefined;
    try {
      parsed = parseSharedConfiguration(JSON.parse(text));
    } catch {
      throw new ProfileError("INVALID_SHARED_CONFIGURATION");
    }
    let soul: string | undefined;
    try {
      soul = await readBounded(join(home, "REX_SOUL.md"), SOUL_LIMIT);
    } catch (error) {
      if (error instanceof ProfileError) {
        throw new ProfileError("INVALID_SHARED_CONFIGURATION");
      }
      throw error;
    }
    if (soul !== undefined && !soul.trim()) {
      throw new ProfileError("INVALID_SHARED_CONFIGURATION");
    }
    const resourceFiles = parsed.resources
      ? await readInstructionResources(home, resourcePaths(parsed.resources))
      : undefined;
    return Object.freeze({
      ...parsed,
      ...(soul ? { soul } : {}),
      ...(resourceFiles ? { resourceFiles } : {}),
    });
  } catch (error) {
    if (error instanceof ProfileError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ProfileError("SHARED_CONFIGURATION_UNAVAILABLE");
    }
    throw new ProfileError("INVALID_SHARED_CONFIGURATION");
  }
}

export interface ProfileRunOptions {
  signal?: AbortSignal;
}

interface TurnScope {
  readonly profile: Profile;
  readonly signal?: AbortSignal;
  active: boolean;
}

export class ProfileRuntime {
  readonly #root: string;
  readonly #turns = new AsyncLocalStorage<TurnScope>();

  constructor(profilesRoot: string) {
    this.#root = validateRoot(profilesRoot);
  }

  async run<T>(
    profileId: string,
    work: () => T | Promise<T>,
    options: ProfileRunOptions = {},
  ): Promise<T> {
    if (this.#turns.getStore()) {
      throw new ProfileError("NESTED_PROFILE_SCOPE");
    }
    const { signal } = options;
    signal?.throwIfAborted();
    const profile = await lookupProfile(this.#root, profileId);
    signal?.throwIfAborted();
    const scope: TurnScope = { profile, signal, active: true };
    return this.#turns.run(scope, async () => {
      try {
        const result = await work();
        signal?.throwIfAborted();
        return result;
      } finally {
        scope.active = false;
      }
    });
  }

  current(): Profile {
    const scope = this.#turns.getStore();
    if (!scope) throw new ProfileError("NO_PROFILE_SCOPE");
    if (!scope.active) throw new ProfileError("CLOSED_PROFILE_SCOPE");
    scope.signal?.throwIfAborted();
    return scope.profile;
  }
}

export async function loadInstructionResources(
  profilesRoot: string,
  id: string,
  paths: readonly string[],
): Promise<readonly ResourceFile[]> {
  const profile = await lookupProfile(profilesRoot, id);
  return readInstructionResources(profile.home, paths);
}

async function readInstructionResources(
  home: string,
  paths: readonly string[],
  workspace = false,
): Promise<readonly ResourceFile[]> {
  try {
    const references = parseResourceConfiguration(
      workspace ? { workspaceInstructions: paths } : { instructions: paths },
    );
    const result: ResourceFile[] = [];
    for (const path of workspace
      ? (references.workspaceInstructions ?? [])
      : resourcePaths(references)) {
      const parts = path.split("/");
      let directory = home;
      for (const part of parts.slice(0, -1)) {
        directory = join(directory, part);
        if (!(await lstat(directory)).isDirectory()) throw new Error();
      }
      const text = await readBounded(join(home, path), SOUL_LIMIT);
      if (text === undefined) throw new Error();
      result.push({ path, text });
    }
    return validateResourceFiles(paths, result, workspace);
  } catch {
    throw new Error("Instruction resource is unavailable or invalid.");
  }
}

export async function loadWorkspaceInstructions(
  workspaceRoot: string,
  paths: readonly string[],
): Promise<readonly ResourceFile[]> {
  try {
    return await readInstructionResources(
      await realpath(validateRoot(workspaceRoot)),
      paths,
      true,
    );
  } catch {
    throw new Error("Instruction resource is unavailable or invalid.");
  }
}
