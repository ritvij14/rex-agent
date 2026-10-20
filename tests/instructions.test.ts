import assert from "node:assert/strict";
import { test } from "node:test";
import { ROOT, snapshot } from "../scripts/repo-check.ts";

function missingPackageGuides(names: Set<string>): string[] {
  return [...names]
    .filter((name) => /^packages\/[^/]+\/package\.json$/.test(name))
    .map((name) => name.replace(/package\.json$/, "AGENTS.md"))
    .filter((name) => !names.has(name));
}

test("the maintained tree has one README, at the root", () => {
  const { entries, problems } = snapshot(ROOT, "worktree");
  assert.equal(problems.length, 0, "Resolve publication path problems first");
  const readmes = entries.filter(([name]) =>
    /(^|\/)readme(?:\.[^/]+)?$/i.test(name),
  );
  assert.equal(readmes.length, 1, "Only the public root README is allowed");
  assert.equal(readmes[0]?.[0] === "README.md", true);
});

test("a new workspace manifest requires its own scoped instructions", () => {
  const manifest = "packages/sample/package.json";
  const guide = "packages/sample/AGENTS.md";
  assert.deepEqual(missingPackageGuides(new Set([manifest])), [guide]);
  assert.deepEqual(missingPackageGuides(new Set([manifest, guide])), []);
  assert.deepEqual(missingPackageGuides(new Set(["packages/AGENTS.md"])), []);
});

test("each existing workspace package has a local AGENTS.md", () => {
  const { entries, problems } = snapshot(ROOT, "worktree");
  assert.equal(problems.length, 0, "Resolve publication path problems first");
  const names = new Set(entries.map(([name]) => name));
  assert.equal(
    missingPackageGuides(names).length,
    0,
    "Add package-local instructions with each workspace manifest",
  );
});
