import { createHash } from "node:crypto";
import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  lookupProfile,
  parseProfileDefinition,
  type ProfileDefinition,
} from "@rex/profiles";
import { requireRunnable } from "./policy.ts";

function serialize(definition: ProfileDefinition) {
  const text = JSON.stringify(definition);
  if (Buffer.byteLength(text) > 4096)
    throw new Error("Profile definition is too large.");
  return { text, digest: createHash("sha256").update(text).digest("hex") };
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

export async function createProposal(
  profilesRoot: string,
  proposalsRoot: string,
  input: unknown,
) {
  const definition = parseProfileDefinition(input);
  requireRunnable(definition);
  const data = serialize(definition);
  const profiles = await root(profilesRoot);
  const proposals = await root(proposalsRoot);
  await vacant(join(profiles, definition.id));
  const home = join(proposals, definition.id);
  await vacant(home);
  await mkdir(home, { mode: 0o755 });
  await writeFile(join(home, "profile.json"), data.text, {
    flag: "wx",
    mode: 0o644,
  });
  return { id: definition.id, digest: data.digest };
}

export async function reviewProposal(proposalsRoot: string, id: string) {
  const profile = await lookupProfile(proposalsRoot, id);
  const definition = parseProfileDefinition({
    id: profile.id,
    configuration: profile.configuration,
  });
  requireRunnable(definition);
  return { definition, digest: serialize(definition).digest };
}

export async function approveProposal(
  profilesRoot: string,
  proposalsRoot: string,
  id: string,
  digest: string,
) {
  const reviewed = await reviewProposal(proposalsRoot, id);
  if (!/^[a-f0-9]{64}$/.test(digest) || reviewed.digest !== digest) {
    throw new Error("Proposal changed or approval digest does not match.");
  }
  const profiles = await root(profilesRoot);
  const home = join(profiles, reviewed.definition.id);
  await vacant(home);
  await mkdir(home, { mode: 0o755 });
  await writeFile(
    join(home, "profile.json"),
    serialize(reviewed.definition).text,
    { flag: "wx", mode: 0o644 },
  );
  return { id: reviewed.definition.id, digest };
}
