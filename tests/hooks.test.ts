import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { installFixtureHooks, makeRepo } from "./helpers.ts";

test("real installed hooks accept a clean initial commit", (t) => {
  const repo = makeRepo(t);
  installFixtureHooks(repo);
  assert.equal(
    repo.rawGit("commit", "-qm", "chore: initial public foundation").status,
    0,
  );
});

test("real pre-commit accepts an intentionally public personal email", (t) => {
  const repo = makeRepo(t);
  installFixtureHooks(repo);
  repo.git("config", "user.email", "alice" + "@" + "invalid.test");
  const result = repo.rawGit("commit", "-qm", "chore: safe message");
  const output = Buffer.concat([result.stdout, result.stderr]).toString();
  assert.equal(result.status, 0);
  assert.ok(!output.includes("BLOCKED"));
});

test("real pre-commit rejects a staged token despite a clean working file", (t) => {
  const repo = makeRepo(t);
  installFixtureHooks(repo);
  const token =
    "gh" +
    "p_" +
    createHash("sha256").update("hook fixture only").digest("hex").slice(0, 36);
  repo.write("README.md", token);
  repo.git("add", "README.md");
  repo.write("README.md", "Looks clean now\n");
  const result = repo.rawGit("commit", "-qm", "chore: safe message");
  const output = Buffer.concat([result.stdout, result.stderr]).toString();
  assert.notEqual(result.status, 0);
  assert.ok(output.includes("BLOCKED"));
  assert.ok(!output.includes(token));
});

test("real commit-message hook accepts email addresses in bodies and trailers", (t) => {
  const repo = makeRepo(t);
  installFixtureHooks(repo);
  const message =
    "Contact " +
    "alice" +
    "@" +
    "invalid.test\n\nSigned-off-by: dependabot[bot] <" +
    ["support", "github.com"].join("@") +
    ">";
  const result = repo.rawGit("commit", "-qm", message);
  assert.equal(result.status, 0);
});

test("real commit-message hook rejects secrets even when emails are allowed", (t) => {
  const repo = makeRepo(t);
  installFixtureHooks(repo);
  const token =
    "gh" +
    "p_" +
    createHash("sha256")
      .update("synthetic email message hook")
      .digest("hex")
      .slice(0, 36);
  const result = repo.rawGit(
    "commit",
    "-qm",
    "Contact " + "alice" + "@" + "invalid.test; token=" + token,
  );
  const output = Buffer.concat([result.stdout, result.stderr]).toString();
  assert.notEqual(result.status, 0);
  assert.ok(output.includes("secret scanner"));
  assert.ok(!output.includes(token));
});

test("real commit-message hook rejects private messages without printing them", (t) => {
  const repo = makeRepo(t);
  installFixtureHooks(repo);
  const result = repo.rawGit(
    "commit",
    "-qm",
    "Contact " +
      "alice" +
      "@" +
      "invalid.test; path " +
      ["", "Users", "example", "private"].join("/"),
  );
  const output = Buffer.concat([result.stdout, result.stderr]).toString();
  assert.notEqual(result.status, 0);
  assert.ok(output.includes("commit message"));
  assert.ok(!output.includes("alice"));
  assert.ok(!output.includes("example/private"));
});

test("commit identity credentials remain blocked and redacted", (t) => {
  const repo = makeRepo(t);
  installFixtureHooks(repo);
  const token =
    "gh" +
    "p_" +
    createHash("sha256").update("identity fixture").digest("hex").slice(0, 36);
  repo.git("config", "user.name", token);
  const result = repo.rawGit("commit", "-qm", "safe message");
  const output = Buffer.concat([result.stdout, result.stderr]).toString();
  assert.notEqual(result.status, 0);
  assert.ok(output.includes("BLOCKED"));
  assert.ok(!output.includes(token));
});
