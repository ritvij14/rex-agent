import { createHash, randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import {
  loadSharedConfiguration,
  validateResourceFiles,
  resourcePaths,
  type ResourceFile,
  lookupProfile,
  parseProfileDefinition,
  ProfileError,
  resolveEffectiveProfile,
  type Profile,
  type ProfileDefinition,
} from "@rex/profiles";
import { narrowsTools, operatorToolNames, requireRunnable } from "./policy.ts";

export interface ProposalProvenance {
  readonly operation: "create" | "update";
  readonly origin: string;
  readonly baseDigest: string | null;
  readonly sharedDigest: string | null;
}

function digestOf(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

function bundle(profile: Profile) {
  if (profile.configuration) {
    return {
      kind: "v1" as const,
      id: profile.id,
      configuration: profile.configuration,
      ...(profile.resourceFiles
        ? { resourceFiles: profile.resourceFiles }
        : {}),
    };
  }
  if (!profile.soul) {
    throw new Error("Profile bundle is incomplete and cannot be admitted.");
  }
  return {
    kind: "v2" as const,
    id: profile.id,
    ...(profile.model ? { model: profile.model } : {}),
    ...(profile.tools ? { tools: profile.tools } : {}),
    ...(profile.limits ? { limits: profile.limits } : {}),
    soul: profile.soul,
    ...(profile.resources ? { resources: profile.resources } : {}),
    ...(profile.resourceFiles ? { resourceFiles: profile.resourceFiles } : {}),
  };
}

export function bundleDigest(profile: Profile) {
  return digestOf(JSON.stringify(bundle(profile)));
}

function definitionBundleDigest(
  definition: ProfileDefinition,
  soul?: string,
  resourceFiles?: readonly ResourceFile[],
): string {
  if (definition.configuration) {
    return bundleDigest({
      id: definition.id,
      home: "",
      configuration: definition.configuration,
      ...(resourceFiles ? { resourceFiles } : {}),
    });
  }
  return bundleDigest({
    id: definition.id,
    home: "",
    ...(soul ? { soul } : {}),
    ...(definition.model ? { model: definition.model } : {}),
    ...(definition.tools ? { tools: definition.tools } : {}),
    ...(definition.limits ? { limits: definition.limits } : {}),
    ...(definition.resources ? { resources: definition.resources } : {}),
    ...(resourceFiles ? { resourceFiles } : {}),
  });
}

async function readShared(profilesRoot: string) {
  try {
    return await loadSharedConfiguration(join(profilesRoot, "shared"));
  } catch (error) {
    if (
      error instanceof ProfileError &&
      error.code === "SHARED_CONFIGURATION_UNAVAILABLE"
    )
      return undefined;
    throw error;
  }
}

export async function sharedConfigurationDigest(
  profilesRoot: string,
): Promise<string | null> {
  const shared = await readShared(profilesRoot);
  return shared ? digestOf(JSON.stringify(shared)) : null;
}

async function root(path: string) {
  if (!isAbsolute(path.trim()))
    throw new Error("An absolute storage root is required.");
  return realpath(path.trim());
}

async function vacant(path: string) {
  try {
    await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new Error("Profile destination is unavailable.");
  }
  throw new Error("Existing profiles and drafts cannot be overwritten.");
}

function definitionText(definition: ProfileDefinition) {
  const text = JSON.stringify(definition);
  if (Buffer.byteLength(text) > 4096)
    throw new Error("Profile definition is too large.");
  return text;
}

async function readProvenance(
  proposals: string,
  id: string,
): Promise<ProposalProvenance> {
  let value: unknown;
  try {
    value = JSON.parse(
      await readFile(join(proposals, id, "provenance.json"), "utf8"),
    );
  } catch {
    throw new Error(
      "Proposal provenance is missing or unreadable; approval requires trusted provenance.",
    );
  }
  const record = value as Record<string, unknown>;
  const hex = (input: unknown) =>
    typeof input === "string" && /^[a-f0-9]{64}$/.test(input) ? input : null;
  if (
    !record ||
    typeof record !== "object" ||
    Object.keys(record).length !== 4 ||
    !(
      (record.operation === "create" || record.operation === "update") &&
      typeof record.origin === "string" &&
      record.origin &&
      record.origin.trim() === record.origin
    )
  ) {
    throw new Error(
      "Proposal provenance is incomplete or forged; approval requires trusted provenance.",
    );
  }
  if (record.operation === "create" && hex(record.baseDigest)) {
    throw new Error(
      "Create proposals cannot carry a base digest; provenance is forged.",
    );
  }
  if (record.operation === "update" && !hex(record.baseDigest)) {
    throw new Error(
      "Update proposals require the active base digest; provenance is forged.",
    );
  }
  return Object.freeze({
    operation: record.operation as "create" | "update",
    origin: record.origin as string,
    baseDigest: hex(record.baseDigest),
    sharedDigest: hex(record.sharedDigest),
  });
}

export async function createProposal(
  profilesRoot: string,
  proposalsRoot: string,
  input: unknown,
  provenance: { operation: "create" | "update"; origin: string },
  soul?: string,
  resourceFiles?: readonly ResourceFile[],
) {
  const definition = parseProfileDefinition(input);
  if (definition.version === 2) {
    if (
      typeof soul !== "string" ||
      !soul.trim() ||
      Buffer.byteLength(soul) > 16384
    )
      throw new Error("A bounded nonempty SOUL is required.");
  } else {
    if (soul !== undefined)
      throw new Error("Legacy definitions cannot contain SOUL.");
    if (definition.configuration?.model.provider !== "cli-proxy")
      throw new Error(
        "Profile configuration is not supported by this adapter.",
      );
  }
  const paths = resourcePaths(
    definition.configuration?.resources ?? definition.resources,
  );
  const files = validateResourceFiles(paths, resourceFiles ?? []);
  const boundFiles =
    (definition.configuration?.resources ?? definition.resources)
      ? files
      : undefined;
  const profiles = await root(profilesRoot);
  const proposals = await root(proposalsRoot);
  const shared = await readShared(profilesRoot);
  requireRunnable(
    resolveEffectiveProfile(
      {
        ...definition,
        home: "",
        ...(soul ? { soul } : {}),
        ...(boundFiles ? { resourceFiles: boundFiles } : {}),
      },
      shared,
    ).configuration,
    operatorToolNames(shared),
  );

  if (
    !provenance ||
    typeof provenance.origin !== "string" ||
    !provenance.origin ||
    provenance.origin.trim() !== provenance.origin ||
    (provenance.operation !== "create" && provenance.operation !== "update")
  ) {
    throw new Error(
      "Trusted proposal provenance with a profile origin is required.",
    );
  }
  if (provenance.operation === "create") {
    await vacant(join(profiles, definition.id));
    await vacant(join(proposals, definition.id));
    const provenanceBound: ProposalProvenance = Object.freeze({
      operation: "create",
      origin: provenance.origin,
      baseDigest: null,
      sharedDigest: await sharedConfigurationDigest(profilesRoot),
    });
    await writeProposalFiles(
      join(proposals, definition.id),
      definition,
      provenanceBound,
      soul,
      boundFiles,
    );
    return {
      id: definition.id,
      digest: definitionBundleDigest(definition, soul, boundFiles),
      operation: "create" as const,
    };
  }
  if (provenance.origin !== definition.id) {
    throw new Error(
      "An existing profile may be updated only by a draft from the same profile.",
    );
  }
  const base = await lookupProfile(profiles, definition.id);
  const provenanceBound: ProposalProvenance = Object.freeze({
    operation: "update",
    origin: provenance.origin,
    baseDigest: bundleDigest(base),
    sharedDigest: await sharedConfigurationDigest(profilesRoot),
  });
  await vacant(join(proposals, definition.id));
  await writeProposalFiles(
    join(proposals, definition.id),
    definition,
    provenanceBound,
    soul,
    boundFiles,
  );
  return {
    id: definition.id,
    digest: definitionBundleDigest(definition, soul, boundFiles),
    operation: "update" as const,
    baseDigest: provenanceBound.baseDigest,
  };
}

async function writeProposalFiles(
  home: string,
  definition: ProfileDefinition,
  provenance: ProposalProvenance,
  soul?: string,
  resourceFiles?: readonly ResourceFile[],
) {
  const text = definitionText(definition);
  try {
    await mkdir(home, { mode: 0o755 });
    if (soul !== undefined) {
      await writeFile(join(home, "SOUL.md"), soul, { flag: "wx", mode: 0o644 });
    }
    await writeFile(join(home, "profile.json"), text, {
      flag: "wx",
      mode: 0o644,
    });
    await writeResourceFiles(home, resourceFiles ?? []);
    await writeFile(join(home, "provenance.json"), JSON.stringify(provenance), {
      flag: "wx",
      mode: 0o644,
    });
  } catch (error) {
    await rm(home, { recursive: true, force: true });
    throw error;
  }
}

export async function reviewProposal(proposalsRoot: string, id: string) {
  const proposals = await root(proposalsRoot);
  const profile: Profile = await lookupProfile(proposals, id);
  const provenance = await readProvenance(proposals, profile.id);
  if (
    provenance.origin !== "profile-builder" &&
    provenance.origin !== profile.id
  ) {
    throw new Error(
      "Proposal provenance origin does not match a trusted writer.",
    );
  }
  if (profile.configuration) {
    if (profile.configuration.model.provider !== "cli-proxy")
      throw new Error(
        "Profile configuration is not supported by this adapter.",
      );
  } else if (!profile.soul) {
    throw new Error("Profile configuration is not supported by this adapter.");
  }
  return {
    definition: profile,
    digest: bundleDigest(profile),
    provenance,
  };
}

export async function approveProposal(
  profilesRoot: string,
  proposalsRoot: string,
  id: string,
  digest: string,
) {
  const profiles = await root(profilesRoot);
  const proposals = await root(proposalsRoot);
  const reviewed = await reviewProposal(proposalsRoot, id);
  if (!/^[a-f0-9]{64}$/.test(digest) || reviewed.digest !== digest) {
    throw new Error("Proposal changed or approval digest does not match.");
  }
  const provenance = reviewed.provenance;
  if (provenance.operation === "update") {
    const base = bundleDigest(await lookupProfile(profiles, id));
    if (provenance.baseDigest !== base) {
      throw new Error(
        "Proposal is stale or replayed: the active profile changed since the draft was made.",
      );
    }
    const shared = await sharedConfigurationDigest(profilesRoot);
    if (provenance.sharedDigest !== shared) {
      throw new Error(
        "The shared configuration changed since the update draft was made.",
      );
    }
    const current = await lookupProfile(profiles, id);
    const sharedConfiguration = await readShared(profilesRoot);
    const currentEffective = resolveEffectiveProfile(
      current,
      sharedConfiguration,
    );
    const proposedEffective = resolveEffectiveProfile(
      reviewed.definition,
      sharedConfiguration,
    );
    if (
      proposedEffective.mcpServers?.some(
        (entry) =>
          !currentEffective.mcpServers?.some(
            (current) => current.id === entry.id,
          ),
      )
    )
      throw new Error("A profile revision cannot add MCP servers.");
    const currentTools = currentEffective.configuration?.tools;
    const proposedTools = proposedEffective.configuration?.tools;
    if (
      !currentTools ||
      !proposedTools ||
      !narrowsTools(
        currentTools,
        proposedTools,
        operatorToolNames(sharedConfiguration),
      )
    ) {
      throw new Error("A profile revision cannot add tools.");
    }
  } else {
    await vacant(join(profiles, id));
  }
  const sharedForAdmission = await readShared(profilesRoot);
  requireRunnable(
    resolveEffectiveProfile(reviewed.definition, sharedForAdmission)
      .configuration,
    operatorToolNames(sharedForAdmission),
  );
  await activateBundle(profiles, id, reviewed.definition);
  await rm(join(proposals, id), { recursive: true, force: true });
  return { id, digest, operation: provenance.operation };
}

async function activateBundle(profiles: string, id: string, profile: Profile) {
  const staging = join(
    profiles,
    `.stage-${id}-${randomBytes(6).toString("hex")}`,
  );
  await mkdir(staging, { mode: 0o755 });
  try {
    await writeResourceFiles(staging, profile.resourceFiles ?? []);
    if (profile.soul) {
      await writeFile(join(staging, "SOUL.md"), profile.soul, {
        flag: "wx",
        mode: 0o644,
      });
    }
    await writeFile(
      join(staging, "profile.json"),
      profile.configuration
        ? definitionText(
            parseProfileDefinition({
              id: profile.id,
              configuration: profile.configuration,
            }),
          )
        : definitionText(
            parseProfileDefinition({
              version: 2,
              id: profile.id,
              ...(profile.model ? { model: profile.model } : {}),
              ...(profile.tools ? { tools: profile.tools } : {}),
              ...(profile.limits ? { limits: profile.limits } : {}),
              ...(profile.resources ? { resources: profile.resources } : {}),
            }),
          ),
      { flag: "wx", mode: 0o644 },
    );
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  const home = join(profiles, id);
  let retired: string | undefined;
  try {
    await lstat(home);
    retired = join(profiles, `retired-${id}-${randomBytes(6).toString("hex")}`);
    await rename(home, retired);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
  }
  try {
    await rename(staging, home);
  } catch (error) {
    if (retired) await rename(retired, home).catch(() => undefined);
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  if (retired) {
    await rm(retired, { recursive: true, force: true });
  }
}

export async function writeResourceFiles(
  home: string,
  files: readonly ResourceFile[],
) {
  const validated = validateResourceFiles(
    files.map((file) => file.path),
    files,
  );
  for (const file of validated) {
    await mkdir(dirname(join(home, file.path)), { recursive: true });
    await writeFile(join(home, file.path), file.text, {
      flag: "wx",
      mode: 0o644,
    });
  }
}
