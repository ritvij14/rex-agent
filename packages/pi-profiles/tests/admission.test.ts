import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { lookupProfile } from "@rex/profiles";
import {
  approveProposal,
  createProposal,
  reviewProposal,
  sharedConfigurationDigest,
} from "@rex/pi-profiles";

const CREATE = { operation: "create", origin: "profile-builder" } as const;
const UPDATE = (origin: string) => ({ operation: "update", origin }) as const;

function v1Draft(id: string, instructions = "A synthetic helper.") {
  return {
    id,
    configuration: {
      instructions,
      model: { provider: "cli-proxy", id: "glm-5.3-flash-cloud" },
      tools: { whitelist: ["read"], blacklist: ["bash"] },
    },
  };
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "rex-profile-admission-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const profilesRoot = join(root, "profiles");
  const proposalsRoot = join(root, "proposals");
  await mkdir(join(profilesRoot, "helper"), { recursive: true });
  await writeFile(
    join(profilesRoot, "helper", "profile.json"),
    JSON.stringify(v1Draft("helper", "Original persona.")),
  );
  await mkdir(proposalsRoot);
  return { root, profilesRoot, proposalsRoot };
}

async function seedShared(profilesRoot: string) {
  const shared = join(profilesRoot, "shared");
  await mkdir(shared, { recursive: true });
  await writeFile(
    join(shared, "configuration.json"),
    JSON.stringify({
      version: 2,
      model: { provider: "cli-proxy", id: "shared-model" },
      tools: { whitelist: ["read", "ls"], blacklist: [] },
    }),
  );
}

test("create approval is digest-bound and records trusted provenance", async (t) => {
  const f = await fixture(t);
  const proposal = await createProposal(
    f.profilesRoot,
    f.proposalsRoot,
    v1Draft("helper-2"),
    CREATE,
  );
  const reviewed = await reviewProposal(f.proposalsRoot, "helper-2");
  assert.equal(reviewed.digest, proposal.digest);
  assert.deepEqual(reviewed.provenance, {
    operation: "create",
    origin: "profile-builder",
    baseDigest: null,
    sharedDigest: await sharedConfigurationDigest(f.profilesRoot),
  });
  await approveProposal(
    f.profilesRoot,
    f.proposalsRoot,
    "helper-2",
    proposal.digest,
  );
  assert.equal(
    (await lookupProfile(f.profilesRoot, "helper-2")).configuration
      ?.instructions,
    "A synthetic helper.",
  );
  await assert.rejects(
    approveProposal(
      f.profilesRoot,
      f.proposalsRoot,
      "helper-2",
      proposal.digest,
    ),
    (error) => error instanceof Error,
  );
});

test("approval rejects drafts whose trusted provenance is missing or broken", async (t) => {
  const f = await fixture(t);
  const proposal = await createProposal(
    f.profilesRoot,
    f.proposalsRoot,
    v1Draft("helper-2"),
    CREATE,
  );
  await rm(join(f.proposalsRoot, "helper-2", "provenance.json"));
  await assert.rejects(
    approveProposal(
      f.profilesRoot,
      f.proposalsRoot,
      "helper-2",
      proposal.digest,
    ),
    /provenance/,
  );
  await createProposal(
    f.profilesRoot,
    f.proposalsRoot,
    v1Draft("helper-3"),
    CREATE,
  );
  await writeFile(
    join(f.proposalsRoot, "helper-3", "provenance.json"),
    JSON.stringify({ operation: "create", origin: "other", extra: true }),
  );
  await assert.rejects(
    reviewProposal(f.proposalsRoot, "helper-3"),
    /provenance/,
  );
  await assert.rejects(
    createProposal(f.profilesRoot, f.proposalsRoot, v1Draft("helper-4"), {
      operation: "promote" as "create",
      origin: "profile-builder",
    }),
    /provenance/,
  );
});

test("update proposals replace the active revision only for the origin profile", async (t) => {
  const f = await fixture(t);
  const base = await reviewProposal(f.proposalsRoot, "nobody").catch(
    () => null,
  );
  void base;
  await assert.rejects(
    createProposal(
      f.profilesRoot,
      f.proposalsRoot,
      v1Draft("helper", "Replaced persona."),
      UPDATE("profile-builder"),
    ),
    /same profile/,
  );
  const proposal = await createProposal(
    f.profilesRoot,
    f.proposalsRoot,
    v1Draft("helper", "Replaced persona."),
    UPDATE("helper"),
  );
  const activeBefore = await lookupProfile(f.profilesRoot, "helper");
  assert.equal(activeBefore.configuration?.instructions, "Original persona.");
  await approveProposal(
    f.profilesRoot,
    f.proposalsRoot,
    "helper",
    proposal.digest,
  );
  assert.equal(
    (await lookupProfile(f.profilesRoot, "helper")).configuration?.instructions,
    "Replaced persona.",
  );
  const remaining = await readdir(f.proposalsRoot);
  assert.ok(!remaining.includes("helper"));
});

test("replayed and stale update proposals fail and preserve the prior revision", async (t) => {
  const f = await fixture(t);
  const first = await createProposal(
    f.profilesRoot,
    f.proposalsRoot,
    v1Draft("helper", "Second persona."),
    UPDATE("helper"),
  );
  await approveProposal(
    f.profilesRoot,
    f.proposalsRoot,
    "helper",
    first.digest,
  );
  await assert.rejects(
    approveProposal(f.profilesRoot, f.proposalsRoot, "helper", first.digest),
    (error) => error instanceof Error,
  );
  assert.equal(
    (await lookupProfile(f.profilesRoot, "helper")).configuration?.instructions,
    "Second persona.",
  );

  const stale = await createProposal(
    f.profilesRoot,
    f.proposalsRoot,
    v1Draft("helper", "Third persona."),
    UPDATE("helper"),
  );
  await createProposal(
    f.profilesRoot,
    f.proposalsRoot,
    v1Draft("other-new"),
    CREATE,
  );
  await writeFile(
    join(f.profilesRoot, "helper", "profile.json"),
    JSON.stringify(v1Draft("helper", "Externally repaired persona.")),
  );
  await assert.rejects(
    approveProposal(f.profilesRoot, f.proposalsRoot, "helper", stale.digest),
    /changed/,
  );
  assert.equal(
    (await lookupProfile(f.profilesRoot, "helper")).configuration?.instructions,
    "Externally repaired persona.",
  );
});

test("update approval rejects a draft that adds tools", async (t) => {
  const f = await fixture(t);
  const proposal = await createProposal(
    f.profilesRoot,
    f.proposalsRoot,
    {
      ...v1Draft("helper", "Expanded persona."),
      configuration: {
        ...v1Draft("helper").configuration,
        instructions: "Expanded persona.",
        tools: { whitelist: ["read", "bash"], blacklist: [] },
      },
    },
    UPDATE("helper"),
  );
  await assert.rejects(
    approveProposal(f.profilesRoot, f.proposalsRoot, "helper", proposal.digest),
    /add tools/,
  );
  assert.equal(
    (await lookupProfile(f.profilesRoot, "helper")).configuration?.tools
      .whitelist.length,
    1,
  );
});

test("update proposals fail when the shared configuration changed", async (t) => {
  const f = await fixture(t);
  await seedShared(f.profilesRoot);
  const proposal = await createProposal(
    f.profilesRoot,
    f.proposalsRoot,
    v1Draft("helper", "Shared-bound persona."),
    UPDATE("helper"),
  );
  await writeFile(
    join(f.profilesRoot, "shared", "configuration.json"),
    JSON.stringify({
      version: 2,
      model: { provider: "cli-proxy", id: "changed-model" },
      tools: { whitelist: ["read"], blacklist: [] },
    }),
  );
  await assert.rejects(
    approveProposal(f.profilesRoot, f.proposalsRoot, "helper", proposal.digest),
    /shared/,
  );
  assert.equal(
    (await lookupProfile(f.profilesRoot, "helper")).configuration?.instructions,
    "Original persona.",
  );
});

test("persona bundles are admitted whole, digest including SOUL.md", async (t) => {
  const f = await fixture(t);
  await seedShared(f.profilesRoot);
  const home = join(f.proposalsRoot, "soul-helper");
  await mkdir(home);
  await writeFile(
    join(home, "profile.json"),
    JSON.stringify({
      version: 2,
      id: "soul-helper",
      tools: { whitelist: ["read"], blacklist: [] },
    }),
  );
  await writeFile(join(home, "SOUL.md"), "First persona.");
  await writeFile(
    join(home, "provenance.json"),
    JSON.stringify({
      operation: "create",
      origin: "profile-builder",
      baseDigest: null,
      sharedDigest: null,
    }),
  );
  const reviewed = await reviewProposal(f.proposalsRoot, "soul-helper");
  await writeFile(join(home, "SOUL.md"), "Second persona.");
  const changed = await reviewProposal(f.proposalsRoot, "soul-helper");
  assert.notEqual(reviewed.digest, changed.digest);
  await assert.rejects(
    approveProposal(
      f.profilesRoot,
      f.proposalsRoot,
      "soul-helper",
      reviewed.digest,
    ),
    /digest/,
  );
  await writeFile(join(home, "SOUL.md"), "First persona.");
  await approveProposal(
    f.profilesRoot,
    f.proposalsRoot,
    "soul-helper",
    reviewed.digest,
  );
  const active = await lookupProfile(f.profilesRoot, "soul-helper");
  assert.equal(active.soul, "First persona.");
  assert.equal(
    await readFile(join(f.profilesRoot, "soul-helper", "SOUL.md"), "utf8"),
    "First persona.",
  );
});

test("provenance digests are stored verbatim and review reflects them", async (t) => {
  const f = await fixture(t);
  const proposal = await createProposal(
    f.profilesRoot,
    f.proposalsRoot,
    v1Draft("helper-2"),
    CREATE,
  );
  const stored = JSON.parse(
    await readFile(
      join(f.proposalsRoot, "helper-2", "provenance.json"),
      "utf8",
    ),
  );
  assert.equal(stored.origin, "profile-builder");
  assert.equal(stored.baseDigest, null);
  assert.ok(stored.sharedDigest === null);
  void proposal;
});
