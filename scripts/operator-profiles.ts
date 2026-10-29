// Operator-side inspection and volume-level import/export inside the helper
// container. No Pi imports, no inference, no network. Runs as root against the
// mounted definitions volume only.
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listProfiles,
  loadSharedConfiguration,
  lookupProfile,
  ProfileError,
  resolveEffectiveProfile,
  validateProfileId,
} from "@rex/profiles";

const ROOT = "/profiles";

async function importArchive(input: Buffer) {
  const work = await mkdtemp(join(tmpdir(), "rex-import-"));
  try {
    const archive = join(work, "incoming.tar.gz");
    await writeFile(archive, input);
    const extracted = join(work, "extracted");
    await mkdir(extracted, { recursive: true, mode: 0o700 });
    const tar = spawnSync("tar", ["-xzf", archive, "-C", extracted], {
      encoding: "buffer",
      timeout: 30_000,
    });
    if (tar.error || tar.status !== 0)
      throw new Error(
        `IMPORT_UNREADABLE tar=${tar.status} ${(tar.stderr || Buffer.alloc(0)).toString().slice(0, 160)}`,
      );
    const stagedRoot = join(extracted, "profiles");
    if (!statSync(stagedRoot, { throwIfNoEntry: false })?.isDirectory())
      throw new Error("IMPORT_UNREADABLE");
    const ids = await listProfiles(stagedRoot);
    const existing = readdirSync(ROOT);
    const collisions = ids.filter((id) => existing.includes(id));
    if (collisions.length || existing.includes("shared")) {
      throw new Error(`IMPORT_DESTINATION_UNAVAILABLE ${collisions.join(",")}`);
    }
    const shared = existsSync(join(stagedRoot, "shared"))
      ? await loadSharedConfiguration(join(stagedRoot, "shared"))
      : undefined;
    for (const id of ids) {
      const profile = await lookupProfile(stagedRoot, id);
      if (hasPersona(profile)) {
        resolveEffectiveProfile(profile, shared);
      }
    }
    // Validation passed; move each profile directory into the managed root.
    for (const id of ids) {
      cpSync(join(stagedRoot, id), join(ROOT, id), { recursive: true });
    }
    if (existsSync(join(stagedRoot, "shared"))) {
      rmSync(join(ROOT, "shared"), { recursive: true, force: true });
      cpSync(join(stagedRoot, "shared"), join(ROOT, "shared"), {
        recursive: true,
      });
    }
    console.log(JSON.stringify({ imported: ids.length, ids }));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function showProfile(id: string) {
  validateProfileId(id);
  const profile = await lookupProfile(ROOT, id);
  const files = profile.resourceFiles?.map((file) => ({
    path: file.path,
    text: file.text,
  }));
  process.stdout.write(
    JSON.stringify(
      {
        id: profile.id,
        ...(profile.configuration
          ? { configuration: profile.configuration }
          : {}),
        ...(profile.model ? { model: profile.model } : {}),
        ...(profile.tools ? { tools: profile.tools } : {}),
        ...(profile.limits ? { limits: profile.limits } : {}),
        ...(profile.resources ? { resources: profile.resources } : {}),
        ...(files ? { resourceFiles: files } : {}),
        ...(profile.soul ? { soul: profile.soul } : {}),
      },
      null,
      2,
    ),
  );
}

async function effectiveProfile(id: string) {
  validateProfileId(id);
  const profile = await lookupProfile(ROOT, id);
  const shared = existsSync(join(ROOT, "shared"))
    ? await loadSharedConfiguration(join(ROOT, "shared"))
    : undefined;
  const effective = resolveEffectiveProfile(profile, shared);
  process.stdout.write(
    JSON.stringify(
      { ...effective, resourceFiles: profile.resourceFiles ?? [] },
      null,
      2,
    ),
  );
}

async function validateProfile(id: string) {
  validateProfileId(id);
  const profile = await lookupProfile(ROOT, id);
  if (existsSync(join(ROOT, "shared"))) {
    const shared = await loadSharedConfiguration(join(ROOT, "shared"));
    if (hasPersona(profile)) {
      resolveEffectiveProfile(profile, shared);
    }
  }
  console.log(`Valid profile: ${id}`);
}

function hasPersona(profile: Awaited<ReturnType<typeof lookupProfile>>) {
  return Boolean(profile.configuration?.instructions ?? profile.soul);
}

async function main() {
  if (process.getuid?.() !== 0) throw new Error("Operator root required.");
  const [action, id, ...rest] = process.argv.slice(2);
  if (rest.length) throw new Error("Unexpected arguments.");
  if (action === "list") {
    if (id) throw new Error("Unexpected arguments.");
    console.log(JSON.stringify(await listProfiles(ROOT)));
    return;
  }
  if (action === "import") {
    if (id) throw new Error("Unexpected arguments.");
    const input = readFileSync(0);
    if (input.length > 64 * 1024 * 1024) throw new Error("IMPORT_UNREADABLE");
    await importArchive(input);
    return;
  }
  if (action === "export") {
    if (id) throw new Error("Unexpected arguments.");
    const list = await listProfiles(ROOT);
    // The shared configuration is part of the operator's export bundle.
    // The archive keeps the profiles root as a single entry so imports can
    // stage and validate before publishing anything.
    const tar = spawnSync("tar", ["-czf", "-", "-C", "/", "profiles"], {
      encoding: "buffer",
      timeout: 30_000,
      maxBuffer: 128 * 1024 * 1024,
    });
    if (tar.error || tar.status !== 0) throw new Error("EXPORT_UNREADABLE");
    process.stdout.write(tar.stdout);
    return;
  }
  if (action === "show" || action === "effective" || action === "validate") {
    if (!id) throw new Error("Profile id required.");
    if (action === "show") return await showProfile(id);
    if (action === "effective") return await effectiveProfile(id);
    return await validateProfile(id);
  }
  throw new Error("Unknown operator action.");
}

main().catch((error) => {
  const message =
    error instanceof Error && error.message.startsWith("IMPORT_")
      ? error.message
      : error instanceof ProfileError
        ? error.code
        : "Operator profiles command rejected; require an operator and valid definitions.";
  console.error(message);
  process.exitCode = 1;
});
