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
