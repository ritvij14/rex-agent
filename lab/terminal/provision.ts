import { chown, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import {
  loadSharedConfiguration,
  lookupProfile,
  ProfileError,
  validateProfileId,
} from "@rex/profiles";
import { join } from "node:path";

export async function provisionProfile(
  source: string,
  target: string,
  id: string,
) {
  validateProfileId(id);
  const profile = await lookupProfile(source, id);
  let shared;
  try {
    shared = await loadSharedConfiguration(join(source, "shared"));
  } catch (error) {
    if (
      !(error instanceof ProfileError) ||
      error.code !== "SHARED_CONFIGURATION_UNAVAILABLE"
    )
      throw error;
  }
  for (const entry of await readdir(target)) {
    await rm(join(target, entry), { recursive: true });
  }
  const home = join(target, id);
  await mkdir(home);
  if (profile.soul) {
    await writeFile(join(home, "SOUL.md"), profile.soul);
    if (profile.model || profile.tools) {
      await writeFile(
        join(home, "profile.json"),
        JSON.stringify({
          version: 2,
          id,
          ...(profile.model ? { model: profile.model } : {}),
          ...(profile.tools ? { tools: profile.tools } : {}),
        }),
      );
    }
  } else {
    await writeFile(
      join(home, "profile.json"),
      JSON.stringify({
        id,
        ...(profile.configuration
          ? { configuration: profile.configuration }
          : {}),
      }),
    );
  }
  if (shared) {
    const sharedHome = join(target, "shared");
    await mkdir(sharedHome);
    const { soul, ...configuration } = shared;
    await writeFile(
      join(sharedHome, "configuration.json"),
      JSON.stringify(configuration),
    );
    if (soul) await writeFile(join(sharedHome, "REX_SOUL.md"), soul);
  }
}

if (process.argv[1]?.endsWith("/provision.ts")) {
  (async () => {
    if (process.getuid?.() !== 0) throw new Error();
    await provisionProfile("/master", "/snapshot", process.argv[2] ?? "");
    for (const path of ["/workspace", "/state", "/proposals"]) {
      await chown(path, 1000, 1000);
    }
  })().catch(() => {
    console.error(
      "Profile provisioning rejected; private diagnostics omitted.",
    );
    process.exitCode = 1;
  });
}
