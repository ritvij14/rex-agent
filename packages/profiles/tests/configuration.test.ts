import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isToolAllowed,
  parseProfileDefinition,
  parseProfileRequest,
  ProfileError,
} from "@rex/profiles";

function definition() {
  return {
    id: "coding",
    configuration: {
      instructions: "A synthetic coding profile.",
      model: { provider: "cli-proxy", id: "glm-5.3-flash-cloud" },
      tools: { whitelist: ["*"], blacklist: ["propose_profile"] },
    },
  };
}

test("configured profiles are validated, copied and deeply frozen", () => {
  const input = definition();
  const parsed = parseProfileDefinition(input);
  assert.deepEqual(parsed, input);
  input.configuration.tools.blacklist.length = 0;
  assert.deepEqual(parsed.configuration?.tools.blacklist, ["propose_profile"]);
  assert.ok(Object.isFrozen(parsed.configuration?.tools.whitelist));
  assert.ok(Object.isFrozen(parsed.configuration?.model));
});

test("tool policy is default deny, exact-name or '*', with blacklist precedence", () => {
  assert.equal(
    isToolAllowed({ whitelist: ["*"], blacklist: ["write"] }, "read"),
    true,
  );
  assert.equal(
    isToolAllowed({ whitelist: ["*"], blacklist: ["write"] }, "write"),
    false,
  );
  assert.equal(
    isToolAllowed({ whitelist: ["read"], blacklist: [] }, "bash"),
    false,
  );
  assert.equal(
    isToolAllowed({ whitelist: ["read"], blacklist: ["*"] }, "read"),
    false,
  );
  assert.equal(isToolAllowed({ whitelist: [], blacklist: [] }, "read"), false);
  assert.equal(
    isToolAllowed({ whitelist: ["*"], blacklist: [] }, "read\n"),
    false,
  );
});

test("unsupported, incomplete and malformed configuration fails closed", () => {
  for (const value of [
    { ...definition(), extra: true },
    { id: "coding", configuration: {} },
    { id: "coding", configuration: undefined },
    { id: "../coding" },
    {
      ...definition(),
      configuration: { ...definition().configuration, instructions: "" },
    },
    {
      ...definition(),
      configuration: {
        ...definition().configuration,
        model: { provider: "cli-proxy", id: "!execute" },
      },
    },
    {
      ...definition(),
      configuration: {
        ...definition().configuration,
        tools: { whitelist: ["bash*"], blacklist: [] },
      },
    },
    {
      ...definition(),
      configuration: {
        ...definition().configuration,
        tools: { whitelist: ["*"], blacklist: "write" },
      },
    },
    {
      ...definition(),
      configuration: {
        ...definition().configuration,
        tools: { whitelist: ["*"], blacklist: [], paths: ["*"] },
      },
    },
  ])
    assert.throws(
      () => parseProfileDefinition(value),
      (error) => error instanceof ProfileError,
    );
});

test("profile selector is mandatory on the first line, not guessed from task text", () => {
  assert.deepEqual(
    parseProfileRequest("profile: coding\nMake a synthetic file."),
    { profileId: "coding", prompt: "Make a synthetic file." },
  );
  assert.deepEqual(
    parseProfileRequest("profile: research\r\nRead local docs."),
    { profileId: "research", prompt: "Read local docs." },
  );
  for (const input of [
    "",
    "Use coding for this.",
    "profile: coding",
    "profile: coding\n ",
    "Task\nprofile: coding",
    "profile: ../coding\nTask",
    "profile: coding \nTask",
    "profile: Coding\nTask",
    "profile: coding\n" + "x".repeat(65536),
  ]) {
    assert.throws(
      () => parseProfileRequest(input),
      (error) => error instanceof ProfileError,
    );
  }
});

test("model override IDs survive validation without permitting endpoints", () => {
  const input = definition();
  const model = {
    ...input.configuration.model,
    overrides: ["alternate-model"],
  };
  const parsed = parseProfileDefinition({
    ...input,
    configuration: { ...input.configuration, model },
  });
  assert.deepEqual(parsed.configuration?.model, model);
  assert.ok(Object.isFrozen(parsed.configuration?.model.overrides));
  for (const overrides of [
    ["!invalid"],
    ["alternate-model", "alternate-model"],
    Array(9).fill("a"),
    "anything",
  ]) {
    assert.throws(() =>
      parseProfileDefinition({
        ...input,
        configuration: {
          ...input.configuration,
          model: { ...model, overrides },
        },
      }),
    );
  }
});

test("selection refuses request overrides without an operator catalog", async () => {
  const { selectProfileModel } = await import("@rex/profiles");
  const model = {
    provider: "cli-proxy",
    id: "primary",
    overrides: ["alternate"],
  };
  assert.throws(
    () => selectProfileModel(model, undefined, "alternate"),
    /not allowed/,
  );
  assert.throws(() => selectProfileModel(model, [], "alternate"), /catalog/);
  assert.equal(selectProfileModel(model).id, "primary");
});

test("fallback plans are ordered, bounded, and disabled by explicit selection", async () => {
  const { planProfileModels } = await import("@rex/profiles");
  const model = {
    provider: "cli-proxy",
    id: "primary",
    fallbacks: ["second", "third"],
    overrides: ["third"],
  };
  const catalog = ["primary", "second", "third"].map((id) => ({
    id,
    api: "openai-completions" as const,
    contextWindow: 32768,
    maxOutputTokens: 0,
    reasoning: false,
  }));
  assert.deepEqual(
    planProfileModels(model, catalog).map((m) => m.id),
    ["primary", "second", "third"],
  );
  assert.deepEqual(
    planProfileModels(model, catalog, "third").map((m) => m.id),
    ["third"],
  );
  assert.throws(() => planProfileModels(model), /catalog/);
  assert.throws(() => planProfileModels(model, catalog.slice(0, 2)), /catalog/);
  for (const fallbacks of [
    ["primary"],
    ["second", "second"],
    ["!bad"],
    Array(5).fill("x"),
  ]) {
    const input = definition();
    assert.throws(() =>
      parseProfileDefinition({
        ...input,
        configuration: {
          ...input.configuration,
          model: { ...model, fallbacks },
        },
      }),
    );
  }
});

test("thinking levels are explicit and require catalog capability", async () => {
  const { planProfileModels } = await import("@rex/profiles");
  const input = definition();
  const metadata = {
    id: input.configuration.model.id,
    api: "openai-completions" as const,
    contextWindow: 32768,
    maxOutputTokens: 0,
    reasoning: true,
  };
  for (const thinking of ["off", "minimal", "low", "medium", "high"] as const) {
    const parsed = parseProfileDefinition({
      ...input,
      configuration: {
        ...input.configuration,
        model: { ...input.configuration.model, thinking },
      },
    });
    assert.equal(
      planProfileModels(parsed.configuration!.model, [metadata])[0]!.thinking,
      thinking,
    );
    if (thinking !== "off")
      assert.throws(
        () =>
          planProfileModels(parsed.configuration!.model, [
            { ...metadata, reasoning: false },
          ]),
        /reasoning/,
      );
  }
  for (const thinking of ["auto", "max", "", 1, null]) {
    assert.throws(() =>
      parseProfileDefinition({
        ...input,
        configuration: {
          ...input.configuration,
          model: { ...input.configuration.model, thinking },
        },
      }),
    );
  }
});
