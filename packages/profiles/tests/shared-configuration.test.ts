import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import {
  isToolAllowed,
  loadSharedConfiguration,
  lookupProfile,
  parseProfileDefinition,
  parseSharedConfiguration,
  ProfileError,
  ProfileRuntime,
  resolveEffectiveProfile,
  validateProfileId,
  type SharedConfiguration,
} from "@rex/profiles";

interface Fixture {
  root: string;
  shared: SharedConfiguration;
}

async function fixture(
  t: TestContext,
  prepare?: (root: string) => Promise<void>,
): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "rex-profiles-shared-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "shared"), { recursive: true });
  await writeFile(
    join(root, "shared", "configuration.json"),
    JSON.stringify({
      version: 2,
      model: { provider: "cli-proxy", id: "shared-model" },
      tools: { whitelist: ["*"], blacklist: ["bash"] },
      mandatory: { tools: { blacklist: ["propose_profile"] } },
    }),
  );
  await writeFile(
    join(root, "shared", "REX_SOUL.md"),
    "Shared persona: answer from local evidence.",
  );
  await mkdir(join(root, "minimal"));
  await writeFile(join(root, "minimal", "SOUL.md"), "Minimal persona.");
  await prepare?.(root);
  const shared = await loadSharedConfiguration(join(root, "shared"));
  return { root, shared };
}

function errorCode(code: string) {
  return (error: unknown) =>
    error instanceof ProfileError && error.code === code;
}

test("shared configuration is validated, copied and deeply frozen", () => {
  const input = {
    version: 2,
    model: { provider: "cli-proxy", id: "shared-model" },
    tools: { whitelist: ["read"], blacklist: ["bash"] },
    mandatory: { tools: { blacklist: ["propose_profile"] } },
  };
  const parsed = parseSharedConfiguration(input);
  assert.deepEqual(parsed, input);
  assert.ok(Object.isFrozen(parsed));
  assert.ok(Object.isFrozen(parsed.model));
  assert.ok(Object.isFrozen(parsed.tools));
  assert.ok(Object.isFrozen(parsed.mandatory?.tools));
  input.tools.blacklist.push("write");
  assert.deepEqual(parsed.tools.blacklist, ["bash"]);
  for (const value of [
    { version: 2, extra: true },
    { version: 1 },
    { version: "2" },
    {},
    {
      version: 2,
      model: { provider: "cli-proxy", id: "!execute" },
    },
    { version: 2, tools: { whitelist: ["bash*"], blacklist: [] } },
    { version: 2, tools: { whitelist: [], blacklist: "write" } },
    { version: 2, mandatory: { tools: { blacklist: "!bad" } } },
    { version: 2, mandatory: { tools: { blacklist: [], extra: 1 } } },
  ]) {
    assert.throws(
      () => parseSharedConfiguration(value),
      errorCode("INVALID_SHARED_CONFIGURATION"),
      JSON.stringify(value),
    );
  }
});

test("loadSharedConfiguration fails closed on unusable directories", async (t) => {
  const cases: [
    string,
    "SHARED_CONFIGURATION_UNAVAILABLE" | "INVALID_SHARED_CONFIGURATION",
    ((dir: string) => Promise<void>) | null,
  ][] = [
    ["missing-directory", "SHARED_CONFIGURATION_UNAVAILABLE", null],
    [
      "no-configuration",
      "INVALID_SHARED_CONFIGURATION",
      async (dir) => {
        await mkdir(dir);
      },
    ],
    [
      "malformed-configuration",
      "INVALID_SHARED_CONFIGURATION",
      async (dir) => {
        await mkdir(dir);
        await writeFile(join(dir, "configuration.json"), "{");
      },
    ],
    [
      "wrong-version",
      "INVALID_SHARED_CONFIGURATION",
      async (dir) => {
        await mkdir(dir);
        await writeFile(
          join(dir, "configuration.json"),
          JSON.stringify({ version: 1 }),
        );
      },
    ],
  ];
  for (const [label, code, create] of cases) {
    const root = await mkdtemp(join(tmpdir(), "rex-profiles-shared-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const dir = join(root, "shared");
    if (create) await create(dir);
    await assert.rejects(loadSharedConfiguration(dir), errorCode(code), label);
  }
});

test("a minimal SOUL-only profile resolves shared defaults", async (t) => {
  const f = await fixture(t);
  const found = await lookupProfile(f.root, "minimal");
  assert.equal(found.soul, "Minimal persona.");
  assert.equal(found.configuration, undefined);
  const resolved = resolveEffectiveProfile(found, f.shared);
  assert.deepEqual(resolved.configuration, {
    instructions:
      "Shared persona: answer from local evidence.\n\nMinimal persona.",
    model: { provider: "cli-proxy", id: "shared-model" },
    tools: { whitelist: ["*"], blacklist: ["bash", "propose_profile"] },
  });
  assert.ok(Object.isFrozen(resolved.configuration));
  assert.ok(Object.isFrozen(resolved.configuration.tools));
});

test("profile overrides replace shared defaults while mandatory denials persist", async (t) => {
  const f = await fixture(t, async (root) => {
    await writeFile(
      join(root, "minimal", "profile.json"),
      JSON.stringify({
        version: 2,
        id: "minimal",
        model: { provider: "cli-proxy", id: "own-model" },
        tools: { whitelist: ["read"], blacklist: ["edit"] },
      }),
    );
  });
  const resolved = resolveEffectiveProfile(
    await lookupProfile(f.root, "minimal"),
    f.shared,
  );
  assert.deepEqual(resolved.configuration, {
    instructions:
      "Shared persona: answer from local evidence.\n\nMinimal persona.",
    model: { provider: "cli-proxy", id: "own-model" },
    tools: {
      whitelist: ["read"],
      blacklist: ["edit", "bash", "propose_profile"],
    },
  });
});

test("resolve rejects incomplete profiles instead of guessing", async (t) => {
  const f = await fixture(t, async (root) => {
    await mkdir(join(root, "bare"));
    await writeFile(
      join(root, "bare", "profile.json"),
      JSON.stringify({ id: "bare" }),
    );
  });
  assert.ok(f.shared.model);
  const bare = await lookupProfile(f.root, "bare");
  const minimal = await lookupProfile(f.root, "minimal");
  const emptyShared = parseSharedConfiguration({ version: 2 });
  assert.throws(
    () => resolveEffectiveProfile(bare, f.shared),
    errorCode("PROFILE_INCOMPLETE"),
  );
  assert.throws(
    () => resolveEffectiveProfile(bare, undefined),
    errorCode("PROFILE_INCOMPLETE"),
  );
  assert.throws(
    () => resolveEffectiveProfile(minimal, undefined),
    errorCode("PROFILE_INCOMPLETE"),
  );
  assert.throws(
    () => resolveEffectiveProfile(minimal, emptyShared),
    errorCode("PROFILE_INCOMPLETE"),
  );
});

test("lookup rejects unusable SOUL bundles", async (t) => {
  const f = await fixture(t, async (root) => {
    const outside = join(root, "elsewhere.md");
    await writeFile(outside, "escaped");
    await mkdir(join(root, "linked"));
    await symlink(outside, join(root, "linked", "SOUL.md"), "file");
  });
  const writeSoul = async (id: string, text: string) => {
    await mkdir(join(f.root, id), { recursive: true });
    await writeFile(join(f.root, id, "SOUL.md"), text);
  };
  await writeSoul("blank", "  \n\t ");
  await writeSoul("large", "x".repeat(16385));
  await mkdir(join(f.root, "no-soul"));
  await writeFile(
    join(f.root, "no-soul", "profile.json"),
    JSON.stringify({ version: 2, id: "no-soul" }),
  );
  await mkdir(join(f.root, "inline-instructions"));
  await writeFile(
    join(f.root, "inline-instructions", "profile.json"),
    JSON.stringify({
      version: 2,
      id: "inline-instructions",
      instructions: "inline",
    }),
  );
  await mkdir(join(f.root, "legacy-mixed"));
  await writeFile(
    join(f.root, "legacy-mixed", "profile.json"),
    JSON.stringify({
      id: "legacy-mixed",
      configuration: {
        instructions: "legacy",
        model: { provider: "cli-proxy", id: "m" },
        tools: { whitelist: ["*"], blacklist: [] },
      },
    }),
  );
  await writeFile(join(f.root, "legacy-mixed", "SOUL.md"), "mixed");
  for (const id of [
    "blank",
    "large",
    "no-soul",
    "inline-instructions",
    "legacy-mixed",
  ]) {
    await assert.rejects(
      lookupProfile(f.root, id),
      errorCode("INVALID_PROFILE_DEFINITION"),
      id,
    );
  }
  await assert.rejects(
    lookupProfile(f.root, "linked"),
    errorCode("PROFILE_UNAVAILABLE"),
  );
});

test("the shared directory name is reserved and v2 parsing stays strict", async (t) => {
  const f = await fixture(t);
  assert.throws(
    () => validateProfileId("shared"),
    errorCode("INVALID_PROFILE_ID"),
  );
  await assert.rejects(
    lookupProfile(f.root, "shared"),
    errorCode("INVALID_PROFILE_ID"),
  );
  const v2 = parseProfileDefinition({
    version: 2,
    id: "minimal",
    tools: { whitelist: ["read"], blacklist: [] },
  });
  assert.deepEqual(v2, {
    id: "minimal",
    version: 2,
    tools: { whitelist: ["read"], blacklist: [] },
  });
  assert.ok(Object.isFrozen(v2));
  for (const value of [
    { version: 2, id: "minimal", instructions: "x" },
    { version: 3, id: "minimal" },
    {
      version: 2,
      id: "minimal",
      model: { provider: "cli-proxy", id: "!!bad" },
    },
  ]) {
    assert.throws(
      () => parseProfileDefinition(value),
      (error) =>
        error instanceof ProfileError &&
        (error.code === "INVALID_PROFILE_DEFINITION" ||
          error.code === "UNSUPPORTED_PROFILE_VERSION"),
      JSON.stringify(value),
    );
  }
});

test("runtime turns still bind the profile without shared configuration", async (t) => {
  const f = await fixture(t);
  const runtime = new ProfileRuntime(f.root);
  const seen = await runtime.run("minimal", () => {
    const profile = runtime.current();
    assert.equal(profile.soul, "Minimal persona.");
    assert.ok(isToolAllowed({ whitelist: ["*"], blacklist: [] }, "bash"));
    return profile.id;
  });
  assert.equal(seen, "minimal");
});

test("shared persona and mandatory tool denials also cover legacy profiles", () => {
  const definition = parseProfileDefinition({
    id: "coding",
    configuration: {
      instructions: "Coding persona.",
      model: { provider: "cli-proxy", id: "synthetic-model" },
      tools: { whitelist: ["*"], blacklist: [] },
    },
  });
  const effective = resolveEffectiveProfile(
    { ...definition, home: "/synthetic/coding" },
    {
      ...parseSharedConfiguration({
        version: 2,
        mandatory: { tools: { blacklist: ["bash"] } },
      }),
      soul: "Common instruction.",
    },
  );
  assert.equal(
    effective.configuration.instructions,
    "Common instruction.\n\nCoding persona.",
  );
  assert.equal(isToolAllowed(effective.configuration.tools, "bash"), false);
  assert.equal(isToolAllowed(effective.configuration.tools, "read"), true);
});
