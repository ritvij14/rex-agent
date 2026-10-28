import assert from "node:assert/strict";
import { test } from "node:test";
import * as profiles from "@rex/profiles";

const entry = () => ({
  id: "local-docs",
  sha256: "a".repeat(64),
  tools: ["read-file"],
});

test("MCP exposure is bounded operator metadata and omission preserves default serialization", () => {
  const plain = profiles.parseLocalMcpCatalog([entry()])[0]!;
  assert.equal(Object.hasOwn(plain, "exposure"), false);
  for (const exposure of ["direct", "codemode", "deferred"]) {
    const catalog = profiles.parseLocalMcpCatalog([{ ...entry(), exposure }]);
    assert.equal(catalog[0]!.exposure, exposure);
    assert.ok(Object.isFrozen(catalog[0]));
    assert.deepEqual(
      profiles.localMcpToolNames(catalog),
      profiles.localMcpToolNames([plain]),
    );
  }
  for (const exposure of [
    null,
    true,
    "hidden",
    "model-only",
    "eager",
    "deferred ",
    undefined,
  ])
    assert.throws(
      () => profiles.parseLocalMcpCatalog([{ ...entry(), exposure }]),
      (error) =>
        error instanceof profiles.ProfileError &&
        error.code === "INVALID_MCP_CATALOG",
    );
  const inherited = Object.assign(
    Object.create({ exposure: "deferred" }),
    entry(),
  );
  assert.equal(
    profiles.parseLocalMcpCatalog([inherited])[0]!.exposure,
    undefined,
  );
});

test("Codemode is an explicit frozen boolean resource selection, not a file or grant", () => {
  const shared = profiles.parseSharedConfiguration({
    version: 2,
    model: { provider: "cli-proxy", id: "synthetic-model" },
    resources: { codemode: true },
    tools: { whitelist: [], blacklist: [] },
  });
  const profile = {
    id: "coding",
    home: "",
    soul: "Synthetic persona.",
    resources: { codemode: false },
  };
  const effective = profiles.resolveEffectiveProfile(profile, shared);
  assert.equal(effective.codemode, true);
  assert.deepEqual(effective.configuration.tools.whitelist, []);
  assert.deepEqual(profiles.resourcePaths(shared.resources), []);
  assert.ok(Object.isFrozen(shared.resources));
  assert.equal(
    profiles.resolveEffectiveProfile(profile, {
      ...shared,
      resources: undefined,
    }).codemode,
    undefined,
  );
  assert.equal(
    profiles.parseProfileDefinition({
      version: 2,
      id: "coding",
      resources: { codemode: true },
    }).resources?.codemode,
    true,
  );
  for (const value of ["true", 1, null, [], {}, undefined])
    assert.throws(
      () =>
        profiles.parseProfileDefinition({
          version: 2,
          id: "coding",
          resources: { codemode: value },
        }),
      (error) =>
        error instanceof profiles.ProfileError &&
        error.code === "INVALID_PROFILE_DEFINITION",
    );
});

test("MCP resolution unions required shared selections and rejects unknown IDs", () => {
  const shared = profiles.parseSharedConfiguration({
    version: 2,
    model: { provider: "cli-proxy", id: "synthetic-model" },
    localMcpCatalog: [
      { ...entry(), id: "first" },
      { ...entry(), id: "second" },
    ],
    resources: { mcp: ["first"] },
  });
  const profile = {
    id: "coding",
    home: "",
    soul: "Synthetic persona.",
    resources: { mcp: ["second"] },
  };
  assert.deepEqual(
    profiles
      .resolveEffectiveProfile(profile, shared)
      .mcpServers?.map((entry) => entry.id),
    ["first", "second"],
  );
  assert.deepEqual(
    profiles
      .resolveEffectiveProfile({ ...profile, resources: { mcp: [] } }, shared)
      .mcpServers?.map((entry) => entry.id),
    ["first"],
  );
  assert.throws(() =>
    profiles.resolveEffectiveProfile(
      { ...profile, resources: { mcp: ["missing"] } },
      shared,
    ),
  );
});

test("local MCP catalog freezes literal arguments and canonical tool names", () => {
  assert.equal(typeof profiles.parseLocalMcpCatalog, "function");
  const raw = {
    ...entry(),
    args: ["--label", "literal ${HOME}; !not-a-command"],
    resources: true,
  };
  const catalog = profiles.parseLocalMcpCatalog([raw]);
  raw.args.push("changed");
  raw.tools.push("changed");
  assert.deepEqual(catalog, [
    {
      ...entry(),
      args: ["--label", "literal ${HOME}; !not-a-command"],
      resources: true,
    },
  ]);
  assert.deepEqual(profiles.localMcpToolNames(catalog), [
    "mcp__local_docs__read_file",
    "list_mcp_resources",
    "list_mcp_resource_templates",
    "read_mcp_resource",
  ]);
  const multiple = profiles.parseLocalMcpCatalog([
    { ...entry(), resources: true },
    { ...entry(), id: "second", resources: true },
  ]);
  assert.equal(
    profiles
      .localMcpToolNames(multiple)
      .filter((name) => name === "read_mcp_resource").length,
    1,
  );
  assert.throws(() =>
    profiles.parseSharedConfiguration({
      version: 2,
      localMcpCatalog: catalog,
      extensionCatalog: [
        { id: "shadow", sha256: "a".repeat(64), tools: ["read_mcp_resource"] },
      ],
    }),
  );
  assert.ok(Object.isFrozen(catalog));
  assert.ok(Object.isFrozen(catalog[0]));
  assert.ok(Object.isFrozen(catalog[0]!.args));
  assert.ok(Object.isFrozen(catalog[0]!.tools));
  assert.deepEqual(profiles.parseLocalMcpCatalog([entry()])[0]!.args, []);
  assert.equal(profiles.parseLocalMcpCatalog([entry()])[0]!.resources, false);
});

test("local MCP catalog rejects execution, credential, alias and unbounded metadata", () => {
  const bad = [
    null,
    {},
    [],
    Array.from({ length: 9 }, (_, i) => ({ ...entry(), id: `server-${i}` })),
    [entry(), entry()],
    [{ ...entry(), id: "../outside" }],
    [{ ...entry(), id: "local_docs" }],
    [{ ...entry(), sha256: "a".repeat(64) + "\n" }],
    [{ ...entry(), sha256: "A".repeat(64) }],
    [{ ...entry(), tools: ["read-file", "read_file"] }],
    [{ ...entry(), tools: ["read-file", "read-file"] }],
    [{ ...entry(), tools: ["*"] }],
    [{ ...entry(), tools: ["a".repeat(64)] }],
    [{ ...entry(), tools: Array.from({ length: 33 }, (_, i) => `tool_${i}`) }],
    [{ ...entry(), args: Array(17).fill("x") }],
    [{ ...entry(), args: ["x".repeat(513)] }],
    [{ ...entry(), args: ["newline\nargument"] }],
    [{ ...entry(), args: [1] }],
    [{ ...entry(), resources: "true" }],
    [Object.create(entry())],
    [{ ...entry(), args: Array(9).fill("x".repeat(512)) }],
    [{ ...entry(), args: ["💡".repeat(129)] }],
    [{ ...entry(), id: "local-docs\n" }],
    ...[
      "command",
      "url",
      "env",
      "cwd",
      "headers",
      "oauth",
      "type",
      "exposure",
      "toolExposure",
    ].map((key) => [{ ...entry(), [key]: "synthetic-private-value" }]),
  ];
  for (const value of bad)
    assert.throws(
      () => profiles.parseLocalMcpCatalog(value),
      (error) => {
        assert.ok(error instanceof profiles.ProfileError);
        assert.equal(error.code, "INVALID_MCP_CATALOG");
        assert.equal(error.message, "Local MCP catalog is invalid.");
        return true;
      },
    );
  assert.throws(() =>
    profiles.parseSharedConfiguration({ version: 2, mcpCatalog: [entry()] }),
  );
  assert.deepEqual(
    profiles.parseProfileDefinition({
      version: 2,
      id: "coding",
      resources: { mcp: ["local-docs"] },
    }).resources?.mcp,
    ["local-docs"],
  );
  assert.throws(() =>
    profiles.selectLocalMcpServers(profiles.parseLocalMcpCatalog([entry()]), [
      "missing",
    ]),
  );
});
