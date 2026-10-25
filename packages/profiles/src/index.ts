import { AsyncLocalStorage } from "node:async_hooks";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import {
  parseProfileDefinition,
  validateProfileId,
  type ProfileConfiguration,
} from "./configuration.ts";
import { ProfileError } from "./errors.ts";
export { ProfileError, type ProfileErrorCode } from "./errors.ts";
export {
  parseProfileDefinition,
  parseProfileRequest,
  validateProfileId,
  isToolAllowed,
  type ProfileConfiguration,
  type ProfileDefinition,
  type ToolPolicy,
} from "./configuration.ts";

export interface Profile {
  readonly id: string;
  readonly home: string;
  readonly configuration?: ProfileConfiguration;
}

function validateRoot(root: string): string {
  if (typeof root !== "string" || !isAbsolute(root.trim())) {
    throw new ProfileError("INVALID_PROFILES_ROOT");
  }
  return root.trim();
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
    const definition = await open(
      join(home, "profile.json"),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const stat = await definition.stat();
      if (!stat.isFile() || stat.size > 4096) {
        throw new ProfileError("INVALID_PROFILE_DEFINITION");
      }
      const buffer = Buffer.alloc(4097);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await definition.read(
          buffer,
          length,
          buffer.length - length,
          length,
        );
        if (bytesRead === 0) break;
        length += bytesRead;
      }
      let value: unknown;
      try {
        value = JSON.parse(buffer.subarray(0, length).toString("utf8"));
      } catch {
        throw new ProfileError("INVALID_PROFILE_DEFINITION");
      }
      if (length > 4096) throw new ProfileError("INVALID_PROFILE_DEFINITION");
      const parsed = parseProfileDefinition(value);
      if (parsed.id !== id)
        throw new ProfileError("INVALID_PROFILE_DEFINITION");
      return Object.freeze({ ...parsed, home });
    } finally {
      await definition.close();
    }
  } catch (error) {
    if (error instanceof ProfileError) throw error;
    throw new ProfileError("PROFILE_UNAVAILABLE");
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
