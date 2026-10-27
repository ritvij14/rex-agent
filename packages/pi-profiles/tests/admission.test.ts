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

test("SOUL limits participate in digest and survive activation", async (t) => {
  const f = await fixture(t);
  await seedShared(f.profilesRoot);
  const proposal = await createProposal(
    f.profilesRoot,
    f.proposalsRoot,
    { version: 2, id: "limited", limits: { maxRequests: 2 } },
    CREATE,
    "Limited persona.",
  );
  const manifest = join(f.proposalsRoot, "limited", "profile.json");
  await writeFile(
    manifest,
    JSON.stringify({ version: 2, id: "limited", limits: { maxRequests: 3 } }),
  );
  await assert.rejects(
    approveProposal(
      f.profilesRoot,
      f.proposalsRoot,
      "limited",
      proposal.digest,
    ),
    /digest/,
  );
  const changed = await reviewProposal(f.proposalsRoot, "limited");
  await approveProposal(
    f.profilesRoot,
    f.proposalsRoot,
    "limited",
    changed.digest,
  );
  assert.deepEqual((await lookupProfile(f.profilesRoot, "limited")).limits, {
    maxRequests: 3,
  });
});

test("shared instruction content changes invalidate an update approval", async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.profilesRoot, "shared", "resources"), { recursive: true });
  const config = {
    version: 2,
    resources: { instructions: ["resources/common.md"] },
  };
  await writeFile(
    join(f.profilesRoot, "shared", "configuration.json"),
    JSON.stringify(config),
  );
  const file = join(f.profilesRoot, "shared", "resources", "common.md");
  await writeFile(file, "First shared instruction.");
  const draft = await createProposal(
    f.profilesRoot,
    f.proposalsRoot,
    v1Draft("helper", "Revised persona."),
    UPDATE("helper"),
  );
  await writeFile(file, "Changed shared instruction.");
  await assert.rejects(
    approveProposal(f.profilesRoot, f.proposalsRoot, "helper", draft.digest),
    /shared configuration changed/,
  );
  assert.equal(
    (await lookupProfile(f.profilesRoot, "helper")).configuration?.instructions,
    "Original persona.",
  );
});

test("update approval cannot add an operator catalog custom tool", async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.profilesRoot, "shared"));
  await writeFile(
    join(f.profilesRoot, "shared", "configuration.json"),
    JSON.stringify({
      version: 2,
      extensionCatalog: [
        { id: "fixture", sha256: "0".repeat(64), tools: ["fixture_probe"] },
      ],
    }),
  );
  const input = v1Draft("helper", "Expanded custom tools.");
  input.configuration.tools.whitelist.push("fixture_probe");
  const proposal = await createProposal(
    f.profilesRoot,
    f.proposalsRoot,
    input,
    UPDATE("helper"),
  );
  await assert.rejects(
    approveProposal(f.profilesRoot, f.proposalsRoot, "helper", proposal.digest),
    /add tools/,
  );
  assert.deepEqual(
    (await lookupProfile(f.profilesRoot, "helper")).configuration?.tools
      .whitelist,
    ["read"],
  );
});

test("lazy support references bind approval and survive activation", async (t) => {
  const f = await fixture(t);
  await seedShared(f.profilesRoot);
  const proposal = await createProposal(
    f.profilesRoot,
    f.proposalsRoot,
    {
      version: 2,
      id: "support-helper",
      resources: { references: ["resources/support.md"] },
    },
    CREATE,
    "Synthetic persona.",
    [{ path: "resources/support.md", text: "Original support." }],
  );
  await writeFile(
    join(f.proposalsRoot, "support-helper", "resources", "support.md"),
    "Changed support.",
  );
  const reviewed = await reviewProposal(f.proposalsRoot, "support-helper");
  assert.notEqual(reviewed.digest, proposal.digest);
  await assert.rejects(
    approveProposal(
      f.profilesRoot,
      f.proposalsRoot,
      "support-helper",
      proposal.digest,
    ),
    /digest/i,
  );
  await assert.rejects(lookupProfile(f.profilesRoot, "support-helper"));
  await approveProposal(
    f.profilesRoot,
    f.proposalsRoot,
    "support-helper",
    reviewed.digest,
  );
  assert.deepEqual(
    (await lookupProfile(f.profilesRoot, "support-helper")).resourceFiles,
    [{ path: "resources/support.md", text: "Changed support." }],
  );
});

test("an update cannot add an MCP server through an existing wildcard grant", async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.profilesRoot, "shared"));
  await writeFile(
    join(f.profilesRoot, "shared", "configuration.json"),
    JSON.stringify({
      version: 2,
      localMcpCatalog: [
        { id: "fixture", sha256: "0".repeat(64), tools: ["inspect"] },
      ],
    }),
  );
  const current = v1Draft("helper");
  current.configuration.tools.whitelist = ["*"];
  await writeFile(
    join(f.profilesRoot, "helper", "profile.json"),
    JSON.stringify(current),
  );
  const proposed = {
    ...current,
    configuration: {
      ...current.configuration,
      resources: { mcp: ["fixture"] },
    },
  };
  const draft = await createProposal(
    f.profilesRoot,
    f.proposalsRoot,
    proposed,
    UPDATE("helper"),
  );
  await assert.rejects(
    approveProposal(f.profilesRoot, f.proposalsRoot, "helper", draft.digest),
    /MCP servers/,
  );
  assert.equal(
    (await lookupProfile(f.profilesRoot, "helper")).configuration?.resources,
    undefined,
  );
});
