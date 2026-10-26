import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ROOT } from "../scripts/repo-check.ts";

const configuration = readFileSync(
  join(ROOT, ".github/dependabot.yml"),
  "utf8",
);
const blocks = configuration.split(/^  - package-ecosystem: /m).slice(1);

for (const ecosystem of ["npm", "github-actions"]) {
  test(`Dependabot suppresses minor/patch version PRs but not majors for ${ecosystem}`, () => {
    const block = blocks.find((entry) => entry.startsWith(`${ecosystem}\n`));
    assert.ok(block, `Missing ${ecosystem} updates`);
    const wildcard = block
      .split(/^      - dependency-name: /m)
      .find((entry) => entry.startsWith('"*"\n'));
    assert.ok(wildcard, "The ignore rule must apply to every dependency");
    assert.match(wildcard, /^        update-types:\n/m);
    assert.match(wildcard, /^          - version-update:semver-minor$/m);
    assert.match(wildcard, /^          - version-update:semver-patch$/m);
    assert.doesNotMatch(wildcard, /version-update:semver-major|versions:/);
  });
}

test("Dependabot covers both npm lockfiles and holds Node types on runtime major 22", () => {
  const npm = blocks.find((entry) => entry.startsWith("npm\n"));
  assert.ok(npm);
  assert.match(
    npm,
    /^    directories:\n      - \/\n      - \/lab\/terminal\n/m,
  );
  assert.match(
    npm,
    /^      - dependency-name: "@types\/node"\n        versions: \[">=23\.0\.0"\]$/m,
  );
  assert.equal(readFileSync(join(ROOT, ".nvmrc"), "utf8").trim(), "22");
});
