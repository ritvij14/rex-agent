import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readdir,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { provisionProfile } from "../lab/terminal/provision.ts";
import { lookupProfile, loadSharedConfiguration } from "@rex/profiles";

test("provisioning copies only selected validated config and shared policy", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "rex-provision-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const target = join(root, "target");
  for (const id of ["coding", "research", "shared"])
    await mkdir(join(source, id), { recursive: true });
  await mkdir(target);
  await writeFile(join(source, "coding", "SOUL.md"), "Coding persona.");
  await writeFile(
    join(source, "research", "SOUL.md"),
    "Private research persona.",
  );
  await writeFile(
    join(source, "coding", "not-config.txt"),
    "must not be copied",
  );
  await writeFile(
    join(source, "shared", "configuration.json"),
    JSON.stringify({
      version: 2,
      model: { provider: "cli-proxy", id: "synthetic-model" },
    }),
  );
  await writeFile(
    join(source, "shared", "REX_SOUL.md"),
    "Common instructions.",
  );
  await provisionProfile(source, target, "coding");
  assert.deepEqual((await readdir(target)).sort(), ["coding", "shared"]);
  assert.deepEqual(await readdir(join(target, "coding")), ["SOUL.md"]);
  assert.equal((await lookupProfile(target, "coding")).soul, "Coding persona.");
  assert.equal(
    (await loadSharedConfiguration(join(target, "shared"))).soul,
    "Common instructions.",
  );
  await writeFile(
    join(source, "coding", "profile.json"),
    JSON.stringify({ version: 2, id: "coding", limits: { maxRequests: 2 } }),
  );
  await provisionProfile(source, target, "coding");
  assert.deepEqual((await lookupProfile(target, "coding")).limits, {
    maxRequests: 2,
  });
  await mkdir(join(source, "coding", "resources"));
  await writeFile(
    join(source, "coding", "resources", "own.md"),
    "Own resource.",
  );
  await writeFile(
    join(source, "coding", "resources", "ignored.md"),
    "Not selected.",
  );
  await writeFile(
    join(source, "coding", "profile.json"),
    JSON.stringify({
      version: 2,
      id: "coding",
      resources: { references: ["resources/own.md"] },
    }),
  );
  await provisionProfile(source, target, "coding");
  assert.equal(
    await readFile(join(target, "coding", "resources", "own.md"), "utf8"),
    "Own resource.",
  );
  await assert.rejects(
    readFile(join(target, "coding", "resources", "ignored.md")),
  );
  await assert.rejects(readFile(join(target, "research", "SOUL.md")));
  await assert.rejects(provisionProfile(source, target, "../research"));
  await rm(join(source, "coding", "SOUL.md"));
  await symlink(
    join(source, "research", "SOUL.md"),
    join(source, "coding", "SOUL.md"),
  );
  await assert.rejects(provisionProfile(source, target, "coding"));
});
