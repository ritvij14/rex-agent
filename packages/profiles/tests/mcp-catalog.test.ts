import assert from "node:assert/strict";
import { test } from "node:test";
import * as profiles from "@rex/profiles";

const entry = () => ({
  id: "local-docs",
  sha256: "a".repeat(64),
  tools: ["read-file"],
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
  ]);
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
